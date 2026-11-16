/**
 * Cloud stores, as data.
 *
 * A connection is one store the Files page can browse — a research repository reached with a
 * token, or an S3-compatible bucket reached with an access key pair. It is *by reference*: the
 * listing is remote and nothing is written to the workspace until the reader imports a file.
 *
 * The credential never lives on the connection. It goes to the Stronghold vault under
 * `cloud-<id>`, and only Rust ever reads it (see `commands/cloud.rs`).
 */

/** How a store authenticates. `none` is an open endpoint. */
export type CloudAuth = 'none' | 'token' | 'keys';

/** One field a store's connect form asks for. */
export interface CloudField {
  key: string;
  label: string;
  /** Rendered as a password field and stored in the vault, never in the connection. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** A fixed choice, e.g. repo type. */
  options?: string[];
  /** The value a select opens on. */
  default?: string;
}

/** One entry in a remote listing. */
export interface RemoteEntry {
  /** The store's own handle for the entry: the id or path the next call needs. */
  key: string;
  name: string;
  /** Where it sits, when that is a path a reader would recognise. */
  path?: string;
  /** The media type the store reported, when it reports one. */
  mime?: string;
  size?: number;
  /** Epoch milliseconds, when the store reports a date. */
  modified?: number;
  isDir?: boolean;
  /** A landing page, when the store has one. */
  url?: string;
}

/** A connected store, as stored and shown. */
export interface CloudConnection {
  id: string;
  providerId: string;
  label: string;
  /** Non-secret configuration: endpoints, repo names, buckets, regions. */
  config: Record<string, string>;
  createdAt: number;
}

/**
 * A workspace path paired with one in a store.
 *
 * A pair is either two folders kept level file by file, or one file kept level with one file.
 * The pair is the whole record: comparing re-reads both sides, so nothing about the files is
 * stored — only where the two sides are.
 */
export interface SyncPair {
  id: string;
  connectionId: string;
  label: string;
  /**
   * What is paired.
   *
   * A folder pair walks both sides and matches by relative path; a file pair is one remote
   * entry against one workspace file, for the case where only that file is shared.
   */
  kind: 'folder' | 'file';
  /** The store's own handle: a folder id or prefix, or the file's id. */
  remotePath: string;
  /** What the remote side is called, for the pair's row. */
  remoteName: string;
  /** The workspace-relative folder (a folder pair) or file (a file pair). */
  localPath: string;
  createdAt: number;
}

/** What one upload should send: where, how, and whether a JSON part leads the body. */
export interface UploadPlan {
  url: string;
  method: string;
  /** JSON metadata for a multipart/related upload; absent when the file is the whole body. */
  metadata?: string;
  mime?: string;
}

/** One file to write into a store. */
export interface UploadTarget {
  name: string;
  /** The store's key for the file being replaced, when it already exists. */
  key?: string;
  /** The store's key for the folder it lands in. */
  folder?: string;
  mime?: string;
}

/** What a provider's list needs from the app. */
export interface CloudContext {
  connection: CloudConnection;
  /**
   * Where to list, in the store's own terms: a folder id, an object prefix, a repository
   * path. Absent at the store's root.
   */
  path?: string;
  /** GET a URL and parse the JSON. */
  json(
    url: string,
    init?: { headers?: Record<string, string>; method?: string; body?: string },
  ): Promise<unknown>;
  /** GET a URL and return the text. */
  text(url: string, init?: { headers?: Record<string, string>; method?: string }): Promise<string>;
  /**
   * List an S3-compatible bucket.
   *
   * With a `delimiter` the store answers one level: the objects here and the folders below,
   * as common prefixes. Without one it answers every object under the prefix.
   */
  s3List(
    prefix: string,
    delimiter?: string,
  ): Promise<{
    objects: { key: string; size: number; modified?: string | null }[];
    prefixes: string[];
  }>;
  /** A time-limited URL for one S3 object. */
  s3Presign(key: string): Promise<string>;
}

/** One connectable store. */
export interface CloudProvider {
  id: string;
  label: string;
  /** A simpleicons slug for its brand mark, when one exists. */
  icon?: string;
  group: 'Repositories' | 'Object stores';
  auth: CloudAuth;
  docsUrl: string;
  summary: string;
  /** The non-secret fields the connect form asks for. */
  configFields: CloudField[];
  /** The secret fields, kept in the vault. */
  credentialFields: CloudField[];
  /**
   * The origin every request with this store's credential must go to.
   *
   * A credential is only attached to a request to its own host: an app compromise cannot make
   * the workbench send a stored token somewhere else. Object stores and Dataverse derive it
   * from their config instead.
   */
  apiBase?: string;
  /** Built-in endpoint choices for object stores. */
  presets?: {
    id: string;
    label: string;
    endpoint: string;
    region: string;
    /** A simpleicons slug for the preset's own brand, when it has one. */
    icon?: string;
    /** A substring of an endpoint that identifies this store, for picking its mark back. */
    match?: string;
  }[];
  /** How a token store presents its credential. Absent for object stores. */
  authSpec?: { kind: 'bearer' | 'header' | 'query' | 'none'; name?: string };
  /**
   * The account this store needs signed in (e.g. `google`). A connection using it carries no
   * credential of its own — the account's token is resolved at request time.
   */
  accountProvider?: string;
  /** A second credential shape for object stores: the pair, as one JSON secret. */
  credentialShape?: 'pair';
  /** The remote listing, mapped to entries, at `context.path` when the provider browses. */
  list(context: CloudContext): Promise<RemoteEntry[]>;
  /** A search across the whole store, when it has one. */
  search?(context: CloudContext, query: string): Promise<RemoteEntry[]>;
  /** A link the OS can open for one entry, when the store can mint one. */
  open?(context: CloudContext, entry: RemoteEntry): Promise<string | undefined>;
  /** The URL an import should fetch — an API media endpoint when it differs from the viewer link. */
  download?(context: CloudContext, entry: RemoteEntry): Promise<string | undefined>;
  /**
   * Where to send a local file's bytes, when the store can be written to. Absent for a store
   * that is read-only: a pairing with one can still be compared and pulled from.
   */
  upload?(context: CloudContext, target: UploadTarget): Promise<UploadPlan | undefined>;
  /** Create a folder, answering the store's key for it. Needed to push into a new subfolder. */
  mkdir?(context: CloudContext, name: string, parent?: string): Promise<string | undefined>;
  /**
   * Read one entry by its key, without listing the folder it sits in.
   *
   * A file paired on its own has no folder to walk, so its comparison asks for that one file.
   * Absent for a store that cannot address a file directly.
   */
  stat?(context: CloudContext, key: string): Promise<RemoteEntry | undefined>;
}

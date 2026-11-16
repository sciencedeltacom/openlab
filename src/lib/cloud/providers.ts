/**
 * The cloud providers openlab can connect to.
 *
 * Two families, one shape. A **repository** is a public research API reached with a token; an
 * **object store** is S3-compatible storage reached with an access key pair. Each provider is a
 * small descriptor — the fields its connect form asks for, and how to turn its listing into
 * rows — so adding one is data, not a new screen. Everything is browsed **by reference**: the
 * list call reads the remote catalogue, and a file is fetched only when the reader imports it.
 */

import { asArray } from '@/lib/science/connectors';
import type { CloudContext, CloudProvider, RemoteEntry } from './types';

/** A number from whatever the API sent, or undefined. */
function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Epoch milliseconds from an ISO date, when the API reports one. */
function when(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A record from an unknown JSON value. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The basename of a store path. */
function baseName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

const HUGGING_FACE: CloudProvider = {
  id: 'huggingface',
  apiBase: 'https://huggingface.co',
  label: 'Hugging Face',
  icon: 'huggingface',
  group: 'Repositories',
  auth: 'token',
  docsUrl: 'https://huggingface.co/docs/hub/security-tokens',
  summary: 'Datasets, models and spaces on the Hub.',
  configFields: [
    {
      key: 'repoType',
      label: 'Type',
      required: true,
      options: ['datasets', 'models', 'spaces'],
      default: 'datasets',
    },
    { key: 'repo', label: 'Repository', required: true, placeholder: 'owner/name' },
    { key: 'revision', label: 'Revision', placeholder: 'main', default: 'main' },
  ],
  credentialFields: [
    {
      key: 'apiKey',
      label: 'Access token',
      secret: true,
      placeholder: 'hf_…',
      help: 'Read token is enough for public and gated repos.',
    },
  ],
  authSpec: undefined,
  async list(context) {
    const { config } = context.connection;
    const revision = config.revision || 'main';
    const type = config.repoType || 'datasets';
    const data = asArray(
      await context.json(
        `https://huggingface.co/api/${type}/${config.repo}/tree/${revision}?recursive=false&expand=true`,
      ),
    );
    return data.map((raw): RemoteEntry => {
      const item = record(raw);
      const path = String(item.path ?? '');
      const isDir = item.type === 'directory';
      return {
        key: path,
        name: baseName(path) || path,
        path,
        size: num(item.size),
        isDir,
        url: isDir ? undefined : `https://huggingface.co/${type}/${config.repo}/resolve/${revision}/${path}`,
      };
    });
  },
};

/** Hugging Face uses a bearer token; declare it after the object so the field reads first. */
HUGGING_FACE.authSpec = { kind: 'bearer' };

const ZENODO: CloudProvider = {
  id: 'zenodo',
  apiBase: 'https://zenodo.org',
  label: 'Zenodo',
  icon: 'zenodo',
  group: 'Repositories',
  auth: 'token',
  docsUrl: 'https://developers.zenodo.org',
  summary: 'Open-access records deposited in Zenodo, by record id.',
  configFields: [{ key: 'recordId', label: 'Record id', required: true, placeholder: '1234567' }],
  credentialFields: [
    { key: 'apiKey', label: 'Access token', secret: true, help: 'Only needed for restricted records.' },
  ],
  authSpec: { kind: 'bearer' },
  async list(context) {
    const data = await context.json(`https://zenodo.org/api/records/${context.connection.config.recordId}`);
    return asArray(recordValue(data, 'files')).map((raw): RemoteEntry => {
      const item = record(raw);
      const key = String(item.key ?? '');
      const links = record(item.links);
      return {
        key,
        name: baseName(key) || key,
        size: num(item.size),
        url: typeof links.self === 'string' ? links.self : undefined,
      };
    });
  },
};

/** A record's field by name. */
function recordValue(value: unknown, key: string): unknown {
  return record(value)[key];
}

const FIGSHARE: CloudProvider = {
  id: 'figshare',
  apiBase: 'https://api.figshare.com',
  label: 'Figshare',
  icon: 'figshare',
  group: 'Repositories',
  auth: 'token',
  docsUrl: 'https://docs.figshare.com',
  summary: 'Figures, datasets and files in a Figshare article.',
  configFields: [{ key: 'articleId', label: 'Article id', required: true, placeholder: '12345678' }],
  credentialFields: [{ key: 'apiKey', label: 'Access token', secret: true }],
  authSpec: { kind: 'bearer' },
  async list(context) {
    const article = await context.json(
      `https://api.figshare.com/v2/articles/${context.connection.config.articleId}`,
    );
    return asArray(recordValue(article, 'files')).map((raw): RemoteEntry => {
      const item = record(raw);
      return {
        key: String(item.name ?? item.id ?? ''),
        name: String(item.name ?? item.id ?? ''),
        size: num(item.size),
        url: typeof item.download_url === 'string' ? item.download_url : undefined,
      };
    });
  },
};

const OSF: CloudProvider = {
  id: 'osf',
  apiBase: 'https://api.osf.io',
  label: 'OSF',
  icon: 'osf',
  group: 'Repositories',
  auth: 'token',
  docsUrl: 'https://developer.osf.io',
  summary: 'The Open Science Framework: projects and their files.',
  configFields: [{ key: 'projectId', label: 'Project id', required: true, placeholder: 'abc12' }],
  credentialFields: [
    {
      key: 'apiKey',
      label: 'Personal access token',
      secret: true,
      help: 'Only needed for private projects.',
    },
  ],
  authSpec: { kind: 'bearer' },
  async list(context) {
    // A folder is addressed by its id, which is what a row carries so a click can enter it.
    const folder = context.path ? `${context.path}/` : '';
    const page = await context.json(
      `https://api.osf.io/v2/nodes/${context.connection.config.projectId}/files/osfstorage/${folder}`,
    );
    return asArray(pageValue(page)).map((raw): RemoteEntry => {
      const item = record(raw);
      const attributes = record(item.attributes);
      const links = record(item.links);
      const name = String(attributes.name ?? '');
      return {
        key: String(item.id ?? name),
        name,
        path: name,
        size: num(attributes.size),
        isDir: attributes.kind === 'folder',
        url: typeof links.download === 'string' ? links.download : undefined,
      };
    });
  },
};

/** A JSON:API page's `data`. */
function pageValue(value: unknown): unknown {
  return record(value).data;
}

const DATAVERSE: CloudProvider = {
  id: 'dataverse',
  apiBase: 'https://dataverse.harvard.edu',
  label: 'Dataverse',
  group: 'Repositories',
  auth: 'token',
  docsUrl: 'https://guides.dataverse.org/en/latest/api',
  summary: 'Harvard and institute Dataverse datasets, by persistent id.',
  configFields: [
    { key: 'server', label: 'Dataverse', required: true, default: 'https://dataverse.harvard.edu' },
    { key: 'datasetPid', label: 'Dataset persistent id', required: true, placeholder: 'doi:10.7910/DVN/…' },
  ],
  credentialFields: [
    { key: 'apiKey', label: 'API token', secret: true, help: 'Only needed for restricted files.' },
  ],
  authSpec: { kind: 'header', name: 'X-Dataverse-key' },
  async list(context) {
    const { server, datasetPid } = context.connection.config;
    const base = server.replace(/\/$/, '');
    const dataset = await context.json(
      `${base}/api/datasets/:persistentId/?persistentId=${encodeURIComponent(datasetPid)}`,
    );
    const version = record(recordValue(recordValue(dataset, 'data'), 'latestVersion'));
    return asArray(version.files).map((raw): RemoteEntry => {
      const file = record(record(raw).dataFile);
      const id = String(file.id ?? '');
      return {
        key: id,
        name: String(file.filename ?? id),
        size: num(file.filesize),
        url: `${base}/api/access/datafile/${id}`,
      };
    });
  },
};

const GITHUB: CloudProvider = {
  id: 'github',
  apiBase: 'https://api.github.com',
  label: 'GitHub',
  icon: 'github',
  group: 'Repositories',
  auth: 'none',
  accountProvider: 'github',
  docsUrl: 'https://docs.github.com/en/rest/repos/contents',
  summary: 'Files in a repository or a folder of one. Sign in with GitHub to browse.',
  configFields: [
    { key: 'repo', label: 'Repository', required: true, placeholder: 'owner/name' },
    { key: 'path', label: 'Folder', placeholder: 'data' },
    { key: 'ref', label: 'Branch or tag', placeholder: 'main' },
  ],
  credentialFields: [],
  authSpec: { kind: 'bearer' },
  async list(context) {
    const { repo, path, ref } = context.connection.config;
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const data = await context.json(`https://api.github.com/repos/${repo}/contents/${path ?? ''}${query}`);
    // A folder is an array; a single file comes back as one object.
    const items = Array.isArray(data) ? data : [data];
    return items.map((raw): RemoteEntry => {
      const item = record(raw);
      const path = String(item.path ?? '');
      return {
        key: path,
        name: String(item.name ?? ''),
        path,
        size: num(item.size),
        isDir: item.type === 'dir',
        url: typeof item.download_url === 'string' ? item.download_url : undefined,
      };
    });
  },
};

const S3: CloudProvider = {
  id: 's3',
  label: 'S3-compatible',
  group: 'Object stores',
  auth: 'keys',
  docsUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html',
  summary: 'Amazon S3 and every store that speaks its API: R2, B2, Wasabi, Spaces, MinIO.',
  presets: [
    {
      id: 's3',
      label: 'Amazon S3',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      region: 'us-east-1',
      match: 'amazonaws.com',
    },
    {
      id: 'r2',
      label: 'Cloudflare R2',
      endpoint: 'https://<account>.r2.cloudflarestorage.com',
      region: 'auto',
      icon: 'cloudflare',
      match: 'r2.cloudflarestorage.com',
    },
    {
      id: 'b2',
      label: 'Backblaze B2',
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
      icon: 'backblaze',
      match: 'backblazeb2.com',
    },
    {
      id: 'wasabi',
      label: 'Wasabi',
      endpoint: 'https://s3.us-east-1.wasabisys.com',
      region: 'us-east-1',
      icon: 'wasabi',
      match: 'wasabisys.com',
    },
    {
      id: 'spaces',
      label: 'DigitalOcean Spaces',
      endpoint: 'https://<region>.digitaloceanspaces.com',
      region: 'nyc3',
      icon: 'digitalocean',
      match: 'digitaloceanspaces.com',
    },
    {
      id: 'minio',
      label: 'MinIO / self-hosted',
      endpoint: 'https://minio.example.org',
      region: 'us-east-1',
      icon: 'minio',
    },
  ],
  configFields: [
    { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'https://s3.us-east-1.amazonaws.com' },
    { key: 'region', label: 'Region', required: true, default: 'us-east-1' },
    { key: 'bucket', label: 'Bucket', required: true },
    { key: 'prefix', label: 'Prefix', placeholder: 'optional folder' },
  ],
  credentialFields: [
    { key: 'accessKeyId', label: 'Access key id', required: true },
    { key: 'secretAccessKey', label: 'Secret access key', secret: true, required: true },
  ],
  credentialShape: 'pair',
  authSpec: undefined,
  async list(context) {
    const listing = await context.s3List(context.path ?? context.connection.config.prefix ?? '', '/');
    const folders = listing.prefixes.map((prefix): RemoteEntry => {
      const trimmed = prefix.replace(/\/$/, '');
      return {
        key: prefix,
        name: trimmed.split('/').pop() ?? prefix,
        path: prefix,
        isDir: true,
      };
    });
    const files = listing.objects.map((object): RemoteEntry => ({
      key: object.key,
      name: baseName(object.key),
      path: object.key,
      size: object.size,
      modified: when(object.modified),
    }));
    return [...folders, ...files];
  },
  async search(context, query) {
    const listing = await context.s3List(query);
    return listing.objects.map((object): RemoteEntry => ({
      key: object.key,
      name: baseName(object.key),
      path: object.key,
      size: object.size,
      modified: when(object.modified),
    }));
  },
  async open(context, entry) {
    return context.s3Presign(entry.key);
  },
};

/**
 * Google Drive, reached through a signed-in Google account.
 *
 * Listing is one Drive query over a folder id, so entering a folder is listing a different
 * parent — no separate tree call. The viewer link opens in the browser; an import fetches the
 * media endpoint with the account's token. A search asks Drive itself, across the whole drive
 * the account can read, by name and by content.
 */

/** Google's own file types: they hold no bytes, so a copy has to be an export. */
const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png' },
};

/** The Drive folder type, which is how a directory announces itself. */
const DRIVE_FOLDER = 'application/vnd.google-apps.folder';

/** The fields one file reads as. */
const DRIVE_FILE_FIELDS = 'id,name,mimeType,size,modifiedTime';

/** The fields a listing and a search both read. */
const DRIVE_FIELDS = `files(${DRIVE_FILE_FIELDS})`;

/** A Drive query, percent-encoded for the URL. */
function driveQuery(clause: string): string {
  return encodeURIComponent(clause);
}

/**
 * A value inside a Drive query's single quotes.
 *
 * The quotes around it are the grammar's, so only the value is escaped: a backslash and a
 * quote are what Drive's own string literal understands.
 */
function driveValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** One Drive file, as a row. A Google-native file is named for what an export produces. */
function driveEntry(raw: unknown): RemoteEntry {
  const item = record(raw);
  const id = String(item.id ?? '');
  const mime = String(item.mimeType ?? '');
  const exported = GOOGLE_EXPORT[mime];
  const name = String(item.name ?? id);
  return {
    key: id,
    name: exported ? `${name}${exported.ext}` : name,
    mime,
    size: num(item.size),
    modified: when(item.modifiedTime),
    isDir: mime === DRIVE_FOLDER,
    url: `https://drive.google.com/open?id=${id}`,
  };
}

const DRIVE: CloudProvider = {
  id: 'drive',
  apiBase: 'https://www.googleapis.com',
  label: 'Google Drive',
  icon: 'googledrive',
  group: 'Repositories',
  auth: 'none',
  accountProvider: 'google',
  docsUrl: 'https://developers.google.com/drive/api/reference/rest/v3/files/list',
  summary: 'A folder of your Google Drive. Sign in with Google to browse it.',
  configFields: [
    { key: 'folderId', label: 'Folder id', placeholder: 'root, or a folder id', default: 'root' },
  ],
  credentialFields: [],
  authSpec: { kind: 'bearer' },
  async list(context) {
    const folder = context.path ?? (context.connection.config.folderId || 'root');
    const data = await context.json(
      `https://www.googleapis.com/drive/v3/files?q=${driveQuery(`'${driveValue(folder)}' in parents and trashed=false`)}` +
        `&fields=${DRIVE_FIELDS}&pageSize=200&orderBy=folder,name`,
    );
    return asArray(recordValue(data, 'files')).map(driveEntry);
  },
  async search(context, query) {
    // Drive's own index: the name of a file and the text inside it, over everything the
    // signed-in account can read.
    const clause = `(name contains '${driveValue(query)}' or fullText contains '${driveValue(query)}') and trashed=false`;
    const data = await context.json(
      `https://www.googleapis.com/drive/v3/files?q=${driveQuery(clause)}` +
        `&fields=${DRIVE_FIELDS}&pageSize=100&orderBy=modifiedTime desc`,
    );
    return asArray(recordValue(data, 'files')).map(driveEntry);
  },
  async download(context, entry) {
    const exported = GOOGLE_EXPORT[entry.mime ?? ''];
    if (exported) {
      return `https://www.googleapis.com/drive/v3/files/${entry.key}/export?mimeType=${encodeURIComponent(exported.mime)}`;
    }
    return `https://www.googleapis.com/drive/v3/files/${entry.key}?alt=media`;
  },
  async upload(_context, target) {
    const mime = target.mime ?? 'application/octet-stream';
    // A file that is already there keeps its name, parents and id: only the bytes change.
    if (target.key) {
      return {
        url: `https://www.googleapis.com/upload/drive/v3/files/${target.key}?uploadType=media&fields=id`,
        method: 'PATCH',
        mime,
      };
    }
    // A new file needs its metadata beside its bytes, which is Drive's multipart form.
    return {
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      method: 'POST',
      metadata: JSON.stringify({
        name: target.name,
        parents: [target.folder || 'root'],
        mimeType: mime,
      }),
      mime,
    };
  },
  async stat(context, key) {
    const data = await context.json(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}?fields=${DRIVE_FILE_FIELDS}`,
    );
    return driveEntry(data);
  },
  async mkdir(context, name, parent) {
    const created = await context.json('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER,
        parents: [parent || 'root'],
      }),
    });
    const id = String(recordValue(created, 'id') ?? '');
    return id || undefined;
  },
};

/** Every provider, in the order the picker shows them. */
export const CLOUD_PROVIDERS: readonly CloudProvider[] = [
  DRIVE,
  HUGGING_FACE,
  ZENODO,
  FIGSHARE,
  OSF,
  DATAVERSE,
  GITHUB,
  S3,
];

/** A provider by id. */
export function findProvider(id: string): CloudProvider | undefined {
  return CLOUD_PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Installed extensions.
 *
 * A small external store, the way the figures and the experiment ledger are kept, so the
 * Extend screens and the run loop read one list. What is installed lives in local storage and
 * comes back on relaunch; what the *workspace* carries lives in `.openlab/extensions/*.json`
 * and is re-read from disk, so a lab can commit its own tools beside the work that uses them.
 *
 * The registry owns installation, not execution: it answers "what is here", and the agent
 * runtime asks it for the packs, tools and connectors a session should see.
 */

import { useSyncExternalStore } from 'react';

import { PACK_IDS } from '@/lib/agent/pack-ids';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import { parseManifest, type ExtensionManifest } from './protocol';

/** Where an extension came from, which is also how it is refreshed. */
export type ExtensionSource = 'built-in' | 'workspace' | 'file';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  enabled: boolean;
  source: ExtensionSource;
  /** The file it was read from, for a workspace extension. */
  path?: string;
  installedAt: number;
}

const KEY = 'openlab.extensions.v1';

/** Where a workspace keeps its own extensions. */
export const EXTENSION_DIR = '.openlab/extensions';

function read(): InstalledExtension[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; extensions?: InstalledExtension[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.extensions)) return [];
    // A stored manifest is re-parsed rather than trusted: the protocol may have moved on.
    return parsed.extensions.flatMap((entry) => {
      const result = parseManifest(entry.manifest);
      return result.ok ? [{ ...entry, manifest: result.manifest }] : [];
    });
  } catch {
    return [];
  }
}

let extensions: InstalledExtension[] = read();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // Workspace extensions are the folder's, not storage's; only the rest is remembered.
    const kept = extensions.filter((entry) => entry.source !== 'workspace');
    localStorage.setItem(KEY, JSON.stringify({ version: 1, extensions: kept }));
  } catch {
    // Storage full or disabled: the session keeps working, the next launch starts empty.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every installed extension, newest first. */
export function useExtensions(): InstalledExtension[] {
  return useSyncExternalStore(subscribe, () => extensions);
}

/** Every installed extension. For readers that are not components — the run loop. */
export function installedExtensions(): InstalledExtension[] {
  return extensions;
}

/** The enabled ones: what the workbench actually opens. */
export function enabledExtensions(): InstalledExtension[] {
  return extensions.filter((entry) => entry.enabled);
}

/**
 * What a manifest may not do.
 *
 * Two rules the protocol states but `parseManifest` cannot enforce on its own, because they
 * are about the workbench rather than the file: a manifest cannot take a shipped pack's id,
 * and a tool id belongs to one extension.
 */
function conflictErrors(manifest: ExtensionManifest, others: readonly InstalledExtension[]): string[] {
  const errors: string[] = [];
  if ((PACK_IDS as readonly string[]).includes(manifest.id)) {
    errors.push(`id: "${manifest.id}" is a pack this build ships; choose a reverse-domain id.`);
  }
  const taken = new Map<string, string>();
  for (const entry of others) {
    for (const tool of entry.manifest.tools ?? []) taken.set(tool.id, entry.manifest.id);
  }
  for (const tool of manifest.tools ?? []) {
    const owner = taken.get(tool.id);
    if (owner) errors.push(`tools: "${tool.id}" is already declared by ${owner}.`);
  }
  return errors;
}

/** What an install did: the entry, or the reasons it was refused. */
export type InstallResult = { ok: true; entry: InstalledExtension } | { ok: false; errors: string[] };

/** Install or replace a manifest, enabling it by default. */
export function installExtension(
  manifest: ExtensionManifest,
  source: ExtensionSource = 'file',
  path?: string,
): InstallResult {
  const others = extensions.filter((candidate) => candidate.manifest.id !== manifest.id);
  const errors = conflictErrors(manifest, others);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const entry: InstalledExtension = {
    manifest,
    enabled: true,
    source,
    ...(path ? { path } : {}),
    installedAt: Date.now(),
  };
  extensions = [entry, ...others];
  persist();
  emit();
  return { ok: true, entry };
}

/** Take an extension out. A workspace one comes back on the next reload. */
export function removeExtension(id: string): void {
  extensions = extensions.filter((entry) => entry.manifest.id !== id);
  persist();
  emit();
}

/** Open or close one extension. */
export function setExtensionEnabled(id: string, enabled: boolean): void {
  extensions = extensions.map((entry) => (entry.manifest.id === id ? { ...entry, enabled } : entry));
  persist();
  emit();
}

/** Forget everything installed by hand. */
export function clearExtensions(): void {
  extensions = extensions.filter((entry) => entry.source === 'workspace');
  persist();
  emit();
}

/** What a workspace load found. */
export interface LoadReport {
  loaded: number;
  errors: { path: string; errors: string[] }[];
}

/**
 * Read the workspace's own extensions.
 *
 * Called with the workspace root when one is open. Every file is reported on its own: one
 * broken manifest must not stop the others from loading, and a failure is a fact the reader
 * needs rather than something to swallow.
 */
export async function loadWorkspaceExtensions(root: string): Promise<LoadReport> {
  const report: LoadReport = { loaded: 0, errors: [] };
  if (!isDesktop() || !root) return report;

  const files = await invokeCommand<string[]>('glob_files', { pattern: `${EXTENSION_DIR}/*.json`, root });
  if (!files.ok) {
    report.errors.push({ path: EXTENSION_DIR, errors: [files.error.message] });
    return report;
  }

  // The folder's extensions are replaced wholesale: a file that was deleted is gone.
  extensions = extensions.filter((entry) => entry.source !== 'workspace');
  for (const path of files.value) {
    const raw = await invokeCommand<string>('read_file', { path, root });
    if (!raw.ok) {
      report.errors.push({ path, errors: [raw.error.message] });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.value);
    } catch (error) {
      report.errors.push({
        path,
        errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
      });
      continue;
    }
    const result = parseManifest(parsed);
    if (!result.ok) {
      report.errors.push({ path, errors: result.errors });
      continue;
    }
    const others = extensions.filter((entry) => entry.manifest.id !== result.manifest.id);
    const conflicts = conflictErrors(result.manifest, others);
    if (conflicts.length > 0) {
      report.errors.push({ path, errors: conflicts });
      continue;
    }
    const existing = extensions.find((entry) => entry.manifest.id === result.manifest.id);
    extensions = [
      {
        manifest: result.manifest,
        enabled: existing?.enabled ?? true,
        source: 'workspace',
        path,
        installedAt: Date.now(),
      },
      ...extensions.filter((entry) => entry.manifest.id !== result.manifest.id),
    ];
    report.loaded += 1;
  }
  emit();
  return report;
}

/* ================================================================================================
 * What the runtime reads
 * ============================================================================================== */

/** The packs the enabled extensions open, as id → pack. The id is the extension's id. */
export function extensionPacks(): { id: string; name: string; family: string; skills: string[] }[] {
  return enabledExtensions().flatMap((entry) =>
    entry.manifest.pack
      ? [
          {
            id: entry.manifest.id,
            name: entry.manifest.pack.name,
            family: entry.manifest.pack.family,
            skills: entry.manifest.pack.skills ?? [],
          },
        ]
      : [],
  );
}

/** The tools the enabled extensions add, with the extension that owns each. */
export function extensionTools(): {
  extensionId: string;
  tool: NonNullable<ExtensionManifest['tools']>[number];
}[] {
  // One tool per id, newest extension first. A collision is refused at install time; this is
  // the second line of defence for an entry stored by an older build.
  const seen = new Set<string>();
  return enabledExtensions().flatMap((entry) =>
    (entry.manifest.tools ?? []).flatMap((tool) => {
      if (seen.has(tool.id)) return [];
      seen.add(tool.id);
      return [{ extensionId: entry.manifest.id, tool }];
    }),
  );
}

/** One tool by the name the model calls. */
export function findExtensionTool(
  id: string,
): { extensionId: string; tool: NonNullable<ExtensionManifest['tools']>[number] } | undefined {
  return extensionTools().find((entry) => entry.tool.id === id);
}

/** The connectors the enabled extensions declare. */
export function extensionConnectors(): {
  extensionId: string;
  connector: NonNullable<ExtensionManifest['connectors']>[number];
}[] {
  return enabledExtensions().flatMap((entry) =>
    (entry.manifest.connectors ?? []).map((connector) => ({ extensionId: entry.manifest.id, connector })),
  );
}

/** Every skill id the enabled extensions bring. */
export function extensionSkillIds(): string[] {
  return [...new Set(extensionPacks().flatMap((pack) => pack.skills))];
}

/**
 * Where one extension credential lives in the OS vault.
 *
 * The value never reaches the webview: a tool names the credential in a header and Rust reads
 * it out of the vault at call time, the same way a compute target's environment is built.
 */
export function extensionCredentialKey(extensionId: string, credentialId: string): string {
  return `extension:${extensionId}:${credentialId}`;
}

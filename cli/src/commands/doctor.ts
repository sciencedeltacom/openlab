/**
 * A health check, so a first run says what is missing instead of failing later.
 *
 * Every line is something a command needs: the runtime the CLI runs on, `git` on PATH, the
 * store the app shares, the migrations this build applies, the models.dev snapshot, a
 * credential for the model the workbench is set to, and the lab folder itself.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { Flags } from '@oclif/core';

import { allProviders } from '@/store/types';

import { LabCommand } from '../lib/base';
import { catalogProviders, envFor } from '../lib/catalog';
import { providerKey } from '../lib/host/secrets';
import { withCatalog } from '../lib/models';
import * as out from '../lib/output';
import { catalogPath, dataDir, databasePath, resolveLabRoot, shortPath } from '../lib/paths';
import { readLabConfig, structure } from '../lib/workspace';

/** One check's outcome. */
interface Check {
  name: string;
  state: 'ok' | 'warn' | 'fail';
  detail: string;
  hint?: string;
}

export default class Doctor extends LabCommand {
  static description = 'Check everything a command needs on this machine';

  static flags = {
    lab: Flags.boolean({ description: 'Also check the lab folder', default: true, allowNo: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const checks: Check[] = [];

    checks.push({
      name: 'runtime',
      state: 'ok',
      detail: `${process.versions.bun ? 'bun' : 'node'} ${process.versions.bun ?? process.versions.node} on ${process.platform}/${process.arch}`,
    });

    const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
    checks.push({
      name: 'git',
      state: git.status === 0 ? 'ok' : 'warn',
      detail: git.status === 0 ? (git.stdout ?? '').trim() : 'git was not found on PATH',
      hint: git.status === 0 ? undefined : 'The version-control commands need git installed.',
    });

    const dir = dataDir(true);
    checks.push({ name: 'data dir', state: existsSync(dir) ? 'ok' : 'warn', detail: shortPath(dir) });

    // The store is opened for real, so the migrations reported are the ones this build carries.
    let tables = 0;
    let migrations = 0;
    let storeState: Check['state'] = 'ok';
    let storeDetail = 'not opened';
    try {
      const lab = await this.lab({ root: null });
      tables = (
        lab.sqlite.query("select count(*) as n from sqlite_master where type = 'table'").get() as {
          n: number;
        }
      ).n;
      migrations = (lab.sqlite.query('select count(*) as n from __drizzle_migrations').get() as { n: number })
        .n;
      storeDetail = `${shortPath(databasePath())} · ${tables} tables · ${migrations} migrations`;
    } catch (error) {
      storeState = 'fail';
      storeDetail = error instanceof Error ? error.message : String(error);
    }
    checks.push({
      name: 'store',
      state: storeState,
      detail: storeDetail,
      hint: storeState === 'fail' ? 'The SQLite file could not be opened or migrated.' : undefined,
    });

    const catalog = catalogPath();
    checks.push({
      name: 'model catalog',
      state: existsSync(catalog) ? 'ok' : 'warn',
      detail: existsSync(catalog) ? `${catalogProviders().length} providers` : `${catalog} is missing`,
      hint: existsSync(catalog) ? undefined : 'Regenerate it with `bun scripts/models-dev.ts`.',
    });

    // The model the workbench is set to: is its credential where the CLI looks?
    try {
      const lab = await this.lab({ root: null });
      const state = withCatalog(lab.state);
      const providerId = state.modelRef.split('/')[0] ?? '';
      const provider = allProviders(state).find((candidate) => candidate.id === providerId);
      const names = envFor(providerId);
      const has = Boolean(provider) && (!provider?.requiresKey || Boolean(providerKey(providerId, names)));
      checks.push({
        name: 'model',
        state: has ? 'ok' : 'warn',
        detail: `${state.modelRef}: ${has ? 'credential present' : 'no credential'}`,
        hint: has
          ? undefined
          : `Set ${names[0] ?? `${providerId.toUpperCase()}_API_KEY`}, or run \`openlab secrets set ${providerId}\`.`,
      });
    } catch (error) {
      checks.push({
        name: 'model',
        state: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    if (flags.lab) {
      const root = resolveLabRoot(this.opts.workspace);
      if (root && existsSync(root)) {
        const config = readLabConfig(root);
        const missing = structure(root).filter((entry) => !entry.present);
        checks.push({
          name: 'lab',
          state: config && missing.length === 0 ? 'ok' : 'warn',
          detail: `${shortPath(root)}: ${config ? `manifest “${config.name}”` : 'no .labconfig'}${missing.length > 0 ? `, ${missing.length} structure entries missing` : ''}`,
          hint: missing.length > 0 ? 'Run `openlab workspace structure --fix`.' : undefined,
        });
      } else {
        checks.push({
          name: 'lab',
          state: 'warn',
          detail: 'no lab folder found from here',
          hint: 'Run `openlab init <dir>`, or pass --workspace.',
        });
      }
    }

    const failed = checks.some((check) => check.state === 'fail');
    this.emit({ checks, ok: !failed, tables, migrations }, () =>
      [
        out.brand(),
        '',
        ...checks.map(
          (check) =>
            `${check.state === 'ok' ? out.mark.ok : check.state === 'warn' ? out.mark.warn : out.mark.bad} ${check.name.padEnd(14)} ${out.c.grey(check.detail)}${check.hint ? `\n  ${out.c.grey(`↳ ${check.hint}`)}` : ''}`,
        ),
        '',
        failed
          ? out.c.red('Something is broken; the lines above say what.')
          : out.note('Everything a command needs is here.'),
      ].join('\n'),
    );
    if (failed) {
      process.exitCode = 1;
    }
  }
}

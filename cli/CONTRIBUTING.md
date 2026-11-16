# Adding a command

The CLI is the desktop app without its window. A command opens the same SQLite store the app
uses, reads the same workspace folder, and reuses the app's own modules (`@/lib/**`,
`@/store/**`, `@/components/**/store`) rather than reimplementing them. If something already
exists in the app, call it.

## Layout

```
cli/
  bin/run.js            bun runs the TypeScript directly; oclif detects bun and skips ts-node
  src/lib/              everything a command needs and no command may own
    base.ts             LabCommand: shared flags, the lab handle, --json/table helpers
    lab.ts              opens the store (bun:sqlite + drizzle + the app's migrations) and the state
    output.ts           table / keyValues / colours / marks
    paths.ts            data dir, database path, workspace discovery
    workspace.ts        .labconfig, the structure, the plan and figures as files
    catalog.ts          the models.dev snapshot, read from disk
    models.ts           resolving provider/model-id and building the AI SDK model directly
    agent.ts            the app's run loop: tool host, domain host, one turn
    host/fs.ts          files, scoped to the workspace
    host/git.ts         the user's own git, porcelain -z status
    host/search.ts      glob and grep, anchored to the workspace
    host/exec.ts        run_command and fetch_url, with the app's caps
    host/secrets.ts     the CLI's own vault (0600 JSON) plus the environment
  src/commands/**       one file per command; the path is the command id
```

A file at `src/commands/research/tasks/list.ts` is the command `openlab research tasks list`
(topics are space-separated).

## A command

```ts
import { Flags } from '@oclif/core';

import { LabCommand } from '../../../lib/base';
import * as out from '../../../lib/output';

export default class TaskList extends LabCommand {
  static description = 'List the tracker’s tasks';

  static flags = {
    status: Flags.string({ description: 'Only tasks in this status', options: ['todo', 'doing', 'done'] }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TaskList);
    const lab = await this.requireLab();
    const tasks = lab.state.tasks.filter((task) => !flags.status || task.status === flags.status);

    this.list(
      tasks,
      [
        { key: 'id', label: 'id' },
        { key: 'title', label: 'title' },
        { key: 'status', label: 'status' },
      ],
      'No tasks yet. `openlab research tasks new` opens one.',
    );
  }
}
```

## The rules

- `LabCommand` gives you `--json`, `--workspace`/`-w`, `--data`, plus:
  - `await this.lab()` — the workbench; `root` is `null` when no folder was found.
  - `await this.requireLab()` — fails with a readable message when there is no folder.
  - `this.list(rows, columns, empty)` — a table, or JSON with `--json`.
  - `this.record(value, pairs)` / `this.emit(value, render)` — one record.
  - `this.done(message)`, `this.fail(message)`, `this.short(path)`.
- **Writing**: mutate `lab.state.*` (or call the app's store functions), then `await lab.save()`.
  The save folds the active workspace back onto its project and writes only what changed.
  Catalogue stores (databases, sources, agents, topics, experiments, literature) persist
  themselves through `serialized`; `lab.save()` drains them.
- **Reuse, don't reimplement**: read the app module you need and call it. `@/lib/science/stats`,
  `@/lib/plan/format`, `@/store/research` (constructors such as `newTask`), the store modules in
  `@/components/*/store`, `@/lib/cloud/providers`, `@/lib/agent/*` are all headless already.
- **Do not** add dependencies, change `cli/src/lib/**`, or touch `src/**` (the app).
- **Honesty**: when a surface needs the app's Rust worker (the scan engine's Python, the
  Stronghold vault, an OAuth browser flow), say so in the command's help and fail with a message
  that names what is missing. Never print a result that did not happen.
- Style: the repo's prettier config (110 columns, single quotes, semicolons, trailing commas),
  comments that explain _why_ in the app's voice, no comment that repeats the code.

## Checking your work

```bash
# a scratch lab, so nothing touches a real one
export OPENLAB_DATA_DIR=/tmp/openlab-data
bun cli/bin/run.js init /tmp/openlab-lab --name demo
bun cli/bin/run.js <your command> -w /tmp/openlab-lab

# the help tree, which is how a user finds a command
bun cli/bin/run.js <topic> --help
```

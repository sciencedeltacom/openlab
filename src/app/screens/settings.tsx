/**
 * Settings screens.
 *
 * One page per route in the Settings group that has no bespoke screen of its own. Every field
 * here is read by the runtime: the limits are enforced by the engine, the appearance selects
 * are live settings, and the privacy switches gate the network. The pages with their own
 * components — providers, commands, usage, extensions, account — are branched in
 * `app/screens/index.tsx`.
 *
 * A page is a title and its controls. Nothing on it explains itself.
 */

import type { Field, ScreenSpec } from '@/components/screens/spec';
import type { RouteId } from '@/app/routes';
import { PROVIDERS } from '@/lib/providers';
import { CRASH_REPORT_LABEL } from '@/lib/settings';

/* ================================================================================================
 * Shared options
 * ============================================================================================== */

/** Picker options for every model the offline registry describes. */
const MODEL_OPTIONS: { value: string; label: string }[] = PROVIDERS.flatMap((provider) =>
  provider.models.map((model) => ({
    value: `${provider.id}/${model.id}`,
    label: `${provider.label} · ${model.label}`,
  })),
);

/** A select over the offline model registry. */
function modelSelect(label: string, value: string, hint?: string): Field {
  return { kind: 'select', label, hint, value, options: MODEL_OPTIONS };
}

/* ================================================================================================
 * Export
 * ============================================================================================== */

/** Settings section screens, keyed by route. */
export const settingsScreens: Partial<Record<RouteId, ScreenSpec>> = {
  /* -------------------------------------------------------------------------------------------- */
  'settings/controls': {
    kind: 'settings',
    sections: [
      {
        id: 'effort',
        title: 'Research effort',
        fields: [
          {
            kind: 'number',
            label: 'Tool calls per turn',
            value: 40,
            min: 5,
            max: 500,
          },
          { kind: 'number', label: 'Wall-clock per turn', value: 30, suffix: 'min', min: 1, max: 1440 },
          { kind: 'number', label: 'Parallel read tools', value: 4, min: 1, max: 16 },
        ],
      },
      {
        id: 'tools',
        title: 'Tool allowlist',
        fields: [
          {
            kind: 'switch',
            label: 'Restrict to the allowlist',
            value: false,
          },
          {
            kind: 'tags',
            label: 'Allowed tools',
            values: [
              'read_file',
              'list_dir',
              'inspect_table',
              'run_python',
              'run_r',
              'render_plot',
              'query_database',
              'save_result',
            ],
            placeholder: 'Add a tool id…',
          },
          { kind: 'tags', label: 'Always denied', values: ['run_shell'], placeholder: 'Add a tool id…' },
        ],
      },
      {
        id: 'stops',
        title: 'Stop rules',
        fields: [{ kind: 'number', label: 'Retries per tool call', value: 2, min: 0, max: 10 }],
      },
    ],
  },

  /* -------------------------------------------------------------------------------------------- */
  'settings/appearance': {
    kind: 'settings',
    sections: [
      {
        id: 'navigation',
        title: 'Navigation',
        fields: [
          {
            kind: 'select',
            label: 'Pages',
            value: 'sidebar',
            setting: 'navMode',
            options: [
              { value: 'sidebar', label: 'Sidebar' },
              { value: 'tabs', label: 'Tabs' },
            ],
          },
        ],
      },
      {
        id: 'theme',
        title: 'Theme',
        fields: [
          {
            kind: 'select',
            label: 'Theme',
            value: 'light',
            setting: 'theme',
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ],
          },
        ],
      },
      {
        id: 'background',
        title: 'Home background',
        fields: [
          {
            kind: 'select',
            label: 'Home background',
            value: 'lumenwave',
            hint: 'The surface behind the greeting on Home.',
            options: [
              { value: 'lumenwave', label: 'Lumenwave' },
              { value: 'none', label: 'None' },
            ],
          },
          {
            kind: 'radio',
            label: 'Tint',
            value: 'blue',
            hint: 'The colour the wave settles into.',
            options: [
              { value: 'blue', label: 'Blue' },
              { value: 'ice', label: 'Ice' },
              { value: 'violet', label: 'Violet' },
            ],
          },
          {
            kind: 'slider',
            label: 'Glow',
            value: 55,
            min: 0,
            max: 100,
            step: 5,
            suffix: '%',
            hint: 'How present the background is. The shipped default stays quiet.',
          },
        ],
      },
    ],
  },

  /* -------------------------------------------------------------------------------------------- */
  'settings/privacy': {
    kind: 'settings',
    sections: [
      {
        id: 'egress',
        title: 'What leaves the machine',
        fields: [
          {
            kind: 'rows',
            label: 'Egress',
            columns: ['Data', 'Leaves when', 'Destination'],
            rows: [
              ['Prompt text and conversation history', 'a turn runs', 'the provider you chose'],
              ['File contents a tool reads', 'a turn needs them', 'the provider you chose'],
              ['Attached files', 'you attach them to a turn', 'the provider you chose'],
              ['Tool arguments and results', 'a tool call runs', 'the provider you chose'],
              ['Figures, tables and indexes', 'never', 'the workspace on disk'],
              ['Usage counters', 'never', 'the local database'],
              ['The store (openlab.db)', 'never', 'this machine, as a plain SQLite file'],
              ['Crash reports', 'you enable the switch below', 'the app data folder, never sent'],
              ['Update check', 'the app starts', 'GitHub (the release manifest)'],
              ['The scan engine and Serena', 'you install one', 'GitHub, PyPI and the package index it uses'],
              ['Telemetry', 'never', '—'],
            ],
          },
        ],
      },
      {
        id: 'local',
        title: 'Stay local',
        fields: [
          {
            kind: 'switch',
            label: 'Local-only mode',
            value: false,
          },
          {
            kind: 'switch',
            label: CRASH_REPORT_LABEL,
            value: false,
          },
        ],
      },
    ],
  },

  /* -------------------------------------------------------------------------------------------- */
  'settings/help': {
    kind: 'doc',
    sections: [
      {
        id: 'first',
        title: 'If something is not working',
        steps: [
          {
            title: 'Check the model first',
            body: 'The composer\u2019s model picker names the model the turn runs on, and Providers shows whether that provider is connected. A turn that produces no output usually means the model points at a provider that is not connected.',
          },
          {
            title: 'Check the tool, not the prompt',
            body: 'Tools lists what each tool is and what it still needs. A missing runtime is reported rather than worked around.',
          },
          {
            title: 'Look at the transcript',
            body: 'Every tool call records its arguments, its exit status and its output. The first failing call is where to start, not the model answer below it.',
          },
          {
            title: 'Read the permission prompt',
            body: 'A call that writes, runs a command or reaches the network stops and asks first. The prompt names the exact path, command line or host; refusing aborts the call.',
          },
          {
            title: 'Reproduce it smaller',
            body: 'Run the same claim on a subset of the data. A failure that survives the subset is about the method, not the data size.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        title: 'Troubleshooting',
        cards: [
          {
            title: 'No answer, and the turn is idle',
            body: 'The session model is unreachable. Providers shows the connection state and the endpoint error.',
            tone: 'warning',
          },
          {
            title: 'A tool refuses to run',
            body: 'The permission prompt was declined. A read never asks; anything that writes, executes or reaches the network asks every time.',
            tone: 'default',
          },
          {
            title: 'The figure differs from last week',
            body: 'Regenerate it through the manifest entry rather than redrawing it. If the regenerated file differs, the provenance record is stale and the figure should not be used until it is explained.',
            tone: 'default',
          },
          {
            title: 'A citation has no DOI',
            body: 'Crossref has no deposited DOI for the record. Keep the URL and the source in the BibTeX entry; do not invent a DOI. Preprints usually resolve through arXiv instead.',
            tone: 'default',
          },
          {
            title: 'A skill is marked incomplete',
            body: 'The contract is missing inputs, outputs, steps or verification. The label names the missing part. An incomplete skill is described but not run until it is fixed.',
            tone: 'danger',
          },
        ],
      },
      {
        id: 'cookbook',
        title: 'Workflow cookbook',
        steps: [
          {
            title: 'Reproduce a figure from a paper',
            body: 'Open Library → Sources, find the record, and save the supplementary data. Then build the figure from the source table with the published summary statistic. Compare against the published figure before drawing conclusions from any difference.',
          },
          {
            title: 'Draft a methods section',
            body: 'Start from the environment lockfile and the manifest, not from memory. Every version number should come from a file that ran; cite software with the version that produced the result.',
          },
          {
            title: 'Hand a session to a colleague',
            body: 'Write the handoff into the tasks and the plan under .openlab/plan, commit the workspace, and share the session. They get the goal, the decisions and the artefact paths without your transcript.',
          },
        ],
      },
      {
        id: 'shortcuts',
        title: 'Keyboard',
        body: [
          'The command palette is the one shortcut to memorise; everything else is reachable from the sidebar.',
        ],
        table: {
          columns: ['Action', 'Shortcut'],
          rows: [['Command palette', '⌘K']],
        },
      },
    ],
    aside: [
      {
        title: 'Where things live',
        items: [
          { label: 'Plan and tasks', value: '.openlab/plan/' },
          { label: 'Figures', value: '.openlab/figures/' },
          { label: 'Workspace manifest', value: '.labconfig' },
          { label: 'Local state', value: 'the app data directory' },
        ],
      },
    ],
  },
};

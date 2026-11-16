/**
 * Where the data comes in.
 *
 * One panel for every way a dataset arrives: a file from the machine, a file already in the
 * workspace, a paste, or the procedure's own example. Whatever it came from is read into the
 * same table (`lib/science/dataset.ts`), so the picker below says which column is the value
 * and which is the group, not which format the bytes were.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, FileUp, FolderOpen, RotateCcw } from 'lucide-react';

import { Button, Dialog, Select, TextArea } from '@/components/ui';
import { invokeCommand, isDesktop } from '@/lib/ipc';
import {
  numericColumns,
  textColumns,
  planSummary,
  resolveGroupMode,
  shapeHint,
  type DataPlan,
  type DataShape,
  type Dataset,
  type GroupMode,
  type ReadOptions,
} from '@/lib/science/dataset';

/** Files a workspace picker offers: the formats `readDataset` understands. */
const DATASET_EXTENSIONS = ['csv', 'tsv', 'txt', 'json', 'tab'];

/** Preview cells shown per column before the table would stop being a preview. */
const PREVIEW_ROWS = 6;
const PREVIEW_COLUMNS = 8;

/** One labelled select over the dataset's columns. */
function ColumnSelect({
  label,
  columns,
  value,
  onChange,
}: {
  label: string;
  columns: readonly { key: string; name: string }[];
  value?: string;
  onChange: (key: string) => void;
}) {
  return (
    <label className="flex min-w-40 flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      <Select
        label={label}
        value={value ?? ''}
        options={columns.map((column) => ({ value: column.key, label: column.name }))}
        onChange={onChange}
        className="w-full"
      />
    </label>
  );
}

/** The readout of the table, above the rows. */
function TablePreview({ dataset }: { dataset: Dataset }) {
  const columns = dataset.columns.slice(0, PREVIEW_COLUMNS);
  const rows = dataset.rows.slice(0, PREVIEW_ROWS);
  if (columns.length === 0) {
    return null;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-separator">
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="bg-surface">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-foreground"
              >
                {column.name}
                <span className="ml-1.5 font-normal text-muted">{column.type === 'number' ? '#' : 'Aa'}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-separator">
              {columns.map((column, cell) => (
                <td key={column.key} className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-muted">
                  {row[cell] === '' || row[cell] === null ? '·' : String(row[cell])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {dataset.rows.length > PREVIEW_ROWS && (
        <p className="border-t border-separator px-2.5 py-1.5 text-meta text-muted">
          {dataset.rows.length - PREVIEW_ROWS} more row(s)
        </p>
      )}
    </div>
  );
}

/** The formats the dataset picker reads out of a workspace folder. */
async function workspaceDatasets(root: string): Promise<string[]> {
  const found = await Promise.all(
    DATASET_EXTENSIONS.map((extension) =>
      invokeCommand<string[]>('glob_files', { pattern: `**/*.${extension}`, root }),
    ),
  );
  const paths = found.flatMap((result) => (result.ok ? result.value : []));
  return [...new Set(paths)].sort().slice(0, 200);
}

export function DataPanel({
  shape,
  dataset,
  plan,
  text,
  options,
  sample,
  hint,
  workspace,
  onText,
  onOptions,
  onPlan,
}: {
  shape: DataShape;
  dataset: Dataset;
  plan: DataPlan;
  text: string;
  options: ReadOptions;
  sample: string;
  hint?: string;
  workspace: string | null;
  onText: (text: string) => void;
  onOptions: (options: ReadOptions) => void;
  onPlan: (plan: DataPlan) => void;
}) {
  const [picker, setPicker] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const numbers = numericColumns(dataset);
  const texts = textColumns(dataset);
  const mode = resolveGroupMode(dataset, plan);
  const modeOptions = useMemo(() => {
    const options: { value: GroupMode; label: string }[] = [];
    if (texts.length > 0) options.push({ value: 'column', label: 'By a group column' });
    options.push({ value: 'blocks', label: 'By blank-line blocks' });
    if (numbers.length > 1) options.push({ value: 'per-column', label: 'One column per group' });
    return options;
  }, [numbers.length, texts.length]);

  const readFile = async (file: File) => {
    const content = await file.text();
    onText(content);
    setNotice(`Read ${file.name}`);
  };

  const openPicker = async () => {
    setPicker(true);
    if (!workspace) {
      setFiles([]);
      return;
    }
    setFiles(null);
    setFiles(await workspaceDatasets(workspace));
  };

  const pick = async (path: string) => {
    if (!workspace) return;
    const read = await invokeCommand<string>('read_file', { path, root: workspace });
    if (!read.ok) {
      setNotice(read.error.message);
      return;
    }
    onText(read.value);
    setPicker(false);
    setNotice(`Read ${path}`);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-foreground">Data</span>
        <span className="text-meta text-muted">{planSummary(dataset, plan)}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {dataset.format !== 'whitespace' && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-meta text-muted">
              {dataset.format}
              {dataset.delimiter && dataset.delimiter !== 'whitespace'
                ? ` · ${dataset.delimiter === '\t' ? 'tab' : dataset.delimiter}`
                : ''}
            </span>
          )}
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-meta text-foreground hover:bg-surface/80 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <FileUp className="size-3.5" aria-hidden />
            Import file
            <input
              type="file"
              aria-label="Import a dataset file"
              accept=".csv,.tsv,.txt,.tab,.json,text/csv,text/tab-separated-values,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            isDisabled={!isDesktop()}
            onPress={() => void openPicker()}
          >
            <FolderOpen className="size-3.5" aria-hidden />
            Workspace
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onPress={() => onText(sample)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Example
          </Button>
        </span>
      </div>

      <TextArea
        aria-label="Data"
        variant="secondary"
        rows={7}
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder="Paste a table, or import a CSV, TSV or JSON file."
        className="font-mono text-meta"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-40 flex-col gap-1">
          <span className="text-meta text-muted">First row</span>
          <Select
            label="First row"
            value={options.header === undefined ? 'auto' : options.header ? 'header' : 'data'}
            options={[
              { value: 'auto', label: 'Detect' },
              { value: 'header', label: 'Column names' },
              { value: 'data', label: 'Data' },
            ]}
            onChange={(next) =>
              onOptions({ ...options, header: next === 'auto' ? undefined : next === 'header' })
            }
            className="w-full"
          />
        </label>
        <label className="flex w-40 flex-col gap-1">
          <span className="text-meta text-muted">Delimiter</span>
          <Select
            label="Delimiter"
            value={options.delimiter ?? 'auto'}
            options={[
              { value: 'auto', label: 'Detect' },
              { value: ',', label: 'Comma' },
              { value: '\t', label: 'Tab' },
              { value: ';', label: 'Semicolon' },
              { value: 'whitespace', label: 'Whitespace' },
            ]}
            onChange={(next) => onOptions({ ...options, delimiter: next === 'auto' ? undefined : next })}
            className="w-full"
          />
        </label>
        {shape === 'groups' && (
          <label className="flex w-52 flex-col gap-1">
            <span className="text-meta text-muted">Groups come from</span>
            <Select
              label="Groups come from"
              value={mode}
              options={modeOptions}
              onChange={(next) => onPlan({ ...plan, groupMode: next })}
              className="w-full"
            />
          </label>
        )}
        {shape === 'values' && numbers.length > 1 && (
          <ColumnSelect
            label="Values column"
            columns={numbers}
            value={plan.roles.value}
            onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, value: key } })}
          />
        )}
        {shape === 'groups' && mode === 'column' && (
          <>
            <ColumnSelect
              label="Group column"
              columns={texts}
              value={plan.roles.group}
              onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, group: key } })}
            />
            <ColumnSelect
              label="Value column"
              columns={numbers}
              value={plan.roles.value}
              onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, value: key } })}
            />
          </>
        )}
        {shape === 'pairs' && (
          <>
            <ColumnSelect
              label="X column"
              columns={numbers}
              value={plan.roles.x}
              onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, x: key } })}
            />
            <ColumnSelect
              label="Y column"
              columns={numbers}
              value={plan.roles.y}
              onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, y: key } })}
            />
          </>
        )}
        {shape === 'pvalues' && (
          <>
            {texts.length > 0 && (
              <ColumnSelect
                label="Label column"
                columns={texts}
                value={plan.roles.label}
                onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, label: key } })}
              />
            )}
            <ColumnSelect
              label="p-value column"
              columns={numbers}
              value={plan.roles.p}
              onChange={(key) => onPlan({ ...plan, roles: { ...plan.roles, p: key } })}
            />
          </>
        )}
        {shape === 'groups' && mode === 'blocks' && (
          <span className="pb-1.5 text-meta text-muted">
            {new Set(dataset.blockOf).size} group(s) from blank lines
          </span>
        )}
      </div>

      <p className="text-meta text-muted">{hint ?? shapeHint(shape)}</p>

      {notice && <p className="text-meta text-muted">{notice}</p>}

      {dataset.problems.length > 0 && (
        <ul className="flex flex-col gap-1">
          {dataset.problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5 text-meta text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {problem}
            </li>
          ))}
        </ul>
      )}

      <TablePreview dataset={dataset} />

      <Dialog
        open={picker}
        onClose={() => setPicker(false)}
        title="Dataset in this workspace"
        description="CSV, TSV, text and JSON files, read from the folder this project is."
        width={620}
      >
        {files === null && <p className="text-body text-muted">Reading the workspace…</p>}
        {files !== null && files.length === 0 && (
          <p className="text-body text-muted">
            No dataset files found. Import one from the machine, or put a CSV in the workspace.
          </p>
        )}
        {files !== null && files.length > 0 && (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {files.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => void pick(path)}
                className="flex w-full flex-col rounded-xl px-2.5 py-2 text-left hover:bg-surface"
              >
                <span className="truncate text-body text-foreground">{path.split('/').pop()}</span>
                <span className="truncate text-meta text-muted">{path}</span>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </section>
  );
}

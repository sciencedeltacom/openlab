/**
 * Writing a procedure, as its own page.
 *
 * The page is a form, not a manifest editor: name, data shape, parameters, outputs, chart and
 * assumptions are fields, and `procedure.yaml` is generated from them. The code is a file the
 * reader picks, not something typed into a textarea — a procedure's script is written in an
 * editor, and this page is not one.
 *
 * Nothing is saved until the manifest validates, and the reason a field was refused is listed
 * where it was typed.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, FileCode2, Plus, Sparkles, X } from 'lucide-react';
import { stringify as toYaml } from 'yaml';

import { Button, IconButton, Input, ScrollShadow, SectionLabel, Select, SwitchRow } from '@/components/ui';
import {
  parseManifest,
  procedureTemplate,
  STATISTICS_PROTOCOL,
  type OutputType,
  type ParameterType,
  type ProcedureManifest,
} from '@/lib/science/procedures';
import type { DataShape } from '@/lib/science/dataset';

/** One parameter row, every field as typed. */
interface ParamDraft {
  name: string;
  label: string;
  type: ParameterType;
  value: string;
  min: string;
  max: string;
  step: string;
  choices: string;
  hint: string;
}

/** One output row. */
interface OutputDraft {
  key: string;
  label: string;
  type: OutputType;
  digits: string;
}

/** One declared assumption. */
interface AssumptionDraft {
  name: string;
  detail: string;
}

/** The whole form. */
interface Form {
  name: string;
  id: string;
  family: string;
  summary: string;
  shape: DataShape;
  chart: string;
  params: ParamDraft[];
  outputs: OutputDraft[];
  assumptions: AssumptionDraft[];
}

const SHAPES: { value: DataShape; label: string }[] = [
  { value: 'values', label: 'One value column' },
  { value: 'groups', label: 'Groups of values' },
  { value: 'pairs', label: 'Two paired columns' },
  { value: 'table', label: 'A table of counts' },
  { value: 'pvalues', label: 'Labels and p-values' },
];

const PARAM_TYPES: { value: ParameterType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'On / off' },
  { value: 'choice', label: 'Choice' },
  { value: 'text', label: 'Text' },
];

const OUTPUT_TYPES: { value: OutputType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'percent', label: 'Percent' },
  { value: 'interval', label: 'Interval' },
  { value: 'p', label: 'p-value' },
  { value: 'text', label: 'Text' },
];

const CHARTS = [
  { value: 'none', label: 'No chart' },
  { value: 'means', label: 'Means with 95% CI' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'categories', label: 'Counts' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'pvalues', label: 'p-values' },
];

const BLANK: Form = {
  name: '',
  id: '',
  family: 'Custom',
  summary: '',
  shape: 'groups',
  chart: 'none',
  params: [],
  outputs: [{ key: 'estimate', label: 'Estimate', type: 'number', digits: '3' }],
  assumptions: [],
};

/** A slug the manifest accepts, from whatever the reader typed. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A number field's text, or `undefined` when it is empty or not a number. */
function numberOr(value: string): number | undefined {
  const text = value.trim();
  if (text === '') return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/** The form an existing manifest fills. */
function formOf(manifest: ProcedureManifest | undefined, fallbackId: string): Form {
  if (!manifest) {
    return { ...BLANK, id: fallbackId };
  }
  return {
    name: manifest.name,
    id: manifest.id,
    family: manifest.family,
    summary: manifest.summary,
    shape: manifest.data.shape,
    chart: manifest.chart,
    params: manifest.params.map((parameter) => ({
      name: parameter.name,
      label: parameter.label,
      type: parameter.type,
      value:
        parameter.default === undefined
          ? ''
          : typeof parameter.default === 'boolean'
            ? String(parameter.default)
            : String(parameter.default),
      min: parameter.min === undefined ? '' : String(parameter.min),
      max: parameter.max === undefined ? '' : String(parameter.max),
      step: parameter.step === undefined ? '' : String(parameter.step),
      choices: (parameter.choices ?? []).join(', '),
      hint: parameter.hint ?? '',
    })),
    outputs: manifest.outputs.map((output) => ({
      key: output.key,
      label: output.label,
      type: output.type,
      digits: output.digits === undefined ? '' : String(output.digits),
    })),
    assumptions: manifest.assumptions.map((assumption) => ({
      name: assumption.name,
      detail: assumption.detail,
    })),
  };
}

/**
 * The manifest the form describes, ready to be parsed by the protocol.
 *
 * Fields the form does not edit — the design note, the R reproduction, the declared column
 * roles — are carried over from the procedure being edited, so a save never drops what the
 * page did not ask about.
 */
function manifestOf(form: Form, base?: ProcedureManifest): Record<string, unknown> {
  const params = form.params
    .filter((parameter) => parameter.name.trim() !== '' || parameter.label.trim() !== '')
    .map((parameter) => {
      const name = parameter.name.trim() || slug(parameter.label);
      const entry: Record<string, unknown> = {
        name,
        type: parameter.type,
        label: parameter.label.trim() || name.replace(/_/g, ' '),
      };
      if (parameter.type === 'number' || parameter.type === 'integer') {
        const value = numberOr(parameter.value);
        if (value !== undefined) entry.default = value;
        const min = numberOr(parameter.min);
        const max = numberOr(parameter.max);
        const step = numberOr(parameter.step);
        if (min !== undefined) entry.min = min;
        if (max !== undefined) entry.max = max;
        if (step !== undefined) entry.step = step;
      } else if (parameter.type === 'boolean') {
        entry.default = parameter.value.trim().toLowerCase() === 'true';
      } else if (parameter.type === 'choice') {
        entry.choices = parameter.choices
          .split(',')
          .map((choice) => choice.trim())
          .filter(Boolean);
        if (parameter.value.trim() !== '') entry.default = parameter.value.trim();
      } else if (parameter.value.trim() !== '') {
        entry.default = parameter.value;
      }
      if (parameter.hint.trim() !== '') entry.hint = parameter.hint.trim();
      return entry;
    });

  const outputs = form.outputs
    .filter((output) => output.key.trim() !== '' || output.label.trim() !== '')
    .map((output) => {
      const key = output.key.trim() || slug(output.label).replace(/-/g, '_');
      const entry: Record<string, unknown> = {
        key,
        label: output.label.trim() || key.replace(/_/g, ' '),
        type: output.type,
      };
      const digits = numberOr(output.digits);
      if (digits !== undefined) entry.digits = Math.round(digits);
      return entry;
    });

  const assumptions = form.assumptions
    .filter((assumption) => assumption.name.trim() !== '')
    .map((assumption) => ({
      name: assumption.name.trim(),
      detail: assumption.detail.trim(),
    }));

  return {
    protocol: STATISTICS_PROTOCOL,
    id: form.id.trim() || slug(form.name),
    name: form.name.trim(),
    family: form.family.trim() || 'Custom',
    summary: form.summary.trim(),
    ...(base?.design ? { design: base.design } : {}),
    data: {
      shape: form.shape,
      ...(base?.data.columns ? { columns: base.data.columns } : {}),
    },
    params,
    outputs,
    chart: form.chart,
    assumptions,
    ...(base?.r ? { r: base.r } : {}),
  };
}

/** A labelled field row, so the form does not repeat the same six lines. */
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-meta text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta text-muted">{hint}</span>}
    </label>
  );
}

/** A small text input for a row cell. */
function Cell({
  label,
  value,
  onChange,
  placeholder,
  width,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: string;
  type?: 'text' | 'number';
}) {
  return (
    <Input
      aria-label={label}
      type={type ?? 'text'}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={width}
      fullWidth
    />
  );
}

export function ProcedurePage({
  initial,
  onBack,
  onSave,
}: {
  /** The procedure being edited: its manifest and the script it already has. */
  initial?: { manifest?: ProcedureManifest; python: string; id?: string };
  onBack: () => void;
  onSave: (input: { yaml: string; python: string }) => Promise<string[]>;
}) {
  const [form, setForm] = useState<Form>(() => formOf(initial?.manifest, initial?.id ?? ''));
  const [python, setPython] = useState(initial?.python ?? '');
  const [scriptName, setScriptName] = useState(initial?.python ? 'procedure.py' : '');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const yaml = useMemo(
    () => toYaml(manifestOf(form, initial?.manifest), { lineWidth: 100 }),
    [form, initial?.manifest],
  );
  const patch = (next: Partial<Form>) => setForm((current) => ({ ...current, ...next }));

  const loadExample = () => {
    const template = procedureTemplate();
    const read = parseManifest(template.yaml, { dir: 'example', python: template.python });
    if (!read.ok) return;
    setForm(formOf(read.manifest, read.manifest.id));
    setPython(template.python);
    setScriptName('bootstrap.py');
    setErrors([]);
  };

  const pickScript = async (file: File) => {
    setPython(await file.text());
    setScriptName(file.name);
    setErrors([]);
  };

  const save = async () => {
    if (!python.trim()) {
      setErrors(['Select the Python file that computes this procedure.']);
      return;
    }
    setSaving(true);
    const problems = await onSave({ yaml, python });
    setSaving(false);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    onBack();
  };

  const setParam = (index: number, next: Partial<ParamDraft>) =>
    patch({ params: form.params.map((row, at) => (at === index ? { ...row, ...next } : row)) });
  const setOutput = (index: number, next: Partial<OutputDraft>) =>
    patch({ outputs: form.outputs.map((row, at) => (at === index ? { ...row, ...next } : row)) });
  const setAssumption = (index: number, next: Partial<AssumptionDraft>) =>
    patch({
      assumptions: form.assumptions.map((row, at) => (at === index ? { ...row, ...next } : row)),
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-start gap-3 px-6 pb-4 pt-6">
        <Button variant="ghost" size="sm" className="gap-1.5" onPress={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Statistics
        </Button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-lg font-semibold text-foreground">
            {initial?.manifest?.name ? `Edit ${initial.manifest.name}` : 'New procedure'}
          </h1>
          <p className="text-meta text-muted">
            The form becomes <code>procedure.yaml</code>; the file you pick becomes <code>procedure.py</code>.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="ghost" className="gap-1.5" onPress={loadExample}>
            <Sparkles className="size-3.5" aria-hidden />
            Example
          </Button>
          <Button variant="primary" isDisabled={saving} onPress={() => void save()}>
            {saving ? 'Saving…' : 'Save procedure'}
          </Button>
        </div>
      </header>

      <ScrollShadow className="min-h-0 flex-1 px-6 pb-6">
        <div className="flex max-w-[1100px] flex-col gap-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name" className="sm:col-span-2">
              <Input
                aria-label="Name"
                fullWidth
                value={form.name}
                placeholder="Bootstrap CI of a difference"
                onChange={(event) => {
                  const name = event.target.value;
                  patch({ name, id: form.id || slug(name) });
                }}
              />
            </Field>
            <Field label="Id" hint="The folder name. Lower-case letters, digits, dashes.">
              <Input
                aria-label="Id"
                fullWidth
                value={form.id}
                placeholder="bootstrap-diff"
                onChange={(event) => patch({ id: event.target.value })}
              />
            </Field>
            <Field label="Family" hint="The rail group it sits under.">
              <Input
                aria-label="Family"
                fullWidth
                value={form.family}
                onChange={(event) => patch({ family: event.target.value })}
              />
            </Field>
            <Field label="Summary" className="sm:col-span-2 lg:col-span-3">
              <Input
                aria-label="Summary"
                fullWidth
                value={form.summary}
                placeholder="One line: what the procedure does."
                onChange={(event) => patch({ summary: event.target.value })}
              />
            </Field>
            <Field label="Chart">
              <Select
                label="Chart"
                value={form.chart}
                options={CHARTS}
                onChange={(chart) => patch({ chart })}
                className="w-full"
              />
            </Field>
            <Field label="Data shape" className="lg:col-span-4">
              <Select
                label="Data shape"
                value={form.shape}
                options={SHAPES}
                onChange={(shape) => patch({ shape })}
                className="w-full"
              />
            </Field>
          </section>

          {/* Parameters */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionLabel>Parameters</SectionLabel>
              <span className="text-meta text-muted">Fields under the data, in this order.</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-1.5"
                onPress={() =>
                  patch({
                    params: [
                      ...form.params,
                      {
                        name: '',
                        label: '',
                        type: 'number',
                        value: '',
                        min: '',
                        max: '',
                        step: '',
                        choices: '',
                        hint: '',
                      },
                    ],
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                Add parameter
              </Button>
            </div>

            {form.params.length === 0 && (
              <p className="text-meta text-muted">No parameters: the script runs on the data alone.</p>
            )}

            {form.params.map((parameter, index) => (
              <div
                key={index}
                className="grid items-end gap-2 rounded-2xl bg-surface p-3 sm:grid-cols-2 lg:grid-cols-12"
              >
                <Field label="Key" className="lg:col-span-2">
                  <Cell
                    label={`Parameter ${index + 1} key`}
                    value={parameter.name}
                    placeholder="resamples"
                    onChange={(name) => setParam(index, { name })}
                  />
                </Field>
                <Field label="Label" className="lg:col-span-2">
                  <Cell
                    label={`Parameter ${index + 1} label`}
                    value={parameter.label}
                    placeholder="Resamples"
                    onChange={(label) => setParam(index, { label })}
                  />
                </Field>
                <Field label="Type" className="lg:col-span-2">
                  <Select
                    label={`Parameter ${index + 1} type`}
                    value={parameter.type}
                    options={PARAM_TYPES}
                    onChange={(type) => setParam(index, { type })}
                    className="w-full"
                  />
                </Field>
                {parameter.type === 'boolean' ? (
                  <SwitchRow
                    label="Default on"
                    checked={parameter.value === 'true'}
                    onChange={(on) => setParam(index, { value: String(on) })}
                    className="pb-1.5 lg:col-span-2"
                  />
                ) : parameter.type === 'choice' ? (
                  <Field label="Options" className="lg:col-span-3">
                    <Cell
                      label={`Parameter ${index + 1} options`}
                      value={parameter.choices}
                      placeholder="mean, median"
                      onChange={(choices) => setParam(index, { choices })}
                    />
                  </Field>
                ) : (
                  <Field label="Default" className="lg:col-span-2">
                    <Cell
                      label={`Parameter ${index + 1} default`}
                      type={parameter.type === 'text' ? 'text' : 'number'}
                      value={parameter.value}
                      onChange={(value) => setParam(index, { value })}
                    />
                  </Field>
                )}
                {parameter.type === 'number' || parameter.type === 'integer' ? (
                  <>
                    <Field label="Min" className="lg:col-span-1">
                      <Cell
                        label={`Parameter ${index + 1} minimum`}
                        type="number"
                        value={parameter.min}
                        onChange={(min) => setParam(index, { min })}
                      />
                    </Field>
                    <Field label="Max" className="lg:col-span-1">
                      <Cell
                        label={`Parameter ${index + 1} maximum`}
                        type="number"
                        value={parameter.max}
                        onChange={(max) => setParam(index, { max })}
                      />
                    </Field>
                  </>
                ) : (
                  <Field label={parameter.type === 'choice' ? 'Default' : 'Hint'} className="lg:col-span-2">
                    <Cell
                      label={
                        parameter.type === 'choice'
                          ? `Parameter ${index + 1} default`
                          : `Parameter ${index + 1} hint`
                      }
                      value={parameter.type === 'choice' ? parameter.value : parameter.hint}
                      onChange={(value) =>
                        setParam(index, parameter.type === 'choice' ? { value } : { hint: value })
                      }
                    />
                  </Field>
                )}
                <div className="flex justify-end lg:col-span-1">
                  <IconButton
                    aria-label={`Remove parameter ${index + 1}`}
                    onPress={() => patch({ params: form.params.filter((_, at) => at !== index) })}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            ))}
          </section>

          {/* Outputs */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionLabel>Outputs</SectionLabel>
              <span className="text-meta text-muted">The rows of the result table.</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-1.5"
                onPress={() =>
                  patch({
                    outputs: [...form.outputs, { key: '', label: '', type: 'number', digits: '3' }],
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                Add output
              </Button>
            </div>

            {form.outputs.map((output, index) => (
              <div
                key={index}
                className="grid items-end gap-2 rounded-2xl bg-surface p-3 sm:grid-cols-2 lg:grid-cols-12"
              >
                <Field label="Key" className="lg:col-span-3">
                  <Cell
                    label={`Output ${index + 1} key`}
                    value={output.key}
                    placeholder="difference"
                    onChange={(key) => setOutput(index, { key })}
                  />
                </Field>
                <Field label="Label" className="lg:col-span-3">
                  <Cell
                    label={`Output ${index + 1} label`}
                    value={output.label}
                    placeholder="Difference"
                    onChange={(label) => setOutput(index, { label })}
                  />
                </Field>
                <Field label="Type" className="lg:col-span-3">
                  <Select
                    label={`Output ${index + 1} type`}
                    value={output.type}
                    options={OUTPUT_TYPES}
                    onChange={(type) => setOutput(index, { type })}
                    className="w-full"
                  />
                </Field>
                <Field label="Digits" className="lg:col-span-2">
                  <Cell
                    label={`Output ${index + 1} digits`}
                    type="number"
                    value={output.digits}
                    onChange={(digits) => setOutput(index, { digits })}
                  />
                </Field>
                <div className="flex justify-end lg:col-span-1">
                  <IconButton
                    aria-label={`Remove output ${index + 1}`}
                    onPress={() => patch({ outputs: form.outputs.filter((_, at) => at !== index) })}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            ))}
          </section>

          {/* Assumptions */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionLabel>Assumptions</SectionLabel>
              <span className="text-meta text-muted">Shown above the Run button.</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-1.5"
                onPress={() => patch({ assumptions: [...form.assumptions, { name: '', detail: '' }] })}
              >
                <Plus className="size-3.5" aria-hidden />
                Add assumption
              </Button>
            </div>

            {form.assumptions.map((assumption, index) => (
              <div
                key={index}
                className="grid items-end gap-2 rounded-2xl bg-surface p-3 sm:grid-cols-2 lg:grid-cols-12"
              >
                <Field label="Name" className="lg:col-span-3">
                  <Cell
                    label={`Assumption ${index + 1} name`}
                    value={assumption.name}
                    placeholder="independence"
                    onChange={(name) => setAssumption(index, { name })}
                  />
                </Field>
                <Field label="Detail" className="lg:col-span-8">
                  <Cell
                    label={`Assumption ${index + 1} detail`}
                    value={assumption.detail}
                    placeholder="Units are independent within and between groups."
                    onChange={(detail) => setAssumption(index, { detail })}
                  />
                </Field>
                <div className="flex justify-end lg:col-span-1">
                  <IconButton
                    aria-label={`Remove assumption ${index + 1}`}
                    onPress={() => patch({ assumptions: form.assumptions.filter((_, at) => at !== index) })}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            ))}
          </section>

          {/* The script */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionLabel>Python file</SectionLabel>
              <span className="text-meta text-muted">
                Called with a JSON payload holding <code>{'{ data, params }'}</code>; prints{' '}
                <code>{'{ values, summary, assumptions }'}</code>.
              </span>
              <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-meta text-foreground hover:bg-surface/80 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
                <FileCode2 className="size-3.5" aria-hidden />
                {python ? 'Replace file' : 'Choose .py file'}
                <input
                  type="file"
                  aria-label="Python file"
                  accept=".py,text/x-python,text/plain"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void pickScript(file);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>

            {python ? (
              <div className="rounded-2xl bg-surface p-3">
                <div className="flex items-center gap-2">
                  <FileCode2 className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">{scriptName}</span>
                  <span className="shrink-0 text-meta text-muted">{python.split('\n').length} line(s)</span>
                </div>
                <pre className="mt-2 max-h-32 overflow-hidden text-meta whitespace-pre-wrap text-muted">
                  {python.split('\n').slice(0, 6).join('\n')}
                  {python.split('\n').length > 6 ? '\n…' : ''}
                </pre>
              </div>
            ) : (
              <p className="rounded-2xl bg-surface p-3 text-body text-muted">
                No script selected. Pick the file that computes the procedure; it is copied into{' '}
                <code>.openlab/statistics/</code> with the manifest.
              </p>
            )}
          </section>

          {errors.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-2xl bg-surface p-3">
              {errors.map((error) => (
                <li key={error} className="flex items-start gap-1.5 text-meta text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollShadow>
    </div>
  );
}

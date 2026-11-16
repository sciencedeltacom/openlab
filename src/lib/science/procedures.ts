/**
 * The statistics procedure protocol.
 *
 * A procedure a lab writes itself is a folder in the workspace — `.openlab/statistics/<id>/`
 * — holding two files: `procedure.yaml`, which says what the procedure is, what it needs and
 * what it returns, and `procedure.py`, which computes it. The app builds the form from the
 * YAML, so a new statistic arrives with parameter fields, a result table and a chart without
 * anyone touching the interface.
 *
 * The contract in one paragraph: `procedure.py` is run with one argument, a JSON file holding
 * `{ data, params }`, and prints one JSON object on its last line — `{ values, summary?,
 * assumptions? }`. Nothing is imported and nothing is assumed: the manifest declares every
 * parameter and every output, and a value that is not declared is not shown.
 *
 * `parseManifest` is the trust boundary. Everything from disk goes through it, a manifest
 * that fails is refused with the reason and the line it came from, and only a valid one is
 * turned into a procedure.
 *
 * Pure: no IPC, no React. `scripts/verify-statistics.ts` tests it.
 */

import { parse as parseYaml } from 'yaml';

import type { AssumptionCheck } from './stats';
import type { DataShape } from './dataset';

/** The only protocol version this build reads. */
export const STATISTICS_PROTOCOL = 'openlab.statistics/1';

/** What a parameter can be. */
export type ParameterType = 'number' | 'integer' | 'boolean' | 'choice' | 'text';

/** One field the interface draws for the procedure. */
export interface StatisticParameter {
  /** Snake case, the key the Python receives. */
  name: string;
  label: string;
  type: ParameterType;
  default?: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  /** Required for `choice`; the values must be strings. */
  choices?: string[];
  hint?: string;
}

/** One value the procedure returns, and how to write it. */
export type OutputType = 'number' | 'integer' | 'percent' | 'interval' | 'p' | 'text';

/** One row in the result table. */
export interface StatisticOutput {
  /** The key in the `values` object the script printed. */
  key: string;
  label: string;
  type: OutputType;
  /** Decimal places. Defaults to 3, and 4 for a p-value. */
  digits?: number;
  hint?: string;
}

/** A chart the workbench already knows how to draw. */
export type ChartKind = 'means' | 'scatter' | 'categories' | 'distribution' | 'pvalues' | 'none';

/** One assumption the procedure declares, for the checklist above the Run button. */
export interface DeclaredAssumption {
  name: string;
  detail: string;
}

/** The parsed `procedure.yaml`. */
export interface ProcedureManifest {
  protocol: string;
  id: string;
  name: string;
  /** The rail's group. Defaults to `Custom`. */
  family: string;
  summary: string;
  design?: string;
  data: {
    shape: DataShape;
    /** Column roles the procedure expects, used to preselect the picker. */
    columns?: {
      name: string;
      role: 'value' | 'group' | 'x' | 'y' | 'label' | 'p';
      type?: 'number' | 'text';
    }[];
  };
  params: StatisticParameter[];
  outputs: StatisticOutput[];
  chart: ChartKind;
  assumptions: DeclaredAssumption[];
  /** Optional R that recomputes the same numbers, shown in Reproduce. */
  r?: string;
  /** Where the folder sits, relative to the workspace. Set by the loader, not the file. */
  dir?: string;
  /** The `procedure.py` source, read by the loader. */
  python?: string;
}

/** What reading one manifest produced. */
export type ManifestRead = { ok: true; manifest: ProcedureManifest } | { ok: false; errors: string[] };

/** The shapes a manifest may declare. */
const SHAPES: DataShape[] = ['values', 'groups', 'pairs', 'table', 'pvalues'];
const PARAMETER_TYPES: ParameterType[] = ['number', 'integer', 'boolean', 'choice', 'text'];
const OUTPUT_TYPES: OutputType[] = ['number', 'integer', 'percent', 'interval', 'p', 'text'];
const CHARTS: ChartKind[] = ['means', 'scatter', 'categories', 'distribution', 'pvalues', 'none'];
const ROLES = ['value', 'group', 'x', 'y', 'label', 'p'] as const;

/** Snake case, so the key is a valid Python argument and a valid YAML key. */
const NAME = /^[a-z][a-z0-9_]*$/;

/** A procedure id, as it appears in a path and in a result's `test` field. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Read and validate a manifest.
 *
 * `dir` and `python` are supplied by the loader, never by the file: a manifest cannot say
 * where its own code lives.
 */
export function parseManifest(source: string, options: { dir?: string; python?: string } = {}): ManifestRead {
  const errors: string[] = [];

  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`procedure.yaml is not valid YAML: ${message}`] };
  }

  if (!isRecord(document)) {
    return { ok: false, errors: ['procedure.yaml must be a mapping, not a list or a scalar.'] };
  }

  if (document.protocol !== STATISTICS_PROTOCOL) {
    errors.push(`protocol must be ${STATISTICS_PROTOCOL} (found ${JSON.stringify(document.protocol)}).`);
  }

  const id = text(document.id);
  if (!id) {
    errors.push('id is required.');
  } else if (!ID.test(id)) {
    errors.push('id must be lower-case letters, digits and dashes, e.g. `bootstrap-diff`.');
  }

  const name = text(document.name);
  if (!name) errors.push('name is required.');

  const summary = text(document.summary);
  if (!summary) errors.push('summary is required: one line on what the procedure does.');

  // --- data -------------------------------------------------------------------------------
  const data = isRecord(document.data) ? document.data : undefined;
  if (!data) {
    errors.push('data is required: state the shape of the input and the column roles.');
  }
  const shape = text(data?.shape) as DataShape | undefined;
  if (!shape) {
    errors.push(`data.shape is required, one of ${SHAPES.join(', ')}.`);
  } else if (!SHAPES.includes(shape)) {
    errors.push(`data.shape must be one of ${SHAPES.join(', ')} (found \`${shape}\`).`);
  }

  const columns: NonNullable<ProcedureManifest['data']['columns']> = [];
  if (data?.columns !== undefined) {
    if (!Array.isArray(data.columns)) {
      errors.push('data.columns must be a list.');
    } else {
      data.columns.forEach((entry, index) => {
        if (!isRecord(entry)) {
          errors.push(`data.columns[${index}] must be a mapping with name and role.`);
          return;
        }
        const column = text(entry.name);
        const role = text(entry.role);
        if (!column) errors.push(`data.columns[${index}].name is required.`);
        if (!role || !(ROLES as readonly string[]).includes(role)) {
          errors.push(`data.columns[${index}].role must be one of ${ROLES.join(', ')}.`);
          return;
        }
        const type = text(entry.type);
        if (type !== undefined && type !== 'number' && type !== 'text') {
          errors.push(`data.columns[${index}].type must be number or text.`);
        }
        if (column) {
          columns.push({
            name: column,
            role: role as (typeof ROLES)[number],
            type: type as 'number' | 'text' | undefined,
          });
        }
      });
    }
  }

  // --- parameters -------------------------------------------------------------------------
  const params: StatisticParameter[] = [];
  if (document.params !== undefined) {
    if (!Array.isArray(document.params)) {
      errors.push('params must be a list.');
    } else {
      const seen = new Set<string>();
      document.params.forEach((entry, index) => {
        const at = `params[${index}]`;
        if (!isRecord(entry)) {
          errors.push(`${at} must be a mapping.`);
          return;
        }
        const key = text(entry.name);
        if (!key) {
          errors.push(`${at}.name is required.`);
          return;
        }
        if (!NAME.test(key)) {
          errors.push(`${at}.name must be snake_case (found \`${key}\`).`);
          return;
        }
        if (seen.has(key)) {
          errors.push(`${at}.name repeats \`${key}\`.`);
          return;
        }
        seen.add(key);
        const type = text(entry.type) as ParameterType | undefined;
        if (!type || !PARAMETER_TYPES.includes(type)) {
          errors.push(`${at}.type must be one of ${PARAMETER_TYPES.join(', ')}.`);
          return;
        }
        const fallback = text(entry.default);
        const parameter: StatisticParameter = {
          name: key,
          label: text(entry.label) ?? key.replace(/_/g, ' '),
          type,
          hint: text(entry.hint),
        };
        if (type === 'number' || type === 'integer') {
          parameter.min = finite(entry.min);
          parameter.max = finite(entry.max);
          parameter.step = finite(entry.step);
          parameter.default = finite(entry.default) ?? (type === 'integer' ? 0 : 0);
        } else if (type === 'boolean') {
          parameter.default = typeof entry.default === 'boolean' ? entry.default : false;
        } else if (type === 'choice') {
          const choices = Array.isArray(entry.choices)
            ? entry.choices.flatMap((choice) => (typeof choice === 'string' ? [choice] : []))
            : [];
          if (choices.length === 0) {
            errors.push(`${at}.choices must list at least one option for a choice parameter.`);
          }
          parameter.choices = choices;
          parameter.default =
            typeof entry.default === 'string' && choices.includes(entry.default)
              ? entry.default
              : (choices[0] ?? '');
        } else {
          parameter.default = typeof entry.default === 'string' ? entry.default : (fallback ?? '');
        }
        params.push(parameter);
      });
    }
  }

  // --- outputs ----------------------------------------------------------------------------
  const outputs: StatisticOutput[] = [];
  if (!Array.isArray(document.outputs) || document.outputs.length === 0) {
    errors.push('outputs must list at least one value the script returns.');
  } else {
    const seen = new Set<string>();
    document.outputs.forEach((entry, index) => {
      const at = `outputs[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${at} must be a mapping.`);
        return;
      }
      const key = text(entry.key);
      if (!key) {
        errors.push(`${at}.key is required.`);
        return;
      }
      if (seen.has(key)) {
        errors.push(`${at}.key repeats \`${key}\`.`);
        return;
      }
      seen.add(key);
      const type = text(entry.type) as OutputType | undefined;
      if (!type || !OUTPUT_TYPES.includes(type)) {
        errors.push(`${at}.type must be one of ${OUTPUT_TYPES.join(', ')}.`);
        return;
      }
      const digits = finite(entry.digits);
      if (digits !== undefined && (digits < 0 || digits > 8)) {
        errors.push(`${at}.digits must be between 0 and 8.`);
      }
      outputs.push({
        key,
        label: text(entry.label) ?? key.replace(/_/g, ' '),
        type,
        digits: digits !== undefined ? Math.round(digits) : undefined,
        hint: text(entry.hint),
      });
    });
  }

  // --- the rest ---------------------------------------------------------------------------
  const chart = text(document.chart) as ChartKind | undefined;
  if (chart !== undefined && !CHARTS.includes(chart)) {
    errors.push(`chart must be one of ${CHARTS.join(', ')}.`);
  }

  const assumptions: DeclaredAssumption[] = [];
  if (document.assumptions !== undefined) {
    if (!Array.isArray(document.assumptions)) {
      errors.push('assumptions must be a list.');
    } else {
      document.assumptions.forEach((entry, index) => {
        if (!isRecord(entry) || !text(entry.name)) {
          errors.push(`assumptions[${index}] must have a name.`);
          return;
        }
        assumptions.push({
          name: text(entry.name)!,
          detail: text(entry.detail) ?? '',
        });
      });
    }
  }

  if (options.dir && !options.python) {
    errors.push('procedure.py is missing next to procedure.yaml.');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: {
      protocol: STATISTICS_PROTOCOL,
      id: id!,
      name: name!,
      family: text(document.family) ?? 'Custom',
      summary: summary!,
      design: text(document.design),
      data: { shape: shape!, columns: columns.length > 0 ? columns : undefined },
      params,
      outputs,
      chart: chart ?? 'none',
      assumptions,
      r: text(document.r),
      dir: options.dir,
      python: options.python,
    },
  };
}

/** The parameter values a fresh selection starts with. */
export function defaultParams(manifest: ProcedureManifest): Record<string, string | number | boolean> {
  return Object.fromEntries(manifest.params.map((parameter) => [parameter.name, parameter.default ?? '']));
}

/** A parameter's value read back to the type the script expects. */
export function readParam(
  parameter: StatisticParameter,
  value: string | number | boolean | undefined,
): string | number | boolean {
  if (parameter.type === 'number' || parameter.type === 'integer') {
    const numeric = typeof value === 'number' ? value : Number(value);
    const clamped = Number.isFinite(numeric) ? numeric : Number(parameter.default ?? 0);
    const bounded = Math.min(
      parameter.max ?? Number.POSITIVE_INFINITY,
      Math.max(parameter.min ?? Number.NEGATIVE_INFINITY, clamped),
    );
    return parameter.type === 'integer' ? Math.round(bounded) : bounded;
  }
  if (parameter.type === 'boolean') return value === true;
  if (parameter.type === 'choice') {
    return typeof value === 'string' && parameter.choices?.includes(value)
      ? value
      : String(parameter.default ?? parameter.choices?.[0] ?? '');
  }
  return typeof value === 'string' ? value : String(parameter.default ?? '');
}

/** The workspace folder a procedure lives in. */
export const STATISTICS_DIR = '.openlab/statistics';

/** The two files a procedure is. */
export const MANIFEST_FILE = 'procedure.yaml';
export const CODE_FILE = 'procedure.py';

/** The path a procedure's code runs from. */
export function codePath(dir: string): string {
  return `${dir}/${CODE_FILE}`;
}

/** A manifest that every workspace can start from: real, runnable, and small. */
export function procedureTemplate(): { yaml: string; python: string } {
  return {
    yaml: `protocol: openlab.statistics/1
id: bootstrap-diff
name: Bootstrap CI of a mean difference
family: Custom
summary: Resample two groups and report the difference of means with a percentile interval.
design: >
  Two independent groups. The bootstrap assumes the observations are exchangeable within
  their group; it makes no normality assumption, so it is the honest choice for a small or
  skewed sample.
data:
  shape: groups
  columns:
    - { name: group, role: group, type: text }
    - { name: value, role: value, type: number }
params:
  - { name: resamples, type: integer, default: 5000, min: 100, max: 100000, label: Resamples }
  - { name: statistic, type: choice, choices: [mean, median], default: mean, label: Statistic }
  - { name: confidence, type: number, default: 0.95, min: 0.5, max: 0.999, step: 0.01, label: Confidence }
outputs:
  - { key: difference, label: Difference, type: number, digits: 3 }
  - { key: low, label: Interval low, type: number, digits: 3 }
  - { key: high, label: Interval high, type: number, digits: 3 }
  - { key: n_a, label: Group A n, type: integer, digits: 0 }
  - { key: n_b, label: Group B n, type: integer, digits: 0 }
chart: means
assumptions:
  - { name: independence, detail: Units are independent within and between groups. }
  - { name: sample size, detail: The interval is unstable below about ten observations per group. }
`,
    python: `"""Bootstrap a difference of means. Reads the payload path from argv[1]."""

import json
import random
import sys


def statistic(values, kind):
    if kind == "median":
        ordered = sorted(values)
        middle = len(ordered) // 2
        return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return sum(values) / len(values)


def main():
    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)

    groups = [group for group in payload["data"]["blocks"] if group]
    if len(groups) < 2:
        raise SystemExit("Two groups are needed: a group column, or a blank line between groups.")

    params = payload["params"]
    kind = params["statistic"]
    resamples = int(params["resamples"])
    confidence = float(params["confidence"])
    a, b = groups[0], groups[1]
    observed = statistic(b, kind) - statistic(a, kind)

    rng = random.Random(0)
    draws = []
    for _ in range(resamples):
        sample_a = [rng.choice(a) for _ in a]
        sample_b = [rng.choice(b) for _ in b]
        draws.append(statistic(sample_b, kind) - statistic(sample_a, kind))
    draws.sort()
    tail = (1 - confidence) / 2
    low = draws[max(0, int(tail * len(draws)) - 1)]
    high = draws[min(len(draws) - 1, int((1 - tail) * len(draws)))]

    print(json.dumps({
        "values": {
            "difference": observed,
            "low": low,
            "high": high,
            "n_a": len(a),
            "n_b": len(b),
        },
        "summary": f"{kind} difference {observed:.3f} [{low:.3f}, {high:.3f}] over {resamples} resamples",
    }))


if __name__ == "__main__":
    main()
`,
  };
}

/** The values object a script printed, found on the last line that parses. */
export function readScriptOutput(
  output: string,
): { values: Record<string, unknown>; summary?: string; assumptions?: AssumptionCheck[] } | null {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || !parsed.values || typeof parsed.values !== 'object') {
        continue;
      }
      const assumptions = Array.isArray(parsed.assumptions)
        ? parsed.assumptions.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const check = entry as Record<string, unknown>;
            const status = check.status;
            if (
              typeof check.name !== 'string' ||
              (status !== 'pass' && status !== 'warn' && status !== 'fail' && status !== 'skipped')
            ) {
              return [];
            }
            return [
              {
                name: check.name,
                status: status as AssumptionCheck['status'],
                detail: typeof check.detail === 'string' ? check.detail : '',
              },
            ];
          })
        : [];
      return {
        values: parsed.values as Record<string, unknown>,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
        assumptions,
      };
    } catch {
      // Not this line; keep looking for the object the script printed last.
    }
  }
  return null;
}

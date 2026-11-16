/**
 * The fields a procedure's manifest declares.
 *
 * A custom procedure states its parameters in YAML, and this is the only place that turns
 * them into controls. Nothing is inferred: a parameter that is not declared has no field, and
 * a value the field cannot produce is not offered to the script.
 */

import { Input, NumberInput, Select, SwitchRow } from '@/components/ui';
import type { StatisticParameter } from '@/lib/science/procedures';

/** One labelled row. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </div>
  );
}

export function ParameterPanel({
  params,
  values,
  onChange,
}: {
  params: readonly StatisticParameter[];
  values: Record<string, string | number | boolean>;
  onChange: (name: string, value: string | number | boolean) => void;
}) {
  if (params.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {params.map((parameter) => {
        const value = values[parameter.name];
        if (parameter.type === 'boolean') {
          return (
            <SwitchRow
              key={parameter.name}
              label={parameter.label}
              hint={parameter.hint}
              checked={value === true}
              onChange={(checked) => onChange(parameter.name, checked)}
              className="rounded-2xl bg-surface px-3 py-2.5"
            />
          );
        }
        if (parameter.type === 'choice') {
          return (
            <Field key={parameter.name} label={parameter.label} hint={parameter.hint}>
              <Select
                label={parameter.label}
                value={String(value ?? '')}
                options={(parameter.choices ?? []).map((choice) => ({ value: choice, label: choice }))}
                onChange={(next) => onChange(parameter.name, next)}
                className="w-full"
              />
            </Field>
          );
        }
        if (parameter.type === 'number' || parameter.type === 'integer') {
          return (
            <Field key={parameter.name} label={parameter.label} hint={parameter.hint}>
              <NumberInput
                fullWidth
                label={parameter.label}
                value={typeof value === 'number' ? value : Number(value) || undefined}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step ?? (parameter.type === 'integer' ? 1 : 0.01)}
                onChange={(next) => onChange(parameter.name, next ?? (parameter.default as number))}
              />
            </Field>
          );
        }
        return (
          <Field key={parameter.name} label={parameter.label} hint={parameter.hint}>
            <Input
              fullWidth
              aria-label={parameter.label}
              value={String(value ?? '')}
              onChange={(event) => onChange(parameter.name, event.target.value)}
            />
          </Field>
        );
      })}
    </div>
  );
}

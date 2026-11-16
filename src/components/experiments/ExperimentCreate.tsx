/**
 * Create an experiment.
 *
 * A page, not a modal: a pre-registered question is more than four fields, and the domain shapes
 * what "design" means here. Everything the run needs — the question, the hypothesis, the design
 * and the checks planned before it ran — is stated once, then the record page takes over for the
 * criterion, the trials and the outcome.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Play } from 'lucide-react';

import { Button, Input, ScrollShadow, SectionLabel, Select, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useApp } from '@/store/app';
import type { FieldDef } from './experiments';
import { addExperiment, newExperiment, useDomains } from './store';

/** A labelled field. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-foreground">{label}</span>
      {children}
      {hint && <span className="text-meta text-muted">{hint}</span>}
    </label>
  );
}

/** One field the chosen domain declares. */
function DomainField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (next: string) => void;
}) {
  if (field.kind === 'select' && field.options) {
    return (
      <Field label={field.label} hint={field.help}>
        <Select
          value={value || field.options[0]!}
          options={field.options.map((option) => ({ value: option, label: option }))}
          onChange={onChange}
        />
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.help}>
      <Input
        type={field.kind === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.unit ? `in ${field.unit}` : undefined}
      />
    </Field>
  );
}

export function ExperimentCreate() {
  const { dispatch } = useApp();
  const domains = useDomains();
  const leave = () => dispatch({ type: 'route/go', route: 'analyze/experiments' });

  const [domainId, setDomainId] = useState('');
  const [objective, setObjective] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [design, setDesign] = useState('');
  const [designKind, setDesignKind] = useState('');
  const [checks, setChecks] = useState('');
  const [designSpec, setDesignSpec] = useState<Record<string, string>>({});

  const domain = domains.find((candidate) => candidate.id === domainId);

  const create = () => {
    if (!objective.trim()) {
      return;
    }
    const experiment = newExperiment({
      domainId: domainId || undefined,
      objective: objective.trim(),
      hypothesis: hypothesis.trim(),
      design: design.trim(),
      designKind: designKind.trim() || domain?.name || '',
      checks: checks
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      designSpec,
    });
    addExperiment(experiment);
    dispatch({ type: 'route/go', route: `analyze/experiments/${experiment.id}` });
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Experiments
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">New experiment</h1>
          <p className="max-w-[70ch] text-body text-muted">
            State the question and the design. The success criterion is fixed before anything runs.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>The question</SectionLabel>
          <Field
            label="Domain"
            hint="A domain adds its own design and trial fields. Define one from the ledger."
          >
            <Select
              value={domainId}
              options={[
                { value: '', label: 'No domain' },
                ...domains.map((item) => ({ value: item.id, label: item.name })),
              ]}
              onChange={(value) => {
                setDomainId(value);
                setDesignSpec({});
              }}
            />
          </Field>
          <Field label="What are you testing?">
            <TextArea
              rows={2}
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Beat AUROC 0.71 on the frozen holdout by adding chromatin signal."
            />
          </Field>
          <Field label="Hypothesis">
            <TextArea
              rows={2}
              value={hypothesis}
              onChange={(event) => setHypothesis(event.target.value)}
              placeholder="What you expect, and why."
            />
          </Field>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>The design</SectionLabel>
          <Field label="How it will be run">
            <TextArea
              rows={3}
              value={design}
              onChange={(event) => setDesign(event.target.value)}
              placeholder="The design, the controls, the splits."
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Design kind" hint="A short facet label, e.g. Model comparison.">
              <Input
                value={designKind}
                onChange={(event) => setDesignKind(event.target.value)}
                placeholder={domain?.name || 'optional'}
              />
            </Field>
            <Field label="Planned checks" hint="One per line; fixed before the run.">
              <TextArea
                rows={2}
                value={checks}
                onChange={(event) => setChecks(event.target.value)}
                placeholder={'Calibration curve\nPer-guide AUROC'}
              />
            </Field>
          </div>

          {domain && domain.fields.design.length > 0 && (
            <div className="flex flex-col gap-4 border-t border-separator pt-4">
              <span className="text-label text-foreground">{domain.name} fields</span>
              <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2')}>
                {domain.fields.design.map((field) => (
                  <DomainField
                    key={field.key}
                    field={field}
                    value={designSpec[field.key] ?? ''}
                    onChange={(value) => setDesignSpec((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <footer className="flex items-center justify-end gap-2">
          <Button variant="ghost" onPress={leave}>
            Cancel
          </Button>
          <Button variant="primary" className="gap-1.5" isDisabled={!objective.trim()} onPress={create}>
            <Play className="size-3.5" />
            Create experiment
          </Button>
        </footer>
      </div>
    </ScrollShadow>
  );
}

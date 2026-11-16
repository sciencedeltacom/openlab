/**
 * Create a systematic review.
 *
 * One page to state the whole protocol before the model starts: the question, the criteria,
 * where to look, how much to read, how deep to go, and which model should do it. Pressing Start
 * searches the sources, screens and extracts the records, writes the report, and drops the reader
 * into the review's workspace with the work already done.
 *
 * It is a page, not a modal: a protocol is more than four fields, and the run deserves the room
 * to say what it is doing.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Play, Plus } from 'lucide-react';

import { Button, Input, NumberInput, ScrollShadow, SectionLabel, Select, TextArea } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ReviewInputs } from '@/lib/literature/pipeline';
import { startReview } from '@/lib/literature/runner';
import { useApp } from '@/store/app';
import { allProviders } from '@/store/types';
import { useSources } from '@/hooks/useSources';

const DEPTHS: { value: ReviewInputs['depth']; label: string }[] = [
  { value: 'quick', label: 'Quick: screen on titles and abstracts' },
  { value: 'standard', label: 'Standard: screen and extract the key fields' },
  { value: 'thorough', label: 'Thorough: extract every field and check the tail' },
];

const ANALYSES = [
  'Narrative synthesis',
  'Risk of bias',
  'Quantitative pooling',
  'Evidence gaps',
  'Recommendations',
];

const FORMATS = [
  { value: 'narrative', label: 'Narrative review' },
  { value: 'prisma', label: 'PRISMA-style' },
  { value: 'concise', label: 'Concise brief' },
];

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

export function ReviewCreate() {
  const { state, dispatch } = useApp();
  const leave = () => dispatch({ type: 'route/go', route: 'literature-reviews' });

  const savedSources = useSources();
  const modelOptions = useMemo(
    () =>
      allProviders(state).flatMap((provider) =>
        provider.models.map((model) => ({
          value: `${provider.id}/${model.id}`,
          label: `${provider.label} · ${model.id}`,
        })),
      ),
    [state],
  );

  const [question, setQuestion] = useState('');
  const [inclusion, setInclusion] = useState('');
  const [exclusion, setExclusion] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [sources, setSources] = useState<Set<string>>(
    new Set(savedSources.slice(0, 3).map((source) => source.id)),
  );
  const [maxRecords, setMaxRecords] = useState(24);
  const [depth, setDepth] = useState<ReviewInputs['depth']>('standard');
  const [analysis, setAnalysis] = useState<Set<string>>(new Set(['Narrative synthesis', 'Evidence gaps']));
  const [format, setFormat] = useState('narrative');
  const [modelRef, setModelRef] = useState(state.modelRef);
  const [error, setError] = useState<string | null>(null);

  const toggle = (set: Set<string>, value: string, on: boolean): Set<string> => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  /**
   * Start the run in the background and go back to the list.
   *
   * The review does not need the page open: the runner keeps going and the Reviews list shows
   * the phase it is in. That is also why this navigates immediately rather than waiting.
   */
  const start = () => {
    if (!question.trim()) {
      setError('State the review question.');
      return;
    }
    if (sources.size === 0) {
      setError('Choose at least one source.');
      return;
    }
    setError(null);
    startReview(
      { ...state, modelRef },
      {
        question,
        inclusion,
        exclusion,
        dateRange,
        sources: [...sources],
        maxRecords,
        depth,
        analysis: [...analysis],
        format,
      },
    );
    dispatch({ type: 'route/go', route: 'literature-reviews' });
  };

  return (
    <ScrollShadow className="h-full">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-7 py-7">
        <header className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-fit gap-1.5" onPress={leave}>
            <ArrowLeft className="size-3.5" />
            Reviews
          </Button>
          <h1 className="text-[1.5rem] font-semibold text-foreground">New review</h1>
          <p className="max-w-[70ch] text-body text-muted">
            The run continues in the background; the finished review opens with the work done.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>The question</SectionLabel>
          <Field label="What are you reviewing?">
            <TextArea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Does chromatin accessibility improve off-target prediction?"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Inclusion criteria">
              <TextArea
                rows={3}
                value={inclusion}
                onChange={(event) => setInclusion(event.target.value)}
                placeholder="What a record must report to be eligible"
              />
            </Field>
            <Field label="Exclusion criteria">
              <TextArea
                rows={3}
                value={exclusion}
                onChange={(event) => setExclusion(event.target.value)}
                placeholder="What rules a record out"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Date range">
              <Input
                value={dateRange}
                onChange={(event) => setDateRange(event.target.value)}
                placeholder="2015 – 2026"
              />
            </Field>
            <Field label="Record limit" hint="How many records to retrieve and screen.">
              <NumberInput
                label="Record limit"
                min={4}
                max={60}
                value={maxRecords}
                onChange={(next) => setMaxRecords(Math.max(4, Math.min(60, next ?? 24)))}
                fullWidth
              />
            </Field>
            <Field label="Depth">
              <Select
                value={depth}
                options={DEPTHS}
                onChange={(value) => setDepth(value as ReviewInputs['depth'])}
              />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <div className="flex items-center gap-2">
            <SectionLabel>Sources</SectionLabel>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1.5"
              onPress={() => dispatch({ type: 'route/go', route: 'library/sources/new' })}
            >
              <Plus className="size-3.5" />
              New source
            </Button>
          </div>
          {savedSources.length === 0 ? (
            <p className="text-body text-muted">
              No sources yet. A source is a saved question against a database. Create one, then pick it here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedSources.map((source) => {
                const on = sources.has(source.id);
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSources((current) => toggle(current, source.id, !on))}
                    className={cn(
                      'rounded-full px-3 py-1 text-body transition-colors',
                      on
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-surface-secondary text-muted hover:text-foreground',
                    )}
                  >
                    {source.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-3xl bg-surface p-5">
          <SectionLabel>Analysis and report</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {ANALYSES.map((item) => {
              const on = analysis.has(item);
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAnalysis((current) => toggle(current, item, !on))}
                  className={cn(
                    'rounded-full px-3 py-1 text-body transition-colors',
                    on
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-surface-secondary text-muted hover:text-foreground',
                  )}
                >
                  {item}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Report format">
              <Select value={format} options={FORMATS} onChange={setFormat} />
            </Field>
            <Field label="AI model">
              <Select
                value={modelRef}
                options={modelOptions}
                onChange={setModelRef}
                placeholder="Choose a model"
              />
            </Field>
          </div>
        </section>

        {error && <p className="rounded-2xl bg-danger-soft p-3 text-body text-danger">{error}</p>}

        <footer className="flex items-center justify-end gap-2">
          <Button variant="ghost" onPress={leave}>
            Cancel
          </Button>
          <Button variant="primary" className="gap-1.5" isDisabled={!question.trim()} onPress={start}>
            <Play className="size-3.5" />
            Start review
          </Button>
        </footer>
      </div>
    </ScrollShadow>
  );
}

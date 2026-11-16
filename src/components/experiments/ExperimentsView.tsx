/**
 * The experiment ledger.
 *
 * Cards, not a table: an experiment carries a question, a criterion fixed in advance and a
 * lesson, and a row of columns makes a reader scroll sideways to find them. Grouping is by
 * outcome, so the settled and the still-running work never share a heading.
 *
 * The ledger and its domains are the live store; the filter is the tracker's, one facet per tab.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  CircleDot,
  Compass,
  Copy,
  ExternalLink,
  Filter,
  FlaskConical,
  Layers,
  Lightbulb,
  ListChecks,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  X,
} from 'lucide-react';

import { Button, Chip, Dialog, Input, Label, Popover, ScrollShadow, Tabs, TextArea } from '@/components/ui';
import { ChoiceModal, RenameModal, RowMenu, type RowAction } from '@/components/common/RowMenu';
import { pathFor } from '@/app/routes';
import { cn } from '@/lib/cn';
import { useApp, usePageTitle } from '@/store/app';
import { MOTION } from '@/theme/tokens';
import {
  OUTCOME_META,
  OUTCOMES,
  type Experiment,
  type ExperimentDomain,
  type ExperimentOutcome,
  type FieldDef,
  type FieldKind,
} from './experiments';
import {
  addDomain,
  duplicateExperiment,
  patchExperiment,
  removeExperiment,
  useDomains,
  useExperiments,
} from './store';

/** The facet tabs the filter popover offers. */
const FACETS = ['outcome', 'domain'] as const;
type Facet = (typeof FACETS)[number];

const FACET_LABEL: Record<Facet, string> = { outcome: 'Outcome', domain: 'Domain' };

/** The narrowing lists, each an OR within its facet. */
interface Facets {
  outcome: ExperimentOutcome[];
  domainId: string[];
}

const EMPTY_FACETS: Facets = { outcome: [], domainId: [] };

/** The checkbox mark that says whether a row is on. Tone, not a border. */
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded',
        on ? 'bg-accent text-accent-foreground' : 'bg-surface-tertiary',
      )}
      aria-hidden
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** One pick in a facet. */
function FacetRow({
  on,
  mark,
  label,
  onPress,
}: {
  on: boolean;
  mark?: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface',
        on && 'bg-surface',
      )}
    >
      {mark}
      <span className="min-w-0 flex-1 truncate text-body text-foreground">{label}</span>
      <CheckMark on={on} />
    </button>
  );
}

/** The outcome's icon on its tint. */
function OutcomeMark({ outcome }: { outcome: ExperimentOutcome }) {
  const meta = OUTCOME_META[outcome];
  const Icon = meta.icon;
  return (
    <span className={cn('grid size-5 shrink-0 place-items-center rounded-md', meta.chip)}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** The criterion, as one line. */
function criterionText(experiment: Experiment): string {
  const criterion = experiment.criterion;
  if (!criterion) {
    return 'No criterion set';
  }
  const threshold = Array.isArray(criterion.threshold) ? criterion.threshold.join('–') : criterion.threshold;
  return `${criterion.metric} ${criterion.comparator} ${threshold}${criterion.unit ? ` ${criterion.unit}` : ''}`;
}

/** One labelled fact on a card. */
function CardFact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-meta text-muted">{label}</span>
        <span className="block text-body text-foreground">{children}</span>
      </span>
    </div>
  );
}

/** One experiment, as the ledger card draws it. The whole card is the target. */
function ExperimentCard({
  experiment,
  onOpen,
  actions,
}: {
  experiment: Experiment;
  onOpen: () => void;
  actions: RowAction[];
}) {
  const { state } = useApp();
  const domains = useDomains();
  const domain = domains.find((candidate) => candidate.id === experiment.domainId);
  const meta = OUTCOME_META[experiment.outcome];

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration.panel, ease: MOTION.signature }}
      className="group relative flex flex-col gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-secondary"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${experiment.id}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />

      <header className="flex flex-wrap items-center gap-2">
        <OutcomeMark outcome={experiment.outcome} />
        <span className="text-meta tabular-nums text-muted">{experiment.id}</span>
        {domain ? (
          <Chip size="sm" variant="soft" color="default">
            {domain.name}
          </Chip>
        ) : (
          experiment.designKind && (
            <Chip size="sm" variant="soft" color="default">
              {experiment.designKind}
            </Chip>
          )
        )}
        <span className="ml-auto text-meta text-muted">{meta.label}</span>
        <span className="relative z-10">
          <RowMenu label={`Actions for ${experiment.id}`} actions={actions} />
        </span>
      </header>

      <p className="max-w-[92ch] text-body text-foreground">
        {experiment.objective || 'Untitled experiment'}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardFact icon={<Compass className="size-3.5" />} label="Hypothesis">
          {experiment.hypothesis || '—'}
        </CardFact>
        <CardFact icon={<Target className="size-3.5" />} label="Criterion">
          {criterionText(experiment)}
        </CardFact>
        <CardFact icon={<ListChecks className="size-3.5" />} label="Planned checks">
          {experiment.checks.join(' · ') || '—'}
        </CardFact>
        <CardFact icon={<Lightbulb className="size-3.5" />} label="Lesson">
          {experiment.lesson || '—'}
        </CardFact>
      </div>

      <footer className="flex flex-wrap items-center gap-3 text-meta text-muted">
        <span className="flex items-center gap-1.5">
          <FlaskConical className="size-3.5" aria-hidden />
          {experiment.trials.length} trials
        </span>
        <span className="truncate">{experiment.design}</span>
      </footer>
    </motion.article>
  );
}

/** A small headline number above the list. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="text-meta text-muted">{label}</div>
      <div className="text-title tabular-nums text-foreground">{value}</div>
    </div>
  );
}

/** The domain editor: name, summary, and its fields as `key | label | kind` lines. */
function NewDomainDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [design, setDesign] = useState('');
  const [trial, setTrial] = useState('');
  const [metrics, setMetrics] = useState('');

  const parse = (text: string, offset: number): FieldDef[] =>
    text
      .split('\n')
      .map((line, index) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [key, label, kind, options] = line.split('|').map((part) => part.trim());
        const resolvedKey = key || `field-${offset + index + 1}`;
        const resolvedKind = (
          ['text', 'number', 'select', 'tags'].includes(kind ?? '') ? kind : 'text'
        ) as FieldKind;
        return {
          key: resolvedKey,
          label: label || resolvedKey,
          kind: resolvedKind,
          ...(resolvedKind === 'select' && options
            ? { options: options.split(',').map((option) => option.trim()) }
            : {}),
        };
      });

  const submit = () => {
    if (!name.trim()) {
      return;
    }
    const domain: ExperimentDomain = {
      id: `domain-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      summary: summary.trim(),
      mark: 'check',
      builtIn: false,
      fields: { design: parse(design, 0), trial: parse(trial, 100), metrics: parse(metrics, 200) },
    };
    addDomain(domain);
    onClose();
  };

  return (
    <Dialog
      open={open}
      title="New domain"
      description="A domain is your own set of fields. Design fields shape the experiment; trial fields shape each run."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!name.trim()} onPress={submit}>
            Create domain
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Name</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Genomics, ML, Wet lab"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Summary</Label>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="One line on what this domain studies"
        />
      </label>
      {[
        { label: 'Design fields', value: design, set: setDesign, placeholder: 'dataset | Dataset | text' },
        { label: 'Trial fields', value: trial, set: setTrial, placeholder: 'seed | Seed | number' },
        { label: 'Metric names', value: metrics, set: setMetrics, placeholder: 'auroc | AUROC | number' },
      ].map((entry) => (
        <label key={entry.label} className="flex flex-col gap-1.5">
          <Label className="text-label">{entry.label}</Label>
          <TextArea
            rows={3}
            value={entry.value}
            onChange={(event) => entry.set(event.target.value)}
            placeholder={`key | label | kind, one per line\n${entry.placeholder}`}
          />
        </label>
      ))}
    </Dialog>
  );
}

/**
 * The experiment ledger.
 *
 * Search over the question and the lesson, a facet popover over outcome and domain, then the
 * cards grouped by outcome with a sticky heading.
 */
export function ExperimentsView() {
  usePageTitle('Experiments');
  const { dispatch } = useApp();
  const experiments = useExperiments();
  const domains = useDomains();
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [facet, setFacet] = useState<Facet>('outcome');
  const [renaming, setRenaming] = useState<Experiment | null>(null);
  const [outcomeTarget, setOutcomeTarget] = useState<Experiment | null>(null);
  const [creatingDomain, setCreatingDomain] = useState(false);

  const open = (id: string) =>
    dispatch({ type: 'route/go', route: pathFor('analyze/experiments/:experimentId', { experimentId: id }) });

  const actionsFor = (experiment: Experiment): RowAction[] => [
    { id: 'open', label: 'View details', icon: ExternalLink, onSelect: () => open(experiment.id) },
    { id: 'rename', label: 'Rename objective…', icon: Pencil, onSelect: () => setRenaming(experiment) },
    {
      id: 'outcome',
      label: 'Change outcome…',
      icon: CircleDot,
      onSelect: () => setOutcomeTarget(experiment),
    },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => duplicateExperiment(experiment.id) },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => removeExperiment(experiment.id),
    },
  ];

  const activeCount = facets.outcome.length + facets.domainId.length;
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () =>
      experiments.filter((experiment) => {
        if (facets.outcome.length > 0 && !facets.outcome.includes(experiment.outcome)) {
          return false;
        }
        if (
          facets.domainId.length > 0 &&
          !(experiment.domainId && facets.domainId.includes(experiment.domainId))
        ) {
          return false;
        }
        if (!needle) {
          return true;
        }
        return [
          experiment.id,
          experiment.objective,
          experiment.hypothesis,
          experiment.design,
          experiment.checks.join(' '),
          experiment.outcomeSummary,
          experiment.lesson,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      }),
    [experiments, facets, needle],
  );

  const groups = OUTCOMES.map((outcome) => ({
    outcome,
    items: matches.filter((experiment) => experiment.outcome === outcome),
  })).filter((group) => group.items.length > 0);

  const trialCount = experiments.reduce((total, experiment) => total + experiment.trials.length, 0);
  const running = experiments.filter((experiment) => experiment.outcome === 'running').length;

  return (
    <ScrollShadow className="h-full px-7 pb-9 pt-6">
      <div className="flex w-full flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Experiments" value={experiments.length} />
          <Stat label="Running" value={running} />
          <Stat label="Trials logged" value={trialCount} />
          <Stat label="Domains" value={domains.length} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex w-full max-w-sm items-center">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the objective, hypothesis or lesson"
              aria-label="Search experiments"
              className="w-full pl-9"
            />
          </div>

          <Popover
            trigger={
              <Button size="sm" variant={activeCount > 0 ? 'secondary' : 'ghost'} className="gap-1.5">
                <Filter className="size-3.5" />
                Filter
                {activeCount > 0 && <Chip size="sm">{activeCount}</Chip>}
              </Button>
            }
            className="w-[280px]"
          >
            <Tabs selectedKey={facet} onSelectionChange={(key) => setFacet(key as Facet)}>
              <Tabs.ListContainer className="mx-1 mt-1">
                <Tabs.List aria-label="Filter experiments">
                  {FACETS.map((id) => (
                    <Tabs.Tab key={id} id={id}>
                      {FACET_LABEL[id]}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="outcome">
                <ScrollShadow className="max-h-[300px] px-1">
                  {OUTCOMES.map((outcome) => (
                    <FacetRow
                      key={outcome}
                      on={facets.outcome.includes(outcome)}
                      mark={<OutcomeMark outcome={outcome} />}
                      label={OUTCOME_META[outcome].label}
                      onPress={() =>
                        setFacets((current) => ({ ...current, outcome: toggleIn(current.outcome, outcome) }))
                      }
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>

              <Tabs.Panel id="domain">
                <ScrollShadow className="max-h-[300px] px-1">
                  {domains.map((domain) => (
                    <FacetRow
                      key={domain.id}
                      on={facets.domainId.includes(domain.id)}
                      mark={
                        <span className="grid size-5 shrink-0 place-items-center">
                          <Layers className="size-4 text-muted" aria-hidden />
                        </span>
                      }
                      label={domain.name}
                      onPress={() =>
                        setFacets((current) => ({
                          ...current,
                          domainId: toggleIn(current.domainId, domain.id),
                        }))
                      }
                    />
                  ))}
                </ScrollShadow>
              </Tabs.Panel>
            </Tabs>

            <footer className="flex items-center gap-2 px-2 pb-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                isDisabled={activeCount === 0}
                onPress={() => setFacets(EMPTY_FACETS)}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                Clear all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto gap-1.5"
                onPress={() => setCreatingDomain(true)}
              >
                <Plus className="size-3.5" />
                New domain
              </Button>
            </footer>
          </Popover>

          <Button
            size="sm"
            variant="primary"
            className="ml-auto gap-1.5"
            onPress={() => dispatch({ type: 'route/go', route: 'analyze/experiments/new' })}
          >
            <Plus className="size-3.5" />
            New experiment
          </Button>
        </div>

        {matches.length === 0 && (
          <div className="grid place-items-center rounded-2xl bg-surface py-16 text-center">
            <div>
              <ListChecks className="mx-auto size-5 text-muted" aria-hidden />
              <p className="mt-2 text-body text-muted">
                {experiments.length === 0
                  ? 'No experiments yet. Start one and it will appear here.'
                  : 'No experiment matches the current filter.'}
              </p>
            </div>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.outcome} className="flex flex-col gap-2">
            <header className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background/90 px-1 py-1.5 backdrop-blur">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-label',
                  OUTCOME_META[group.outcome].chip,
                )}
              >
                <OutcomeMark outcome={group.outcome} />
                {OUTCOME_META[group.outcome].label}
              </span>
              <span className="text-meta tabular-nums text-muted">{group.items.length}</span>
            </header>
            <div className="flex flex-col gap-3">
              {group.items.map((experiment) => (
                <ExperimentCard
                  key={experiment.id}
                  experiment={experiment}
                  actions={actionsFor(experiment)}
                  onOpen={() => open(experiment.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {matches.length > 0 && (
          <p className="text-meta text-muted">
            Showing {matches.length} of {experiments.length} experiments.
          </p>
        )}

        <RenameModal
          open={renaming !== null}
          title="Rename objective"
          label="Objective"
          value={renaming?.objective ?? ''}
          onClose={() => setRenaming(null)}
          onSubmit={(objective) => {
            if (renaming) patchExperiment(renaming.id, { objective });
          }}
        />

        {outcomeTarget && (
          <ChoiceModal
            open
            title="Change outcome"
            label="Outcome"
            value={outcomeTarget.outcome}
            options={OUTCOMES.map((outcome) => ({ value: outcome, label: OUTCOME_META[outcome].label }))}
            onClose={() => setOutcomeTarget(null)}
            onSubmit={(outcome) => patchExperiment(outcomeTarget.id, { outcome })}
          />
        )}

        <NewDomainDialog open={creatingDomain} onClose={() => setCreatingDomain(false)} />
      </div>
    </ScrollShadow>
  );
}

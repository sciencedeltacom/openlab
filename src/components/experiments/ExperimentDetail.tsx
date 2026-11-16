/**
 * An experiment's page.
 *
 * The objective leads, the hypothesis sits under it, and then the design, the criterion fixed
 * before it ran, the trials, the outcome with its evidence and the lesson follow in the order a
 * reader checks them. Everything here is edited in place and written to the ledger store; the
 * criterion, once frozen, keeps a reason for every later change.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  CircleDot,
  Compass,
  Layers,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Target,
  TestTubes,
  Trash2,
  X,
} from 'lucide-react';

import {
  Button,
  Chip,
  Dialog,
  IconButton,
  Input,
  Label,
  NumberInput,
  Select,
  TextArea,
} from '@/components/ui';
import { RowMenu, type RowAction } from '@/components/common/RowMenu';
import { paths } from '@/app/routes';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { useApp, usePageTitle } from '@/store/app';
import { memberById } from '@/store/research';
import { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from '@/components/research/PageShell';
import {
  OUTCOME_META,
  OUTCOMES,
  STAGES,
  STAGE_META,
  type Criterion,
  type EvidenceFact,
  type Experiment,
  type ExperimentOutcome,
  type ExperimentStage,
  type FieldDef,
  type Trial,
} from './experiments';
import {
  domainById,
  lockPreregistration,
  patchExperiment,
  recordDeviation,
  removeExperiment,
  useExperiments,
  verifyExperiment,
} from './store';
import {
  PREREG_TESTS,
  preregistrationReport,
  type DeviationPhase,
  type PreregistrationPlan,
} from './preregistration';

/** The HeroUI chip colour each outcome reads as. */
const OUTCOME_COLOR = {
  running: 'accent',
  supported: 'success',
  refuted: 'danger',
  inconclusive: 'warning',
} as const;

/** The criterion, as one line. */
function criterionText(criterion: Criterion | undefined): string {
  if (!criterion) {
    return 'No criterion set';
  }
  const threshold = Array.isArray(criterion.threshold) ? criterion.threshold.join('–') : criterion.threshold;
  return `${criterion.metric} ${criterion.comparator} ${threshold}${criterion.unit ? ` ${criterion.unit}` : ''}`;
}

/** One section of the record body. */
function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="section-label">{title}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** One value the domain declares, shown as a labelled fact. */
function domainValues(experiment: Experiment, fields: FieldDef[]): { label: string; value: string }[] {
  return fields
    .map((field) => ({ label: field.label, value: String(experiment.designSpec?.[field.key] ?? '') }))
    .filter((entry) => entry.value.length > 0);
}

/** The trial table: one island, a header row, no rules between rows. Each row can be removed. */
function TrialTable({ trials, onRemove }: { trials: Trial[]; onRemove: (index: number) => void }) {
  const template = '4rem minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) auto';
  return (
    <div className="overflow-hidden rounded-2xl bg-surface-secondary p-3">
      <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: template }}>
        <div className="contents">
          {['Run', 'Condition', 'Metric', 'Result', ''].map((column, index) => (
            <div key={index} className="section-label">
              {column}
            </div>
          ))}
        </div>
        {trials.map((trial, index) => (
          <div key={`${trial.run}-${index}`} className="contents">
            <div className="text-meta tabular-nums text-muted">{trial.run}</div>
            <div className="text-body text-foreground">{trial.condition}</div>
            <div className="text-body text-muted">{trial.metric}</div>
            <div className="text-body tabular-nums text-foreground">{trial.result}</div>
            <IconButton aria-label={`Remove ${trial.run}`} onPress={() => onRemove(index)}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The plan a reader locks before the data is looked at. */
function PreregistrationDialog({
  open,
  experiment,
  onClose,
  onLocked,
}: {
  open: boolean;
  experiment: Experiment;
  onClose: () => void;
  onLocked: () => void;
}) {
  const { state } = useApp();
  const by = state.members[0]?.id ?? 'you';
  const [form, setForm] = useState<PreregistrationPlan>({
    hypothesis: experiment.hypothesis,
    primaryOutcome: '',
    test: 'welch-t-test',
    alpha: 0.05,
    alternative: 'two-sided',
    exclusions: '',
    stoppingRule: '',
    analysisNotes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({ ...current, hypothesis: experiment.hypothesis }));
  }, [open, experiment.hypothesis]);

  const set = <K extends keyof PreregistrationPlan>(key: K, value: PreregistrationPlan[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const ready =
    form.hypothesis.trim().length > 0 &&
    form.primaryOutcome.trim().length > 0 &&
    form.test.trim().length > 0 &&
    form.alpha > 0 &&
    form.alpha < 1;

  const lock = async () => {
    if (!ready) return;
    setBusy(true);
    const updated = await lockPreregistration(experiment.id, form, by);
    setBusy(false);
    if (!updated) {
      notify('This experiment already has a locked plan', { tone: 'warning' });
      onClose();
      return;
    }
    notify('Pre-registration locked', {
      description: 'The hypothesis and the analysis plan are now fixed. Record a deviation if one is needed.',
      tone: 'success',
    });
    onLocked();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Lock a pre-registration"
      description="Decide these before looking at the results. The plan is signed when you lock it, and later changes are recorded as deviations."
      width={680}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!ready || busy} onPress={() => void lock()}>
            Lock the plan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <Label>Hypothesis</Label>
          <TextArea
            rows={3}
            value={form.hypothesis}
            onChange={(event) => set('hypothesis', (event.target as HTMLTextAreaElement).value)}
            aria-label="Hypothesis"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <Label>Primary outcome</Label>
            <Input
              value={form.primaryOutcome}
              placeholder="e.g. change in AUROC"
              onChange={(event) => set('primaryOutcome', (event.target as HTMLInputElement).value)}
              aria-label="Primary outcome"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Procedure</Label>
            <Select
              value={form.test}
              options={PREREG_TESTS.map((test) => ({ value: test, label: test }))}
              onChange={(value) => set('test', value)}
              aria-label="Procedure"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Alpha</Label>
            <NumberInput
              label="Alpha"
              value={form.alpha}
              min={0.001}
              max={0.5}
              step={0.005}
              onChange={(value) => set('alpha', value ?? 0.05)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Side</Label>
            <Select
              value={form.alternative}
              options={[
                { value: 'two-sided', label: 'Two-sided' },
                { value: 'greater', label: 'Greater' },
                { value: 'less', label: 'Less' },
              ]}
              onChange={(value) => set('alternative', value as PreregistrationPlan['alternative'])}
              aria-label="Side of the test"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <Label>Exclusions</Label>
          <TextArea
            rows={2}
            value={form.exclusions}
            placeholder="Which rows, subjects or runs are left out, and by what rule"
            onChange={(event) => set('exclusions', (event.target as HTMLTextAreaElement).value)}
            aria-label="Exclusions"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Stopping rule</Label>
          <TextArea
            rows={2}
            value={form.stoppingRule}
            placeholder="What would stop the run early"
            onChange={(event) => set('stoppingRule', (event.target as HTMLTextAreaElement).value)}
            aria-label="Stopping rule"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Other decisions</Label>
          <TextArea
            rows={2}
            value={form.analysisNotes}
            placeholder="Covariates, transformations, multiple-comparison correction…"
            onChange={(event) => set('analysisNotes', (event.target as HTMLTextAreaElement).value)}
            aria-label="Other decisions"
          />
        </label>
      </div>
    </Dialog>
  );
}

/** One decision made after the plan, with when it was made and why. */
function DeviationDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (decision: string, reason: string, phase: DeviationPhase) => void;
}) {
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<DeviationPhase>('after-results');
  const ready = decision.trim().length > 0 && reason.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record a deviation"
      description="Say what changed from the plan and why. The report keeps the decision and whether it was made before or after the results."
      width={560}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={!ready}
            onPress={() => {
              onSubmit(decision.trim(), reason.trim(), phase);
              setDecision('');
              setReason('');
              onClose();
            }}
          >
            Record it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <Label>Decision</Label>
          <Input
            value={decision}
            placeholder="e.g. test: welch-t-test → one-way-anova"
            onChange={(event) => setDecision((event.target as HTMLInputElement).value)}
            aria-label="Decision"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>Reason</Label>
          <TextArea
            rows={3}
            value={reason}
            onChange={(event) => setReason((event.target as HTMLTextAreaElement).value)}
            aria-label="Reason"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Label>When</Label>
          <Select
            value={phase}
            options={[
              { value: 'before-results', label: 'Before seeing the results' },
              { value: 'after-results', label: 'After seeing the results' },
            ]}
            onChange={(value) => setPhase(value as DeviationPhase)}
            aria-label="When the decision was made"
          />
        </label>
      </div>
    </Dialog>
  );
}

/** The record body, keyed by id so it re-reads when another experiment is opened. */
function ExperimentDetailBody({ experiment }: { experiment: Experiment }) {
  const { state, dispatch } = useApp();
  usePageTitle(experiment.id);
  const domain = domainById(experiment.domainId);
  const meta = OUTCOME_META[experiment.outcome];
  const OutcomeIcon = meta.icon;
  const stage = STAGE_META[experiment.stage];
  const StageIcon = stage.icon;
  const taskLinks = experiment.links.filter((link) => link.kind === 'task');

  const [trialTarget, setTrialTarget] = useState<Trial | null>(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [criterionOpen, setCriterionOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [preregOpen, setPreregOpen] = useState(false);
  const [deviationOpen, setDeviationOpen] = useState(false);
  const [integrity, setIntegrity] = useState<'none' | 'intact' | 'changed'>('none');
  const author = state.members[0]?.id ?? 'you';
  const prereg = experiment.preregistration;

  // A plan that no longer matches its signature is a fact the reader needs, not a detail.
  useEffect(() => {
    let alive = true;
    void verifyExperiment(experiment.id).then((value) => {
      if (alive) setIntegrity(value);
    });
    return () => {
      alive = false;
    };
  }, [experiment.preregistration]);

  const patch = (next: Partial<Experiment>) => patchExperiment(experiment.id, next);

  const pageActions: RowAction[] = [
    {
      id: 'trial',
      label: 'Log a trial…',
      icon: Plus,
      onSelect: () => {
        setTrialTarget(null);
        setTrialOpen(true);
      },
    },
    { id: 'evidence', label: 'Add evidence…', icon: TestTubes, onSelect: () => setEvidenceOpen(true) },
    { id: 'criterion', label: 'Edit criterion…', icon: Target, onSelect: () => setCriterionOpen(true) },
    {
      id: 'prereg',
      label: prereg ? 'Record a deviation…' : 'Lock a pre-registration…',
      icon: LockKeyhole,
      onSelect: () => (prereg ? setDeviationOpen(true) : setPreregOpen(true)),
    },
    { id: 'lesson', label: 'Edit lesson…', icon: Lightbulb, onSelect: () => setLessonOpen(true) },
    { id: 'stage', label: 'Change stage…', icon: CircleDot, onSelect: () => setStageOpen(true) },
    { id: 'outcome', label: 'Change outcome…', icon: Activity, onSelect: () => setOutcomeOpen(true) },
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        removeExperiment(experiment.id);
        dispatch({ type: 'route/go', route: 'analyze/experiments' });
      },
    },
  ];

  const saveTrial = (trial: Trial) => {
    const trials = trialTarget
      ? experiment.trials.map((entry) => (entry === trialTarget ? trial : entry))
      : [...experiment.trials, trial];
    patch({
      trials,
      outcome: 'running',
      stage: experiment.stage === 'settled' ? 'running' : experiment.stage,
    });
  };

  return (
    <RecordPage
      eyebrow={
        <div className="flex w-full items-center gap-2">
          <span className="section-label">Experiment</span>
          <span className="text-meta tabular-nums text-muted">{experiment.id}</span>
          {domain && <span className="text-meta text-muted">{domain.name}</span>}
          <RowMenu label={`Actions for ${experiment.id}`} actions={pageActions} always className="ml-auto" />
        </div>
      }
      title={experiment.objective || 'Untitled experiment'}
      status={
        <div className="flex items-center gap-1.5">
          <Chip size="sm" variant="soft" color={OUTCOME_COLOR[experiment.outcome]}>
            <OutcomeIcon className="size-3" aria-hidden />
            {meta.label}
          </Chip>
          <Chip size="sm" variant="soft" color="default">
            <StageIcon className="size-3" aria-hidden />
            {stage.label}
          </Chip>
        </div>
      }
      lede={
        <p className="max-w-[70ch] text-body text-muted">{experiment.hypothesis || 'No hypothesis yet.'}</p>
      }
      aside={
        <FactGroup>
          <Fact icon={Activity} label="Outcome">
            {meta.label}
          </Fact>
          <Fact icon={CircleDot} label="Stage">
            {stage.label}
          </Fact>
          {domain && (
            <Fact icon={Layers} label="Domain">
              {domain.name}
            </Fact>
          )}
          <Fact icon={TestTubes} label="Trials">
            <span className="tabular-nums">{experiment.trials.length}</span>
          </Fact>
        </FactGroup>
      }
    >
      <Block title="Design and criterion">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <Compass className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-meta text-muted">Design</span>
              <span className="block text-body text-foreground">{experiment.design || '—'}</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Target className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-meta text-muted">
                Success criterion {experiment.criterion?.frozenAt ? '· frozen' : '· not yet frozen'}
              </span>
              <span className="block text-body text-foreground">{criterionText(experiment.criterion)}</span>
            </span>
          </div>
          <div className="flex items-start gap-2">
            <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block text-meta text-muted">Planned checks</span>
              <span className="block text-body text-foreground">{experiment.checks.join(' · ') || '—'}</span>
            </span>
          </div>
        </div>

        {domain && domain.fields.design.length > 0 && (
          <div className="grid grid-cols-2 gap-3 border-t border-separator pt-3">
            {domainValues(experiment, domain.fields.design).map((entry) => (
              <div key={entry.label} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-meta text-muted">{entry.label}</span>
                <span className="truncate text-body text-foreground">{entry.value}</span>
              </div>
            ))}
          </div>
        )}

        {experiment.criterion && experiment.criterion.changes.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-separator pt-3">
            <span className="text-meta text-muted">Criterion changes</span>
            {experiment.criterion.changes.map((change, index) => (
              <span key={index} className="text-meta text-muted">
                {change.field}: {change.from} → {change.to}. {change.reason}
              </span>
            ))}
          </div>
        )}
      </Block>

      <Block
        title="Pre-registration"
        action={
          <span className="flex items-center gap-1">
            {prereg && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  void navigator.clipboard
                    .writeText(preregistrationReport(experiment.id, experiment.hypothesis, prereg, integrity))
                    .then(() =>
                      notify('Deviation report copied', {
                        description: 'The plan, its signature and every deviation, as Markdown.',
                        tone: 'success',
                      }),
                    )
                    .catch(() => notify('The report could not be copied', { tone: 'danger' }));
                }}
              >
                Copy report
              </Button>
            )}
            <Button
              size="sm"
              variant={prereg ? 'ghost' : 'secondary'}
              className="gap-1.5"
              onPress={() => (prereg ? setDeviationOpen(true) : setPreregOpen(true))}
            >
              <LockKeyhole className="size-3.5" />
              {prereg ? 'Record a deviation' : 'Lock a plan'}
            </Button>
          </span>
        }
      >
        {!prereg ? (
          <p className="max-w-[80ch] text-body text-muted">
            No plan locked. The plan is signed when you lock it, and later changes are recorded as deviations.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Outcome', prereg.primaryOutcome],
                ['Procedure', prereg.test],
                ['Alpha', String(prereg.alpha)],
                ['Side', prereg.alternative],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-meta text-muted">{label}</span>
                  <span className="truncate text-body text-foreground">{value || '—'}</span>
                </div>
              ))}
            </div>
            {[
              ['Exclusions', prereg.exclusions],
              ['Stopping rule', prereg.stoppingRule],
              ['Other decisions', prereg.analysisNotes],
            ]
              .filter(([, value]) => value.trim().length > 0)
              .map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-meta text-muted">{label}</span>
                  <span className="text-body text-foreground">{value}</span>
                </div>
              ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-separator pt-3 text-meta text-muted">
              <Chip size="sm" variant="soft" color={integrity === 'changed' ? 'danger' : 'success'}>
                {integrity === 'changed' ? (
                  <ShieldAlert className="size-3" aria-hidden />
                ) : (
                  <ShieldCheck className="size-3" aria-hidden />
                )}
                {integrity === 'changed' ? 'signature does not match' : 'signed'}
              </Chip>
              <span>
                Locked {relativeTime(prereg.lockedAt)} by{' '}
                {memberById(state.members, prereg.lockedBy)?.name ?? prereg.lockedBy}
              </span>
              <span className="truncate font-mono">{prereg.hash.slice(0, 12)}…</span>
            </div>
            {integrity === 'changed' && (
              <p className="text-meta text-danger">
                This plan no longer hashes to the value written when it was locked. Treat every result as
                exploratory until that is explained.
              </p>
            )}
            <div className="flex flex-col gap-1 border-t border-separator pt-3">
              <span className="text-meta text-muted">Deviations ({prereg.deviations.length})</span>
              {prereg.deviations.length === 0 ? (
                <p className="text-body text-muted">None recorded. The analysis follows the plan.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {prereg.deviations.map((deviation) => (
                    <li key={deviation.id} className="flex flex-wrap items-baseline gap-2 text-meta">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={deviation.phase === 'after-results' ? 'warning' : 'default'}
                      >
                        {deviation.phase === 'after-results' ? 'after results' : 'before results'}
                      </Chip>
                      <span className="text-foreground">{deviation.decision}</span>
                      <span className="text-muted">{deviation.reason}</span>
                      <span className="text-muted">{relativeTime(deviation.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Block>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="section-label">Trials</span>
          <span className="text-meta tabular-nums text-muted">{experiment.trials.length} runs</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5"
            onPress={() => {
              setTrialTarget(null);
              setTrialOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Log a trial
          </Button>
        </div>
        {experiment.trials.length === 0 ? (
          <p className="text-body text-muted">No trials logged yet.</p>
        ) : (
          <TrialTable
            trials={experiment.trials}
            onRemove={(index) => {
              const trials = experiment.trials.filter((_, position) => position !== index);
              patch({ trials });
            }}
          />
        )}
      </section>

      <Block
        title="Outcome"
        action={
          <Button size="sm" variant="ghost" className="gap-1.5" onPress={() => setEvidenceOpen(true)}>
            <Plus className="size-3.5" />
            Add evidence
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="max-w-[80ch] text-body text-foreground">
            {experiment.outcomeSummary || 'No outcome recorded yet.'}
          </p>
          <div className="flex flex-col gap-2">
            {experiment.evidence.map((entry, index) => (
              <div key={`${entry.label}-${index}`} className="flex items-baseline gap-3">
                <span className="w-48 shrink-0 text-meta text-muted">{entry.label}</span>
                <span className="min-w-0 flex-1 text-body tabular-nums text-foreground">
                  {entry.value}
                  {entry.unit ? ` ${entry.unit}` : ''}
                  {entry.uncertainty ? ` (${entry.uncertainty})` : ''}
                </span>
                <IconButton
                  aria-label={`Remove ${entry.label}`}
                  onPress={() =>
                    patch({ evidence: experiment.evidence.filter((_, position) => position !== index) })
                  }
                >
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block title="Lesson">
        <p className="max-w-[80ch] text-body text-foreground">
          {experiment.lesson || 'No lesson recorded yet.'}
        </p>
      </Block>

      {taskLinks.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="section-label">Provenance</span>
          <div className="flex flex-col gap-1">
            {taskLinks.map((link) => (
              <RecordLink
                key={link.refId}
                route={paths.task(link.refId)}
                className="flex w-full items-center gap-2 rounded-2xl bg-surface p-3 transition-colors hover:bg-surface-tertiary"
              >
                <ListChecks className="size-3.5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-foreground">
                  {link.label || link.refId}
                </span>
                <span className="shrink-0 text-meta text-muted">Task</span>
              </RecordLink>
            ))}
          </div>
        </section>
      )}

      <TrialDialog
        open={trialOpen}
        trial={trialTarget}
        fields={domain?.fields.trial ?? []}
        onClose={() => setTrialOpen(false)}
        onSubmit={(trial) => {
          saveTrial(trial);
          setTrialOpen(false);
        }}
      />
      <EvidenceDialog
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        onSubmit={(fact) => {
          patch({ evidence: [...experiment.evidence, fact] });
          setEvidenceOpen(false);
        }}
      />
      <CriterionDialog
        open={criterionOpen}
        criterion={experiment.criterion}
        onClose={() => setCriterionOpen(false)}
        onSubmit={(criterion) => {
          patch({ criterion });
          setCriterionOpen(false);
        }}
      />
      <LessonDialog
        open={lessonOpen}
        value={experiment.lesson}
        onClose={() => setLessonOpen(false)}
        onSubmit={(lesson) => {
          patch({ lesson });
          setLessonOpen(false);
        }}
      />
      {stageOpen && (
        <ChoiceModalish
          title="Change stage"
          label="Stage"
          value={experiment.stage}
          options={STAGES.map((value) => ({ value, label: STAGE_META[value].label }))}
          onClose={() => setStageOpen(false)}
          onSubmit={(value) => {
            patch({ stage: value as ExperimentStage });
            setStageOpen(false);
          }}
        />
      )}
      <PreregistrationDialog
        open={preregOpen}
        experiment={experiment}
        onClose={() => setPreregOpen(false)}
        onLocked={() => {
          void verifyExperiment(experiment.id).then(setIntegrity);
        }}
      />
      <DeviationDialog
        open={deviationOpen}
        onClose={() => setDeviationOpen(false)}
        onSubmit={(decision, reason, phase) => {
          recordDeviation(experiment.id, { decision, reason, phase, by: author });
          notify('Deviation recorded', {
            description: 'It appears in the pre-registration report with its timing.',
            tone: 'success',
          });
        }}
      />
      {outcomeOpen && (
        <ChoiceModalish
          title="Change outcome"
          label="Outcome"
          value={experiment.outcome}
          options={OUTCOMES.map((value) => ({ value, label: OUTCOME_META[value].label }))}
          onClose={() => setOutcomeOpen(false)}
          onSubmit={(value) => {
            if (!experiment.preregistration) {
              notify('Lock a pre-registration before recording an outcome', { tone: 'warning' });
              setOutcomeOpen(false);
              setPreregOpen(true);
              return;
            }
            patch({ outcome: value as ExperimentOutcome });
            setOutcomeOpen(false);
          }}
        />
      )}
    </RecordPage>
  );
}

/** A small choice dialog, kept local so the record does not import the common one just for two. */
function ChoiceModalish({
  title,
  label,
  value,
  options,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [choice, setChoice] = useState(value);
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => onSubmit(choice)}>
            Save
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">{label}</Label>
        <Select value={choice} options={options} onChange={setChoice} />
      </label>
    </Dialog>
  );
}

/** The trial form, with the domain's own trial fields. */
function TrialDialog({
  open,
  trial,
  fields,
  onClose,
  onSubmit,
}: {
  open: boolean;
  trial: Trial | null;
  fields: FieldDef[];
  onClose: () => void;
  onSubmit: (trial: Trial) => void;
}) {
  const [run, setRun] = useState(trial?.run ?? '');
  const [condition, setCondition] = useState(trial?.condition ?? '');
  const [metric, setMetric] = useState(trial?.metric ?? '');
  const [result, setResult] = useState(trial?.result ?? '');
  const [params, setParams] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.key] = String(trial?.params?.[field.key] ?? '');
    }
    return initial;
  });

  const submit = () => {
    onSubmit({
      run: run.trim() || `T${Date.now() % 1000}`,
      condition: condition.trim(),
      metric: metric.trim(),
      result: result.trim(),
      status: 'done',
      params: Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '')),
    });
  };

  return (
    <Dialog
      open={open}
      title={trial ? `Edit ${trial.run}` : 'Log a trial'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={submit}>
            Save trial
          </Button>
        </>
      }
    >
      {[
        { label: 'Run', value: run, set: setRun, placeholder: 'T3' },
        { label: 'Condition', value: condition, set: setCondition, placeholder: 'What was varied' },
        { label: 'Metric', value: metric, set: setMetric, placeholder: 'What was measured' },
        { label: 'Result', value: result, set: setResult, placeholder: 'What came back' },
      ].map((entry) => (
        <label key={entry.label} className="flex flex-col gap-1.5">
          <Label className="text-label">{entry.label}</Label>
          <Input
            value={entry.value}
            onChange={(event) => entry.set(event.target.value)}
            placeholder={entry.placeholder}
          />
        </label>
      ))}
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-1.5">
          <Label className="text-label">{field.label}</Label>
          <Input
            type={field.kind === 'number' ? 'number' : 'text'}
            value={params[field.key] ?? ''}
            onChange={(event) => setParams((current) => ({ ...current, [field.key]: event.target.value }))}
            placeholder={field.unit ? `in ${field.unit}` : undefined}
          />
        </label>
      ))}
    </Dialog>
  );
}

/** The evidence form. */
function EvidenceDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (fact: EvidenceFact) => void;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  return (
    <Dialog
      open={open}
      title="Add evidence"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={!label.trim()}
            onPress={() =>
              onSubmit({
                label: label.trim(),
                value: value.trim(),
                unit: unit.trim() || undefined,
                uncertainty: uncertainty.trim() || undefined,
              })
            }
          >
            Add
          </Button>
        </>
      }
    >
      {[
        { label: 'Label', value: label, set: setLabel, placeholder: 'AUROC (holdout v3)' },
        { label: 'Value', value, set: setValue, placeholder: '0.81' },
        { label: 'Unit', value: unit, set: setUnit, placeholder: 'optional' },
        { label: 'Uncertainty', value: uncertainty, set: setUncertainty, placeholder: '±0.03 or 95% CI …' },
      ].map((entry) => (
        <label key={entry.label} className="flex flex-col gap-1.5">
          <Label className="text-label">{entry.label}</Label>
          <Input
            value={entry.value}
            onChange={(event) => entry.set(event.target.value)}
            placeholder={entry.placeholder}
          />
        </label>
      ))}
    </Dialog>
  );
}

/** The criterion form. A change after freezing records its reason. */
function CriterionDialog({
  open,
  criterion,
  onClose,
  onSubmit,
}: {
  open: boolean;
  criterion: Criterion | undefined;
  onClose: () => void;
  onSubmit: (criterion: Criterion) => void;
}) {
  const [metric, setMetric] = useState(criterion?.metric ?? '');
  const [comparator, setComparator] = useState<Criterion['comparator']>(criterion?.comparator ?? '>=');
  const [threshold, setThreshold] = useState(
    String(criterion && !Array.isArray(criterion.threshold) ? criterion.threshold : ''),
  );
  const [unit, setUnit] = useState(criterion?.unit ?? '');
  const [reason, setReason] = useState('');

  const submit = () => {
    const frozenAt = criterion?.frozenAt ?? Date.now();
    const changes = criterion?.changes ? [...criterion.changes] : [];
    if (criterion && (criterion.metric !== metric || String(criterion.threshold) !== threshold)) {
      changes.push({
        at: Date.now(),
        field: 'criterion',
        from: criterionText(criterion),
        to: `${metric} ${comparator} ${threshold}`.trim(),
        reason: reason.trim() || 'Reason not stated',
      });
    }
    onSubmit({
      metric: metric.trim(),
      comparator,
      threshold: Number(threshold) || 0,
      unit: unit.trim() || undefined,
      frozenAt,
      frozenBy: 'user',
      changes,
    });
  };

  return (
    <Dialog
      open={open}
      title={criterion ? 'Edit criterion' : 'Set criterion'}
      description={
        criterion
          ? 'Changing a frozen criterion is kept with its reason.'
          : 'Fixed before the run, so the outcome cannot move the goalposts.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" isDisabled={!metric.trim()} onPress={submit}>
            Save
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Metric</Label>
        <Input value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="AUROC" />
      </label>
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Comparator</Label>
        <Select
          value={comparator}
          options={['>=', '>', '<=', '<', '=', 'in range'].map((value) => ({ value, label: value }))}
          onChange={(value) => setComparator(value as Criterion['comparator'])}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Threshold</Label>
        <NumberInput
          label="Threshold"
          step={0.01}
          value={threshold ? Number(threshold) : undefined}
          onChange={(next) => setThreshold(next === undefined ? '' : String(next))}
          fullWidth
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <Label className="text-label">Unit</Label>
        <Input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="optional" />
      </label>
      {criterion?.frozenAt && (
        <label className="flex flex-col gap-1.5">
          <Label className="text-label">Reason for the change</Label>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why the criterion moved"
          />
        </label>
      )}
    </Dialog>
  );
}

/** The lesson form. */
function LessonDialog({
  open,
  value,
  onClose,
  onSubmit,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onSubmit: (lesson: string) => void;
}) {
  const [lesson, setLesson] = useState(value);
  return (
    <Dialog
      open={open}
      title="Edit lesson"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => onSubmit(lesson)}>
            Save
          </Button>
        </>
      }
    >
      <TextArea
        rows={4}
        value={lesson}
        onChange={(event) => setLesson(event.target.value)}
        placeholder="What this experiment taught"
      />
    </Dialog>
  );
}

/** An experiment's page; an unknown id gets the shared not-found state. */
export function ExperimentDetail({ experimentId }: { experimentId: string }) {
  const experiments = useExperiments();
  const experiment = useMemo(
    () => experiments.find((entry) => entry.id === experimentId),
    [experiments, experimentId],
  );
  if (!experiment) {
    return <RecordMissing what="experiment" back="analyze/experiments" backLabel="Experiments" />;
  }
  return <ExperimentDetailBody key={experiment.id} experiment={experiment} />;
}

/**
 * What a tab is called.
 *
 * The route carries an id, not a name, and a tab has to read like the thing it holds. The
 * lists are already in memory — the app state for the workspace's own records, and a store
 * each for the ledger, the figures and the catalogue — so the chromes resolve them once per
 * change instead of asking every screen to announce its own title.
 *
 * A record whose list neither chrome can read (a recipe, a connector) falls back to its kind
 * while it is closed, and to the page's own announced name while it is open.
 */

import { useMemo } from 'react';

import { pathFor, paths } from '@/app/routes';
import { BUILTIN_SCIENCE_SKILLS } from '@/lib/science/skills';
import { useDatabases } from '@/components/databases/store';
import { useExperiments } from '@/components/experiments/store';
import { useFigures } from '@/components/figures/store';
import { REVIEWS } from '@/components/literature/data';
import { useReviews } from '@/components/literature/store';
import { useSources } from '@/hooks/useSources';
import { useApp } from '@/store/app';

/** The name behind every path a tab can hold. */
export function useTabTitles(): Map<string, string> {
  const { state } = useApp();
  const experiments = useExperiments();
  const figures = useFigures();
  const databases = useDatabases();
  const sources = useSources();
  // The review list is a module array that the store mutates; the count is what says it moved.
  const reviews = useReviews();

  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const task of state.tasks) titles.set(paths.task(task.id), task.title);
    for (const wave of state.waves) titles.set(paths.wave(wave.id), wave.name);
    for (const job of state.jobs) titles.set(paths.job(job.id), job.name);
    for (const target of state.targets) titles.set(paths.target(target.id), target.name);
    for (const session of state.sessions) titles.set(paths.session(session.id), session.title);
    for (const result of state.results) titles.set(paths.result(result.id), result.name);
    for (const view of state.views) titles.set(paths.view(view.id), view.name);
    for (const experiment of experiments) {
      titles.set(
        pathFor('analyze/experiments/:experimentId', { experimentId: experiment.id }),
        experiment.objective,
      );
    }
    for (const figure of figures) titles.set(paths.figure(figure.id), figure.caption);
    for (const database of databases) titles.set(paths.database(database.id), database.name);
    for (const source of sources) titles.set(paths.source(source.id), source.name);
    for (const review of REVIEWS) {
      titles.set(pathFor('literature-reviews/:reviewId', { reviewId: review.id }), review.short);
    }
    for (const skill of BUILTIN_SCIENCE_SKILLS) {
      titles.set(pathFor('skills/:skillId', { skillId: skill.id }), skill.name);
    }
    return titles;
  }, [
    state.tasks,
    state.waves,
    state.jobs,
    state.targets,
    state.sessions,
    state.results,
    state.views,
    experiments,
    figures,
    databases,
    sources,
    reviews,
  ]);
}

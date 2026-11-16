/**
 * The research tracker's screens.
 *
 * One import path for the surfaces the screen registry mounts, so a route never has to
 * know which file a view lives in.
 */

export { TaskList } from './TaskList';
export { TaskBoard } from './TaskBoard';
export { TaskTimeline } from './TaskTimeline';
export { WaveList } from './WaveList';
export { WaveCreate } from './WaveCreate';
export { IntakeView } from './IntakeView';
export { AnalyticsView } from './AnalyticsView';
export { InboxView } from './InboxView';
export { MyWorkView } from './MyWorkView';

export { TaskDetail } from './TaskDetail';
export { WaveDetail } from './WaveDetail';
export { Fact, FactGroup, RecordLink, RecordMissing, RecordPage } from './PageShell';

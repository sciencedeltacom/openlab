/**
 * The compute section's built pages.
 *
 * The overview and the autoresearch guide are still spec-backed, so only the ledger and the
 * target list need code. This host is the one place the registry asks for them, which keeps
 * `index.tsx` to two lines even though the section has four record-bearing routes.
 */

import { JobDetail } from '@/components/jobs/JobDetail';
import { JobsView } from '@/components/jobs/JobsView';
import { TargetCreate } from '@/components/targets/TargetCreate';
import { TargetDetail } from '@/components/targets/TargetDetail';
import { TargetsView } from '@/components/targets/TargetsView';

/** The compute routes this host owns. The overview and guide stay on the spec path. */
export const COMPUTE_PATTERNS = new Set([
  'compute/jobs',
  'compute/jobs/:jobId',
  'compute/targets',
  'compute/targets/new',
  'compute/targets/:targetId',
]);

/** Render a compute route this host owns. */
export function ComputeHost({ pattern, params }: { pattern: string; params: Record<string, string> }) {
  switch (pattern) {
    case 'compute/jobs':
      return <JobsView />;
    case 'compute/jobs/:jobId':
      return <JobDetail jobId={params.jobId} />;
    case 'compute/targets':
      return <TargetsView />;
    case 'compute/targets/new':
      return <TargetCreate />;
    case 'compute/targets/:targetId':
      return <TargetDetail targetId={params.targetId} />;
    default:
      return null;
  }
}

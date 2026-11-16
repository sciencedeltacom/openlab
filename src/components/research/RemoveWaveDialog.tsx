/**
 * Removing a wave asks first, and says what happens to its work.
 *
 * A wave is a window, not the tasks inside it: removing one leaves every task in the tracker
 * and clears the wave it belonged to. Saying that before the removal is the difference between
 * a decision and an accident. Both the list and the wave's page open this one dialog.
 */

import { Button, Dialog } from '@/components/ui';
import { notify } from '@/lib/toast';
import { useApp } from '@/store/app';
import type { Wave } from '@/store/research';

export function RemoveWaveDialog({
  wave,
  onClose,
  onRemoved,
}: {
  /** The wave being removed, or `null` when the dialog is closed. */
  wave: Wave | null;
  onClose: () => void;
  /** Called after the wave is gone, so a page that was showing it can leave. */
  onRemoved?: () => void;
}) {
  const { state, dispatch } = useApp();
  const tasks = wave ? state.tasks.filter((task) => task.waveId === wave.id) : [];

  return (
    <Dialog
      open={wave !== null}
      onClose={onClose}
      width={460}
      title={wave ? `Remove wave W${wave.number}?` : 'Remove wave?'}
      description={wave?.name}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              if (!wave) {
                return;
              }
              // The tasks outlive the window; only the wave reference goes.
              tasks.forEach((task) => dispatch({ type: 'task/patch', id: task.id, patch: { waveId: null } }));
              dispatch({ type: 'wave/remove', id: wave.id });
              notify(`Wave W${wave.number} removed`);
              onClose();
              onRemoved?.();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <p className="text-body text-muted">
        {tasks.length === 0
          ? 'This removes the wave. Nothing else changes.'
          : `${tasks.length} task${tasks.length === 1 ? '' : 's'} stay in the tracker and lose their wave.`}
      </p>
    </Dialog>
  );
}

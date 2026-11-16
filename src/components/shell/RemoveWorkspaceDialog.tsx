/**
 * Removing a workspace asks first.
 *
 * The entry is a folder on disk plus everything openlab recorded in it — sessions, results,
 * the plan. Removing it only forgets the folder here; nothing is deleted from disk. Both
 * places that offer the action (the welcome list and the workspace switcher) open this one
 * dialog, so the question is worded the same way wherever it is asked.
 */

import { Button, Dialog } from '@/components/ui';
import { useApp } from '@/store/app';
import type { Project } from '@/store/types';

export function RemoveWorkspaceDialog({
  project,
  onClose,
}: {
  /** The workspace being removed, or `null` when the dialog is closed. */
  project: Project | null;
  onClose: () => void;
}) {
  const { dispatch } = useApp();

  return (
    <Dialog
      open={project !== null}
      onClose={onClose}
      width={440}
      title="Remove this workspace?"
      description={project ? `${project.name} · ${project.path}` : undefined}
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              if (!project) {
                return;
              }
              dispatch({ type: 'project/remove', id: project.id });
              onClose();
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <p className="text-body text-muted">
        openlab forgets the folder and its sessions. Nothing on disk is deleted.
      </p>
    </Dialog>
  );
}

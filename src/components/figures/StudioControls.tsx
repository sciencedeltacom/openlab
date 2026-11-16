/**
 * The studio's controls, as the top bar draws them.
 *
 * Two pieces, because the bar has two ends: the figure's name on the left where the title
 * goes, and its tools on the right. Both read the studio's published state, so there is one
 * source of truth and one set of actions.
 */

import {
  Copy,
  Download,
  FileJson,
  Grid3x3,
  Image as ImageIcon,
  Magnet,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Button, IconButton, Menu, MenuItem, Tip } from '@/components/ui';
import { useStudioControls } from './studio-bridge';

/** The left end: the figure's caption, editable in place. */
export function StudioTitle() {
  const studio = useStudioControls();
  if (!studio) return null;

  return (
    <input
      value={studio.caption}
      onChange={(event) => studio.onCaption(event.target.value)}
      onBlur={studio.commitCaption}
      aria-label="Figure caption"
      placeholder="Caption"
      className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-body text-foreground outline-none hover:bg-surface focus:bg-surface focus-visible:ring-2 focus-visible:ring-accent/50"
    />
  );
}

/** The right end: the tools the open figure is edited with. */
export function StudioTools() {
  const studio = useStudioControls();
  if (!studio) return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tip content="Undo (⌘Z)">
        <IconButton aria-label="Undo" isDisabled={!studio.canUndo} onPress={studio.undo}>
          <Undo2 className="size-4" />
        </IconButton>
      </Tip>
      <Tip content="Redo (⇧⌘Z)">
        <IconButton aria-label="Redo" isDisabled={!studio.canRedo} onPress={studio.redo}>
          <Redo2 className="size-4" />
        </IconButton>
      </Tip>

      <div className="mx-1 h-5 w-px bg-separator" aria-hidden />

      <Tip content="Zoom out (⌘−)">
        <IconButton aria-label="Zoom out" onPress={() => studio.zoomBy(1 / 1.2)}>
          <ZoomOut className="size-4" />
        </IconButton>
      </Tip>
      <Tip content="Zoom in (⌘+)">
        <IconButton aria-label="Zoom in" onPress={() => studio.zoomBy(1.2)}>
          <ZoomIn className="size-4" />
        </IconButton>
      </Tip>
      <Button size="sm" variant="ghost" onPress={studio.fit}>
        Fit
      </Button>

      <div className="mx-1 h-5 w-px bg-separator" aria-hidden />

      <Tip content="Grid">
        <IconButton aria-label="Toggle grid" active={studio.grid} onPress={studio.toggleGrid}>
          <Grid3x3 className="size-4" />
        </IconButton>
      </Tip>
      <Tip content="Snap to grid">
        <IconButton aria-label="Toggle snap" active={studio.snap} onPress={studio.toggleSnap}>
          <Magnet className="size-4" />
        </IconButton>
      </Tip>

      <Menu
        label="Export"
        trigger={
          <Button size="sm" variant="primary" className="ml-1 gap-1.5">
            <Download className="size-3.5" />
            Export
          </Button>
        }
        onAction={(id) => studio.runExport(id as 'svg' | 'png' | 'png4' | 'json' | 'copy')}
      >
        <MenuItem id="svg" icon={<ImageIcon className="size-4 text-muted" />}>
          SVG · vector
        </MenuItem>
        <MenuItem id="png" icon={<ImageIcon className="size-4 text-muted" />}>
          PNG · 2×
        </MenuItem>
        <MenuItem id="png4" icon={<ImageIcon className="size-4 text-muted" />}>
          PNG · 4×
        </MenuItem>
        <MenuItem id="json" icon={<FileJson className="size-4 text-muted" />}>
          JSON · document
        </MenuItem>
        <MenuItem id="copy" icon={<Copy className="size-4 text-muted" />}>
          Copy SVG
        </MenuItem>
      </Menu>
    </div>
  );
}

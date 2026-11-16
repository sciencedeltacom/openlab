/**
 * OpenUI's inspector, switched off.
 *
 * `@openuidev/react-lang` mounts an "OpenUI Inspect" button in development as a top-level side
 * effect of importing it — a floating widget in the corner of a research workbench, for a
 * renderer this app uses as one block type among many. The package's own opt-out is this
 * symbol: set before its module is evaluated, the widget never mounts, and nothing else about
 * the library changes.
 *
 * This module is imported first in `main.tsx`, ahead of anything that reaches OpenUI, because
 * ES module bodies run in the order their imports are written.
 */

(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('openui.devtools.autoMount')] = true;

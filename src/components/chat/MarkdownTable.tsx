/**
 * A markdown table, rendered as a real table.
 *
 * react-markdown hands over the parsed table; this rebuilds it with HeroUI's Table so it
 * gets the app's rows, columns and scrolling instead of a stack of `<td>`s, and hangs a
 * three-dot menu off the corner to copy the table or export it as CSV.
 */

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ClipboardCopy, FileDown, MoreHorizontal } from 'lucide-react';

import { IconButton, Menu, MenuItem, Table } from '@/components/ui';
import { useCopy } from '@/hooks/useCopy';

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** The plain text of a node, for the CSV and the accessible labels. */
function cellText(node: HastNode): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  return (node.children ?? []).map(cellText).join('');
}

/** Inline formatting inside a cell — code, emphasis, links — rendered, not flattened. */
function renderInline(node: HastNode, key: number): ReactNode {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type !== 'element') {
    return null;
  }
  const children = (node.children ?? []).map((child, index) => renderInline(child, index));
  switch (node.tagName) {
    case 'code':
      return (
        <code key={key} className="rounded-md bg-surface-secondary px-1 py-0.5 font-mono text-[0.85em]">
          {children}
        </code>
      );
    case 'strong':
      return (
        <strong key={key} className="font-semibold">
          {children}
        </strong>
      );
    case 'em':
      return (
        <em key={key} className="italic">
          {children}
        </em>
      );
    case 'del':
      return (
        <del key={key} className="text-muted">
          {children}
        </del>
      );
    case 'a': {
      const href = typeof node.properties?.href === 'string' ? node.properties.href : undefined;
      return (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-link underline underline-offset-2"
        >
          {children}
        </a>
      );
    }
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

/** Every `tr` under the table, in document order. */
function collectRows(node: HastNode, out: HastNode[]): void {
  if (node.tagName === 'tr') {
    out.push(node);
    return;
  }
  for (const child of node.children ?? []) {
    collectRows(child, out);
  }
}

/** Quote one CSV field. */
export function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function MarkdownTable({ node }: { node?: HastNode }) {
  const copy = useCopy();

  const trs: HastNode[] = [];
  if (node) {
    collectRows(node, trs);
  }

  const isCell = (cell: HastNode) => cell.tagName === 'th' || cell.tagName === 'td';
  const headerCells = (trs[0]?.children ?? []).filter(isCell);
  const bodyRows = trs.slice(1).map((tr) => (tr.children ?? []).filter(isCell));

  const toCsv = () =>
    [headerCells, ...bodyRows].map((row) => row.map((cell) => csvField(cellText(cell))).join(',')).join('\n');

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv()], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'table.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="group/table relative my-3">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Table">
            <Table.Header>
              {headerCells.map((cell, index) => (
                <Table.Column key={index} isRowHeader={index === 0}>
                  {renderInline(cell, index)}
                </Table.Column>
              ))}
            </Table.Header>
            <Table.Body>
              {bodyRows.map((cells, rowIndex) => (
                <Table.Row key={rowIndex} id={String(rowIndex)}>
                  {cells.map((cell, cellIndex) => (
                    <Table.Cell key={cellIndex}>{renderInline(cell, cellIndex)}</Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <div className="absolute end-1 top-1">
        <Menu
          label="Table actions"
          trigger={
            <IconButton aria-label="Table actions">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
          onAction={(key) => {
            if (key === 'copy') {
              copy(toCsv(), 'table as CSV');
            } else if (key === 'csv') {
              exportCsv();
            }
          }}
        >
          <MenuItem id="copy" icon={<ClipboardCopy className="size-4 shrink-0 text-muted" />}>
            Copy as CSV
          </MenuItem>
          <MenuItem id="csv" icon={<FileDown className="size-4 shrink-0 text-muted" />}>
            Export CSV
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}

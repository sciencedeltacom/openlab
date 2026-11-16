/**
 * Mention highlighting for rendered output.
 *
 * A mention the user typed — `@skill:literature-review`, `@src/app.ts` — should read as a
 * token, not as prose that happens to start with an `@`. This is a tiny remark plugin that
 * walks the markdown tree, wraps each mention in a styled span, and leaves code blocks alone
 * (their content is a `value`, never a `text` child, so the walk never reaches it).
 */

/** A node in the markdown tree, narrowed to what this plugin reads and writes. */
interface MentionNode {
  type?: string;
  value?: string;
  children?: MentionNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: MentionNode[];
  };
}

/** A mention: an `@` at a word boundary followed by one unbroken token. `@record:` is a citation. */
const MENTION = /(^|\s)(@(?!record:)(?:skill:)?[^\s@]+)/g;

/** A bracketed status token: `[canonical]`, `[verified]`. Letters only, so `[1]` is left be. */
const TAG = /\[([A-Za-z][A-Za-z0-9_-]{1,24})\]/g;

/** A citation of a record: `@record:KEY`, or a bare `record:KEY` from an older transcript. */
const RECORD = /(@?record:)([A-Za-z0-9._:/+-]+)/g;

/** Wrap one token in a styled span the renderer draws. */
function token(type: string, value: string, className: string): MentionNode {
  return {
    type,
    value,
    data: {
      hName: 'span',
      hProperties: { className },
      hChildren: [{ type: 'text', value }],
    },
  };
}

/** Split one text value into plain text and mention nodes. */
function split(value: string): MentionNode[] {
  const out: MentionNode[] = [];
  let last = 0;
  MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION.exec(value)) !== null) {
    const start = match.index + match[1]!.length;
    const text = match[2]!;
    if (start > last) {
      out.push({ type: 'text', value: value.slice(last, start) });
    }
    out.push(token('mention', text, 'mention'));
    last = start + text.length;
  }

  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) });
  }
  return out;
}

/** Split one text value into plain text and bracketed-tag nodes. */
function splitTags(value: string): MentionNode[] {
  const out: MentionNode[] = [];
  let last = 0;
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(value)) !== null) {
    if (match.index > last) {
      out.push({ type: 'text', value: value.slice(last, match.index) });
    }
    // A custom element name, so the renderer can hand it to the chip component.
    out.push({
      type: 'tag',
      value: match[1]!,
      data: {
        hName: 'md-tag',
        hProperties: { 'data-tag': match[1]! },
        hChildren: [{ type: 'text', value: match[1]! }],
      },
    });
    last = match.index + match[0].length;
  }
  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) });
  }
  return out;
}

/** Split one text value into plain text and citation nodes. */
function splitRecords(value: string): MentionNode[] {
  const out: MentionNode[] = [];
  let last = 0;
  RECORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECORD.exec(value)) !== null) {
    if (match.index > last) {
      out.push({ type: 'text', value: value.slice(last, match.index) });
    }
    const raw = match[2]!;
    // A citation often ends a sentence; the trailing punctuation is not part of the key.
    const key = raw.replace(/[.,;:]+$/, '');
    const trailing = raw.slice(key.length);
    out.push({
      type: 'record',
      value: key,
      data: {
        hName: 'md-record',
        hProperties: { 'data-record': key },
        hChildren: [{ type: 'text', value: key }],
      },
    });
    if (trailing) {
      out.push({ type: 'text', value: trailing });
    }
    last = match.index + match[0].length;
  }
  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) });
  }
  return out;
}

/** Replace mention, tag and citation text in place, depth-first. */
function wrap(node: MentionNode): void {
  if (!node.children) {
    return;
  }
  const next: MentionNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      // Mentions, then bracketed tags, then citations — each over what is left as plain text.
      for (const part of split(child.value)) {
        if (part.type !== 'text') {
          next.push(part);
          continue;
        }
        for (const tagged of splitTags(part.value ?? '')) {
          next.push(...(tagged.type === 'text' ? splitRecords(tagged.value ?? '') : [tagged]));
        }
      }
    } else {
      wrap(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** The remark plugin. */
export function remarkMentions() {
  return (tree: MentionNode) => {
    wrap(tree);
  };
}

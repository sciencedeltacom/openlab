/**
 * ANSI colour in a notebook's output, as segments a React tree can draw.
 *
 * A saved output is what the process wrote, escape sequences included: a traceback from
 * IPython is coloured, `pip` prints progress in place, a dataframe may carry a red column.
 * Rendering that text raw shows `\x1b[31m` to the reader; stripping it loses the one signal
 * the colour carried. So the escape sequences are parsed into text runs and a style, and the
 * renderer maps the style onto the app's own tokens — the colours are ours, the structure is
 * the notebook's.
 *
 * Only SGR (`…m`) survives as style. Every other control sequence is dropped: a terminal
 * cursor move means nothing here, and leaving it in the text would print it.
 */

/** The style one run of text carries. Colours are CSS values, already resolved to tokens. */
export interface AnsiStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** One run of text and the style it is drawn in. */
export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

/**
 * The eight ANSI colours, mapped to the app's palette.
 *
 * A terminal's black is this page's foreground: the reader wants text, not a black-on-black
 * rectangle. The bright variants share the token — the palette has one red, and inventing a
 * second one would fight the theme.
 */
const COLOURS = [
  'var(--foreground)',
  'var(--danger)',
  'var(--success)',
  'var(--warning)',
  'var(--accent)',
  'var(--syntax-keyword)',
  'var(--syntax-type)',
  'var(--muted)',
];

/** A background is a wash of the same colour, not the colour: text has to stay readable. */
function wash(colour: string): string {
  return `color-mix(in oklch, ${colour} 16%, transparent)`;
}

/** Every CSI sequence, SGR included; `m` is the one that carries style. */
const CSI = /\x1b\[([0-9;?]*)([A-Za-z])/g;

/** An operating-system command (`\x1b]0;title\x07`), which has no place in a document. */
const OSC = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

/** The style SGR parameters ask for, applied to the style so far. */
function apply(style: AnsiStyle, params: number[]): AnsiStyle {
  let next: AnsiStyle = { ...style };
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index]!;
    if (code === 0) {
      next = {};
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 2) {
      next.dim = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) {
      delete next.italic;
    } else if (code === 24) {
      delete next.underline;
    } else if (code >= 30 && code <= 37) {
      next.color = COLOURS[code - 30];
    } else if (code === 39) {
      delete next.color;
    } else if (code >= 90 && code <= 97) {
      next.color = COLOURS[code - 90];
    } else if (code >= 40 && code <= 47) {
      next.background = wash(COLOURS[code - 40]!);
    } else if (code === 49) {
      delete next.background;
    } else if (code >= 100 && code <= 107) {
      next.background = wash(COLOURS[code - 100]!);
    } else if (code === 38 || code === 48) {
      // `38;5;n` and `38;2;r;g;b` pick from a palette broader than the theme has names for.
      // The run keeps its text and loses only its colour, which is the honest loss.
      const extended = params[index + 1];
      if (extended === 5) {
        index += 2;
      } else if (extended === 2) {
        index += 4;
      }
    }
  }
  return next;
}

/** Split text into runs, each with the style that applies to it. */
export function ansiSegments(input: string): AnsiSegment[] {
  const cleaned = input.replace(OSC, '');
  const segments: AnsiSegment[] = [];
  let style: AnsiStyle = {};
  let at = 0;

  const push = (text: string) => {
    if (!text) {
      return;
    }
    const last = segments[segments.length - 1];
    if (last && sameStyle(last.style, style)) {
      last.text += text;
    } else {
      segments.push({ text, style });
    }
  };

  CSI.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSI.exec(cleaned)) !== null) {
    push(cleaned.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[2] === 'm') {
      const params = (match[1] ?? '')
        .split(';')
        .filter((part) => part.length > 0)
        .map(Number);
      style = apply(style, params.length > 0 ? params : [0]);
    }
  }
  push(cleaned.slice(at));
  return segments;
}

/** Whether two styles draw the same, so adjacent runs can merge. */
function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.color === b.color &&
    a.background === b.background &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.dim) === Boolean(b.dim) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline)
  );
}

/** The plain text of a coloured string, for a copy button or a length check. */
export function ansiPlain(input: string): string {
  return input.replace(OSC, '').replace(CSI, '').replace(/\x1b./g, '');
}

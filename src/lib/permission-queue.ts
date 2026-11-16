/**
 * The permission prompts, in order.
 *
 * One prompt at a time is the right surface — a person answers one question, not a stack —
 * but more than one call can ask at once: two tools in a parallel step, or a second session
 * that kept running while the reader was elsewhere. A single resolver loses the first promise
 * when the second call overwrites it, and the turn hangs with no prompt on screen.
 *
 * This keeps them in a FIFO. The head is what the dialog shows; answering settles that promise
 * and promotes the next. Aborting a turn removes its own request wherever it sits.
 */

interface Entry<T> {
  request: T;
  finish: (value: boolean) => void;
  settled: boolean;
}

export class PermissionQueue<T> {
  private readonly entries: Entry<T>[] = [];

  /** `onChange` is called with the head, or `null` when the queue is empty. */
  constructor(private readonly onChange: (current: T | null) => void) {}

  /** The request the dialog should show, or `null`. */
  current(): T | null {
    return this.entries[0]?.request ?? null;
  }

  /** How many calls are waiting for an answer. */
  get depth(): number {
    return this.entries.length;
  }

  /** Ask, and settle `false` on abort rather than leaving the promise pending. */
  enqueue(request: T, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const entry: Entry<T> = {
        request,
        settled: false,
        finish: (value) => {
          if (entry.settled) return;
          entry.settled = true;
          const index = this.entries.indexOf(entry);
          if (index >= 0) this.entries.splice(index, 1);
          if (index === 0) this.onChange(this.current());
          resolve(value);
        },
      };
      this.entries.push(entry);
      if (this.entries.length === 1) this.onChange(request);
      if (signal) {
        if (signal.aborted) entry.finish(false);
        else signal.addEventListener('abort', () => entry.finish(false), { once: true });
      }
    });
  }

  /**
   * Answer the visible request.
   *
   * When `request` is given, a stale click is ignored: a double click or a queued keystroke
   * must not deny the request that was promoted a moment later.
   */
  answer(allow: boolean, request?: T): void {
    const head = this.entries[0];
    if (!head) return;
    if (request !== undefined && head.request !== request) return;
    head.finish(allow);
  }
}

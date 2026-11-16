/**
 * A value with listeners.
 *
 * The shape React's `useSyncExternalStore` reads: a stable `subscribe`, and a `get` that
 * returns the same reference until something actually changes. It is the state a service
 * owns, kept as a class field rather than a module-level `let` so the service can be built,
 * resolved and (when it is scoped) disposed by the container instead of living forever in the
 * module graph.
 */

export class ExternalStore<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  /** The current value. Stable until {@link set} changes it. */
  get = (): T => this.value;

  /** Replace the value and notify. A no-op change is not a notification. */
  set(next: T): void {
    if (Object.is(next, this.value)) {
      return;
    }
    this.value = next;
    this.emit();
  }

  /** Replace the value with a function of the current one. */
  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  /** Subscribe to changes; returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

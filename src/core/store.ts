/** Plain TS store with subscribe; compatible with React useSyncExternalStore. */
export class Store<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.state = initial;
  }

  getState = (): T => this.state;

  setState(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

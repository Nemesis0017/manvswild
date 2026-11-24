import { useSyncExternalStore } from 'react';
import type { Store } from '../core/store';

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState);
}

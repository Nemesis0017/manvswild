import { toMeta, validateSave, type SaveData, type SaveMeta } from './saveData';

const DB_NAME = 'manvswild';
const STORE = 'saves';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB wrapper holding one record per save slot. The factory is injectable for tests. */
export class SaveDb {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null) {}

  get available(): boolean { return !!this.factory; }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available in this browser'));
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = this.factory!.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'slot' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Could not open save database'));
      });
    }
    return this.dbPromise;
  }

  async put(data: SaveData): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    await wrap(tx.objectStore(STORE).put(data));
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  }

  async get(slot: string): Promise<SaveData | null> {
    const db = await this.open();
    const raw = await wrap(db.transaction(STORE).objectStore(STORE).get(slot));
    return raw ? validateSave(raw) : null;
  }

  async list(): Promise<SaveMeta[]> {
    const db = await this.open();
    const all = (await wrap(db.transaction(STORE).objectStore(STORE).getAll())) as SaveData[];
    return all.filter((d) => d && d.version === 1).map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(slot: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(slot);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  }

  /** Most recently written save, for the Continue button. */
  async latest(): Promise<SaveMeta | null> {
    return (await this.list())[0] ?? null;
  }

  close(): void {
    this.dbPromise?.then((d) => d.close()).catch(() => undefined);
    this.dbPromise = null;
  }
}

export const saveDb = new SaveDb();

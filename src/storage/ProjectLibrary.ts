import type { Theme } from '../theme/types';

const DB_NAME = 'pianoroll-v1';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const THEMES = 'themes';

export interface SavedProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  trackCount: number;
  midi: ArrayBuffer;
  audio: ArrayBuffer | null;
  audioMime: string | null;
  audioFileName: string | null;
  theme: Theme;
}

export interface SavedTheme {
  id: string;
  name: string;
  createdAt: number;
  theme: Theme;
}

/**
 * IndexedDB wrapper for the project + theme library. Two object stores:
 *   - `projects`: MIDI bytes + audio bytes + theme, keyed by uuid
 *   - `themes`:   theme JSON only, keyed by uuid
 *
 * Audio + MIDI are stored as raw ArrayBuffer so reloading round-trips losslessly.
 */
export class ProjectLibrary {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(THEMES)) db.createObjectStore(THEMES, { keyPath: 'id' });
      };
    });
    return this.dbPromise;
  }

  private async tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      let value: T;
      let captured = false;
      req.onsuccess = () => { value = req.result; captured = true; };
      req.onerror = () => reject(req.error);
      // For writes we wait until the transaction commits; otherwise a save +
      // immediate reload could lose the record.
      t.oncomplete = () => { if (captured) resolve(value); };
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  private _id(): string {
    return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // ── Projects ──

  async listProjects(): Promise<SavedProject[]> {
    const list = await this.tx<SavedProject[]>(PROJECTS, 'readonly', s => s.getAll() as IDBRequest<SavedProject[]>);
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id: string): Promise<SavedProject | undefined> {
    return this.tx<SavedProject | undefined>(PROJECTS, 'readonly', s => s.get(id) as IDBRequest<SavedProject | undefined>);
  }

  async saveProject(input: {
    name: string;
    duration: number;
    trackCount: number;
    midi: ArrayBuffer;
    audio: ArrayBuffer | null;
    audioMime: string | null;
    audioFileName: string | null;
    theme: Theme;
    existingId?: string;
  }): Promise<string> {
    const now = Date.now();
    const id = input.existingId ?? this._id();
    let createdAt = now;
    if (input.existingId) {
      const prev = await this.getProject(input.existingId);
      if (prev) createdAt = prev.createdAt;
    }
    const record: SavedProject = {
      id,
      name: input.name,
      createdAt,
      updatedAt: now,
      duration: input.duration,
      trackCount: input.trackCount,
      midi: input.midi,
      audio: input.audio,
      audioMime: input.audioMime,
      audioFileName: input.audioFileName,
      theme: input.theme,
    };
    await this.tx(PROJECTS, 'readwrite', s => s.put(record));
    return id;
  }

  async deleteProject(id: string): Promise<void> {
    await this.tx(PROJECTS, 'readwrite', s => s.delete(id));
  }

  // ── Themes ──

  async listThemes(): Promise<SavedTheme[]> {
    const list = await this.tx<SavedTheme[]>(THEMES, 'readonly', s => s.getAll() as IDBRequest<SavedTheme[]>);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  async saveTheme(name: string, theme: Theme): Promise<string> {
    const id = this._id();
    const record: SavedTheme = { id, name, createdAt: Date.now(), theme };
    await this.tx(THEMES, 'readwrite', s => s.put(record));
    return id;
  }

  async deleteTheme(id: string): Promise<void> {
    await this.tx(THEMES, 'readwrite', s => s.delete(id));
  }
}

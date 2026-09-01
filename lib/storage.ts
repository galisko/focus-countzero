export type Subtask = { id: string; title: string; done: boolean; createdAt: number; trackedMs?: number; counterEnabled?: boolean };
export type TaskStatus = 'in_progress' | 'done' | 'canceled';
export type Task = { id: string; title: string; estimate: number; completed: number; done: boolean; createdAt: number; notes?: string; subtasks?: Subtask[]; status?: TaskStatus; hidden?: boolean; trackFocus?: boolean; trackedMs?: number; counterEnabled?: boolean };
export type Session = { id: string; mode: 'focus' | 'short' | 'long'; duration: number; completedAt: number; taskId?: string };

const DB_NAME = 'focus-protocol';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('backgrounds')) db.createObjectStore('backgrounds', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tasks', 'sessions', 'backgrounds'], 'readwrite');
    ['tasks', 'sessions', 'backgrounds'].forEach(storeName => tx.objectStore(storeName).clear());
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function clearStore(storeName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getBackground(): Promise<{ id: string; blob: Blob } | undefined> {
  const entries = await getAll<{ id: string; blob: Blob }>('backgrounds');
  return entries[0];
}

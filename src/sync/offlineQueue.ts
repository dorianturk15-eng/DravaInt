import { supabase } from '../supabase/client';

type Operation = 'insert' | 'update' | 'delete' | 'upsert';
export interface OfflineQueueItem { id?: number; table: string; operation: Operation; payload?: Record<string, unknown>; match?: Record<string, string | number>; createdAt: string; }
const DB_NAME = 'dravaint-offline';
const STORE = 'mutations';
export const OFFLINE_QUEUE_EVENT = 'dravaint:offline-queue-change';

function notifyQueueChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT));
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueMutation(item: Omit<OfflineQueueItem, 'createdAt'>) {
  try {
    const db = await database();
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).add({ ...item, createdAt: new Date().toISOString() });
    transaction.oncomplete = notifyQueueChange;
  } catch {
    localStorage.setItem('dravaint-sync-warning', 'Offline changes are waiting for manual retry.');
  }
}

export async function getOfflineQueueItems(): Promise<OfflineQueueItem[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as OfflineQueueItem[]);
    request.onerror = () => reject(request.error);
  });
}

async function remove(id: number) {
  const db = await database();
  const transaction = db.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).delete(id);
  transaction.oncomplete = notifyQueueChange;
}

export async function discardOfflineQueueItem(id: number) {
  await remove(id);
}

export async function getOfflineQueueCount(): Promise<number> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return 0;
  try {
    const db = await database();
    return await new Promise<number>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return localStorage.getItem('dravaint-sync-warning') ? 1 : 0;
  }
}

export async function flushOfflineQueue() {
  if (!supabase || !navigator.onLine) return;
  for (const item of await getOfflineQueueItems()) {
    let query: any;
    if (item.operation === 'insert') query = supabase.from(item.table).insert(item.payload!);
    if (item.operation === 'upsert') query = supabase.from(item.table).upsert(item.payload!);
    if (item.operation === 'update') query = supabase.from(item.table).update(item.payload!);
    if (item.operation === 'delete') query = supabase.from(item.table).delete();
    for (const [column, value] of Object.entries(item.match ?? {})) query = query.eq(column, value);
    const { error } = await query;
    if (!error && item.id) await remove(item.id);
    if (error) {
      localStorage.setItem('dravaint-sync-error', JSON.stringify({ message: error.message, table: item.table, operation: item.operation, at: new Date().toISOString() }));
      notifyQueueChange();
      break;
    }
    localStorage.removeItem('dravaint-sync-error');
  }
  notifyQueueChange();
}

let started = false;
export function startOfflineSync() {
  if (started || typeof window === 'undefined' || !('indexedDB' in window)) return;
  started = true;
  window.addEventListener('online', () => void flushOfflineQueue());
  void flushOfflineQueue();
}

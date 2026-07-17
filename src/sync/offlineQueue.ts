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

/**
 * Dead-letter store for queued mutations that can never succeed as-is: an optimistic-lock conflict
 * (the row changed on the server while this terminal was offline) or a permanent DB rejection
 * (constraint/RLS). These are parked here — never silently applied — so one poison item can't block
 * the rest of the queue forever, and a planner can review them in SyncDiagnostics.
 */
export interface ParkedMutation { item: OfflineQueueItem; reason: string; at: string; }
const DEAD_LETTER_KEY = 'dravaint-sync-dead-letter';

export function getParkedMutations(): ParkedMutation[] {
  try { return JSON.parse(localStorage.getItem(DEAD_LETTER_KEY) || '[]') as ParkedMutation[]; } catch { return []; }
}

function parkMutation(item: OfflineQueueItem, reason: string) {
  try {
    const parked = getParkedMutations();
    parked.push({ item, reason, at: new Date().toISOString() });
    // Keep the most recent 50 — enough to review, bounded so it can't grow without limit.
    localStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(parked.slice(-50)));
  } catch {
    // A full/blocked localStorage must not crash the flush loop.
  }
}

export function clearParkedMutations() {
  localStorage.removeItem(DEAD_LETTER_KEY);
  notifyQueueChange();
}

/**
 * A network/connectivity failure is transient (retry the whole queue later, preserving order); a
 * PostgREST/Postgres error carries a `code` (constraint, RLS, custom errcode) and is permanent for
 * this payload. Treat "no code" or an offline navigator as transient.
 */
export function isTransientError(error: { code?: string } | null | undefined): boolean {
  return !navigator.onLine || !error?.code;
}

function recordSyncError(item: OfflineQueueItem, error: { message?: string }) {
  localStorage.setItem('dravaint-sync-error', JSON.stringify({ message: error.message ?? 'unknown', table: item.table, operation: item.operation, at: new Date().toISOString() }));
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
    try {
      if (item.operation === 'update') {
        // Optimistic locking on replay: the match includes the expected `version`, so if another
        // terminal edited this row while we were offline, zero rows update and we must NOT clobber
        // their newer edit — park it for review instead. `.select()` gives us the affected count.
        let query = supabase.from(item.table).update(item.payload!);
        for (const [column, value] of Object.entries(item.match ?? {})) query = query.eq(column, value);
        const { data, error } = await query.select('id');
        if (error) {
          if (isTransientError(error)) { recordSyncError(item, error); notifyQueueChange(); break; }
          parkMutation(item, error.message);
        } else if (!data || data.length === 0) {
          parkMutation(item, 'version-conflict: row changed on the server since this edit was queued');
        }
      } else {
        let query: any;
        if (item.operation === 'insert') query = supabase.from(item.table).insert(item.payload!);
        else if (item.operation === 'upsert') query = supabase.from(item.table).upsert(item.payload!);
        else query = supabase.from(item.table).delete();
        for (const [column, value] of Object.entries(item.match ?? {})) query = query.eq(column, value);
        const { error } = await query;
        if (error) {
          if (isTransientError(error)) { recordSyncError(item, error); notifyQueueChange(); break; }
          parkMutation(item, error.message);
        }
      }
      // Item resolved (applied or parked): drop it from the active queue so a single poison item
      // can never head-of-line block everything behind it, as the old unconditional `break` did.
      if (item.id) await remove(item.id);
      localStorage.removeItem('dravaint-sync-error');
    } catch (caught) {
      // An unexpected throw (almost always a network failure mid-flush): stop and retry the whole
      // queue later, keeping this item and its order intact.
      recordSyncError(item, caught instanceof Error ? caught : { message: String(caught) });
      notifyQueueChange();
      break;
    }
  }
  notifyQueueChange();
}

let started = false;
let retryDelayMs = 30_000;
let retryTimer: number | null = null;

/** Periodic retry with exponential backoff (30s → 8min cap), in addition to the instant
 *  retry on the browser's `online` event — covers flaky connections that never fully drop. */
async function retryLoop() {
  const before = await getOfflineQueueCount();
  if (before > 0) {
    await flushOfflineQueue();
    const after = await getOfflineQueueCount();
    retryDelayMs = after < before ? 30_000 : Math.min(retryDelayMs * 2, 480_000);
  } else {
    retryDelayMs = 30_000;
  }
  retryTimer = window.setTimeout(() => void retryLoop(), retryDelayMs);
}

export function startOfflineSync() {
  if (started || typeof window === 'undefined' || !('indexedDB' in window)) return;
  started = true;
  window.addEventListener('online', () => {
    retryDelayMs = 30_000;
    void flushOfflineQueue();
  });
  void flushOfflineQueue();
  if (retryTimer === null) retryTimer = window.setTimeout(() => void retryLoop(), retryDelayMs);
}

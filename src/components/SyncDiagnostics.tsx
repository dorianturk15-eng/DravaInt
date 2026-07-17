import { useCallback, useEffect, useState } from 'react';
import { useConnectivity } from '../hooks/useConnectivity';
import { clearParkedMutations, discardOfflineQueueItem, flushOfflineQueue, getOfflineQueueItems, getParkedMutations, OFFLINE_QUEUE_EVENT, type OfflineQueueItem, type ParkedMutation } from '../sync/offlineQueue';
import { supabase } from '../supabase/client';

interface StorageHealth { usage: number; quota: number; }
interface SyncError { message: string; table?: string; operation?: string; at?: string; }

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function loadSyncError(): SyncError | null {
  try { return JSON.parse(localStorage.getItem('dravaint-sync-error') || 'null') as SyncError | null; } catch { return null; }
}

export function SyncDiagnostics({ language }: { language: 'hr' | 'en' }) {
  const { online, pendingChanges } = useConnectivity();
  const [queue, setQueue] = useState<OfflineQueueItem[]>([]);
  const [parked, setParked] = useState<ParkedMutation[]>([]);
  const [storage, setStorage] = useState<StorageHealth>({ usage: 0, quota: 0 });
  const [serviceWorker, setServiceWorker] = useState<'active' | 'waiting' | 'unavailable' | 'development'>('development');
  const [lastError, setLastError] = useState<SyncError | null>(loadSyncError);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const hr = language === 'hr';

  const refresh = useCallback(async () => {
    try { setQueue(await getOfflineQueueItems()); } catch { setQueue([]); }
    setParked(getParkedMutations());
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    }
    if (!('serviceWorker' in navigator)) setServiceWorker('unavailable');
    else {
      const registration = await navigator.serviceWorker.getRegistration();
      setServiceWorker(registration?.active ? 'active' : registration?.waiting ? 'waiting' : import.meta.env.DEV ? 'development' : 'unavailable');
    }
    setLastError(loadSyncError());
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
  }, [refresh]);

  async function retry() {
    setBusy(true);
    await flushOfflineQueue();
    await refresh();
    setBusy(false);
    setNotice(hr ? 'Ponovni pokušaj sinkronizacije je dovršen.' : 'Synchronization retry completed.');
    window.setTimeout(() => setNotice(''), 2500);
  }

  async function discard(id: number) {
    await discardOfflineQueueItem(id);
    await refresh();
  }

  const storagePercent = storage.quota ? Math.min(100, storage.usage / storage.quota * 100) : 0;

  return <section className="sync-diagnostics glass-panel">
    <div className="sync-diagnostics-heading"><div><span className="eyebrow">System health</span><h3>{hr ? 'Dijagnostika i izvanmrežni red' : 'Diagnostics and offline queue'}</h3><p>{hr ? 'Provjera veze, pohrane, aplikacijskog predmemoriranja i promjena koje čekaju poslužitelj.' : 'Connection, storage, application cache, and server-bound change health.'}</p></div><button className="btn btn-ghost" onClick={() => void refresh()}>{hr ? 'Osvježi' : 'Refresh'}</button></div>

    <div className="diagnostic-grid">
      <article className={online ? 'healthy' : 'warning'}><span className="diagnostic-icon">{online ? '●' : '!'}</span><div><small>{hr ? 'Veza' : 'Connection'}</small><strong>{online ? (hr ? 'Povezano' : 'Online') : (hr ? 'Izvan mreže' : 'Offline')}</strong><em>{supabase ? 'Supabase' : (hr ? 'Lokalni pregled' : 'Local preview')}</em></div></article>
      <article className={pendingChanges ? 'warning' : 'healthy'}><span className="diagnostic-icon">↻</span><div><small>{hr ? 'Red sinkronizacije' : 'Sync queue'}</small><strong>{pendingChanges} {hr ? 'promjena' : 'changes'}</strong><em>{pendingChanges ? (hr ? 'Čeka ponovni pokušaj' : 'Waiting for retry') : (hr ? 'Red je prazan' : 'Queue is clear')}</em></div></article>
      <article className={storagePercent > 80 ? 'warning' : 'healthy'}><span className="diagnostic-icon">▰</span><div><small>{hr ? 'Pohrana preglednika' : 'Browser storage'}</small><strong>{bytes(storage.usage)}</strong><em>{storage.quota ? `${storagePercent.toFixed(1)}% · ${bytes(storage.quota)}` : (hr ? 'Procjena nije dostupna' : 'Estimate unavailable')}</em></div></article>
      <article className={serviceWorker === 'unavailable' ? 'warning' : 'healthy'}><span className="diagnostic-icon">◇</span><div><small>App cache</small><strong>{serviceWorker === 'active' ? (hr ? 'Aktivan' : 'Active') : serviceWorker === 'development' ? (hr ? 'Razvojni način' : 'Development mode') : serviceWorker === 'waiting' ? (hr ? 'Čeka aktivaciju' : 'Waiting') : (hr ? 'Nedostupan' : 'Unavailable')}</strong><em>PWA service worker</em></div></article>
    </div>

    {lastError && <div className="sync-error-banner"><strong>{hr ? 'Posljednja pogreška sinkronizacije' : 'Last synchronization error'}</strong><span>{lastError.table} · {lastError.operation} · {lastError.message}</span>{lastError.at && <small>{new Date(lastError.at).toLocaleString(hr ? 'hr-HR' : 'en-GB')}</small>}</div>}
    {notice && <div className="inline-success">✓ {notice}</div>}

    <div className="queue-toolbar"><div><strong>{hr ? 'Promjene na čekanju' : 'Pending changes'}</strong><small>{hr ? 'Ponovno pokušajte slanje ili odbacite samo promjenu koju više ne želite primijeniti.' : 'Retry delivery or discard only a change that should no longer be applied.'}</small></div><button className="btn btn-blue" onClick={() => void retry()} disabled={busy || !online || !supabase || queue.length === 0}>{busy ? (hr ? 'Sinkronizacija…' : 'Syncing…') : (hr ? 'Pokušaj ponovno' : 'Retry all')}</button></div>
    {queue.length ? <div className="queue-list">{queue.map((item) => <article key={item.id}><span className={`queue-operation operation-${item.operation}`}>{item.operation}</span><div><strong>{item.table}</strong><small>{new Date(item.createdAt).toLocaleString(hr ? 'hr-HR' : 'en-GB')} · #{item.id}</small></div><code>{Object.keys(item.payload ?? item.match ?? {}).slice(0, 4).join(', ') || 'record'}</code><button onClick={() => item.id && void discard(item.id)}>{hr ? 'Odbaci' : 'Discard'}</button></article>)}</div> : <div className="queue-empty"><span>✓</span><strong>{hr ? 'Nema promjena na čekanju' : 'No pending changes'}</strong><small>{hr ? 'Lokalni i udaljeni podaci su usklađeni.' : 'Local and remote data are aligned.'}</small></div>}

    {parked.length > 0 && <div className="parked-mutations">
      <div className="queue-toolbar"><div><strong>{hr ? 'Odbijene promjene (sukob verzija)' : 'Rejected changes (version conflict)'}</strong><small>{hr ? 'Ove izmjene nisu primijenjene jer je zapis u međuvremenu izmijenjen na poslužitelju ili ih je baza odbila. Provjerite i po potrebi ponovno unesite.' : 'These edits were not applied because the record changed on the server meanwhile, or the database rejected them. Review and re-enter if still needed.'}</small></div><button className="btn btn-ghost" onClick={() => { clearParkedMutations(); setParked([]); }}>{hr ? 'Očisti' : 'Clear'}</button></div>
      <div className="queue-list">{parked.map((entry, index) => <article key={index}><span className={`queue-operation operation-${entry.item.operation}`}>{entry.item.operation}</span><div><strong>{entry.item.table}</strong><small>{new Date(entry.at).toLocaleString(hr ? 'hr-HR' : 'en-GB')}</small></div><code>{entry.reason}</code></article>)}</div>
    </div>}
  </section>;
}

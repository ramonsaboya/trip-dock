'use client';
import { useEffect, useRef, useState } from 'react';
import { formatDateRange, type Trip } from '../lib/graphql-client';
import { packingApi, packingDates, packingProgress, type PackingLibrary, type PackingPlan, type PlanEdit } from '../lib/packing-client';
import { PackingLibraryView } from './packing-library';
import { PackingChecklist } from './packing-checklist';
import { PackingDays } from './packing-days';

export function PackingWorkspace({ trip }: { trip: Trip }) {
  const selectedTripId = trip.id;
  const [library, setLibrary] = useState<PackingLibrary | null>(null);
  const [plan, setPlan] = useState<PackingPlan | null>(null);
  const [view, setView] = useState<'days' | 'list' | 'library'>('days');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const pending = useRef(false);
  const planVersion = useRef(0);
  const [reload, setReload] = useState(0);
  const busy = saving || libraryBusy;
  const libraryReady = Boolean(library);
  useEffect(() => {
    const controller = new AbortController();
    packingApi.initialize(controller.signal).then(next => { if (!controller.signal.aborted) setLibrary(next); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const version = ++planVersion.current;
    if (!selectedTripId || !libraryReady) return;
    const controller = new AbortController();
    packingApi.open(selectedTripId, controller.signal).then(next => {
      if (!controller.signal.aborted && version === planVersion.current) setPlan(next);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [selectedTripId, trip.startDate, trip.endDate, libraryReady, reload]);
  const current = plan?.tripId === selectedTripId ? plan : null;
  const dates = current ? packingDates(current.startDate, current.endDate) : [];
  const outside = current?.assignments.filter(a => !dates.includes(a.day)) ?? [];
  const progress = packingProgress(current?.entries ?? []);

  async function refresh() {
    const version = ++planVersion.current;
    const [nextLibrary, nextPlan] = await Promise.all([packingApi.library(), selectedTripId ? packingApi.plan(selectedTripId) : Promise.resolve(null)]);
    if (version !== planVersion.current) return;
    setLibrary(nextLibrary); setPlan(nextPlan);
  }
  function savedLibrary(next: PackingLibrary) {
    setLibrary(next); setStatus('Library saved.');
    if (current) {
      const version = ++planVersion.current;
      void packingApi.plan(current.tripId).then(nextPlan => {
        if (version === planVersion.current) setPlan(nextPlan);
      }).catch(e => { if (version === planVersion.current) setError(e.message); });
    }
  }
  async function edit(input: PlanEdit): Promise<boolean> {
    if (!current || pending.current || libraryBusy) return false;
    pending.current = true; setSaving(true); setError('');
    const version = ++planVersion.current;
    try {
      const next = await packingApi.edit(current, input);
      if (version === planVersion.current) {
        setPlan(next);
        if (input.action === 'GENERATE') { setView('list'); setStatus('List updated.'); }
        else setStatus('Saved.');
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
      if (e && typeof e === 'object' && 'code' in e && e.code === 'REVISION_CONFLICT') {
        try { await refresh(); } catch { /* Retain the original actionable error. */ }
      }
      return false;
    } finally { pending.current = false; setSaving(false); }
  }
  return <main id="main-content" className="packing-page" tabIndex={-1}>
    <header className="packing-heading"><div><h1>{trip.name}</h1><p>{formatDateRange(trip.startDate, trip.endDate)}</p></div></header>
    <div className="packing-toolbar"><div className="packing-segments" aria-label="Packing views"><button disabled={busy} aria-pressed={view === 'days'} onClick={() => setView('days')}>Day tags</button><button disabled={busy} aria-pressed={view === 'list'} onClick={() => setView('list')}>Packing list{progress.total ? ` · ${progress.done}/${progress.total}` : ''}</button><button disabled={busy} aria-pressed={view === 'library'} onClick={() => setView('library')}>Your library</button></div>{current && library && view !== 'library' ? <button className="button-primary" disabled={busy} onClick={() => void edit({ action: 'GENERATE', expectedLibraryRevision: library.revision, startDate: current.startDate, endDate: current.endDate })}>{saving ? 'Saving…' : current.generatedAt ? 'Recalculate list' : 'Generate packing list'}</button> : null}</div>
    {error ? <div className="packing-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => { setError(''); setReload(n => n + 1); }}>Refresh and retry</button></div> : null}
    <p className="packing-save-status" role="status" aria-live="polite">{busy ? 'Saving…' : status}</p>
    {!library ? (error ? null : <div className="packing-empty" aria-busy="true">Opening your library…</div>) : view === 'library' ? <PackingLibraryView library={library} onSaved={savedLibrary} onRefresh={refresh} onBusyChange={setLibraryBusy} disabled={busy} /> : !current ? (error ? null : <section className="packing-empty" aria-busy="true">Opening {trip.name}…</section>) : <>
      {current.stale ? <div className="packing-stale" role="status">Plans changed. Recalculate to refresh suggestions; your adjustments stay.</div> : null}
      {outside.length ? <details className="packing-stale"><summary>{outside.length} tags outside the trip dates</summary>{outside.map(a => <p key={a.day + a.tagId}>{a.day} · {library.tags.find(t => t.id === a.tagId)?.name} <button disabled={busy} onClick={() => void edit({ action: 'ASSIGN', days: [a.day], tagId: a.tagId, remove: true })}>Remove</button></p>)}</details> : null}
      {view === 'days' ? <PackingDays key={current.tripId} trip={trip} plan={current} library={library} busy={busy} edit={edit} onLibrarySaved={savedLibrary} onRefresh={refresh} onLibraryBusy={setLibraryBusy} />
        : <PackingChecklist key={current.tripId} plan={current} library={library} busy={busy} edit={edit} onLibrarySaved={savedLibrary} onRefresh={refresh} onLibraryBusy={setLibraryBusy} />}
    </>}
  </main>;
}


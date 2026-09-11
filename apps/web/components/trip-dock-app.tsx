'use client';
import { useTripCollection } from '../features/trips/use-trip-collection';

import { useEffect, useState } from 'react';
import { PackingWorkspace } from '../features/packing/packing-workspace';
import { TripDetail } from '../features/trips/trip-detail';
import { type Notice } from '../features/trips/trip-state';
import { TripsOverview } from '../features/trips/trips-overview';
import { navigateHome, navigateTrip, useTripNavigation } from '../lib/packing-navigation';
import { ThemeToggle } from './theme-toggle';
import { Logo } from './ui/logo';

export function TripDockApp() {
  const navigation = useTripNavigation();
  const { state, replaceTrip, removeTrip, retry } = useTripCollection();
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    window.scrollTo({ top: 0, behavior: 'auto' });
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigation.tripId, state.kind]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedTrip = state.kind === 'ready' ? state.trips.find((trip) => trip.id === navigation.tripId) : undefined;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to main content</a>
      <header className="site-header"><div className={`header-inner ${selectedTrip ? 'header-inner-workbench' : ''}`}>
        <button className="logo-button" type="button" onClick={navigateHome} aria-label="TripDock home"><Logo /></button>
        {navigation.tripId ? <button className="header-home" type="button" onClick={navigateHome} aria-label="Home" title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" /></svg>
        </button> : null}
        {selectedTrip ? <div className="app-section-tabs" role="tablist" aria-label="Trip views" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }}>
          <button id="schedule-tab" role="tab" aria-selected={navigation.view === 'schedule'} aria-controls="schedule-panel" tabIndex={navigation.view === 'schedule' ? 0 : -1} onClick={() => navigateTrip(selectedTrip.id, 'schedule')}>Schedule</button>
          <button id="packing-tab" role="tab" aria-selected={navigation.view === 'packing'} aria-controls="packing-panel" tabIndex={navigation.view === 'packing' ? 0 : -1} onClick={() => navigateTrip(selectedTrip.id, 'packing')}>Packing</button>
        </div> : null}
        <ThemeToggle />
      </div></header>
      {state.kind === 'loading' ? <main id="main-content" className="state-page" aria-busy="true"><Logo /><div className="loader" aria-hidden="true" /><h1>Opening your trips</h1><p>Getting your plans ready…</p></main> : null}
      {state.kind === 'error' ? <main id="main-content" className="state-page error-state"><Logo /><h1>TripDock could not open your data</h1><p role="alert">{state.message}</p><button className="button-primary" type="button" onClick={retry}>Retry connection</button></main> : null}
      {state.kind === 'ready' && !navigation.tripId ? <TripsOverview trips={state.trips} onCreated={(trip) => { replaceTrip(trip); navigateTrip(trip.id); setNotice({ tone: 'success', message: 'Trip created.' }); }} onOpen={id => navigateTrip(id)} /> : null}
      {state.kind === 'ready' && navigation.tripId && !selectedTrip ? <main id="main-content" className="state-page" tabIndex={-1}><h1>Trip unavailable</h1><p>This trip may have been deleted.</p><button className="button-primary" type="button" onClick={navigateHome}>Back to Home</button></main> : null}
      {state.kind === 'ready' && selectedTrip ? <>
        <div className="app-section-panel" id="schedule-panel" role="tabpanel" aria-labelledby="schedule-tab" hidden={navigation.view !== 'schedule'}>
          {navigation.view === 'schedule' ? <TripDetail key={selectedTrip.id} trip={selectedTrip} onChanged={replaceTrip} onDeleted={() => { removeTrip(selectedTrip.id); navigateHome(); setNotice({ tone: 'success', message: 'Trip deleted.' }); }} notify={setNotice} /> : null}
        </div>
        <div className="app-section-panel" id="packing-panel" role="tabpanel" aria-labelledby="packing-tab" hidden={navigation.view !== 'packing'}>
          {navigation.view === 'packing' ? <PackingWorkspace key={selectedTrip.id} trip={selectedTrip} /> : null}
        </div>
      </> : null}
      {notice ? <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}
    </div>
  );
}

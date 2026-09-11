'use client';

import { useState } from 'react';
import { errorMessage } from '../../lib/error-message';
import { graphqlRequest } from '../../lib/graphql/request';
import { formatDateRange } from '../../lib/trips/dates';
import { operations } from '../../lib/trips/operations';
import { type Activity, type Stay, type TransportLeg, type Trip } from '../../lib/trips/types';
import { TripCalendar } from '../calendar/trip-calendar';
import { ActivityEditor } from './editors/activity-editor';
import { StayEditor } from './editors/stay-editor';
import { TransportEditor } from './editors/transport-editor';
import { TripEditor } from './editors/trip-editor';
import { type Notice } from './trip-state';

export type EntityEditor =
  | { kind: 'trip' }
  | { kind: 'transport'; value?: TransportLeg; fromStopId?: string | null; toStopId?: string | null }
  | { kind: 'stay'; value?: Stay; stopId?: string }
  | { kind: 'activity'; value?: Activity; stopId?: string; scheduledLocal?: string }
  | null;

export function TripDetail({ trip, onChanged, onDeleted, notify }: { trip: Trip; onChanged: (trip: Trip) => void; onDeleted: () => void; notify: (notice: Notice) => void }) {
  const [editor, setEditor] = useState<EntityEditor>(null);
  async function removeEntity(kind: 'stop' | 'transport' | 'stay' | 'activity', id: string) {
    const warning = kind === 'stop'
      ? 'Remove this destination? Its stays, activities, and connected transport will also be removed. This cannot be undone.'
      : `Remove this ${kind}? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    const operation = { stop: operations.removeStop, transport: operations.removeTransport, stay: operations.removeStay, activity: operations.removeActivity }[kind];
    const field = { stop: 'removeTripStop', transport: 'removeTransportLeg', stay: 'removeStay', activity: 'removeActivity' }[kind];
    try {
      const data = await graphqlRequest<Record<string, Trip>, { id: string; expectedRevision: number }>(operation, { id, expectedRevision: trip.revision });
      onChanged(data[field]!);
      notify({ tone: 'success', message: `${kind[0]?.toUpperCase()}${kind.slice(1)} removed.` });
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  async function deleteTrip() {
    if (!window.confirm(`Delete “${trip.name}” and all of its itinerary data?`)) return;
    try {
      await graphqlRequest<{ deleteTrip: boolean }, { id: string; expectedRevision: number }>(operations.deleteTrip, { id: trip.id, expectedRevision: trip.revision });
      onDeleted();
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  return (
    <main id="main-content" className="detail-page trip-workbench" tabIndex={-1}>
      <header className="trip-workbench-header">
        <div className="trip-workbench-title"><h1>{trip.name}</h1><p>{formatDateRange(trip.startDate, trip.endDate)}</p></div>
        <div className="hero-actions"><button className="button-text" type="button" onClick={() => setEditor({ kind: 'trip' })}>Edit trip</button><button className="button-text button-danger" type="button" onClick={() => void deleteTrip()}>Delete</button></div>
      </header>
      <TripCalendar trip={trip} onChanged={onChanged}
        onActivity={(activity, stopId, scheduledLocal) => setEditor({ kind: 'activity', value: activity, stopId, scheduledLocal })}
        onStay={(stay, stopId) => setEditor({ kind: 'stay', value: stay, stopId })}
        onTransport={(leg, fromStopId, toStopId) => setEditor({ kind: 'transport', value: leg, fromStopId, toStopId })}
        onRemove={(kind, id) => void removeEntity(kind, id)} />

      {editor?.kind === 'trip' ? <TripEditor trip={trip} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'transport' ? <TransportEditor trip={trip} leg={editor.value} fromStopId={editor.fromStopId} toStopId={editor.toStopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stay' ? <StayEditor trip={trip} stay={editor.value} stopId={editor.stopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'activity' ? <ActivityEditor trip={trip} activity={editor.value} stopId={editor.stopId} scheduledLocal={editor.scheduledLocal} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
    </main>
  );
}

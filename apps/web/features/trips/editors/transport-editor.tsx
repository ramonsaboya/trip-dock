'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { deviceTimezone } from '../../../lib/device-timezone';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { dateTimeLocalToIso, dateTimeLocalToIsoPreserving, isoToDateTimeLocal, transportDateTimesForStops } from '../../../lib/trips/dates';
import { operations } from '../../../lib/trips/operations';
import { sortStopsByDate } from '../../../lib/trips/stops';
import { type TransportLeg, type Trip, type TripStop } from '../../../lib/trips/types';

export function transportTitle(fromStop: TripStop | undefined, toStop: TripStop | undefined): string {
  if (fromStop && toStop && fromStop.id === toStop.id) return '';
  return `${fromStop?.name ?? 'Origin'} to ${toStop?.name ?? 'Return point'}`;
}

export function TransportEditor({ trip, leg, fromStopId, toStopId, onClose, onSaved }: { trip: Trip; leg?: TransportLeg; fromStopId?: string | null; toStopId?: string | null; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = leg?.timezone ?? deviceTimezone();
  const initialFromStopId = (leg ? leg.fromStopId : fromStopId !== undefined ? fromStopId : sortedStops[0]?.id) ?? '';
  const initialToStopId = (leg ? leg.toStopId : toStopId !== undefined ? toStopId : sortedStops[1]?.id) ?? '';
  const initialFromStop = sortedStops.find((stop) => stop.id === initialFromStopId);
  const initialToStop = sortedStops.find((stop) => stop.id === initialToStopId);
  const initialTimes = transportDateTimesForStops(initialFromStop, initialToStop);
  const initialInput = {
    fromLocation: leg?.fromLocation ?? '',
    toLocation: leg?.toLocation ?? '',
    fromStopId: initialFromStopId,
    toStopId: initialToStopId,
    mode: leg?.mode ?? '',
    title: leg?.title ?? transportTitle(initialFromStop, initialToStop),
    details: leg?.details ?? null,
    departureTime: leg ? isoToDateTimeLocal(leg.departureTime, localTimezone) : initialTimes.departureTime,
    arrivalTime: leg ? isoToDateTimeLocal(leg.arrivalTime, localTimezone) : initialTimes.arrivalTime,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [dirtySuggested, setDirtySuggested] = useState(() => ({
    title: Boolean(leg),
    departureTime: Boolean(leg),
    arrivalTime: Boolean(leg),
  }));
  const [autoFields, setAutoFields] = useState(() => ({
    fromStopId: !leg && Boolean(initialFromStopId),
    toStopId: !leg && Boolean(initialToStopId),
    title: !leg && Boolean(transportTitle(initialFromStop, initialToStop)),
    departureTime: !leg && Boolean(initialTimes.departureTime),
    arrivalTime: !leg && Boolean(initialTimes.arrivalTime),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeInvalid = input.fromStopId === input.toStopId;
  const unchanged = Boolean(leg && JSON.stringify(input) === JSON.stringify(initialInput));
  const timesUnchanged = input.departureTime === initialInput.departureTime &&
    input.arrivalTime === initialInput.arrivalTime;

  function selectRoute(field: 'fromStopId' | 'toStopId', stopId: string) {
    const nextFromStopId = field === 'fromStopId' ? stopId : input.fromStopId;
    const nextToStopId = field === 'toStopId' ? stopId : input.toStopId;
    const nextFromStop = sortedStops.find((stop) => stop.id === nextFromStopId);
    const nextToStop = sortedStops.find((stop) => stop.id === nextToStopId);
    const times = transportDateTimesForStops(nextFromStop, nextToStop);
    const title = transportTitle(nextFromStop, nextToStop);
    setInput((current) => ({
      ...current,
      [field]: stopId,
      title: dirtySuggested.title ? current.title : title,
      departureTime: dirtySuggested.departureTime ? current.departureTime : times.departureTime,
      arrivalTime: dirtySuggested.arrivalTime ? current.arrivalTime : times.arrivalTime,
    }));
    setAutoFields((current) => ({
      ...current,
      [field]: false,
      title: dirtySuggested.title ? current.title : Boolean(title),
      departureTime: dirtySuggested.departureTime ? current.departureTime : Boolean(times.departureTime),
      arrivalTime: dirtySuggested.arrivalTime ? current.arrivalTime : Boolean(times.arrivalTime),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        fromStopId: input.fromStopId || null,
        toStopId: input.toStopId || null,
        fromLocation: input.fromStopId ? null : input.fromLocation,
        toLocation: input.toStopId ? null : input.toLocation,
        departureTime: leg
          ? dateTimeLocalToIsoPreserving(input.departureTime, input.timezone, leg.departureTime)
          : dateTimeLocalToIso(input.departureTime, input.timezone),
        arrivalTime: leg
          ? dateTimeLocalToIsoPreserving(input.arrivalTime, input.timezone, leg.arrivalTime)
          : dateTimeLocalToIso(input.arrivalTime, input.timezone),
        timezone: leg && timesUnchanged && input.timezone === initialInput.timezone ? leg.timezone : input.timezone,
      };
      const variables = leg ? { id: leg.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(leg ? operations.updateTransport : operations.addTransport, variables);
      onSaved(data[leg ? 'updateTransportLeg' : 'addTransportLeg']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={leg ? 'Edit transport' : 'Add transport'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <div className="form-grid form-grid-two"><Field label="From" fillStatus={autoFields.fromStopId ? 'auto' : undefined}><select value={input.fromStopId} onChange={(e) => selectRoute('fromStopId', e.target.value)}><option value="">Home / other origin</option>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.toStopId}>{stop.name}</option>)}</select></Field><Field label="To" fillStatus={autoFields.toStopId ? 'auto' : undefined}><select value={input.toStopId} onChange={(e) => selectRoute('toStopId', e.target.value)}><option value="">Home / return point</option>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.fromStopId}>{stop.name}</option>)}</select></Field></div>
        {!input.fromStopId ? <Field label="Origin"><input required value={input.fromLocation} onChange={(e) => setInput({ ...input, fromLocation: e.target.value })} placeholder="Home city or departure airport" /></Field> : null}
        {!input.toStopId ? <Field label="Return point"><input required value={input.toLocation} onChange={(e) => setInput({ ...input, toLocation: e.target.value })} placeholder="Home city or arrival airport" /></Field> : null}
        <div className="form-grid form-grid-two"><Field label="Mode"><input required value={input.mode} onChange={(e) => setInput({ ...input, mode: e.target.value })} placeholder="Train, flight, ferry…" /></Field><Field label="Title" fillStatus={autoFields.title ? 'auto' : undefined}><input required value={input.title} onChange={(e) => { setDirtySuggested((current) => ({ ...current, title: true })); setAutoFields((current) => ({ ...current, title: false })); setInput({ ...input, title: e.target.value }); }} /></Field></div>
        <details className="advanced-details"><summary>Notes and booking details</summary><Field label="Details"><textarea rows={2} value={input.details ?? ''} onChange={(e) => setInput({ ...input, details: e.target.value || null })} placeholder="Booking reference, route notes, or anything useful" /></Field></details>
        <div className="form-grid form-grid-two"><Field label="Departure" fillStatus={autoFields.departureTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.departureTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, departureTime: true })); setAutoFields((current) => ({ ...current, departureTime: false })); setInput({ ...input, departureTime: dateTime || null }); }} /></Field><Field label="Arrival" fillStatus={autoFields.arrivalTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.arrivalTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, arrivalTime: true })); setAutoFields((current) => ({ ...current, arrivalTime: false })); setInput({ ...input, arrivalTime: dateTime || null }); }} /></Field></div>
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
        {routeInvalid ? <p className="form-error">Choose two different destinations for this route.</p> : null}
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || routeInvalid || unchanged} type="submit">{busy ? 'Saving…' : 'Save transport'}</button></footer></form>
    </Dialog>
  );
}

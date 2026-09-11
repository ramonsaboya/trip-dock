'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { deviceTimezone } from '../../../lib/device-timezone';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { dateTimeLocalToIso, dateTimeLocalToIsoPreserving, isoToDateTimeLocal, stayDateTimesForStop } from '../../../lib/trips/dates';
import { operations } from '../../../lib/trips/operations';
import { sortStopsByDate } from '../../../lib/trips/stops';
import { type Stay, type Trip } from '../../../lib/trips/types';

export function StayEditor({ trip, stay, stopId, onClose, onSaved }: { trip: Trip; stay?: Stay; stopId?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = stay?.timezone ?? deviceTimezone();
  const initialStopId = stay?.stopId ?? stopId ?? sortedStops[0]?.id ?? '';
  const initialStop = sortedStops.find((stop) => stop.id === initialStopId);
  const initialDefaults = stayDateTimesForStop(initialStop);
  const initialName = initialStop ? `Stay in ${initialStop.name}` : '';
  const initialInput = {
    stopId: initialStopId,
    name: stay?.name ?? initialName,
    checkIn: stay ? isoToDateTimeLocal(stay.checkIn, localTimezone) : initialDefaults.checkIn,
    checkOut: stay ? isoToDateTimeLocal(stay.checkOut, localTimezone) : initialDefaults.checkOut,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [dirtySuggested, setDirtySuggested] = useState(() => ({ name: Boolean(stay), checkIn: Boolean(stay), checkOut: Boolean(stay) }));
  const [autoFields, setAutoFields] = useState(() => ({
    stopId: !stay && Boolean(initialStopId),
    name: !stay && Boolean(initialName),
    checkIn: !stay && Boolean(initialDefaults.checkIn),
    checkOut: !stay && Boolean(initialDefaults.checkOut),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(stay && JSON.stringify(input) === JSON.stringify(initialInput));
  const timesUnchanged = input.checkIn === initialInput.checkIn && input.checkOut === initialInput.checkOut;
  function selectStop(nextStopId: string) {
    const nextStop = sortedStops.find((stop) => stop.id === nextStopId);
    const defaults = stayDateTimesForStop(nextStop);
    const name = nextStop ? `Stay in ${nextStop.name}` : '';
    setInput((current) => ({
      ...current,
      stopId: nextStopId,
      name: dirtySuggested.name ? current.name : name,
      checkIn: dirtySuggested.checkIn ? current.checkIn : defaults.checkIn,
      checkOut: dirtySuggested.checkOut ? current.checkOut : defaults.checkOut,
    }));
    setAutoFields((current) => ({
      ...current,
      stopId: false,
      name: dirtySuggested.name ? current.name : Boolean(name),
      checkIn: dirtySuggested.checkIn ? current.checkIn : Boolean(defaults.checkIn),
      checkOut: dirtySuggested.checkOut ? current.checkOut : Boolean(defaults.checkOut),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        checkIn: stay
          ? dateTimeLocalToIsoPreserving(input.checkIn, input.timezone, stay.checkIn)
          : dateTimeLocalToIso(input.checkIn, input.timezone),
        checkOut: stay
          ? dateTimeLocalToIsoPreserving(input.checkOut, input.timezone, stay.checkOut)
          : dateTimeLocalToIso(input.checkOut, input.timezone),
        timezone: stay && timesUnchanged && input.timezone === initialInput.timezone ? stay.timezone : input.timezone,
      };
      const variables = stay ? { id: stay.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stay ? operations.updateStay : operations.addStay, variables);
      onSaved(data[stay ? 'updateStay' : 'addStay']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={stay ? 'Edit stay' : 'Add stay'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <details className="advanced-details"><summary>{trip.stops.find((stop) => stop.id === input.stopId)?.name} · change destination</summary><Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field></details>
        <Field label="Stay name" fillStatus={autoFields.name ? 'auto' : undefined}><input required value={input.name} onChange={(e) => { setDirtySuggested((current) => ({ ...current, name: true })); setAutoFields((current) => ({ ...current, name: false })); setInput({ ...input, name: e.target.value }); }} /></Field>
        <div className="form-grid form-grid-two"><Field label="Check-in" fillStatus={autoFields.checkIn ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkIn ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkIn: true })); setAutoFields((current) => ({ ...current, checkIn: false })); setInput({ ...input, checkIn: dateTime || null }); }} /></Field><Field label="Check-out" fillStatus={autoFields.checkOut ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkOut ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkOut: true })); setAutoFields((current) => ({ ...current, checkOut: false })); setInput({ ...input, checkOut: dateTime || null }); }} /></Field></div>
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save stay'}</button></footer></form>
    </Dialog>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { operations } from '../../../lib/trips/operations';
import { sortStopsByDate } from '../../../lib/trips/stops';
import { type Trip, type TripDraftStop, type TripStop } from '../../../lib/trips/types';
import { blankStop } from '../trip-defaults';

export function StopEditor({ trip, stop, onClose, onSaved }: { trip: Trip; stop?: TripStop; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const previous = sortedStops.at(-1);
  const previousHoldsTripEnd = previous?.departureDate === trip.endDate;
  const initialInput: TripDraftStop = stop
    ? { name: stop.name, locationText: stop.locationText, arrivalDate: stop.arrivalDate, departureDate: stop.departureDate }
    : {
      ...blankStop(),
      arrivalDate: previousHoldsTripEnd ? null : previous?.departureDate ?? null,
      departureDate: trip.endDate,
    };
  const [input, setInput] = useState<TripDraftStop>(() => initialInput);
  const [autoDates, setAutoDates] = useState(() => ({
    arrivalDate: !stop && Boolean(previous?.departureDate) && !previousHoldsTripEnd,
    departureDate: !stop && Boolean(trip.endDate),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(stop && JSON.stringify(input) === JSON.stringify(initialInput));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const variables = stop
        ? { id: stop.id, expectedRevision: trip.revision, input }
        : { tripId: trip.id, expectedRevision: trip.revision, input, moveTripEnd: autoDates.departureDate };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stop ? operations.updateStop : operations.addStop, variables);
      onSaved(data[stop ? 'updateTripStop' : 'addTripStop']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={stop ? 'Edit destination' : 'Add destination'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Start" fillStatus={autoDates.arrivalDate ? 'auto' : undefined}><DatePickerInput min={trip.startDate} max={(input.departureDate ?? trip.endDate) || undefined} value={input.arrivalDate ?? ''} onValueChange={(date) => { setAutoDates((current) => ({ ...current, arrivalDate: false })); setInput({ ...input, arrivalDate: date || null }); }} /></Field><Field label="End" fillStatus={autoDates.departureDate ? 'auto' : undefined}><DatePickerInput min={(input.arrivalDate ?? trip.startDate) || undefined} max={trip.endDate} value={input.departureDate ?? ''} onValueChange={(date) => { setAutoDates((current) => ({ ...current, departureDate: false })); setInput({ ...input, departureDate: date || null }); }} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save destination'}</button></footer></form>
    </Dialog>
  );
}

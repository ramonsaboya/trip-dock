'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { operations } from '../../../lib/trips/operations';
import { type Trip } from '../../../lib/trips/types';

export function TripEditor({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [original] = useState(trip);
  const initialInput = { name: original.name, destinationArea: original.destinationArea, startDate: original.startDate, endDate: original.endDate, travelerCount: original.travelerCount };
  const [input, setInput] = useState(() => initialInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = JSON.stringify(input) === JSON.stringify(initialInput);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const data = await graphqlRequest<{ updateTrip: Trip }, { id: string; expectedRevision: number; input: typeof input }>(operations.updateTrip, { id: original.id, expectedRevision: original.revision, input });
      onSaved(data.updateTrip);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title="Edit trip" onClose={onClose} wide>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Trip name"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <p className="planner-hint">Destination dates will adjust to fit the new trip dates. Activities that no longer fit return to the pool with their details intact. Stay and transport bookings keep their original dates.</p>
        <div className="form-grid form-grid-three"><Field label="Start date"><DatePickerInput required max={input.endDate || undefined} value={input.startDate} onValueChange={(date) => setInput({ ...input, startDate: date })} /></Field><Field label="End date"><DatePickerInput required min={input.startDate} value={input.endDate} onValueChange={(date) => setInput({ ...input, endDate: date })} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </Dialog>
  );
}

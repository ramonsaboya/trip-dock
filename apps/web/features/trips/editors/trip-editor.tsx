'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { operations } from '../../../lib/trips/operations';
import { sortStopsByDate } from '../../../lib/trips/stops';
import { type Trip } from '../../../lib/trips/types';

export function TripEditor({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [original] = useState(trip);
  const initialInput = { name: original.name, destinationArea: original.destinationArea, startDate: original.startDate, endDate: original.endDate, travelerCount: original.travelerCount,
    stops: sortStopsByDate(original.stops).map(stop => ({ id: stop.id, name: stop.name, arrivalDate: stop.arrivalDate ?? '', departureDate: stop.departureDate ?? '' })) };
  const [input, setInput] = useState(() => initialInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = JSON.stringify(input) === JSON.stringify(initialInput);
  function addDestination() {
    const id = crypto.randomUUID();
    setInput(current => ({ ...current, stops: [...current.stops, { id, name: '', arrivalDate: current.stops.at(-1)?.departureDate || current.endDate, departureDate: '' }] }));
  }
  function changeTripDate(field: 'startDate' | 'endDate', date: string) {
    setInput(current => {
      const startDate = field === 'startDate' ? date : current.startDate;
      const endDate = field === 'endDate' ? date : current.endDate;
      if (!startDate || !endDate || startDate > endDate) return { ...current, [field]: date };
      const ordered = [...current.stops].sort((left, right) => left.arrivalDate.localeCompare(right.arrivalDate) || left.departureDate.localeCompare(right.departureDate));
      const clamp = (value: string) => value ? (value < startDate ? startDate : value > endDate ? endDate : value) : value;
      return { ...current, startDate, endDate, stops: current.stops.map(stop => ({ ...stop,
        arrivalDate: clamp(stop.id === ordered[0]?.id && stop.arrivalDate === current.startDate ? startDate : stop.arrivalDate),
        departureDate: clamp(stop.id === ordered.at(-1)?.id && stop.departureDate === current.endDate ? endDate : stop.departureDate),
      })) };
    });
  }
  function changeDestinationDate(id: string, field: 'arrivalDate' | 'departureDate', date: string) {
    setInput(current => {
      const previous = current.stops.find(stop => stop.id === id)!;
      const stops = current.stops.map(stop => stop.id === id ? { ...stop, [field]: date } : stop);
      const earliest = stops.map(stop => stop.arrivalDate).filter(Boolean).sort()[0];
      const latest = stops.map(stop => stop.departureDate).filter(Boolean).sort().at(-1);
      return { ...current, stops,
        startDate: date && earliest ? (field === 'arrivalDate' && previous.arrivalDate === current.startDate ? earliest : earliest < current.startDate ? earliest : current.startDate) : current.startDate,
        endDate: date && latest ? (field === 'departureDate' && previous.departureDate === current.endDate ? latest : latest > current.endDate ? latest : current.endDate) : current.endDate,
      };
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const { stops, ...tripInput } = input;
      const savedInput = { ...tripInput,
        stops: stops.filter(stop => original.stops.some(value => value.id === stop.id)).map(({ id, arrivalDate, departureDate }) => ({ id, arrivalDate, departureDate })),
        newStops: stops.filter(stop => !original.stops.some(value => value.id === stop.id)).map(({ name, arrivalDate, departureDate }) => ({ name, locationText: null, arrivalDate, departureDate })),
      };
      const data = await graphqlRequest<{ updateTrip: Trip }, { id: string; expectedRevision: number; input: typeof savedInput }>(operations.updateTrip, { id: original.id, expectedRevision: original.revision, input: savedInput });
      onSaved(data.updateTrip);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title="Edit trip" onClose={onClose} wide>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <fieldset className="stops-editor" disabled={busy}>
          <legend>Trip details</legend>
          <div className="destination-fields">
            <Field label="Trip name"><input required maxLength={160} value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
            <Field label="Start date"><DatePickerInput required max={input.endDate || undefined} value={input.startDate} onValueChange={(date) => changeTripDate('startDate', date)} /></Field>
            <Field label="End date"><DatePickerInput required min={input.startDate} value={input.endDate} onValueChange={(date) => changeTripDate('endDate', date)} /></Field>
          </div>
        </fieldset>
        <p>Adjust your destination dates or add another city, then save your trip.</p>
        <fieldset className="stops-editor" disabled={busy}>
          <legend>Destinations</legend>
          {input.stops.map((stop, index) => <div key={stop.id} className="draft-stop" role="group" aria-label={`Destination ${index + 1}`}>
            <div className="draft-stop-heading"><strong>{index === 0 ? 'Your destination' : `Destination ${index + 1}`}</strong>
              {!original.stops.some(value => value.id === stop.id) ? <button type="button" className="icon-button remove-destination" aria-label={`Remove new destination ${index + 1}`} onClick={() => setInput(current => ({ ...current, stops: current.stops.filter(value => value.id !== stop.id) }))}>×</button> : null}
            </div>
            <div className="destination-fields">
              <Field label="City"><input required maxLength={120} readOnly={original.stops.some(value => value.id === stop.id)} value={stop.name} placeholder="A specific city" onChange={event => setInput(current => ({ ...current, stops: current.stops.map(value => value.id === stop.id ? { ...value, name: event.target.value } : value) }))} /></Field>
              <Field label="Arrival date"><DatePickerInput required value={stop.arrivalDate} max={stop.departureDate || undefined} onValueChange={date => changeDestinationDate(stop.id, 'arrivalDate', date)} /></Field>
              <Field label="Departure date"><DatePickerInput required value={stop.departureDate} min={stop.arrivalDate || undefined} onValueChange={date => changeDestinationDate(stop.id, 'departureDate', date)} /></Field>
            </div>
          </div>)}
          <button type="button" className="button-secondary add-destination" disabled={input.stops.length >= 20} onClick={addDestination}>+ Add destination</button>
        </fieldset>
        <p className="planner-hint">Activities that no longer fit return to the pool with their details intact. Stay and transport bookings keep their original dates.</p>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </Dialog>
  );
}

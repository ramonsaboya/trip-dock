'use client';

import { useState, type FormEvent } from 'react';
import { DatePickerInput } from '../../../components/ui/date-picker-input';
import { Dialog } from '../../../components/ui/dialog';
import { Field } from '../../../components/ui/field';
import { deviceTimezone } from '../../../lib/device-timezone';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { activityDateTimeForStop, dateTimeLocalToIso, dateTimeLocalToIsoPreserving, isoToDateTimeLocal } from '../../../lib/trips/dates';
import { operations } from '../../../lib/trips/operations';
import { sortStopsByDate } from '../../../lib/trips/stops';
import { type Activity, type Trip } from '../../../lib/trips/types';

export function ActivityEditor({ trip, activity, stopId, scheduledLocal, onClose, onSaved }: { trip: Trip; activity?: Activity; stopId?: string; scheduledLocal?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = activity?.timezone ?? deviceTimezone();
  const initialStopId = activity?.stopId ?? stopId ?? sortedStops[0]?.id ?? '';
  const initialInput = {
    stopId: initialStopId,
    title: activity?.title ?? '',
    status: activity?.status ?? 'IDEA' as Activity['status'],
    durationMinutes: activity?.durationMinutes ?? 60,
    scheduledAt: activity ? isoToDateTimeLocal(activity.scheduledAt, localTimezone) : scheduledLocal ?? null,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [autoFields, setAutoFields] = useState(() => ({
    stopId: !activity && Boolean(initialStopId),
    status: !activity,
    scheduledAt: false,
  }));
  const suggestedTime = activityDateTimeForStop(sortedStops.find((stop) => stop.id === input.stopId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(activity && JSON.stringify(input) === JSON.stringify(initialInput));
  const scheduledTimeUnchanged = input.scheduledAt === initialInput.scheduledAt;
  function selectStop(nextStopId: string) {
    setInput((current) => ({
      ...current,
      stopId: nextStopId,
    }));
    setAutoFields((current) => ({
      ...current,
      stopId: false,
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        scheduledAt: activity
          ? dateTimeLocalToIsoPreserving(input.scheduledAt, input.timezone, activity.scheduledAt)
          : dateTimeLocalToIso(input.scheduledAt, input.timezone),
        timezone: activity && scheduledTimeUnchanged && input.timezone === initialInput.timezone ? activity.timezone : input.timezone,
      };
      const variables = activity ? { id: activity.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(activity ? operations.updateActivity : operations.addActivity, variables);
      onSaved(data[activity ? 'updateActivity' : 'addActivity']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={activity ? 'Edit activity' : 'Add activity'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <details className="advanced-details"><summary>{trip.stops.find((stop) => stop.id === input.stopId)?.name} · change destination</summary><Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field></details>
        <Field label="Activity title"><input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Booking status" fillStatus={autoFields.status ? 'auto' : undefined}><select value={input.status} onChange={(e) => { setAutoFields((current) => ({ ...current, status: false })); setInput({ ...input, status: e.target.value as Activity['status'] }); }}><option value="IDEA">Idea</option><option value="PLANNED">Planned · not booked</option><option value="BOOKED">Booked</option><option value="DONE">Done</option></select></Field><Field label="Scheduled time (optional)" hint="Leave blank to keep this activity in the idea pool." fillStatus={autoFields.scheduledAt ? 'suggested' : undefined}><DatePickerInput includeTime value={input.scheduledAt ?? ''} onValueChange={(dateTime) => { setAutoFields((current) => ({ ...current, scheduledAt: false })); setInput({ ...input, scheduledAt: dateTime || null }); }} /></Field></div>
        {!input.scheduledAt && suggestedTime ? <button className="button-text" type="button" onClick={() => { setInput({ ...input, scheduledAt: suggestedTime }); setAutoFields((current) => ({ ...current, scheduledAt: true })); }}>Use first day · {suggestedTime.replace('T', ' at ')}</button> : null}
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save activity'}</button></footer></form>
    </Dialog>
  );
}

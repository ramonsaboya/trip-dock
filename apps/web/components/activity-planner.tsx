'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { activityAssignment, activityMoveInput, daySlots, destinationDays } from '../lib/activity-planning';
import { formatDateTime, graphqlRequest, operations, type Activity, type Trip, type TripStop } from '../lib/graphql-client';

const statusLabels = { IDEA: 'Idea', PLANNED: 'Planned · not booked', BOOKED: 'Booked', DONE: 'Done' };

export function ActivityPlanner({ trip, stop, onChanged, onEdit, onRemove }: {
  trip: Trip; stop: TripStop; onChanged: (trip: Trip) => void;
  onEdit: (activity: Activity) => void; onRemove: (id: string) => void;
}) {
  const days = destinationDays(stop);
  const activities = trip.activities.filter((activity) => activity.stopId === stop.id);
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [move, setMove] = useState<{ activity: Activity; stopId: string; day: string; slot: string; timezone: string } | null>(null);
  const moveHeading = useRef<HTMLParagraphElement>(null);
  const movingActivityId = move?.activity.id;
  useEffect(() => { if (movingActivityId) moveHeading.current?.focus(); }, [movingActivityId]);
  const moveDays = destinationDays(trip.stops.find((item) => item.id === move?.stopId) ?? stop);

  async function assign(activity: Activity, stopId: string, day: string, slot: string, timezone: string) {
    if (moving.current) return;
    moving.current = true; setBusy(true); setError('');
    try {
      const data = await graphqlRequest<{ updateActivity: Trip }, Record<string, unknown>>(operations.updateActivity, {
        id: activity.id, expectedRevision: trip.revision,
        input: activityMoveInput(activity, stopId, day, slot, timezone),
      });
      onChanged(data.updateActivity); setMove(null);
      setMessage(`${activity.title} moved ${day ? `to ${day}, ${slot}` : 'to the idea pool'}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move activity.'); }
    finally { moving.current = false; setBusy(false); }
  }

  function drop(event: DragEvent, day = '', slot = 'morning') {
    event.preventDefault();
    const activity = trip.activities.find((item) => item.id === event.dataTransfer.getData('application/tripdock-activity'));
    if (activity) void assign(activity, stop.id, day, slot, activity.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  function card(activity: Activity) {
    return <article className="activity-card" key={activity.id} draggable={!busy}
      onDragStart={(event) => { event.dataTransfer.setData('application/tripdock-activity', activity.id); event.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" className="record-main" onClick={() => onEdit(activity)} disabled={busy}>
        <span className={`entity-label activity-${activity.status.toLowerCase()}`}>{statusLabels[activity.status]}</span>
        <strong>{activity.title}</strong>{activity.scheduledAt ? <small>{formatDateTime(activity.scheduledAt, activity.timezone)}</small> : null}
      </button>
      <div className="entity-actions"><button type="button" className="button-text" disabled={busy} onClick={() => setMove({ activity, stopId: stop.id, day: activityAssignment(activity)?.day ?? '', slot: activityAssignment(activity)?.slot ?? 'morning', timezone: activity.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })}>Move</button>
        <button type="button" className="button-text button-danger" disabled={busy} aria-label={`Remove ${activity.title}`} onClick={() => onRemove(activity.id)}>Remove</button></div>
    </article>;
  }

  return <div className="activity-planner" aria-busy={busy}>
    <div className="idea-pool" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event)}>
      <h4>Idea pool <span>{activities.filter((item) => !item.scheduledAt).length}</span></h4>
      <p className="planner-hint">Drag an activity to a day, or use Move. Booking status stays the same. Times follow the activity’s timezone; if unset, they use {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      {activities.filter((item) => !item.scheduledAt).map(card)}
    </div>
    {!days.length ? <p className="planner-hint">Set arrival and departure dates for {stop.name} to plan each day.</p> : null}
    <div className="planner-days">{days.map((day, index) => <details className="planner-day" key={day} open={index === 0 ? true : undefined}>
      <summary onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, day)}><span>Day {index + 1}</span><strong>{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</strong><small>{activities.filter((item) => activityAssignment(item)?.day === day).length} activities</small></summary>
      <div className="day-slots">{daySlots.map((slot) => <section className="day-slot" key={slot.key} aria-label={`${day} ${slot.label}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, day, slot.key)}>
        <h4>{slot.label}</h4>{activities.filter((item) => { const assignment = activityAssignment(item); return assignment?.day === day && assignment.slot === slot.key; }).map(card)}
        <p className="slot-hint">Drop here · {slot.time}</p>
      </section>)}</div>
    </details>)}</div>
    {activities.some((item) => item.scheduledAt && !days.includes(activityAssignment(item)?.day ?? '')) ? <div className="idea-pool"><h4>Outside destination dates</h4>{activities.filter((item) => item.scheduledAt && !days.includes(activityAssignment(item)?.day ?? '')).map(card)}</div> : null}
    {move ? <form className="activity-move" onSubmit={(event) => { event.preventDefault(); void assign(move.activity, move.stopId, move.day, move.slot, move.timezone); }}>
      <p ref={moveHeading} tabIndex={-1}><strong>Move {move.activity.title}</strong></p>
      <label>Destination<select value={move.stopId} onChange={(event) => setMove({ ...move, stopId: event.target.value, day: '' })}>{trip.stops.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Day<select value={move.day} onChange={(event) => setMove({ ...move, day: event.target.value })}><option value="">Idea pool · unassigned</option>{moveDays.map((day) => <option value={day} key={day}>{day}</option>)}</select></label>
      {move.day ? <><label>Time of day<select value={move.slot} onChange={(event) => setMove({ ...move, slot: event.target.value })}>{daySlots.map((slot) => <option value={slot.key} key={slot.key}>{slot.label} · {slot.time}</option>)}</select></label><label>Timezone<input required value={move.timezone} onChange={(event) => setMove({ ...move, timezone: event.target.value })} /></label></> : null}
      <div className="entity-actions"><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Moving…' : 'Move activity'}</button><button type="button" className="button-text" onClick={() => setMove(null)}>Cancel</button></div>
    </form> : null}
    <p role="status" className="planner-hint">{message}</p>{error ? <p role="alert" className="form-error">{error}</p> : null}
  </div>;
}

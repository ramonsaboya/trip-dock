'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { activityAssignment, activityMoveInput, calendarHours, destinationDays } from '../lib/activity-planning';
import { graphqlRequest, operations, type Activity, type Trip, type TripStop } from '../lib/graphql-client';

const statusLabels = { IDEA: 'Idea', PLANNED: 'Not booked', BOOKED: 'Booked', DONE: 'Done' };
const dragType = 'application/tripdock-activity';
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function ActivityPlanner({ trip, stop, onChanged, onEdit, onRemove }: {
  trip: Trip; stop: TripStop; onChanged: (trip: Trip) => void;
  onEdit: (activity: Activity) => void; onRemove: (id: string) => void;
}) {
  const days = destinationDays(stop);
  const activities = trip.activities.filter((activity) => activity.stopId === stop.id);
  const [selectedDay, setSelectedDay] = useState(days[0] ?? '');
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0] ?? '';
  const [view, setView] = useState<'day' | 'week'>('week');
  const activeIndex = Math.max(0, days.indexOf(activeDay));
  const weekStart = Math.floor(activeIndex / 7) * 7;
  const visibleDays = view === 'day' ? days.filter((day) => day === activeDay) : days.slice(weekStart, weekStart + 7);
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [move, setMove] = useState<{ activity: Activity; stopId: string; day: string; time: string; timezone: string } | null>(null);
  const moveHeading = useRef<HTMLParagraphElement>(null);
  const movingActivityId = move?.activity.id;
  useEffect(() => { if (movingActivityId) moveHeading.current?.focus(); }, [movingActivityId]);
  const calendar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = calendar.current;
    const firstHour = board?.querySelector<HTMLElement>('[data-hour="08:00"]');
    if (board && firstHour) board.scrollTop += firstHour.getBoundingClientRect().top - board.getBoundingClientRect().top - 48;
  }, [stop.id, view, activeDay]);
  const moveDays = destinationDays(trip.stops.find((item) => item.id === move?.stopId) ?? stop);

  async function assign(activity: Activity, stopId: string, day: string, time: string, timezone: string) {
    if (moving.current) return;
    moving.current = true; setBusy(true); setError(''); setDropTarget('');
    try {
      const data = await graphqlRequest<{ updateActivity: Trip }, Record<string, unknown>>(operations.updateActivity, {
        id: activity.id, expectedRevision: trip.revision,
        input: activityMoveInput(activity, stopId, day, time, timezone),
      });
      onChanged(data.updateActivity); setMove(null);
      setMessage(`${activity.title} moved ${day ? `to ${dateLabel(day)} at ${time}` : 'to the idea pool'}.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move activity.'); }
    finally { moving.current = false; setBusy(false); }
  }

  function dragOver(event: DragEvent, target: string) {
    if (busy || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(target);
  }

  function drop(event: DragEvent, day = '', time = '09:00') {
    event.preventDefault(); setDropTarget('');
    const activity = trip.activities.find((item) => item.id === event.dataTransfer.getData(dragType));
    if (activity) void assign(activity, stop.id, day, time, activity.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  function card(activity: Activity) {
    const assignment = activityAssignment(activity);
    return <article className={`calendar-note note-${activity.status.toLowerCase()}`} key={activity.id} draggable={!busy}
      onDragEnd={() => setDropTarget('')}
      onDragStart={(event) => { event.dataTransfer.setData(dragType, activity.id); event.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" className="record-main" onClick={() => onEdit(activity)} disabled={busy}>
        <span className="note-meta">{assignment ? `${assignment.time} · ` : ''}{statusLabels[activity.status]}</span>
        <strong>{activity.title}</strong>
      </button>
      <div className="note-actions"><button type="button" className="button-text" disabled={busy} aria-label={`Move ${activity.title}`} onClick={() => setMove({ activity, stopId: stop.id, day: assignment?.day ?? '', time: assignment?.time ?? '09:00', timezone: activity.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone })}>Move</button>
        <button type="button" className="button-text button-danger" disabled={busy} aria-label={`Remove ${activity.title}`} onClick={() => onRemove(activity.id)}>×</button></div>
    </article>;
  }

  return <div className="activity-planner calendar-planner" aria-busy={busy}>
    <div className="calendar-toolbar">
      <div className="calendar-day-picker" aria-label="Destination days">{days.map((day) => <button key={day} type="button" aria-pressed={activeDay === day} onClick={() => { setSelectedDay(day); setView('day'); }}>{dateLabel(day)}</button>)}</div>
      {days.length ? <div className="calendar-view-picker" aria-label="Calendar view"><button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}>Day</button><button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button></div> : null}
    </div>
    {move ? <form className="activity-move calendar-move" onSubmit={(event) => { event.preventDefault(); void assign(move.activity, move.stopId, move.day, move.time, move.timezone); }}>
      <p ref={moveHeading} tabIndex={-1}><strong>Move {move.activity.title}</strong></p>
      <label>Destination<select value={move.stopId} onChange={(event) => setMove({ ...move, stopId: event.target.value, day: '' })}>{trip.stops.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Day<select value={move.day} onChange={(event) => setMove({ ...move, day: event.target.value })}><option value="">Idea pool · unassigned</option>{move.day && !moveDays.includes(move.day) ? <option value={move.day}>{dateLabel(move.day)} · outside dates</option> : null}{moveDays.map((day) => <option value={day} key={day}>{dateLabel(day)}</option>)}</select></label>
      {move.day ? <><label>Time<input required type="time" value={move.time} onChange={(event) => setMove({ ...move, time: event.target.value })} /></label><label>Timezone<input required value={move.timezone} onChange={(event) => setMove({ ...move, timezone: event.target.value })} /></label></> : null}
      <div className="entity-actions"><button type="submit" className="button-primary" disabled={busy}>{busy ? 'Moving…' : 'Move activity'}</button><button type="button" className="button-text" onClick={() => setMove(null)}>Cancel</button></div>
    </form> : null}
    <div className="calendar-workspace">
      <aside className={`calendar-pool ${dropTarget === 'pool' ? 'drop-active' : ''}`} onDragOver={(event) => dragOver(event, 'pool')} onDrop={(event) => drop(event)}>
        <h4>Idea pool <span>{activities.filter((item) => !item.scheduledAt).length}</span></h4>
        <p className="planner-hint">Drag onto an hour, or choose Move.</p>
        {activities.filter((item) => !item.scheduledAt).map(card)}
        <p className="pool-return">Drop here to unschedule</p>
        {activities.some((item) => item.scheduledAt && !days.includes(activityAssignment(item)?.day ?? '')) ? <div className="outside-dates"><h4>Outside these dates</h4>{activities.filter((item) => item.scheduledAt && !days.includes(activityAssignment(item)?.day ?? '')).map(card)}</div> : null}
      </aside>
      {!days.length ? <p className="planner-hint">Set arrival and departure dates for {stop.name} to open its calendar.</p> : <div ref={calendar} className="calendar-scroll" tabIndex={0} role="region" aria-label={`${stop.name} activity calendar`}>
        <div className="hour-calendar" role="table" aria-label="Activities by day and hour" style={{ gridTemplateColumns: `52px repeat(${visibleDays.length}, minmax(${view === 'day' ? '240' : '165'}px, 1fr))` }}>
          <div className="calendar-grid-row" role="row"><div className="calendar-corner" role="columnheader">Time</div>{visibleDays.map((day) => <div className="calendar-column-heading" role="columnheader" key={day}><button type="button" onClick={() => { setSelectedDay(day); setView('day'); }}>{dateLabel(day)}</button></div>)}</div>
          {calendarHours.map((hour) => <div className="calendar-grid-row" role="row" key={hour}><div className="calendar-hour" role="rowheader" data-hour={hour}>{hour}</div>{visibleDays.map((day) => <div key={`${day}-${hour}`} role="cell" aria-label={`${dateLabel(day)} at ${hour}`} className={`calendar-cell ${dropTarget === `${day}-${hour}` ? 'drop-active' : ''}`} onDragOver={(event) => dragOver(event, `${day}-${hour}`)} onDrop={(event) => drop(event, day, hour)}>
            {activities.filter((item) => { const assignment = activityAssignment(item); return assignment?.day === day && assignment.hour === hour; }).sort((a, b) => (activityAssignment(a)?.time ?? '').localeCompare(activityAssignment(b)?.time ?? '') || a.position - b.position).map(card)}
          </div>)}</div>)}
        </div>
      </div>}
    </div>
    <p className="planner-hint">Times follow each activity’s timezone; if unset, {Intl.DateTimeFormat().resolvedOptions().timeZone}. Moving an activity keeps its booking status.</p>
    <p role="status" className="planner-hint">{message}</p>{error ? <p role="alert" className="form-error">{error}</p> : null}
  </div>;
}

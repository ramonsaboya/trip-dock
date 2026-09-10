'use client';

import { useEffect, useRef, useState, type PointerEvent, type DragEvent } from 'react';
import { activityAssignment, activityMoveInput, calendarHours } from '../lib/activity-planning';
import { calendarColumns, calendarHourDestination, calendarTransition, calendarStartHour, stayCoversDay, transportPlacement, transportMoveInput, tripRoutes } from '../lib/trip-calendar';
import { dateTimeLocalToIso, formatDateTime, graphqlRequest, operations, sortStopsByDate, type Activity, type Stay, type TransportLeg, type Trip, type TripStop } from '../lib/graphql-client';

const statuses = { IDEA: 'Idea', PLANNED: 'Not booked', BOOKED: 'Booked', DONE: 'Done' };
const dragType = 'application/tripdock-activity';
const transportDragType = 'application/tripdock-transport';
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function TripCalendar({ trip, onChanged, onActivity, onStay, onTransport, onDestination, onRemove }: {
  trip: Trip; onChanged: (trip: Trip) => void;
  onActivity: (activity?: Activity, stopId?: string, scheduledLocal?: string) => void;
  onStay: (stay?: Stay, stopId?: string) => void;
  onTransport: (leg?: TransportLeg, fromStopId?: string | null, toStopId?: string | null) => void;
  onDestination: (stop: TripStop) => void;
  onRemove: (kind: 'activity' | 'stay' | 'transport' | 'stop', id: string) => void;
}) {
  const columns = calendarColumns(trip);
  const stops = sortStopsByDate(trip.stops);
  const routes = tripRoutes(trip);
  const visible = columns;
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const [selectedCell, setSelectedCell] = useState('');
  const suppressClick = useRef(false);
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, select, textarea, summary, [draggable="true"]')) return;
    const board = event.currentTarget;
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: board.scrollLeft, top: board.scrollTop };
    suppressClick.current = false;
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) return;
    if (!panning && Math.hypot(start.x - event.clientX, start.y - event.clientY) < 5) return;
    suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
    event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
    event.currentTarget.scrollTop = start.top + start.y - event.clientY;
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.id !== event.pointerId) return;
    pan.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const header = useRef<HTMLTableSectionElement>(null);
  const firstHour = calendarStartHour(trip, visible.map((column) => column.day));
  const firstDate = visible[0]?.day;
  const lastDate = visible.at(-1)?.day;
  useEffect(() => {
    const board = viewport.current;
    const morning = board?.querySelector<HTMLElement>(`[data-hour="${firstHour}"]`);
    if (board && morning) board.scrollTop += morning.getBoundingClientRect().top - board.getBoundingClientRect().top - (header.current?.offsetHeight ?? 180);
  }, [firstHour, firstDate, lastDate, trip.id]);
  const daySet = new Set(columns.map((item) => item.day));
  const unplacedActivities = trip.activities.filter((activity) => !activity.scheduledAt || !daySet.has(activityAssignment(activity)?.day ?? ''));
  const unplacedTransport = trip.transportLegs.filter((leg) => !daySet.has(transportPlacement(leg, stops).day ?? ''));
  const unplacedStays = trip.stays.filter((stay) => !columns.some((column) => stayCoversDay(stay, column.day, stops)));
  const bands: Array<{ key: string; color: number; span: number; destinations: TripStop[] }> = [];
  visible.forEach((column) => {
    const destinations = column.destinations.length > 1 ? [column.destinations[0], column.destinations.at(-1)] : [column.destinations[0]];
    destinations.forEach((destination) => {
      const key = destination?.id ?? 'unassigned';
      const span = 2 / destinations.length;
      const last = bands.at(-1);
      if (last?.key === key) last.span += span;
      else bands.push({ key, color: destination ? stops.findIndex((stop) => stop.id === destination.id) % 5 : -1, span, destinations: destination ? [destination] : [] });
    });
  });

  async function drop(event: DragEvent, stopId?: string, day = '', time = '09:00') {
    event.preventDefault(); setDropTarget('');
    if (moving.current) return;
    const activity = trip.activities.find((item) => item.id === event.dataTransfer.getData(dragType));
    const leg = trip.transportLegs.find((item) => item.id === event.dataTransfer.getData(transportDragType));
    if (leg && day) {
      moving.current = true; setBusy(true); setError('');
      try {
        const input = transportMoveInput(leg, day, time, leg.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
        const data = await graphqlRequest<{ updateTransportLeg: Trip }, Record<string, unknown>>(operations.updateTransport, { id: leg.id, expectedRevision: trip.revision, input });
        onChanged(data.updateTransportLeg);
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not move transport.'); }
      finally { moving.current = false; setBusy(false); }
      return;
    }
    if (!activity) return;
    moving.current = true; setBusy(true); setError('');
    try {
      const input = activityMoveInput(activity, stopId ?? activity.stopId, day, time, activity.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      const data = await graphqlRequest<{ updateActivity: Trip }, Record<string, unknown>>(operations.updateActivity, { id: activity.id, expectedRevision: trip.revision, input });
      onChanged(data.updateActivity);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not move activity.'); }
    finally { moving.current = false; setBusy(false); }
  }
  function dragOver(event: DragEvent, key: string) {
    if (busy || (!event.dataTransfer.types.includes(dragType) && (key === 'pool' || !event.dataTransfer.types.includes(transportDragType)))) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(key);
  }
  async function saveDuration(key: string, minutes: number, activity?: Activity, leg?: TransportLeg, route?: ReturnType<typeof tripRoutes>[number]) {
    if (moving.current) return;
    moving.current = true; setBusy(true); setError('');
    try {
      let operation: string; let field: string; let input: Record<string, unknown>;
      if (activity) {
        operation = operations.updateActivity; field = 'updateActivity';
        input = { stopId: activity.stopId, title: activity.title, status: activity.status, scheduledAt: activity.scheduledAt ? new Date(activity.scheduledAt).toISOString() : null, timezone: activity.timezone, durationMinutes: minutes };
      } else {
        const timezone = leg?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const placement = leg ? transportPlacement(leg, stops) : { day: route?.day, hour: '10:00' };
        const departureTime = leg?.departureTime ? new Date(leg.departureTime).toISOString() : dateTimeLocalToIso(placement.day + 'T' + placement.hour, timezone);
        if (!departureTime) throw new Error('Choose a departure day first.');
        input = { fromStopId: leg?.fromStopId ?? route?.fromStopId ?? null, toStopId: leg?.toStopId ?? route?.toStopId ?? null,
          fromLocation: leg?.fromLocation ?? (!route?.fromStopId && !leg?.fromStopId ? 'Home' : null), toLocation: leg?.toLocation ?? (!route?.toStopId && !leg?.toStopId ? 'Home' : null),
          title: leg?.title ?? route?.label, mode: leg?.mode ?? 'TRAVEL', details: leg?.details ?? null, timezone, departureTime,
          arrivalTime: new Date(new Date(departureTime).getTime() + minutes * 60000).toISOString() };
        operation = leg ? operations.updateTransport : operations.addTransport; field = leg ? 'updateTransportLeg' : 'addTransportLeg';
      }
      const variables = { ...(activity || leg ? { id: activity?.id ?? leg?.id } : { tripId: trip.id }), expectedRevision: trip.revision, input };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(operation, variables);
      onChanged(data[field]!);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not resize card.'); }
    finally { setDurations((current) => { const next = { ...current }; delete next[key]; return next; }); moving.current = false; setBusy(false); }
  }
  function resizeHandle(key: string, minutes: number, max: number, activity?: Activity, leg?: TransportLeg, route?: ReturnType<typeof tripRoutes>[number]) {
    return <DurationHandle minutes={minutes} max={max} disabled={busy} onPreview={(value) => setDurations((current) => ({ ...current, [key]: value }))} onCommit={(value) => void saveDuration(key, value, activity, leg, route)} />;
  }
  function activityNote(activity: Activity) {
    const assignment = activityAssignment(activity);
    const minutes = durations[activity.id] ?? activity.durationMinutes ?? 60;
    return <article className={`calendar-note note-${activity.status.toLowerCase()}`} style={assignment ? { height: minutes / 60 * 80 - 10 } : undefined} onPointerDown={(event) => event.stopPropagation()} key={activity.id} draggable={!busy} onDragEnd={() => setDropTarget('')} onDragStart={(event) => { event.dataTransfer.setData(dragType, activity.id); event.dataTransfer.effectAllowed = 'move'; }}>
      <button className="record-main" draggable={!busy} type="button" disabled={busy} onClick={() => onActivity(activity)}><span className="note-meta">{assignment ? `${assignment.time} · ` : ''}{statuses[activity.status]}</span><strong>{activity.title}</strong><small>{stops.find((stop) => stop.id === activity.stopId)?.name}</small></button>
      <div className="note-actions"><button className="button-text button-danger" type="button" disabled={busy} aria-label={`Remove ${activity.title}`} onClick={() => onRemove('activity', activity.id)}>×</button></div>{assignment ? resizeHandle(activity.id, minutes, (24 - Number(assignment.hour.slice(0, 2))) * 60, activity) : null}
    </article>;
  }
  function transportNote(leg: TransportLeg) {
    const placement = transportPlacement(leg, stops);
    const minutes = durations[leg.id] ?? (leg.departureTime && leg.arrivalTime ? Math.max(30, (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000) : 120);
    const from = stops.find((stop) => stop.id === leg.fromStopId)?.name ?? leg.fromLocation;
    const to = stops.find((stop) => stop.id === leg.toStopId)?.name ?? leg.toLocation;
    return <article className="journey-note" style={{ height: Math.min(minutes, (24 - Number(placement.hour.slice(0, 2))) * 60) / 60 * 80 - 10 }} key={leg.id} draggable={!busy} onPointerDown={(event) => event.stopPropagation()} onDragEnd={() => setDropTarget('')} onDragStart={(event) => { event.dataTransfer.setData(transportDragType, leg.id); event.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" draggable={!busy} className="record-main" onClick={() => onTransport(leg)}><span className="journey-note-mode">↗ {leg.mode}</span><strong>{leg.title}</strong><span>{from} → {to}</span><small>{placement.suggested ? '10 a.m.–12 p.m. placeholder · time to confirm' : `${formatDateTime(leg.departureTime, leg.timezone)} → ${formatDateTime(leg.arrivalTime, leg.timezone)}`}</small></button>
      <div className="journey-note-actions"><button type="button" className="button-text button-danger" aria-label={`Remove ${leg.title}`} onClick={() => onRemove('transport', leg.id)}>×</button></div>{resizeHandle(leg.id, minutes, (24 - Number(placement.hour.slice(0, 2))) * 60, undefined, leg)}
    </article>;
  }
  function stayButton(stay: Stay) {
    return <div className="calendar-stay" key={stay.id}><button type="button" onClick={() => onStay(stay)}><strong>{stay.name}</strong><small>{!stay.checkIn || !stay.checkOut ? 'Dates to confirm' : `${formatDateTime(stay.checkIn, stay.timezone)} → ${formatDateTime(stay.checkOut, stay.timezone)}`}</small></button><button type="button" className="button-text button-danger" aria-label={`Remove ${stay.name}`} onClick={() => onRemove('stay', stay.id)}>×</button></div>;
  }

  return <section className="unified-trip-calendar" aria-label="Trip calendar" aria-busy={busy}>
    <div className="trip-calendar-workspace">
      <div className="calendar-surface">
      <div className={`trip-calendar-scroll ${panning ? 'is-panning' : ''}`} ref={viewport} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} tabIndex={0} role="region" aria-label="Itinerary by date">
        <table className="trip-calendar-table"><colgroup><col style={{ width: 62 }} />{visible.flatMap((column) => [<col key={column.day + "-am"} />, <col key={column.day + "-pm"} />])}</colgroup>
          <thead ref={header}>
            <tr className="destination-band">{bands.map((band, index) => <th key={`${band.key}-${index}`} colSpan={band.span + (index === 0 ? 1 : 0)} className={`destination-tint-${band.color}`} scope="colgroup">{band.destinations.length ? band.destinations.map((stop, stopIndex) => <span key={stop.id}>{stopIndex ? <span className="shared-place-divider"> / </span> : null}<button type="button" onClick={() => onDestination(stop)}><span>{String(stops.findIndex((item) => item.id === stop.id) + 1).padStart(2, '0')}</span> {stop.name}</button></span>) : 'Dates open'}</th>)}</tr>
            <tr className="calendar-stay-row">{bands.map((band, index) => <td key={band.key + index} colSpan={band.span + (index === 0 ? 1 : 0)}><div className="calendar-stay-items">{trip.stays.filter((stay) => band.destinations.some((stop) => stop.id === stay.stopId)).map(stayButton)}</div>{band.destinations.map((stop) => <button key={stop.id} type="button" className="calendar-add-stay" onClick={() => onStay(undefined, stop.id)}>+ Stay</button>)}</td>)}</tr>
            <tr className="calendar-date-row"><th scope="row">Date</th>{visible.map((column) => <th scope="col" colSpan={2} key={column.day} className={`destination-tint-${column.color}`}>{dateLabel(column.day)}</th>)}</tr>

          </thead>
          <tbody>

            {calendarHours.map((hour) => <tr key={hour} data-calendar-hour={hour}><th scope="row" data-hour={hour}>{hour}</th>{visible.map((column) => { const destination = calendarHourDestination(trip, column.day, hour); const tint = destination ? stops.findIndex((stop) => stop.id === destination.id) % 5 : -1; const transition = calendarTransition(trip, column.day, hour); const hasPlaceholder = (hour === '10:00' || hour === '11:00') && routes.some((route) => route.day === column.day && !trip.transportLegs.some((leg) => leg.fromStopId === route.fromStopId && leg.toStopId === route.toStopId)); return <td colSpan={2} key={column.day} className={`trip-calendar-hour destination-tint-${tint} ${hasPlaceholder ? 'has-placeholder' : ''} ${hasPlaceholder && hour === '10:00' ? 'placeholder-origin' : ''} ${dropTarget === `${column.day}-${hour}` ? 'drop-active' : ''} ${selectedCell === `${column.day}-${hour}` ? 'cell-selected' : ''}`} tabIndex={0} onClick={(event) => { if (!suppressClick.current && !(event.target as HTMLElement).closest('button, article')) setSelectedCell(`${column.day}-${hour}`); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedCell(`${column.day}-${hour}`); } }} onDragOver={(event) => dragOver(event, `${column.day}-${hour}`)} onDrop={(event) => void drop(event, column.destination?.id, column.day, hour)} aria-label={`${dateLabel(column.day)} at ${hour}${column.destination ? ` in ${column.destination.name}` : ''}`}>
              {transition ? <span className="calendar-transfer-paper" aria-hidden="true">{[transition.from, transition.to].map((id, index) => { const color = stops.findIndex((stop) => stop.id === id) % 5; const progress = (Number(hour.slice(0, 2)) - transition.start) / (transition.end - transition.start); const top = Math.max(0, Math.min(100, (1 - progress) * 100)); const bottom = Math.max(0, Math.min(100, (1 - progress - 1 / (transition.end - transition.start)) * 100)); return <span key={index} className={`destination-tint-${color}`} style={index === 0 ? { clipPath: `polygon(0 0, ${top}% 0, ${bottom}% 100%, 0 100%)` } : undefined} />; })}<svg className="calendar-transfer-divider" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={(1 - (Number(hour.slice(0, 2)) - transition.start) / (transition.end - transition.start)) * 100} y1="0" x2={(1 - (Number(hour.slice(0, 2)) + 1 - transition.start) / (transition.end - transition.start)) * 100} y2="100" /></svg></span> : null}
              <div className="journey-options">{trip.transportLegs.filter((leg) => { const place = transportPlacement(leg, stops); return place.day === column.day && place.hour === hour; }).map(transportNote)}{hour === '10:00' ? routes.filter((route) => route.day === column.day && !trip.transportLegs.some((leg) => leg.fromStopId === route.fromStopId && leg.toStopId === route.toStopId)).map((route) => <article key={`${route.fromStopId}-${route.toStopId}`} className="plan-journey journey-placeholder journey-continuous" style={{ height: (durations[`${route.fromStopId}-${route.toStopId}`] ?? 120) / 60 * 80 - 10 }} ><button type="button" className="record-main" onClick={() => onTransport(undefined, route.fromStopId, route.toStopId)}>↗ {route.label}<strong>10 a.m.–12 p.m.</strong><small>Click to plan transport</small></button>{resizeHandle(`${route.fromStopId}-${route.toStopId}`, durations[`${route.fromStopId}-${route.toStopId}`] ?? 120, 840, undefined, undefined, route)}</article>) : null}</div>
              {selectedCell === `${column.day}-${hour}` ? <button type="button" className="cell-add-activity" aria-label={`Add activity on ${dateLabel(column.day)} at ${hour}`} onClick={() => onActivity(undefined, destination?.id ?? column.destinations[0]?.id, `${column.day}T${hour}`)}>+</button> : null}
              <div className="calendar-activity-notes">{trip.activities.filter((activity) => { const place = activityAssignment(activity); return place?.day === column.day && place.hour === hour; }).sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '') || a.position - b.position).map(activityNote)}</div>
            </td>; })}</tr>)}
          </tbody>
        </table>
      </div>
      </div>
      <aside className={`calendar-pool trip-calendar-pool ${dropTarget === 'pool' ? 'drop-active' : ''}`} onDragOver={(event) => dragOver(event, 'pool')} onDrop={(event) => void drop(event)}>
        <h3>Activity idea pool</h3><button type="button" className="button-secondary pool-add-activity" onClick={() => onActivity()}>+ Activity</button><p className="planner-hint">Drag onto a day and hour. Click a note to edit it.</p>
        {unplacedActivities.map(activityNote)}<p className="pool-return">Drop here to unschedule</p>
      </aside>
    </div>
    {unplacedTransport.length || unplacedStays.length ? <details className="calendar-unplaced"><summary>Unscheduled stays and transport</summary>{unplacedTransport.map(transportNote)}{unplacedStays.map(stayButton)}</details> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}

function DurationHandle({ minutes, max, disabled, onPreview, onCommit }: { minutes: number; max: number; disabled: boolean; onPreview: (minutes: number) => void; onCommit: (minutes: number) => void }) {
  const drag = useRef<{ y: number; initial: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (value: number) => Math.max(30, Math.min(max, Math.round(value / 30) * 30));
  return <button type="button" className="card-duration-handle" disabled={disabled} draggable={false} role="slider" aria-label="Resize duration" aria-valuemin={30} aria-valuemax={max} aria-valuenow={minutes} aria-valuetext={minutes + ' minutes'}
    onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, initial: minutes, value: minutes }; setActive(true); }}
    onPointerMove={(event) => { if (!drag.current) return; event.stopPropagation(); drag.current.value = clamp(drag.current.initial + (event.clientY - drag.current.y) / 80 * 60); onPreview(drag.current.value); }}
    onPointerUp={(event) => { event.stopPropagation(); const current = drag.current; drag.current = null; setActive(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current && current.value !== current.initial) onCommit(current.value); }}
    onPointerCancel={() => { if (drag.current) onPreview(drag.current.initial); drag.current = null; setActive(false); }}
    onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onCommit(clamp(minutes + (event.key === 'ArrowDown' ? 30 : -30))); } }}>
    <span aria-hidden="true">{active ? minutes + ' min' : '⋯'}</span>
  </button>;
}

'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type TdHTMLAttributes, type PointerEvent, type DragEvent } from 'react';
import { activityAssignment, activityMoveInput, calendarHours } from '../lib/activity-planning';
import { calendarHalfHours, slotHeight, timeMinutes, transportLocalTime, dragStartMinute, resizeStart, calendarColumns, calendarEventIndex, calendarPaperResolver, calendarTransition, calendarStartHour, stayCoversDay, transportPlacement, transportMoveInput, tripRoutes } from '../lib/trip-calendar';
import { dateTimeLocalToIso, formatDateTime, graphqlRequest, operations, sortStopsByDate, type Activity, type Stay, type TransportLeg, type Trip, type TripStop } from '../lib/graphql-client';

import { calendarDayWindow, calendarColumnRuns } from '../lib/calendar-window';
import { createCalendarInteractions, type CalendarInteractions } from '../lib/calendar-interactions';

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
  const columns = useMemo(() => calendarColumns(trip), [trip]);
  const stops = useMemo(() => sortStopsByDate(trip.stops), [trip.stops]);
  const routes = useMemo(() => tripRoutes(trip), [trip]);
  const visible = columns;
  const [windowRange, setWindowRange] = useState({ start: 0, end: 14, pinned: -1 });
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [paperPreview, setPaperPreview] = useState<Record<string, { minutes: number; edge: 'top' | 'bottom' }>>({});
  const [error, setError] = useState('');
  const [feedback] = useState(createCalendarInteractions);
  function setDropTarget(key: string) {
    feedback.drop(key === 'pool' ? key : key.slice(0, 10), key && key !== 'pool' ? timeMinutes(key.slice(11)) : 0, dragged.current?.minutes ?? 0);
  }
  const viewport = useRef<HTMLDivElement>(null);
  const panning = useRef(false);
  function setPanning(value: boolean) { panning.current = value; viewport.current?.classList.toggle('is-panning', value); }
  const setSelectedCell = feedback.select;
  const hoverCell = useRef('');
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resizeEdges, setResizeEdges] = useState<Record<string, 'top' | 'bottom'>>({});
  const dragged = useRef<{ minutes: number; offset: number; day?: string; route?: ReturnType<typeof tripRoutes>[number] } | null>(null);
  function clearSelection() { setSelectedCell(''); if (hoverTimer.current) clearTimeout(hoverTimer.current); }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  function hover(day: string, time: string) {
    const key = day ? day + '-' + time : '';
    if (hoverCell.current === key) return;
    const paint = (value: string, enabled: boolean) => {
      if (!value) return;
      const date = value.slice(0, 10); const hour = value.slice(11, 13) + ':00';
      viewport.current?.querySelectorAll(`[data-day="${date}"]`).forEach((cell) => { cell.classList.toggle('axis-column', enabled); if (cell.tagName === 'TH') cell.classList.toggle('axis-hover', enabled); });
      viewport.current?.querySelectorAll(`tr[data-calendar-hour="${hour}"] > *`).forEach((cell) => { cell.classList.toggle('axis-row', enabled); if (cell.tagName === 'TH') cell.classList.toggle('axis-hover', enabled); });
    };
    clearSelection();
    paint(hoverCell.current, false); hoverCell.current = key; paint(key, true);
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (day && !panning.current && !dragged.current) hoverTimer.current = setTimeout(() => { if (hoverCell.current === key) setSelectedCell(key); }, 250);
  }
  function startCardDrag(event: DragEvent, minutes: number, type: string, id: string, route?: ReturnType<typeof tripRoutes>[number]) {
    clearSelection();
    const card = (event.target as HTMLElement).closest('article')!;
    dragged.current = { minutes, day: card.closest<HTMLElement>('td[data-day]')?.dataset.day, offset: Math.max(0, Math.floor((event.clientY - card.getBoundingClientRect().top) / slotHeight) * 30), route };
    event.dataTransfer.setData(type, id); event.dataTransfer.effectAllowed = 'move';
  }
  function endCardDrag() { dragged.current = null; setDropTarget(''); }
  const suppressClick = useRef(false);
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || event.button !== 0 || (event.target as HTMLElement).closest('button:not(.cell-add-activity), a, input, select, textarea, summary, [draggable="true"]')) return;
    const board = event.currentTarget;
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: board.scrollLeft, top: board.scrollTop };
    suppressClick.current = false;
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) {
      if (!dragged.current) {
        const day = (event.target as HTMLElement).closest<HTMLElement>('td[data-day]')?.dataset.day;
        const time = pointerTime(event.clientY, '');
        if (day && time && hoverCell.current !== day + '-' + time) hover(day, time);
      }
      return;
    }
    if (!panning.current && Math.hypot(start.x - event.clientX, start.y - event.clientY) < 5) return;
    suppressClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true); clearSelection(); hover('', '');
    event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
    event.currentTarget.scrollTop = start.top + start.y - event.clientY;
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.id !== event.pointerId) return;
    pan.current = null; setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const header = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const board = viewport.current;
    const headings = header.current;
    if (!board || !headings) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const firstDestination = headings.rows[0]?.cells[1];
      const boardRect = board.getBoundingClientRect();
      const width = firstDestination ? Math.max(0, firstDestination.getBoundingClientRect().left - boardRect.left - 1) : 0;
      const height = headings.rows[2] ? Math.max(0, headings.rows[2].getBoundingClientRect().top - boardRect.top - 1) : 0;
      const dayWidth = headings.rows[2]?.cells[1]?.getBoundingClientRect().width ?? 220;
      const range = calendarDayWindow(columns.length, board.scrollLeft, board.clientWidth, dayWidth);
      const focused = document.activeElement?.closest<HTMLElement>('td[data-day]')?.dataset.day;
      const pinned = columns.findIndex(({ day }) => day === (dragged.current?.day ?? focused));
      board.style.setProperty('--notch-width', width + 'px');
      board.style.setProperty('--notch-height', height + 'px');
      board.closest<HTMLElement>('.trip-calendar-workspace')?.style.setProperty('--calendar-pool-offset', (height + 1) + 'px');
      board.toggleAttribute('data-notched', width > 0);
      setWindowRange((previous) => previous.start === range.start && previous.end === range.end && previous.pinned === pinned ? previous : { ...range, pinned });
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    const scroll = () => {
      feedback.select(''); hoverCell.current = '';
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      board.querySelectorAll('.axis-column, .axis-row, .axis-hover').forEach((cell) => cell.classList.remove('axis-column', 'axis-row', 'axis-hover'));
      schedule();
    };
    update(); board.addEventListener('scroll', scroll, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(headings); observer.observe(board);
    return () => { if (frame !== null) cancelAnimationFrame(frame); board.removeEventListener('scroll', scroll); observer.disconnect(); };
  }, [columns, feedback]);
  const bodyRuns = useMemo(() => calendarColumnRuns(columns.length, windowRange.start, windowRange.end, [windowRange.pinned]), [columns.length, windowRange]);
  const firstHour = useMemo(() => calendarStartHour(trip, columns.map((column) => column.day)), [trip, columns]);
  const firstDate = visible[0]?.day;
  const lastDate = visible.at(-1)?.day;
  useEffect(() => {
    const board = viewport.current;
    const morning = board?.querySelector<HTMLElement>(`[data-hour="${firstHour}"]`);
    if (board && morning) board.scrollTop += morning.getBoundingClientRect().top - board.getBoundingClientRect().top - (header.current?.offsetHeight ?? 180);
  }, [firstHour, firstDate, lastDate, trip.id]);
  const eventIndex = useMemo(() => calendarEventIndex(trip), [trip]);
  const { unplacedActivities, unplacedTransport } = eventIndex;
  const unplacedStays = useMemo(() => trip.stays.filter((stay) => !columns.some((column) => stayCoversDay(stay, column.day, stops))), [trip.stays, columns, stops]);
  const labels = useMemo(() => new Map(columns.map(({ day }) => [day, dateLabel(day)])), [columns]);
  const bands = useMemo(() => {
  const result: Array<{ key: string; color: number; span: number; destinations: TripStop[] }> = [];
  visible.forEach((column) => {
    const destinations = column.destinations.length > 1 ? [column.destinations[0], column.destinations.at(-1)] : [column.destinations[0]];
    destinations.forEach((destination) => {
      const key = destination?.id ?? 'unassigned';
      const span = 2 / destinations.length;
      const last = result.at(-1);
      if (last?.key === key) last.span += span;
      else result.push({ key, color: destination ? stops.findIndex((stop) => stop.id === destination.id) % 5 : -1, span, destinations: destination ? [destination] : [] });
    });
  });

  return result;
  }, [visible, stops]);

  function pointerTime(clientY: number, fallback: string) {
    const body = viewport.current?.querySelector('tbody');
    if (!body) return fallback;
    const offset = clientY - body.getBoundingClientRect().top;
    return offset >= 0 && offset < 48 * slotHeight ? calendarHalfHours[Math.floor(offset / slotHeight)]! : fallback;
  }
  async function drop(event: DragEvent, stopId?: string, day = '', time = '09:00') {
    event.preventDefault(); setDropTarget('');
    if (moving.current) return;
    if (day) time = pointerTime(event.clientY, time);
    if (day && dragged.current) time = calendarHalfHours[Math.floor(dragStartMinute(timeMinutes(time), dragged.current.minutes, dragged.current.offset) / 30)]!;
    if (dragged.current?.route && day) { const route = dragged.current.route; const duration = dragged.current.minutes; endCardDrag(); await saveDuration(route.fromStopId + '-' + route.toStopId, duration, undefined, undefined, route, 'bottom', day + 'T' + time); return; }
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
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; clearSelection(); if (key !== 'pool' && dragged.current) { const day = key.slice(0, 10); const time = pointerTime(event.clientY, key.slice(11)); const start = dragStartMinute(timeMinutes(time), dragged.current.minutes, dragged.current.offset); setDropTarget(day + '-' + calendarHalfHours[Math.floor(start / 30)]); } else setDropTarget(key);
  }
  function clearResize(key: string) {
    setDurations((current) => { const next = { ...current }; delete next[key]; return next; });
    setResizeEdges((current) => { const next = { ...current }; delete next[key]; return next; });
    setPaperPreview((current) => { if (!(key in current)) return current; const next = { ...current }; delete next[key]; return next; });
  }
  async function saveDuration(key: string, minutes: number, activity?: Activity, leg?: TransportLeg, route?: ReturnType<typeof tripRoutes>[number], edge: 'top' | 'bottom' = 'bottom', movedLocal?: string) {
    if (moving.current) return;
    moving.current = true; setBusy(true); setError('');
    try {
      let operation: string; let field: string; let input: Record<string, unknown>;
      if (activity) {
        operation = operations.updateActivity; field = 'updateActivity';
        input = { stopId: activity.stopId, title: activity.title, status: activity.status, scheduledAt: activity.scheduledAt ? resizeStart(activity.scheduledAt, activity.durationMinutes ?? 60, minutes, edge) : null, timezone: activity.timezone, durationMinutes: minutes };
      } else {
        const timezone = leg?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const placement = leg ? transportPlacement(leg, stops) : { day: route?.day, hour: '10:00' };
        let departureTime = leg?.departureTime ? new Date(leg.departureTime).toISOString() : dateTimeLocalToIso(placement.day + 'T' + placement.hour, timezone);
        if (movedLocal) departureTime = dateTimeLocalToIso(movedLocal, timezone);
        if (departureTime && edge === 'top') departureTime = resizeStart(departureTime, leg?.departureTime && leg.arrivalTime ? (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000 : 120, minutes, edge);
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
    finally { clearResize(key); moving.current = false; setBusy(false); }
  }
  function resizeHandle(key: string, minutes: number, max: number, activity?: Activity, leg?: TransportLeg, route?: ReturnType<typeof tripRoutes>[number]) {
    const start = activity ? timeMinutes(activityAssignment(activity)?.time ?? '00:00') : leg ? timeMinutes(transportLocalTime(leg)) : 600;
    const original = activity?.durationMinutes ?? (leg?.departureTime && leg.arrivalTime ? (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000 : 120);
    return <>{(['top', 'bottom'] as const).map((edge) => <DurationHandle key={edge} edge={edge} minutes={minutes} max={edge === 'top' ? start + original : max} disabled={busy} onPreview={(value) => { clearSelection(); setResizeEdges((current) => ({ ...current, [key]: edge })); setDurations((current) => ({ ...current, [key]: value })); if (!activity) setPaperPreview({ [key]: { minutes: value, edge } }); }} onCancel={() => clearResize(key)} onCommit={(value) => void saveDuration(key, value, activity, leg, route, edge)} />)}</>;
  }
  function activityNote(activity: Activity) {
    const assignment = eventIndex.assignments.get(activity.id);
    const minutes = durations[activity.id] ?? activity.durationMinutes ?? 60;
    return <article className={`calendar-note note-${activity.status.toLowerCase()}`} style={assignment ? { marginTop: timeMinutes(assignment.time) % 60 / 30 * slotHeight, height: minutes / 30 * slotHeight, transform: resizeEdges[activity.id] === 'top' ? `translateY(${((activity.durationMinutes ?? 60) - minutes) / 30 * slotHeight}px)` : undefined } : undefined} onPointerDown={(event) => event.stopPropagation()} key={activity.id} draggable={!busy} onDragEnd={endCardDrag} onDragStart={(event) => startCardDrag(event, minutes, dragType, activity.id)}>
      <button className="record-main" draggable={!busy} type="button" disabled={busy} onClick={() => onActivity(activity)}><strong>{activity.title}</strong><span className="note-meta">{statuses[activity.status]}</span></button>
      <div className="note-actions"><button className="button-text button-danger" type="button" disabled={busy} aria-label={`Remove ${activity.title}`} onClick={() => onRemove('activity', activity.id)}>×</button></div>{assignment ? resizeHandle(activity.id, minutes, 1440 - timeMinutes(assignment.time), activity) : null}
    </article>;
  }
  function transportNote(leg: TransportLeg) {
    const placement = transportPlacement(leg, stops);
    const minutes = durations[leg.id] ?? (leg.departureTime && leg.arrivalTime ? Math.max(30, (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000) : 120);
    const from = stops.find((stop) => stop.id === leg.fromStopId)?.name ?? leg.fromLocation;
    const to = stops.find((stop) => stop.id === leg.toStopId)?.name ?? leg.toLocation;
    return <article className="journey-note" style={{ marginTop: timeMinutes(transportLocalTime(leg)) % 60 / 30 * slotHeight, height: Math.min(minutes, 1440 - timeMinutes(transportLocalTime(leg))) / 30 * slotHeight, transform: resizeEdges[leg.id] === 'top' ? `translateY(${((leg.departureTime && leg.arrivalTime ? (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000 : 120) - minutes) / 30 * slotHeight}px)` : undefined }} key={leg.id} draggable={!busy} onPointerDown={(event) => event.stopPropagation()} onDragEnd={endCardDrag} onDragStart={(event) => startCardDrag(event, minutes, transportDragType, leg.id)}>
      <button type="button" draggable={!busy} className="record-main" onClick={() => onTransport(leg)}><span className="journey-note-mode">↗ {leg.mode}</span><strong>{leg.title}</strong><span>{from} → {to}</span><small>{placement.suggested ? '10 a.m.–12 p.m. placeholder · time to confirm' : `${formatDateTime(leg.departureTime, leg.timezone)} → ${formatDateTime(leg.arrivalTime, leg.timezone)}`}</small></button>
      <div className="journey-note-actions"><button type="button" className="button-text button-danger" aria-label={`Remove ${leg.title}`} onClick={() => onRemove('transport', leg.id)}>×</button></div>{resizeHandle(leg.id, minutes, 1440 - timeMinutes(transportLocalTime(leg)), undefined, leg)}
    </article>;
  }
  function stayButton(stay: Stay) {
    return <div className="calendar-stay" key={stay.id}><button type="button" onClick={() => onStay(stay)}><strong>{stay.name}</strong><small>{!stay.checkIn || !stay.checkOut ? 'Dates to confirm' : `${formatDateTime(stay.checkIn, stay.timezone)} → ${formatDateTime(stay.checkOut, stay.timezone)}`}</small></button><button type="button" className="button-text button-danger" aria-label={`Remove ${stay.name}`} onClick={() => onRemove('stay', stay.id)}>×</button></div>;
  }

  const papers = useMemo(() => {
  const paperTrip = { ...trip, transportLegs: trip.transportLegs.map((leg) => {
    const minutes = paperPreview[leg.id]?.minutes;
    if (minutes === undefined) return leg;
    const place = transportPlacement(leg, stops);
    const start = leg.departureTime ?? dateTimeLocalToIso(place.day + 'T' + transportLocalTime(leg), leg.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (!start) return leg;
    const old = leg.departureTime && leg.arrivalTime ? (new Date(leg.arrivalTime).getTime() - new Date(leg.departureTime).getTime()) / 60000 : 120;
    const departureTime = resizeStart(start, old, minutes, paperPreview[leg.id]?.edge ?? 'bottom');
    return { ...leg, departureTime, arrivalTime: new Date(new Date(departureTime).getTime() + minutes * 60000).toISOString() };
  }) };
  for (const route of routes) {
    const key = route.fromStopId + '-' + route.toStopId;
    const minutes = paperPreview[key]?.minutes;
    if (minutes === undefined || !route.day || trip.transportLegs.some((leg) => leg.fromStopId === route.fromStopId && leg.toStopId === route.toStopId)) continue;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = dateTimeLocalToIso(route.day + 'T10:00', timezone)!;
    const departureTime = resizeStart(start, 120, minutes, paperPreview[key]?.edge ?? 'bottom');
    paperTrip.transportLegs.push({ id: key, tripId: trip.id, fromStopId: route.fromStopId, toStopId: route.toStopId, fromLocation: null, toLocation: null, title: route.label, mode: 'TRAVEL', details: null, position: 0, timezone, departureTime, arrivalTime: new Date(new Date(departureTime).getTime() + minutes * 60000).toISOString() });
  }
  const resolvePaper = calendarPaperResolver(paperTrip);
  const result = new Map<string, { destination: TripStop | undefined; tint: number; slices: { tint: number; transition: ReturnType<typeof calendarTransition>; time: number }[] }>();
  for (const column of columns) for (const hour of calendarHours) {
    const destination = resolvePaper(column.day).destination(timeMinutes(hour) / 60);
    const tint = destination ? stops.findIndex((stop) => stop.id === destination.id) % 5 : -1;
    const slices = [hour, hour.slice(0, 2) + ':30'].map((time) => {
      const place = resolvePaper(column.day).destination(timeMinutes(time) / 60);
      return { tint: place ? stops.findIndex((stop) => stop.id === place.id) % 5 : -1, transition: resolvePaper(column.day).transition(timeMinutes(time) / 60), time: timeMinutes(time) / 60 };
    });
    result.set(column.day + '-' + hour, { destination, tint, slices });
  }
  return result;
  }, [trip, paperPreview, stops, routes, columns]);
  return <section className="unified-trip-calendar" aria-label="Trip calendar" aria-busy={busy}>
    <div className="trip-calendar-workspace">
      <div className="calendar-surface">
      <div className="trip-calendar-scroll" ref={viewport} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} tabIndex={0} role="region" aria-label="Itinerary by date">
        <table className="trip-calendar-table"><colgroup><col style={{ width: 62 }} />{visible.flatMap((column) => [<col key={column.day + "-am"} />, <col key={column.day + "-pm"} />])}</colgroup>
          <thead ref={header}>
            <tr className="destination-band"><th className="calendar-blank-corner" aria-hidden="true" />{bands.map((band, index) => <th key={`${band.key}-${index}`} colSpan={band.span} className={`destination-tint-${band.color}`} scope="colgroup">{band.destinations.length ? band.destinations.map((stop, stopIndex) => <span key={stop.id}>{stopIndex ? <span className="shared-place-divider"> / </span> : null}<button type="button" onClick={() => onDestination(stop)}><span>{String(stops.findIndex((item) => item.id === stop.id) + 1).padStart(2, '0')}</span> {stop.name}</button></span>) : 'Dates open'}</th>)}</tr>
            <tr className="calendar-stay-row"><td className="calendar-blank-corner" aria-hidden="true" />{bands.map((band, index) => <td key={band.key + index} colSpan={band.span}><div className="calendar-stay-items">{trip.stays.filter((stay) => band.destinations.some((stop) => stop.id === stay.stopId)).map(stayButton)}</div>{band.destinations.map((stop) => <button key={stop.id} type="button" className="calendar-add-stay" onClick={() => onStay(undefined, stop.id)}>+ Stay</button>)}</td>)}</tr>
            <tr className="calendar-date-row"><th scope="row">Date</th>{visible.map((column) => <th scope="col" data-day={column.day} colSpan={2} key={column.day} className={`destination-tint-${column.color}`}>{labels.get(column.day)}</th>)}</tr>

          </thead>
          <tbody>

            {calendarHours.map((hour) => <tr key={hour} data-calendar-hour={hour}><th scope="row" data-hour={hour}>{hour}</th>{bodyRuns.map((run) => { if (run.spacer) return <td key={'spacer-' + run.index} colSpan={run.span * 2} aria-hidden="true" className="calendar-column-spacer" />; const column = columns[run.index]!; const { destination, tint, slices } = papers.get(column.day + '-' + hour)!; const hasPlaceholder = (timeMinutes(hour) >= 600 && timeMinutes(hour) < 720) && Boolean(eventIndex.placeholders.get(column.day)?.length); return <CalendarCell feedback={feedback} cellKey={column.day + '-' + hour} onAdd={(time) => { if (!suppressClick.current) onActivity(undefined, destination?.id ?? column.destinations[0]?.id, `${column.day}T${time}`); }} data-day={column.day} colSpan={2} key={column.day} className={`trip-calendar-hour destination-tint-${tint} ${hasPlaceholder ? 'has-placeholder' : ''} ${hasPlaceholder && hour === '10:00' ? 'placeholder-origin' : ''}`} onPointerLeave={() => { clearSelection(); hover('', ''); }} tabIndex={0} onClick={(event) => { if (!suppressClick.current && !(event.target as HTMLElement).closest('button, article')) setSelectedCell(`${column.day}-${pointerTime(event.clientY, hour)}`); }} onKeyDown={(event) => { if (event.key === 'Escape') clearSelection(); if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedCell(`${column.day}-${hour}`); } }} onDragOver={(event) => dragOver(event, `${column.day}-${hour}`)} onDrop={(event) => void drop(event, column.destination?.id, column.day, hour)} aria-label={`${labels.get(column.day)} at ${hour}${column.destination ? ` in ${column.destination.name}` : ''}`}>
              <HourPaper slices={slices} stops={stops} />
              <div className="journey-options">{(eventIndex.transport.get(column.day + '-' + hour) ?? []).map(transportNote)}{hour === '10:00' ? (eventIndex.placeholders.get(column.day) ?? []).map((route) => <article key={`${route.fromStopId}-${route.toStopId}`} className="plan-journey journey-placeholder journey-continuous" draggable={!busy} onDragEnd={endCardDrag} onDragStart={(event) => startCardDrag(event, durations[`${route.fromStopId}-${route.toStopId}`] ?? 120, transportDragType, 'placeholder', route)} style={{ height: (durations[`${route.fromStopId}-${route.toStopId}`] ?? 120) / 30 * slotHeight, transform: resizeEdges[`${route.fromStopId}-${route.toStopId}`] === 'top' ? `translateY(${(120 - (durations[`${route.fromStopId}-${route.toStopId}`] ?? 120)) / 30 * slotHeight}px)` : undefined }} ><button type="button" className="record-main" onClick={() => onTransport(undefined, route.fromStopId, route.toStopId)}>↗ {route.label}<strong>10 a.m.–12 p.m.</strong><small>Click to plan transport</small></button>{resizeHandle(`${route.fromStopId}-${route.toStopId}`, durations[`${route.fromStopId}-${route.toStopId}`] ?? 120, 840, undefined, undefined, route)}</article>) : null}</div>
              <div className="calendar-activity-notes">{(eventIndex.activities.get(column.day + '-' + hour) ?? []).map(activityNote)}</div>
            </CalendarCell>; })}</tr>)}
          </tbody>
        </table>
      </div>
      </div>
      <CalendarPool feedback={feedback} onDragOver={(event) => dragOver(event, 'pool')} onDrop={(event) => void drop(event)}>
        <h3>Activity idea pool</h3><button type="button" className="button-secondary pool-add-activity" onClick={() => onActivity()}>+ Activity</button><p className="planner-hint">Drag onto a day and hour. Click a note to edit it.</p>
        {unplacedActivities.map(activityNote)}<p className="pool-return">Drop here to unschedule</p>
      </CalendarPool>
    </div>
    {unplacedTransport.length || unplacedStays.length ? <details className="calendar-unplaced"><summary>Unscheduled stays and transport</summary>{unplacedTransport.map(transportNote)}{unplacedStays.map(stayButton)}</details> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}

function DurationHandle({ edge, minutes, max, disabled, onPreview, onCommit, onCancel }: { edge: 'top' | 'bottom'; minutes: number; max: number; disabled: boolean; onPreview: (minutes: number) => void; onCommit: (minutes: number) => void; onCancel: () => void }) {
  const drag = useRef<{ y: number; initial: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  const frame = useRef<number | null>(null);
  function cancelFrame() { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; }
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const clamp = (value: number) => Math.max(30, Math.min(max, Math.round(value / 30) * 30));
  return <button type="button" className={`card-duration-handle resize-${edge}`} disabled={disabled} draggable={false} role="slider" aria-label={edge === 'top' ? 'Resize start time' : 'Resize end time'} aria-valuemin={30} aria-valuemax={max} aria-valuenow={minutes} aria-valuetext={minutes + ' minutes'}
    onClick={(event) => event.stopPropagation()} onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { y: event.clientY, initial: minutes, value: minutes }; setActive(true); }}
    onPointerMove={(event) => { if (!drag.current) return; event.stopPropagation(); const value = clamp(drag.current.initial + (event.clientY - drag.current.y) / slotHeight * 30 * (edge === 'top' ? -1 : 1)); if (value !== drag.current.value) { drag.current.value = value; if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; if (drag.current) onPreview(drag.current.value); }); } }}
    onPointerUp={(event) => { event.stopPropagation(); const current = drag.current; cancelFrame(); drag.current = null; setActive(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current && current.value !== current.initial) { onPreview(current.value); onCommit(current.value); } else if (current) onCancel(); }}
    onPointerCancel={() => { cancelFrame(); if (drag.current) onCancel(); drag.current = null; setActive(false); }} onLostPointerCapture={() => { cancelFrame(); if (drag.current) onCancel(); drag.current = null; setActive(false); }}
    onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onCommit(clamp(minutes + (event.key === 'ArrowDown' ? 30 : -30) * (edge === 'top' ? -1 : 1))); } }}>
    <span aria-hidden="true">{active ? minutes + ' min' : '⋯'}</span>
  </button>;
}

function CalendarCell({ feedback, cellKey, onAdd, children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { feedback: CalendarInteractions; cellKey: string; onAdd: (time: string) => void }) {
  const subscribe = useCallback((listener: () => void) => feedback.subscribe(cellKey, listener), [feedback, cellKey]);
  const get = useCallback(() => feedback.get(cellKey), [feedback, cellKey]);
  const state = useSyncExternalStore(subscribe, get, get);
  return <td {...props} className={className + (state.selected ? ' cell-selected' : '')}>
    {children}
    {state.end > state.start ? <span className="calendar-drop-preview" aria-hidden="true" style={{ top: state.start / 60 * 100 + '%', height: (state.end - state.start) / 60 * 100 + '%' }} /> : null}
    {state.selected ? <button type="button" className="cell-add-activity" aria-label={'Add activity at ' + state.selected} onClick={() => onAdd(state.selected)}>+</button> : null}
  </td>;
}

function CalendarPool({ feedback, children, ...props }: React.HTMLAttributes<HTMLElement> & { feedback: CalendarInteractions }) {
  const subscribe = useCallback((listener: () => void) => feedback.subscribe('pool', listener), [feedback]);
  const get = useCallback(() => feedback.get('pool'), [feedback]);
  const state = useSyncExternalStore(subscribe, get, get);
  return <aside {...props} className={'calendar-pool trip-calendar-pool' + (state.end ? ' drop-active' : '')}>{children}</aside>;
}

const HourPaper = memo(function HourPaper({ slices, stops }: { slices: { tint: number; transition: ReturnType<typeof calendarTransition>; time: number }[]; stops: TripStop[] }) { return <span className="calendar-hour-paper" aria-hidden="true">{slices.map(({ tint: sliceTint, transition, time }, index) => <span key={index} className={`calendar-paper-half destination-tint-${sliceTint}`}>{transition ? <span className="calendar-transfer-paper" aria-hidden="true">{[transition.from, transition.to].map((id, index) => { const color = stops.findIndex((stop) => stop.id === id) % 5; const progress = (time - transition.start) / (transition.end - transition.start); const top = Math.max(0, Math.min(100, (1 - progress) * 100)); const bottom = Math.max(0, Math.min(100, (1 - progress - .5 / (transition.end - transition.start)) * 100)); return <span key={index} className={`destination-tint-${color}`} style={index === 0 ? { clipPath: `polygon(0 0, ${top}% 0, ${bottom}% 100%, 0 100%)` } : undefined} />; })}<svg className="calendar-transfer-divider" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1={(1 - (time - transition.start) / (transition.end - transition.start)) * 100} y1="0" x2={(1 - (time + .5 - transition.start) / (transition.end - transition.start)) * 100} y2="100" /></svg></span> : null}</span>)}</span>; });

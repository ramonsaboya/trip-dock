'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatDateRange } from '../../lib/trips/dates';
import { sortStopsByDate } from '../../lib/trips/stops';
import { type Trip, type TripDraft } from '../../lib/trips/types';
import { CreateTripForm } from './creation/create-trip-form';
import { HomeDraftComposer } from './creation/home-draft-composer';

function focusEditor(editor: HTMLElement | null | undefined) {
  if (!editor) return;
  editor.focus({ preventScroll: true });
  // A lower-page entry can shrink above the old scroll position on mobile.
  if (editor.getBoundingClientRect().top < 80) editor.scrollIntoView({ block: 'start', behavior: 'instant' });
}

export function TripsOverview({ trips, onCreated, onOpen }: { trips: Trip[]; onCreated: (trip: Trip) => void; onOpen: (id: string) => void }) {
  const [active, setActive] = useState<'ai' | 'manual' | null>(null);
  const [manualStarted, setManualStarted] = useState(false);
  const [draft, setDraft] = useState<{ value: TripDraft; prompt: string } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const topEditor = useRef<HTMLDivElement>(null);

  const moving = useRef(false);
  const [isMoving, setIsMoving] = useState(false);

  async function resizeLayout(next: 'ai' | 'manual' | null, freshDraft = false) {
    if (moving.current) return;
    // Generating again in an open composer is a content update, not navigation.
    if (next === active) {
      if (freshDraft) setDraft(null);
      return;
    }
    const layout = workspace.current;
    if (!layout) return;
    if (trips.length > 0 && (next === 'manual' || active === 'manual')) {
      moving.current = true;
      flushSync(() => {
        setIsMoving(true);
        setManualStarted(true);
        setActive(next);
      });
      const editor = topEditor.current!;
      const opening = next === 'manual';
      const extent = Math.max(layout.getBoundingClientRect().height, editor.getBoundingClientRect().height);
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420;
      layout.style.visibility = 'visible';
      editor.style.visibility = 'visible';
      const baseFrames = [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: `inset(${extent}px 0 0 0)` }];
      const editorFrames = [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: `inset(0 0 min(0px, calc(100% - ${extent}px)) 0)` }];
      const options = { duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' as const };
      const animations = [
        layout.animate(opening ? baseFrames : [...baseFrames].reverse(), options),
        editor.animate(opening ? editorFrames : [...editorFrames].reverse(), options),
      ];
      try {
        await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
      } finally {
        animations.forEach(animation => animation.cancel());
        layout.style.removeProperty('visibility');
        editor.style.removeProperty('visibility');
        moving.current = false;
        flushSync(() => setIsMoving(false));
        if (opening) focusEditor(editor);
        else trigger.current?.focus({ preventScroll: true });
      }
      return;
    }
    moving.current = true;
    setIsMoving(true);
    const slots = [...layout.querySelectorAll<HTMLElement>('.creation-slot')];
    const contents = slots.map(slot => slot.querySelector<HTMLElement>('.creation-content')!);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animations: Animation[] = [];
    const play = (element: HTMLElement, frames: Keyframe[], duration: number) => {
      const animation = element.animate(frames, { duration: reduced ? 0 : duration, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' });
      animations.push(animation);
      return animation.finished.catch(() => {});
    };
    try {
      const before = slots.map(slot => slot.getBoundingClientRect());
      const layoutBefore = layout.getBoundingClientRect();
      flushSync(() => {
        if (next === 'manual') setManualStarted(true);
        if (freshDraft) setDraft(null);
        setActive(next);
      });
      const after = slots.map(slot => slot.getBoundingClientRect());
      const layoutAfter = layout.getBoundingClientRect();
      slots.forEach((slot, index) => {
        slot.style.overflow = 'hidden';
        // Keep the content visible and stable; the resizing card clips its edges.
        contents[index]!.style.width = `${after[index]!.width || before[index]!.width}px`;
      });
      await Promise.all([
        play(layout, [{ height: `${layoutBefore.height}px` }, { height: `${layoutAfter.height}px` }], 340),
        ...slots.map((slot, index) => {
          const from = before[index]!;
          const to = after[index]!;
          return play(slot, [
            { width: `${from.width}px`, height: `${from.height}px`, transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
            { width: `${to.width}px`, height: `${to.height}px`, transform: 'translate(0, 0)' },
          ], 340);
        }),
      ]);
    } finally {
      animations.forEach(animation => animation.cancel());
      slots.forEach(slot => slot.style.removeProperty('overflow'));
      contents.forEach(content => content.style.removeProperty('width'));
      moving.current = false;
      flushSync(() => setIsMoving(false));
      if (next) focusEditor(layout.querySelector<HTMLElement>('[data-active="true"]'));
      else trigger.current?.focus({ preventScroll: true });
    }
  }

  function expand(mode: 'ai' | 'manual', freshDraft = false) {
    if (!active) trigger.current = document.activeElement as HTMLElement;
    void resizeLayout(mode, freshDraft);
  }

  function close() {
    void resizeLayout(null);
  }

  const tripCards = <section className="trips-grid" aria-label="Trips">{trips.map((trip) => {
              const stops = sortStopsByDate(trip.stops);
              return <article className="trip-card-real" key={trip.id}><div className="trip-card-art" aria-hidden="true"><span>{stops[0]?.name.slice(0, 2).toUpperCase() ?? 'TD'}</span></div><div className="trip-card-content"><div><p className="trip-eyebrow">{formatDateRange(trip.startDate, trip.endDate)}</p><h2>{trip.name}</h2><p>{stops.length} {stops.length === 1 ? 'destination' : 'destinations'}</p></div><div className="route-ribbon route-ribbon-card">{stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i>{stop.name}</span>)}</div><div className="trip-card-stats"><span>{trip.transportLegs.length} transport</span><span>{trip.stays.length} stays</span><span>{trip.activities.length} activities</span></div><button className="button-text trip-open" type="button" onClick={() => onOpen(trip.id)}>Open trip <span aria-hidden="true">→</span></button></div></article>;
            })}</section>;

  return (
    <main id="main-content" className="page-wrap" tabIndex={-1}>
      <section className="page-heading"><div><h1>Your trips</h1><p className="page-intro">Everything you’re planning, in one place.</p></div><div className="creation-page-action">{active ? <button className="button-text creation-back" type="button" onClick={close} disabled={isMoving}>← Back to trips</button> : trips.length ? <button className="button-primary" type="button" onClick={() => expand('manual')}>+ New trip</button> : <button className="button-secondary mobile-manual-start" type="button" onClick={() => expand('manual')}>{manualStarted ? 'Continue your trip' : '+ New trip'}</button>}</div></section>
      <div className={`creation-stage ${trips.length ? 'has-trips' : ''} ${trips.length && active === 'manual' ? 'top-creation-open' : ''}`}>
      <div ref={workspace} inert={isMoving || (trips.length > 0 && active === 'manual')} className={`overview-layout creation-layout ${active && !(trips.length && active === 'manual') ? 'creation-active creation-' + active : ''}`}>
        <div className="creation-slot creation-ai-slot" data-active={active === 'ai'} inert={active === 'manual'} tabIndex={-1} aria-label="Create a trip with AI"><div className="creation-content">
          <HomeDraftComposer disabled={isMoving || active === 'manual' || Boolean(draft && active === 'ai')} hidden={Boolean(draft && active === 'ai')} onStart={() => expand('ai', true)} onDraft={(value, prompt) => setDraft({ value, prompt })} />
          {draft ? <div hidden={active !== 'ai'}><CreateTripForm inactive={active !== 'ai' || isMoving} key={JSON.stringify(draft)} initialDraft={draft.value} sourcePrompt={draft.prompt} onClose={close} onCreated={onCreated} /></div> : null}
          {draft && !active ? <button className="button-text resume-draft" type="button" onClick={() => expand('ai')}>Continue your AI draft →</button> : null}
        </div></div>
        <div className="creation-slot creation-manual-slot" data-active={active === 'manual'} inert={active === 'ai'} tabIndex={-1} aria-label="Create a trip"><div className="creation-content">
          <div hidden={active === 'manual' && trips.length === 0}>
            {trips.length === 0 ? <section className="empty-state"><span className="empty-mark" aria-hidden="true">01</span><h2>Your first trip starts here</h2><p>Add the essentials now. You can fill in accommodation, activities, and transport as the plan takes shape.</p><button className="button-primary" type="button" onClick={() => expand('manual')}>{manualStarted ? 'Continue your trip' : 'Create your first trip'}</button></section> : <div className="overview-plans">{tripCards}</div>}
          </div>
          {manualStarted && trips.length === 0 ? <div hidden={active !== 'manual'}><CreateTripForm inactive={active !== 'manual' || isMoving} onClose={close} onCreated={onCreated} /></div> : null}</div>
        </div>
      </div>
      {trips.length > 0 && manualStarted ? <div ref={topEditor} className="creation-top-editor" inert={active !== 'manual' || isMoving} tabIndex={-1} aria-label="Create a trip"><CreateTripForm inactive={active !== 'manual' || isMoving} onClose={close} onCreated={onCreated} /></div> : null}
      </div>
    </main>
  );
}

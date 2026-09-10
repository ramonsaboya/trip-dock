'use client';
import { useState, type DragEvent } from 'react';
import type { Trip } from '../lib/graphql-client';
import { packingDates, type PackingLibrary, type PackingPlan } from '../lib/packing-client';
import { LibraryForm } from './packing-library';
import type { EditPacking } from './packing-checklist';
import { PACKING_TAG_DRAG_TYPE, acceptedTagDrop } from '../lib/packing-drag';

export function PackingDays({ trip, plan, library, busy, edit, onLibrarySaved, onRefresh, onLibraryBusy }: {
  trip: Trip; plan: PackingPlan; library: PackingLibrary; busy: boolean; edit: EditPacking;
  onLibrarySaved: (library: PackingLibrary) => void; onRefresh: () => Promise<void>; onLibraryBusy: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [armedTag, setArmedTag] = useState<string | null>(null);
  const [draggedTag, setDraggedTag] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [newTag, setNewTag] = useState(false);
  const dates = packingDates(plan.startDate, plan.endDate);
  const tags = library.tags.filter(t => !t.archived);
  const armed = tags.find(t => t.id === armedTag);
  const selected = selectedDays.filter(day => dates.includes(day));

  function dragOver(event: DragEvent, day: string) {
    if (busy || !event.dataTransfer.types.includes(PACKING_TAG_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropDay(day);
  }
  function drop(event: DragEvent, day: string) {
    event.preventDefault(); setDropDay(null); setDraggedTag(null);
    const tagId = acceptedTagDrop(event.dataTransfer.getData(PACKING_TAG_DRAG_TYPE), tags);
    if (!busy && tagId) void edit({ action: 'ASSIGN', days: [day], tagId });
  }
  function chooseTag(tagId: string) {
    if (selected.length) void edit({ action: 'ASSIGN', days: selected, tagId });
    else setArmedTag(armedTag === tagId ? null : tagId);
  }

  return <div className="packing-days-layout">
    <section className="packing-day-section">
      <div className="packing-section-heading">
        <h2>{trip.name} <small>{dates.length} days · {Math.max(0, dates.length - 1)} nights</small></h2>
        <button className="button-text" disabled={busy} onClick={() => setSelectedDays(selected.length === dates.length ? [] : dates)}>{selected.length === dates.length ? 'Clear selection' : 'Select all'}</button>
      </div>
      <div className="packing-assignment-hint" role="status">
        {selected.length ? <>{selected.length} days selected — click tags to apply them. <button disabled={busy} onClick={() => setSelectedDays([])}>Clear</button></> :
          armed ? <><strong>{armed.name}</strong> — click a day to assign. <button onClick={() => setArmedTag(null)}>Done</button></> :
            'Drag tags onto days, or choose a tag and click a day.'}
      </div>
      <div className="packing-days">
        {dates.map((day, index) => {
          const assigned = plan.assignments.filter(a => a.day === day);
          const destinations = trip.stops.filter(s => s.arrivalDate && s.departureDate && day >= s.arrivalDate && day <= s.departureDate).map(s => s.name).join(' → ');
          const label = new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
          return <article key={day} className={`packing-day ${selected.includes(day) ? 'is-selected' : ''} ${dropDay === day ? 'is-drop-target' : ''}`}
            aria-label={`Packing day ${day}`} onDragOver={event => dragOver(event, day)} onDrop={event => drop(event, day)}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDay(null); }}>
            <input type="checkbox" aria-label={`Select ${day}`} disabled={busy} checked={selected.includes(day)} onChange={event => setSelectedDays(event.target.checked ? [...selected, day] : selected.filter(d => d !== day))} />
            <button className="packing-day-target" disabled={busy} aria-label={armed ? `Assign ${armed.name} to ${day}` : `Select day ${day}`}
              onClick={() => armed ? void edit({ action: 'ASSIGN', days: [day], tagId: armed.id }) : setSelectedDays(selected.includes(day) ? selected.filter(d => d !== day) : [...selected, day])}>
              <span className="packing-day-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{label}</strong><small>{destinations || trip.destinationArea}</small></span>
            </button>
            <div className="packing-chips">
              {assigned.map(a => <button className="packing-chip" key={a.tagId} disabled={busy} aria-label={`Remove ${library.tags.find(t => t.id === a.tagId)?.name} from ${day}`} onClick={() => void edit({ action: 'ASSIGN', days: [day], tagId: a.tagId, remove: true })}>
                {library.tags.find(t => t.id === a.tagId)?.name ?? 'Archived tag'} <span aria-hidden="true">×</span>
              </button>)}
              {!assigned.length ? <span className="packing-day-empty">{dropDay === day ? 'Drop to assign' : draggedTag ? 'Drop tag here' : 'No tags yet'}</span> : null}
            </div>
            {armed ? <button className="packing-assign-button" disabled={busy} aria-label={`Add ${armed.name} to ${label}`} onClick={() => void edit({ action: 'ASSIGN', days: [day], tagId: armed.id })}>+ {armed.name}</button> : null}
          </article>;
        })}
      </div>
      <details className="packing-essentials"><summary>Everyday essentials <span>{library.items.filter(i => i.baseline && !i.archived && library.categories.some(c => c.id === i.categoryId && !c.archived)).length}</span></summary>
        <p className="packing-help">Included across the trip, even on untagged days. Quantities are for one person.</p>
        <div className="packing-essential-list">{library.items.filter(i => i.baseline && !i.archived && library.categories.some(c => c.id === i.categoryId && !c.archived)).map(i => <span key={i.id}>{i.name}<small>{i.mode === 'CHECKBOX' ? 'Once' : `${i.quantity} / ${i.interval} ${i.basis.toLowerCase()}`}</small></span>)}</div>
      </details>
    </section>
    <aside className="packing-tag-tray" aria-label="Activity tags">
      <div className="packing-section-heading"><h2>Activity tags <small>{tags.length}</small></h2><button className="button-text" disabled={busy} aria-expanded={newTag} onClick={() => setNewTag(!newTag)}>{newTag ? 'Close' : '+ New tag'}</button></div>
      <input type="search" aria-label="Search activity tags" placeholder="Search tags…" disabled={busy} value={search} onChange={e => setSearch(e.target.value)} />
      <p className="packing-help">{selected.length ? 'Click to add to selected days.' : 'Drag onto a day, or click to select.'}</p>
      {newTag ? <LibraryForm editor={{ kind: 'Tag' }} library={library} onBusyChange={onLibraryBusy} onRefresh={onRefresh} onClose={() => setNewTag(false)} onSaved={(next, id) => { onLibrarySaved(next); setNewTag(false); setSearch(''); if (id) setArmedTag(id); }} /> : null}
      <div className="packing-tag-list">{tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).map(tag => <button key={tag.id} className="packing-tray-tag" draggable={!busy}
        disabled={busy} aria-pressed={armedTag === tag.id} aria-label={tag.name}
        onClick={() => chooseTag(tag.id)}
        onDragStart={event => { event.dataTransfer.setData(PACKING_TAG_DRAG_TYPE, tag.id); event.dataTransfer.effectAllowed = 'copy'; setDraggedTag(tag.id); }}
        onDragEnd={() => { setDraggedTag(null); setDropDay(null); }}>
        <span aria-hidden="true" className="packing-grip">⠿</span><span>{tag.name}</span><small title="Linked items">{tag.itemIds.length}</small>
      </button>)}</div>
      {!tags.some(t => t.name.toLowerCase().includes(search.toLowerCase())) ? <p className="packing-help">No matching tags. Create one above.</p> : null}
    </aside>
  </div>;
}


'use client';
import { useId, useRef, useState } from 'react';
import { packingProgress, type PackingEntry, type PackingLibrary, type PackingPlan, type PlanEdit } from '../lib/packing-client';
import { LibraryForm } from './packing-library';

export type EditPacking = (input: PlanEdit) => Promise<boolean>;

function CountInput({ value, max, label, disabled, onSave }: { value: number; max: number; label: string; disabled: boolean; onSave: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) { cancelled.current = false; setDraft(String(value)); return; }
    const number = Number(draft);
    if (draft !== '' && Number.isInteger(number) && number >= 0 && number <= max && number !== value) void onSave(number).then(saved => { if (!saved) setDraft(String(value)); });
    else setDraft(String(value));
  }
  return <input aria-label={label} type="number" min={0} max={max} disabled={disabled} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } }} />;
}
function EntryRow({ entry, busy, edit }: { entry: PackingEntry; busy: boolean; edit: EditPacking }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  return <article className={`packing-entry ${entry.excluded ? 'is-excluded' : ''} ${entry.target > 0 && entry.packed === entry.target ? 'is-packed' : ''}`}>
    <div className="packing-entry-main">
      <label className="packing-entry-check">
        <input type="checkbox" aria-label={`Packed ${entry.name}`} checked={entry.target > 0 && entry.packed >= entry.target} disabled={busy || entry.excluded || entry.target === 0} onChange={e => void edit({ action: 'UPDATE_ENTRY', itemId: entry.itemId, packed: e.target.checked ? entry.target : 0 })} />
        <span>{entry.name}</span>
        {entry.needsReview ? <em>Review</em> : entry.excluded ? <em>Excluded</em> : entry.override !== null ? <em>Adjusted</em> : null}
      </label>
      <CountInput key={'target:' + entry.target} value={entry.target} max={entry.mode === 'CHECKBOX' ? 1 : 9999} label={`Quantity for ${entry.name}`} disabled={busy || entry.excluded} onSave={override => edit({ action: 'UPDATE_ENTRY', itemId: entry.itemId, override })} />
      {entry.mode === 'QUANTITY'
        ? <CountInput key={'packed:' + entry.packed} value={entry.packed} max={entry.target} label={`Packed quantity for ${entry.name}`} disabled={busy || entry.excluded} onSave={packed => edit({ action: 'UPDATE_ENTRY', itemId: entry.itemId, packed })} />
        : <span className="packing-count-static" aria-hidden="true">{entry.packed ? '✓' : '—'}</span>}
      <button className="packing-quiet" aria-label={`Details for ${entry.name}`} aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '⋯'}</button>
    </div>
    {expanded ? <div className="packing-entry-details" id={detailId}>
      <p><strong>{entry.explanation.rule}</strong> · Suggested: {entry.suggested}{entry.override !== null ? ` · Yours: ${entry.override}` : ''}</p>
      <p>{entry.manual ? 'Added by you.' : entry.explanation.baseline ? 'Everyday essential.' : entry.explanation.tags.join(' + ')}{entry.explanation.dates.length ? ` ${entry.explanation.dates.length} eligible dates: ${entry.explanation.dates.join(', ')}.` : ''}</p>
      <div className="packing-inline-actions">
        {entry.override !== null ? <button disabled={busy} onClick={() => void edit({ action: 'UPDATE_ENTRY', itemId: entry.itemId, resetOverride: true })}>Use suggestion</button> : null}
        <button disabled={busy} onClick={() => void edit({ action: 'UPDATE_ENTRY', itemId: entry.itemId, excluded: !entry.excluded })}>{entry.excluded ? 'Include again' : 'Exclude'}</button>
        {entry.manual || entry.needsReview ? <button disabled={busy} onClick={() => void edit({ action: 'REMOVE_ENTRY', itemId: entry.itemId })}>Remove item</button> : null}
      </div>
    </div> : null}
  </article>;
}

export function PackingChecklist({ plan, library, busy, edit, onLibrarySaved, onRefresh, onLibraryBusy }: {
  plan: PackingPlan; library: PackingLibrary; busy: boolean; edit: EditPacking;
  onLibrarySaved: (library: PackingLibrary) => void; onRefresh: () => Promise<void>; onLibraryBusy: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const progress = packingProgress(plan.entries);
  const visible = plan.entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()) && (
    filter === 'all' || filter === 'unpacked' && !e.excluded && e.packed < e.target || filter === 'review' && e.needsReview || filter === 'excluded' && e.excluded
  ));
  const groups = [...new Set(visible.map(e => e.category))];
  const available = library.items.filter(i => !i.archived && library.categories.some(c => c.id === i.categoryId && !c.archived) && !plan.entries.some(e => e.itemId === i.id) && i.name.toLowerCase().includes(itemSearch.toLowerCase()));
  return <section className="packing-checklist">
    <div className="packing-section-heading">
      <h2>Packing list <small>{progress.done}/{progress.total} packed</small></h2>
      <button className="button-secondary" disabled={busy} aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? 'Close add item' : '+ Add item'}</button>
    </div>
    <progress aria-label="Packing progress" max={progress.total || 1} value={progress.done} />
    {adding ? <section className="packing-add-panel" aria-label="Add an item">
      <div className="packing-add-toolbar">
        <input type="search" aria-label="Find an item to add" placeholder="Find an item to add…" disabled={busy} value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
        <button className="button-text" disabled={busy} aria-expanded={creating} onClick={() => setCreating(!creating)}>{creating ? 'Choose existing item' : '+ Create item'}</button>
      </div>
      {creating ? <LibraryForm editor={{ kind: 'Item' }} library={library} onBusyChange={onLibraryBusy} onRefresh={onRefresh} onClose={() => setCreating(false)} onSaved={(next, id) => {
        onLibrarySaved(next); setCreating(false);
        setItemSearch(next.items.find(i => i.id === id)?.name ?? '');
      }} /> : <div className="packing-item-options">
        {available.map(item => <button className="packing-item-option" key={item.id} disabled={busy} onClick={() => void edit({ action: 'ADD_ENTRY', itemId: item.id })}><span>{item.name}</span><small>{library.categories.find(c => c.id === item.categoryId)?.name}</small><span aria-hidden="true">+</span></button>)}
        {!available.length ? <p className="packing-help">No matching items available. Create an item above or try another search.</p> : null}
      </div>}
    </section> : null}
    <div className="packing-filters">
      <input type="search" placeholder="Find an item…" aria-label="Search packing list" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Filter packing list" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All items</option><option value="unpacked">Still to pack</option><option value="review">Needs review</option><option value="excluded">Excluded</option></select>
    </div>
    {visible.length ? <div className="packing-list-columns" aria-hidden="true"><span>Item</span><span>Bring</span><span>Packed</span><span /></div> : null}
    {groups.map(category => <details className="packing-group" key={category} open>
      <summary>{category}<span>{visible.filter(e => e.category === category).length}</span></summary>
      {visible.filter(e => e.category === category).map(entry => <EntryRow key={entry.id} entry={entry} busy={busy} edit={edit} />)}
    </details>)}
    {!visible.length ? <p className="packing-empty">{plan.entries.length ? 'No items match this view.' : plan.generatedAt ? 'No suggestions. Add items or update your day tags.' : 'Tag your days and generate a list, or start with everyday essentials.'}</p> : null}
  </section>;
}

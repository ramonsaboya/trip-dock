'use client';

import { useState } from 'react';
import { packingProgress, type PackingLibrary, type PackingPlan } from '../../lib/packing-client';
import { EntryRow } from './entry-row';
import { LibraryForm } from './library-form';
import { type EditPacking } from './packing-types';

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

'use client';

import { Fragment, useState } from 'react';
import { type PackingCategory } from '../../lib/packing-client';
import { LibraryForm } from './library-form';
import { type LibraryEditor, type LibraryViewProps } from './library-types';

export function PackingLibraryView({ library, onSaved, onRefresh, onBusyChange, disabled }: LibraryViewProps) {
  const [view, setView] = useState<'Item' | 'Tag' | 'Category'>('Item');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [category, setCategory] = useState('');
  const [editor, setEditor] = useState<LibraryEditor | null>(null);
  const active = (entry: PackingCategory) => (showArchived || !entry.archived) && entry.name.toLowerCase().includes(search.toLowerCase());
  const filteredItems = library.items.filter(i => active(i) && (!category || i.categoryId === category));
  const form = (value: LibraryEditor) => <LibraryForm key={value.kind + (value.value?.id ?? 'new')} editor={value} library={library} onRefresh={onRefresh} onBusyChange={onBusyChange} onClose={() => setEditor(null)} onSaved={(next, id) => { onSaved(next, id); setEditor(null); }} />;
  const toggle = (next: LibraryEditor) => setEditor(editor?.kind === next.kind && editor.value?.id === next.value?.id ? null : next);
  function row(value: LibraryEditor, summary: string) {
    const record = value.value!;
    const expanded = editor?.kind === value.kind && editor.value?.id === record.id;
    return <Fragment key={record.id}>
      <button className="packing-library-row" disabled={disabled} aria-expanded={expanded} onClick={() => toggle(value)}>
        <span className="packing-row-name">{record.name}{record.archived ? <em>Archived</em> : null}{value.kind === 'Item' && value.value?.baseline ? <em>Essential</em> : null}</span>
        <span className="packing-row-meta">{summary}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded ? form(value) : null}
    </Fragment>;
  }
  return <section className="packing-library">
    <div className="packing-section-heading"><h2>Your library</h2><button className="button-secondary" disabled={disabled} aria-expanded={editor?.kind === view && !editor.value} onClick={() => toggle({ kind: view })}>+ New {view.toLowerCase()}</button></div>
    <div className="packing-filters">
      <div className="packing-segments" aria-label="Library views">{(['Item','Tag','Category'] as const).map(v => <button type="button" disabled={disabled} aria-pressed={view === v} key={v} onClick={() => { setView(v); setEditor(null); }}>{v === 'Category' ? 'Categories' : v + 's'}</button>)}</div>
      <input aria-label="Search library" type="search" placeholder="Search library…" disabled={disabled} value={search} onChange={e => setSearch(e.target.value)} />
      {view === 'Item' ? <select aria-label="Filter category" disabled={disabled} value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{library.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : null}
      <label className="packing-check"><input type="checkbox" disabled={disabled} checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Archived</label>
    </div>
    {editor && !editor.value ? form(editor) : null}
    {view === 'Item' ? library.categories.filter(c => filteredItems.some(i => i.categoryId === c.id)).map(c => <details className="packing-group" key={c.id} open><summary>{c.name}<span>{filteredItems.filter(i => i.categoryId === c.id).length}</span></summary>{filteredItems.filter(i => i.categoryId === c.id).map(i => row({ kind: 'Item', value: i }, i.mode === 'CHECKBOX' ? 'Once' : `${i.quantity} / ${i.interval} ${i.basis.toLowerCase()}`))}</details>) : null}
    {view === 'Tag' ? <div className="packing-library-rows">{library.tags.filter(active).map(t => row({ kind: 'Tag', value: t }, t.itemIds.length + ' items'))}</div> : null}
    {view === 'Category' ? <div className="packing-library-rows">{library.categories.filter(active).map(c => row({ kind: 'Category', value: c }, library.items.filter(i => i.categoryId === c.id).length + ' items'))}</div> : null}
    {!(view === 'Item' ? filteredItems : view === 'Tag' ? library.tags.filter(active) : library.categories.filter(active)).length ? <p className="packing-empty">No matches. Try another search or add your own.</p> : null}
  </section>;
}

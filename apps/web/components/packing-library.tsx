'use client';
import { Fragment, useId, useState, type FormEvent } from 'react';
import { packingApi, type PackingLibrary, type PackingItem, type PackingTag, type PackingCategory } from '../lib/packing-client';

export type LibraryEditor = { kind: 'Item'; value?: PackingItem } | { kind: 'Tag'; value?: PackingTag } | { kind: 'Category'; value?: PackingCategory };
export type LibraryFormProps = {
  editor: LibraryEditor; library: PackingLibrary;
  onSaved: (library: PackingLibrary, savedId?: string) => void;
  onClose: () => void; onRefresh: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function LibraryForm({ editor, library, onSaved, onClose, onRefresh, onBusyChange }: LibraryFormProps) {
  const item = editor.kind === 'Item' ? editor.value : undefined;
  const tag = editor.kind === 'Tag' ? editor.value : undefined;
  const titleId = useId();
  const [name, setName] = useState(editor.value?.name ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? library.categories.find(c => !c.archived)?.id ?? '');
  const [newCategory, setNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [mode, setMode] = useState(item?.mode ?? 'CHECKBOX');
  const [basis, setBasis] = useState(item?.basis ?? 'DAYS');
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [interval, setInterval] = useState(item?.interval ?? 1);
  const [baseline, setBaseline] = useState(item?.baseline ?? false);
  const [archived, setArchived] = useState(editor.value?.archived ?? false);
  const [itemIds, setItemIds] = useState(tag?.itemIds ?? []);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); onBusyChange?.(true);
    try {
      const input = editor.kind === 'Item'
        ? { name, ...(newCategory ? { newCategoryName } : { categoryId }), mode, basis: mode === 'CHECKBOX' ? 'DAYS' : basis, quantity, interval, baseline, archived }
        : editor.kind === 'Tag' ? { name, archived, itemIds } : { name, archived };
      const next = await packingApi.save(editor.kind, library, editor.value?.id ?? null, input);
      const key = editor.kind === 'Item' ? 'items' : editor.kind === 'Tag' ? 'tags' : 'categories';
      const savedId = editor.value?.id ?? next[key].find(record => !library[key].some(old => old.id === record.id))?.id;
      onSaved(next, savedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
      if (e && typeof e === 'object' && 'code' in e && e.code === 'REVISION_CONFLICT') {
        try { await onRefresh(); } catch { /* Keep the draft and original error for retry. */ }
      }
    } finally { setBusy(false); onBusyChange?.(false); }
  }

  return <form className="packing-inline-editor" aria-labelledby={titleId} onSubmit={save}>
    <div className="packing-editor-heading"><h3 id={titleId}>{editor.value ? 'Edit' : 'New'} {editor.kind.toLowerCase()}</h3><button type="button" className="packing-quiet" disabled={busy} onClick={onClose} aria-label="Close editor">×</button></div>
    <fieldset disabled={busy}>
      <div className="packing-form-grid">
        <label>Name<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
        {editor.kind === 'Item' ? <>
          <div className="packing-category-field">
            {newCategory ? <label>New category name<input required maxLength={80} value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="e.g. Photography" /></label>
              : <label>Category<select value={categoryId} required onChange={e => setCategoryId(e.target.value)}><option value="">Choose a category</option>{library.categories.filter(c => !c.archived || c.id === categoryId).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label>}
            <button className="packing-text-action" type="button" onClick={() => setNewCategory(!newCategory)}>{newCategory ? 'Choose existing category' : '+ New category'}</button>
          </div>
          <label>Quantity rule<select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="CHECKBOX">Bring once</option><option value="QUANTITY">Calculate quantity</option></select></label>
        </> : null}
      </div>
      {editor.kind === 'Item' ? <>
        {mode === 'QUANTITY' ? <div className="packing-rule"><label>Bring<input type="number" min={1} max={100} required value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label><label>For every<input type="number" min={1} max={365} required value={interval} onChange={e => setInterval(Number(e.target.value))} /></label><label>Count<select value={basis} onChange={e => setBasis(e.target.value as typeof basis)}><option value="DAYS">Eligible days</option><option value="NIGHTS">Eligible nights</option></select></label></div> : null}
        <label className="packing-check"><input type="checkbox" checked={baseline} onChange={e => setBaseline(e.target.checked)} />Everyday essential</label>
      </> : null}
      {editor.kind === 'Tag' ? <>
        <div className="packing-link-toolbar"><label>Link items<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find items…" /></label><small>{itemIds.length} linked</small></div>
        <div className="packing-link-list">{library.items.filter(i => !i.archived && i.name.toLowerCase().includes(search.toLowerCase())).map(i => <label className="packing-check" key={i.id}><input type="checkbox" checked={itemIds.includes(i.id)} onChange={e => setItemIds(e.target.checked ? [...itemIds, i.id] : itemIds.filter(id => id !== i.id))} /><span>{i.name}</span></label>)}
          {!library.items.some(i => !i.archived && i.name.toLowerCase().includes(search.toLowerCase())) ? <p className="packing-help">No matching items.</p> : null}
        </div>
      </> : null}
      {editor.value ? <label className="packing-check"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Archived</label> : null}
    </fieldset>
    {error ? <p role="alert" className="packing-error">{error}</p> : null}
    <footer className="packing-editor-actions"><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save ' + editor.kind.toLowerCase()}</button><button className="button-text" type="button" disabled={busy} onClick={onClose}>Cancel</button></footer>
  </form>;
}

type LibraryViewProps = Omit<LibraryFormProps, 'editor' | 'onClose'> & { disabled?: boolean };
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

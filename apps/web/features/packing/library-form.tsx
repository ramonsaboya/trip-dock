'use client';

import { useId, useState, type FormEvent } from 'react';
import { packingApi } from '../../lib/packing-client';
import { type LibraryFormProps } from './library-types';

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

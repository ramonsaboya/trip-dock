'use client';

import { useId, useState } from 'react';
import { type PackingEntry } from '../../lib/packing-client';
import { CountInput } from './count-input';
import { type EditPacking } from './packing-types';

export function EntryRow({ entry, busy, edit }: { entry: PackingEntry; busy: boolean; edit: EditPacking }) {
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

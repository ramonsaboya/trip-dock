import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, daysBetween, fingerprint, reconcile, type Library, type Entry } from '../src/packing-domain.js';
import { catalog, starterRule } from '../src/packing-catalog.js';
function library(): Library {
  return { revision: 0,
    categories: catalog.categories.map(c => ({ id: c.name, profileId: 'test', name: c.name, normalizedName: c.name, archived: false })),
    items: catalog.categories.flatMap(c => c.items.map(name => ({ id: name, profileId: 'test', categoryId: c.name, name, normalizedName: name, archived: false, ...starterRule(name) }))),
    tags: catalog.tags.map(t => ({ id: t.name, profileId: 'test', name: t.name, normalizedName: t.name, archived: false, itemIds: [...t.items] })),
  };
}
const assignments = [
  { day: '2026-09-11', tagId: 'Beach day' }, { day: '2026-09-12', tagId: 'Beach day' },
  { day: '2026-09-12', tagId: 'Pool / spa' }, { day: '2026-09-11', tagId: 'Fancy dinner' },
  { day: '2026-09-13', tagId: 'Fancy dinner' }, { day: '2026-09-13', tagId: 'Nightclub' },
  { day: '2026-09-14', tagId: 'Hiking' },
];
test('packing worked example deduplicates dates across tags and applies personal reuse rules', () => {
  const result = calculate(library(), '2026-09-10', '2026-09-14', [...assignments, assignments[0]!]);
  for (const [name, quantity] of Object.entries({ Underwear: 5, Pajamas: 2, 'Casual trousers': 2, Swimwear: 1, Sunglasses: 1, 'Fancy trousers': 1, 'Smart top': 2, 'Going-out top': 1, 'Hiking shirt': 1, 'Phone charger': 1 })) {
    assert.equal(result.find(i => i.name === name)?.suggested, quantity, name);
  }
  assert.deepEqual(result.find(i => i.name === 'Swimwear')?.explanation.dates, ['2026-09-11','2026-09-12']);
});
test('packing calendar days handle DST, leap day and same-day trips without pajamas', () => {
  assert.deepEqual(daysBetween('2028-02-28','2028-03-01'), ['2028-02-28','2028-02-29','2028-03-01']);
  assert.equal(daysBetween('2026-03-28','2026-03-30').length, 3);
  const result = calculate(library(),'2026-09-10','2026-09-10',[]);
  assert.equal(result.find(i=>i.name==='Underwear')?.suggested,1);
  assert.equal(result.find(i=>i.name==='Pajamas'),undefined);
  assert.throws(()=>daysBetween('2026-02-30','2026-03-03'));
  assert.throws(()=>daysBetween('2026-09-12','2026-09-10'));
});
test('all 30 starter tags reference real items and baseline/tag overlaps do not multiply quantities', () => {
  const lib = library();
  assert.equal(lib.tags.length,30);
  for (const tag of lib.tags) { assert.ok(tag.itemIds.length); for(const id of tag.itemIds) assert.ok(lib.items.some(i=>i.id===id),id); }
  lib.tags[0]!.itemIds.push('Underwear');
  assert.equal(calculate(lib,'2026-09-10','2026-09-14',assignments).find(i=>i.name==='Underwear')?.suggested,5);
  assert.equal(calculate(lib,'2026-09-10','2026-09-14',[{day:'2026-09-09',tagId:'Beach day'}]).find(i=>i.name==='Swimwear'),undefined);
});
test('fingerprints ignore assignment order but change when a relevant rule or dates change', () => {
  const lib = library();
  const original = fingerprint(lib,'2026-09-10','2026-09-14',assignments);
  assert.equal(original,fingerprint(lib,'2026-09-10','2026-09-14',[...assignments].reverse()));
  lib.items.find(i=>i.name==='Underwear')!.quantity=2;
  assert.notEqual(original,fingerprint(lib,'2026-09-10','2026-09-14',assignments));
});
test('recalculation preserves overrides including zero, excluded items and obsolete packed items for review', () => {
  const suggested = calculate(library(),'2026-09-10','2026-09-14',assignments);
  const old: Entry[] = suggested.map((s,index)=>({...s,id:String(index),profileId:'test',planId:'test',override:null,packed:0,excluded:false,manual:false,needsReview:false}));
  old.find(e=>e.name==='Underwear')!.override=0;
  old.find(e=>e.name==='Swimwear')!.packed=1;
  old.find(e=>e.name==='Sunglasses')!.excluded=true;
  old.find(e=>e.name==='Pajamas')!.packed=2;
  const next = reconcile(old,calculate(library(),'2026-09-10','2026-09-11',[]));
  assert.equal(next.find(e=>e.name==='Underwear')?.override,0);
  assert.equal(next.find(e=>e.name==='Pajamas')?.packed,1);
  assert.equal(next.find(e=>e.name==='Swimwear')?.needsReview,true);
  assert.equal(next.find(e=>e.name==='Swimwear')?.override,1);
  assert.equal(next.find(e=>e.name==='Sunglasses')?.excluded,true);
  assert.equal(next.find(e=>e.name==='Hiking shirt'),undefined);
});


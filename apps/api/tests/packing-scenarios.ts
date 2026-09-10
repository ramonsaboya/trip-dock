import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApi } from '../src/graphql.js';
import { UnconfiguredAiGateway } from '../src/ai.js';
import { packingTagItems } from '../src/db/schema.js';
import { loadLibrary } from '../src/packing-data.js';
import type { AppDatabase } from '../src/db/client.js';
import type { Library, Entry } from '../src/packing-domain.js';

const libraryFields = 'revision categories { id name archived } items { id categoryId name mode baseline quantity interval basis archived } tags { id name archived itemIds }';
const planFields = 'id tripId revision startDate endDate stale generatedAt assignments { day tagId } entries { id itemId name category mode suggested override packed excluded manual needsReview explanation { rule dates tags baseline } }';
type Plan = { id: string; tripId: string; revision: number; startDate: string; endDate: string; stale: boolean; assignments: {day:string;tagId:string}[]; entries: Entry[] };
export async function exercisePacking(db: AppDatabase, concurrent = false) {
  const first = randomUUID(), second = randomUUID();
  function client(profile: string) {
    const api = createApi({db,aiGateway:new UnconfiguredAiGateway(),webOrigin:'http://localhost:3000',packingProfileId:profile});
    return async <T>(query: string, variables: Record<string,unknown> = {}): Promise<T> => {
      const response = await api.fetch('http://localhost:4000/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});
      const json = await response.json() as {data?:{result:T};errors?:{message:string}[]};
      if(json.errors) throw new Error(json.errors.map(e=>e.message).join('; '));
      return json.data!.result;
    };
  }
  const a=client(first), b=client(second);
  assert.equal(await a('query { result: packingLibrary { revision } }'),null);
  let lib=await a<Library>(`mutation { result: initializePacking { ${libraryFields} } }`);
  assert.equal(lib.tags.length,30); assert.ok(lib.items.length>100);
  assert.equal((await a<Library>(`mutation { result: initializePacking { ${libraryFields} } }`)).items.length,lib.items.length);
  const other=await b<Library>(`mutation { result: initializePacking { ${libraryFields} } }`);
  assert.notEqual(lib.items[0]!.id,other.items[0]!.id);
  const tripInput = { name: 'Packing test', destinationArea: 'Coast', startDate: '2026-09-10', endDate: '2026-09-14', travelerCount: 4 };
  const createTrip = (name: string) => a<{ id: string; revision: number }>(
    'mutation($input:CreateTripInput!){result:createTrip(input:$input){id revision}}',
    { input: { ...tripInput, name, stops: [{ name: 'Lisbon', locationText: null, arrivalDate: tripInput.startDate, departureDate: tripInput.endDate }] } },
  );
  const trip = await createTrip(tripInput.name);
  const tripId=trip.id;
  let plan=await a<Plan>(`mutation($tripId:ID!){result:openPackingPlan(tripId:$tripId){${planFields}}}`,{tripId});
  const mutate=(input:Record<string,unknown>,revision=plan.revision)=>a<Plan>(`mutation($tripId:ID!,$revision:Int!,$input:PackingPlanEditInput!){result:editPackingPlan(tripId:$tripId,expectedRevision:$revision,input:$input){${planFields}}}`,{tripId,revision,input});
  const get=()=>a<Plan>(`query($tripId:ID!){result:packingPlan(tripId:$tripId){${planFields}}}`,{tripId});
  const tagId=lib.tags.find(t=>t.name==='Beach day')!.id;
  await assert.rejects(mutate({action:'ASSIGN',days:['2026-09-11','2026-09-20'],tagId}),/outside/);
  assert.equal((await get()).assignments.length,0,'atomic invalid batch');
  plan=await mutate({action:'ASSIGN',days:['2026-09-11','2026-09-12','2026-09-12'],tagId});
  assert.equal(plan.assignments.length,2);
  const secondTrip = await createTrip('Separate packing trip');
  const separatePlan = await a<Plan>(`mutation($tripId:ID!){result:openPackingPlan(tripId:$tripId){${planFields}}}`, { tripId: secondTrip.id });
  assert.equal(separatePlan.tripId, secondTrip.id);
  assert.deepEqual(separatePlan.assignments, [], 'opening another real trip starts with its own day tags');
  assert.deepEqual(separatePlan.entries, []);
  assert.equal((await get()).assignments.length, 2, 'returning to the first trip keeps its assigned days');
  await assert.rejects(mutate({action:'ASSIGN',days:['2026-09-11'],tagId:other.tags[0]!.id}),/your library/);
  const generate=()=>mutate({action:'GENERATE',expectedLibraryRevision:lib.revision,startDate:plan.startDate,endDate:plan.endDate});
  plan=await generate();
  assert.equal(plan.entries.find(e=>e.name==='Underwear')!.suggested,5,'not multiplied by travelers');
  assert.equal(plan.entries.find(e=>e.name==='Pajamas')!.suggested,2);
  assert.equal(plan.entries.find(e=>e.name==='Swimwear')!.suggested,1);
  const underwear=plan.entries.find(e=>e.name==='Underwear')!.itemId;
  plan=await mutate({action:'UPDATE_ENTRY',itemId:underwear,override:7,packed:3});
  plan=await generate();
  assert.equal(plan.entries.find(e=>e.itemId===underwear)!.override,7);
  assert.equal(plan.entries.find(e=>e.itemId===underwear)!.packed,3);
  await assert.rejects(mutate({action:'UPDATE_ENTRY',itemId:underwear,packed:8}),/exceed/);
  await assert.rejects(mutate({action:'UPDATE_ENTRY',itemId:underwear,packed:1},0),/another request/);
  const refreshed=client(first);
  const persisted=await refreshed<Plan>(`query($tripId:ID!){result:packingPlan(tripId:$tripId){${planFields}}}`,{tripId});
  assert.equal(persisted.entries.find(e=>e.itemId===underwear)!.packed,3);
  assert.equal(await b('query($tripId:ID!){result:packingPlan(tripId:$tripId){id}}',{tripId}),null);
  await assert.rejects(b('mutation($tripId:ID!){result:editPackingPlan(tripId:$tripId,expectedRevision:0,input:{action:"UPDATE_ENTRY"}){id}}',{tripId}),/not found/);
  const saveTag=(input:Record<string,unknown>,id:string|null=null,revision=lib.revision)=>a<Library>(`mutation($input:PackingTagInput!,$id:ID,$revision:Int!){result:savePackingTag(input:$input,id:$id,expectedRevision:$revision){${libraryFields}}}`,{input,id,revision});
  await assert.rejects(saveTag({name:'Foreign',archived:false,itemIds:[other.items[0]!.id]}),/own library/);
  assert.equal((await loadLibrary(db,first))!.revision,lib.revision,'failed mutation does not change revision');
  lib=await saveTag({name:'My custom day',archived:false,itemIds:[underwear]});
  await assert.rejects(saveTag({name:'MY CUSTOM DAY',archived:false,itemIds:[]}),/already/);
  await assert.rejects(saveTag({name:'Wrong owner',archived:false,itemIds:[]},other.tags[0]!.id),/not found/);
  // Database constraints independently prevent a cross-profile link.
  await assert.rejects(db.insert(packingTagItems).values({profileId:first,tagId:tagId,itemId:other.items[0]!.id}));
  const category=lib.categories.find(c=>c.name==='Electronics')!;
  lib=await a<Library>(`mutation($input:PackingItemInput!,$revision:Int!){result:savePackingItem(input:$input,expectedRevision:$revision){${libraryFields}}}`,{revision:lib.revision,input:{name:'My custom cable',categoryId:category.id,mode:'QUANTITY',quantity:1,interval:1,basis:'DAYS',baseline:false,archived:false}});
  const custom=lib.items.find(i=>i.name==='My custom cable')!;
  const saveItem = (input: Record<string, unknown>, id: string | null = null) => a<Library>(
    `mutation($input:PackingItemInput!,$revision:Int!,$id:ID){result:savePackingItem(input:$input,expectedRevision:$revision,id:$id){${libraryFields}}}`,
    { revision: lib.revision, input, id },
  );
  const itemValues = { name: 'My lens cloth', mode: 'CHECKBOX', quantity: 1, interval: 1, basis: 'DAYS', baseline: false, archived: false };
  const beforeCategory = lib;
  lib = await saveItem({ ...itemValues, newCategoryName: '  Photography kit  ' });
  const createdCategory = lib.categories.find(c => c.name === 'Photography kit')!;
  assert.ok(createdCategory);
  assert.equal(lib.items.find(i => i.name === itemValues.name)!.categoryId, createdCategory.id);
  assert.equal(lib.categories.length, beforeCategory.categories.length + 1);
  assert.equal(lib.items.length, beforeCategory.items.length + 1);
  assert.equal(lib.revision, beforeCategory.revision + 1, 'one revision for the combined save');
  const beforeInvalid = lib;
  await assert.rejects(saveItem({ ...itemValues, name: 'Invalid category choice' }), /Choose a category/);
  await assert.rejects(saveItem({ ...itemValues, categoryId: category.id, newCategoryName: 'Ambiguous category' }), /Choose a category/);
  await assert.rejects(saveItem({ ...itemValues, categoryId: other.categories[0]!.id }), /your library/);
  await assert.rejects(saveItem({ ...itemValues, newCategoryName: 'Invalid rule category', quantity: 0 }));
  await assert.rejects(saveItem({ ...itemValues, newCategoryName: 'PHOTOGRAPHY KIT', name: 'Duplicate category item' }), /already/);
  await assert.rejects(saveItem({ ...itemValues, categoryId: createdCategory.id }), /already/);
  await assert.rejects(saveItem({ ...itemValues, newCategoryName: 'Foreign edit category' }, other.items[0]!.id), /not found/);
  const afterInvalid = (await loadLibrary(db, first))!;
  assert.equal(afterInvalid.revision, beforeInvalid.revision);
  assert.equal(afterInvalid.items.length, beforeInvalid.items.length);
  assert.deepEqual(afterInvalid.categories.map(c => c.name), beforeInvalid.categories.map(c => c.name), 'rejected item saves leave no category behind');
  plan=await mutate({action:'ADD_ENTRY',itemId:custom.id});
  plan=await mutate({action:'UPDATE_ENTRY',itemId:custom.id,override:2,packed:1});
  plan=await generate();
  assert.equal(plan.entries.find(e=>e.itemId===custom.id)!.packed,1);
  plan=await mutate({action:'UPDATE_ENTRY',itemId:underwear,override:0});
  plan=await generate();
  assert.equal(plan.entries.find(e=>e.itemId===underwear)!.override,0);
  plan=await mutate({action:'UPDATE_ENTRY',itemId:underwear,resetOverride:true});
  assert.equal(plan.entries.find(e=>e.itemId===underwear)!.override,null);
  if(concurrent){
    const outcomes=await Promise.allSettled([mutate({action:'UPDATE_ENTRY',itemId:underwear,packed:1}),mutate({action:'UPDATE_ENTRY',itemId:underwear,packed:2})]);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
    plan=await get();
  }
  const updatedTrip = await a<{ revision: number }>(
    'mutation($id:ID!,$revision:Int!,$input:UpdateTripInput!){result:updateTrip(id:$id,expectedRevision:$revision,input:$input){revision}}',
    { id: tripId, revision: trip.revision, input: { ...tripInput, endDate: '2026-09-11' } },
  );
  plan=await get(); assert.equal(plan.stale,true); assert.equal(plan.assignments.length,2);
  assert.equal(plan.endDate, '2026-09-11', 'packing follows dates edited through the schedule API');
  plan=await generate(); assert.equal(plan.entries.find(e=>e.name==='Underwear')!.suggested,2);
  plan=await mutate({action:'ASSIGN',days:['2026-09-12'],tagId,remove:true});
  assert.equal(plan.assignments.length,1);
  await a('mutation($id:ID!,$revision:Int!){result:deleteTrip(id:$id,expectedRevision:$revision)}', { id: tripId, revision: updatedTrip.revision });
  assert.equal(await get(),null);
  assert.ok((await loadLibrary(db,first))!.items.some(i=>i.id===custom.id));
}

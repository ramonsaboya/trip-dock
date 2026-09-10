import { graphqlRequest } from './graphql-client.ts';
export type PackingCategory = { id: string; name: string; archived: boolean };
export type PackingItem = PackingCategory & { categoryId: string; mode: 'CHECKBOX' | 'QUANTITY'; baseline: boolean; quantity: number; interval: number; basis: 'DAYS' | 'NIGHTS' };
export type PackingTag = PackingCategory & { itemIds: string[] };
export type PackingLibrary = { revision: number; categories: PackingCategory[]; items: PackingItem[]; tags: PackingTag[] };
export type PackingEntry = { id: string; itemId: string; name: string; category: string; mode: string; suggested: number; override: number | null; target: number; packed: number; excluded: boolean; manual: boolean; needsReview: boolean; explanation: { rule: string; dates: string[]; tags: string[]; baseline: boolean } };
export type PackingPlan = { id: string; tripId: string; revision: number; startDate: string; endDate: string; generatedAt: string | null; stale: boolean; assignments: { day: string; tagId: string }[]; entries: PackingEntry[] };
export type PlanEdit = { action: 'ASSIGN' | 'GENERATE' | 'UPDATE_ENTRY' | 'ADD_ENTRY' | 'REMOVE_ENTRY'; days?: string[]; tagId?: string; remove?: boolean; itemId?: string; override?: number; resetOverride?: boolean; packed?: number; excluded?: boolean; expectedLibraryRevision?: number; startDate?: string; endDate?: string };
export const libraryFields = 'revision categories { id name archived } items { id categoryId name mode baseline quantity interval basis archived } tags { id name archived itemIds }';
export const planFields = 'id tripId revision startDate endDate generatedAt stale assignments { day tagId } entries { id itemId name category mode suggested override target packed excluded manual needsReview explanation { rule dates tags baseline } }';
async function request<T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal) {
  return (await graphqlRequest<{ result: T }, Record<string, unknown>>(query, variables, signal)).result;
}
export const packingApi = {
  initialize: (signal?: AbortSignal) => request<PackingLibrary>(`mutation { result: initializePacking { ${libraryFields} } }`, {}, signal),
  library: () => request<PackingLibrary>(`query { result: packingLibrary { ${libraryFields} } }`),
  open: (tripId: string, signal?: AbortSignal) => request<PackingPlan>(`mutation($tripId: ID!) { result: openPackingPlan(tripId: $tripId) { ${planFields} } }`, { tripId }, signal),
  plan: (tripId: string) => request<PackingPlan>(`query($tripId: ID!) { result: packingPlan(tripId: $tripId) { ${planFields} } }`, { tripId }),
  edit: (plan: PackingPlan, input: PlanEdit) => request<PackingPlan>(`mutation($tripId: ID!, $expectedRevision: Int!, $input: PackingPlanEditInput!) { result: editPackingPlan(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${planFields} } }`, { tripId: plan.tripId, expectedRevision: plan.revision, input }),
  save: (kind: 'Item' | 'Tag' | 'Category', library: PackingLibrary, id: string | null, input: Record<string, unknown>) => request<PackingLibrary>(`mutation($id: ID, $expectedRevision: Int!, $input: Packing${kind}Input!) { result: savePacking${kind}(id: $id, expectedRevision: $expectedRevision, input: $input) { ${libraryFields} } }`, { id, expectedRevision: library.revision, input }),
};
export function packingDates(start: string, end: string) {
  const days: string[] = [];
  for (let time = Date.parse(start + 'T12:00:00Z'); time <= Date.parse(end + 'T12:00:00Z') && days.length < 3660; time += 86400000) days.push(new Date(time).toISOString().slice(0,10));
  return days;
}
export function packingProgress(entries: PackingEntry[]) {
  const included = entries.filter(e => !e.excluded && e.target > 0);
  return { total: included.length, done: included.filter(e => e.packed >= e.target).length };
}


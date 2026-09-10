import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, isoDateSchema } from './domain.js';
import type { packingItems, packingEntries, packingCategories, packingTags, packingTagItems, packingDayTags } from './db/schema.js';

export type Item = typeof packingItems.$inferSelect;
export type Entry = typeof packingEntries.$inferSelect;
export type Library = {
  revision: number;
  categories: Array<typeof packingCategories.$inferSelect>;
  items: Item[];
  tags: Array<typeof packingTags.$inferSelect & { itemIds: string[] }>;
};
export type Assignment = Pick<typeof packingDayTags.$inferSelect, 'day' | 'tagId'>;
export type Link = typeof packingTagItems.$inferSelect;
export const nameInput = z.string().trim().min(1).max(80);
export const itemInput = z.object({
  categoryId: z.string().uuid().nullish(), newCategoryName: nameInput.nullish(),
  name: nameInput, mode: z.enum(['CHECKBOX','QUANTITY']),
  baseline: z.boolean(), quantity: z.number().int().min(1).max(100), interval: z.number().int().min(1).max(365),
  basis: z.enum(['DAYS','NIGHTS']), archived: z.boolean().default(false),
}).refine(input => Boolean(input.categoryId) !== Boolean(input.newCategoryName), 'Choose a category or enter a new category name.');
export function daysBetween(start: string, end: string) {
  isoDateSchema.parse(start); isoDateSchema.parse(end);
  if (end < start) throw new AppError('Trip end must follow its start.', 'BAD_USER_INPUT');
  const count = Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86400000) + 1;
  if (count > 3660) throw new AppError('Packing supports trips up to ten years.', 'BAD_USER_INPUT');
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(start + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10));
}
export function calculate(library: Library, start: string, end: string, assignments: Assignment[]) {
  const days = daysBetween(start, end);
  const available = new Set(days);
  const activeTags = library.tags.filter(t => !t.archived);
  return library.items.filter(item => !item.archived && library.categories.some(c => c.id === item.categoryId && !c.archived)).flatMap(item => {
    const tags = activeTags.filter(tag => tag.itemIds.includes(item.id));
    const tagIds = new Set(tags.map(t => t.id));
    const matches = assignments.filter(a => available.has(a.day) && tagIds.has(a.tagId));
    const dates = [...new Set(item.baseline ? days : matches.map(a => a.day))].filter(day => item.basis !== 'NIGHTS' || day !== end).sort();
    if (!dates.length) return [];
    const suggested = item.mode === 'CHECKBOX' ? 1 : Math.ceil(dates.length / item.interval) * item.quantity;
    if (suggested > 9999) throw new AppError('A suggested quantity is too large. Adjust its rule.', 'BAD_USER_INPUT');
    return [{
      itemId: item.id, name: item.name, category: library.categories.find(c => c.id === item.categoryId)!.name, mode: item.mode, suggested,
      explanation: {
        baseline: item.baseline, dates,
        tags: tags.filter(t => matches.some(a => a.tagId === t.id && dates.includes(a.day))).map(t => t.name).sort(),
        rule: item.mode === 'CHECKBOX' ? 'Bring once' : `${item.quantity} every ${item.interval} ${item.basis === 'NIGHTS' ? 'night(s)' : 'eligible day(s)'}`,
      },
    }];
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
export function fingerprint(library: Library, start: string, end: string, assignments: Assignment[]) {
  const suggestions = calculate(library, start, end, assignments);
  return createHash('sha256').update(JSON.stringify({ algorithm: 1, start, end, suggestions })).digest('hex');
}
export function target(entry: Pick<Entry, 'override' | 'suggested' | 'excluded'>) {
  return entry.excluded ? 0 : entry.override ?? entry.suggested;
}
export function reconcile(previous: Entry[], suggestions: ReturnType<typeof calculate>) {
  const result = suggestions.map(suggestion => {
    const old = previous.find(e => e.itemId === suggestion.itemId);
    // Keep the previous mode if a library edit would invalidate a manual quantity.
    const mode = old && suggestion.mode === 'CHECKBOX' && (old.override ?? 0) > 1 ? old.mode : suggestion.mode;
    const next = { ...suggestion, mode, override: old?.override ?? null, packed: old?.packed ?? 0, excluded: old?.excluded ?? false, manual: old?.manual ?? false, needsReview: mode !== suggestion.mode };
    return { ...next, packed: Math.min(next.packed, target(next)) };
  });
  for (const old of previous) {
    if (suggestions.some(s => s.itemId === old.itemId)) continue;
    if (old.manual || old.override !== null || old.packed > 0 || old.excluded) {
      result.push({ itemId: old.itemId, name: old.name, category: old.category, mode: old.mode, suggested: 0,
        override: old.override ?? (old.packed > 0 ? old.suggested : null), packed: old.packed,
        excluded: old.excluded, manual: old.manual, needsReview: true,
        explanation: { ...old.explanation, rule: 'No longer suggested — review or remove' } });
    }
  }
  return result;
}

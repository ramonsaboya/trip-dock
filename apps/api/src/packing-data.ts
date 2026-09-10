import { and, eq } from 'drizzle-orm';
import { GraphQLError } from 'graphql';
import { z } from 'zod';
import type { AppDatabase } from './db/client.js';
import { trips, packingProfiles as profiles, packingCategories as categories, packingItems as items, packingTags as tags, packingTagItems as links, packingPlans as plans, packingDayTags as dayTags, packingEntries as entries } from './db/schema.js';
import { AppError, isoDateSchema } from './domain.js';
import { catalog, starterRule } from './packing-catalog.js';
import { calculate, daysBetween, fingerprint, itemInput, nameInput, reconcile, target, type Library } from './packing-domain.js';

type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type Reader = Pick<AppDatabase, 'select'>;
export const LOCAL_PACKING_PROFILE = '00000000-0000-4000-8000-000000000001';
const idInput = z.string().uuid();
const revisionInput = z.number().int().nonnegative();
const count = z.number().int().min(0).max(9999);
const normalize = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase('en');
const fail = (message: string) => { throw new AppError(message, 'BAD_USER_INPUT'); };
const conflict = () => { throw new AppError('Packing changed in another request. Refresh and try again.', 'REVISION_CONFLICT'); };

async function checked<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof AppError) throw new GraphQLError(error.message, { extensions: { code: error.code } });
    if (error instanceof z.ZodError) throw new GraphQLError(error.issues[0]?.message ?? 'Check the packing fields.', { extensions: { code: 'BAD_USER_INPUT' } });
    const cause = error as { code?: string; cause?: { code?: string } };
    if ((cause.code ?? cause.cause?.code) === '23505') throw new GraphQLError('That name is already in your library. Edit the existing entry or choose another name.', { extensions: { code: 'BAD_USER_INPUT' } });
    throw error;
  }
}
export async function loadLibrary(db: Reader, profileId: string): Promise<Library | null> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!profile) return null;
  const [categoryList, itemList, tagList, linkList] = await Promise.all([
    db.select().from(categories).where(eq(categories.profileId, profileId)),
    db.select().from(items).where(eq(items.profileId, profileId)),
    db.select().from(tags).where(eq(tags.profileId, profileId)),
    db.select().from(links).where(eq(links.profileId, profileId)),
  ]);
  return {
    revision: profile.revision,
    categories: categoryList.sort((a,b) => a.name.localeCompare(b.name)),
    items: itemList.sort((a,b) => a.name.localeCompare(b.name)),
    tags: tagList.map(tag => ({ ...tag, itemIds: linkList.filter(l => l.tagId === tag.id).map(l => l.itemId).sort() })).sort((a,b) => a.name.localeCompare(b.name)),
  };
}
async function lockProfile(tx: Tx, profileId: string, expected?: number) {
  const [profile] = await tx.select().from(profiles).where(eq(profiles.id, profileId)).for('update');
  if (!profile) throw new AppError('Open your packing library first.', 'NOT_FOUND');
  if (expected !== undefined && profile.revision !== revisionInput.parse(expected)) conflict();
  return profile;
}
async function bootstrap(db: AppDatabase, profileId: string) {
  return db.transaction(async tx => {
    const created = await tx.insert(profiles).values({ id: profileId }).onConflictDoNothing().returning();
    await lockProfile(tx, profileId);
    if (created.length) {
      const byName = new Map<string, string>();
      for (const group of catalog.categories) {
        const [category] = await tx.insert(categories).values({ profileId, name: group.name, normalizedName: normalize(group.name) }).returning();
        const result = await tx.insert(items).values(group.items.map(name => ({ profileId, categoryId: category!.id, name, normalizedName: normalize(name), ...starterRule(name) }))).returning();
        for (const item of result) byName.set(item.name, item.id);
      }
      for (const template of catalog.tags) {
        const [tag] = await tx.insert(tags).values({ profileId, name: template.name, normalizedName: normalize(template.name) }).returning();
        await tx.insert(links).values(template.items.map(name => ({ profileId, tagId: tag!.id, itemId: byName.get(name)! })));
      }
    }
    return (await loadLibrary(tx, profileId))!;
  });
}
async function readPlan(db: Reader, profileId: string, tripId: string) {
  const [plan] = await db.select().from(plans).where(and(eq(plans.profileId, profileId), eq(plans.tripId, tripId)));
  if (!plan) return null;
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return null;
  const [assignments, list, library] = await Promise.all([
    db.select().from(dayTags).where(and(eq(dayTags.profileId, profileId), eq(dayTags.planId, plan.id))),
    db.select().from(entries).where(and(eq(entries.profileId, profileId), eq(entries.planId, plan.id))),
    loadLibrary(db, profileId),
  ]);
  return { ...plan, startDate: trip.startDate, endDate: trip.endDate,
    assignments: assignments.sort((a,b) => a.day.localeCompare(b.day) || a.tagId.localeCompare(b.tagId)),
    entries: list.map(e => ({...e, target: target(e)})).sort((a,b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    stale: !!plan.generatedAt && plan.fingerprint !== fingerprint(library!, trip.startDate, trip.endDate, assignments),
  };
}

const editInput = z.object({
  action: z.enum(['ASSIGN','GENERATE','UPDATE_ENTRY','ADD_ENTRY','REMOVE_ENTRY']),
  days: z.array(isoDateSchema).max(3660).nullish(), tagId: idInput.nullish(), remove: z.boolean().nullish(),
  itemId: idInput.nullish(), override: count.nullish(), resetOverride: z.boolean().nullish(),
  packed: count.nullish(), excluded: z.boolean().nullish(), expectedLibraryRevision: revisionInput.nullish(),
  startDate: isoDateSchema.nullish(), endDate: isoDateSchema.nullish(),
});
export function packingResolvers(db: AppDatabase, profileId = LOCAL_PACKING_PROFILE) {
  idInput.parse(profileId);
  async function saveLibrary(kind: 'CATEGORY' | 'ITEM' | 'TAG', id: string | null | undefined, expectedRevision: number, raw: unknown) {
    return checked(() => db.transaction(async tx => {
      if (id) idInput.parse(id);
      const profile = await lockProfile(tx, profileId, expectedRevision);
      const library = (await loadLibrary(tx, profileId))!;
      if (kind === 'ITEM') {
        const input = itemInput.parse(raw);
        if (id && !library.items.some(i => i.id === id)) throw new AppError('Item not found.', 'NOT_FOUND');
        const { newCategoryName, categoryId: existingCategoryId, ...itemValues } = input;
        let categoryId = existingCategoryId;
        if (newCategoryName) {
          const [created] = await tx.insert(categories).values({ profileId, name: newCategoryName, normalizedName: normalize(newCategoryName) }).returning();
          categoryId = created!.id;
        } else if (!library.categories.some(c => c.id === categoryId && !c.archived)) fail('Choose an active category from your library.');
        const values = { ...itemValues, categoryId: categoryId!, normalizedName: normalize(input.name), profileId };
        if (id) await tx.update(items).set(values).where(and(eq(items.id, id), eq(items.profileId, profileId)));
        else await tx.insert(items).values(values);
      } else {
        const input = z.object({ name: nameInput, archived: z.boolean().default(false), itemIds: z.array(idInput).max(1000).optional() }).parse(raw);
        const records = kind === 'CATEGORY' ? library.categories : library.tags;
        if (id && !records.some(r => r.id === id)) throw new AppError('Library entry not found.', 'NOT_FOUND');
        const table = kind === 'CATEGORY' ? categories : tags;
        const values = { name: input.name, normalizedName: normalize(input.name), archived: input.archived, profileId };
        const [saved] = id
          ? await tx.update(table).set(values).where(and(eq(table.id, id), eq(table.profileId, profileId))).returning()
          : await tx.insert(table).values(values).returning();
        if (kind === 'TAG' && input.itemIds !== undefined) {
          const itemIds = [...new Set(input.itemIds)];
          if (itemIds.some(itemId => !library.items.some(i => i.id === itemId))) fail('Choose items from your own library.');
          await tx.delete(links).where(and(eq(links.profileId, profileId), eq(links.tagId, saved!.id)));
          if (itemIds.length) await tx.insert(links).values(itemIds.map(itemId => ({ profileId, tagId: saved!.id, itemId })));
        }
      }
      await tx.update(profiles).set({ revision: profile.revision + 1 }).where(eq(profiles.id, profileId));
      return (await loadLibrary(tx, profileId))!;
    }));
  }
  return {
    Query: {
      packingLibrary: () => checked(() => loadLibrary(db, profileId)),
      packingPlan: (_: unknown, args: { tripId: string }) => checked(() => readPlan(db, profileId, idInput.parse(args.tripId))),
    },
    Mutation: {
      initializePacking: () => checked(() => bootstrap(db, profileId)),
      savePackingCategory: (_: unknown, a: { id?: string; expectedRevision: number; input: unknown }) => saveLibrary('CATEGORY', a.id, a.expectedRevision, a.input),
      savePackingItem: (_: unknown, a: { id?: string; expectedRevision: number; input: unknown }) => saveLibrary('ITEM', a.id, a.expectedRevision, a.input),
      savePackingTag: (_: unknown, a: { id?: string; expectedRevision: number; input: unknown }) => saveLibrary('TAG', a.id, a.expectedRevision, a.input),
      openPackingPlan: (_: unknown, a: { tripId: string }) => checked(() => db.transaction(async tx => {
        const tripId = idInput.parse(a.tripId);
        const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).for('update');
        if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
        await lockProfile(tx, profileId);
        await tx.insert(plans).values({ profileId, tripId }).onConflictDoNothing().returning();
        return (await readPlan(tx, profileId, tripId))!;
      })),
      editPackingPlan: (_: unknown, a: { tripId: string; expectedRevision: number; input: unknown }) => checked(() => db.transaction(async tx => {
        const tripId = idInput.parse(a.tripId);
        const input = editInput.parse(a.input);
        const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).for('update');
        if (!trip) throw new AppError('Trip not found.', 'NOT_FOUND');
        await lockProfile(tx, profileId);
        const [plan] = await tx.select().from(plans).where(and(eq(plans.profileId, profileId), eq(plans.tripId, tripId))).for('update');
        if (!plan) throw new AppError('Packing plan not found.', 'NOT_FOUND');
        if (plan.revision !== revisionInput.parse(a.expectedRevision)) conflict();
        const library = (await loadLibrary(tx, profileId))!;
        const current = (await readPlan(tx, profileId, tripId))!;
        const entryWhere = (itemId: string) => and(eq(entries.profileId, profileId), eq(entries.planId, plan.id), eq(entries.itemId, itemId));
        if (input.action === 'ASSIGN') {
          const tagId = idInput.parse(input.tagId);
          if (!library.tags.some(t => t.id === tagId && (input.remove || !t.archived))) fail('Choose an active tag from your library.');
          if (!input.days?.length) fail('Select at least one day.');
          const validDays = new Set(daysBetween(trip.startDate, trip.endDate));
          for (const day of new Set(input.days!)) {
            if (!input.remove && !validDays.has(day)) fail('That date is outside the trip. Refresh its dates.');
            if (input.remove) await tx.delete(dayTags).where(and(eq(dayTags.profileId, profileId), eq(dayTags.planId, plan.id), eq(dayTags.day, day), eq(dayTags.tagId, tagId)));
            else await tx.insert(dayTags).values({ profileId, planId: plan.id, day, tagId }).onConflictDoNothing();
          }
        } else if (input.action === 'GENERATE') {
          if (input.expectedLibraryRevision !== library.revision || input.startDate !== trip.startDate || input.endDate !== trip.endDate) conflict();
          const suggestions = calculate(library, trip.startDate, trip.endDate, current.assignments);
          const next = reconcile(current.entries, suggestions);
          for (const old of current.entries) if (!next.some(e => e.itemId === old.itemId)) await tx.delete(entries).where(entryWhere(old.itemId));
          for (const entry of next) {
            if (current.entries.some(e => e.itemId === entry.itemId)) await tx.update(entries).set(entry).where(entryWhere(entry.itemId));
            else await tx.insert(entries).values({ ...entry, profileId, planId: plan.id });
          }
          await tx.update(plans).set({ fingerprint: fingerprint(library, trip.startDate, trip.endDate, current.assignments), generatedAt: new Date().toISOString() }).where(eq(plans.id, plan.id));
        } else {
          const itemId = idInput.parse(input.itemId);
          const old = current.entries.find(e => e.itemId === itemId);
          if (input.action === 'ADD_ENTRY') {
            const item = library.items.find(i => i.id === itemId && !i.archived);
            const category = library.categories.find(c => c.id === item?.categoryId && !c.archived);
            if (!item || !category) fail('Choose an active item from your library.');
            if (old) fail('This item is already on the list.');
            await tx.insert(entries).values({ profileId, planId: plan.id, itemId, name: item!.name, category: category!.name, mode: item!.mode,
              suggested: 0, override: 1, manual: true, explanation: { rule: 'Added by you', dates: [], tags: [], baseline: false } });
          } else {
            if (!old) throw new AppError('Packing entry not found.', 'NOT_FOUND');
            if (input.action === 'REMOVE_ENTRY') {
              if (!old.manual && !old.needsReview) fail('Exclude a suggested item so recalculation remembers your choice.');
              await tx.delete(entries).where(entryWhere(itemId));
            } else {
              const next = { ...old, override: input.resetOverride ? null : input.override ?? old.override, excluded: input.excluded ?? old.excluded };
              if (next.mode === 'CHECKBOX' && (next.override ?? 0) > 1) fail('Checkbox items can only have a quantity of zero or one.');
              const effective = target(next);
              if (input.packed !== null && input.packed !== undefined && input.packed > effective) fail('Packed quantity cannot exceed the target.');
              await tx.update(entries).set({ override: next.override, excluded: next.excluded, packed: Math.min(input.packed ?? old.packed, effective) }).where(entryWhere(itemId));
            }
          }
        }
        await tx.update(plans).set({ revision: plan.revision + 1 }).where(eq(plans.id, plan.id));
        return (await readPlan(tx, profileId, tripId))!;
      })),
    },
  };
}

import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { trips } from './schema.js';

const owned = () => ({
  id: uuid('id').defaultRandom().primaryKey(),
  profileId: uuid('profile_id').notNull().references(() => packingProfiles.id, { onDelete: 'cascade' }),
});
export const packingProfiles = pgTable('packing_profiles', {
  id: uuid('id').primaryKey(),
  revision: integer('revision').default(0).notNull(),
  catalogVersion: integer('catalog_version').default(1).notNull(),
});
export const packingCategories = pgTable('packing_categories', {
  ...owned(), name: text('name').notNull(), normalizedName: text('normalized_name').notNull(),
  archived: boolean('archived').default(false).notNull(),
}, t => [
  unique().on(t.id, t.profileId), unique().on(t.profileId, t.normalizedName),
  check('packing_category_name', sql`length(trim(${t.name})) between 1 and 80`),
]);
export const packingItems = pgTable('packing_items', {
  ...owned(), categoryId: uuid('category_id').notNull(), name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(), mode: text('mode').notNull().default('CHECKBOX'),
  baseline: boolean('baseline').default(false).notNull(),
  quantity: integer('quantity').default(1).notNull(), interval: integer('interval').default(1).notNull(),
  basis: text('basis').default('DAYS').notNull(), archived: boolean('archived').default(false).notNull(),
}, t => [
  unique().on(t.id, t.profileId), unique().on(t.profileId, t.categoryId, t.normalizedName),
  foreignKey({ columns: [t.categoryId, t.profileId], foreignColumns: [packingCategories.id, packingCategories.profileId] }),
  check('packing_item_rule', sql`${t.quantity} between 1 and 100 and ${t.interval} between 1 and 365 and ${t.mode} in ('CHECKBOX','QUANTITY') and ${t.basis} in ('DAYS','NIGHTS')`),
  check('packing_item_name', sql`length(trim(${t.name})) between 1 and 80`),
]);
export const packingTags = pgTable('packing_tags', {
  ...owned(), name: text('name').notNull(), normalizedName: text('normalized_name').notNull(),
  archived: boolean('archived').default(false).notNull(),
}, t => [unique().on(t.id, t.profileId), unique().on(t.profileId, t.normalizedName),
  check('packing_tag_name', sql`length(trim(${t.name})) between 1 and 80`)]);
export const packingTagItems = pgTable('packing_tag_items', {
  profileId: uuid('profile_id').notNull(), tagId: uuid('tag_id').notNull(), itemId: uuid('item_id').notNull(),
}, t => [
  unique().on(t.profileId, t.tagId, t.itemId),
  foreignKey({ columns: [t.tagId, t.profileId], foreignColumns: [packingTags.id, packingTags.profileId] }).onDelete('cascade'),
  foreignKey({ columns: [t.itemId, t.profileId], foreignColumns: [packingItems.id, packingItems.profileId] }).onDelete('cascade'),
]);
export const packingPlans = pgTable('packing_plans', {
  ...owned(), tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  revision: integer('revision').default(0).notNull(), fingerprint: text('fingerprint'),
  generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'string' }),
}, t => [unique().on(t.id, t.profileId), unique().on(t.profileId, t.tripId)]);
export const packingDayTags = pgTable('packing_day_tags', {
  profileId: uuid('profile_id').notNull(), planId: uuid('plan_id').notNull(), day: date('day', { mode: 'string' }).notNull(), tagId: uuid('tag_id').notNull(),
}, t => [
  unique().on(t.planId, t.day, t.tagId),
  foreignKey({ columns: [t.planId, t.profileId], foreignColumns: [packingPlans.id, packingPlans.profileId] }).onDelete('cascade'),
  foreignKey({ columns: [t.tagId, t.profileId], foreignColumns: [packingTags.id, packingTags.profileId] }).onDelete('cascade'),
]);
export const packingEntries = pgTable('packing_entries', {
  ...owned(), planId: uuid('plan_id').notNull(), itemId: uuid('item_id').notNull(),
  name: text('name').notNull(), category: text('category').notNull(), mode: text('mode').notNull(),
  suggested: integer('suggested').notNull(), override: integer('override'),
  packed: integer('packed').default(0).notNull(), excluded: boolean('excluded').default(false).notNull(),
  manual: boolean('manual').default(false).notNull(), needsReview: boolean('needs_review').default(false).notNull(),
  explanation: jsonb('explanation').$type<{ rule: string; dates: string[]; tags: string[]; baseline: boolean }>().notNull(),
}, t => [
  unique().on(t.planId, t.itemId),
  foreignKey({ columns: [t.planId, t.profileId], foreignColumns: [packingPlans.id, packingPlans.profileId] }).onDelete('cascade'),
  foreignKey({ columns: [t.itemId, t.profileId], foreignColumns: [packingItems.id, packingItems.profileId] }),
  check('packing_entry_counts', sql`${t.suggested} between 0 and 9999 and (${t.override} is null or ${t.override} between 0 and 9999) and ${t.packed} between 0 and 9999 and ${t.packed} <= coalesce(${t.override}, ${t.suggested})`),
  check('packing_entry_mode', sql`${t.mode} in ('CHECKBOX','QUANTITY') and (${t.mode} <> 'CHECKBOX' or (${t.suggested} <= 1 and coalesce(${t.override},0) <= 1 and ${t.packed} <= 1))`),
]);


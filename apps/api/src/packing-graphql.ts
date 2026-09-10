export const packingTypeDefs = /* GraphQL */ `
  extend type Query {
    packingLibrary: PackingLibrary
    packingPlan(tripId: ID!): PackingPlan
  }
  extend type Mutation {
    initializePacking: PackingLibrary!
    savePackingCategory(id: ID, expectedRevision: Int!, input: PackingCategoryInput!): PackingLibrary!
    savePackingItem(id: ID, expectedRevision: Int!, input: PackingItemInput!): PackingLibrary!
    savePackingTag(id: ID, expectedRevision: Int!, input: PackingTagInput!): PackingLibrary!
    openPackingPlan(tripId: ID!): PackingPlan!
    editPackingPlan(tripId: ID!, expectedRevision: Int!, input: PackingPlanEditInput!): PackingPlan!
  }
  type PackingCategory { id: ID! name: String! archived: Boolean! }
  type PackingItem {
    id: ID! categoryId: ID! name: String! mode: String! baseline: Boolean!
    quantity: Int! interval: Int! basis: String! archived: Boolean!
  }
  type PackingTag { id: ID! name: String! archived: Boolean! itemIds: [ID!]! }
  type PackingLibrary { revision: Int! categories: [PackingCategory!]! items: [PackingItem!]! tags: [PackingTag!]! }
  type PackingAssignment { day: String! tagId: ID! }
  type PackingExplanation { rule: String! dates: [String!]! tags: [String!]! baseline: Boolean! }
  type PackingEntry {
    id: ID! itemId: ID! name: String! category: String! mode: String! suggested: Int! override: Int
    target: Int! packed: Int! excluded: Boolean! manual: Boolean! needsReview: Boolean! explanation: PackingExplanation!
  }
  type PackingPlan {
    id: ID! tripId: ID! revision: Int! startDate: String! endDate: String!
    generatedAt: String stale: Boolean! assignments: [PackingAssignment!]! entries: [PackingEntry!]!
  }
  input PackingCategoryInput { name: String! archived: Boolean! }
  input PackingItemInput {
    categoryId: ID newCategoryName: String name: String! mode: String! baseline: Boolean!
    quantity: Int! interval: Int! basis: String! archived: Boolean!
  }
  input PackingTagInput { name: String! archived: Boolean! itemIds: [ID!]! }
  input PackingPlanEditInput {
    action: String! days: [String!] tagId: ID remove: Boolean itemId: ID
    override: Int resetOverride: Boolean packed: Int excluded: Boolean
    expectedLibraryRevision: Int startDate: String endDate: String
  }
`;

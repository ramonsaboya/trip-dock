export const typeDefs = /* GraphQL */ `
  type Query {
    trips: [Trip!]!
    trip(id: ID!): Trip
  }

  type Mutation {
    createTrip(input: CreateTripInput!): Trip!
    updateTrip(id: ID!, expectedRevision: Int!, input: UpdateTripInput!): Trip!
    deleteTrip(id: ID!, expectedRevision: Int!): Boolean!

    addTripStop(tripId: ID!, expectedRevision: Int!, input: TripStopInput!, moveTripEnd: Boolean = false): Trip!
    updateTripStop(id: ID!, expectedRevision: Int!, input: TripStopInput!): Trip!
    removeTripStop(id: ID!, expectedRevision: Int!): Trip!
    reorderTripStops(tripId: ID!, expectedRevision: Int!, stopIds: [ID!]!): Trip!
      @deprecated(reason: "Destinations are ordered automatically by date.")

    addTransportLeg(tripId: ID!, expectedRevision: Int!, input: TransportLegInput!): Trip!
    updateTransportLeg(id: ID!, expectedRevision: Int!, input: TransportLegInput!): Trip!
    removeTransportLeg(id: ID!, expectedRevision: Int!): Trip!

    addStay(tripId: ID!, expectedRevision: Int!, input: StayInput!): Trip!
    updateStay(id: ID!, expectedRevision: Int!, input: StayInput!): Trip!
    removeStay(id: ID!, expectedRevision: Int!): Trip!

    addActivity(tripId: ID!, expectedRevision: Int!, input: ActivityInput!): Trip!
    updateActivity(id: ID!, expectedRevision: Int!, input: ActivityInput!): Trip!
    removeActivity(id: ID!, expectedRevision: Int!): Trip!

    generateTripDraft(input: GenerateTripDraftInput!): TripDraft!
  }

  type Trip {
    id: ID!
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int
    revision: Int!
    createdAt: String!
    updatedAt: String!
    stops: [TripStop!]!
    transportLegs: [TransportLeg!]!
    stays: [Stay!]!
    activities: [Activity!]!
  }

  type TripStop {
    id: ID!
    tripId: ID!
    name: String!
    locationText: String
    position: Int!
    arrivalDate: String
    departureDate: String
    createdAt: String!
    updatedAt: String!
  }

  type TransportLeg {
    id: ID!
    tripId: ID!
    fromStopId: ID
    toStopId: ID
    fromLocation: String
    toLocation: String
    position: Int!
    mode: String!
    title: String!
    details: String
    departureTime: String
    arrivalTime: String
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type Stay {
    id: ID!
    tripId: ID!
    stopId: ID!
    position: Int!
    name: String!
    checkIn: String
    checkOut: String
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type Activity {
    id: ID!
    tripId: ID!
    stopId: ID!
    position: Int!
    title: String!
    status: String!
    scheduledAt: String
    durationMinutes: Int
    timezone: String
    createdAt: String!
    updatedAt: String!
  }

  type TripDraft {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int
    stops: [TripDraftStop!]!
    assumptions: [String!]!
    warnings: [String!]!
    fieldStates: [TripDraftFieldState!]!
    questions: [TripClarificationQuestion!]!
    minimumViable: Boolean!
    referenceDate: String!
    locale: String!
    timeZone: String!
  }

  type TripDraftStop {
    draftId: ID!
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
    localityKind: String!
    cityResolution: String!
  }

  type TripDraftFieldState {
    path: String!
    status: String!
    evidence: String
    message: String
    blocking: Boolean!
  }

  type TripClarificationQuestion {
    id: ID!
    fieldPaths: [String!]!
    prompt: String!
    options: [TripClarificationOption!]!
    allowFreeText: Boolean!
    blocking: Boolean!
  }

  type TripClarificationOption {
    id: ID!
    label: String!
    updates: [TripClarificationUpdate!]!
  }

  type TripClarificationUpdate {
    path: String!
    value: String
  }

  input GenerateTripDraftInput {
    prompt: String!
    locale: String!
    timeZone: String!
    referenceDate: String!
  }

  input CreateTripInput {
    name: String!
    destinationArea: String!
    startDate: String
    endDate: String
    travelerCount: Int
    stops: [TripStopDraftInput!]!
  }

  input UpdateTripInput {
    name: String!
    destinationArea: String!
    startDate: String!
    endDate: String!
    travelerCount: Int
  }

  input TripStopDraftInput {
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
  }

  input TripStopInput {
    name: String!
    locationText: String
    arrivalDate: String
    departureDate: String
  }

  input TransportLegInput {
    fromStopId: ID
    toStopId: ID
    fromLocation: String
    toLocation: String
    mode: String!
    title: String!
    details: String
    departureTime: String
    arrivalTime: String
    timezone: String
  }

  input StayInput {
    stopId: ID!
    name: String!
    checkIn: String
    checkOut: String
    timezone: String
  }

  input ActivityInput {
    stopId: ID!
    title: String!
    status: String!
    scheduledAt: String
    durationMinutes: Int
    timezone: String
  }
`;

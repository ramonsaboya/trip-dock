
export const TRIP_FIELDS = `
  id name destinationArea startDate endDate travelerCount revision createdAt updatedAt
  stops { id tripId name locationText position arrivalDate departureDate }
  transportLegs {
    id tripId fromStopId toStopId fromLocation toLocation position mode title details
    departureTime arrivalTime timezone
  }
  stays { id tripId stopId position name checkIn checkOut timezone }
  activities { id tripId stopId position title status scheduledAt durationMinutes timezone }
`;

export const operations = {
  trips: `query Trips { trips { ${TRIP_FIELDS} } }`,
  trip: `query Trip($id: ID!) { trip(id: $id) { ${TRIP_FIELDS} } }`,
  createTrip: `mutation CreateTrip($input: CreateTripInput!) { createTrip(input: $input) { ${TRIP_FIELDS} } }`,
  updateTrip: `mutation UpdateTrip($id: ID!, $expectedRevision: Int!, $input: UpdateTripInput!) {
    updateTrip(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  deleteTrip: `mutation DeleteTrip($id: ID!, $expectedRevision: Int!) {
    deleteTrip(id: $id, expectedRevision: $expectedRevision)
  }`,
  addStop: `mutation AddStop($tripId: ID!, $expectedRevision: Int!, $input: TripStopInput!, $moveTripEnd: Boolean) {
    addTripStop(tripId: $tripId, expectedRevision: $expectedRevision, input: $input, moveTripEnd: $moveTripEnd) { ${TRIP_FIELDS} }
  }`,
  updateStop: `mutation UpdateStop($id: ID!, $expectedRevision: Int!, $input: TripStopInput!) {
    updateTripStop(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeStop: `mutation RemoveStop($id: ID!, $expectedRevision: Int!) {
    removeTripStop(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  reorderStops: `mutation ReorderStops($tripId: ID!, $expectedRevision: Int!, $stopIds: [ID!]!) {
    reorderTripStops(tripId: $tripId, expectedRevision: $expectedRevision, stopIds: $stopIds) { ${TRIP_FIELDS} }
  }`,
  addTransport: `mutation AddTransport($tripId: ID!, $expectedRevision: Int!, $input: TransportLegInput!) {
    addTransportLeg(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateTransport: `mutation UpdateTransport($id: ID!, $expectedRevision: Int!, $input: TransportLegInput!) {
    updateTransportLeg(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeTransport: `mutation RemoveTransport($id: ID!, $expectedRevision: Int!) {
    removeTransportLeg(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  addStay: `mutation AddStay($tripId: ID!, $expectedRevision: Int!, $input: StayInput!) {
    addStay(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateStay: `mutation UpdateStay($id: ID!, $expectedRevision: Int!, $input: StayInput!) {
    updateStay(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeStay: `mutation RemoveStay($id: ID!, $expectedRevision: Int!) {
    removeStay(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  addActivity: `mutation AddActivity($tripId: ID!, $expectedRevision: Int!, $input: ActivityInput!) {
    addActivity(tripId: $tripId, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  updateActivity: `mutation UpdateActivity($id: ID!, $expectedRevision: Int!, $input: ActivityInput!) {
    updateActivity(id: $id, expectedRevision: $expectedRevision, input: $input) { ${TRIP_FIELDS} }
  }`,
  removeActivity: `mutation RemoveActivity($id: ID!, $expectedRevision: Int!) {
    removeActivity(id: $id, expectedRevision: $expectedRevision) { ${TRIP_FIELDS} }
  }`,
  generateDraft: `mutation GenerateDraft($input: GenerateTripDraftInput!) {
    generateTripDraft(input: $input) {
      name destinationArea startDate endDate travelerCount assumptions warnings
      minimumViable referenceDate locale timeZone
      stops { draftId name locationText arrivalDate departureDate localityKind cityResolution }
      fieldStates { path status evidence message blocking }
      questions {
        id fieldPaths prompt allowFreeText blocking
        options { id label updates { path value } }
      }
    }
  }`,
} as const;

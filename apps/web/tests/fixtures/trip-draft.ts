import type { TripDraft } from '../../lib/trips/types.ts';

export function exampleDraft(overrides: Partial<TripDraft> = {}): TripDraft {
  return {
    name: 'Trip to Porto', destinationArea: 'Porto', startDate: '2028-04-02', endDate: '2028-04-06', travelerCount: null,
    stops: [{ draftId: 'porto', name: 'Porto', locationText: 'Portugal', arrivalDate: '2028-04-02', departureDate: '2028-04-06', localityKind: 'CITY', cityResolution: 'RESOLVED' }],
    fieldStates: [], questions: [], assumptions: [], warnings: [], minimumViable: true,
    referenceDate: '2028-04-01', locale: 'en-GB', timeZone: 'Europe/London', ...overrides,
  };
}

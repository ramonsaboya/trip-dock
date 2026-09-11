import { type TripDraftStop, type TripInput } from '../../lib/trips/types.ts';

export const blankStop = (): TripDraftStop => ({
  name: '',
  locationText: null,
  arrivalDate: null,
  departureDate: null,
  localityKind: 'UNKNOWN',
  cityResolution: 'UNRESOLVED',
});

export const blankTrip = (): TripInput => ({
  name: '',
  destinationArea: '',
  startDate: '',
  endDate: '',
  travelerCount: null,
  stops: [blankStop()],
});

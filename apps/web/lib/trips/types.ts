

export type TripStop = {
  id: string;
  tripId: string;
  name: string;
  locationText: string | null;
  position: number;
  arrivalDate: string | null;
  departureDate: string | null;
};

export type TransportLeg = {
  id: string;
  tripId: string;
  fromStopId: string | null;
  toStopId: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  position: number;
  mode: string;
  title: string;
  details: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  timezone: string | null;
};

export type Stay = {
  id: string;
  tripId: string;
  stopId: string;
  position: number;
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  timezone: string | null;
};

export type Activity = {
  id: string;
  tripId: string;
  stopId: string;
  position: number;
  title: string;
  status: 'IDEA' | 'PLANNED' | 'BOOKED' | 'DONE';
  scheduledAt: string | null;
  durationMinutes?: number;
  timezone: string | null;
};

export type Trip = {
  id: string;
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  stops: TripStop[];
  transportLegs: TransportLeg[];
  stays: Stay[];
  activities: Activity[];
};

export type TripDraftStop = {
  draftId?: string;
  name: string;
  locationText: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  localityKind?: 'CITY' | 'COUNTRY' | 'REGION' | 'PREFERENCE' | 'AMBIGUOUS' | 'UNKNOWN';
  cityResolution?: 'RESOLVED' | 'SUGGESTED' | 'AMBIGUOUS' | 'UNRESOLVED';
};

export type TripDraftFieldStatus =
  | 'EXPLICIT'
  | 'INTERPRETED'
  | 'SUGGESTED'
  | 'CONFIRMED'
  | 'MISSING'
  | 'NEEDS_ATTENTION'
  | 'INVALID'
  | 'CONFLICTING'
  | 'PAST';

export type TripDraftFieldState = {
  path: string;
  status: TripDraftFieldStatus;
  evidence: string | null;
  message: string | null;
  blocking: boolean;
};

export type TripClarificationUpdate = { path: string; value: string | null };

export type TripClarificationOption = {
  id: string;
  label: string;
  updates: TripClarificationUpdate[];
};

export type TripClarificationQuestion = {
  id: string;
  fieldPaths: string[];
  prompt: string;
  options: TripClarificationOption[];
  allowFreeText: boolean;
  blocking: boolean;
};

export type TripDraft = {
  name: string;
  destinationArea: string;
  startDate: string | null;
  endDate: string | null;
  travelerCount: number | null;
  stops: TripDraftStop[];
  assumptions: string[];
  warnings: string[];
  fieldStates: TripDraftFieldState[];
  questions: TripClarificationQuestion[];
  minimumViable: boolean;
  referenceDate: string;
  locale: string;
  timeZone: string;
};

export type GenerateTripDraftInput = {
  prompt: string;
  locale: string;
  timeZone: string;
  referenceDate: string;
};

export type TripInput = {
  name: string;
  destinationArea: string;
  startDate: string;
  endDate: string;
  travelerCount: number | null;
  stops: TripDraftStop[];
};

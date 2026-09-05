import type { TripCreationEvalScenario } from './trip-creation-eval.js';

export const TRIP_CREATION_EVAL_CORPUS_VERSION = '1.0.0';

const context = {
  locale: 'en-GB',
  timeZone: 'Europe/London',
  referenceDate: '2026-09-05',
} as const;

export const tripCreationEvalScenarios: TripCreationEvalScenario[] = [
  {
    id: 'dates.partial-endpoint-year',
    title: 'Carry an explicit year across a paired date range',
    suite: 'REGRESSION',
    rationale: 'A year written once for a continuous range applies to both endpoints.',
    context,
    variants: [
      {
        id: 'ordinal-long-form',
        prompt: '28th of August 2027 to 5th of September',
        tags: ['date-range', 'year-elision', 'ordinal'],
      },
    ],
    expected: {
      extraction: {
        destinationArea: null,
        startDate: { kind: 'CALENDAR_DATE', day: 28, month: 8, year: 2027 },
        endDate: { kind: 'CALENDAR_DATE', day: 5, month: 9, year: null },
        orderedCities: [],
      },
      draft: {
        startDate: '2027-08-28',
        endDate: '2027-09-05',
        orderedStops: [],
        minimumViable: false,
        blockingQuestionIds: ['city-required'],
        forbiddenQuestionIds: ['start-date-required', 'end-date-required'],
        fieldStatuses: {
          'trip.startDate': 'EXPLICIT',
          'trip.endDate': 'INTERPRETED',
        },
      },
    },
  },
  {
    id: 'destinations.country-vs-cities',
    title: 'Keep country context separate from city stops',
    suite: 'REGRESSION',
    rationale: 'Italy describes the trip area; Rome, Maiori, and Naples are the itinerary.',
    context,
    variants: [
      {
        id: 'sentence',
        prompt: 'Trip to Italy, 3 days in Rome, 4 days in Maiori, 2 days in Naples',
        tags: ['destination-hierarchy', 'days', 'comma-list'],
      },
    ],
    expected: {
      extraction: {
        destinationArea: 'Italy',
        startDate: { kind: 'MISSING', day: null, month: null, year: null },
        endDate: { kind: 'MISSING', day: null, month: null, year: null },
        orderedCities: [
          { name: 'Rome', localityKind: 'CITY', duration: { value: 3, unit: 'DAYS' } },
          { name: 'Maiori', localityKind: 'CITY', duration: { value: 4, unit: 'DAYS' } },
          { name: 'Naples', localityKind: 'CITY', duration: { value: 2, unit: 'DAYS' } },
        ],
        forbiddenCityNames: ['Italy'],
      },
      draft: {
        destinationArea: 'Italy',
        startDate: null,
        endDate: null,
        orderedStops: ['Rome', 'Maiori', 'Naples'],
        forbiddenStops: ['Italy'],
        stopIntervals: [
          { name: 'Rome', arrivalDate: null, departureDate: null },
          { name: 'Maiori', arrivalDate: null, departureDate: null },
          { name: 'Naples', arrivalDate: null, departureDate: null },
        ],
        minimumViable: false,
        blockingQuestionIds: ['start-date-required', 'end-date-required'],
        forbiddenQuestionIds: ['city-required'],
      },
    },
  },
  {
    id: 'itinerary.fixed-bounds-exact-nights',
    title: 'Allocate exact nights inside fixed trip bounds',
    suite: 'REGRESSION',
    rationale: 'Exact per-stop nights must produce contiguous intervals that fill the stated range.',
    context,
    variants: [
      {
        id: 'ordinal-long-form',
        prompt: 'Trip from 28th of August 2027 to 5th of September 2027, 4 nights in Rome, 2 nights in Maiori, 2 nights in Naples',
        tags: ['multi-stop', 'exact-nights', 'fixed-bounds', 'ordinal'],
      },
    ],
    expected: {
      extraction: {
        destinationArea: null,
        startDate: { kind: 'CALENDAR_DATE', day: 28, month: 8, year: 2027 },
        endDate: { kind: 'CALENDAR_DATE', day: 5, month: 9, year: 2027 },
        orderedCities: [
          { name: 'Rome', localityKind: 'CITY', duration: { value: 4, unit: 'NIGHTS' } },
          { name: 'Maiori', localityKind: 'CITY', duration: { value: 2, unit: 'NIGHTS' } },
          { name: 'Naples', localityKind: 'CITY', duration: { value: 2, unit: 'NIGHTS' } },
        ],
      },
      draft: {
        startDate: '2027-08-28',
        endDate: '2027-09-05',
        orderedStops: ['Rome', 'Maiori', 'Naples'],
        stopIntervals: [
          { name: 'Rome', arrivalDate: '2027-08-28', departureDate: '2027-09-01' },
          { name: 'Maiori', arrivalDate: '2027-09-01', departureDate: '2027-09-03' },
          { name: 'Naples', arrivalDate: '2027-09-03', departureDate: '2027-09-05' },
        ],
        minimumViable: true,
        blockingQuestionIds: [],
        forbiddenQuestionIds: ['city-required', 'start-date-required', 'end-date-required'],
        fieldStatuses: {
          'stops.0.arrivalDate': 'INTERPRETED',
          'stops.0.departureDate': 'INTERPRETED',
          'stops.1.arrivalDate': 'INTERPRETED',
          'stops.1.departureDate': 'INTERPRETED',
          'stops.2.arrivalDate': 'INTERPRETED',
          'stops.2.departureDate': 'INTERPRETED',
        },
      },
    },
  },
  {
    id: 'itinerary.derive-end-from-stop-nights',
    title: 'Derive the trip end from a start date and exact stop nights',
    suite: 'REGRESSION',
    rationale: 'Exact per-stop nights and a fixed start determine the trip end and every stop interval.',
    context,
    variants: [
      {
        id: 'ordinal-long-form',
        prompt: 'Trip from 28th of August 2027, 4 nights in Rome, 2 nights in Maiori, 2 nights in Naples',
        tags: ['multi-stop', 'exact-nights', 'derived-end', 'ordinal'],
      },
    ],
    expected: {
      extraction: {
        destinationArea: null,
        startDate: { kind: 'CALENDAR_DATE', day: 28, month: 8, year: 2027 },
        endDate: { kind: 'MISSING', day: null, month: null, year: null },
        orderedCities: [
          { name: 'Rome', localityKind: 'CITY', duration: { value: 4, unit: 'NIGHTS' } },
          { name: 'Maiori', localityKind: 'CITY', duration: { value: 2, unit: 'NIGHTS' } },
          { name: 'Naples', localityKind: 'CITY', duration: { value: 2, unit: 'NIGHTS' } },
        ],
      },
      draft: {
        startDate: '2027-08-28',
        endDate: '2027-09-05',
        orderedStops: ['Rome', 'Maiori', 'Naples'],
        stopIntervals: [
          { name: 'Rome', arrivalDate: '2027-08-28', departureDate: '2027-09-01' },
          { name: 'Maiori', arrivalDate: '2027-09-01', departureDate: '2027-09-03' },
          { name: 'Naples', arrivalDate: '2027-09-03', departureDate: '2027-09-05' },
        ],
        minimumViable: true,
        blockingQuestionIds: [],
        forbiddenQuestionIds: ['city-required', 'start-date-required', 'end-date-required'],
        fieldStatuses: {
          'trip.endDate': 'INTERPRETED',
          'stops.0.arrivalDate': 'INTERPRETED',
          'stops.0.departureDate': 'INTERPRETED',
          'stops.1.arrivalDate': 'INTERPRETED',
          'stops.1.departureDate': 'INTERPRETED',
          'stops.2.arrivalDate': 'INTERPRETED',
          'stops.2.departureDate': 'INTERPRETED',
        },
      },
    },
  },
];

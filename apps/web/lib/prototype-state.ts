export type StatusTone = 'attention' | 'ready' | 'draft';

export type ProposalStatus = 'idle' | 'loading' | 'ready' | 'kept' | 'applied';

export type ProposalChangeId = 'move-vatican' | 'schedule-borghese';

export type Trip = {
  id: string;
  eyebrow: string;
  title: string;
  dates: string;
  duration: string;
  travelers: string;
  route: string[];
  status: string;
  statusTone: StatusTone;
  note: string;
  next: string;
  image: string;
  alt: string;
  preview: string[];
  featured?: boolean;
  createdLocally?: boolean;
};

export type TripDraft = {
  name: string;
  area: string;
  start: string;
  end: string;
  travelers: string;
  stops: string[];
};

export type PrototypeState = {
  schemaVersion: 1;
  trips: Trip[];
  assignedRomeActivities: string[];
  acceptedRomeChanges: ProposalChangeId[];
  proposal: {
    status: ProposalStatus;
    prompt: string;
    changes: ProposalChangeId[];
  };
};

export const PROTOTYPE_STORAGE_KEY = 'tripdock.prototype.v1';

export const DEFAULT_PROPOSAL_PROMPT =
  'Move the Vatican Museums to Wednesday morning and add Borghese Gallery on Tuesday afternoon.';

const KNOWN_ACTIVITY_IDS = new Set(['borghese', 'catacombs', 'campo', 'appian']);
const PROPOSAL_CHANGE_IDS = new Set<ProposalChangeId>(['move-vatican', 'schedule-borghese']);
const PROPOSAL_STATUSES = new Set<ProposalStatus>([
  'idle',
  'loading',
  'ready',
  'kept',
  'applied',
]);

const seedTrips: Trip[] = [
  {
    id: 'italy-spring-2027',
    eyebrow: 'Next up',
    title: 'Italy in spring',
    dates: 'Apr 11–20, 2027',
    duration: '9 nights',
    travelers: '2 travelers',
    route: ['Rome', 'Florence', 'Venice'],
    status: 'Planning',
    statusTone: 'attention',
    note: '2 things to arrange',
    next: 'Next: Flight to Rome · Sun, 09:20',
    image:
      'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=1400&q=82',
    alt: 'The Colosseum in Rome in warm evening light',
    preview: [
      'Flight · Barcelona to Rome',
      '4 nights · Rome',
      'Train · Rome to Florence',
      '3 nights · Florence',
      'Train · Florence to Venice',
      '2 nights · Venice',
    ],
    featured: true,
  },
  {
    id: 'porto-weekend-2027',
    eyebrow: 'May 7–10',
    title: 'Porto long weekend',
    dates: 'May 7–10, 2027',
    duration: '3 nights',
    travelers: '2 travelers',
    route: ['Porto'],
    status: 'Ready',
    statusTone: 'ready',
    note: 'Everything arranged',
    next: 'Stay: Torel Avantgarde · Fri, 15:00',
    image:
      'https://images.unsplash.com/photo-1653837403076-be7194e55776?auto=format&fit=crop&w=1200&q=82',
    alt: 'Colorful buildings along the Douro river in Porto',
    preview: [
      'Flight · Barcelona to Porto',
      '3 nights · Porto',
      'Flight · Porto to Barcelona',
    ],
  },
  {
    id: 'japan-autumn-2027',
    eyebrow: 'Oct 2–15',
    title: 'Japan in autumn',
    dates: 'Oct 2–15, 2027',
    duration: '13 nights',
    travelers: '3 travelers',
    route: ['Tokyo', 'Kyoto', 'Osaka'],
    status: 'Draft',
    statusTone: 'draft',
    note: 'Dates saved, details to come',
    next: 'Start with accommodation in Tokyo',
    image:
      'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82',
    alt: 'A quiet traditional street in Kyoto during autumn',
    preview: [
      'Flight · Barcelona to Tokyo',
      '5 nights · Tokyo',
      '4 nights · Kyoto',
      '4 nights · Osaka',
    ],
  },
];

function cloneTrip(trip: Trip): Trip {
  return { ...trip, route: [...trip.route], preview: [...trip.preview] };
}

export function createInitialPrototypeState(): PrototypeState {
  return {
    schemaVersion: 1,
    trips: seedTrips.map(cloneTrip),
    assignedRomeActivities: [],
    acceptedRomeChanges: [],
    proposal: {
      status: 'idle',
      prompt: DEFAULT_PROPOSAL_PROMPT,
      changes: [],
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isTrip(value: unknown): value is Trip {
  if (!value || typeof value !== 'object') return false;
  const trip = value as Partial<Trip>;
  return (
    typeof trip.id === 'string' &&
    typeof trip.eyebrow === 'string' &&
    typeof trip.title === 'string' &&
    typeof trip.dates === 'string' &&
    typeof trip.duration === 'string' &&
    typeof trip.travelers === 'string' &&
    isStringArray(trip.route) &&
    trip.route.length > 0 &&
    typeof trip.status === 'string' &&
    (trip.statusTone === 'attention' || trip.statusTone === 'ready' || trip.statusTone === 'draft') &&
    typeof trip.note === 'string' &&
    typeof trip.next === 'string' &&
    typeof trip.image === 'string' &&
    typeof trip.alt === 'string' &&
    isStringArray(trip.preview)
  );
}

export function restorePrototypeState(serialized: string | null): PrototypeState {
  const fallback = createInitialPrototypeState();
  if (!serialized) return fallback;

  try {
    const parsed = JSON.parse(serialized) as Partial<PrototypeState>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.trips)) return fallback;

    const trips = parsed.trips.filter(isTrip).map(cloneTrip);
    if (!trips.length || !trips.some((trip) => trip.id === 'italy-spring-2027')) return fallback;

    const assignedRomeActivities = isStringArray(parsed.assignedRomeActivities)
      ? [...new Set(parsed.assignedRomeActivities.filter((id) => KNOWN_ACTIVITY_IDS.has(id)))]
      : [];
    const acceptedRomeChanges = Array.isArray(parsed.acceptedRomeChanges)
      ? [...new Set(parsed.acceptedRomeChanges.filter(
          (change): change is ProposalChangeId => PROPOSAL_CHANGE_IDS.has(change as ProposalChangeId),
        ))]
      : [];
    const proposal = parsed.proposal;
    const restoredStatus =
      proposal && PROPOSAL_STATUSES.has(proposal.status) && proposal.status !== 'loading'
        ? proposal.status
        : 'idle';
    const prompt = proposal && typeof proposal.prompt === 'string'
      ? proposal.prompt
      : DEFAULT_PROPOSAL_PROMPT;
    const changes = proposal && Array.isArray(proposal.changes)
      ? [...new Set(proposal.changes.filter(
          (change): change is ProposalChangeId =>
            PROPOSAL_CHANGE_IDS.has(change as ProposalChangeId) &&
            !acceptedRomeChanges.includes(change as ProposalChangeId),
        ))]
      : [];
    const restoredChanges = proposal?.status === 'loading' ? [] : changes;

    return {
      schemaVersion: 1,
      trips,
      assignedRomeActivities,
      acceptedRomeChanges,
      proposal: {
        status: restoredStatus !== 'applied' && !restoredChanges.length
          ? 'idle'
          : restoredStatus,
        prompt,
        changes: restoredChanges,
      },
    };
  } catch {
    return fallback;
  }
}

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Enter valid start and end dates.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error('Enter valid start and end dates.');
  }
  return date;
}

function formatDateRange(start: Date, end: Date): string {
  const month = (date: Date) => date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const startMonth = month(start);
  const endMonth = month(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (startYear === endYear && startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${startDay}–${endMonth} ${endDay}, ${startYear}`;
  }
  return `${startMonth} ${startDay}, ${startYear}–${endMonth} ${endDay}, ${endYear}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42) || 'trip';
}

function buildPreview(stops: string[]): string[] {
  return stops.flatMap((stop, index) => {
    const next = stops[index + 1];
    return next
      ? [`${stop} · details to plan`, `Transport · ${stop} to ${next}`]
      : [`${stop} · details to plan`];
  });
}

export function createTripFromDraft(draft: TripDraft, now = Date.now()): Trip {
  const title = draft.name.trim();
  const area = draft.area.trim();
  const stops = [...new Set(draft.stops.map((stop) => stop.trim()).filter(Boolean))];
  const travelers = Number.parseInt(draft.travelers, 10);
  if (!title || !area) throw new Error('Add a trip name and destination area.');
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 20) {
    throw new Error('Travelers must be between 1 and 20.');
  }
  if (!stops.length) throw new Error('Add at least one destination.');

  const start = parseDate(draft.start);
  const end = parseDate(draft.end);
  if (end.getTime() < start.getTime()) throw new Error('The end date must be after the start date.');
  const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));

  return {
    id: `${slugify(title)}-${now.toString(36)}`,
    eyebrow: 'New draft',
    title,
    dates: formatDateRange(start, end),
    duration: `${nights} ${nights === 1 ? 'night' : 'nights'}`,
    travelers: `${travelers} ${travelers === 1 ? 'traveler' : 'travelers'}`,
    route: stops,
    status: 'Draft',
    statusTone: 'draft',
    note: `${stops.length} ${stops.length === 1 ? 'destination' : 'destinations'} saved`,
    next: `Next: Add transport to ${stops[0]}`,
    image: '/brand/tripdock-logo-colosseum.png',
    alt: `TripDock illustration for ${area}`,
    preview: buildPreview(stops),
    createdLocally: true,
  };
}

export function proposalChangesFromPrompt(prompt: string): ProposalChangeId[] {
  const normalized = prompt.toLocaleLowerCase();
  return [
    ...(normalized.includes('vatican') ? ['move-vatican' as const] : []),
    ...(normalized.includes('borghese') ? ['schedule-borghese' as const] : []),
  ];
}

export function applyProposalChanges(
  state: PrototypeState,
  includedChanges: ProposalChangeId[],
): PrototypeState {
  const selectedChanges = includedChanges.filter(
    (change) =>
      PROPOSAL_CHANGE_IDS.has(change) &&
      state.proposal.changes.includes(change) &&
      !state.acceptedRomeChanges.includes(change),
  );
  if (!selectedChanges.length) return state;
  const acceptedRomeChanges = [...new Set([
    ...state.acceptedRomeChanges,
    ...selectedChanges,
  ])];

  return {
    ...state,
    acceptedRomeChanges,
    assignedRomeActivities: state.assignedRomeActivities.filter(
      (id) => !(id === 'borghese' && selectedChanges.includes('schedule-borghese')),
    ),
    proposal: {
      ...state.proposal,
      status: 'applied',
      changes: [],
    },
  };
}

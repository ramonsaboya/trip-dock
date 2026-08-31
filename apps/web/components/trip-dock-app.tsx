'use client';

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

type StatusTone = 'attention' | 'ready' | 'draft';
type ProposalStatus = 'idle' | 'loading' | 'ready' | 'kept' | 'applied';

type Trip = {
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
  featured?: boolean;
};

const trips: Trip[] = [
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
  },
];

const previewRoutes: Record<string, string[]> = {
  'italy-spring-2027': [
    'Flight · Barcelona to Rome',
    '4 nights · Rome',
    'Train · Rome to Florence',
    '3 nights · Florence',
    'Train · Florence to Venice',
    '2 nights · Venice',
  ],
  'porto-weekend-2027': [
    'Flight · Barcelona to Porto',
    '3 nights · Porto',
    'Flight · Porto to Barcelona',
  ],
  'japan-autumn-2027': [
    'Flight · Barcelona to Tokyo',
    '5 nights · Tokyo',
    '4 nights · Kyoto',
    '4 nights · Osaka',
  ],
};

const romeActivityPool = [
  { id: 'borghese', title: 'Borghese Gallery', duration: '2 hr' },
  { id: 'catacombs', title: 'Catacombs of San Callisto', duration: '2.5 hr' },
  { id: 'campo', title: 'Campo de’ Fiori', duration: '1 hr' },
  { id: 'appian', title: 'Appian Way bike ride', duration: '3 hr' },
];

function Wordmark({ onHome }: { onHome: () => void }) {
  return (
    <button className="wordmark wordmark-button" type="button" onClick={onHome}>
      <span className="wordmark-mark" aria-hidden="true" />
      <span>TripDock</span>
    </button>
  );
}

function AppHeader({ detail, onHome }: { detail: boolean; onHome: () => void }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Wordmark onHome={onHome} />
        <nav aria-label="Primary navigation">
          <button
            className={`nav-link nav-button ${detail ? '' : 'nav-link-active'}`}
            type="button"
            onClick={onHome}
            aria-current={detail ? undefined : 'page'}
          >
            Trips
          </button>
        </nav>
        <button className="profile-button" type="button" aria-label="Open account menu">
          <span>RS</span>
        </button>
      </div>
    </header>
  );
}

function RouteLine({ stops }: { stops: string[] }) {
  return (
    <div className="route-line" aria-label={`Route: ${stops.join(' to ')}`}>
      {stops.map((stop, index) => (
        <span className="route-stop" key={stop}>
          <span className="route-dot" aria-hidden="true" />
          <span>{stop}</span>
          {index < stops.length - 1 ? (
            <span className="route-connector" aria-hidden="true" />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function TripCard({
  trip,
  expanded,
  onPreview,
  onView,
}: {
  trip: Trip;
  expanded: boolean;
  onPreview: () => void;
  onView: () => void;
}) {
  const previewId = `preview-${trip.id}`;

  return (
    <article className={`trip-card ${trip.featured ? 'trip-card-featured' : ''}`}>
      <div className="trip-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={trip.image} alt={trip.alt} />
        {trip.featured ? <span className="cover-label">Next trip</span> : null}
      </div>

      <div className="trip-card-body">
        <div className="trip-card-topline">
          <p className="trip-eyebrow">{trip.eyebrow}</p>
          <span className={`status-pill status-${trip.statusTone}`}>
            <span aria-hidden="true" />
            {trip.status}
          </span>
        </div>

        <div>
          <h2>{trip.title}</h2>
          <p className="trip-meta">
            {trip.dates} <span aria-hidden="true">·</span> {trip.duration}{' '}
            <span aria-hidden="true">·</span> {trip.travelers}
          </p>
        </div>

        <RouteLine stops={trip.route} />

        <div className="trip-health">
          <div>
            <span className={`health-icon health-${trip.statusTone}`} aria-hidden="true">
              {trip.statusTone === 'ready' ? '✓' : trip.statusTone === 'attention' ? '!' : '·'}
            </span>
            <span>{trip.note}</span>
          </div>
          <p>{trip.next}</p>
        </div>

        {expanded ? (
          <div className="trip-preview" id={previewId}>
            <p>Route preview</p>
            <ol>
              {previewRoutes[trip.id].map((item) => (
                <li key={item}>
                  <span aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="trip-actions">
          <button
            className="button-secondary"
            type="button"
            aria-expanded={expanded}
            aria-controls={previewId}
            onClick={onPreview}
          >
            {expanded ? 'Hide preview' : 'Preview route'}
          </button>
          <button className="button-text" type="button" onClick={onView}>
            View trip <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function TripsOverview({
  onNewTrip,
  onOpenTrip,
  showToast,
}: {
  onNewTrip: () => void;
  onOpenTrip: () => void;
  showToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [previewTrip, setPreviewTrip] = useState<string | null>(null);

  return (
    <main id="main-content" className="page-wrap">
      <section className="page-heading" aria-labelledby="trips-heading">
        <div>
          <p className="overline">Your travel plans</p>
          <h1 id="trips-heading">Your trips</h1>
          <p className="page-intro">Everything you need, in the order you’ll need it.</p>
        </div>
        <button className="button-primary" type="button" onClick={onNewTrip}>
          <span aria-hidden="true">＋</span> New trip
        </button>
      </section>

      <div className="trip-tabs" role="tablist" aria-label="Trip timing">
        <button
          className={`trip-tab ${tab === 'upcoming' ? 'trip-tab-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={tab === 'upcoming'}
          onClick={() => setTab('upcoming')}
        >
          Upcoming <span>3</span>
        </button>
        <button
          className={`trip-tab ${tab === 'past' ? 'trip-tab-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={tab === 'past'}
          onClick={() => setTab('past')}
        >
          Past
        </button>
      </div>

      {tab === 'upcoming' ? (
        <section id="trips" className="trips-list" aria-label="Upcoming trips">
          {trips.map((trip) => (
            <TripCard
              trip={trip}
              key={trip.id}
              expanded={previewTrip === trip.id}
              onPreview={() => setPreviewTrip(previewTrip === trip.id ? null : trip.id)}
              onView={
                trip.id === 'italy-spring-2027'
                  ? onOpenTrip
                  : () => showToast('The detailed mock is populated for Italy in spring.')
              }
            />
          ))}
        </section>
      ) : (
        <section className="past-empty" aria-labelledby="past-heading">
          <span aria-hidden="true">↺</span>
          <h2 id="past-heading">Your past trips will live here</h2>
          <p>Completed journeys stay easy to revisit without crowding the plans ahead.</p>
        </section>
      )}

      <button className="new-trip-row" type="button" onClick={onNewTrip}>
        <span className="new-trip-icon" aria-hidden="true">＋</span>
        <span>
          <strong>Start planning another trip</strong>
          <small>Add a destination and dates to begin</small>
        </span>
        <span className="new-trip-arrow" aria-hidden="true">→</span>
      </button>
    </main>
  );
}

type TransportLegProps = {
  icon: string;
  eyebrow: string;
  route: string;
  time: string;
  detail: string;
  status: 'Confirmed' | 'Booked' | 'Needs booking';
  attention?: boolean;
  onDetails: () => void;
};

function TransportLeg({
  icon,
  eyebrow,
  route,
  time,
  detail,
  status,
  attention,
  onDetails,
}: TransportLegProps) {
  return (
    <article className={`transport-card ${attention ? 'transport-card-attention' : ''}`}>
      <div className="transport-icon" aria-hidden="true">{icon}</div>
      <div className="transport-copy">
        <p className="transport-eyebrow">{eyebrow}</p>
        <h3>{route}</h3>
        <p>{time} <span aria-hidden="true">·</span> {detail}</p>
      </div>
      <div className="transport-side">
        <span className={attention ? 'leg-status attention' : 'leg-status'}>
          {attention ? '!' : '✓'} {status}
        </span>
        <button type="button" onClick={onDetails}>Details</button>
      </div>
    </article>
  );
}

type AgendaEvent = {
  time: string;
  title: string;
  meta?: string;
  confirmed?: boolean;
};

function AgendaDay({
  day,
  label,
  events,
  emptyAction,
}: {
  day: string;
  label: string;
  events: AgendaEvent[];
  emptyAction?: () => void;
}) {
  return (
    <section className="agenda-day">
      <header>
        <span>{day}</span>
        <div>
          <h4>{label}</h4>
          <p>{events.length ? `${events.length} planned` : 'Open day'}</p>
        </div>
      </header>
      {events.length ? (
        <ol>
          {events.map((event) => (
            <li key={`${event.time}-${event.title}`}>
              <time>{event.time}</time>
              <div>
                <strong>{event.title}</strong>
                {event.meta ? <small>{event.meta}</small> : null}
              </div>
              {event.confirmed ? <span className="event-confirmed">Confirmed</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <button className="empty-day" type="button" onClick={emptyAction}>
          <span aria-hidden="true">＋</span>
          Add from activity pool
        </button>
      )}
    </section>
  );
}

function RomeContent({
  assigned,
  proposalApplied,
  onAssign,
  onStayDetails,
}: {
  assigned: string[];
  proposalApplied: boolean;
  onAssign: (id: string) => void;
  onStayDetails: () => void;
}) {
  const pool = romeActivityPool.filter(
    (activity) => !assigned.includes(activity.id) && !(proposalApplied && activity.id === 'borghese'),
  );

  const tuesdayEvents: AgendaEvent[] = [
    ...(proposalApplied
      ? []
      : [{ time: '09:30', title: 'Vatican Museums', meta: 'Viale Vaticano', confirmed: true }]),
    { time: '13:00', title: 'St Peter’s Basilica', meta: 'Vatican City' },
    ...(proposalApplied
      ? [{ time: '15:00', title: 'Borghese Gallery', meta: 'Added by approved proposal' }]
      : []),
  ];

  const wednesdayEvents: AgendaEvent[] = [
    ...(proposalApplied
      ? [{ time: '09:30', title: 'Vatican Museums', meta: 'Moved by approved proposal', confirmed: true }]
      : []),
    ...assigned
      .filter((id) => !(proposalApplied && id === 'borghese'))
      .map((id, index) => {
        const activity = romeActivityPool.find((item) => item.id === id);
        return {
          time: `${14 + index}:00`,
          title: activity?.title ?? 'Activity',
          meta: 'Assigned from activity pool',
        };
      }),
  ];

  return (
    <div className="destination-body destination-body-rome">
      <aside className="destination-sidebar">
        <section className="subsection stay-section">
          <div className="section-title-row">
            <div>
              <p className="section-kicker">Stay</p>
              <h3>Accommodation</h3>
            </div>
            <button type="button" aria-label="Add accommodation">＋</button>
          </div>
          <article className="stay-card">
            <div className="stay-image stay-image-rome" aria-hidden="true"><span>R</span></div>
            <div>
              <span className="mini-status">✓ Confirmed</span>
              <h4>Casa Navona</h4>
              <p>Piazza Navona area</p>
              <small>Apr 11, 15:00 → Apr 15, 08:00</small>
              <button type="button" onClick={onStayDetails}>View booking</button>
            </div>
          </article>
        </section>

        <section className="subsection activity-pool">
          <div className="section-title-row">
            <div>
              <p className="section-kicker">Ideas</p>
              <h3>Activity pool</h3>
            </div>
            <span>{pool.length}</span>
          </div>
          {pool.length ? (
            <ul>
              {pool.map((activity) => (
                <li key={activity.id}>
                  <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                  <div>
                    <strong>{activity.title}</strong>
                    <small>{activity.duration}</small>
                  </div>
                  <button type="button" onClick={() => onAssign(activity.id)}>Assign</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pool-empty">Every saved idea is on the plan.</p>
          )}
          <button className="add-idea-button" type="button">＋ Add an idea</button>
        </section>
      </aside>

      <section className="agenda-section">
        <div className="agenda-heading">
          <div>
            <p className="section-kicker">Rome plan</p>
            <h3>Day by day</h3>
          </div>
          <button className="button-secondary" type="button">＋ Add activity</button>
        </div>
        <div className="agenda-list">
          <AgendaDay
            day="11"
            label="Sun, Apr 11"
            events={[
              { time: '11:05', title: 'Arrive at FCO', meta: 'Flight VY 6100', confirmed: true },
              { time: '15:00', title: 'Check in at Casa Navona', meta: 'Booking CN-4821' },
              { time: '18:00', title: 'Piazza Navona walk', meta: 'Easy first evening' },
            ]}
          />
          <AgendaDay
            day="12"
            label="Mon, Apr 12"
            events={[
              { time: '09:00', title: 'Colosseum', meta: 'Timed entry', confirmed: true },
              { time: '11:30', title: 'Roman Forum', meta: 'Walk from Colosseum' },
              { time: '19:00', title: 'Trastevere food walk', meta: 'Meet at Piazza Trilussa' },
            ]}
          />
          <AgendaDay day="13" label="Tue, Apr 13" events={tuesdayEvents} />
          <AgendaDay
            day="14"
            label="Wed, Apr 14"
            events={wednesdayEvents}
            emptyAction={() => onAssign('borghese')}
          />
        </div>
      </section>
    </div>
  );
}

function CompactDestinationContent({
  city,
  stay,
  stayStatus,
  activities,
  attention,
}: {
  city: string;
  stay: string;
  stayStatus: string;
  activities: string[];
  attention?: string;
}) {
  return (
    <div className="compact-destination-body">
      <section>
        <p className="section-kicker">Stay</p>
        <h3>{stay}</h3>
        <span className={attention ? 'compact-attention' : 'compact-ready'}>
          {attention ? '!' : '✓'} {stayStatus}
        </span>
        <button type="button">{attention ? 'Find a place' : 'View details'}</button>
      </section>
      <section>
        <p className="section-kicker">Saved for {city}</p>
        <h3>{activities.length} activities</h3>
        <ul>
          {activities.map((activity) => <li key={activity}>{activity}</li>)}
        </ul>
      </section>
      <section className="compact-plan">
        <p className="section-kicker">Plan</p>
        <h3>{attention ?? 'Everything arranged'}</h3>
        <p>{attention ? 'This will stay visible until it has a home in the trip.' : 'The essentials are covered. You can keep refining the days.'}</p>
      </section>
    </div>
  );
}

function DestinationCard({
  id,
  number,
  city,
  country,
  dates,
  nights,
  summary,
  status,
  statusTone,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  number: string;
  city: string;
  country: string;
  dates: string;
  nights: string;
  summary: string;
  status: string;
  statusTone: StatusTone;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentId = `${id}-content`;

  return (
    <article className={`destination-card ${expanded ? 'destination-card-expanded' : ''}`}>
      <button
        className="destination-header"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span className="destination-number">{number}</span>
        <span className="destination-title">
          <small>{country}</small>
          <strong>{city}</strong>
        </span>
        <span className="destination-dates">
          <strong>{dates}</strong>
          <small>{nights}</small>
        </span>
        <span className="destination-summary">{summary}</span>
        <span className={`status-pill status-${statusTone}`}>
          <span aria-hidden="true" />
          {status}
        </span>
        <span className="destination-chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded ? <div id={contentId}>{children}</div> : null}
    </article>
  );
}

function ProposalBanner({
  status,
  onReview,
}: {
  status: ProposalStatus;
  onReview: () => void;
}) {
  if (status === 'idle' || status === 'applied') return null;

  if (status === 'loading') {
    return (
      <div className="proposal-banner proposal-loading" role="status">
        <span className="proposal-spark" aria-hidden="true">✦</span>
        <div>
          <strong>Preparing your proposal…</strong>
          <p>Checking the plan and preserving confirmed details.</p>
        </div>
        <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    );
  }

  return (
    <button className="proposal-banner proposal-ready" type="button" onClick={onReview}>
      <span className="proposal-spark" aria-hidden="true">✦</span>
      <span>
        <strong>{status === 'kept' ? '1 unapplied proposal' : '2 changes ready to review'}</strong>
        <small>{status === 'kept' ? 'Saved for whenever you are ready.' : 'Review before anything changes.'}</small>
      </span>
      <span aria-hidden="true">Review →</span>
    </button>
  );
}

function TripDetail({
  onBack,
  showToast,
  proposalStatus,
  setProposalStatus,
  onReviewProposal,
}: {
  onBack: () => void;
  showToast: (message: string) => void;
  proposalStatus: ProposalStatus;
  setProposalStatus: (status: ProposalStatus) => void;
  onReviewProposal: () => void;
}) {
  const [expandedStops, setExpandedStops] = useState<Record<string, boolean>>({
    rome: true,
    florence: false,
    venice: false,
  });
  const [assigned, setAssigned] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(
    'Move the Vatican Museums to Wednesday morning and add Borghese Gallery on Tuesday afternoon.',
  );
  const proposalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
  }, []);

  function toggleStop(id: string) {
    setExpandedStops((current) => ({ ...current, [id]: !current[id] }));
  }

  function assignActivity(id: string) {
    if (!assigned.includes(id)) setAssigned((current) => [...current, id]);
    const activity = romeActivityPool.find((item) => item.id === id);
    showToast(`${activity?.title ?? 'Activity'} assigned to Wed, Apr 14.`);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setProposalStatus('loading');
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
    proposalTimer.current = setTimeout(() => setProposalStatus('ready'), 900);
  }

  return (
    <main id="main-content" className="detail-page">
      <div className="detail-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> All trips
        </button>
        <div className="detail-actions">
          {proposalStatus === 'kept' ? <span className="saved-proposal-pill">✦ 1 proposal</span> : null}
          <button className="button-secondary" type="button" onClick={() => showToast('Trip editing is represented by the mock controls below.')}>Edit trip</button>
          <button
            className="button-primary button-primary-compact"
            type="button"
            onClick={() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <span aria-hidden="true">✦</span> Ask TripDock
          </button>
        </div>
      </div>

      <header className="trip-detail-heading">
        <div>
          <p className="overline">Upcoming trip</p>
          <h1>Italy in spring</h1>
          <p>Apr 11–20, 2027 <span aria-hidden="true">·</span> 9 nights <span aria-hidden="true">·</span> 2 travelers</p>
        </div>
        <div className="trip-detail-route" aria-label="Rome to Florence to Venice">
          <span>Rome</span><i aria-hidden="true" /><span>Florence</span><i aria-hidden="true" /><span>Venice</span>
        </div>
      </header>

      <section className="trip-facts" aria-label="Trip summary">
        <div><strong>3</strong><span>destinations</span></div>
        <div><strong>9</strong><span>nights</span></div>
        <div><strong>4</strong><span>transport legs</span></div>
        <div><strong>2</strong><span>stays booked</span></div>
        <div className="trip-fact-attention"><strong>2</strong><span>things to arrange</span></div>
      </section>

      <ProposalBanner status={proposalStatus} onReview={onReviewProposal} />

      <section className="journey" aria-labelledby="journey-heading">
        <div className="journey-heading">
          <div>
            <p className="overline">The whole journey</p>
            <h2 id="journey-heading">Your itinerary</h2>
          </div>
          <p>Destinations and transport stay in one clear order.</p>
        </div>

        <div className="journey-spine">
          <TransportLeg
            icon="✈"
            eyebrow="Getting there · Sun, Apr 11"
            route="Barcelona → Rome"
            time="09:20–11:05"
            detail="BCN → FCO · VY 6100"
            status="Confirmed"
            onDetails={() => showToast('Flight details: Terminal 1 · booking VY8F2L.')}
          />

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <DestinationCard
            id="rome"
            number="01"
            city="Rome"
            country="Italy"
            dates="Apr 11–15"
            nights="4 nights"
            summary="Stay confirmed · 8 planned"
            status="On track"
            statusTone="ready"
            expanded={expandedStops.rome}
            onToggle={() => toggleStop('rome')}
          >
            <RomeContent
              assigned={assigned}
              proposalApplied={proposalStatus === 'applied'}
              onAssign={assignActivity}
              onStayDetails={() => showToast('Casa Navona · Check-in after 15:00 · CN-4821.')}
            />
          </DestinationCard>

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <TransportLeg
            icon="↗"
            eyebrow="Changing cities · Thu, Apr 15"
            route="Rome → Florence"
            time="08:35–10:11"
            detail="Roma Termini → Firenze S. M. Novella"
            status="Booked"
            onDetails={() => showToast('Italo high-speed train · Seats 8A and 8B.')}
          />

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <DestinationCard
            id="florence"
            number="02"
            city="Florence"
            country="Italy"
            dates="Apr 15–18"
            nights="3 nights"
            summary="Arno Rooms · 3 activities"
            status="Ready"
            statusTone="ready"
            expanded={expandedStops.florence}
            onToggle={() => toggleStop('florence')}
          >
            <CompactDestinationContent
              city="Florence"
              stay="Arno Rooms"
              stayStatus="Confirmed"
              activities={['Uffizi Gallery', 'Duomo', 'Oltrarno evening']}
            />
          </DestinationCard>

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <TransportLeg
            icon="↗"
            eyebrow="Changing cities · Sun, Apr 18"
            route="Florence → Venice"
            time="09:20–11:34"
            detail="Firenze S. M. Novella → Venezia S. Lucia"
            status="Needs booking"
            attention
            onDetails={() => showToast('This train is not booked yet. Suggested departure: 09:20.')}
          />

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <DestinationCard
            id="venice"
            number="03"
            city="Venice"
            country="Italy"
            dates="Apr 18–20"
            nights="2 nights"
            summary="Stay needed · 3 ideas"
            status="Needs attention"
            statusTone="attention"
            expanded={expandedStops.venice}
            onToggle={() => toggleStop('venice')}
          >
            <CompactDestinationContent
              city="Venice"
              stay="No accommodation yet"
              stayStatus="Accommodation needed"
              activities={['St Mark’s Basilica', 'Rialto Market', 'Murano']}
              attention="Choose where to stay"
            />
          </DestinationCard>

          <div className="spine-connector" aria-hidden="true"><span /></div>

          <TransportLeg
            icon="✈"
            eyebrow="Heading home · Tue, Apr 20"
            route="Venice → Barcelona"
            time="18:10–20:05"
            detail="VCE → BCN · VY 6405"
            status="Confirmed"
            onDetails={() => showToast('Flight details: booking VY9C8P.')}
          />
        </div>
      </section>

      <section className="ai-composer-section" ref={composerRef} aria-labelledby="composer-title">
        <div className="composer-intro">
          <span className="proposal-spark" aria-hidden="true">✦</span>
          <div>
            <h2 id="composer-title">Ask TripDock</h2>
            <p>Ask a question or describe a change in your own words.</p>
          </div>
        </div>
        <form className="ai-composer" onSubmit={submitPrompt}>
          <label className="sr-only" htmlFor="trip-prompt">Ask TripDock about this trip</label>
          <textarea
            id="trip-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
          />
          <button className="voice-button" type="button" aria-label="Add a voice note" onClick={() => showToast('Voice input is represented here but is not connected yet.')}>●</button>
          <button className="composer-send" type="submit" aria-label="Send request">↑</button>
        </form>
        <p className="composer-reassurance"><span aria-hidden="true">✓</span> Nothing changes until you approve.</p>
      </section>
    </main>
  );
}

function ModalFrame({
  titleId,
  onClose,
  children,
  wide,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstControl = dialogRef.current?.querySelector<HTMLElement>('button, input, textarea, select');
    firstControl?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
        ),
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className={`modal-card ${wide ? 'modal-card-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        {children}
      </div>
    </div>
  );
}

function NewTripModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [prompt, setPrompt] = useState(
    'Ten days in Italy next April for two people. We want Rome, Florence and Venice.',
  );
  const [form, setForm] = useState({
    name: '',
    area: '',
    start: '',
    end: '',
    travelers: '2',
    stops: [] as string[],
  });

  function prefill() {
    setForm({
      name: 'Italy in spring',
      area: 'Italy',
      start: '2027-04-11',
      end: '2027-04-20',
      travelers: '2',
      stops: ['Rome', 'Florence', 'Venice'],
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate();
  }

  return (
    <ModalFrame titleId="new-trip-title" onClose={onClose} wide>
      <header className="modal-header">
        <div>
          <p className="overline">New journey</p>
          <h2 id="new-trip-title">Create a trip</h2>
          <p>Start with the essentials. You can shape everything else later.</p>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="new-trip-layout">
        <section className="ai-intake">
          <div className="ai-intake-title">
            <span className="proposal-spark" aria-hidden="true">✦</span>
            <div><strong>Describe your trip</strong><small>Type it or add a voice note.</small></div>
          </div>
          <label className="sr-only" htmlFor="intake-prompt">Describe your trip</label>
          <textarea id="intake-prompt" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <div>
            <button className="voice-button voice-button-light" type="button" aria-label="Add a voice note">●</button>
            <button className="button-ai" type="button" onClick={prefill}>✦ Fill the form</button>
          </div>
          <p>TripDock will only prefill the form. You still decide what to create.</p>
        </section>

        <form className="trip-form" onSubmit={submit}>
          <label>
            <span>Trip name</span>
            <input
              required
              value={form.name}
              placeholder="e.g. Italy in spring"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>Destination or trip area</span>
            <input
              required
              value={form.area}
              placeholder="Country, region, or city"
              onChange={(event) => setForm({ ...form, area: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              <span>Starts</span>
              <input type="date" required value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
            </label>
            <label>
              <span>Ends</span>
              <input type="date" required value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} />
            </label>
          </div>
          <label>
            <span>Travelers</span>
            <input type="number" min="1" value={form.travelers} onChange={(event) => setForm({ ...form, travelers: event.target.value })} />
          </label>
          <fieldset>
            <legend>Destinations</legend>
            {form.stops.length ? (
              <div className="destination-chips">
                {form.stops.map((stop, index) => <span key={stop}>{index + 1}. {stop}</span>)}
              </div>
            ) : (
              <button className="add-destination" type="button" onClick={() => setForm({ ...form, stops: ['Rome'] })}>＋ Add destination</button>
            )}
          </fieldset>
          <div className="modal-footer form-footer">
            <button className="button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button-primary" type="submit">Create trip</button>
          </div>
        </form>
      </div>
    </ModalFrame>
  );
}

function ProposalReviewModal({
  onClose,
  onDiscard,
  onKeep,
  onApply,
}: {
  onClose: () => void;
  onDiscard: () => void;
  onKeep: () => void;
  onApply: () => void;
}) {
  const [included, setIncluded] = useState([true, true]);
  const count = included.filter(Boolean).length;

  return (
    <ModalFrame titleId="review-title" onClose={onClose} wide>
      <header className="modal-header review-header">
        <div>
          <p className="overline">TripDock proposal</p>
          <h2 id="review-title">Review {count} proposed {count === 1 ? 'change' : 'changes'}</h2>
          <p>Nothing below is part of the accepted trip yet.</p>
        </div>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <blockquote className="original-request">
        “Move the Vatican Museums to Wednesday morning and add Borghese Gallery on Tuesday afternoon.”
      </blockquote>

      <div className="change-list">
        <label className={`change-card ${included[0] ? '' : 'change-card-muted'}`}>
          <input
            type="checkbox"
            checked={included[0]}
            onChange={(event) => setIncluded([event.target.checked, included[1]])}
          />
          <span className="change-index">01</span>
          <span className="change-copy">
            <strong>Move Vatican Museums</strong>
            <span className="before-after">
              <span><small>Before</small>Tue, Apr 13 · 09:30</span>
              <i aria-hidden="true">→</i>
              <span><small>After</small>Wed, Apr 14 · 09:30</span>
            </span>
            <em><span aria-hidden="true">!</span> This activity is confirmed. Its booking time will not change automatically.</em>
          </span>
        </label>

        <label className={`change-card ${included[1] ? '' : 'change-card-muted'}`}>
          <input
            type="checkbox"
            checked={included[1]}
            onChange={(event) => setIncluded([included[0], event.target.checked])}
          />
          <span className="change-index">02</span>
          <span className="change-copy">
            <strong>Schedule Borghese Gallery</strong>
            <span className="before-after">
              <span><small>Before</small>Unscheduled idea</span>
              <i aria-hidden="true">→</i>
              <span><small>After</small>Tue, Apr 13 · 15:00</span>
            </span>
          </span>
        </label>
      </div>

      <footer className="modal-footer review-footer">
        <button className="button-text button-danger" type="button" onClick={onDiscard}>Discard</button>
        <div>
          <button className="button-secondary" type="button" onClick={onKeep}>Keep for later</button>
          <button className="button-primary" type="button" disabled={!count} onClick={onApply}>
            Apply {count} {count === 1 ? 'change' : 'changes'}
          </button>
        </div>
      </footer>
    </ModalFrame>
  );
}

export function TripDockApp() {
  const [view, setView] = useState<'trips' | 'detail'>('trips');
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [proposalStatus, setProposalStatus] = useState<ProposalStatus>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  function showTrips() {
    setView('trips');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showDetail() {
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div id="top" className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppHeader detail={view === 'detail'} onHome={showTrips} />

      {view === 'trips' ? (
        <TripsOverview
          onNewTrip={() => setNewTripOpen(true)}
          onOpenTrip={showDetail}
          showToast={showToast}
        />
      ) : (
        <TripDetail
          onBack={showTrips}
          showToast={showToast}
          proposalStatus={proposalStatus}
          setProposalStatus={setProposalStatus}
          onReviewProposal={() => setReviewOpen(true)}
        />
      )}

      <footer className="site-footer">
        <p>TripDock · A calmer place for the whole journey.</p>
      </footer>

      {newTripOpen ? (
        <NewTripModal
          onClose={() => setNewTripOpen(false)}
          onCreate={() => {
            setNewTripOpen(false);
            showToast('Trip created. Your new journey is ready to shape.');
          }}
        />
      ) : null}

      {reviewOpen ? (
        <ProposalReviewModal
          onClose={() => setReviewOpen(false)}
          onDiscard={() => {
            setReviewOpen(false);
            setProposalStatus('idle');
            showToast('Proposal discarded. The trip was not changed.');
          }}
          onKeep={() => {
            setReviewOpen(false);
            setProposalStatus('kept');
            showToast('Proposal saved for later.');
          }}
          onApply={() => {
            setReviewOpen(false);
            setProposalStatus('applied');
            showToast('Trip updated. Proposal applied.');
          }}
        />
      ) : null}

      {toast ? <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
    </div>
  );
}

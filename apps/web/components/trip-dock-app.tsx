'use client';

import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  applyProposalChanges,
  createInitialPrototypeState,
  createTripFromDraft,
  DEFAULT_PROPOSAL_PROMPT,
  PROTOTYPE_STORAGE_KEY,
  proposalChangesFromPrompt,
  restorePrototypeState,
  type ProposalChangeId,
  type ProposalStatus,
  type PrototypeState,
  type StatusTone,
  type Trip,
  type TripDraft,
} from '../lib/prototype-state';

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

function AppHeader({
  detail,
  onHome,
  onProfile,
}: {
  detail: boolean;
  onHome: () => void;
  onProfile: () => void;
}) {
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
        <button
          className="profile-button"
          type="button"
          aria-label="Open prototype profile"
          onClick={onProfile}
        >
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
        <div className="trip-cover-fallback" aria-hidden="true">
          <span>{trip.route[0]?.slice(0, 2).toLocaleUpperCase() ?? 'TD'}</span>
          <small>{trip.route.join(' · ')}</small>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trip.image}
          alt={trip.alt}
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
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
              {trip.preview.map((item) => (
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
  trips,
  onNewTrip,
  onOpenTrip,
}: {
  trips: Trip[];
  onNewTrip: () => void;
  onOpenTrip: (tripId: string) => void;
}) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [previewTrip, setPreviewTrip] = useState<string | null>(null);

  return (
    <main id="main-content" className="page-wrap" tabIndex={-1}>
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

      <div className="trip-tabs" aria-label="Trip timing">
        <button
          className={`trip-tab ${tab === 'upcoming' ? 'trip-tab-active' : ''}`}
          type="button"
          aria-pressed={tab === 'upcoming'}
          onClick={() => setTab('upcoming')}
        >
          Upcoming <span>{trips.length}</span>
        </button>
        <button
          className={`trip-tab ${tab === 'past' ? 'trip-tab-active' : ''}`}
          type="button"
          aria-pressed={tab === 'past'}
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
              onView={() => onOpenTrip(trip.id)}
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
  acceptedChanges,
  onAssign,
  onStayDetails,
  onAddStay,
  onAddIdea,
  onAddActivity,
}: {
  assigned: string[];
  acceptedChanges: ProposalChangeId[];
  onAssign: (id: string) => void;
  onStayDetails: () => void;
  onAddStay: () => void;
  onAddIdea: () => void;
  onAddActivity: () => void;
}) {
  const movedVatican = acceptedChanges.includes('move-vatican');
  const scheduledBorghese = acceptedChanges.includes('schedule-borghese');
  const pool = romeActivityPool.filter(
    (activity) => !assigned.includes(activity.id) && !(scheduledBorghese && activity.id === 'borghese'),
  );

  const tuesdayEvents: AgendaEvent[] = [
    ...(movedVatican
      ? []
      : [{ time: '09:30', title: 'Vatican Museums', meta: 'Viale Vaticano', confirmed: true }]),
    { time: '13:00', title: 'St Peter’s Basilica', meta: 'Vatican City' },
    ...(scheduledBorghese
      ? [{ time: '15:00', title: 'Borghese Gallery', meta: 'Added by approved proposal' }]
      : []),
  ];

  const wednesdayEvents: AgendaEvent[] = [
    ...(movedVatican
      ? [{ time: '09:30', title: 'Vatican Museums', meta: 'Moved by approved proposal', confirmed: true }]
      : []),
    ...assigned
      .filter((id) => !(scheduledBorghese && id === 'borghese'))
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
            <button type="button" aria-label="Add accommodation" onClick={onAddStay}>＋</button>
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
          <button className="add-idea-button" type="button" onClick={onAddIdea}>＋ Add an idea</button>
        </section>
      </aside>

      <section className="agenda-section">
        <div className="agenda-heading">
          <div>
            <p className="section-kicker">Rome plan</p>
            <h3>Day by day</h3>
          </div>
          <button className="button-secondary" type="button" onClick={onAddActivity}>＋ Add activity</button>
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
  onAction,
}: {
  city: string;
  stay: string;
  stayStatus: string;
  activities: string[];
  attention?: string;
  onAction: () => void;
}) {
  return (
    <div className="compact-destination-body">
      <section>
        <p className="section-kicker">Stay</p>
        <h3>{stay}</h3>
        <span className={attention ? 'compact-attention' : 'compact-ready'}>
          {attention ? '!' : '✓'} {stayStatus}
        </span>
        <button type="button" onClick={onAction}>{attention ? 'Find a place' : 'View details'}</button>
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
  changeCount,
  onReview,
}: {
  status: ProposalStatus;
  changeCount: number;
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
        <strong>{status === 'kept' ? 'Saved proposal' : `${changeCount} ${changeCount === 1 ? 'change' : 'changes'} ready to review`}</strong>
        <small>{status === 'kept' ? 'Saved for whenever you are ready.' : 'Review before anything changes.'}</small>
      </span>
      <span aria-hidden="true">Review →</span>
    </button>
  );
}

function TripDetail({
  onBack,
  showToast,
  proposal,
  acceptedChanges,
  assignedActivities,
  storageLabel,
  onAssignActivity,
  onRequestProposal,
  onReviewProposal,
}: {
  onBack: () => void;
  showToast: (message: string) => void;
  proposal: PrototypeState['proposal'];
  acceptedChanges: ProposalChangeId[];
  assignedActivities: string[];
  storageLabel: 'on this device' | 'for this session';
  onAssignActivity: (id: string) => void;
  onRequestProposal: (prompt: string) => void;
  onReviewProposal: () => void;
}) {
  const [expandedStops, setExpandedStops] = useState<Record<string, boolean>>({
    rome: true,
    florence: false,
    venice: false,
  });
  const [prompt, setPrompt] = useState(proposal.prompt || DEFAULT_PROPOSAL_PROMPT);
  const composerRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  function toggleStop(id: string) {
    setExpandedStops((current) => ({ ...current, [id]: !current[id] }));
  }

  function assignActivity(id: string) {
    onAssignActivity(id);
    const activity = romeActivityPool.find((item) => item.id === id);
    if (assignedActivities.includes(id)) {
      showToast(`${activity?.title ?? 'Activity'} is already on Wed, Apr 14.`);
      return;
    }
    showToast(`${activity?.title ?? 'Activity'} assigned to Wed, Apr 14 and saved ${storageLabel}.`);
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    onRequestProposal(prompt.trim());
  }

  return (
    <main id="main-content" className="detail-page" tabIndex={-1}>
      <div className="detail-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> All trips
        </button>
        <div className="detail-actions">
          {proposal.status === 'kept' ? <span className="saved-proposal-pill">✦ {proposal.changes.length} proposed</span> : null}
          <button className="button-secondary" type="button" onClick={() => showToast('Trip editing is represented by the mock controls below.')}>Edit trip</button>
          <button
            className="button-primary button-primary-compact"
            type="button"
            onClick={() => {
              composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              promptRef.current?.focus({ preventScroll: true });
            }}
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

      <ProposalBanner
        status={proposal.status}
        changeCount={proposal.changes.length}
        onReview={onReviewProposal}
      />

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
              assigned={assignedActivities}
              acceptedChanges={acceptedChanges}
              onAssign={assignActivity}
              onStayDetails={() => showToast('Casa Navona · Check-in after 15:00 · CN-4821.')}
              onAddStay={() => showToast('Casa Navona is already saved. Stay editing is next on the prototype list.')}
              onAddIdea={() => showToast('Idea capture is coming next. For now, assign one of the saved activities.')}
              onAddActivity={() => showToast('Choose an activity from the Rome pool to add it to Wednesday.')}
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
              onAction={() => showToast('Arno Rooms · Check-in Thu, Apr 15 after 15:00.')}
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
              onAction={() => showToast('Accommodation search is not connected in this local prototype yet.')}
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
            <p>Try the local Vatican and Borghese proposal fixture—no API call is made.</p>
          </div>
        </div>
        <form className="ai-composer" onSubmit={submitPrompt}>
          <label className="sr-only" htmlFor="trip-prompt">Ask TripDock about this trip</label>
          <textarea
            ref={promptRef}
            id="trip-prompt"
            value={prompt}
            maxLength={500}
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

function TripOutlineDetail({
  trip,
  onBack,
  showToast,
  storageLabel,
}: {
  trip: Trip;
  onBack: () => void;
  showToast: (message: string) => void;
  storageLabel: 'on this device' | 'for this session';
}) {
  return (
    <main id="main-content" className="detail-page" tabIndex={-1}>
      <div className="detail-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> All trips
        </button>
        <div className="detail-actions">
          {trip.createdLocally ? (
            <span className="saved-proposal-pill local-save-pill">
              ✓ Saved {storageLabel}
            </span>
          ) : null}
          <button
            className="button-secondary"
            type="button"
            onClick={() => showToast('Trip editing is the next prototype slice. Your current draft is safely saved.')}
          >
            Edit trip
          </button>
        </div>
      </div>

      <header className="trip-detail-heading">
        <div>
          <p className="overline">{trip.status} trip</p>
          <h1>{trip.title}</h1>
          <p>{trip.dates} <span aria-hidden="true">·</span> {trip.duration} <span aria-hidden="true">·</span> {trip.travelers}</p>
        </div>
        <div className="trip-detail-route" aria-label={`Route: ${trip.route.join(' to ')}`}>
          {trip.route.map((stop, index) => (
            <span className="detail-route-segment" key={`${stop}-${index}`}>
              <span>{stop}</span>
              {index < trip.route.length - 1 ? <i aria-hidden="true" /> : null}
            </span>
          ))}
        </div>
      </header>

      <section className="trip-facts" aria-label="Trip summary">
        <div><strong>{trip.route.length}</strong><span>{trip.route.length === 1 ? 'destination' : 'destinations'}</span></div>
        <div><strong>{trip.duration.split(' ')[0]}</strong><span>{trip.duration.includes('night') ? 'nights' : 'days'}</span></div>
        <div><strong>{Math.max(0, trip.route.length - 1)}</strong><span>transport legs to plan</span></div>
        <div><strong>0</strong><span>stays added</span></div>
        <div className="trip-fact-attention"><strong>{trip.route.length + Math.max(0, trip.route.length - 1)}</strong><span>essentials to arrange</span></div>
      </section>

      <section className="journey outline-journey" aria-labelledby="outline-heading">
        <div className="journey-heading">
          <div>
            <p className="overline">First draft</p>
            <h2 id="outline-heading">Shape the journey</h2>
          </div>
          <p>The route and dates are saved. Add bookings and ideas when you are ready.</p>
        </div>

        <div className="outline-grid">
          <article className="outline-panel route-outline-panel">
            <p className="section-kicker">Route outline</p>
            <h3>{trip.route.join(' → ')}</h3>
            <ol>
              {trip.preview.map((item, index) => (
                <li key={`${item}-${index}`}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item}</strong>
                </li>
              ))}
            </ol>
          </article>

          <aside className="outline-panel next-steps-panel">
            <p className="section-kicker">Planning checklist</p>
            <h3>Good next steps</h3>
            <button type="button" onClick={() => showToast('Transport planning will connect to each route leg in a later slice.')}>
              <span aria-hidden="true">↗</span><span><strong>Add transport</strong><small>Connect each destination</small></span>
            </button>
            <button type="button" onClick={() => showToast('Accommodation planning is not connected in this local prototype yet.')}>
              <span aria-hidden="true">⌂</span><span><strong>Add stays</strong><small>One place for each stop</small></span>
            </button>
            <button type="button" onClick={() => showToast('Activity capture is demonstrated in the detailed Italy trip.')}>
              <span aria-hidden="true">＋</span><span><strong>Save activity ideas</strong><small>Schedule them later</small></span>
            </button>
          </aside>
        </div>
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
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstControl = dialogRef.current?.querySelector<HTMLElement>('button, input, textarea, select');
    firstControl?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
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
  }, []);

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

function NewTripModal({
  onClose,
  onCreate,
  showToast,
}: {
  onClose: () => void;
  onCreate: (draft: TripDraft) => void;
  showToast: (message: string) => void;
}) {
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
  const [stopInput, setStopInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const stopInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

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
    if (!form.stops.length) {
      setFormError('Add at least one destination before creating the trip.');
      stopInputRef.current?.focus();
      return;
    }
    if (form.end < form.start) {
      setFormError('The end date must be after the start date.');
      endInputRef.current?.focus();
      return;
    }
    setFormError(null);
    onCreate(form);
  }

  function addStop() {
    const stop = stopInput.trim();
    if (!stop) return;
    if (form.stops.length >= 8) {
      setFormError('This first prototype supports up to eight destinations per trip.');
      return;
    }
    setForm((current) => ({
      ...current,
      stops: current.stops.some((item) => item.toLocaleLowerCase() === stop.toLocaleLowerCase())
        ? current.stops
        : [...current.stops, stop],
    }));
    setStopInput('');
    setFormError(null);
  }

  function addStopWithKeyboard(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addStop();
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
          <textarea id="intake-prompt" rows={6} value={prompt} maxLength={800} onChange={(event) => setPrompt(event.target.value)} />
          <div>
            <button
              className="voice-button voice-button-light"
              type="button"
              aria-label="Add a voice note"
              onClick={() => showToast('Voice intake is planned, but this permission-free prototype uses text only.')}
            >
              ●
            </button>
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
              maxLength={80}
              placeholder="e.g. Italy in spring"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>Destination or trip area</span>
            <input
              required
              value={form.area}
              maxLength={80}
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
              <input
                ref={endInputRef}
                type="date"
                required
                min={form.start || undefined}
                value={form.end}
                aria-invalid={Boolean(formError && form.end < form.start)}
                aria-describedby={formError ? 'trip-form-error' : undefined}
                onChange={(event) => setForm({ ...form, end: event.target.value })}
              />
            </label>
          </div>
          <label>
            <span>Travelers</span>
            <input type="number" min="1" max="20" required value={form.travelers} onChange={(event) => setForm({ ...form, travelers: event.target.value })} />
          </label>
          <fieldset>
            <legend>Destinations</legend>
            {form.stops.length ? (
              <div className="destination-chips">
                {form.stops.map((stop, index) => (
                  <button
                    type="button"
                    key={stop}
                    onClick={() => setForm({ ...form, stops: form.stops.filter((item) => item !== stop) })}
                    aria-label={`Remove ${stop}`}
                    title={`Remove ${stop}`}
                  >
                    {index + 1}. {stop} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="destination-entry">
              <input
                ref={stopInputRef}
                value={stopInput}
                maxLength={60}
                placeholder="Add a city or stop"
                aria-label="Destination name"
                aria-invalid={Boolean(formError && !form.stops.length)}
                aria-describedby={formError ? 'trip-form-error' : undefined}
                onChange={(event) => setStopInput(event.target.value)}
                onKeyDown={addStopWithKeyboard}
              />
              <button className="add-destination" type="button" onClick={addStop}>＋ Add</button>
            </div>
          </fieldset>
          {formError ? <p className="form-error" id="trip-form-error" role="alert">{formError}</p> : null}
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
  prompt,
  changes,
  borgheseAssigned,
  onClose,
  onDiscard,
  onKeep,
  onApply,
}: {
  prompt: string;
  changes: ProposalChangeId[];
  borgheseAssigned: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onKeep: () => void;
  onApply: (included: ProposalChangeId[]) => void;
}) {
  const [included, setIncluded] = useState<ProposalChangeId[]>(() => [...changes]);
  const count = included.length;

  function toggleChange(change: ProposalChangeId, checked: boolean) {
    setIncluded((current) => checked
      ? [...new Set([...current, change])]
      : current.filter((item) => item !== change));
  }

  function changeIndex(change: ProposalChangeId) {
    return String(changes.indexOf(change) + 1).padStart(2, '0');
  }

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
        “{prompt}”
      </blockquote>

      <div className="change-list">
        {changes.includes('move-vatican') ? (
          <label className={`change-card ${included.includes('move-vatican') ? '' : 'change-card-muted'}`}>
            <input
              type="checkbox"
              checked={included.includes('move-vatican')}
              onChange={(event) => toggleChange('move-vatican', event.target.checked)}
            />
            <span className="change-index">{changeIndex('move-vatican')}</span>
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
        ) : null}

        {changes.includes('schedule-borghese') ? (
          <label className={`change-card ${included.includes('schedule-borghese') ? '' : 'change-card-muted'}`}>
            <input
              type="checkbox"
              checked={included.includes('schedule-borghese')}
              onChange={(event) => toggleChange('schedule-borghese', event.target.checked)}
            />
            <span className="change-index">{changeIndex('schedule-borghese')}</span>
            <span className="change-copy">
              <strong>{borgheseAssigned ? 'Move Borghese Gallery' : 'Schedule Borghese Gallery'}</strong>
              <span className="before-after">
                <span><small>Before</small>{borgheseAssigned ? 'Wed, Apr 14 · 14:00' : 'Unscheduled idea'}</span>
                <i aria-hidden="true">→</i>
                <span><small>After</small>Tue, Apr 13 · 15:00</span>
              </span>
              {borgheseAssigned ? (
                <em><span aria-hidden="true">!</span> This replaces the Wednesday assignment you already accepted.</em>
              ) : null}
            </span>
          </label>
        ) : null}
      </div>

      <footer className="modal-footer review-footer">
        <button className="button-text button-danger" type="button" onClick={onDiscard}>Discard</button>
        <div>
          <button className="button-secondary" type="button" onClick={onKeep}>Keep for later</button>
          <button className="button-primary" type="button" disabled={!count} onClick={() => onApply(included)}>
            Apply {count} {count === 1 ? 'change' : 'changes'}
          </button>
        </div>
      </footer>
    </ModalFrame>
  );
}

export function TripDockApp() {
  const [prototype, setPrototype] = useState<PrototypeState>(() => createInitialPrototypeState());
  const [stateLoaded, setStateLoaded] = useState(false);
  const [storageMode, setStorageMode] = useState<'durable' | 'memory'>('durable');
  const [view, setView] = useState<'trips' | 'detail'>('trips');
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proposalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setPrototype(restorePrototypeState(window.localStorage.getItem(PROTOTYPE_STORAGE_KEY)));
      setStorageMode('durable');
    } catch {
      setPrototype(createInitialPrototypeState());
      setStorageMode('memory');
    } finally {
      setStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!stateLoaded) return;
    try {
      const serialized = JSON.stringify(prototype);
      if (window.localStorage.getItem(PROTOTYPE_STORAGE_KEY) !== serialized) {
        window.localStorage.setItem(PROTOTYPE_STORAGE_KEY, serialized);
      }
      setStorageMode('durable');
    } catch {
      setStorageMode('memory');
    }
  }, [prototype, stateLoaded]);

  useEffect(() => {
    function syncExternalPrototype(event: StorageEvent) {
      if (event.key !== PROTOTYPE_STORAGE_KEY || !event.newValue) return;
      setPrototype(restorePrototypeState(event.newValue));
      setStorageMode('durable');
    }

    window.addEventListener('storage', syncExternalPrototype);
    return () => window.removeEventListener('storage', syncExternalPrototype);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  function showTrips() {
    setView('trips');
    setSelectedTripId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }

  function showDetail(tripId: string) {
    setSelectedTripId(tripId);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }

  function assignRomeActivity(id: string) {
    setPrototype((current) => ({
      ...current,
      assignedRomeActivities: current.assignedRomeActivities.includes(id)
        ? current.assignedRomeActivities
        : [...current.assignedRomeActivities, id],
    }));
  }

  function requestProposal(prompt: string) {
    const recognizedChanges = proposalChangesFromPrompt(prompt);
    const pendingChanges = recognizedChanges.filter(
      (change) => !prototype.acceptedRomeChanges.includes(change),
    );
    if (!recognizedChanges.length) {
      showToast('This local fixture recognizes requests about the Vatican Museums and Borghese Gallery.');
      return;
    }
    if (!pendingChanges.length) {
      showToast('Those itinerary changes are already part of the accepted trip.');
      return;
    }
    if (proposalTimer.current) clearTimeout(proposalTimer.current);
    setPrototype((current) => ({
      ...current,
      proposal: { status: 'loading', prompt, changes: pendingChanges },
    }));
    proposalTimer.current = setTimeout(() => {
      setPrototype((current) => ({
        ...current,
        proposal: current.proposal.status === 'loading'
          ? { ...current.proposal, status: 'ready' }
          : current.proposal,
      }));
    }, 900);
  }

  function createTrip(draft: TripDraft) {
    try {
      const trip = createTripFromDraft(draft);
      setPrototype((current) => ({ ...current, trips: [trip, ...current.trips] }));
      setNewTripOpen(false);
      showDetail(trip.id);
      showToast(`Trip created and saved ${storageMode === 'durable' ? 'on this device' : 'for this session'}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The trip could not be created.');
    }
  }

  const selectedTrip = prototype.trips.find((trip) => trip.id === selectedTripId);
  const storageLabel = storageMode === 'durable' ? 'on this device' : 'for this session';

  return (
    <div id="top" className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AppHeader
        detail={view === 'detail'}
        onHome={showTrips}
        onProfile={() => showToast(`Local prototype mode · Trip data is saved ${storageLabel}.`)}
      />

      {view === 'trips' ? (
        <TripsOverview
          trips={prototype.trips}
          onNewTrip={() => setNewTripOpen(true)}
          onOpenTrip={showDetail}
        />
      ) : selectedTrip?.id === 'italy-spring-2027' ? (
        <TripDetail
          onBack={showTrips}
          showToast={showToast}
          proposal={prototype.proposal}
          acceptedChanges={prototype.acceptedRomeChanges}
          assignedActivities={prototype.assignedRomeActivities}
          storageLabel={storageLabel}
          onAssignActivity={assignRomeActivity}
          onRequestProposal={requestProposal}
          onReviewProposal={() => setReviewOpen(true)}
        />
      ) : selectedTrip ? (
        <TripOutlineDetail
          trip={selectedTrip}
          onBack={showTrips}
          showToast={showToast}
          storageLabel={storageLabel}
        />
      ) : (
        <TripsOverview
          trips={prototype.trips}
          onNewTrip={() => setNewTripOpen(true)}
          onOpenTrip={showDetail}
        />
      )}

      <footer className="site-footer">
        <p>TripDock · A calmer place for the whole journey.</p>
      </footer>

      {newTripOpen ? (
        <NewTripModal
          onClose={() => setNewTripOpen(false)}
          onCreate={createTrip}
          showToast={showToast}
        />
      ) : null}

      {reviewOpen ? (
        <ProposalReviewModal
          prompt={prototype.proposal.prompt}
          changes={prototype.proposal.changes}
          borgheseAssigned={prototype.assignedRomeActivities.includes('borghese')}
          onClose={() => setReviewOpen(false)}
          onDiscard={() => {
            setReviewOpen(false);
            setPrototype((current) => ({
              ...current,
              proposal: { ...current.proposal, status: 'idle', changes: [] },
            }));
            showToast('Proposal discarded. The trip was not changed.');
            window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
          }}
          onKeep={() => {
            setReviewOpen(false);
            setPrototype((current) => ({
              ...current,
              proposal: { ...current.proposal, status: 'kept' },
            }));
            showToast(`Proposal saved ${storageLabel}.`);
          }}
          onApply={(included) => {
            setReviewOpen(false);
            setPrototype((current) => applyProposalChanges(current, included));
            showToast(`${included.length} ${included.length === 1 ? 'change' : 'changes'} applied and saved ${storageLabel}.`);
            window.requestAnimationFrame(() => document.getElementById('main-content')?.focus());
          }}
        />
      ) : null}

      {toast ? <div className="toast" role="status"><span aria-hidden="true">✓</span>{toast}</div> : null}
    </div>
  );
}

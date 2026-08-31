'use client';

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  dateTimeLocalToIso,
  draftToTripInput,
  formatDateRange,
  formatDateTime,
  graphqlRequest,
  isoToDateTimeLocal,
  operations,
  TripDockGraphQLError,
  toggleSelectedOperation,
  type Activity,
  type Proposal,
  type ProposalOperation,
  type Stay,
  type TransportLeg,
  type Trip,
  type TripDraft,
  type TripDraftStop,
  type TripInput,
  type TripStop,
} from '../lib/graphql-client';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; trips: Trip[] };

type Notice = { tone: 'success' | 'error'; message: string } | null;

const blankStop = (): TripDraftStop => ({
  name: '',
  locationText: null,
  arrivalDate: null,
  departureDate: null,
});

const blankTrip = (): TripInput => ({
  name: '',
  destinationArea: '',
  startDate: '',
  endDate: '',
  travelerCount: 2,
  stops: [blankStop()],
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={compact ? 'brand-logo brand-logo-compact' : 'brand-logo'}
      src="/brand/tripdock-logo.png"
      width="1863"
      height="844"
      alt="TripDock"
    />
  );
}

function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`app-dialog ${wide ? 'app-dialog-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-panel">
        <header className="dialog-header">
          <div>
            {eyebrow ? <p className="overline">{eyebrow}</p> : null}
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function TripFields({ value, onChange }: { value: TripInput; onChange: (next: TripInput) => void }) {
  function updateStop(index: number, patch: Partial<TripDraftStop>) {
    onChange({
      ...value,
      stops: value.stops.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...patch } : stop,
      ),
    });
  }

  return (
    <div className="form-stack">
      <div className="form-grid form-grid-two">
        <Field label="Trip name">
          <input required maxLength={160} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="A name you’ll recognize" />
        </Field>
        <Field label="Destination area">
          <input required maxLength={200} value={value.destinationArea} onChange={(event) => onChange({ ...value, destinationArea: event.target.value })} placeholder="Country, region, or broad area" />
        </Field>
      </div>
      <div className="form-grid form-grid-three">
        <Field label="Start date"><input required type="date" value={value.startDate} onChange={(event) => onChange({ ...value, startDate: event.target.value })} /></Field>
        <Field label="End date"><input required type="date" min={value.startDate || undefined} value={value.endDate} onChange={(event) => onChange({ ...value, endDate: event.target.value })} /></Field>
        <Field label="Travelers"><input required type="number" min="1" max="20" value={value.travelerCount} onChange={(event) => onChange({ ...value, travelerCount: Number(event.target.value) })} /></Field>
      </div>
      <fieldset className="stops-editor">
        <legend>Ordered destinations</legend>
        {value.stops.map((stop, index) => (
          <div className="draft-stop" key={`draft-stop-${index}`}>
            <span className="position-badge" aria-label={`Destination ${index + 1}`}>{index + 1}</span>
            <div className="form-grid form-grid-two">
              <Field label="Stop name"><input required value={stop.name} onChange={(event) => updateStop(index, { name: event.target.value })} placeholder="City or destination" /></Field>
              <Field label="Location detail"><input value={stop.locationText ?? ''} onChange={(event) => updateStop(index, { locationText: event.target.value || null })} placeholder="Optional region or address" /></Field>
              <Field label="Arrival"><input type="date" value={stop.arrivalDate ?? ''} onChange={(event) => updateStop(index, { arrivalDate: event.target.value || null })} /></Field>
              <Field label="Departure"><input type="date" value={stop.departureDate ?? ''} onChange={(event) => updateStop(index, { departureDate: event.target.value || null })} /></Field>
            </div>
            <button className="button-text button-danger" type="button" disabled={value.stops.length === 1} onClick={() => onChange({ ...value, stops: value.stops.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <button className="button-secondary" type="button" onClick={() => onChange({ ...value, stops: [...value.stops, blankStop()] })}>+ Add destination</button>
      </fieldset>
    </div>
  );
}

function CreateTripDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (trip: Trip) => void }) {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual');
  const [form, setForm] = useState<TripInput>(() => blankTrip());
  const [prompt, setPrompt] = useState('');
  const [draftNotes, setDraftNotes] = useState<Pick<TripDraft, 'assumptions' | 'warnings'>>({ assumptions: [], warnings: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft() {
    setBusy(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ generateTripDraft: TripDraft }, { prompt: string }>(operations.generateDraft, { prompt });
      const draft = data.generateTripDraft;
      setForm(draftToTripInput(draft));
      setDraftNotes({ assumptions: draft.assumptions, warnings: draft.warnings });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function createTrip(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ createTrip: Trip }, { input: TripInput }>(operations.createTrip, { input: form });
      onCreated(data.createTrip);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Create a trip" eyebrow="New plan" onClose={onClose} wide>
      <div className="mode-switch" aria-label="Trip creation method">
        <button className={mode === 'manual' ? 'active' : ''} type="button" aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Start manually</button>
        <button className={mode === 'ai' ? 'active' : ''} type="button" aria-pressed={mode === 'ai'} onClick={() => setMode('ai')}>Draft with TripDock AI</button>
      </div>
      {mode === 'ai' ? (
        <section className="ai-draft-panel">
          <div><p className="section-kicker">Unpersisted draft</p><h3>Describe the trip you have in mind</h3><p>TripDock will structure the essentials. Nothing is saved until you review and create it.</p></div>
          <label htmlFor="ai-draft-prompt">Trip description</label>
          <textarea id="ai-draft-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Include the places, dates, and number of travelers you already know." />
          <button className="button-secondary" type="button" disabled={busy || prompt.trim().length < 10} onClick={() => void generateDraft()}>{busy ? 'Generating…' : 'Generate structured draft'}</button>
          {draftNotes.assumptions.length || draftNotes.warnings.length ? <div className="draft-notes">{draftNotes.assumptions.map((note) => <p key={note}>Assumption: {note}</p>)}{draftNotes.warnings.map((note) => <p key={note}>Check: {note}</p>)}</div> : null}
        </section>
      ) : null}
      <form onSubmit={(event) => void createTrip(event)} aria-busy={busy}>
        <TripFields value={form} onChange={setForm} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create trip'}</button></footer>
      </form>
    </Dialog>
  );
}

function TripEditor({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [input, setInput] = useState(() => ({ name: trip.name, destinationArea: trip.destinationArea, startDate: trip.startDate, endDate: trip.endDate, travelerCount: trip.travelerCount }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const data = await graphqlRequest<{ updateTrip: Trip }, { id: string; expectedRevision: number; input: typeof input }>(operations.updateTrip, { id: trip.id, expectedRevision: trip.revision, input });
      onSaved(data.updateTrip);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title="Edit trip essentials" onClose={onClose} wide>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <div className="form-grid form-grid-two"><Field label="Trip name"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field><Field label="Destination area"><input required value={input.destinationArea} onChange={(e) => setInput({ ...input, destinationArea: e.target.value })} /></Field></div>
        <div className="form-grid form-grid-three"><Field label="Start date"><input required type="date" value={input.startDate} onChange={(e) => setInput({ ...input, startDate: e.target.value })} /></Field><Field label="End date"><input required type="date" min={input.startDate} value={input.endDate} onChange={(e) => setInput({ ...input, endDate: e.target.value })} /></Field><Field label="Travelers"><input required type="number" min="1" max="20" value={input.travelerCount} onChange={(e) => setInput({ ...input, travelerCount: Number(e.target.value) })} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </Dialog>
  );
}

type EntityEditor =
  | { kind: 'trip' }
  | { kind: 'stop'; value?: TripStop }
  | { kind: 'transport'; value?: TransportLeg }
  | { kind: 'stay'; value?: Stay }
  | { kind: 'activity'; value?: Activity }
  | null;

function StopEditor({ trip, stop, onClose, onSaved }: { trip: Trip; stop?: TripStop; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [input, setInput] = useState<TripDraftStop>(() => stop ? { name: stop.name, locationText: stop.locationText, arrivalDate: stop.arrivalDate, departureDate: stop.departureDate } : blankStop());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const variables = stop ? { id: stop.id, expectedRevision: trip.revision, input } : { tripId: trip.id, expectedRevision: trip.revision, input };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stop ? operations.updateStop : operations.addStop, variables);
      onSaved(data[stop ? 'updateTripStop' : 'addTripStop']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={stop ? 'Edit destination' : 'Add destination'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Stop name"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <Field label="Location detail"><input value={input.locationText ?? ''} onChange={(e) => setInput({ ...input, locationText: e.target.value || null })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Arrival"><input type="date" value={input.arrivalDate ?? ''} onChange={(e) => setInput({ ...input, arrivalDate: e.target.value || null })} /></Field><Field label="Departure"><input type="date" value={input.departureDate ?? ''} onChange={(e) => setInput({ ...input, departureDate: e.target.value || null })} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save destination'}</button></footer></form>
    </Dialog>
  );
}

function TransportEditor({ trip, leg, onClose, onSaved }: { trip: Trip; leg?: TransportLeg; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [input, setInput] = useState(() => ({ fromStopId: leg?.fromStopId ?? trip.stops[0]?.id ?? '', toStopId: leg?.toStopId ?? trip.stops[1]?.id ?? trip.stops[0]?.id ?? '', mode: leg?.mode ?? '', title: leg?.title ?? '', details: leg?.details ?? null, departureTime: isoToDateTimeLocal(leg?.departureTime ?? null, leg?.timezone ?? null), arrivalTime: isoToDateTimeLocal(leg?.arrivalTime ?? null, leg?.timezone ?? null), timezone: leg?.timezone ?? null }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const normalized = { ...input, departureTime: dateTimeLocalToIso(input.departureTime, input.timezone), arrivalTime: dateTimeLocalToIso(input.arrivalTime, input.timezone) };
      const variables = leg ? { id: leg.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(leg ? operations.updateTransport : operations.addTransport, variables);
      onSaved(data[leg ? 'updateTransportLeg' : 'addTransportLeg']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={leg ? 'Edit transport' : 'Add transport'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <div className="form-grid form-grid-two"><Field label="From"><select value={input.fromStopId} onChange={(e) => setInput({ ...input, fromStopId: e.target.value })}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field><Field label="To"><select value={input.toStopId} onChange={(e) => setInput({ ...input, toStopId: e.target.value })}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field></div>
        <div className="form-grid form-grid-two"><Field label="Mode"><input required value={input.mode} onChange={(e) => setInput({ ...input, mode: e.target.value })} placeholder="Train, flight, ferry…" /></Field><Field label="Title"><input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></Field></div>
        <Field label="Details"><textarea rows={2} value={input.details ?? ''} onChange={(e) => setInput({ ...input, details: e.target.value || null })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Departure"><input type="datetime-local" value={input.departureTime ?? ''} onChange={(e) => setInput({ ...input, departureTime: e.target.value || null })} /></Field><Field label="Arrival"><input type="datetime-local" value={input.arrivalTime ?? ''} onChange={(e) => setInput({ ...input, arrivalTime: e.target.value || null })} /></Field></div>
        <Field label="IANA timezone" hint="For example Europe/London"><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save transport'}</button></footer></form>
    </Dialog>
  );
}

function StayEditor({ trip, stay, onClose, onSaved }: { trip: Trip; stay?: Stay; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [input, setInput] = useState(() => ({ stopId: stay?.stopId ?? trip.stops[0]?.id ?? '', name: stay?.name ?? '', checkIn: isoToDateTimeLocal(stay?.checkIn ?? null, stay?.timezone ?? null), checkOut: isoToDateTimeLocal(stay?.checkOut ?? null, stay?.timezone ?? null), timezone: stay?.timezone ?? null }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const normalized = { ...input, checkIn: dateTimeLocalToIso(input.checkIn, input.timezone), checkOut: dateTimeLocalToIso(input.checkOut, input.timezone) };
      const variables = stay ? { id: stay.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stay ? operations.updateStay : operations.addStay, variables);
      onSaved(data[stay ? 'updateStay' : 'addStay']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={stay ? 'Edit stay' : 'Add stay'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination"><select value={input.stopId} onChange={(e) => setInput({ ...input, stopId: e.target.value })}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field>
        <Field label="Stay name"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Check-in"><input type="datetime-local" value={input.checkIn ?? ''} onChange={(e) => setInput({ ...input, checkIn: e.target.value || null })} /></Field><Field label="Check-out"><input type="datetime-local" value={input.checkOut ?? ''} onChange={(e) => setInput({ ...input, checkOut: e.target.value || null })} /></Field></div>
        <Field label="IANA timezone"><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save stay'}</button></footer></form>
    </Dialog>
  );
}

function ActivityEditor({ trip, activity, onClose, onSaved }: { trip: Trip; activity?: Activity; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const [input, setInput] = useState(() => ({ stopId: activity?.stopId ?? trip.stops[0]?.id ?? '', title: activity?.title ?? '', status: activity?.status ?? 'IDEA', scheduledAt: isoToDateTimeLocal(activity?.scheduledAt ?? null, activity?.timezone ?? null), timezone: activity?.timezone ?? null }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const normalized = { ...input, scheduledAt: dateTimeLocalToIso(input.scheduledAt, input.timezone) };
      const variables = activity ? { id: activity.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(activity ? operations.updateActivity : operations.addActivity, variables);
      onSaved(data[activity ? 'updateActivity' : 'addActivity']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={activity ? 'Edit activity' : 'Add activity'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination"><select value={input.stopId} onChange={(e) => setInput({ ...input, stopId: e.target.value })}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field>
        <Field label="Activity title"><input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Status"><select value={input.status} onChange={(e) => setInput({ ...input, status: e.target.value as Activity['status'] })}><option value="IDEA">Idea</option><option value="PLANNED">Planned</option><option value="BOOKED">Booked</option><option value="DONE">Done</option></select></Field><Field label="Scheduled time"><input type="datetime-local" value={input.scheduledAt ?? ''} onChange={(e) => setInput({ ...input, scheduledAt: e.target.value || null })} /></Field></div>
        <Field label="IANA timezone"><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save activity'}</button></footer></form>
    </Dialog>
  );
}

function ProposalOperationDetails({ operation, trip }: { operation: ProposalOperation; trip: Trip }) {
  const stopNames = new Map(trip.stops.map((stop) => [stop.id, stop.name]));
  const activityNames = new Map(trip.activities.map((activity) => [activity.id, activity.title]));
  const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
  const display = (key: string, value: unknown) => {
    if (value === null) return 'Not set';
    if (key === 'stopId' && typeof value === 'string') return stopNames.get(value) ?? value;
    if (key === 'activityId' && typeof value === 'string') return activityNames.get(value) ?? value;
    return String(value);
  };
  return <dl className="proposal-payload" aria-label="Exact proposed values">{Object.entries(operation.payload).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{display(key, value)}</dd></div>)}</dl>;
}

function ProposalDialog({ proposal, trip, onClose, onApplied, onDiscarded, onStale }: { proposal: Proposal; trip: Trip; onClose: () => void; onApplied: (trip: Trip) => void; onDiscarded: (proposal: Proposal) => void; onStale: () => void }) {
  const [included, setIncluded] = useState(() => new Set(proposal.operations.filter((operation) => operation.status === 'PENDING').map((operation) => operation.id)));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(proposal.status);
  const [error, setError] = useState<string | null>(proposal.status === 'STALE' ? 'This proposal is out of date because the accepted trip changed.' : null);
  async function apply() {
    setBusy(true); setError(null);
    try {
      const data = await graphqlRequest<{ applyTripProposal: Trip }, { proposalId: string; includedOperationIds: string[] }>(operations.applyProposal, { proposalId: proposal.id, includedOperationIds: [...included] });
      onApplied(data.applyTripProposal);
    } catch (requestError) {
      if (requestError instanceof TripDockGraphQLError && requestError.code === 'STALE_PROPOSAL') {
        setStatus('STALE');
        onStale();
      }
      setError(errorMessage(requestError));
    } finally { setBusy(false); }
  }
  async function discard() {
    setBusy(true); setError(null);
    try {
      const data = await graphqlRequest<{ discardTripProposal: Proposal }, { proposalId: string }>(operations.discardProposal, { proposalId: proposal.id });
      onDiscarded(data.discardTripProposal);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title="Review proposed changes" eyebrow="Human approval required" onClose={onClose} wide>
      <section className="proposal-summary"><div><span className={`proposal-status status-${status.toLowerCase()}`}>{status}</span><h3>{proposal.summary}</h3><p>{proposal.prompt}</p></div><small>Prepared with {proposal.model} from trip revision {proposal.baseTripRevision}. Current revision: {trip.revision}.</small></section>
      <div className="proposal-operations">
        {proposal.operations.map((operation) => { const checked = included.has(operation.id); return <label className={`proposal-operation ${checked ? 'selected' : ''}`} key={operation.id}><input type="checkbox" checked={checked} disabled={status !== 'PENDING' || busy} onChange={() => setIncluded((current) => toggleSelectedOperation(current, operation.id))} /><span><small>{operation.operationType.replaceAll('_', ' ')}</small><strong>{operation.description}</strong><ProposalOperationDetails operation={operation} trip={trip} /></span></label>; })}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer className="dialog-footer dialog-footer-split"><button className="button-text button-danger" type="button" disabled={busy || !['PENDING', 'STALE'].includes(status)} onClick={() => void discard()}>Discard proposal</button><div><button className="button-secondary" type="button" onClick={onClose}>Keep for later</button><button className="button-primary" type="button" disabled={busy || status !== 'PENDING' || included.size === 0} onClick={() => void apply()}>{busy ? 'Working…' : `Apply ${included.size} selected`}</button></div></footer>
    </Dialog>
  );
}

function Section({ title, kicker, action, children }: { title: string; kicker: string; action?: ReactNode; children: ReactNode }) {
  return <section className="detail-section"><header className="section-heading"><div><p className="section-kicker">{kicker}</p><h2>{title}</h2></div>{action}</header>{children}</section>;
}

function TripDetail({ trip, onBack, onChanged, onDeleted, notify }: { trip: Trip; onBack: () => void; onChanged: (trip: Trip) => void; onDeleted: () => void; notify: (notice: Notice) => void }) {
  const [editor, setEditor] = useState<EntityEditor>(null);
  const [proposalPrompt, setProposalPrompt] = useState('');
  const [reviewProposal, setReviewProposal] = useState<Proposal | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const stopNames = useMemo(() => new Map(trip.stops.map((stop) => [stop.id, stop.name])), [trip.stops]);

  async function removeEntity(kind: 'stop' | 'transport' | 'stay' | 'activity', id: string) {
    if (!window.confirm(`Remove this ${kind}? This cannot be undone.`)) return;
    const operation = { stop: operations.removeStop, transport: operations.removeTransport, stay: operations.removeStay, activity: operations.removeActivity }[kind];
    const field = { stop: 'removeTripStop', transport: 'removeTransportLeg', stay: 'removeStay', activity: 'removeActivity' }[kind];
    try {
      const data = await graphqlRequest<Record<string, Trip>, { id: string; expectedRevision: number }>(operation, { id, expectedRevision: trip.revision });
      onChanged(data[field]!);
      notify({ tone: 'success', message: `${kind[0]?.toUpperCase()}${kind.slice(1)} removed.` });
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  async function moveStop(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= trip.stops.length) return;
    const ids = trip.stops.map((stop) => stop.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex]!, ids[index]!];
    try {
      const data = await graphqlRequest<{ reorderTripStops: Trip }, { tripId: string; expectedRevision: number; stopIds: string[] }>(operations.reorderStops, { tripId: trip.id, expectedRevision: trip.revision, stopIds: ids });
      onChanged(data.reorderTripStops);
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  async function prepareProposal(event: FormEvent) {
    event.preventDefault(); setProposalBusy(true); setProposalError(null);
    try {
      const data = await graphqlRequest<{ prepareTripProposal: Proposal }, { tripId: string; prompt: string }>(operations.prepareProposal, { tripId: trip.id, prompt: proposalPrompt });
      const proposal = data.prepareTripProposal;
      onChanged({ ...trip, proposals: [proposal, ...trip.proposals.filter((item) => item.id !== proposal.id)] });
      setReviewProposal(proposal); setProposalPrompt('');
    } catch (requestError) { setProposalError(errorMessage(requestError)); } finally { setProposalBusy(false); }
  }

  async function refreshTrip() {
    try {
      const data = await graphqlRequest<{ trip: Trip | null }, { id: string }>(operations.trip, { id: trip.id });
      if (data.trip) onChanged(data.trip);
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  function recordDiscardedProposal(discarded: Proposal) {
    setReviewProposal(null);
    onChanged({
      ...trip,
      proposals: trip.proposals.map((proposal) => proposal.id === discarded.id ? discarded : proposal),
    });
    notify({ tone: 'success', message: 'Proposal discarded. Accepted trip data was unchanged.' });
  }

  async function deleteTrip() {
    if (!window.confirm(`Delete “${trip.name}” and all of its itinerary data?`)) return;
    try {
      await graphqlRequest<{ deleteTrip: boolean }, { id: string; expectedRevision: number }>(operations.deleteTrip, { id: trip.id, expectedRevision: trip.revision });
      onDeleted();
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  return (
    <main id="main-content" className="detail-page" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← All trips</button>
      <section className="trip-hero"><div><p className="overline">{trip.destinationArea}</p><h1>{trip.name}</h1><p>{formatDateRange(trip.startDate, trip.endDate)} · {trip.travelerCount} {trip.travelerCount === 1 ? 'traveler' : 'travelers'} · revision {trip.revision}</p></div><div className="hero-actions"><button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'trip' })}>Edit trip</button><button className="button-text button-danger" type="button" onClick={() => void deleteTrip()}>Delete</button></div></section>
      <div className="route-ribbon" aria-label={`Route: ${trip.stops.map((stop) => stop.name).join(' to ')}`}>{trip.stops.map((stop, index) => <span key={stop.id}><i aria-hidden="true">{index + 1}</i>{stop.name}</span>)}</div>

      <Section title="Destinations" kicker="Ordered route" action={<button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'stop' })}>+ Add destination</button>}>
        <div className="entity-list">{trip.stops.map((stop, index) => <article className="entity-card stop-card" key={stop.id}><span className="position-badge">{index + 1}</span><div className="entity-copy"><h3>{stop.name}</h3><p>{stop.locationText ?? 'No location detail'} · {stop.arrivalDate ?? 'Arrival open'} → {stop.departureDate ?? 'Departure open'}</p></div><div className="entity-actions"><button className="icon-button" type="button" disabled={index === 0} aria-label={`Move ${stop.name} earlier`} onClick={() => void moveStop(index, -1)}>↑</button><button className="icon-button" type="button" disabled={index === trip.stops.length - 1} aria-label={`Move ${stop.name} later`} onClick={() => void moveStop(index, 1)}>↓</button><button className="button-text" type="button" aria-label={`Edit destination ${stop.name}`} onClick={() => setEditor({ kind: 'stop', value: stop })}>Edit</button><button className="button-text button-danger" type="button" aria-label={`Remove destination ${stop.name}`} disabled={trip.stops.length === 1} onClick={() => void removeEntity('stop', stop.id)}>Remove</button></div></article>)}</div>
      </Section>

      <Section title="Transport" kicker="Between destinations" action={<button className="button-secondary" type="button" disabled={trip.stops.length < 2} onClick={() => setEditor({ kind: 'transport' })}>+ Add transport</button>}>
        {trip.transportLegs.length ? <div className="entity-list">{trip.transportLegs.map((leg) => <article className="entity-card" key={leg.id}><div className="entity-icon" aria-hidden="true">↗</div><div className="entity-copy"><span className="entity-label">{leg.mode}</span><h3>{leg.title}</h3><p>{stopNames.get(leg.fromStopId)} → {stopNames.get(leg.toStopId)}</p><small>{formatDateTime(leg.departureTime, leg.timezone)}{leg.details ? ` · ${leg.details}` : ''}</small></div><div className="entity-actions"><button className="button-text" type="button" aria-label={`Edit transport ${leg.title}`} onClick={() => setEditor({ kind: 'transport', value: leg })}>Edit</button><button className="button-text button-danger" type="button" aria-label={`Remove transport ${leg.title}`} onClick={() => void removeEntity('transport', leg.id)}>Remove</button></div></article>)}</div> : <p className="section-empty">No transport legs yet. Add one when you know how you’ll move between stops.</p>}
      </Section>

      <div className="detail-columns">
        <Section title="Stays" kicker="Accommodation" action={<button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'stay' })}>+ Add stay</button>}>
          {trip.stays.length ? <div className="entity-list compact-list">{trip.stays.map((stay) => <article className="entity-card" key={stay.id}><div className="entity-copy"><span className="entity-label">{stopNames.get(stay.stopId)}</span><h3>{stay.name}</h3><small>{formatDateTime(stay.checkIn, stay.timezone)} → {formatDateTime(stay.checkOut, stay.timezone)}</small></div><div className="entity-actions"><button className="button-text" type="button" aria-label={`Edit stay ${stay.name}`} onClick={() => setEditor({ kind: 'stay', value: stay })}>Edit</button><button className="button-text button-danger" type="button" aria-label={`Remove stay ${stay.name}`} onClick={() => void removeEntity('stay', stay.id)}>Remove</button></div></article>)}</div> : <p className="section-empty">No stays added.</p>}
        </Section>
        <Section title="Activities" kicker="Ideas and plans" action={<button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'activity' })}>+ Add activity</button>}>
          {trip.activities.length ? <div className="entity-list compact-list">{trip.activities.map((activity) => <article className="entity-card" key={activity.id}><div className="entity-copy"><span className={`entity-label activity-${activity.status.toLowerCase()}`}>{activity.status} · {stopNames.get(activity.stopId)}</span><h3>{activity.title}</h3><small>{formatDateTime(activity.scheduledAt, activity.timezone)}</small></div><div className="entity-actions"><button className="button-text" type="button" aria-label={`Edit activity ${activity.title}`} onClick={() => setEditor({ kind: 'activity', value: activity })}>Edit</button><button className="button-text button-danger" type="button" aria-label={`Remove activity ${activity.title}`} onClick={() => void removeEntity('activity', activity.id)}>Remove</button></div></article>)}</div> : <p className="section-empty">No activities added.</p>}
        </Section>
      </div>

      <Section title="Ask TripDock to adjust this trip" kicker="AI proposals">
        <form className="proposal-composer" onSubmit={(event) => void prepareProposal(event)} aria-busy={proposalBusy}><Logo compact /><div><label htmlFor="proposal-prompt">Describe a change</label><textarea id="proposal-prompt" rows={3} value={proposalPrompt} onChange={(event) => setProposalPrompt(event.target.value)} placeholder="Ask for a trip-essential or activity change. You’ll review every operation before anything is applied." /></div><button className="button-primary" type="submit" disabled={proposalBusy || proposalPrompt.trim().length < 3}>{proposalBusy ? 'Preparing…' : 'Prepare proposal'}</button></form>
        {proposalError ? <p className="form-error" role="alert">{proposalError}</p> : null}
        {trip.proposals.filter((proposal) => ['PENDING', 'STALE'].includes(proposal.status)).length ? <div className="saved-proposals"><h3>Saved for review</h3>{trip.proposals.filter((proposal) => ['PENDING', 'STALE'].includes(proposal.status)).map((proposal) => <button type="button" key={proposal.id} onClick={() => setReviewProposal(proposal)}><span><strong>{proposal.summary}</strong><small>{proposal.status} · {proposal.operations.length} operations</small></span><span aria-hidden="true">Review →</span></button>)}</div> : null}
      </Section>

      {editor?.kind === 'trip' ? <TripEditor trip={trip} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stop' ? <StopEditor trip={trip} stop={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'transport' ? <TransportEditor trip={trip} leg={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stay' ? <StayEditor trip={trip} stay={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'activity' ? <ActivityEditor trip={trip} activity={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {reviewProposal ? <ProposalDialog proposal={reviewProposal} trip={trip} onClose={() => setReviewProposal(null)} onApplied={(updated) => { setReviewProposal(null); onChanged(updated); notify({ tone: 'success', message: 'Selected proposal operations were applied.' }); }} onDiscarded={recordDiscardedProposal} onStale={() => void refreshTrip()} /> : null}
    </main>
  );
}

function TripsOverview({ trips, onCreate, onOpen }: { trips: Trip[]; onCreate: () => void; onOpen: (id: string) => void }) {
  return (
    <main id="main-content" className="page-wrap" tabIndex={-1}>
      <section className="page-heading"><div><p className="overline">Your travel plans</p><h1>Your trips</h1><p className="page-intro">Real plans, in the order you’ll need them.</p></div><button className="button-primary" type="button" onClick={onCreate}>+ New trip</button></section>
      {trips.length === 0 ? (
        <section className="empty-state"><Logo /><span className="empty-mark" aria-hidden="true">01</span><h2>Your first trip starts here</h2><p>Create the essentials yourself or ask TripDock AI for a structured draft. Your accepted plan will be stored in PostgreSQL.</p><button className="button-primary" type="button" onClick={onCreate}>Create your first trip</button></section>
      ) : (
        <section className="trips-grid" aria-label="Trips">{trips.map((trip) => <article className="trip-card-real" key={trip.id}><div className="trip-card-art" aria-hidden="true"><span>{trip.stops[0]?.name.slice(0, 2).toUpperCase() ?? 'TD'}</span><small>{trip.destinationArea}</small></div><div className="trip-card-content"><div><p className="trip-eyebrow">{formatDateRange(trip.startDate, trip.endDate)}</p><h2>{trip.name}</h2><p>{trip.travelerCount} {trip.travelerCount === 1 ? 'traveler' : 'travelers'} · {trip.stops.length} {trip.stops.length === 1 ? 'destination' : 'destinations'}</p></div><div className="route-ribbon route-ribbon-card">{trip.stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i>{stop.name}</span>)}</div><div className="trip-card-stats"><span>{trip.transportLegs.length} transport</span><span>{trip.stays.length} stays</span><span>{trip.activities.length} activities</span></div><button className="button-text trip-open" type="button" onClick={() => onOpen(trip.id)}>Open trip <span aria-hidden="true">→</span></button></div></article>)}</section>
      )}
    </main>
  );
}

export function TripDockApp() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const controller = new AbortController();
    graphqlRequest<{ trips: Trip[] }, Record<string, never>>(operations.trips, {}, controller.signal).then(
      (data) => setState({ kind: 'ready', trips: data.trips }),
      (error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setState({ kind: 'error', message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    window.scrollTo({ top: 0, behavior: 'auto' });
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTripId, state.kind]);

  function replaceTrip(trip: Trip) {
    setState((current) => {
      if (current.kind !== 'ready') return current;
      const exists = current.trips.some((item) => item.id === trip.id);
      return { kind: 'ready', trips: exists ? current.trips.map((item) => item.id === trip.id ? trip : item) : [trip, ...current.trips] };
    });
  }

  function retry() {
    setState({ kind: 'loading' });
    graphqlRequest<{ trips: Trip[] }, Record<string, never>>(operations.trips, {}).then(
      (data) => setState({ kind: 'ready', trips: data.trips }),
      (error) => setState({ kind: 'error', message: errorMessage(error) }),
    );
  }

  const selectedTrip = state.kind === 'ready' ? state.trips.find((trip) => trip.id === selectedTripId) : undefined;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header"><div className="header-inner"><button className="logo-button" type="button" onClick={() => setSelectedTripId(null)} aria-label="TripDock trips home"><Logo /></button><nav aria-label="Primary"><button type="button" className="nav-link nav-link-active" onClick={() => setSelectedTripId(null)}>Trips</button></nav><span className="local-badge">Local workspace</span></div></header>
      {state.kind === 'loading' ? <main id="main-content" className="state-page" aria-busy="true"><Logo /><div className="loader" aria-hidden="true" /><h1>Opening your trips</h1><p>Connecting to the local TripDock database…</p></main> : null}
      {state.kind === 'error' ? <main id="main-content" className="state-page error-state"><Logo /><h1>TripDock could not open your data</h1><p role="alert">{state.message}</p><button className="button-primary" type="button" onClick={retry}>Retry connection</button></main> : null}
      {state.kind === 'ready' && !selectedTrip ? <TripsOverview trips={state.trips} onCreate={() => setCreateOpen(true)} onOpen={setSelectedTripId} /> : null}
      {state.kind === 'ready' && selectedTrip ? <TripDetail trip={selectedTrip} onBack={() => setSelectedTripId(null)} onChanged={replaceTrip} onDeleted={() => { setState({ kind: 'ready', trips: state.trips.filter((trip) => trip.id !== selectedTrip.id) }); setSelectedTripId(null); setNotice({ tone: 'success', message: 'Trip deleted.' }); }} notify={setNotice} /> : null}
      <footer className="site-footer"><p>TripDock · PostgreSQL keeps the plan; you approve every AI change.</p></footer>
      {createOpen ? <CreateTripDialog onClose={() => setCreateOpen(false)} onCreated={(trip) => { setCreateOpen(false); replaceTrip(trip); setSelectedTripId(trip.id); setNotice({ tone: 'success', message: 'Trip created and saved to PostgreSQL.' }); }} /> : null}
      {notice ? <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}
    </div>
  );
}

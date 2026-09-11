'use client';
import { mergeFollowUp, valueAtPath } from './merge-follow-up';
import { QuestionStage } from './question-stage';

import { useRef, useState, type FormEvent } from 'react';
import { deviceTimezone } from '../../../lib/device-timezone';
import { errorMessage } from '../../../lib/error-message';
import { graphqlRequest } from '../../../lib/graphql/request';
import { localIsoDate } from '../../../lib/trips/dates';
import { remapTripDraftPathAfterStopRemoval } from '../../../lib/trips/draft-alignment';
import { applyClarificationUpdates, buildTripFollowUpPrompt, clarificationPathsConfirmedByEdit, confirmedTripDraftFieldState, draftToTripInput, isTripMinimumViable, tripDraftFieldStateMap, tripStopsForCreation } from '../../../lib/trips/drafts';
import { operations } from '../../../lib/trips/operations';
import { destinationAreaFromStops } from '../../../lib/trips/stops';
import { type GenerateTripDraftInput, type Trip, type TripClarificationQuestion, type TripDraft, type TripDraftFieldState, type TripInput } from '../../../lib/trips/types';
import { blankTrip } from '../trip-defaults';
import { TripFields } from '../trip-fields';
import { DraftReviewSummary } from './draft-review-summary';

export function CreateTripForm({
  initialDraft,
  sourcePrompt,
  inactive = false,
  onClose,
  onCreated,
}: {
  initialDraft?: TripDraft;
  sourcePrompt?: string;
  inactive?: boolean;
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}) {
  const [form, setForm] = useState<TripInput>(() =>
    initialDraft ? draftToTripInput(initialDraft) : blankTrip(),
  );
  const [fieldStates, setFieldStates] = useState<Map<string, TripDraftFieldState>>(() =>
    tripDraftFieldStateMap(initialDraft?.fieldStates ?? []),
  );
  const [questions, setQuestions] = useState<TripClarificationQuestion[]>(
    () => initialDraft?.questions ?? [],
  );
  const [stage, setStage] = useState<'clarify' | 'review' | 'edit' | 'refine'>(() =>
    initialDraft?.questions.some((question) => question.blocking)
      ? 'clarify'
      : initialDraft
        ? 'review'
        : 'edit',
  );
  const [notes, setNotes] = useState(() => ({
    assumptions: initialDraft?.assumptions ?? [],
    warnings: initialDraft?.warnings ?? [],
  }));
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [followUp, setFollowUp] = useState('');
  const [followUpVoiceUsed, setFollowUpVoiceUsed] = useState(false);
  const [followUpHistory, setFollowUpHistory] = useState<string[]>([]);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpDictating, setFollowUpDictating] = useState(false);
  const formLocale = initialDraft?.locale ??
    (typeof navigator === 'undefined' ? 'en-GB' : navigator.language || 'en-GB');
  const protectedPaths = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minimumViable = isTripMinimumViable(form, fieldStates, questions);
  const blockingQuestions = questions.filter((question) => question.blocking);
  const optionalQuestions = questions.filter((question) => !question.blocking && !question.fieldPaths.every((path) => path === 'trip.travelerCount'));
  const omittedStops = form.stops.filter((stop) => {
    const hasVisibleIdea = Boolean(stop.name.trim() || stop.locationText?.trim());
    const isResolvedCity = Boolean(
      stop.name.trim() &&
      stop.localityKind === 'CITY' &&
      stop.cityResolution === 'RESOLVED',
    );
    return hasVisibleIdea && !isResolvedCity;
  });

  function protectPaths(paths: readonly string[]): Set<string> {
    const nextProtected = new Set(protectedPaths.current);
    for (const path of paths) nextProtected.add(path);
    protectedPaths.current = nextProtected;
    return nextProtected;
  }

  function confirmPaths(
    paths: readonly string[],
    dismissMatchingQuestions = true,
    input: TripInput = form,
    explicitValues: ReadonlyMap<string, string | number | null> = new Map(),
  ) {
    const nextProtected = protectPaths(paths);
    setFieldStates((current) => {
      const next = new Map(current);
      for (const path of paths) {
        const previous = next.get(path);
        next.set(path, confirmedTripDraftFieldState(
          path,
          explicitValues.has(path) ? explicitValues.get(path) : valueAtPath(input, path),
          previous,
        ));
      }
      return next;
    });
    if (dismissMatchingQuestions) {
      setQuestions((current) =>
        current.filter((item) => !item.fieldPaths.every((path) => nextProtected.has(path))),
      );
    }
  }

  function markFieldEdited(
    path: string,
    value: string | number | null,
    nextInput: TripInput,
  ) {
    const paths = clarificationPathsConfirmedByEdit(path, nextInput, questions);
    confirmPaths(paths, true, nextInput, new Map([[path, value]]));
  }

  function markFieldDerived(path: string, value: string | number | null) {
    if (protectedPaths.current.has(path)) return;
    setFieldStates((current) => {
      const next = new Map(current);
      const pastState = confirmedTripDraftFieldState(path, value, next.get(path));
      next.set(path, pastState.status === 'PAST'
        ? pastState
        : {
            path,
            status: value === null || value === '' ? 'MISSING' : 'INTERPRETED',
            evidence: null,
            message: value === null || value === '' ? null : 'Linked to another date you changed.',
            blocking: false,
          });
      return next;
    });
  }

  function handleStopRemoved(index: number) {
    const remap = (path: string) => remapTripDraftPathAfterStopRemoval(path, index);
    protectedPaths.current = new Set(
      [...protectedPaths.current]
        .map(remap)
        .filter((path): path is string => Boolean(path)),
    );
    setFieldStates((current) => new Map(
      [...current.entries()].flatMap(([path, state]) => {
        const nextPath = remap(path);
        return nextPath ? [[nextPath, { ...state, path: nextPath }] as const] : [];
      }),
    ));
    setQuestions((current) => current.flatMap((item) => {
      const fieldPaths = item.fieldPaths
        .map(remap)
        .filter((path): path is string => Boolean(path));
      if (!fieldPaths.length) return [];
      const options = item.options.flatMap((option) => {
        const updates = option.updates.flatMap((update) => {
          const path = remap(update.path);
          return path ? [{ ...update, path }] : [];
        });
        return updates.length ? [{ ...option, updates }] : [];
      });
      return [{ ...item, fieldPaths, options }];
    }));
    setSelectedOptions({});
  }

  function applySelectedAnswers() {
    let next = form;
    const answeredQuestionIds = new Set<string>();
    const confirmedPaths = new Set<string>();
    for (const item of questions) {
      const optionId = selectedOptions[item.id];
      const option = item.options.find((candidate) => candidate.id === optionId);
      if (!option) continue;
      next = applyClarificationUpdates(next, option.updates);
      answeredQuestionIds.add(item.id);
      for (const path of [...item.fieldPaths, ...option.updates.map((update) => update.path)]) {
        confirmedPaths.add(path);
      }
    }
    if (!answeredQuestionIds.size) return;
    setForm(next);
    const remainingQuestions = questions.filter((item) => !answeredQuestionIds.has(item.id));
    setQuestions(remainingQuestions);
    setSelectedOptions({});
    confirmPaths([...confirmedPaths], false, next);
    setStage(remainingQuestions.some((item) => item.blocking) ? 'clarify' : 'review');
  }

  async function submitFollowUp() {
    if (!followUp.trim() || followUpBusy || followUpDictating) return;
    const answer = followUp.trim();
    setFollowUpBusy(true);
    setError(null);
    try {
      const messageReferenceDate = localIsoDate();
      const input: GenerateTripDraftInput = {
        prompt: buildTripFollowUpPrompt(
          sourcePrompt ?? '',
          form,
          questions,
          answer,
          protectedPaths.current,
          followUpHistory,
          messageReferenceDate,
          initialDraft?.referenceDate,
        ),
        locale: initialDraft?.locale ?? navigator.language ?? 'en-GB',
        timeZone: initialDraft?.timeZone ?? deviceTimezone() ?? 'UTC',
        referenceDate: messageReferenceDate,
      };
      const data = await graphqlRequest<
        { generateTripDraft: TripDraft },
        { input: GenerateTripDraftInput }
      >(operations.generateDraft, { input });
      const next = mergeFollowUp({ form, fieldStates, questions, protectedPaths: protectedPaths.current, draft: data.generateTripDraft, answer, messageReferenceDate });
      protectedPaths.current = next.protectedPaths;
      setForm(next.form);
      setFieldStates(next.fieldStates);
      setQuestions(next.questions);
      setNotes(next.notes);
      setFollowUpHistory((current) => [...current, `${messageReferenceDate}: ${answer}`].slice(-8));
      setFollowUp('');
      setSelectedOptions({});
      setStage(next.questions.some((item) => item.blocking) ? 'clarify' : 'review');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function createTrip(event: FormEvent) {
    event.preventDefault();
    const resolvedStops = tripStopsForCreation(form, fieldStates);
    if (!minimumViable || !resolvedStops.length) {
      setError('Confirm at least one city and provide valid start and end dates first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const firstCity = resolvedStops[0]!.name.trim();
      const destinationArea = destinationAreaFromStops({
        ...form,
        destinationArea: fieldStates.get('trip.destinationArea')?.status === 'SUGGESTED'
          ? ''
          : form.destinationArea,
        stops: resolvedStops,
      });
      const input = {
        ...form,
        name: !form.name.trim() || fieldStates.get('trip.name')?.status === 'SUGGESTED'
          ? `Trip to ${destinationArea || firstCity}`.slice(0, 160)
          : form.name.trim(),
        destinationArea,
        stops: resolvedStops,
      };
      const data = await graphqlRequest<{ createTrip: Trip }, { input: typeof input }>(
        operations.createTrip,
        { input },
      );
      onCreated(data.createTrip);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }


  return (
    <section className="inline-trip-form">
      <header className="dialog-header"><div><p className="section-kicker">Make room for your next adventure</p><h2>{stage === 'clarify' ? 'A few details first' : stage === 'refine' ? 'Ask TripDock' : stage === 'edit' ? (initialDraft ? 'Trip details' : 'Create a trip') : 'Review your trip'}</h2></div></header>
      {sourcePrompt ? <details className="creation-source"><summary>Your original idea</summary><p>{sourcePrompt}</p></details> : null}
      {stage === 'clarify' || stage === 'refine'
        ? <QuestionStage visibleQuestions={stage === 'clarify' ? blockingQuestions : optionalQuestions} blocking={stage === 'clarify'} followUpBusy={followUpBusy} selectedOptions={selectedOptions} setSelectedOptions={setSelectedOptions} applySelectedAnswers={applySelectedAnswers} followUp={followUp} sourcePrompt={sourcePrompt} setFollowUp={setFollowUp} setFollowUpDictating={setFollowUpDictating} setFollowUpVoiceUsed={setFollowUpVoiceUsed} inactive={inactive} submitFollowUp={submitFollowUp} followUpDictating={followUpDictating} followUpVoiceUsed={followUpVoiceUsed} error={error} onClose={onClose} onBack={() => { setSelectedOptions({}); setStage('review'); }} />
        : stage === 'edit'
            ? (
              <form className="creation-edit-stage" aria-busy={busy} onSubmit={(event) => { if (initialDraft) { event.preventDefault(); setStage('review'); } else { void createTrip(event); } }}>
                <TripFields value={form} onChange={setForm} fieldStates={fieldStates} onFieldEdited={markFieldEdited} onFieldProtected={(path) => protectPaths([path])} onFieldConfirmed={(path) => confirmPaths([path])} onFieldDerived={markFieldDerived} onStopRemoved={handleStopRemoved} locale={formLocale} disabled={followUpBusy || busy} />
                {omittedStops.length ? <p className="draft-omission-note" role="status">If you create now, {omittedStops.length} unresolved {omittedStops.length === 1 ? 'destination idea' : 'destination ideas'} will stay out of the saved trip. Confirm {omittedStops.length === 1 ? 'it' : 'them'} to include {omittedStops.length === 1 ? 'it' : 'them'}.</p> : null}
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><div className="create-readiness-action">{!initialDraft && !minimumViable ? <small>Needs a confirmed city and valid dates</small> : null}<button className="button-primary" type="submit" disabled={busy || followUpBusy || (!initialDraft && !minimumViable)}>{initialDraft ? 'Review trip' : busy ? 'Saving…' : 'Create trip'}</button></div></footer>
              </form>
            )
            : (
            <form onSubmit={(event) => void createTrip(event)} aria-busy={busy}>
              {initialDraft ? <DraftReviewSummary form={form} fieldStates={fieldStates} locale={formLocale} /> : null}
              {(notes.assumptions.length || notes.warnings.length) ? <details className="draft-notes"><summary>Interpretation notes ({notes.assumptions.length + notes.warnings.length})</summary><div>{notes.assumptions.map((note) => <p key={note}><span aria-hidden="true">≈</span> {note}</p>)}{notes.warnings.map((note) => <p key={note}><span aria-hidden="true">!</span> {note}</p>)}</div></details> : null}
              <div className="draft-review-prompt">
                <p className="section-kicker">Before you create it</p>
                <h3>Make any final adjustments</h3>
              </div>
              <div className="draft-review-actions">
                <button type="button" onClick={() => setStage('edit')}><span className="draft-review-action-icon" aria-hidden="true">✎</span><span><strong>Update details</strong><small>Open the form and adjust any field.</small></span></button>
                <button type="button" onClick={() => { setSelectedOptions({}); setStage('refine'); }}><span className="draft-review-action-icon" aria-hidden="true">✦</span><span><strong>Ask TripDock</strong><small>{optionalQuestions.length ? `${optionalQuestions.length} suggested ${optionalQuestions.length === 1 ? 'question' : 'questions'}, or describe another adjustment.` : 'Describe the adjustment you want in your own words.'}</small></span></button>
              </div>
              {omittedStops.length ? <p className="draft-omission-note" role="status">If you create now, {omittedStops.length} unresolved {omittedStops.length === 1 ? 'destination idea' : 'destination ideas'} will stay out of the saved trip. Confirm {omittedStops.length === 1 ? 'it' : 'them'} to include {omittedStops.length === 1 ? 'it' : 'them'}.</p> : null}
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><div className="create-readiness-action">{!minimumViable ? <small>Needs a confirmed city and valid dates</small> : null}<button className="button-primary" type="submit" disabled={busy || followUpBusy || !minimumViable}>{busy ? 'Saving…' : 'Create trip'}</button></div></footer>
            </form>
            )}
    </section>
  );
}

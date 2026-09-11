import { alignIncomingTripDraftStops, remapCurrentTripDraftPathToIncoming } from '../../../lib/trips/draft-alignment.ts';
import { confirmedTripDraftFieldState, explicitTripDraftPathsFromFollowUp, mergeTripDraft, mergeUnansweredClarificationQuestions, protectedPathsAfterFollowUp, tripDraftFieldStateMap } from '../../../lib/trips/drafts.ts';
import { type TripClarificationQuestion, type TripDraft, type TripDraftFieldState, type TripDraftStop, type TripInput } from '../../../lib/trips/types.ts';


export function valueAtPath(input: TripInput, path: string): unknown {
    const tripMatch = /^trip\.(name|destinationArea|startDate|endDate|travelerCount)$/.exec(path);
    if (tripMatch) {
      return input[tripMatch[1] as keyof Pick<TripInput, 'name' | 'destinationArea' | 'startDate' | 'endDate' | 'travelerCount'>];
    }
    const stopMatch = /^stops\.(\d+)\.(name|locationText|arrivalDate|departureDate|localityKind|cityResolution)$/.exec(path);
    if (!stopMatch) return undefined;
    return input.stops[Number(stopMatch[1])]?.[stopMatch[2] as keyof TripDraftStop];
  }


/** Pure reconciliation of a server draft with edits made before the request. */
export function mergeFollowUp({ form, fieldStates, questions, protectedPaths, draft, answer, messageReferenceDate }: {
  form: TripInput; fieldStates: ReadonlyMap<string, TripDraftFieldState>;
  questions: TripClarificationQuestion[]; protectedPaths: ReadonlySet<string>;
  draft: TripDraft; answer: string; messageReferenceDate: string;
}) {
      const incoming = alignIncomingTripDraftStops(form, draft, answer, questions);
      const remapCurrentPath = (path: string) =>
        remapCurrentTripDraftPathToIncoming(form, incoming, path, answer);
      const alignedFieldStates = new Map(
        [...fieldStates.entries()].flatMap(([path, state]) => {
          const alignedPath = remapCurrentPath(path);
          return alignedPath
            ? [[alignedPath, { ...state, path: alignedPath }] as const]
            : [];
        }),
      );
      const alignedProtectedPaths = new Set(
        [...protectedPaths]
          .map(remapCurrentPath)
          .filter((path): path is string => Boolean(path)),
      );
      const alignedQuestions = questions.map((question) => ({
        ...question,
        fieldPaths: question.fieldPaths
          .map(remapCurrentPath)
          .filter((path): path is string => Boolean(path)),
        options: question.options.map((option) => ({
          ...option,
          updates: option.updates.flatMap((update) => {
            const path = remapCurrentPath(update.path);
            return path ? [{ ...update, path }] : [];
          }),
        })),
      }));
      const answerPaths = explicitTripDraftPathsFromFollowUp(incoming, answer, alignedQuestions);
      const retainedQuestions = alignedQuestions.filter((question) =>
        !question.fieldPaths.some((path) => answerPaths.has(path)));
      const retainedQuestionPaths = new Set(
        retainedQuestions.flatMap((question) => question.fieldPaths),
      );
      const stablePaths = new Set(
        [...alignedFieldStates.entries()]
          .filter(([, state]) =>
            !state.blocking && ['EXPLICIT', 'INTERPRETED', 'CONFIRMED', 'PAST'].includes(state.status),
          )
          .map(([path]) => path),
      );
      form.stops.forEach((stop, index) => {
        if (stop.localityKind === 'CITY' && stop.cityResolution === 'RESOLVED') {
          for (const field of ['name', 'locationText', 'localityKind', 'cityResolution'] as const) {
            const path = remapCurrentPath(`stops.${index}.${field}`);
            if (path) stablePaths.add(path);
          }
        }
      });
      const mergeProtected = protectedPathsAfterFollowUp(
        new Set([...stablePaths, ...alignedProtectedPaths, ...retainedQuestionPaths]),
        incoming,
        answer,
        alignedQuestions,
      );
      const retainedUserProtection = protectedPathsAfterFollowUp(
        alignedProtectedPaths,
        incoming,
        answer,
        alignedQuestions,
      );
      const nextProtected = new Set([...retainedUserProtection, ...answerPaths]);
      const mergedForm = mergeTripDraft(form, incoming, mergeProtected);
      const nextFieldStates = (() => {
        const next = tripDraftFieldStateMap(incoming.fieldStates);
        for (const path of mergeProtected) {
          const previous = alignedFieldStates.get(path);
          if (previous && !answerPaths.has(path)) next.set(path, previous);
        }
        for (const path of nextProtected) {
          const previous = next.get(path);
          next.set(path, confirmedTripDraftFieldState(
            path,
            valueAtPath(mergedForm, path),
            previous,
            messageReferenceDate,
          ));
        }
        return next;
      })();
      const nextQuestions = mergeUnansweredClarificationQuestions(
        alignedQuestions,
        incoming.questions,
        answerPaths,
      );
  return { form: mergedForm, fieldStates: nextFieldStates, questions: nextQuestions, protectedPaths: nextProtected, notes: { assumptions: incoming.assumptions, warnings: incoming.warnings } };
}

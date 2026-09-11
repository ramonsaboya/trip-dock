import { z } from 'zod';
import { addDays, calendarDate, calendarIntentParts, dateKey, daysBetween, localizedDate, partsFromIso, resolveCalendarIntentInYear, resolveCalendarIntentWithinRange, resolveDateIntent, resolveNextWeekend, type DateResolution } from './calendar.js';
import { tripCreationDraftSchema, tripCreationRequestSchema, tripDraftFieldStatusSchema, type DateIntent, type DestinationIntent, type TripClarificationQuestion, type TripCreationDraft, type TripCreationRequest, type TripDraftFieldState, type TripIntentExtraction } from './schemas.js';

import { containsWholePhrase, destinationCityMatchesSource, destinationEvidenceIsStandalone, destinationSourceNeedsClarification, durationFromEvidence, evidenceAppearsInPrompt, evidenceHasAmbiguousPromptContext, explicitTripNameHasNamingCue, isCanonicalMissingDateIntent, normalizedEvidence, recognizedCityStateNames, recognizedCountryNames, recognizedMonthNames, scalarEvidenceIsAmbiguous, travelerCountFromEvidence, travelerCountStatusFromEvidence, verifiedDateIntent, VerifiedStayDuration, verifiedStayDuration } from './evidence.js';

function fitStayNightsToTrip(
  durations: readonly VerifiedStayDuration[],
  tripNights: number,
): { nights: number[]; usedFlexibleDays: boolean } | null {
  if (tripNights < 0 || !durations.length) return null;
  const ranges = durations.map((duration, index) => {
    if (duration.unit === 'NIGHTS') {
      return { index, requested: duration.value, minimum: duration.value, maximum: duration.value };
    }
    if (duration.unit === 'WEEKS') {
      return {
        index,
        requested: duration.value * 7,
        minimum: Math.max(0, duration.value * 7 - 1),
        maximum: duration.value * 7,
      };
    }
    if (duration.unit === 'FULL_DAYS') {
      return {
        index,
        requested: duration.value,
        minimum: duration.value,
        maximum: duration.value + 1,
      };
    }
    return {
      index,
      requested: duration.value,
      minimum: Math.max(0, duration.value - 1),
      maximum: duration.value,
    };
  });
  const minimum = ranges.reduce((total, range) => total + range.minimum, 0);
  const maximum = ranges.reduce((total, range) => total + range.maximum, 0);
  if (tripNights < minimum || tripNights > maximum) return null;

  const nights = ranges.map((range) => range.minimum);
  let remaining = tripNights - minimum;
  const flexible = ranges
    .filter((range) => range.maximum > range.minimum)
    .sort((left, right) => right.requested - left.requested || left.index - right.index);
  for (const range of flexible) {
    if (!remaining) break;
    const increment = Math.min(range.maximum - range.minimum, remaining);
    nights[range.index] = nights[range.index]! + increment;
    remaining -= increment;
  }
  return remaining === 0
    ? {
      nights,
      usedFlexibleDays: durations.some((duration) => duration.unit !== 'NIGHTS'),
    }
    : null;
}

function fieldState(
  path: string,
  status: z.infer<typeof tripDraftFieldStatusSchema>,
  options: { evidence?: string | null; message?: string | null; blocking?: boolean } = {},
): TripDraftFieldState {
  return {
    path,
    status,
    evidence: options.evidence ?? null,
    message: options.message ?? null,
    blocking: options.blocking ?? false,
  };
}

function question(
  id: string,
  fieldPaths: string[],
  prompt: string,
  options: TripClarificationQuestion['options'] = [],
  blocking = true,
): TripClarificationQuestion {
  return { id, fieldPaths, prompt, options, allowFreeText: true, blocking };
}

function safeDraftId(index: number): string {
  return `destination-${index + 1}`;
}

function stopDateState(
  path: string,
  intent: DateIntent,
  request: TripCreationRequest,
): { value: string | null; state: TripDraftFieldState } {
  const resolved = resolveDateIntent(intent, request);
  return {
    value: resolved.value,
    state: fieldState(path, resolved.status, {
      evidence: intent.sourceText,
      message: resolved.message,
      blocking: false,
    }),
  };
}

function dateQuestionPrompt(label: 'start' | 'end', resolution: DateResolution): string {
  if (resolution.status === 'INVALID') return `What is the correct trip ${label} date?`;
  if (resolution.status === 'NEEDS_ATTENTION') return `What specific day should the trip ${label}?`;
  return `When should the trip ${label}?`;
}

export function buildTripCreationDraft(
  extraction: TripIntentExtraction,
  requestInput: TripCreationRequest,
): TripCreationDraft {
  const request = tripCreationRequestSchema.parse(requestInput);
  const fields: TripDraftFieldState[] = [];
  const questions: TripClarificationQuestion[] = [];
  const assumptions = [...extraction.assumptions];
  const warnings = [...extraction.warnings];
  const startIntent = verifiedDateIntent(extraction.startDate, request, 'start');
  const endIntent = verifiedDateIntent(extraction.endDate, request, 'end');
  let startDateEvidence = startIntent.sourceText;
  let endDateEvidence = endIntent.sourceText;
  const durationIsAmbiguous = scalarEvidenceIsAmbiguous(extraction.duration.evidence) ||
    evidenceHasAmbiguousPromptContext(extraction.duration.evidence, request.prompt);
  const evidencedDuration = evidenceAppearsInPrompt(extraction.duration.evidence, request.prompt) &&
    !durationIsAmbiguous
    ? durationFromEvidence(extraction.duration.evidence)
    : null;
  const durationValue = evidencedDuration &&
    evidencedDuration.value === extraction.duration.value &&
    evidencedDuration.unit === extraction.duration.unit
    ? evidencedDuration.value
    : null;
  if (extraction.duration.value && !durationValue) {
    warnings.push(durationIsAmbiguous
      ? 'The trip duration has alternatives or uncertainty and was not used to calculate dates.'
      : 'The stated duration could not be verified from its source wording and was not used to calculate dates.');
  }
  const durationOffset = durationValue
    ? evidencedDuration!.unit === 'NIGHTS'
      ? durationValue
      : evidencedDuration!.unit === 'FULL_DAYS'
        ? durationValue + 1
        : evidencedDuration!.unit === 'WEEKS' ? durationValue * 7 - 1 : durationValue - 1
    : null;

  const destinationLooksCountryOnly = (destination: DestinationIntent) => {
    const name = normalizedEvidence(destination.city ?? destination.sourceText ?? '');
    return recognizedCountryNames(request.locale).has(name) &&
      !recognizedCityStateNames(request.locale).has(name);
  };
  const hasSpecificCityIntent = extraction.destinations.some((destination) =>
    destination.localityKind === 'CITY' &&
    Boolean(destination.city) &&
    !destinationLooksCountryOnly(destination),
  );
  const stopIntents = extraction.destinations.filter((destination) =>
    !hasSpecificCityIntent ||
    !['COUNTRY', 'REGION', 'PREFERENCE'].includes(destination.localityKind) &&
    !destinationLooksCountryOnly(destination),
  );
  const effectiveStopIntents = stopIntents.length ? stopIntents : [{
    sourceText: null,
    city: null,
    context: null,
    localityKind: 'UNKNOWN' as const,
    origin: 'MISSING' as const,
    candidates: [],
    arrivalDate: { sourceText: null, kind: 'MISSING' as const, day: null, month: null, year: null },
    departureDate: { sourceText: null, kind: 'MISSING' as const, day: null, month: null, year: null },
    stayDuration: { value: null, unit: 'MISSING' as const, evidence: null },
  }];
  const stayDurations: Array<VerifiedStayDuration | null> = [];
  const stops = effectiveStopIntents.map((destination, index) => {
    const path = `stops.${index}.name`;
    const sourceIsVerified = evidenceAppearsInPrompt(destination.sourceText, request.prompt);
    const cityAppearsInEvidence = destinationCityMatchesSource(
      destination.city,
      destination.sourceText,
    );
    const cityName = normalizedEvidence(destination.city ?? '');
    const isCountryOnlyName = recognizedCountryNames(request.locale).has(cityName) &&
      !recognizedCityStateNames(request.locale).has(cityName);
    const isResolvedCity = destination.localityKind === 'CITY' &&
      Boolean(destination.city) &&
      destination.origin === 'USER_EXPLICIT' &&
      sourceIsVerified &&
      cityAppearsInEvidence &&
      destinationEvidenceIsStandalone(destination.sourceText, request.prompt) &&
      !destinationSourceNeedsClarification(destination.sourceText) &&
      !evidenceHasAmbiguousPromptContext(destination.sourceText, request.prompt) &&
      !recognizedMonthNames(request.locale).has(cityName.replace(/\.$/u, '')) &&
      !isCountryOnlyName;
    const isSuggested = Boolean(destination.city) && !isResolvedCity;
    const cityResolution = isResolvedCity
      ? 'RESOLVED' as const
      : isSuggested
        ? 'SUGGESTED' as const
        : destination.localityKind === 'AMBIGUOUS'
          ? 'AMBIGUOUS' as const
          : 'UNRESOLVED' as const;
    const status = isResolvedCity
      ? 'EXPLICIT' as const
      : isSuggested
        ? 'SUGGESTED' as const
        : destination.localityKind === 'UNKNOWN'
          ? 'MISSING' as const
          : 'NEEDS_ATTENTION' as const;
    fields.push(fieldState(path, status, {
      evidence: destination.sourceText,
      message: isResolvedCity
        ? null
        : isSuggested
          ? 'This city is a suggestion and needs your confirmation.'
          : destination.sourceText
            ? `“${destination.sourceText}” is not yet a specific city.`
            : 'A city is required.',
      blocking: !isResolvedCity || isSuggested,
    }));

    const arrival = stopDateState(
      `stops.${index}.arrivalDate`,
      verifiedDateIntent(destination.arrivalDate, request, 'start'),
      request,
    );
    const departure = stopDateState(
      `stops.${index}.departureDate`,
      verifiedDateIntent(destination.departureDate, request, 'end'),
      request,
    );
    fields.push(arrival.state, departure.state);
    const stayDuration = verifiedStayDuration(destination, request);
    stayDurations.push(stayDuration);
    if (destination.stayDuration.value && !stayDuration) {
      warnings.push(
        `The stated duration for destination ${index + 1} could not be safely matched to that city.`,
      );
    }

    return {
      draftId: safeDraftId(index),
      name: isResolvedCity || isSuggested ? destination.city ?? '' : '',
      locationText: destination.context && evidenceAppearsInPrompt(destination.context, request.prompt)
        ? destination.context
        : isResolvedCity ? null : destination.sourceText,
      arrivalDate: arrival.value,
      departureDate: departure.value,
      localityKind: isResolvedCity ? 'CITY' as const : destination.localityKind,
      cityResolution,
    };
  });

  const firstResolvedCity = stops.find((stop) => stop.cityResolution === 'RESOLVED');
  if (!firstResolvedCity) {
    const source = effectiveStopIntents[0];
    const destinationLabel = source?.sourceText ? ` in or near “${source.sourceText}”` : '';
    const candidates = [
      ...(source?.city ? [{ city: source.city, context: source.context }] : []),
      ...(source?.candidates ?? []),
    ].filter((candidate, index, all) =>
      (!recognizedCountryNames(request.locale).has(normalizedEvidence(candidate.city)) ||
        recognizedCityStateNames(request.locale).has(normalizedEvidence(candidate.city))) &&
      !recognizedMonthNames(request.locale).has(normalizedEvidence(candidate.city).replace(/\.$/u, '')) &&
      all.findIndex((item) => item.city.toLocaleLowerCase() === candidate.city.toLocaleLowerCase()) === index,
    ).slice(0, 4);
    const options = candidates.map((candidate, index) => ({
      id: `city-${index + 1}`,
      label: (candidate.context ? `${candidate.city}, ${candidate.context}` : candidate.city).slice(0, 240),
      updates: [
        { path: 'stops.0.name', value: candidate.city },
        { path: 'stops.0.locationText', value: candidate.context },
        { path: 'stops.0.localityKind', value: 'CITY' },
        { path: 'stops.0.cityResolution', value: 'RESOLVED' },
      ],
    }));
    questions.push(question(
      'city-required',
      ['stops.0.name'],
      `Which city should be the first destination${destinationLabel}?`,
      options,
    ));
  }

  let startResolution: DateResolution;
  let endResolution: DateResolution;
  const startIsNextWeekend = startIntent.kind === 'NEXT_WEEKEND';
  const endIsNextWeekend = endIntent.kind === 'NEXT_WEEKEND';
  const usesNextWeekend = startIsNextWeekend || endIsNextWeekend;
  const nextWeekendIsWholeRange = startIsNextWeekend && endIsNextWeekend;
  if (nextWeekendIsWholeRange) {
    const weekend = resolveNextWeekend(request.referenceDate);
    if (weekend.kind === 'resolved') {
      startResolution = {
        value: weekend.startDate,
        status: 'INTERPRETED',
        message: weekend.message,
        explicitYear: false,
      };
      endResolution = {
        value: weekend.endDate,
        status: 'INTERPRETED',
        message: weekend.message,
        explicitYear: false,
      };
      assumptions.push(
        `“Next weekend” was interpreted as ${localizedDate(weekend.startDate, request.locale)}–${localizedDate(weekend.endDate, request.locale)}.`,
      );
    } else {
      startResolution = { value: null, status: 'NEEDS_ATTENTION', message: weekend.message, explicitYear: false };
      endResolution = { value: null, status: 'NEEDS_ATTENTION', message: weekend.message, explicitYear: false };
      questions.push(question(
        'next-weekend-friday',
        ['trip.startDate', 'trip.endDate'],
        'When you say “next weekend,” which weekend do you mean?',
        weekend.choices.map((choice, index) => ({
          id: `weekend-${index + 1}`,
          label: `${localizedDate(choice.startDate, request.locale)}–${localizedDate(choice.endDate, request.locale)}`,
          updates: [
            { path: 'trip.startDate', value: choice.startDate },
            { path: 'trip.endDate', value: choice.endDate },
          ],
        })),
      ));
    }
  } else {
    startResolution = resolveDateIntent(startIntent, request);
    endResolution = resolveDateIntent(endIntent, request);
    if (usesNextWeekend) {
      questions.push(question(
        'next-weekend-mixed-boundary',
        ['trip.startDate', 'trip.endDate'],
        'Does “next weekend” describe the whole trip, or only one of the dates?',
      ));
    }
  }

  if (startResolution.explicitYear && !endResolution.explicitYear) {
    const startParts = startResolution.value ? partsFromIso(startResolution.value) : null;
    const endParts = calendarIntentParts(endIntent, request);
    if (startParts && endParts) {
      const inferredYear = startParts.month === 12 && endParts.month === 1
        ? startParts.year + 1
        : startParts.year;
      endResolution = resolveCalendarIntentInYear(
        endIntent,
        inferredYear,
        request,
        'The missing end year was anchored to the explicitly dated start.',
      ) ?? endResolution;
    }
  } else if (!startResolution.explicitYear && endResolution.explicitYear) {
    const endParts = endResolution.value ? partsFromIso(endResolution.value) : null;
    const startParts = calendarIntentParts(startIntent, request);
    if (startParts && endParts) {
      const inferredYear = startParts.month === 12 && endParts.month === 1
        ? endParts.year - 1
        : endParts.year;
      startResolution = resolveCalendarIntentInYear(
        startIntent,
        inferredYear,
        request,
        'The missing start year was anchored to the explicitly dated end.',
      ) ?? startResolution;
    }
  } else if (!startResolution.explicitYear && !endResolution.explicitYear) {
    const startParts = startResolution.value ? partsFromIso(startResolution.value) : null;
    const rawStartParts = calendarIntentParts(startIntent, request);
    const rawEndParts = calendarIntentParts(endIntent, request);
    if (startParts && rawStartParts && rawEndParts) {
      const sameOrLaterInCalendarYear =
        rawEndParts.month > rawStartParts.month ||
        rawEndParts.month === rawStartParts.month && rawEndParts.day >= rawStartParts.day;
      const isDecemberToJanuary = rawStartParts.month === 12 && rawEndParts.month === 1;
      if (sameOrLaterInCalendarYear || isDecemberToJanuary) {
        endResolution = resolveCalendarIntentInYear(
          endIntent,
          startParts.year + (isDecemberToJanuary ? 1 : 0),
          request,
          isDecemberToJanuary
            ? 'The yearless range was anchored together and rolled across New Year.'
            : 'The missing end year was anchored to the resolved trip start.',
        ) ?? endResolution;
      }
    }
  }

  if (
    startResolution.value &&
    !endResolution.value &&
    endIntent.kind === 'MISSING' &&
    durationOffset !== null &&
    !usesNextWeekend
  ) {
    endResolution = {
      value: addDays(startResolution.value, durationOffset),
      status: 'INTERPRETED',
      message: `Calculated from the stated ${durationValue} ${evidencedDuration!.unit.toLowerCase()}.`,
      explicitYear: false,
    };
    endDateEvidence = extraction.duration.evidence;
  } else if (
    !startResolution.value &&
    endResolution.value &&
    startIntent.kind === 'MISSING' &&
    durationOffset !== null &&
    !usesNextWeekend
  ) {
    startResolution = {
      value: addDays(endResolution.value, -durationOffset),
      status: 'INTERPRETED',
      message: `Calculated from the stated ${durationValue} ${evidencedDuration!.unit.toLowerCase()}.`,
      explicitYear: false,
    };
    startDateEvidence = extraction.duration.evidence;
  }

  const hasExactStopNightDurations = Boolean(
    stops.length &&
    stops.every((stop) => stop.cityResolution === 'RESOLVED') &&
    stayDurations.length === stops.length &&
    stayDurations.every(
      (duration): duration is VerifiedStayDuration => duration?.unit === 'NIGHTS',
    ) &&
    effectiveStopIntents.every((destination) =>
      isCanonicalMissingDateIntent(destination.arrivalDate) &&
      isCanonicalMissingDateIntent(destination.departureDate),
    ),
  );
  const tripDurationWasMissing = extraction.duration.value === null &&
    extraction.duration.unit === 'MISSING' &&
    extraction.duration.evidence === null;
  if (
    startResolution.value &&
    !endResolution.value &&
    endIntent.kind === 'MISSING' &&
    tripDurationWasMissing &&
    !usesNextWeekend &&
    hasExactStopNightDurations
  ) {
    const totalNights = (stayDurations as VerifiedStayDuration[])
      .reduce((total, duration) => total + duration.value, 0);
    if (totalNights <= 366) {
      endResolution = {
        value: addDays(startResolution.value, totalNights),
        status: 'INTERPRETED',
        message: `Calculated from ${totalNights} exact destination ${totalNights === 1 ? 'night' : 'nights'}.`,
        explicitYear: false,
      };
      assumptions.push(
        'The trip end date was calculated from the start date and the exact destination-night allocations.',
      );
    } else {
      warnings.push(
        'The summed destination nights exceed the supported automatic trip range and were not used to calculate the end date.',
      );
    }
  }

  if (
    startResolution.value &&
    startResolution.value < request.referenceDate &&
    startResolution.status === 'INTERPRETED'
  ) {
    startResolution = {
      value: null,
      status: 'NEEDS_ATTENTION',
      message: 'A past start date must be stated explicitly before it can be used.',
      explicitYear: false,
    };
  }
  if (
    endResolution.value &&
    endResolution.value < request.referenceDate &&
    endResolution.status === 'INTERPRETED'
  ) {
    endResolution = {
      value: null,
      status: 'NEEDS_ATTENTION',
      message: 'A past end date must be stated explicitly before it can be used.',
      explicitYear: false,
    };
  }

  let startDate = startResolution.value;
  let endDate = endResolution.value;
  const startCalendarParts = calendarIntentParts(startIntent, request);
  const endCalendarParts = calendarIntentParts(endIntent, request);
  const suspiciousImplicitCrossYear = Boolean(
    startCalendarParts &&
    endCalendarParts &&
    !startResolution.explicitYear &&
    !endResolution.explicitYear &&
    endCalendarParts.month < startCalendarParts.month &&
    !(startCalendarParts.month === 12 && endCalendarParts.month === 1),
  );
  const weekendDurationConflict = nextWeekendIsWholeRange &&
    durationOffset !== null &&
    durationOffset !== 1;
  let dateConflict = suspiciousImplicitCrossYear || weekendDurationConflict;
  const markDateConflict = (message: string, questionId: string, prompt: string) => {
    dateConflict = true;
    startResolution = { ...startResolution, status: 'CONFLICTING', message };
    endResolution = { ...endResolution, status: 'CONFLICTING', message };
    if (!questions.some((item) => item.id === questionId)) {
      questions.push(question(
        questionId,
        ['trip.startDate', 'trip.endDate'],
        prompt,
      ));
    }
  };
  if (suspiciousImplicitCrossYear) {
    markDateConflict(
      'The yearless date range would span an unexpected year boundary.',
      'date-range-conflict',
      'The trip dates appear to cross a year. What years should the start and end use?',
    );
  }
  if (weekendDurationConflict) {
    markDateConflict(
      '“Next weekend” means Saturday–Sunday, which conflicts with the stated duration.',
      'date-duration-conflict',
      '“Next weekend” and the stated duration disagree. Which should the draft use?',
    );
  }
  if (startDate && endDate && endDate < startDate) {
    const startParts = partsFromIso(startDate);
    const endParts = partsFromIso(endDate);
    const mayCrossYear = !endResolution.explicitYear &&
      startParts.month === 12 &&
      endParts.month === 1;
    let rolled = false;
    if (mayCrossYear) {
      let rolledYear = endParts.year;
      let rolledValue = endDate;
      while (rolledValue < startDate && rolledYear < startParts.year + 9) {
        rolledYear += 1;
        const rolled = calendarDate(rolledYear, endParts.month, endParts.day);
        if (rolled) rolledValue = dateKey(rolled);
      }
      if (rolledValue >= startDate) {
        endDate = rolledValue;
        endResolution = {
          ...endResolution,
          value: endDate,
          status: 'INTERPRETED',
          message: 'The end date was rolled into the following year.',
        };
        rolled = true;
      }
    }
    if (!rolled) {
      markDateConflict(
        'The start date is after the end date.',
        'date-range-conflict',
        'The trip dates conflict. What should the correct start and end dates be?',
      );
    }
  }

  if (
    startDate && endDate && durationOffset !== null &&
    addDays(startDate, durationOffset) !== endDate
  ) {
    markDateConflict(
      'The dates do not match the stated duration.',
      'date-duration-conflict',
      'The dates and trip duration disagree. Which dates should the draft use?',
    );
  }

  fields.push(
    fieldState('trip.startDate', startResolution.status, {
      evidence: startDateEvidence,
      message: startResolution.message,
      blocking: !startDate || dateConflict,
    }),
    fieldState('trip.endDate', endResolution.status, {
      evidence: endDateEvidence,
      message: endResolution.message,
      blocking: !endDate || dateConflict,
    }),
  );

  if (!usesNextWeekend && !dateConflict) {
    if (!startDate) {
      questions.push(question(
        'start-date-required',
        ['trip.startDate'],
        dateQuestionPrompt('start', startResolution),
      ));
    }
    if (!endDate) {
      questions.push(question(
        'end-date-required',
        ['trip.endDate'],
        dateQuestionPrompt('end', endResolution),
      ));
    }
  }

  if (startResolution.status === 'PAST' || endResolution.status === 'PAST') {
    warnings.push('This draft contains an explicit date in the past.');
  }

  if (startDate && endDate && !dateConflict) {
    effectiveStopIntents.forEach((destination, index) => {
      const stop = stops[index];
      if (!stop) return;
      const applyAnchoredDate = (
        field: 'arrivalDate' | 'departureDate',
        sourceIntent: DateIntent,
      ) => {
        const intent = verifiedDateIntent(
          sourceIntent,
          request,
          field === 'arrivalDate' ? 'start' : 'end',
        );
        const resolution = resolveCalendarIntentWithinRange(intent, startDate!, endDate!, request);
        if (!resolution?.value) return;
        stop[field] = resolution.value;
        const state = fields.find((item) => item.path === `stops.${index}.${field}`);
        if (state) {
          state.status = resolution.status;
          state.message = resolution.message;
          state.evidence = intent.sourceText;
        }
      };
      applyAnchoredDate('arrivalDate', destination.arrivalDate);
      applyAnchoredDate('departureDate', destination.departureDate);
    });
  }

  if (stops.length && !dateConflict) {
    const firstArrivalWasMissing = !effectiveStopIntents[0] ||
      isCanonicalMissingDateIntent(effectiveStopIntents[0].arrivalDate);
    if (!stops[0]!.arrivalDate && startDate && firstArrivalWasMissing) {
      stops[0]!.arrivalDate = startDate;
      const state = fields.find((item) => item.path === 'stops.0.arrivalDate');
      if (state) {
        state.status = 'INTERPRETED';
        state.message = 'Linked to the trip start date.';
      }
    }
    const last = stops.at(-1)!;
    const lastDestinationIntent = effectiveStopIntents.at(-1);
    const lastDepartureWasMissing = !lastDestinationIntent ||
      isCanonicalMissingDateIntent(lastDestinationIntent.departureDate);
    if (!last.departureDate && endDate && lastDepartureWasMissing) {
      last.departureDate = endDate;
      const state = fields.find((item) => item.path === `stops.${stops.length - 1}.departureDate`);
      if (state) {
        state.status = 'INTERPRETED';
        state.message = 'Linked to the trip end date.';
      }
    }
  }

  const everyStopHasOnlyDurationEvidence = Boolean(
    startDate &&
    endDate &&
    !dateConflict &&
    stayDurations.length === stops.length &&
    stayDurations.every((duration): duration is VerifiedStayDuration => Boolean(duration)) &&
    effectiveStopIntents.every((destination) =>
      isCanonicalMissingDateIntent(destination.arrivalDate) &&
      isCanonicalMissingDateIntent(destination.departureDate),
    ),
  );
  if (everyStopHasOnlyDurationEvidence) {
    const verifiedDurations = stayDurations as VerifiedStayDuration[];
    const fitted = fitStayNightsToTrip(
      verifiedDurations,
      daysBetween(startDate!, endDate!),
    );
    if (fitted) {
      let cursor = startDate!;
      for (const [index, stop] of stops.entries()) {
        const duration = verifiedDurations[index]!;
        const nights = fitted.nights[index]!;
        stop.arrivalDate = cursor;
        stop.departureDate = addDays(cursor, nights);
        cursor = stop.departureDate;
        for (const field of ['arrivalDate', 'departureDate'] as const) {
          const state = fields.find((item) => item.path === `stops.${index}.${field}`);
          if (!state) continue;
          state.status = 'INTERPRETED';
          state.evidence = duration.evidence;
          state.message = duration.unit === 'NIGHTS'
            ? `Calculated from ${duration.value} ${duration.value === 1 ? 'night' : 'nights'}; the end date is the checkout boundary.`
            : `Fitted from “${duration.evidence}”; transfer dates can be shared by adjacent destinations.`;
          state.blocking = false;
        }
      }
      assumptions.push(
        fitted.usedFlexibleDays
          ? 'Bare destination day counts were treated as flexible time allocations and fitted across the trip; adjacent destinations share transfer dates.'
          : 'Destination nights were converted into adjacent arrival and departure dates; the transfer date is shared without overlapping a night.',
      );
      if (fitted.usedFlexibleDays && stops.length <= 4) {
        const fieldPaths = stops.flatMap((_, index) => [
          `stops.${index}.arrivalDate`,
          `stops.${index}.departureDate`,
        ]);
        questions.push(question(
          'destination-duration-interpretation',
          fieldPaths,
          'Do the proposed destination dates match how you meant the day counts?',
          [{
            id: 'use-proposed-destination-dates',
            label: 'Use the proposed shared-transfer dates',
            updates: stops.flatMap((stop, index) => [
              { path: `stops.${index}.arrivalDate`, value: stop.arrivalDate },
              { path: `stops.${index}.departureDate`, value: stop.departureDate },
            ]),
          }],
          false,
        ));
      }
    } else {
      warnings.push(
        'The destination day counts do not fit the overall trip dates under a single shared-transfer schedule.',
      );
      questions.push(question(
        'destination-duration-interpretation',
        stops.slice(0, 4).flatMap((_, index) => [
          `stops.${index}.arrivalDate`,
          `stops.${index}.departureDate`,
        ]),
        'How should the destination day counts and transfer days be allocated?',
        [],
        false,
      ));
    }
  }

  for (const [index, stop] of stops.entries()) {
    const arrivalPath = `stops.${index}.arrivalDate`;
    const departurePath = `stops.${index}.departureDate`;
    const markStopDateInvalid = (path: string, message: string) => {
      const state = fields.find((item) => item.path === path);
      if (state) {
        state.status = 'INVALID';
        state.message = message;
        state.blocking = false;
      }
    };
    if (stop.arrivalDate && stop.departureDate && stop.departureDate < stop.arrivalDate) {
      stop.arrivalDate = null;
      stop.departureDate = null;
      markStopDateInvalid(arrivalPath, 'This destination date range was cleared because it was reversed.');
      markStopDateInvalid(departurePath, 'This destination date range was cleared because it was reversed.');
      questions.push(question(
        `destination-${index + 1}-date-conflict`,
        [arrivalPath, departurePath],
        `What are the correct arrival and departure dates for destination ${index + 1}?`,
        [],
        false,
      ));
      continue;
    }
    if (stop.arrivalDate && startDate && endDate && (stop.arrivalDate < startDate || stop.arrivalDate > endDate)) {
      stop.arrivalDate = null;
      markStopDateInvalid(arrivalPath, 'This date was cleared because it fell outside the trip dates.');
    }
    if (stop.departureDate && startDate && endDate && (stop.departureDate < startDate || stop.departureDate > endDate)) {
      stop.departureDate = null;
      markStopDateInvalid(departurePath, 'This date was cleared because it fell outside the trip dates.');
    }
    for (const [path, label] of [
      [arrivalPath, 'arrival'],
      [departurePath, 'departure'],
    ] as const) {
      const state = fields.find((item) => item.path === path);
      if (
        state &&
        ['INVALID', 'NEEDS_ATTENTION', 'CONFLICTING'].includes(state.status) &&
        !questions.some((item) => item.fieldPaths.includes(path))
      ) {
        questions.push(question(
          `destination-${index + 1}-${label}-date`,
          [path],
          `What is the correct ${label} date for destination ${index + 1}?`,
          [],
          false,
        ));
      }
    }
  }

  const topLevelAreaIsVerified = Boolean(
    extraction.destinationArea.value &&
    extraction.destinationArea.origin === 'USER_EXPLICIT' &&
    evidenceAppearsInPrompt(extraction.destinationArea.evidence, request.prompt) &&
    containsWholePhrase(
      extraction.destinationArea.evidence ?? '',
      extraction.destinationArea.value ?? '',
    ) &&
    !evidenceHasAmbiguousPromptContext(extraction.destinationArea.evidence, request.prompt)
  );
  const broadAreaIntent = extraction.destinations.find((destination) =>
    (['COUNTRY', 'REGION'].includes(destination.localityKind) || destinationLooksCountryOnly(destination)) &&
    destination.city &&
    destination.origin === 'USER_EXPLICIT' &&
    evidenceAppearsInPrompt(destination.sourceText, request.prompt) &&
    destinationCityMatchesSource(destination.city, destination.sourceText),
  );
  const destinationArea = (
    topLevelAreaIsVerified
      ? extraction.destinationArea.value!
      : broadAreaIntent?.city ?? stops
        .map((stop) => stop.name || stop.locationText)
        .filter((value): value is string => Boolean(value))
        .join(' · ')
  ).slice(0, 200);
  const destinationAreaIsExplicit = topLevelAreaIsVerified || Boolean(broadAreaIntent?.city);
  fields.push(fieldState(
    'trip.destinationArea',
    destinationAreaIsExplicit ? 'EXPLICIT' : destinationArea ? 'SUGGESTED' : 'MISSING',
    {
      evidence: topLevelAreaIsVerified
        ? extraction.destinationArea.evidence
        : broadAreaIntent?.sourceText ?? null,
      message: destinationAreaIsExplicit
        ? null
        : destinationArea
          ? 'Generated from the confirmed destinations.'
          : 'Add a country or region if it helps identify the trip.',
    },
  ));

  const nameIsVerified = Boolean(
    extraction.name.value &&
    extraction.name.origin === 'USER_EXPLICIT' &&
    evidenceAppearsInPrompt(extraction.name.evidence, request.prompt) &&
    containsWholePhrase(extraction.name.evidence ?? '', extraction.name.value) &&
    explicitTripNameHasNamingCue(extraction.name.evidence, extraction.name.value),
  );
  const name = (nameIsVerified
    ? extraction.name.value!
    : destinationArea
      ? `Trip to ${destinationArea}`
      : firstResolvedCity ? `Trip to ${firstResolvedCity.name}` : 'New trip').slice(0, 160);
  fields.push(fieldState(
    'trip.name',
    nameIsVerified ? 'EXPLICIT' : 'SUGGESTED',
    {
      evidence: nameIsVerified ? extraction.name.evidence : null,
      message: nameIsVerified ? null : 'Generated from the trip area or confirmed destinations.',
    },
  ));
  const travelerIsAmbiguous = scalarEvidenceIsAmbiguous(extraction.travelerCount.evidence) ||
    evidenceHasAmbiguousPromptContext(extraction.travelerCount.evidence, request.prompt);
  const travelerIsVerified = Boolean(
    extraction.travelerCount.value &&
    ['USER_EXPLICIT', 'DETERMINISTIC'].includes(extraction.travelerCount.origin) &&
    evidenceAppearsInPrompt(extraction.travelerCount.evidence, request.prompt) &&
    !travelerIsAmbiguous &&
    travelerCountFromEvidence(extraction.travelerCount.evidence) === extraction.travelerCount.value,
  );
  fields.push(fieldState(
    'trip.travelerCount',
    travelerIsVerified
      ? travelerCountStatusFromEvidence(extraction.travelerCount.evidence)
      : 'MISSING',
    {
      evidence: travelerIsVerified ? extraction.travelerCount.evidence : null,
      message: travelerIsVerified ? null : 'Traveler count is optional and has not been provided.',
    },
  ));
  if (travelerIsAmbiguous) {
    questions.push(question(
      'traveler-count-ambiguous',
      ['trip.travelerCount'],
      'How many travelers should this draft use?',
      [],
      false,
    ));
  }

  const boundedQuestions = [
    ...questions.filter((item) => item.blocking),
    ...questions.filter((item) => !item.blocking),
  ].slice(0, 12);
  if (questions.length > boundedQuestions.length) {
    warnings.push('Some optional destination-date questions were omitted from this draft; the visible fields remain editable.');
  }
  const minimumViable = Boolean(
    firstResolvedCity &&
    startDate &&
    endDate &&
    !dateConflict &&
    !boundedQuestions.some((item) => item.blocking),
  );

  return tripCreationDraftSchema.parse({
    name,
    destinationArea,
    startDate,
    endDate,
    travelerCount: travelerIsVerified ? extraction.travelerCount.value : null,
    stops,
    assumptions: [...new Set(assumptions)].slice(0, 20),
    warnings: [...new Set(warnings)].slice(0, 20),
    fieldStates: fields,
    questions: boundedQuestions,
    minimumViable,
    referenceDate: request.referenceDate,
    locale: request.locale,
    timeZone: request.timeZone,
  });
}

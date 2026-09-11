import { normalizedText } from './drafts.ts';
import { type TripClarificationQuestion, type TripDraft, type TripDraftStop, type TripInput } from './types.ts';

export function remapTripDraftPathAfterStopRemoval(
  path: string,
  removedIndex: number,
): string | null {
  const match = /^stops\.(\d+)\.(.+)$/.exec(path);
  if (!match) return path;
  const stopIndex = Number(match[1]);
  if (stopIndex === removedIndex) return null;
  return stopIndex > removedIndex ? `stops.${stopIndex - 1}.${match[2]}` : path;
}

export function remapDirtyTripDraftPaths(
  paths: ReadonlySet<string>,
  previousStops: readonly TripDraftStop[],
  nextStops: readonly TripDraftStop[],
): Set<string> {
  const indexMap = new Map<number, number>();
  const claimedNextIndices = new Set<number>();
  const uniqueNextIndex = (predicate: (stop: TripDraftStop) => boolean) => {
    const matches = nextStops.flatMap((stop, index) => predicate(stop) ? [index] : []);
    return matches.length === 1 ? matches[0]! : null;
  };
  previousStops.forEach((stop, previousIndex) => {
    let nextIndex = stop.draftId
      ? uniqueNextIndex((candidate) => candidate.draftId === stop.draftId)
      : null;
    const normalizedName = normalizedText(stop.name);
    if (nextIndex === null && normalizedName) {
      nextIndex = uniqueNextIndex((candidate) => normalizedText(candidate.name) === normalizedName);
    }
    if (
      nextIndex === null &&
      previousStops.length === nextStops.length &&
      nextStops[previousIndex] &&
      !claimedNextIndices.has(previousIndex)
    ) {
      nextIndex = previousIndex;
    }
    if (nextIndex !== null && !claimedNextIndices.has(nextIndex)) {
      indexMap.set(previousIndex, nextIndex);
      claimedNextIndices.add(nextIndex);
    }
  });

  return new Set([...paths].flatMap((path) => {
    const match = /^stops\.(\d+)(\..+)$/.exec(path);
    if (!match) return [path];
    const nextIndex = indexMap.get(Number(match[1]));
    return nextIndex === undefined ? [] : [`stops.${nextIndex}${match[2]}`];
  }));
}

export function remapIncomingStopPath(
  path: string,
  incomingToAlignedIndex: ReadonlyMap<number, number>,
): string {
  const match = /^stops\.(\d+)(\..+)?$/.exec(path);
  if (!match) return path;
  const alignedIndex = incomingToAlignedIndex.get(Number(match[1]));
  return alignedIndex === undefined ? path : `stops.${alignedIndex}${match[2] ?? ''}`;
}

export function explicitlyRemovesStop(
  latestAnswer: string,
  stopName: string,
  stopIndex: number,
): boolean {
  const answer = normalizedText(latestAnswer);
  if (!answer) return false;
  const deletionMatches = [...answer.matchAll(/\b(?:remove|delete|drop|skip|omit)\b/gu)];
  const affirmativeMatches = deletionMatches.filter((match) => {
    const prefix = answer.slice(Math.max(0, match.index! - 24), match.index!);
    return !/\b(?:do\s+not|don['’]?t|never|without|not\s+to)\s*$/u.test(prefix);
  });
  if (!affirmativeMatches.length) return false;
  const nameIndex = answer.indexOf(stopName);
  if (nameIndex >= 0 && affirmativeMatches.some((match) => {
    const verbIndex = match.index!;
    const between = answer.slice(
      Math.min(verbIndex + match[0].length, nameIndex),
      Math.max(verbIndex, nameIndex + stopName.length),
    );
    return Math.abs(verbIndex - nameIndex) <= 48 && !/[,.!?;]/u.test(between);
  })) return true;
  const positions = [
    ['first', '1st'],
    ['second', '2nd'],
    ['third', '3rd'],
    ['fourth', '4th'],
    ['fifth', '5th'],
  ][stopIndex] ?? [];
  return affirmativeMatches.length > 0 && positions.some((position) =>
    answer.includes(`${position} destination`) ||
    answer.includes(`${position} stop`) ||
    answer.includes(`${position} city`),
  );
}

export function alignIncomingTripDraftStops(
  current: TripInput,
  incoming: TripDraft,
  latestAnswer = '',
  openQuestions: readonly TripClarificationQuestion[] = [],
): TripDraft {
  const currentNames = current.stops.map((stop) => normalizedText(stop.name));
  const incomingNames = incoming.stops.map((stop) => normalizedText(stop.name));
  if (
    currentNames.some((name) => !name) ||
    incomingNames.some((name) => !name) ||
    new Set(currentNames).size !== currentNames.length ||
    new Set(incomingNames).size !== incomingNames.length
  ) {
    return incoming;
  }
  const incomingIndexByName = new Map(
    incomingNames.map((name, index) => [name, index] as const),
  );
  const currentNameSet = new Set(currentNames);
  const missingCurrent = currentNames.filter((name) => !incomingIndexByName.has(name));
  const incomingOnly = incomingNames.filter((name) => !currentNameSet.has(name));
  const answer = normalizedText(latestAnswer);
  const oneForOneCandidate = missingCurrent.length > 0 &&
    missingCurrent.length === incomingOnly.length &&
    current.stops.length === incoming.stops.length &&
    incomingOnly.every((name) => answer.includes(name));
  const replacementCue =
    /\b(?:change|replace|swap|go|going|head|heading|visit|visiting|make|actually|instead)\b/u;
  const openCityPaths = new Set(
    openQuestions.flatMap((question) => question.fieldPaths.filter((path) => path.endsWith('.name'))),
  );
  const directOpenCityAnswer = incoming.fieldStates.some((state) =>
    openCityPaths.has(state.path) &&
    state.path.endsWith('.name') &&
    state.evidence &&
    (answer === normalizedText(state.evidence) || answer === `${normalizedText(state.evidence)} please`),
  );
  const replacesMissingSet = oneForOneCandidate &&
    (replacementCue.test(answer) || directOpenCityAnswer);
  const sameCitySet = missingCurrent.length === 0 && incomingOnly.length === 0;
  const orderChanged = sameCitySet && incomingNames.some((name, index) => name !== currentNames[index]);
  const mentionedPositions = incomingNames.map((name) => answer.indexOf(name));
  const mentionsIncomingOrder = mentionedPositions.every((position) => position >= 0) &&
    mentionedPositions.every((position, index) => index === 0 || position > mentionedPositions[index - 1]!);
  const statesIncomingPairwiseOrder = incomingNames.some((earlierName, earlierIndex) =>
    incomingNames.slice(earlierIndex + 1).some((laterName) => {
      const earlierPosition = answer.indexOf(earlierName);
      const laterPosition = answer.indexOf(laterName);
      if (earlierPosition < 0 || laterPosition < 0) return false;
      if (earlierPosition < laterPosition) {
        const between = answer.slice(earlierPosition + earlierName.length, laterPosition);
        return /\b(?:before|then)\b/u.test(between);
      }
      const between = answer.slice(laterPosition + laterName.length, earlierPosition);
      return /\bafter\b/u.test(between);
    }),
  );
  const explicitOrderCue = /\b(?:first|then|last|before|after|order|reorder|route|reverse|visit|visiting)\b/u
    .test(answer);
  const explicitlyReorders = orderChanged && (
    /\breverse(?:\s+the)?\s+(?:trip|route|order)\b/u.test(answer) ||
    explicitOrderCue && (mentionsIncomingOrder || statesIncomingPairwiseOrder)
  );
  const removedNames = new Set(missingCurrent.filter((name) => {
    const currentIndex = currentNames.indexOf(name);
    return explicitlyRemovesStop(latestAnswer, name, currentIndex) || replacesMissingSet;
  }));

  const allMissingExplicitlyRemoved = missingCurrent.length > 0 &&
    missingCurrent.every((name) => removedNames.has(name));
  const targetNames = sameCitySet
    ? [...(explicitlyReorders ? incomingNames : currentNames)]
    : missingCurrent.length === 0 || allMissingExplicitlyRemoved
      ? [...incomingNames]
      : [...currentNames.filter((name) => !removedNames.has(name)), ...incomingOnly];
  if (!targetNames.length) return incoming;

  const incomingToAlignedIndex = new Map<number, number>();
  targetNames.forEach((name, alignedIndex) => {
    const incomingIndex = incomingIndexByName.get(name);
    if (incomingIndex !== undefined) incomingToAlignedIndex.set(incomingIndex, alignedIndex);
  });
  const remap = (path: string) => remapIncomingStopPath(path, incomingToAlignedIndex);
  const currentIndexByName = new Map(
    currentNames.map((name, index) => [name, index] as const),
  );
  const currentDraftIds = new Set(
    current.stops.flatMap((stop) => stop.draftId ? [stop.draftId] : []),
  );
  const stops = targetNames.map((name) => {
    const currentIndex = currentIndexByName.get(name);
    const incomingIndex = incomingIndexByName.get(name);
    if (incomingIndex === undefined) return { ...current.stops[currentIndex!]! };
    const stop = incoming.stops[incomingIndex]!;
    if (currentIndex !== undefined) {
      return { ...stop, draftId: current.stops[currentIndex]?.draftId };
    }
    return {
      ...stop,
      draftId: stop.draftId && !currentDraftIds.has(stop.draftId) ? stop.draftId : undefined,
    };
  });
  const suggestedName = incoming.fieldStates.some((state) =>
    state.path === 'trip.name' && state.status === 'SUGGESTED',
  );
  const destinationAreaIsAuthoritative = incoming.fieldStates.some((state) =>
    state.path === 'trip.destinationArea' && ['EXPLICIT', 'CONFIRMED'].includes(state.status),
  );
  const firstResolvedCity = stops.find((stop) =>
    stop.localityKind === 'CITY' && stop.cityResolution === 'RESOLVED' && stop.name.trim(),
  );
  const suggestedNameLocation = destinationAreaIsAuthoritative
    ? incoming.destinationArea.trim()
    : firstResolvedCity?.name.trim() ?? '';
  return {
    ...incoming,
    name: suggestedName && suggestedNameLocation
      ? `Trip to ${suggestedNameLocation}`.slice(0, 160)
      : incoming.name,
    stops,
    fieldStates: incoming.fieldStates.map((state) => ({
      ...state,
      path: remap(state.path),
    })),
    questions: incoming.questions.map((question) => ({
      ...question,
      fieldPaths: question.fieldPaths.map(remap),
      options: question.options.map((option) => ({
        ...option,
        updates: option.updates.map((update) => ({
          ...update,
          path: remap(update.path),
        })),
      })),
    })),
  };
}

export function remapCurrentTripDraftPathToIncoming(
  current: TripInput,
  incoming: TripDraft,
  path: string,
  latestAnswer = '',
): string | null {
  const match = /^stops\.(\d+)(\..+)?$/.exec(path);
  if (!match) return path;
  const currentStop = current.stops[Number(match[1])];
  if (!currentStop) return null;
  const name = normalizedText(currentStop.name);
  if (!name) return path;
  const matches = incoming.stops.flatMap((stop, index) =>
    normalizedText(stop.name) === name ? [index] : [],
  );
  if (matches.length !== 1) {
    const answer = normalizedText(latestAnswer);
    const isOneForOneReplacement = current.stops.length === incoming.stops.length &&
      Number(match[1]) < incoming.stops.length &&
      /\b(?:change|replace|swap)\b/u.test(answer);
    if (isOneForOneReplacement) return path;
    return explicitlyRemovesStop(latestAnswer, name, Number(match[1])) ? null : path;
  }
  return `stops.${matches[0]}${match[2] ?? ''}`;
}

import { type DateIntent, type DestinationIntent, type TripCreationRequest } from './schemas.js';

export function normalizedEvidence(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

const countryNamesByLocale = new Map<string, ReadonlySet<string>>();
const cityStateNamesByLocale = new Map<string, ReadonlySet<string>>();
const monthNamesByLocale = new Map<string, ReadonlySet<string>>();

export function recognizedCountryNames(locale: string): ReadonlySet<string> {
  const cached = countryNamesByLocale.get(locale);
  if (cached) return cached;
  const names = new Set<string>();
  const displays = [
    new Intl.DisplayNames(['en'], { type: 'region' }),
    new Intl.DisplayNames([locale], { type: 'region' }),
  ];
  for (let first = 65;first <= 90;first += 1) {
    for (let second = 65;second <= 90;second += 1) {
      const code = String.fromCharCode(first, second);
      for (const display of displays) {
        const label = display.of(code);
        if (label && label !== code) {
          names.add(normalizedEvidence(label));
          names.add(code.toLocaleLowerCase());
        }
      }
    }
  }
  countryNamesByLocale.set(locale, names);
  return names;
}

export function recognizedCityStateNames(locale: string): ReadonlySet<string> {
  const cached = cityStateNamesByLocale.get(locale);
  if (cached) return cached;
  const names = new Set<string>();
  const displays = [
    new Intl.DisplayNames(['en'], { type: 'region' }),
    new Intl.DisplayNames([locale], { type: 'region' }),
  ];
  for (const code of ['DJ', 'GI', 'LU', 'MC', 'MO', 'SG', 'SM', 'VA']) {
    for (const display of displays) {
      const label = display.of(code);
      if (label && label !== code) names.add(normalizedEvidence(label));
    }
  }
  names.add('macau');
  names.add('vatican');
  cityStateNamesByLocale.set(locale, names);
  return names;
}

export function recognizedMonthNames(locale: string): ReadonlySet<string> {
  const cached = monthNamesByLocale.get(locale);
  if (cached) return cached;
  const names = new Set<string>();
  for (let month = 1;month <= 12;month += 1) {
    const date = new Date(Date.UTC(2020, month - 1, 1));
    for (const language of new Set([locale, 'en'])) {
      for (const width of ['long', 'short'] as const) {
        names.add(normalizedEvidence(new Intl.DateTimeFormat(language, {
          month: width,
          timeZone: 'UTC',
        }).format(date)).replace(/\.$/u, ''));
      }
    }
  }
  monthNamesByLocale.set(locale, names);
  return names;
}

export function destinationCityMatchesSource(city: string | null, sourceText: string | null): boolean {
  if (!city || !sourceText) return false;
  const normalizedCity = normalizedEvidence(city);
  const normalizedSource = normalizedEvidence(sourceText);
  return normalizedSource === normalizedCity ||
    normalizedSource.startsWith(`${normalizedCity},`) ||
    normalizedSource.startsWith(`${normalizedCity} `);
}

export function destinationEvidenceIsStandalone(sourceText: string | null, prompt: string): boolean {
  if (!sourceText) return false;
  const needle = sourceText.trim();
  const lowerPrompt = prompt.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const compoundPrefixes = new Set([
    'abu', 'buenos', 'east', 'eastern', 'fort', 'ft', 'ho', 'kuala', 'la', 'las', 'los',
    'new', 'north', 'northern', 'rio', 'saint', 'san', 'santa', 'south', 'southern', 'st',
    'west', 'western',
  ]);
  let index = lowerPrompt.indexOf(lowerNeedle);
  while (index >= 0) {
    const before = prompt.slice(0, index);
    const previousWord = /([\p{L}][\p{L}'’-]*)\s+$/u.exec(before)?.[1] ?? null;
    const normalizedPrevious = previousWord
      ? normalizedEvidence(previousWord).replace(/\.$/u, '')
      : null;
    const isCompoundPrefix = Boolean(
      normalizedPrevious && compoundPrefixes.has(normalizedPrevious),
    );
    if (!isCompoundPrefix) return true;
    index = lowerPrompt.indexOf(lowerNeedle, index + 1);
  }
  return false;
}

export function destinationSourceNeedsClarification(sourceText: string | null): boolean {
  if (!sourceText) return false;
  return /\b(?:maybe|perhaps|possibly|either|or|not|avoid|except|near|around|somewhere)\b/u
    .test(normalizedEvidence(sourceText));
}

export function containsWholePhrase(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizedEvidence(haystack);
  const normalizedNeedle = normalizedEvidence(needle);
  if (!normalizedNeedle) return false;
  let index = normalizedHaystack.indexOf(normalizedNeedle);
  while (index >= 0) {
    const before = index === 0 ? '' : normalizedHaystack[index - 1]!;
    const afterIndex = index + normalizedNeedle.length;
    const after = afterIndex >= normalizedHaystack.length ? '' : normalizedHaystack[afterIndex]!;
    const isWordCharacter = (character: string) => /[\p{L}\p{N}]/u.test(character);
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    index = normalizedHaystack.indexOf(normalizedNeedle, index + 1);
  }
  return false;
}

export function evidenceAppearsInPrompt(evidence: string | null, prompt: string): boolean {
  return Boolean(evidence && containsWholePhrase(prompt, evidence));
}

export function explicitTripNameHasNamingCue(evidence: string | null, value: string | null): boolean {
  if (!evidence || !value) return false;
  const source = normalizedEvidence(evidence);
  const name = normalizedEvidence(value);
  return (
    /\b(?:name|named|call|called|title|titled)\b/u.test(source) ||
    source.includes(`“${name}”`) ||
    source.includes(`"${name}"`) ||
    source.includes(`'${name}'`)
  );
}

export function evidenceHasAmbiguousPromptContext(evidence: string | null, prompt: string): boolean {
  if (!evidence) return false;
  const normalizedPrompt = normalizedEvidence(prompt);
  const normalizedNeedle = normalizedEvidence(evidence);
  if (!normalizedNeedle) return false;
  let index = normalizedPrompt.indexOf(normalizedNeedle);
  while (index >= 0) {
    const before = normalizedPrompt.slice(Math.max(0, index - 48), index);
    const after = normalizedPrompt.slice(index + normalizedNeedle.length, index + normalizedNeedle.length + 48);
    if (
      /\b(?:either|or|maybe|perhaps|possibly|about|around|approximately|roughly|near|somewhere|after|before|by|avoid|except|instead\s+of|at\s+(?:least|most)|up\s+to|more\s+than|less\s+than|fewer\s+than|no\s+(?:more|fewer|earlier|later)\s+than)\s*$/u.test(before) ||
      /\bnot(?:\s+\w+){0,2}\s*$/u.test(before) ||
      /\bbetween\b.{0,24}\band\s*$/u.test(before) ||
      /^\s*[,;/]?\s*(?:or|maybe|perhaps|possibly|at\s+(?:least|most|latest|earliest)|or\s+(?:more|less|later|earlier)|or\s+fewer)\b/u.test(after)
    ) {
      return true;
    }
    index = normalizedPrompt.indexOf(normalizedNeedle, index + 1);
  }
  return false;
}

function relativeIntentMatchesSource(intent: DateIntent): boolean {
  const source = normalizedEvidence(intent.sourceText ?? '');
  switch (intent.kind) {
    case 'TODAY':
      return /\btoday\b/u.test(source);
    case 'TOMORROW':
      return /\btomorrow\b/u.test(source);
    case 'THIS_FRIDAY':
      return /\bthis\b/u.test(source) && /\bfri(?:day)?\b/u.test(source);
    case 'NEXT_WEEKEND':
      return /\bnext\b/u.test(source) && /\bweek[\s-]?end\b/u.test(source);
    default:
      return true;
  }
}

function dateEvidenceIsAmbiguous(sourceText: string | null): boolean {
  if (!sourceText) return false;
  const source = normalizedEvidence(sourceText);
  return /\b(?:either|or|maybe|perhaps|possibly|about|around|approximately|roughly|unsure|not|after|before|by)\b/u
    .test(source) ||
    /\b(?:at\s+(?:least|most|latest|earliest)|up\s+to|more\s+than|less\s+than|fewer\s+than|no\s+(?:more|fewer|earlier|later)\s+than)\b/u
      .test(source);
}

type DateBoundaryRole = 'start' | 'end' | 'single';

export function isCanonicalMissingDateIntent(intent: DateIntent): boolean {
  return intent.kind === 'MISSING' &&
    intent.sourceText === null &&
    intent.day === null &&
    intent.month === null &&
    intent.year === null;
}

function evidenceConflictsWithBoundaryRole(
  evidence: string | null,
  prompt: string,
  role: DateBoundaryRole,
): boolean {
  if (!evidence || role === 'single') return false;
  const source = normalizedEvidence(evidence);
  const sourceIsRange = /\b(?:to|through|until)\b|[–—]|(?:\p{L}.*\d\s*-\s*\d|\d\s*-\s*\d.*\p{L})/u
    .test(source);
  if (sourceIsRange) return false;
  if (role === 'start' && /^\s*(?:to|until|through)\b/u.test(source)) return true;
  if (role === 'end' && /^\s*from\b/u.test(source)) return true;

  const normalizedPrompt = normalizedEvidence(prompt);
  let index = normalizedPrompt.indexOf(source);
  let found = false;
  while (index >= 0) {
    const before = normalizedPrompt.slice(Math.max(0, index - 24), index);
    const conflicts = role === 'start'
      ? /\b(?:to|until|through)\s*$/u.test(before)
      : /\bfrom\s*$/u.test(before);
    found = true;
    if (!conflicts) return false;
    index = normalizedPrompt.indexOf(source, index + 1);
  }
  return found;
}

function calendarYearFromSource(
  intent: DateIntent,
  locale: string,
  role: DateBoundaryRole,
): number | null | undefined {
  if (!intent.sourceText || !intent.day || !intent.month) return undefined;
  const source = normalizedEvidence(intent.sourceText);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source);
  if (isoMatch) {
    return Number(isoMatch[2]) === intent.month && Number(isoMatch[3]) === intent.day
      ? Number(isoMatch[1])
      : undefined;
  }
  if (!new RegExp('(^|\\D)' + intent.day + '(\\D|$)').test(source)) return undefined;
  const monthDate = new Date(Date.UTC(2020, intent.month - 1, 1));
  const monthForms = ['long', 'short'].map((width) =>
    normalizedEvidence(new Intl.DateTimeFormat(locale, {
      month: width as 'long' | 'short',
      timeZone: 'UTC',
    }).format(monthDate)).replace(/\.$/, ''),
  );
  const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const monthAliases = new Map<string, number>();
  for (let month = 1;month <= 12;month += 1) {
    const date = new Date(Date.UTC(2020, month - 1, 1));
    for (const language of new Set([locale, 'en'])) {
      for (const width of ['long', 'short'] as const) {
        const label = normalizedEvidence(new Intl.DateTimeFormat(language, {
          month: width,
          timeZone: 'UTC',
        }).format(date)).replace(/\.$/u, '');
        monthAliases.set(label, month);
      }
    }
  }
  const monthAlternation = [...monthAliases.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapePattern)
    .join('|');
  const ordinalDay = '(\\d{1,2})(?:st|nd|rd|th)?';
  const rangeSeparator = '(?:-|–|—|to|through|until)';
  const dayFirstFullRange = new RegExp(
    `\\b${ordinalDay}\\s*(?:of\\s+)?(${monthAlternation})\\b\\.?(?:\\s*,?\\s*(\\d{4})(?!\\d))?\\s*${rangeSeparator}\\s*${ordinalDay}\\s*(?:of\\s+)?(${monthAlternation})\\b\\.?(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
    'u',
  ).exec(source);
  const monthFirstFullRange = new RegExp(
    `\\b(${monthAlternation})\\b\\.?\\s+${ordinalDay}\\b(?:\\s*,?\\s*(\\d{4})(?!\\d))?\\s*${rangeSeparator}\\s*(${monthAlternation})\\b\\.?\\s+${ordinalDay}\\b(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
    'u',
  ).exec(source);
  const fullRange = dayFirstFullRange
    ? {
      first: {
        day: Number(dayFirstFullRange[1]),
        month: monthAliases.get(dayFirstFullRange[2]!)!,
        year: dayFirstFullRange[3] ? Number(dayFirstFullRange[3]) : null,
      },
      second: {
        day: Number(dayFirstFullRange[4]),
        month: monthAliases.get(dayFirstFullRange[5]!)!,
        year: dayFirstFullRange[6] ? Number(dayFirstFullRange[6]) : null,
      },
    }
    : monthFirstFullRange
      ? {
        first: {
          day: Number(monthFirstFullRange[2]),
          month: monthAliases.get(monthFirstFullRange[1]!)!,
          year: monthFirstFullRange[3] ? Number(monthFirstFullRange[3]) : null,
        },
        second: {
          day: Number(monthFirstFullRange[5]),
          month: monthAliases.get(monthFirstFullRange[4]!)!,
          year: monthFirstFullRange[6] ? Number(monthFirstFullRange[6]) : null,
        },
      }
      : null;
  if (fullRange) {
    const firstMatches = intent.day === fullRange.first.day && intent.month === fullRange.first.month;
    const secondMatches = intent.day === fullRange.second.day && intent.month === fullRange.second.month;
    const selected = role === 'start'
      ? firstMatches ? fullRange.first : null
      : role === 'end'
        ? secondMatches ? fullRange.second : null
        : firstMatches ? fullRange.first : secondMatches ? fullRange.second : null;
    if (!selected) return undefined;
    return selected.year;
  }
  const day = `${intent.day}(?:st|nd|rd|th)?`;
  const rangeMatchesRole = (first: number, second: number) =>
    role === 'start' ? intent.day === first : role === 'end' ? intent.day === second :
      intent.day === first || intent.day === second;
  for (const month of monthForms) {
    const monthPattern = escapePattern(month);
    const sharedMonthRange = new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${rangeSeparator}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${monthPattern}\\b\\.?(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
      'u',
    ).exec(source);
    if (sharedMonthRange) {
      if (!rangeMatchesRole(Number(sharedMonthRange[1]), Number(sharedMonthRange[2]))) {
        return undefined;
      }
      return sharedMonthRange[3] ? Number(sharedMonthRange[3]) : null;
    }
    const monthFirstRange = new RegExp(
      `\\b${monthPattern}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*${rangeSeparator}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
      'u',
    ).exec(source);
    if (monthFirstRange) {
      if (!rangeMatchesRole(Number(monthFirstRange[1]), Number(monthFirstRange[2]))) {
        return undefined;
      }
      return monthFirstRange[3] ? Number(monthFirstRange[3]) : null;
    }
    const dayFirst = new RegExp(
      `\\b${day}\\s*(?:of\\s+)?${monthPattern}\\b\\.?(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
      'u',
    ).exec(source);
    if (dayFirst) return dayFirst[1] ? Number(dayFirst[1]) : null;
    const monthFirst = new RegExp(
      `\\b${monthPattern}\\b\\.?\\s+${day}\\b(?:\\s*,?\\s*(\\d{4})(?!\\d))?`,
      'u',
    ).exec(source);
    if (monthFirst) return monthFirst[1] ? Number(monthFirst[1]) : null;
  }
  return undefined;
}

export function verifiedDateIntent(
  intent: DateIntent,
  request: TripCreationRequest,
  role: DateBoundaryRole = 'single',
): DateIntent {
  if (intent.kind === 'MISSING') {
    return isCanonicalMissingDateIntent(intent)
      ? { sourceText: null, kind: 'MISSING', day: null, month: null, year: null }
      : {
        sourceText: intent.sourceText,
        kind: 'UNRESOLVED',
        day: null,
        month: null,
        year: null,
      };
  }
  if (!evidenceAppearsInPrompt(intent.sourceText, request.prompt)) {
    return {
      sourceText: intent.sourceText,
      kind: intent.sourceText ? 'UNRESOLVED' : 'MISSING',
      day: null,
      month: null,
      year: null,
    };
  }
  if (
    dateEvidenceIsAmbiguous(intent.sourceText) ||
    evidenceHasAmbiguousPromptContext(intent.sourceText, request.prompt) ||
    evidenceConflictsWithBoundaryRole(intent.sourceText, request.prompt, role)
  ) {
    return {
      sourceText: intent.sourceText,
      kind: 'UNRESOLVED',
      day: null,
      month: null,
      year: null,
    };
  }
  if (!relativeIntentMatchesSource(intent)) {
    return {
      sourceText: intent.sourceText,
      kind: 'UNRESOLVED',
      day: null,
      month: null,
      year: null,
    };
  }
  let normalizedIntent = intent;
  if (intent.kind === 'CALENDAR_DATE') {
    const evidencedYear = calendarYearFromSource(intent, request.locale, role);
    if (evidencedYear === undefined) {
      return {
        sourceText: intent.sourceText,
        kind: 'UNRESOLVED',
        day: null,
        month: null,
        year: null,
      };
    }
    normalizedIntent = { ...intent, year: evidencedYear };
  } else {
    const yearWasExplicit = Boolean(
      intent.year &&
      new RegExp('(^|\\D)' + intent.year + '(\\D|$)').test(intent.sourceText ?? ''),
    );
    if (!yearWasExplicit) normalizedIntent = { ...intent, year: null };
  }
  return normalizedIntent;
}

const countWordValues: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const countTokenPattern = '(?:\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

function countTokenValue(token: string): number | null {
  const value = /^\d+$/u.test(token) ? Number(token) : countWordValues[token];
  return value && Number.isInteger(value) ? value : null;
}

export function scalarEvidenceIsAmbiguous(evidence: string | null): boolean {
  if (!evidence) return false;
  const source = normalizedEvidence(evidence);
  return /\b(?:either|or|maybe|perhaps|possibly|about|around|approximately|roughly|unsure|not|might|could)\b/u
    .test(source) ||
    /\b(?:at\s+(?:least|most)|up\s+to|between|more\s+than|less\s+than|fewer\s+than|no\s+(?:more|fewer)\s+than)\b/u
      .test(source);
}

export function travelerCountFromEvidence(evidence: string | null): number | null {
  if (!evidence) return null;
  const source = normalizedEvidence(evidence);
  if (scalarEvidenceIsAmbiguous(source)) return null;
  const travelerExpression = new RegExp(
    `\\b(${countTokenPattern})[\\s-]+(people|persons?|travell?ers?|adults?|children|child|kids?|guests?|passengers?|of us)\\b`,
    'gu',
  );
  const categorizedValues = [...source.matchAll(travelerExpression)]
    .map((match) => ({ value: countTokenValue(match[1]!), category: match[2]! }))
    .filter((item): item is { value: number; category: string } => item.value !== null);
  const groupExpression = new RegExp(
    `\\b(?:party|group|family)\\s+of\\s+(${countTokenPattern})\\b(?![\\s-]+(?:people|persons?|travell?ers?|adults?|children|child|kids?|guests?|passengers?))`,
    'u',
  ).exec(source);
  const groupCount = groupExpression ? countTokenValue(groupExpression[1]!) : null;
  const generalCounts = categorizedValues.filter(({ category }) =>
    /^(?:people|persons?|travell?ers?|guests?|passengers?|of us)$/u.test(category));
  const categoryBreakdown = categorizedValues.filter(({ category }) =>
    /^(?:adults?|children|child|kids?)$/u.test(category));
  let categorizedTotal = categorizedValues.reduce((total, item) => total + item.value, 0);
  if (generalCounts.length && categoryBreakdown.length) {
    const declaredTotals = new Set(generalCounts.map(({ value }) => value));
    if (declaredTotals.size !== 1) return null;
    const declaredTotal = generalCounts[0]!.value;
    const breakdownTotal = categoryBreakdown.reduce((total, item) => total + item.value, 0);
    if (breakdownTotal > declaredTotal) return null;
    categorizedTotal = declaredTotal;
  }
  if (groupCount && categorizedValues.length && categorizedTotal > groupCount) return null;

  const describesCouple = /\b(?:couple|pair)\b/u.test(source);
  const selfIsAdditive = !/\b(?:including\s+me|one\s+of)\b/u.test(source) && (
    /\b(?:me|myself)\s+(?:and|with)\b/u.test(source) ||
    /\b(?:and|plus)\s+(?:me|myself)\b/u.test(source) ||
    /\bmy\s+(?:partner|spouse)\s+and\s+i\b/u.test(source) ||
    /\b(?:people|persons?|travell?ers?|adults?|children|child|kids?|guests?|passengers?)\s+and\s+i\b/u.test(source)
  );
  const mentionsPartner = /\bmy\s+(?:partner|spouse)\b/u.test(source);
  const selfPartnerPair = /\bi\b.{0,40}\bwith\s+my\s+(?:partner|spouse)\b/u.test(source);
  const partnerIsAdditive = mentionsPartner &&
    !/\b(?:including\s+my\s+(?:partner|spouse)|my\s+(?:partner|spouse)\s+is\s+one\s+of)\b/u
      .test(source);
  const describesSolo = /\b(?:solo|alone|just me|on my own)\b/u.test(source);
  if (describesSolo && (categorizedValues.length || groupCount || describesCouple || mentionsPartner)) {
    return null;
  }

  let count = groupCount ?? categorizedTotal;
  if (describesCouple) {
    const dependentTotal = categorizedValues
      .filter(({ category }) => /^(?:children|child|kids?)$/u.test(category))
      .reduce((total, item) => total + item.value, 0);
    const nonDependent = categorizedValues.filter(
      ({ category }) => !/^(?:children|child|kids?)$/u.test(category),
    );
    if (nonDependent.length && nonDependent.reduce((total, item) => total + item.value, 0) !== 2) {
      return null;
    }
    count = 2 + dependentTotal;
  } else if (!groupCount) {
    if (selfPartnerPair) {
      count += 2;
    } else {
      if (selfIsAdditive) count += 1;
      if (partnerIsAdditive) count += 1;
    }
  }
  if (!count && describesSolo) count = 1;
  if (!count) return null;
  return count >= 1 && count <= 20 ? count : null;
}

export function travelerCountStatusFromEvidence(
  evidence: string | null,
): 'EXPLICIT' | 'INTERPRETED' {
  if (!evidence) return 'INTERPRETED';
  const source = normalizedEvidence(evidence);
  const directGroup = new RegExp(
    `\\b(?:party|group|family)\\s+of\\s+${countTokenPattern}\\b(?![\\s-]+(?:people|persons?|travell?ers?|adults?|children|child|kids?|guests?|passengers?))`,
    'u',
  ).test(source);
  if (directGroup) return 'EXPLICIT';
  const statedCounts = [...source.matchAll(new RegExp(
    `\\b${countTokenPattern}[\\s-]+(?:people|persons?|travell?ers?|adults?|children|child|kids?|guests?|passengers?|of us)\\b`,
    'gu',
  ))].length;
  const requiresSemanticCounting = /\b(?:solo|alone|couple|pair|my\s+(?:partner|spouse))\b/u
    .test(source) ||
    /\b(?:me|myself)\s+(?:and|with)\b|\b(?:and|plus)\s+(?:me|myself)\b/u.test(source);
  return statedCounts === 1 && !requiresSemanticCounting ? 'EXPLICIT' : 'INTERPRETED';
}

export function durationFromEvidence(
  evidence: string | null,
): { value: number; unit: 'DAYS' | 'FULL_DAYS' | 'NIGHTS' | 'WEEKS' } | null {
  if (!evidence) return null;
  const source = normalizedEvidence(evidence);
  if (scalarEvidenceIsAmbiguous(source)) return null;
  const match = new RegExp(
    `\\b(${countTokenPattern})[\\s-]+(?:(full)[\\s-]+)?(day|days|night|nights|week|weeks)\\b`,
    'u',
  ).exec(source);
  if (!match) return null;
  const value = countTokenValue(match[1]!);
  if (!value || value > 366) return null;
  return {
    value,
    unit: match[3]!.startsWith('night')
      ? 'NIGHTS'
      : match[3]!.startsWith('week')
        ? 'WEEKS'
        : match[2] ? 'FULL_DAYS' : 'DAYS',
  };
}

export type VerifiedStayDuration = {
  value: number;
  unit: 'DAYS' | 'FULL_DAYS' | 'NIGHTS' | 'WEEKS';
  evidence: string;
};

export function verifiedStayDuration(
  destination: DestinationIntent,
  request: TripCreationRequest,
): VerifiedStayDuration | null {
  const evidence = destination.stayDuration.evidence;
  const parsed = evidenceAppearsInPrompt(evidence, request.prompt) &&
    !scalarEvidenceIsAmbiguous(evidence) &&
    !evidenceHasAmbiguousPromptContext(evidence, request.prompt)
    ? durationFromEvidence(evidence)
    : null;
  if (
    !parsed ||
    parsed.value !== destination.stayDuration.value ||
    parsed.unit !== destination.stayDuration.unit ||
    !evidence ||
    !destination.city ||
    !containsWholePhrase(evidence, destination.city)
  ) {
    return null;
  }
  return { ...parsed, evidence };
}

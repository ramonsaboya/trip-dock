import { z } from 'zod';

import { isoDateSchema } from './domain.js';

export const tripCreationRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(8_000),
    locale: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .refine((value) => {
        try {
          new Intl.Locale(value);
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid BCP-47 locale, such as en-GB or en-US.'),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid IANA timezone, such as Europe/London.'),
    referenceDate: isoDateSchema,
  })
  .strict();

export type TripCreationRequest = z.infer<typeof tripCreationRequestSchema>;

export const dateIntentSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(160).nullable(),
    kind: z.enum([
      'CALENDAR_DATE',
      'NUMERIC_DATE',
      'TODAY',
      'TOMORROW',
      'THIS_FRIDAY',
      'NEXT_WEEKEND',
      'MONTH_ONLY',
      'UNRESOLVED',
      'MISSING',
    ]),
    day: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    year: z.number().int().min(1_000).max(9_999).nullable(),
  })
  .strict();

const extractedValueOriginSchema = z.enum([
  'USER_EXPLICIT',
  'DETERMINISTIC',
  'AI_SUGGESTED',
  'MISSING',
]);

const extractedTextSchema = z
  .object({
    value: z.string().trim().min(1).max(160).nullable(),
    evidence: z.string().trim().min(1).max(240).nullable(),
    origin: extractedValueOriginSchema,
  })
  .strict();

const extractedCountSchema = z
  .object({
    value: z.number().int().min(1).max(20).nullable(),
    evidence: z.string().trim().min(1).max(240).nullable(),
    origin: extractedValueOriginSchema,
  })
  .strict();

const durationIntentSchema = z
  .object({
    value: z.number().int().min(1).max(366).nullable(),
    unit: z.enum(['DAYS', 'FULL_DAYS', 'NIGHTS', 'WEEKS', 'MISSING']),
    evidence: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

const cityCandidateSchema = z
  .object({
    city: z.string().trim().min(1).max(120),
    context: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export const destinationIntentSchema = z
  .object({
    sourceText: z.string().trim().min(1).max(240).nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    context: z.string().trim().min(1).max(160).nullable(),
    localityKind: z.enum(['CITY', 'COUNTRY', 'REGION', 'PREFERENCE', 'AMBIGUOUS', 'UNKNOWN']),
    origin: extractedValueOriginSchema,
    candidates: z.array(cityCandidateSchema).max(4),
    arrivalDate: dateIntentSchema,
    departureDate: dateIntentSchema,
    stayDuration: durationIntentSchema,
  })
  .strict();

export const tripIntentExtractionSchema = z
  .object({
    name: extractedTextSchema,
    destinationArea: extractedTextSchema,
    travelerCount: extractedCountSchema,
    startDate: dateIntentSchema,
    endDate: dateIntentSchema,
    duration: durationIntentSchema,
    destinations: z.array(destinationIntentSchema).max(20),
    assumptions: z.array(z.string().trim().min(1).max(240)).max(12),
    warnings: z.array(z.string().trim().min(1).max(240)).max(12),
  })
  .strict();

export type DateIntent = z.infer<typeof dateIntentSchema>;
export type DestinationIntent = z.infer<typeof destinationIntentSchema>;
export type TripIntentExtraction = z.infer<typeof tripIntentExtractionSchema>;

export const tripDraftFieldStatusSchema = z.enum([
  'EXPLICIT',
  'INTERPRETED',
  'SUGGESTED',
  'CONFIRMED',
  'MISSING',
  'NEEDS_ATTENTION',
  'INVALID',
  'CONFLICTING',
  'PAST',
]);

export const tripDraftFieldStateSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    status: tripDraftFieldStatusSchema,
    evidence: z.string().trim().min(1).max(240).nullable(),
    message: z.string().trim().min(1).max(300).nullable(),
    blocking: z.boolean(),
  })
  .strict();

export const tripClarificationUpdateSchema = z
  .object({
    path: z.string().trim().min(1).max(160),
    value: z.string().max(240).nullable(),
  })
  .strict();

export const tripClarificationOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(240),
    updates: z.array(tripClarificationUpdateSchema).min(1).max(8),
  })
  .strict();

export const tripClarificationQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    fieldPaths: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
    prompt: z.string().trim().min(1).max(300),
    options: z.array(tripClarificationOptionSchema).max(6),
    allowFreeText: z.boolean(),
    blocking: z.boolean(),
  })
  .strict();

export const tripCreationDraftStopSchema = z
  .object({
    draftId: z.string().trim().min(1).max(100),
    name: z.string().trim().max(120),
    locationText: z.string().trim().min(1).max(240).nullable(),
    arrivalDate: isoDateSchema.nullable(),
    departureDate: isoDateSchema.nullable(),
    localityKind: z.enum(['CITY', 'COUNTRY', 'REGION', 'PREFERENCE', 'AMBIGUOUS', 'UNKNOWN']),
    cityResolution: z.enum(['RESOLVED', 'SUGGESTED', 'AMBIGUOUS', 'UNRESOLVED']),
  })
  .strict();

export const tripCreationDraftSchema = z
  .object({
    name: z.string().trim().max(160),
    destinationArea: z.string().trim().max(200),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    travelerCount: z.number().int().min(1).max(20).nullable(),
    stops: z.array(tripCreationDraftStopSchema).min(1).max(20),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(20),
    warnings: z.array(z.string().trim().min(1).max(300)).max(20),
    fieldStates: z.array(tripDraftFieldStateSchema).max(100),
    questions: z.array(tripClarificationQuestionSchema).max(12),
    minimumViable: z.boolean(),
    referenceDate: isoDateSchema,
    locale: z.string().trim().min(2).max(35),
    timeZone: z.string().trim().min(1).max(80),
  })
  .strict();

export type TripCreationDraft = z.infer<typeof tripCreationDraftSchema>;
export type TripDraftFieldState = z.infer<typeof tripDraftFieldStateSchema>;
export type TripClarificationQuestion = z.infer<typeof tripClarificationQuestionSchema>;

type DateResolution = {
  value: string | null;
  status: z.infer<typeof tripDraftFieldStatusSchema>;
  message: string | null;
  explicitYear: boolean;
};

type WeekendResolution =
  | { kind: 'resolved'; startDate: string; endDate: string; message: string }
  | {
      kind: 'ambiguous';
      choices: Array<{ startDate: string; endDate: string }>;
      message: string;
    };

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function partsFromIso(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function dateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(value: string, days: number): string {
  const { year, month, day } = partsFromIso(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey(date);
}

function daysBetween(start: string, end: string): number {
  const startParts = partsFromIso(start);
  const endParts = partsFromIso(end);
  return Math.round((
    Date.UTC(endParts.year, endParts.month - 1, endParts.day) -
    Date.UTC(startParts.year, startParts.month - 1, startParts.day)
  ) / 86_400_000);
}

function localizedDate(value: string, locale: string): string {
  const { year, month, day } = partsFromIso(value);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function numericDateParts(
  sourceText: string | null,
  locale: string,
): { day: number; month: number; year: number | null } | null {
  if (!sourceText) return null;
  const match = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}))?$/.exec(sourceText.trim());
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;
  if (first > 31 || second > 31) return null;
  if (first > 12) return { day: first, month: second, year };
  if (second > 12) return { day: second, month: first, year };

  const sample = new Date(Date.UTC(2006, 10, 22));
  const order = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .formatToParts(sample)
    .filter((part) => part.type === 'day' || part.type === 'month')
    .map((part) => part.type);
  return order[0] === 'month'
    ? { day: second, month: first, year }
    : { day: first, month: second, year };
}

function resolveCalendarIntent(
  intent: DateIntent,
  request: TripCreationRequest,
): DateResolution {
  const numeric = intent.kind === 'NUMERIC_DATE'
    ? numericDateParts(intent.sourceText, request.locale)
    : null;
  if (intent.kind === 'NUMERIC_DATE' && !numeric) {
    return {
      value: null,
      status: 'INVALID',
      message: `“${intent.sourceText ?? 'That date'}” is not a supported complete numeric date.`,
      explicitYear: false,
    };
  }
  const day = numeric?.day ?? intent.day;
  const month = numeric?.month ?? intent.month;
  const suppliedYear = numeric?.year ?? intent.year;
  if (!day || !month) {
    return {
      value: null,
      status: 'INVALID',
      message: `“${intent.sourceText ?? 'That date'}” is not a complete calendar date.`,
      explicitYear: false,
    };
  }

  if (suppliedYear !== null) {
    const exact = calendarDate(suppliedYear, month, day);
    if (!exact) {
      return {
        value: null,
        status: 'INVALID',
        message: `“${intent.sourceText ?? `${day}/${month}/${suppliedYear}`}” is not a real calendar date.`,
        explicitYear: true,
      };
    }
    const value = dateKey(exact);
    return {
      value,
      status: value < request.referenceDate ? 'PAST' : 'EXPLICIT',
      message: value < request.referenceDate ? 'This is an explicit date in the past.' : null,
      explicitYear: true,
    };
  }

  let year = partsFromIso(request.referenceDate).year;
  for (let attempts = 0; attempts < 9; attempts += 1, year += 1) {
    const candidate = calendarDate(year, month, day);
    if (!candidate) continue;
    const value = dateKey(candidate);
    if (value >= request.referenceDate) {
      return {
        value,
        status: 'INTERPRETED',
        message: `Interpreted as the next occurrence of ${day} ${monthNames[month - 1]}.`,
        explicitYear: false,
      };
    }
  }

  return {
    value: null,
    status: 'INVALID',
    message: `“${intent.sourceText ?? 'That date'}” could not be resolved to a real date.`,
    explicitYear: false,
  };
}

export function resolveDateIntent(
  intent: DateIntent,
  request: TripCreationRequest,
): DateResolution {
  switch (intent.kind) {
    case 'MISSING':
      return { value: null, status: 'MISSING', message: null, explicitYear: false };
    case 'MONTH_ONLY':
      return {
        value: null,
        status: 'NEEDS_ATTENTION',
        message: `“${intent.sourceText ?? 'That month'}” needs a specific day.`,
        explicitYear: false,
      };
    case 'UNRESOLVED':
      return {
        value: null,
        status: 'NEEDS_ATTENTION',
        message: `“${intent.sourceText ?? 'That date'}” needs clarification.`,
        explicitYear: false,
      };
    case 'TODAY':
      return {
        value: request.referenceDate,
        status: 'INTERPRETED',
        message: `Interpreted “${intent.sourceText ?? 'today'}” using your local date.`,
        explicitYear: false,
      };
    case 'TOMORROW':
      return {
        value: addDays(request.referenceDate, 1),
        status: 'INTERPRETED',
        message: `Interpreted “${intent.sourceText ?? 'tomorrow'}” using your local date.`,
        explicitYear: false,
      };
    case 'THIS_FRIDAY': {
      const { year, month, day } = partsFromIso(request.referenceDate);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const daysUntilFriday = (5 - weekday + 7) % 7;
      return {
        value: addDays(request.referenceDate, daysUntilFriday),
        status: 'INTERPRETED',
        message: weekday === 5
          ? 'Interpreted “this Friday” as today.'
          : 'Interpreted “this Friday” as the next occurring Friday.',
        explicitYear: false,
      };
    }
    case 'NEXT_WEEKEND':
      return {
        value: null,
        status: 'NEEDS_ATTENTION',
        message: 'This weekend expression must be resolved as a date range.',
        explicitYear: false,
      };
    case 'CALENDAR_DATE':
    case 'NUMERIC_DATE':
      return resolveCalendarIntent(intent, request);
  }
}

function normalizedEvidence(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

const countryNamesByLocale = new Map<string, ReadonlySet<string>>();
const cityStateNamesByLocale = new Map<string, ReadonlySet<string>>();
const monthNamesByLocale = new Map<string, ReadonlySet<string>>();

function recognizedCountryNames(locale: string): ReadonlySet<string> {
  const cached = countryNamesByLocale.get(locale);
  if (cached) return cached;
  const names = new Set<string>();
  const displays = [
    new Intl.DisplayNames(['en'], { type: 'region' }),
    new Intl.DisplayNames([locale], { type: 'region' }),
  ];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
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

function recognizedCityStateNames(locale: string): ReadonlySet<string> {
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

function recognizedMonthNames(locale: string): ReadonlySet<string> {
  const cached = monthNamesByLocale.get(locale);
  if (cached) return cached;
  const names = new Set<string>();
  for (let month = 1; month <= 12; month += 1) {
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

function destinationCityMatchesSource(city: string | null, sourceText: string | null): boolean {
  if (!city || !sourceText) return false;
  const normalizedCity = normalizedEvidence(city);
  const normalizedSource = normalizedEvidence(sourceText);
  return normalizedSource === normalizedCity ||
    normalizedSource.startsWith(`${normalizedCity},`) ||
    normalizedSource.startsWith(`${normalizedCity} `);
}

function destinationEvidenceIsStandalone(sourceText: string | null, prompt: string): boolean {
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

function destinationSourceNeedsClarification(sourceText: string | null): boolean {
  if (!sourceText) return false;
  return /\b(?:maybe|perhaps|possibly|either|or|not|avoid|except|near|around|somewhere)\b/u
    .test(normalizedEvidence(sourceText));
}

function containsWholePhrase(haystack: string, needle: string): boolean {
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

function evidenceAppearsInPrompt(evidence: string | null, prompt: string): boolean {
  return Boolean(evidence && containsWholePhrase(prompt, evidence));
}

function explicitTripNameHasNamingCue(evidence: string | null, value: string | null): boolean {
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

function evidenceHasAmbiguousPromptContext(evidence: string | null, prompt: string): boolean {
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

function isCanonicalMissingDateIntent(intent: DateIntent): boolean {
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
  for (let month = 1; month <= 12; month += 1) {
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

function verifiedDateIntent(
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

function scalarEvidenceIsAmbiguous(evidence: string | null): boolean {
  if (!evidence) return false;
  const source = normalizedEvidence(evidence);
  return /\b(?:either|or|maybe|perhaps|possibly|about|around|approximately|roughly|unsure|not|might|could)\b/u
    .test(source) ||
    /\b(?:at\s+(?:least|most)|up\s+to|between|more\s+than|less\s+than|fewer\s+than|no\s+(?:more|fewer)\s+than)\b/u
      .test(source);
}

function travelerCountFromEvidence(evidence: string | null): number | null {
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

function travelerCountStatusFromEvidence(
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

function durationFromEvidence(
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

type VerifiedStayDuration = {
  value: number;
  unit: 'DAYS' | 'FULL_DAYS' | 'NIGHTS' | 'WEEKS';
  evidence: string;
};

function verifiedStayDuration(
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

function calendarIntentParts(
  intent: DateIntent,
  request: TripCreationRequest,
): { day: number; month: number } | null {
  if (intent.kind !== 'CALENDAR_DATE' && intent.kind !== 'NUMERIC_DATE') return null;
  const numeric = intent.kind === 'NUMERIC_DATE'
    ? numericDateParts(intent.sourceText, request.locale)
    : null;
  const day = numeric?.day ?? intent.day;
  const month = numeric?.month ?? intent.month;
  return day && month ? { day, month } : null;
}

function resolveCalendarIntentInYear(
  intent: DateIntent,
  year: number,
  request: TripCreationRequest,
  explanation: string,
): DateResolution | null {
  const parts = calendarIntentParts(intent, request);
  if (!parts) return null;
  const date = calendarDate(year, parts.month, parts.day);
  if (!date) return null;
  const value = dateKey(date);
  return {
    value,
    status: value < request.referenceDate ? 'PAST' : 'INTERPRETED',
    message: value < request.referenceDate
      ? `${explanation} This produces a date in the past.`
      : explanation,
    explicitYear: false,
  };
}

function resolveCalendarIntentWithinRange(
  intent: DateIntent,
  rangeStart: string,
  rangeEnd: string,
  request: TripCreationRequest,
): DateResolution | null {
  if (intent.year !== null) return null;
  const parts = calendarIntentParts(intent, request);
  if (!parts) return null;
  const startYear = partsFromIso(rangeStart).year;
  const endYear = partsFromIso(rangeEnd).year;
  const candidates: string[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const candidate = calendarDate(year, parts.month, parts.day);
    if (!candidate) continue;
    const value = dateKey(candidate);
    if (value >= rangeStart && value <= rangeEnd) candidates.push(value);
  }
  if (candidates.length !== 1) return null;
  const value = candidates[0]!;
  return {
    value,
    status: value < request.referenceDate ? 'PAST' : 'INTERPRETED',
    message: value < request.referenceDate
      ? 'The missing year was anchored to the trip range; this is a past date.'
      : 'The missing year was anchored to the resolved trip range.',
    explicitYear: false,
  };
}

export function resolveNextWeekend(referenceDate: string): WeekendResolution {
  isoDateSchema.parse(referenceDate);
  const { year, month, day } = partsFromIso(referenceDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 5) {
    const immediateStart = addDays(referenceDate, 1);
    const laterStart = addDays(referenceDate, 8);
    return {
      kind: 'ambiguous',
      message: 'On a Friday, “next weekend” could mean tomorrow or the weekend one week later.',
      choices: [
        { startDate: immediateStart, endDate: addDays(immediateStart, 1) },
        { startDate: laterStart, endDate: addDays(laterStart, 1) },
      ],
    };
  }

  const daysUntilSaturday = weekday >= 1 && weekday <= 4
    ? 6 - weekday
    : weekday === 6
      ? 7
      : 6;
  const startDate = addDays(referenceDate, daysUntilSaturday);
  return {
    kind: 'resolved',
    startDate,
    endDate: addDays(startDate, 1),
    message: 'Weekend means Saturday and Sunday; Friday is not included.',
  };
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

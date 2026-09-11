import { z } from 'zod';
import { isoDateSchema } from '../domain.js';
import { type DateIntent, type TripCreationRequest, tripDraftFieldStatusSchema } from './schemas.js';

export type DateResolution = {
  value: string | null;
  status: z.infer<typeof tripDraftFieldStatusSchema>;
  message: string | null;
  explicitYear: boolean;
};

export type WeekendResolution =
  | { kind: 'resolved'; startDate: string; endDate: string; message: string }
  | {
    kind: 'ambiguous';
    choices: Array<{ startDate: string; endDate: string }>;
    message: string;
  };

export const monthNames = [
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

export function partsFromIso(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

export function calendarDate(year: number, month: number, day: number): Date | null {
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

export function dateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(value: string, days: number): string {
  const { year, month, day } = partsFromIso(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return dateKey(date);
}

export function daysBetween(start: string, end: string): number {
  const startParts = partsFromIso(start);
  const endParts = partsFromIso(end);
  return Math.round((
    Date.UTC(endParts.year, endParts.month - 1, endParts.day) -
    Date.UTC(startParts.year, startParts.month - 1, startParts.day)
  ) / 86_400_000);
}

export function localizedDate(value: string, locale: string): string {
  const { year, month, day } = partsFromIso(value);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function numericDateParts(
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

export function resolveCalendarIntent(
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
  for (let attempts = 0;attempts < 9;attempts += 1, year += 1) {
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

export function calendarIntentParts(
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

export function resolveCalendarIntentInYear(
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

export function resolveCalendarIntentWithinRange(
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
  for (let year = startYear;year <= endYear;year += 1) {
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



export function calendarDateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function parseCalendarDate(value: string | undefined): Date | null {
  const key = value?.slice(0, 10);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || calendarDateKey(parsed) !== key ? null : parsed;
}

export function startOfCalendarMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addCalendarMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

export function addCalendarDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

export function moveCalendarMonth(date: Date, amount: number): Date {
  const targetMonth = addCalendarMonths(date, amount);
  const lastDay = new Date(Date.UTC(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonth.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return targetMonth;
}

export function currentCalendarDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function initialPickerMonth(value: string, min?: string, max?: string): Date {
  const minDate = parseCalendarDate(min);
  const maxDate = parseCalendarDate(max);
  let preferred = parseCalendarDate(value) ?? minDate ?? maxDate ?? currentCalendarDate();
  if (minDate && calendarDateKey(preferred) < calendarDateKey(minDate)) preferred = minDate;
  if (maxDate && calendarDateKey(preferred) > calendarDateKey(maxDate)) preferred = maxDate;
  return startOfCalendarMonth(preferred);
}

export function pickerDisplayValue(value: string, includeTime: boolean, locale: string): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  const dateLabel = date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = value.split('T')[1]?.slice(0, 5);
  return includeTime && time ? `${dateLabel}, ${time}` : dateLabel;
}

'use client';
import { PackingWorkspace } from './packing-workspace';
import { navigatePacking, usePackingNavigation } from '../lib/packing-navigation';

import { TripCalendar } from './trip-calendar';

import {
  cloneElement,
  isValidElement,
  type InputHTMLAttributes,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  activityDateTimeForStop,
  alignIncomingTripDraftStops,
  applyClarificationUpdates,
  appendTripStop,
  buildTripFollowUpPrompt,
  clarificationPathsConfirmedByEdit,
  confirmedTripDraftFieldState,
  dateTimeLocalToIso,
  dateTimeLocalToIsoPreserving,
  destinationAreaFromStops,
  draftToTripInput,
  explicitTripDraftPathsFromFollowUp,
  formatDateRange,
  graphqlRequest,
  isTripMinimumViable,
  isoToDateTimeLocal,
  localIsoDate,
  mergeTripDraft,
  mergeUnansweredClarificationQuestions,
  operations,
  protectedPathsAfterFollowUp,
  remapDirtyTripDraftPaths,
  remapCurrentTripDraftPathToIncoming,
  remapTripDraftPathAfterStopRemoval,
  removeTripStop,
  sortStopsByDate,
  stayDateTimesForStop,
  transportDateTimesForStops,
  tripDraftFieldStateMap,
  tripStopsForCreation,
  updateTripBoundaryDate,
  updateTripStopDate,
  type Activity,
  type GenerateTripDraftInput,
  type Stay,
  type TransportLeg,
  type Trip,
  type TripClarificationQuestion,
  type TripDraft,
  type TripDraftFieldState,
  type TripDraftFieldStatus,
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
  localityKind: 'UNKNOWN',
  cityResolution: 'UNRESOLVED',
});

const blankTrip = (): TripInput => ({
  name: '',
  destinationArea: '',
  startDate: '',
  endDate: '',
  travelerCount: null,
  stops: [blankStop()],
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="brand-logo"
      src="/brand/tripdock-logo.png"
      width="1863"
      height="844"
      alt="TripDock"
    />
  );
}

function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      aria-labelledby={titleId}
    >
      <div className="dialog-panel">
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
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

const fieldStatusPresentation: Record<TripDraftFieldStatus, { icon: string; label: string }> = {
  EXPLICIT: { icon: '✓', label: 'From your prompt' },
  INTERPRETED: { icon: '≈', label: 'Interpreted' },
  SUGGESTED: { icon: '?', label: 'Suggested' },
  CONFIRMED: { icon: '✓', label: 'Confirmed' },
  MISSING: { icon: '○', label: 'Missing' },
  NEEDS_ATTENTION: { icon: '!', label: 'Needs attention' },
  INVALID: { icon: '×', label: 'Invalid' },
  CONFLICTING: { icon: '!', label: 'Conflicting' },
  PAST: { icon: '↶', label: 'Past date' },
};

function Field({
  label,
  children,
  hint,
  fieldState,
  fillStatus,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  fieldState?: TripDraftFieldState;
  fillStatus?: 'auto' | 'suggested';
}) {
  const controlId = useId();
  const hintId = useId();
  const resolvedControlId = isValidElement<{ id?: string }>(children)
    ? children.props.id ?? controlId
    : controlId;
  const fieldMessage = fieldState &&
    ['NEEDS_ATTENTION', 'INVALID', 'CONFLICTING', 'PAST'].includes(fieldState.status)
    ? fieldState.message
    : hint;
  const control = isValidElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true';
  }>(children)
    ? cloneElement(children, {
        id: resolvedControlId,
        'aria-describedby': [children.props['aria-describedby'], fieldMessage ? hintId : null]
          .filter(Boolean)
          .join(' ') || undefined,
        'aria-invalid': ['INVALID', 'CONFLICTING'].includes(fieldState?.status ?? '') || undefined,
      })
    : children;
  const statusPresentation = fieldState
    ? fieldStatusPresentation[fieldState.status]
    : fillStatus === 'suggested'
      ? { icon: '≈', label: 'Suggested' }
      : fillStatus === 'auto'
        ? { icon: '↔', label: 'Auto-filled' }
        : null;
  const showsStatus = Boolean(
    statusPresentation &&
    !['EXPLICIT', 'CONFIRMED'].includes(fieldState?.status ?? '') &&
    !(fieldState?.status === 'MISSING' && !fieldState.blocking),
  );
  return (
    <div className="field" data-fill-status={fieldState?.status.toLowerCase() ?? fillStatus}>
      <div className="field-label">
        <label htmlFor={resolvedControlId}>{label}</label>
        {showsStatus && statusPresentation ? <span className="fill-status"><span aria-hidden="true">{statusPresentation.icon}</span> {statusPresentation.label}</span> : null}
      </div>
      {control}
      {fieldMessage ? <small id={hintId}>{fieldMessage}</small> : null}
    </div>
  );
}

function calendarDateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function parseCalendarDate(value: string | undefined): Date | null {
  const key = value?.slice(0, 10);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || calendarDateKey(parsed) !== key ? null : parsed;
}

function startOfCalendarMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addCalendarMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function addCalendarDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function moveCalendarMonth(date: Date, amount: number): Date {
  const targetMonth = addCalendarMonths(date, amount);
  const lastDay = new Date(Date.UTC(
    targetMonth.getUTCFullYear(),
    targetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  targetMonth.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return targetMonth;
}

function currentCalendarDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function initialPickerMonth(value: string, min?: string, max?: string): Date {
  const minDate = parseCalendarDate(min);
  const maxDate = parseCalendarDate(max);
  let preferred = parseCalendarDate(value) ?? minDate ?? maxDate ?? currentCalendarDate();
  if (minDate && calendarDateKey(preferred) < calendarDateKey(minDate)) preferred = minDate;
  if (maxDate && calendarDateKey(preferred) > calendarDateKey(maxDate)) preferred = maxDate;
  return startOfCalendarMonth(preferred);
}

function pickerDisplayValue(value: string, includeTime: boolean, locale: string): string {
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

type DatePickerInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'onChange' | 'readOnly' | 'type' | 'value'
> & {
  includeTime?: boolean;
  locale?: string;
  onValueChange: (value: string) => void;
  value: string;
};

function DatePickerInput({
  includeTime = false,
  locale = 'en-GB',
  onValueChange,
  value,
  min,
  max,
  required,
  disabled,
  className,
  onClick,
  onKeyDown,
  ...inputProps
}: DatePickerInputProps) {
  const minValue = typeof min === 'string' ? min.slice(0, 10) : undefined;
  const maxValue = typeof max === 'string' ? max.slice(0, 10) : undefined;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => initialPickerMonth(value, minValue, maxValue));
  const [focusedDate, setFocusedDate] = useState(() => value.slice(0, 10));
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusDayRef = useRef<HTMLButtonElement>(null);
  const shouldFocusDayRef = useRef(false);
  const popoverId = useId();
  const selectedDate = value.slice(0, 10);
  const selectedTime = value.split('T')[1]?.slice(0, 5) ?? '';
  const today = calendarDateKey(currentCalendarDate());
  const firstDayOfWeek = useMemo(() => {
    try {
      const localeWithWeekInfo = new Intl.Locale(locale) as Intl.Locale & {
        weekInfo?: { firstDay: number };
        getWeekInfo?: () => { firstDay: number };
      };
      return localeWithWeekInfo.weekInfo?.firstDay ?? localeWithWeekInfo.getWeekInfo?.().firstDay ?? 1;
    } catch {
      return 1;
    }
  }, [locale]);
  const firstDayAsUtcWeekday = firstDayOfWeek % 7;
  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const utcWeekday = (firstDayAsUtcWeekday + index) % 7;
    return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2024, 0, 7 + utcWeekday)))
      .replace(/\.$/, '');
  }), [firstDayAsUtcWeekday, locale]);

  const days = useMemo(() => {
    const firstWeekday = (visibleMonth.getUTCDay() - firstDayAsUtcWeekday + 7) % 7;
    const firstCell = new Date(visibleMonth);
    firstCell.setUTCDate(1 - firstWeekday);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell);
      date.setUTCDate(firstCell.getUTCDate() + index);
      return date;
    });
  }, [firstDayAsUtcWeekday, visibleMonth]);

  const isDateAvailable = (date: Date) => {
    const key = calendarDateKey(date);
    return (
      date.getUTCMonth() === visibleMonth.getUTCMonth() &&
      (!minValue || key >= minValue) &&
      (!maxValue || key <= maxValue)
    );
  };
  const firstFocusableDate = days.find(isDateAvailable);
  const focusDate = [focusedDate, selectedDate]
    .find((key) => days.some((date) => calendarDateKey(date) === key && isDateAvailable(date)))
    ?? (firstFocusableDate ? calendarDateKey(firstFocusableDate) : '');

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromFocusOutside = (event: FocusEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      inputRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('focusin', closeFromFocusOutside);
    document.addEventListener('keydown', closeFromEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('focusin', closeFromFocusOutside);
      document.removeEventListener('keydown', closeFromEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !shouldFocusDayRef.current || !focusDate) return;
    const frame = window.requestAnimationFrame(() => {
      focusDayRef.current?.focus();
      shouldFocusDayRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusDate, open, visibleMonth]);

  function openPicker() {
    if (disabled) return;
    setVisibleMonth(initialPickerMonth(value, minValue, maxValue));
    setFocusedDate(selectedDate);
    shouldFocusDayRef.current = true;
    setOpen(true);
  }

  function chooseDate(date: Date) {
    const nextDate = calendarDateKey(date);
    const nextValue = includeTime ? `${nextDate}T${selectedTime || '09:00'}` : nextDate;
    if (nextValue !== value) onValueChange(nextValue);
    setFocusedDate(nextDate);
    setVisibleMonth(startOfCalendarMonth(date));
    if (!includeTime) {
      setOpen(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      shouldFocusDayRef.current = true;
    }
  }

  function focusCalendarDate(date: Date) {
    const key = calendarDateKey(date);
    if ((minValue && key < minValue) || (maxValue && key > maxValue)) return;
    setFocusedDate(key);
    shouldFocusDayRef.current = true;
    const month = startOfCalendarMonth(date);
    if (calendarDateKey(month) !== calendarDateKey(visibleMonth)) {
      setVisibleMonth(month);
    } else {
      window.requestAnimationFrame(() => focusDayRef.current?.focus());
    }
  }

  function handleDayKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, date: Date) {
    let target: Date | null = null;
    const weekday = (date.getUTCDay() - firstDayAsUtcWeekday + 7) % 7;
    if (event.key === 'ArrowLeft') target = addCalendarDays(date, -1);
    if (event.key === 'ArrowRight') target = addCalendarDays(date, 1);
    if (event.key === 'ArrowUp') target = addCalendarDays(date, -7);
    if (event.key === 'ArrowDown') target = addCalendarDays(date, 7);
    if (event.key === 'Home') target = addCalendarDays(date, -weekday);
    if (event.key === 'End') target = addCalendarDays(date, 6 - weekday);
    if (event.key === 'PageUp') target = moveCalendarMonth(date, -1);
    if (event.key === 'PageDown') target = moveCalendarMonth(date, 1);
    if (!target) return;
    event.preventDefault();
    focusCalendarDate(target);
  }

  const previousMonth = addCalendarMonths(visibleMonth, -1);
  const nextMonth = addCalendarMonths(visibleMonth, 1);
  const previousMonthEnd = new Date(Date.UTC(
    previousMonth.getUTCFullYear(),
    previousMonth.getUTCMonth() + 1,
    0,
  ));
  const previousDisabled = Boolean(minValue && calendarDateKey(previousMonthEnd) < minValue);
  const nextDisabled = Boolean(maxValue && calendarDateKey(nextMonth) > maxValue);

  return (
    <div className="date-picker-control" ref={controlRef}>
      <input
        {...inputProps}
        ref={inputRef}
        className={['date-picker-input', className].filter(Boolean).join(' ')}
        type="text"
        value={pickerDisplayValue(value, includeTime, locale)}
        readOnly
        disabled={disabled}
        role="combobox"
        aria-required={required || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        placeholder={includeTime ? 'Select date and time' : 'Select date'}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) openPicker();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            openPicker();
          }
        }}
      />
      <span className="date-picker-indicator" aria-hidden="true">▦</span>
      {open ? (
        <div className="date-picker-popover" id={popoverId} role="dialog" aria-label={includeTime ? 'Choose date and time' : 'Choose date'}>
          <div className="date-picker-header">
            <button className="date-picker-nav" type="button" disabled={previousDisabled} onClick={() => setVisibleMonth(previousMonth)} aria-label="Previous month">‹</button>
            <strong>{visibleMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
            <button className="date-picker-nav" type="button" disabled={nextDisabled} onClick={() => setVisibleMonth(nextMonth)} aria-label="Next month">›</button>
          </div>
          <div className="date-picker-weekdays" aria-hidden="true">
            {weekdayLabels.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="date-picker-grid" role="group" aria-label="Calendar days">
            {days.map((date) => {
              const key = calendarDateKey(date);
              const outside = date.getUTCMonth() !== visibleMonth.getUTCMonth();
              const unavailable = Boolean((minValue && key < minValue) || (maxValue && key > maxValue));
              const selected = key === selectedDate;
              return (
                <button
                  ref={key === focusDate ? focusDayRef : undefined}
                  className={`date-picker-day${outside ? ' is-outside' : ''}${selected ? ' is-selected' : ''}${key === today ? ' is-today' : ''}`}
                   type="button"
                   key={key}
                   disabled={unavailable}
                   tabIndex={key === focusDate ? 0 : -1}
                   aria-label={date.toLocaleDateString(locale, { dateStyle: 'full', timeZone: 'UTC' })}
                  aria-pressed={selected}
                   aria-current={key === today ? 'date' : undefined}
                   onClick={() => chooseDate(date)}
                   onKeyDown={(event) => handleDayKeyDown(event, date)}
                >
                  {date.getUTCDate()}
                </button>
              );
            })}
          </div>
          {includeTime ? (
            <label className="date-picker-time">
              <span>Time</span>
              <input
                type="time"
                value={selectedTime}
                disabled={!selectedDate}
                onChange={(event) => {
                  if (event.target.value) onValueChange(`${selectedDate}T${event.target.value}`);
                }}
              />
            </label>
          ) : null}
          <div className="date-picker-actions">
            {!required && value ? <button className="button-text" type="button" onClick={() => { onValueChange(''); setOpen(false); inputRef.current?.focus(); }}>Clear</button> : <span />}
            <button className="button-secondary" type="button" onClick={() => { setOpen(false); inputRef.current?.focus(); }}>{includeTime ? 'Done' : 'Close'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TripFields({
  value,
  onChange,
  fieldStates,
  onFieldEdited,
  onFieldProtected,
  onFieldConfirmed,
  onFieldDerived,
  onStopRemoved,
  locale = 'en-GB',
  disabled = false,
}: {
  value: TripInput;
  onChange: (next: TripInput) => void;
  fieldStates?: ReadonlyMap<string, TripDraftFieldState>;
  onFieldEdited?: (
    path: string,
    value: string | number | null,
    nextInput: TripInput,
  ) => void;
  onFieldProtected?: (path: string) => void;
  onFieldConfirmed?: (path: string) => void;
  onFieldDerived?: (path: string, value: string | number | null) => void;
  onStopRemoved?: (index: number) => void;
  locale?: string;
  disabled?: boolean;
}) {
  const stopFieldKey = (index: number, field: keyof TripDraftStop) => `stops.${index}.${field}`;
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set(
    [...(fieldStates?.entries() ?? [])]
      .filter(([, state]) => state.status === 'CONFIRMED')
      .map(([path]) => path),
  ));
  const previousStops = useRef(value.stops);

  useEffect(() => {
    if (previousStops.current === value.stops) return;
    setDirtyFields((current) => remapDirtyTripDraftPaths(
      current,
      previousStops.current,
      value.stops,
    ));
    previousStops.current = value.stops;
  }, [value.stops]);

  function markDirty(
    key: string,
    confirm = true,
    fieldValue: string | number | null = null,
    nextInput: TripInput = value,
  ) {
    setDirtyFields((current) => new Set(current).add(key));
    if (confirm) onFieldEdited?.(key, fieldValue, nextInput);
    else onFieldProtected?.(key);
  }

  function markDerived(key: string, fieldValue: string | number | null) {
    setDirtyFields((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    onFieldDerived?.(key, fieldValue);
  }

  function updateTripField<K extends 'name' | 'travelerCount'>(field: K, fieldValue: TripInput[K]) {
    const next = { ...value, [field]: fieldValue };
    markDirty(`trip.${field}`, true, fieldValue, next);
    onChange(next);
  }

  function updateBoundary(boundary: 'start' | 'end', date: string) {
    const tripKey = boundary === 'start' ? 'trip.startDate' : 'trip.endDate';
    const stopIndex = boundary === 'start' ? 0 : value.stops.length - 1;
    const stopField = boundary === 'start' ? 'arrivalDate' : 'departureDate';
    const linkedKey = stopFieldKey(stopIndex, stopField);
    const next = updateTripBoundaryDate(value, boundary, date, {
      stopDateDirty: dirtyFields.has(linkedKey),
    });
    markDirty(tripKey, true, date, next);
    if (next.stops[stopIndex]?.[stopField] !== value.stops[stopIndex]?.[stopField]) {
      markDerived(linkedKey, next.stops[stopIndex]?.[stopField] ?? null);
    }
    onChange(next);
  }

  function updateStop(index: number, patch: Partial<TripDraftStop>) {
    const normalizedPatch = Object.hasOwn(patch, 'name')
      ? {
          ...patch,
          locationText: null,
          localityKind: 'UNKNOWN' as const,
          cityResolution: 'UNRESOLVED' as const,
        }
      : patch;
    if (Object.hasOwn(patch, 'name')) {
      markDirty(stopFieldKey(index, 'localityKind'), false);
      markDirty(stopFieldKey(index, 'cityResolution'), false);
    }
    const next = {
      ...value,
      stops: (index === value.stops.length ? appendTripStop(value, { lastDepartureDirty: dirtyFields.has(stopFieldKey(index - 1, 'departureDate')) }).stops : value.stops).map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...normalizedPatch } : stop,
      ),
    };
    for (const field of Object.keys(patch) as Array<keyof TripDraftStop>) {
      const fieldValue = patch[field];
      markDirty(
        stopFieldKey(index, field),
        field !== 'name',
        typeof fieldValue === 'string' || fieldValue === null ? fieldValue : null,
        next,
      );
    }
    onChange(next);
  }

  function updateStopDate(
    index: number,
    field: 'arrivalDate' | 'departureDate',
    date: string,
  ) {
    const fieldKey = stopFieldKey(index, field);
    const nextArrivalKey = stopFieldKey(index + 1, 'arrivalDate');
    const next = updateTripStopDate(value, index, field, date || null, {
      nextArrivalDirty: dirtyFields.has(nextArrivalKey),
      tripBoundaryDirty: dirtyFields.has(
        field === 'arrivalDate' ? 'trip.startDate' : 'trip.endDate',
      ),
    });
    markDirty(fieldKey, true, date || null, next);
    if (field === 'departureDate' && next.stops[index + 1]?.arrivalDate !== value.stops[index + 1]?.arrivalDate) {
      markDerived(nextArrivalKey, next.stops[index + 1]?.arrivalDate ?? null);
    }
    if (index === 0 && field === 'arrivalDate' && next.startDate !== value.startDate) {
      markDerived('trip.startDate', next.startDate);
    }
    if (index === value.stops.length - 1 && field === 'departureDate' && next.endDate !== value.endDate) {
      markDerived('trip.endDate', next.endDate);
    }
    onChange(next);
  }

  function removeStop(index: number) {
    const survivingDepartureKey = stopFieldKey(index - 1, 'departureDate');
    const next = removeTripStop(value, index, {
      preserveTripEnd: Boolean(value.stops[index]?.departureDate),
      survivingDepartureDirty: dirtyFields.has(survivingDepartureKey),
    });
    if (next.startDate !== value.startDate) markDerived('trip.startDate', next.startDate);
    if (next.endDate !== value.endDate) markDerived('trip.endDate', next.endDate);
    const lastIndex = next.stops.length - 1;
    const previousLastIndex = lastIndex >= index ? lastIndex + 1 : lastIndex;
    if (lastIndex >= 0 && next.stops[lastIndex]?.departureDate !== value.stops[previousLastIndex]?.departureDate) {
      markDerived(stopFieldKey(lastIndex, 'departureDate'), next.stops[lastIndex]?.departureDate ?? null);
    }
    onChange(next);
    onStopRemoved?.(index);
  }

  return (
    <fieldset disabled={disabled} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
      <div className="form-stack">
      <div className="form-grid form-grid-two">
        <Field label="Start date" fieldState={fieldStates?.get('trip.startDate')}><DatePickerInput locale={locale} required max={value.endDate || undefined} value={value.startDate} onValueChange={(date) => updateBoundary('start', date)} /></Field>
        <Field label="End date" fieldState={fieldStates?.get('trip.endDate')}><DatePickerInput locale={locale} required min={value.startDate || undefined} value={value.endDate} onValueChange={(date) => updateBoundary('end', date)} /></Field>

      </div>
      <fieldset className="stops-editor">
        <legend>Destinations</legend>
        {(value.stops.at(-1)?.name.trim() ? [...value.stops, blankStop()] : value.stops).map((stop, index) => (
          <div className="draft-stop" role="group" aria-label={`Destination ${index + 1}`} key={stop.draftId ?? `draft-stop-${index}`}>
            <div className="draft-stop-heading">
              <strong>{index === 0 ? 'Your destination' : stop.name ? `Destination ${index + 1}` : 'Anywhere else?'}</strong>
              <button className="icon-button remove-destination" type="button" disabled={value.stops.length === 1 || index === value.stops.length} aria-label={`Remove destination ${index + 1}`} onClick={() => removeStop(index)}>×</button>
            </div>
            <div className="destination-fields">
              <Field label="City" fieldState={fieldStates?.get(stopFieldKey(index, 'name'))}><input value={stop.name} onChange={(event) => updateStop(index, { name: event.target.value })} onBlur={(event) => { const city = event.currentTarget.value.trim(); if (!city) return; onChange({ ...value, stops: value.stops.map((item, stopIndex) => stopIndex === index ? { ...item, name: city, localityKind: 'CITY', cityResolution: 'RESOLVED' } : item) }); onFieldConfirmed?.(stopFieldKey(index, 'name')); onFieldConfirmed?.(stopFieldKey(index, 'localityKind')); onFieldConfirmed?.(stopFieldKey(index, 'cityResolution')); }} placeholder="A specific city" /></Field>
              {(value.stops.filter((item) => item.name.trim()).length > 1 || (stop.arrivalDate && stop.arrivalDate !== value.startDate) || (stop.departureDate && stop.departureDate !== value.endDate) || fieldStates?.get(stopFieldKey(index, 'arrivalDate'))?.blocking || fieldStates?.get(stopFieldKey(index, 'departureDate'))?.blocking) && stop.name.trim() ? <><Field label="Start" fieldState={fieldStates?.get(stopFieldKey(index, 'arrivalDate'))}><DatePickerInput locale={locale} min={value.startDate || undefined} max={(stop.departureDate ?? value.endDate) || undefined} value={stop.arrivalDate ?? ''} onValueChange={(date) => updateStopDate(index, 'arrivalDate', date)} /></Field>
              <Field label="End" fieldState={fieldStates?.get(stopFieldKey(index, 'departureDate'))}><DatePickerInput locale={locale} min={(stop.arrivalDate ?? value.startDate) || undefined} max={value.endDate || undefined} value={stop.departureDate ?? ''} onValueChange={(date) => updateStopDate(index, 'departureDate', date)} /></Field></> : null}
            </div>
          </div>
        ))}

      </fieldset>
      <div className="form-grid">
        <Field label="Trip name" fieldState={fieldStates?.get('trip.name')}>
          <input maxLength={160} value={value.name} onChange={(event) => updateTripField('name', event.target.value)} placeholder="A name you’ll recognize" />
        </Field>
      </div>

      </div>
    </fieldset>
  );
}

function nightCount(startDate: string | null | undefined, endDate: string | null | undefined): number | null {
  const start = parseCalendarDate(startDate ?? undefined);
  const end = parseCalendarDate(endDate ?? undefined);
  if (!start || !end || end < start) return null;
  return Math.round((end.valueOf() - start.valueOf()) / 86_400_000);
}

function dateRangeLabel(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  locale: string,
): string {
  if (startDate && endDate) {
    return `${pickerDisplayValue(startDate, false, locale)} – ${pickerDisplayValue(endDate, false, locale)}`;
  }
  if (startDate) return `From ${pickerDisplayValue(startDate, false, locale)}`;
  if (endDate) return `Until ${pickerDisplayValue(endDate, false, locale)}`;
  return 'Dates not set';
}

function DraftReviewSummary({
  form,
  fieldStates,
  locale,
}: {
  form: TripInput;
  fieldStates: ReadonlyMap<string, TripDraftFieldState>;
  locale: string;
}) {
  const totalNights = nightCount(form.startDate, form.endDate);
  const sharesTransferDate = form.stops.some((stop, index) =>
    Boolean(stop.departureDate && stop.departureDate === form.stops[index + 1]?.arrivalDate),
  );
  return (
    <section className="draft-overview" aria-labelledby="draft-overview-title">
      <div className="draft-overview-heading">
        <div>
          <p className="section-kicker">Your draft at a glance</p>
          <h3 id="draft-overview-title">{form.name.trim() || form.destinationArea.trim() || 'New trip'}</h3>
          <p>{dateRangeLabel(form.startDate, form.endDate, locale)}{totalNights === null ? '' : ` · ${totalNights + 1} days · ${totalNights} ${totalNights === 1 ? 'night' : 'nights'}`}</p>
        </div>
      </div>
      <div className="draft-status-key" aria-label="Field status key">
        <span><b aria-hidden="true">✓</b> Direct or confirmed</span>
        <span><b aria-hidden="true">≈</b> Interpreted — check</span>
        <span><b aria-hidden="true">!</b> Needs input</span>
      </div>
      <ol className="draft-route-summary">
        {form.stops.map((stop, index) => {
          const nights = nightCount(stop.arrivalDate, stop.departureDate);
          const dateStates = [
            fieldStates.get(`stops.${index}.arrivalDate`),
            fieldStates.get(`stops.${index}.departureDate`),
          ].filter((state): state is TripDraftFieldState => Boolean(state));
          const interpreted = dateStates.some((state) =>
            ['INTERPRETED', 'SUGGESTED'].includes(state.status),
          );
          return (
            <li key={stop.draftId ?? `${stop.name}-${index}`}>
              <span className="route-number" aria-hidden="true">{index + 1}</span>
              <div><strong>{stop.name.trim() || `Destination ${index + 1}`}</strong><span>{dateRangeLabel(stop.arrivalDate, stop.departureDate, locale)}{nights === null ? '' : ` · ${nights} ${nights === 1 ? 'night' : 'nights'}`}</span></div>
              {interpreted ? <span className="route-interpretation"><span aria-hidden="true">≈</span> Dates interpreted</span> : null}
            </li>
          );
        })}
      </ol>
      {sharesTransferDate ? <p className="transfer-date-note"><span aria-hidden="true">↔</span><span><strong>Shared transfer dates are expected.</strong> You can leave one city and arrive in the next on the same date without overlapping a night.</span></p> : null}
    </section>
  );
}

function CreateTripDialog({
  initialDraft,
  sourcePrompt,
  onClose,
  onCreated,
}: {
  initialDraft?: TripDraft;
  sourcePrompt?: string;
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
  const [followUpHistory, setFollowUpHistory] = useState<string[]>([]);
  const [followUpBusy, setFollowUpBusy] = useState(false);
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

  function valueAtPath(input: TripInput, path: string): unknown {
    const tripMatch = /^trip\.(name|destinationArea|startDate|endDate|travelerCount)$/.exec(path);
    if (tripMatch) {
      return input[tripMatch[1] as keyof Pick<TripInput, 'name' | 'destinationArea' | 'startDate' | 'endDate' | 'travelerCount'>];
    }
    const stopMatch = /^stops\.(\d+)\.(name|locationText|arrivalDate|departureDate|localityKind|cityResolution)$/.exec(path);
    if (!stopMatch) return undefined;
    return input.stops[Number(stopMatch[1])]?.[stopMatch[2] as keyof TripDraftStop];
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
    if (!followUp.trim() || followUpBusy) return;
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
      const incoming = alignIncomingTripDraftStops(form, data.generateTripDraft, answer, questions);
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
        [...protectedPaths.current]
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
      protectedPaths.current = nextProtected;
      const mergedForm = mergeTripDraft(form, incoming, mergeProtected);
      setForm(mergedForm);
      setFieldStates(() => {
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
      });
      const nextQuestions = mergeUnansweredClarificationQuestions(
        alignedQuestions,
        incoming.questions,
        answerPaths,
      );
      setQuestions(nextQuestions);
      setNotes({ assumptions: incoming.assumptions, warnings: incoming.warnings });
      setFollowUpHistory((current) => [...current, `${messageReferenceDate}: ${answer}`].slice(-8));
      setFollowUp('');
      setSelectedOptions({});
      setStage(nextQuestions.some((item) => item.blocking) ? 'clarify' : 'review');
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

  function renderQuestionStage(
    visibleQuestions: readonly TripClarificationQuestion[],
    blocking: boolean,
  ) {
    return (
      <div className="creation-question-stage">
        <div className="creation-stage-intro">
          <p className="section-kicker">{blocking ? 'Before we build the draft' : 'AI follow-up'}</p>
          <h3>{blocking ? 'A few details need a clear answer' : 'What should TripDock adjust?'}</h3>
          <p>{blocking ? 'These answers affect the essential destination or dates. Answer them together, then we’ll show you the interpreted trip.' : visibleQuestions.length ? 'Answer any of the suggested questions, or describe the adjustment in your own words. We’ll bring you back to an updated summary.' : 'Describe the adjustment in your own words. We’ll interpret it and bring you back to an updated summary.'}</p>
        </div>
        <div className="clarification-list">
          {visibleQuestions.map((item, index) => (
            <fieldset className="clarification-question" key={item.id} disabled={followUpBusy}>
              <legend><span className="question-number">{index + 1}</span><span>{item.prompt}</span></legend>
              {item.options.length ? <div className="clarification-options">{item.options.map((option) => <label key={option.id}><input type="radio" name={`question-${item.id}`} value={option.id} checked={selectedOptions[item.id] === option.id} onChange={() => setSelectedOptions((current) => ({ ...current, [item.id]: option.id }))} /><span>{option.label}</span></label>)}</div> : <p className="clarification-free-note">Include this in the message below.</p>}
            </fieldset>
          ))}
        </div>
        {visibleQuestions.some((item) => item.options.length) ? <button className="button-secondary apply-quick-answers" type="button" onClick={applySelectedAnswers} disabled={followUpBusy || !Object.keys(selectedOptions).length}>{blocking ? 'Continue with selected answers' : 'Use selected answers'}</button> : null}
        <div className="follow-up-compose">
          <label htmlFor="trip-draft-follow-up">{blocking ? 'Or answer everything in one message' : 'Tell TripDock what to adjust'}</label>
          <textarea id="trip-draft-follow-up" rows={4} maxLength={1500} value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder={blocking ? 'For example: Bristol, 10–14 May, using the later weekend.' : 'For example: Keep the proposed dates, but give Rome one extra night.'} disabled={followUpBusy} />
          <button className="button-primary" type="button" onClick={() => void submitFollowUp()} disabled={followUpBusy || !followUp.trim()}>{followUpBusy ? 'Updating your draft…' : 'Update interpreted draft'}</button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button>{!blocking ? <button className="button-secondary" type="button" onClick={() => { setSelectedOptions({}); setStage('review'); }}>Back to summary</button> : <small className="creation-stage-note">Your trip summary appears after the essentials are clear.</small>}</footer>
      </div>
    );
  }

  return (
    <Dialog title={stage === 'clarify' ? 'A few details first' : stage === 'refine' ? 'Ask TripDock' : stage === 'edit' ? (initialDraft ? 'Trip details' : 'Create a trip') : 'Review your trip'} onClose={onClose} wide>
      {stage === 'clarify'
        ? renderQuestionStage(blockingQuestions, true)
        : stage === 'refine'
          ? renderQuestionStage(optionalQuestions, false)
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
    </Dialog>
  );
}

function HomeDraftComposer({ onDraft }: { onDraft: (draft: TripDraft, prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: GenerateTripDraftInput = {
        prompt: prompt.trim(),
        locale: navigator.language || 'en-GB',
        timeZone: deviceTimezone() ?? 'UTC',
        referenceDate: localIsoDate(),
      };
      const data = await graphqlRequest<
        { generateTripDraft: TripDraft },
        { input: GenerateTripDraftInput }
      >(operations.generateDraft, { input });
      const draft = data.generateTripDraft;
      onDraft(draft, prompt.trim());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-compose" aria-labelledby="home-compose-title">
      <div>
        <p className="section-kicker">Start with an idea</p>
        <h2 id="home-compose-title">Describe your trip</h2>
        <p>Share the places and dates you already know. You can edit every detail before creating it.</p>
      </div>
      <form onSubmit={(event) => void generateDraft(event)} aria-busy={busy}>
        <label htmlFor="home-trip-prompt">What do you have in mind?</label>
        <textarea id="home-trip-prompt" rows={8} maxLength={5000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ten days in Japan for two people, starting in Tokyo and ending in Kyoto…" />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button-primary" type="submit" disabled={busy || !prompt.trim()}>{busy ? 'Building your draft…' : 'Build a trip draft'}</button>
      </form>
    </section>
  );
}

function TripEditor({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const initialInput = { name: trip.name, destinationArea: trip.destinationArea, startDate: trip.startDate, endDate: trip.endDate, travelerCount: trip.travelerCount };
  const [input, setInput] = useState(() => initialInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = JSON.stringify(input) === JSON.stringify(initialInput);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const data = await graphqlRequest<{ updateTrip: Trip }, { id: string; expectedRevision: number; input: typeof input }>(operations.updateTrip, { id: trip.id, expectedRevision: trip.revision, input });
      onSaved(data.updateTrip);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title="Edit trip essentials" onClose={onClose} wide>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Trip name"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <div className="form-grid form-grid-three"><Field label="Start date"><DatePickerInput required max={input.endDate || undefined} value={input.startDate} onValueChange={(date) => setInput({ ...input, startDate: date })} /></Field><Field label="End date"><DatePickerInput required min={input.startDate} value={input.endDate} onValueChange={(date) => setInput({ ...input, endDate: date })} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </Dialog>
  );
}

type EntityEditor =
  | { kind: 'trip' }
  | { kind: 'stop'; value?: TripStop }
  | { kind: 'transport'; value?: TransportLeg; fromStopId?: string | null; toStopId?: string | null }
  | { kind: 'stay'; value?: Stay; stopId?: string }
  | { kind: 'activity'; value?: Activity; stopId?: string; scheduledLocal?: string }
  | null;

function StopEditor({ trip, stop, onClose, onSaved }: { trip: Trip; stop?: TripStop; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const previous = sortedStops.at(-1);
  const previousHoldsTripEnd = previous?.departureDate === trip.endDate;
  const initialInput: TripDraftStop = stop
    ? { name: stop.name, locationText: stop.locationText, arrivalDate: stop.arrivalDate, departureDate: stop.departureDate }
    : {
      ...blankStop(),
      arrivalDate: previousHoldsTripEnd ? null : previous?.departureDate ?? null,
      departureDate: trip.endDate,
    };
  const [input, setInput] = useState<TripDraftStop>(() => initialInput);
  const [autoDates, setAutoDates] = useState(() => ({
    arrivalDate: !stop && Boolean(previous?.departureDate) && !previousHoldsTripEnd,
    departureDate: !stop && Boolean(trip.endDate),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(stop && JSON.stringify(input) === JSON.stringify(initialInput));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const variables = stop
        ? { id: stop.id, expectedRevision: trip.revision, input }
        : { tripId: trip.id, expectedRevision: trip.revision, input, moveTripEnd: autoDates.departureDate };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stop ? operations.updateStop : operations.addStop, variables);
      onSaved(data[stop ? 'updateTripStop' : 'addTripStop']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }
  return (
    <Dialog title={stop ? 'Edit destination' : 'Add destination'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination"><input required value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Start" fillStatus={autoDates.arrivalDate ? 'auto' : undefined}><DatePickerInput min={trip.startDate} max={(input.departureDate ?? trip.endDate) || undefined} value={input.arrivalDate ?? ''} onValueChange={(date) => { setAutoDates((current) => ({ ...current, arrivalDate: false })); setInput({ ...input, arrivalDate: date || null }); }} /></Field><Field label="End" fillStatus={autoDates.departureDate ? 'auto' : undefined}><DatePickerInput min={(input.arrivalDate ?? trip.startDate) || undefined} max={trip.endDate} value={input.departureDate ?? ''} onValueChange={(date) => { setAutoDates((current) => ({ ...current, departureDate: false })); setInput({ ...input, departureDate: date || null }); }} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save destination'}</button></footer></form>
    </Dialog>
  );
}

function transportTitle(fromStop: TripStop | undefined, toStop: TripStop | undefined): string {
  if (fromStop && toStop && fromStop.id === toStop.id) return '';
  return `${fromStop?.name ?? 'Origin'} to ${toStop?.name ?? 'Return point'}`;
}

function TransportEditor({ trip, leg, fromStopId, toStopId, onClose, onSaved }: { trip: Trip; leg?: TransportLeg; fromStopId?: string | null; toStopId?: string | null; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = leg?.timezone ?? deviceTimezone();
  const initialFromStopId = (leg ? leg.fromStopId : fromStopId !== undefined ? fromStopId : sortedStops[0]?.id) ?? '';
  const initialToStopId = (leg ? leg.toStopId : toStopId !== undefined ? toStopId : sortedStops[1]?.id) ?? '';
  const initialFromStop = sortedStops.find((stop) => stop.id === initialFromStopId);
  const initialToStop = sortedStops.find((stop) => stop.id === initialToStopId);
  const initialTimes = transportDateTimesForStops(initialFromStop, initialToStop);
  const initialInput = {
    fromLocation: leg?.fromLocation ?? '',
    toLocation: leg?.toLocation ?? '',
    fromStopId: initialFromStopId,
    toStopId: initialToStopId,
    mode: leg?.mode ?? '',
    title: leg?.title ?? transportTitle(initialFromStop, initialToStop),
    details: leg?.details ?? null,
    departureTime: leg ? isoToDateTimeLocal(leg.departureTime, localTimezone) : initialTimes.departureTime,
    arrivalTime: leg ? isoToDateTimeLocal(leg.arrivalTime, localTimezone) : initialTimes.arrivalTime,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [dirtySuggested, setDirtySuggested] = useState(() => ({
    title: Boolean(leg),
    departureTime: Boolean(leg),
    arrivalTime: Boolean(leg),
  }));
  const [autoFields, setAutoFields] = useState(() => ({
    fromStopId: !leg && Boolean(initialFromStopId),
    toStopId: !leg && Boolean(initialToStopId),
    title: !leg && Boolean(transportTitle(initialFromStop, initialToStop)),
    departureTime: !leg && Boolean(initialTimes.departureTime),
    arrivalTime: !leg && Boolean(initialTimes.arrivalTime),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeInvalid = input.fromStopId === input.toStopId;
  const unchanged = Boolean(leg && JSON.stringify(input) === JSON.stringify(initialInput));
  const timesUnchanged = input.departureTime === initialInput.departureTime &&
    input.arrivalTime === initialInput.arrivalTime;

  function selectRoute(field: 'fromStopId' | 'toStopId', stopId: string) {
    const nextFromStopId = field === 'fromStopId' ? stopId : input.fromStopId;
    const nextToStopId = field === 'toStopId' ? stopId : input.toStopId;
    const nextFromStop = sortedStops.find((stop) => stop.id === nextFromStopId);
    const nextToStop = sortedStops.find((stop) => stop.id === nextToStopId);
    const times = transportDateTimesForStops(nextFromStop, nextToStop);
    const title = transportTitle(nextFromStop, nextToStop);
    setInput((current) => ({
      ...current,
      [field]: stopId,
      title: dirtySuggested.title ? current.title : title,
      departureTime: dirtySuggested.departureTime ? current.departureTime : times.departureTime,
      arrivalTime: dirtySuggested.arrivalTime ? current.arrivalTime : times.arrivalTime,
    }));
    setAutoFields((current) => ({
      ...current,
      [field]: false,
      title: dirtySuggested.title ? current.title : Boolean(title),
      departureTime: dirtySuggested.departureTime ? current.departureTime : Boolean(times.departureTime),
      arrivalTime: dirtySuggested.arrivalTime ? current.arrivalTime : Boolean(times.arrivalTime),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        fromStopId: input.fromStopId || null,
        toStopId: input.toStopId || null,
        fromLocation: input.fromStopId ? null : input.fromLocation,
        toLocation: input.toStopId ? null : input.toLocation,
        departureTime: leg
          ? dateTimeLocalToIsoPreserving(input.departureTime, input.timezone, leg.departureTime)
          : dateTimeLocalToIso(input.departureTime, input.timezone),
        arrivalTime: leg
          ? dateTimeLocalToIsoPreserving(input.arrivalTime, input.timezone, leg.arrivalTime)
          : dateTimeLocalToIso(input.arrivalTime, input.timezone),
        timezone: leg && timesUnchanged && input.timezone === initialInput.timezone ? leg.timezone : input.timezone,
      };
      const variables = leg ? { id: leg.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(leg ? operations.updateTransport : operations.addTransport, variables);
      onSaved(data[leg ? 'updateTransportLeg' : 'addTransportLeg']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={leg ? 'Edit transport' : 'Add transport'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <div className="form-grid form-grid-two"><Field label="From" fillStatus={autoFields.fromStopId ? 'auto' : undefined}><select value={input.fromStopId} onChange={(e) => selectRoute('fromStopId', e.target.value)}><option value="">Home / other origin</option>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.toStopId}>{stop.name}</option>)}</select></Field><Field label="To" fillStatus={autoFields.toStopId ? 'auto' : undefined}><select value={input.toStopId} onChange={(e) => selectRoute('toStopId', e.target.value)}><option value="">Home / return point</option>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.fromStopId}>{stop.name}</option>)}</select></Field></div>
        {!input.fromStopId ? <Field label="Origin"><input required value={input.fromLocation} onChange={(e) => setInput({ ...input, fromLocation: e.target.value })} placeholder="Home city or departure airport" /></Field> : null}
        {!input.toStopId ? <Field label="Return point"><input required value={input.toLocation} onChange={(e) => setInput({ ...input, toLocation: e.target.value })} placeholder="Home city or arrival airport" /></Field> : null}
        <div className="form-grid form-grid-two"><Field label="Mode"><input required value={input.mode} onChange={(e) => setInput({ ...input, mode: e.target.value })} placeholder="Train, flight, ferry…" /></Field><Field label="Title" fillStatus={autoFields.title ? 'auto' : undefined}><input required value={input.title} onChange={(e) => { setDirtySuggested((current) => ({ ...current, title: true })); setAutoFields((current) => ({ ...current, title: false })); setInput({ ...input, title: e.target.value }); }} /></Field></div>
        <details className="advanced-details"><summary>Notes and booking details</summary><Field label="Details"><textarea rows={2} value={input.details ?? ''} onChange={(e) => setInput({ ...input, details: e.target.value || null })} placeholder="Booking reference, route notes, or anything useful" /></Field></details>
        <div className="form-grid form-grid-two"><Field label="Departure" fillStatus={autoFields.departureTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.departureTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, departureTime: true })); setAutoFields((current) => ({ ...current, departureTime: false })); setInput({ ...input, departureTime: dateTime || null }); }} /></Field><Field label="Arrival" fillStatus={autoFields.arrivalTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.arrivalTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, arrivalTime: true })); setAutoFields((current) => ({ ...current, arrivalTime: false })); setInput({ ...input, arrivalTime: dateTime || null }); }} /></Field></div>
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
        {routeInvalid ? <p className="form-error">Choose two different destinations for this route.</p> : null}
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || routeInvalid || unchanged} type="submit">{busy ? 'Saving…' : 'Save transport'}</button></footer></form>
    </Dialog>
  );
}

function StayEditor({ trip, stay, stopId, onClose, onSaved }: { trip: Trip; stay?: Stay; stopId?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = stay?.timezone ?? deviceTimezone();
  const initialStopId = stay?.stopId ?? stopId ?? sortedStops[0]?.id ?? '';
  const initialStop = sortedStops.find((stop) => stop.id === initialStopId);
  const initialDefaults = stayDateTimesForStop(initialStop);
  const initialName = initialStop ? `Stay in ${initialStop.name}` : '';
  const initialInput = {
    stopId: initialStopId,
    name: stay?.name ?? initialName,
    checkIn: stay ? isoToDateTimeLocal(stay.checkIn, localTimezone) : initialDefaults.checkIn,
    checkOut: stay ? isoToDateTimeLocal(stay.checkOut, localTimezone) : initialDefaults.checkOut,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [dirtySuggested, setDirtySuggested] = useState(() => ({ name: Boolean(stay), checkIn: Boolean(stay), checkOut: Boolean(stay) }));
  const [autoFields, setAutoFields] = useState(() => ({
    stopId: !stay && Boolean(initialStopId),
    name: !stay && Boolean(initialName),
    checkIn: !stay && Boolean(initialDefaults.checkIn),
    checkOut: !stay && Boolean(initialDefaults.checkOut),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(stay && JSON.stringify(input) === JSON.stringify(initialInput));
  const timesUnchanged = input.checkIn === initialInput.checkIn && input.checkOut === initialInput.checkOut;
  function selectStop(nextStopId: string) {
    const nextStop = sortedStops.find((stop) => stop.id === nextStopId);
    const defaults = stayDateTimesForStop(nextStop);
    const name = nextStop ? `Stay in ${nextStop.name}` : '';
    setInput((current) => ({
      ...current,
      stopId: nextStopId,
      name: dirtySuggested.name ? current.name : name,
      checkIn: dirtySuggested.checkIn ? current.checkIn : defaults.checkIn,
      checkOut: dirtySuggested.checkOut ? current.checkOut : defaults.checkOut,
    }));
    setAutoFields((current) => ({
      ...current,
      stopId: false,
      name: dirtySuggested.name ? current.name : Boolean(name),
      checkIn: dirtySuggested.checkIn ? current.checkIn : Boolean(defaults.checkIn),
      checkOut: dirtySuggested.checkOut ? current.checkOut : Boolean(defaults.checkOut),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        checkIn: stay
          ? dateTimeLocalToIsoPreserving(input.checkIn, input.timezone, stay.checkIn)
          : dateTimeLocalToIso(input.checkIn, input.timezone),
        checkOut: stay
          ? dateTimeLocalToIsoPreserving(input.checkOut, input.timezone, stay.checkOut)
          : dateTimeLocalToIso(input.checkOut, input.timezone),
        timezone: stay && timesUnchanged && input.timezone === initialInput.timezone ? stay.timezone : input.timezone,
      };
      const variables = stay ? { id: stay.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stay ? operations.updateStay : operations.addStay, variables);
      onSaved(data[stay ? 'updateStay' : 'addStay']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={stay ? 'Edit stay' : 'Add stay'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <details className="advanced-details"><summary>{trip.stops.find((stop) => stop.id === input.stopId)?.name} · change destination</summary><Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field></details>
        <Field label="Stay name" fillStatus={autoFields.name ? 'auto' : undefined}><input required value={input.name} onChange={(e) => { setDirtySuggested((current) => ({ ...current, name: true })); setAutoFields((current) => ({ ...current, name: false })); setInput({ ...input, name: e.target.value }); }} /></Field>
        <div className="form-grid form-grid-two"><Field label="Check-in" fillStatus={autoFields.checkIn ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkIn ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkIn: true })); setAutoFields((current) => ({ ...current, checkIn: false })); setInput({ ...input, checkIn: dateTime || null }); }} /></Field><Field label="Check-out" fillStatus={autoFields.checkOut ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkOut ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkOut: true })); setAutoFields((current) => ({ ...current, checkOut: false })); setInput({ ...input, checkOut: dateTime || null }); }} /></Field></div>
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save stay'}</button></footer></form>
    </Dialog>
  );
}

function ActivityEditor({ trip, activity, stopId, scheduledLocal, onClose, onSaved }: { trip: Trip; activity?: Activity; stopId?: string; scheduledLocal?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = activity?.timezone ?? deviceTimezone();
  const initialStopId = activity?.stopId ?? stopId ?? sortedStops[0]?.id ?? '';
  const initialInput = {
    stopId: initialStopId,
    title: activity?.title ?? '',
    status: activity?.status ?? 'IDEA' as Activity['status'],
    durationMinutes: activity?.durationMinutes ?? 60,
    scheduledAt: activity ? isoToDateTimeLocal(activity.scheduledAt, localTimezone) : scheduledLocal ?? null,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [autoFields, setAutoFields] = useState(() => ({
    stopId: !activity && Boolean(initialStopId),
    status: !activity,
    scheduledAt: false,
  }));
  const suggestedTime = activityDateTimeForStop(sortedStops.find((stop) => stop.id === input.stopId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(activity && JSON.stringify(input) === JSON.stringify(initialInput));
  const scheduledTimeUnchanged = input.scheduledAt === initialInput.scheduledAt;
  function selectStop(nextStopId: string) {
    setInput((current) => ({
      ...current,
      stopId: nextStopId,
    }));
    setAutoFields((current) => ({
      ...current,
      stopId: false,
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (unchanged) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const normalized = {
        ...input,
        scheduledAt: activity
          ? dateTimeLocalToIsoPreserving(input.scheduledAt, input.timezone, activity.scheduledAt)
          : dateTimeLocalToIso(input.scheduledAt, input.timezone),
        timezone: activity && scheduledTimeUnchanged && input.timezone === initialInput.timezone ? activity.timezone : input.timezone,
      };
      const variables = activity ? { id: activity.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(activity ? operations.updateActivity : operations.addActivity, variables);
      onSaved(data[activity ? 'updateActivity' : 'addActivity']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={activity ? 'Edit activity' : 'Add activity'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <details className="advanced-details"><summary>{trip.stops.find((stop) => stop.id === input.stopId)?.name} · change destination</summary><Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field></details>
        <Field label="Activity title"><input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Booking status" fillStatus={autoFields.status ? 'auto' : undefined}><select value={input.status} onChange={(e) => { setAutoFields((current) => ({ ...current, status: false })); setInput({ ...input, status: e.target.value as Activity['status'] }); }}><option value="IDEA">Idea</option><option value="PLANNED">Planned · not booked</option><option value="BOOKED">Booked</option><option value="DONE">Done</option></select></Field><Field label="Scheduled time (optional)" hint="Leave blank to keep this activity in the idea pool." fillStatus={autoFields.scheduledAt ? 'suggested' : undefined}><DatePickerInput includeTime value={input.scheduledAt ?? ''} onValueChange={(dateTime) => { setAutoFields((current) => ({ ...current, scheduledAt: false })); setInput({ ...input, scheduledAt: dateTime || null }); }} /></Field></div>
        {!input.scheduledAt && suggestedTime ? <button className="button-text" type="button" onClick={() => { setInput({ ...input, scheduledAt: suggestedTime }); setAutoFields((current) => ({ ...current, scheduledAt: true })); }}>Use first day · {suggestedTime.replace('T', ' at ')}</button> : null}
        <details className="advanced-details"><summary>Timezone · {input.timezone ?? 'device timezone'}</summary><Field label="Timezone" hint="Use the timezone for these times, for example Europe/London or Asia/Tokyo."><input value={input.timezone ?? ''} onChange={(e) => setInput({ ...input, timezone: e.target.value || null })} /></Field></details>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save activity'}</button></footer></form>
    </Dialog>
  );
}

function TripDetail({ trip, onChanged, onDeleted, notify }: { trip: Trip; onChanged: (trip: Trip) => void; onDeleted: () => void; notify: (notice: Notice) => void }) {
  const [editor, setEditor] = useState<EntityEditor>(null);
  async function removeEntity(kind: 'stop' | 'transport' | 'stay' | 'activity', id: string) {
    const warning = kind === 'stop'
      ? 'Remove this destination? Its stays, activities, and connected transport will also be removed. This cannot be undone.'
      : `Remove this ${kind}? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    const operation = { stop: operations.removeStop, transport: operations.removeTransport, stay: operations.removeStay, activity: operations.removeActivity }[kind];
    const field = { stop: 'removeTripStop', transport: 'removeTransportLeg', stay: 'removeStay', activity: 'removeActivity' }[kind];
    try {
      const data = await graphqlRequest<Record<string, Trip>, { id: string; expectedRevision: number }>(operation, { id, expectedRevision: trip.revision });
      onChanged(data[field]!);
      notify({ tone: 'success', message: `${kind[0]?.toUpperCase()}${kind.slice(1)} removed.` });
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  async function deleteTrip() {
    if (!window.confirm(`Delete “${trip.name}” and all of its itinerary data?`)) return;
    try {
      await graphqlRequest<{ deleteTrip: boolean }, { id: string; expectedRevision: number }>(operations.deleteTrip, { id: trip.id, expectedRevision: trip.revision });
      onDeleted();
    } catch (requestError) { notify({ tone: 'error', message: errorMessage(requestError) }); }
  }

  return (
    <main id="main-content" className="detail-page trip-workbench" tabIndex={-1}>
      <header className="trip-workbench-header">
        <div className="trip-workbench-title"><h1>{trip.name}</h1><p>{formatDateRange(trip.startDate, trip.endDate)}</p></div>
        <div className="hero-actions"><button className="button-text" type="button" onClick={() => setEditor({ kind: 'trip' })}>Edit trip</button><button className="button-text button-danger" type="button" onClick={() => void deleteTrip()}>Delete</button></div>
      </header>
      <TripCalendar trip={trip} onChanged={onChanged}
        onActivity={(activity, stopId, scheduledLocal) => setEditor({ kind: 'activity', value: activity, stopId, scheduledLocal })}
        onStay={(stay, stopId) => setEditor({ kind: 'stay', value: stay, stopId })}
        onTransport={(leg, fromStopId, toStopId) => setEditor({ kind: 'transport', value: leg, fromStopId, toStopId })}
        onDestination={(stop) => setEditor({ kind: 'stop', value: stop })}
        onRemove={(kind, id) => void removeEntity(kind, id)} />

      {editor?.kind === 'trip' ? <TripEditor trip={trip} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stop' ? <StopEditor trip={trip} stop={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'transport' ? <TransportEditor trip={trip} leg={editor.value} fromStopId={editor.fromStopId} toStopId={editor.toStopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stay' ? <StayEditor trip={trip} stay={editor.value} stopId={editor.stopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'activity' ? <ActivityEditor trip={trip} activity={editor.value} stopId={editor.stopId} scheduledLocal={editor.scheduledLocal} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
    </main>
  );
}

function TripsOverview({ trips, onCreate, onDraft, onOpen }: { trips: Trip[]; onCreate: () => void; onDraft: (draft: TripDraft, prompt: string) => void; onOpen: (id: string) => void }) {
  return (
    <main id="main-content" className="page-wrap" tabIndex={-1}>
      <section className="page-heading"><div><h1>Your trips</h1><p className="page-intro">Everything you’re planning, in one place.</p></div>{trips.length ? <button className="button-primary" type="button" onClick={onCreate}>+ New trip</button> : null}</section>
      <div className="overview-layout">
        <HomeDraftComposer onDraft={onDraft} />
        <div className="overview-plans">
          {trips.length === 0 ? (
            <section className="empty-state"><span className="empty-mark" aria-hidden="true">01</span><h2>Your first trip starts here</h2><p>Add the essentials now. You can fill in accommodation, activities, and transport as the plan takes shape.</p><button className="button-primary" type="button" onClick={onCreate}>Create your first trip</button></section>
          ) : (
            <section className="trips-grid" aria-label="Trips">{trips.map((trip) => {
              const stops = sortStopsByDate(trip.stops);
              return <article className="trip-card-real" key={trip.id}><div className="trip-card-art" aria-hidden="true"><span>{stops[0]?.name.slice(0, 2).toUpperCase() ?? 'TD'}</span></div><div className="trip-card-content"><div><p className="trip-eyebrow">{formatDateRange(trip.startDate, trip.endDate)}</p><h2>{trip.name}</h2><p>{stops.length} {stops.length === 1 ? 'destination' : 'destinations'}</p></div><div className="route-ribbon route-ribbon-card">{stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i>{stop.name}</span>)}</div><div className="trip-card-stats"><span>{trip.transportLegs.length} transport</span><span>{trip.stays.length} stays</span><span>{trip.activities.length} activities</span></div><button className="button-text trip-open" type="button" onClick={() => onOpen(trip.id)}>Open trip <span aria-hidden="true">→</span></button></div></article>;
            })}</section>
          )}
        </div>
      </div>
    </main>
  );
}

export function TripDockApp() {
  const navigation = usePackingNavigation();
  const [lastPackingTrip, setLastPackingTrip] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [createRequest, setCreateRequest] = useState<{
    draft?: TripDraft;
    sourcePrompt?: string;
  } | null>(null);
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      <header className="site-header"><div className={`header-inner ${selectedTrip && !navigation.packing ? 'header-inner-workbench' : ''}`}><button className="logo-button" type="button" onClick={() => { window.location.hash = 'trips'; setSelectedTripId(null); }} aria-label="TripDock trips home"><Logo /></button>
        <div className="app-section-tabs" role="tablist" aria-label="TripDock sections" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }}>
          <button id="trips-tab" role="tab" aria-selected={!navigation.packing} aria-controls="trips-panel" tabIndex={navigation.packing ? -1 : 0} onClick={() => { setLastPackingTrip(navigation.tripId); window.location.hash = 'trips'; }}>Trips</button>
          <button id="packing-tab" role="tab" aria-selected={navigation.packing} aria-controls="packing-panel" tabIndex={navigation.packing ? 0 : -1} onClick={() => navigatePacking(lastPackingTrip)}>Packing</button>
        </div>
        {selectedTrip && !navigation.packing ? <button className="button-text header-home" type="button" onClick={() => setSelectedTripId(null)}>Home</button> : null}
      </div></header>
      {state.kind === 'loading' ? <main id="main-content" className="state-page" aria-busy="true"><Logo /><div className="loader" aria-hidden="true" /><h1>Opening your trips</h1><p>Getting your plans ready…</p></main> : null}
      {state.kind === 'error' ? <main id="main-content" className="state-page error-state"><Logo /><h1>TripDock could not open your data</h1><p role="alert">{state.message}</p><button className="button-primary" type="button" onClick={retry}>Retry connection</button></main> : null}
      <div className="app-section-panel" id="trips-panel" role="tabpanel" aria-labelledby="trips-tab" hidden={navigation.packing}>
      {state.kind === 'ready' && !navigation.packing && !selectedTrip ? <TripsOverview trips={state.trips} onCreate={() => setCreateRequest({})} onDraft={(draft, sourcePrompt) => setCreateRequest({ draft, sourcePrompt })} onOpen={setSelectedTripId} /> : null}
      {state.kind === 'ready' && !navigation.packing && selectedTrip ? <TripDetail trip={selectedTrip} onChanged={replaceTrip} onDeleted={() => { setState({ kind: 'ready', trips: state.trips.filter((trip) => trip.id !== selectedTrip.id) }); setSelectedTripId(null); setNotice({ tone: 'success', message: 'Trip deleted.' }); }} notify={setNotice} /> : null}
      </div>
      <div className="app-section-panel" id="packing-panel" role="tabpanel" aria-labelledby="packing-tab" hidden={!navigation.packing}>
      {state.kind === 'ready' && navigation.packing ? <PackingWorkspace trips={state.trips} selectedTripId={navigation.tripId} onSelectTrip={id => { setLastPackingTrip(id); navigatePacking(id); }} onCreateTrip={() => { window.location.hash = 'trips'; setCreateRequest({}); }} /> : null}
      </div>
      {createRequest ? <CreateTripDialog initialDraft={createRequest.draft} sourcePrompt={createRequest.sourcePrompt} onClose={() => setCreateRequest(null)} onCreated={(trip) => { setCreateRequest(null); replaceTrip(trip); setSelectedTripId(trip.id); setNotice({ tone: 'success', message: 'Trip created.' }); }} /> : null}
      {notice ? <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}
    </div>
  );
}

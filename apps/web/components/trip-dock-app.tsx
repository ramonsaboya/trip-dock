'use client';

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
  appendTripStop,
  dateTimeLocalToIso,
  dateTimeLocalToIsoPreserving,
  destinationAreaFromStops,
  draftToTripInput,
  formatDateRange,
  formatDateTime,
  graphqlRequest,
  isoToDateTimeLocal,
  operations,
  removeTripStop,
  sortStopsByDate,
  stayDateTimesForStop,
  transportDateTimesForStops,
  updateTripBoundaryDate,
  updateTripStopDate,
  type Activity,
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

function formatCalendarDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatStopDates(stop: Pick<TripStop, 'arrivalDate' | 'departureDate'>): string {
  if (stop.arrivalDate && stop.departureDate) {
    return formatDateRange(stop.arrivalDate, stop.departureDate);
  }
  if (stop.arrivalDate) return `From ${formatCalendarDate(stop.arrivalDate)}`;
  if (stop.departureDate) return `Until ${formatCalendarDate(stop.departureDate)}`;
  return 'Dates open';
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
            {eyebrow ? <p className="overline">{eyebrow}</p> : null}
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

type FillStatus = 'auto' | 'suggested';

function fillStatusesForDraft(draft: TripDraft, form: TripInput): Map<string, FillStatus> {
  const statuses = new Map<string, FillStatus>();
  const mark = (key: string, value: string | number | null, status: FillStatus) => {
    if (value !== null && value !== '') statuses.set(key, status);
  };
  mark('trip.name', draft.name, 'suggested');
  mark('trip.startDate', form.startDate, draft.startDate ? 'suggested' : 'auto');
  mark('trip.endDate', form.endDate, draft.endDate ? 'suggested' : 'auto');
  mark('trip.travelerCount', form.travelerCount, draft.travelerCount !== null ? 'suggested' : 'auto');
  form.stops.forEach((stop, index) => {
    const source = draft.stops[index];
    mark(`stop.${index}.name`, stop.name, 'suggested');
    mark(`stop.${index}.arrivalDate`, stop.arrivalDate, source?.arrivalDate ? 'suggested' : 'auto');
    mark(`stop.${index}.departureDate`, stop.departureDate, source?.departureDate ? 'suggested' : 'auto');
  });
  return statuses;
}

function Field({
  label,
  children,
  hint,
  fillStatus,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  fillStatus?: FillStatus;
}) {
  const controlId = useId();
  const hintId = useId();
  const resolvedControlId = isValidElement<{ id?: string }>(children)
    ? children.props.id ?? controlId
    : controlId;
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        id: resolvedControlId,
        'aria-describedby': [children.props['aria-describedby'], hint ? hintId : null]
          .filter(Boolean)
          .join(' ') || undefined,
      })
    : children;

  return (
    <div className="field" data-fill-status={fillStatus}>
      <label className="field-label" htmlFor={resolvedControlId}>
        <span>{label}</span>
        {fillStatus ? (
          <span className="fill-status">{fillStatus === 'suggested' ? 'Suggested' : 'Auto-filled'}</span>
        ) : null}
      </label>
      {control}
      {hint ? <small id={hintId}>{hint}</small> : null}
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

function pickerDisplayValue(value: string, includeTime: boolean): string {
  const date = parseCalendarDate(value);
  if (!date) return value;
  const dateLabel = date.toLocaleDateString('en-GB', {
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
  onValueChange: (value: string) => void;
  value: string;
};

function DatePickerInput({
  includeTime = false,
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

  const days = useMemo(() => {
    const firstWeekday = (visibleMonth.getUTCDay() + 6) % 7;
    const firstCell = new Date(visibleMonth);
    firstCell.setUTCDate(1 - firstWeekday);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell);
      date.setUTCDate(firstCell.getUTCDate() + index);
      return date;
    });
  }, [visibleMonth]);

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
    const weekday = (date.getUTCDay() + 6) % 7;
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
        value={pickerDisplayValue(value, includeTime)}
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
            <strong>{visibleMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>
            <button className="date-picker-nav" type="button" disabled={nextDisabled} onClick={() => setVisibleMonth(nextMonth)} aria-label="Next month">›</button>
          </div>
          <div className="date-picker-weekdays" aria-hidden="true">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <span key={day}>{day}</span>)}
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
                   aria-label={date.toLocaleDateString('en-GB', { dateStyle: 'full', timeZone: 'UTC' })}
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
  initialFillStatuses,
}: {
  value: TripInput;
  onChange: (next: TripInput) => void;
  initialFillStatuses?: ReadonlyMap<string, FillStatus>;
}) {
  const stopFieldKey = (index: number, field: keyof TripDraftStop) => `stop.${index}.${field}`;
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set());
  const [fillStatuses, setFillStatuses] = useState<Map<string, FillStatus>>(() => {
    const statuses = new Map(initialFillStatuses);
    if (!initialFillStatuses && value.travelerCount === 2) statuses.set('trip.travelerCount', 'auto');
    return statuses;
  });

  function markDirty(key: string) {
    setDirtyFields((current) => new Set(current).add(key));
    setFillStatuses((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  function markDerived(key: string, fieldValue: string | number | null) {
    setDirtyFields((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setFillStatuses((current) => {
      const next = new Map(current);
      if (fieldValue === null || fieldValue === '') next.delete(key);
      else next.set(key, 'auto');
      return next;
    });
  }

  function updateTripField<K extends 'name' | 'travelerCount'>(field: K, fieldValue: TripInput[K]) {
    markDirty(`trip.${field}`);
    onChange({ ...value, [field]: fieldValue });
  }

  function updateBoundary(boundary: 'start' | 'end', date: string) {
    const tripKey = boundary === 'start' ? 'trip.startDate' : 'trip.endDate';
    const stopIndex = boundary === 'start' ? 0 : value.stops.length - 1;
    const stopField = boundary === 'start' ? 'arrivalDate' : 'departureDate';
    const linkedKey = stopFieldKey(stopIndex, stopField);
    const next = updateTripBoundaryDate(value, boundary, date, {
      stopDateDirty: dirtyFields.has(linkedKey),
    });
    markDirty(tripKey);
    if (next.stops[stopIndex]?.[stopField] !== value.stops[stopIndex]?.[stopField]) {
      markDerived(linkedKey, next.stops[stopIndex]?.[stopField] ?? null);
    }
    onChange(next);
  }

  function updateStop(index: number, patch: Partial<TripDraftStop>) {
    for (const field of Object.keys(patch) as Array<keyof TripDraftStop>) {
      markDirty(stopFieldKey(index, field));
    }
    onChange({
      ...value,
      stops: value.stops.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...patch } : stop,
      ),
    });
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
    markDirty(fieldKey);
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

  function addStop() {
    const previousIndex = value.stops.length - 1;
    const previousDepartureKey = stopFieldKey(previousIndex, 'departureDate');
    const next = appendTripStop(value, {
      lastDepartureDirty: dirtyFields.has(previousDepartureKey),
    });
    if (next.stops[previousIndex]?.departureDate !== value.stops[previousIndex]?.departureDate) {
      markDerived(previousDepartureKey, next.stops[previousIndex]?.departureDate ?? null);
    }
    const nextIndex = next.stops.length - 1;
    markDerived(stopFieldKey(nextIndex, 'arrivalDate'), next.stops[nextIndex]?.arrivalDate ?? null);
    markDerived(stopFieldKey(nextIndex, 'departureDate'), next.stops[nextIndex]?.departureDate ?? null);
    onChange(next);
  }

  function removeStop(index: number) {
    const removedDepartureKey = stopFieldKey(index, 'departureDate');
    const survivingDepartureKey = stopFieldKey(index - 1, 'departureDate');
    const next = removeTripStop(value, index, {
      preserveTripEnd: Boolean(fillStatuses.get(removedDepartureKey)),
      survivingDepartureDirty: dirtyFields.has(survivingDepartureKey),
    });
    const remapKey = (key: string): string | null => {
      const match = /^stop\.(\d+)\.(.+)$/.exec(key);
      if (!match) return key;
      const stopIndex = Number(match[1]);
      if (stopIndex === index) return null;
      return stopIndex > index ? `stop.${stopIndex - 1}.${match[2]}` : key;
    };
    setDirtyFields((current) => new Set([...current].map(remapKey).filter((key): key is string => Boolean(key))));
    setFillStatuses((current) => new Map(
      [...current].flatMap(([key, status]) => {
        const remapped = remapKey(key);
        return remapped ? [[remapped, status] as const] : [];
      }),
    ));
    if (next.startDate !== value.startDate) markDerived('trip.startDate', next.startDate);
    if (next.endDate !== value.endDate) markDerived('trip.endDate', next.endDate);
    const lastIndex = next.stops.length - 1;
    const previousLastIndex = lastIndex >= index ? lastIndex + 1 : lastIndex;
    if (lastIndex >= 0 && next.stops[lastIndex]?.departureDate !== value.stops[previousLastIndex]?.departureDate) {
      markDerived(stopFieldKey(lastIndex, 'departureDate'), next.stops[lastIndex]?.departureDate ?? null);
    }
    onChange(next);
  }

  return (
    <div className="form-stack">
      <Field label="Trip name" fillStatus={fillStatuses.get('trip.name')}>
        <input required maxLength={160} value={value.name} onChange={(event) => updateTripField('name', event.target.value)} placeholder="A name you’ll recognize" />
      </Field>
      <div className="form-grid form-grid-three">
        <Field label="Start date" fillStatus={fillStatuses.get('trip.startDate')}><DatePickerInput required max={value.endDate || undefined} value={value.startDate} onValueChange={(date) => updateBoundary('start', date)} /></Field>
        <Field label="End date" fillStatus={fillStatuses.get('trip.endDate')}><DatePickerInput required min={value.startDate || undefined} value={value.endDate} onValueChange={(date) => updateBoundary('end', date)} /></Field>
        <Field label="Travelers" fillStatus={fillStatuses.get('trip.travelerCount')}><input required type="number" min="1" max="20" value={value.travelerCount} onChange={(event) => updateTripField('travelerCount', Number(event.target.value))} /></Field>
      </div>
      <fieldset className="stops-editor">
        <legend>Destinations</legend>
        {value.stops.map((stop, index) => (
          <div className="draft-stop" key={`draft-stop-${index}`}>
            <span className="position-badge" aria-label={`Destination ${index + 1}`}>{index + 1}</span>
            <div className="destination-fields">
              <Field label="Destination" fillStatus={fillStatuses.get(stopFieldKey(index, 'name'))}><input required value={stop.name} onChange={(event) => updateStop(index, { name: event.target.value })} placeholder="City or stop" /></Field>
              <Field label="Start" fillStatus={fillStatuses.get(stopFieldKey(index, 'arrivalDate'))}><DatePickerInput min={value.startDate || undefined} max={(stop.departureDate ?? value.endDate) || undefined} value={stop.arrivalDate ?? ''} onValueChange={(date) => updateStopDate(index, 'arrivalDate', date)} /></Field>
              <Field label="End" fillStatus={fillStatuses.get(stopFieldKey(index, 'departureDate'))}><DatePickerInput min={(stop.arrivalDate ?? value.startDate) || undefined} max={value.endDate || undefined} value={stop.departureDate ?? ''} onValueChange={(date) => updateStopDate(index, 'departureDate', date)} /></Field>
            </div>
            <button className="icon-button remove-destination" type="button" disabled={value.stops.length === 1} aria-label={`Remove destination ${index + 1}`} onClick={() => removeStop(index)}>×</button>
          </div>
        ))}
        <button className="button-secondary add-destination" type="button" onClick={addStop}>+ Add destination</button>
      </fieldset>
    </div>
  );
}

type DraftNotes = Pick<TripDraft, 'assumptions' | 'warnings'>;

function CreateTripDialog({
  initialForm,
  initialFillStatuses,
  draftNotes,
  onClose,
  onCreated,
}: {
  initialForm?: TripInput;
  initialFillStatuses?: ReadonlyMap<string, FillStatus>;
  draftNotes?: DraftNotes;
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}) {
  const [form, setForm] = useState<TripInput>(() => initialForm ?? blankTrip());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createTrip(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: TripInput = {
        ...form,
        destinationArea: destinationAreaFromStops(form),
        stops: form.stops.map((stop) => ({ ...stop, locationText: null })),
      };
      const data = await graphqlRequest<{ createTrip: Trip }, { input: TripInput }>(operations.createTrip, { input });
      onCreated(data.createTrip);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Create a trip" eyebrow="New plan" onClose={onClose} wide>
      {draftNotes && (draftNotes.assumptions.length || draftNotes.warnings.length) ? <div className="draft-notes" aria-label="Things to review">{draftNotes.assumptions.map((note) => <p key={note}>Assumption: {note}</p>)}{draftNotes.warnings.map((note) => <p key={note}>Check: {note}</p>)}</div> : null}
      <form onSubmit={(event) => void createTrip(event)} aria-busy={busy}>
        <TripFields value={form} onChange={setForm} initialFillStatuses={initialFillStatuses} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy || !form.startDate || !form.endDate}>{busy ? 'Saving…' : 'Create trip'}</button></footer>
      </form>
    </Dialog>
  );
}

function HomeDraftComposer({ onDraft }: { onDraft: (form: TripInput, notes: DraftNotes, fillStatuses: Map<string, FillStatus>) => void }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await graphqlRequest<{ generateTripDraft: TripDraft }, { prompt: string }>(operations.generateDraft, { prompt });
      const draft = data.generateTripDraft;
      const form = draftToTripInput(draft);
      onDraft(form, {
        assumptions: draft.assumptions,
        warnings: draft.warnings,
      }, fillStatusesForDraft(draft, form));
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
        <p>Share the places, dates, and travelers you already know. You can edit every detail before creating it.</p>
      </div>
      <form onSubmit={(event) => void generateDraft(event)} aria-busy={busy}>
        <label htmlFor="home-trip-prompt">What do you have in mind?</label>
        <textarea id="home-trip-prompt" rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ten days in Japan for two people, starting in Tokyo and ending in Kyoto…" />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button-primary" type="submit" disabled={busy || prompt.trim().length < 10}>{busy ? 'Building your draft…' : 'Build a trip draft'}</button>
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
        <div className="form-grid form-grid-three"><Field label="Start date"><DatePickerInput required max={input.endDate || undefined} value={input.startDate} onValueChange={(date) => setInput({ ...input, startDate: date })} /></Field><Field label="End date"><DatePickerInput required min={input.startDate} value={input.endDate} onValueChange={(date) => setInput({ ...input, endDate: date })} /></Field><Field label="Travelers"><input required type="number" min="1" max="20" value={input.travelerCount} onChange={(e) => setInput({ ...input, travelerCount: Number(e.target.value) })} /></Field></div>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save changes'}</button></footer></form>
    </Dialog>
  );
}

type EntityEditor =
  | { kind: 'trip' }
  | { kind: 'stop'; value?: TripStop }
  | { kind: 'transport'; value?: TransportLeg; fromStopId?: string; toStopId?: string }
  | { kind: 'stay'; value?: Stay; stopId?: string }
  | { kind: 'activity'; value?: Activity; stopId?: string }
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
  if (!fromStop || !toStop || fromStop.id === toStop.id) return '';
  return `${fromStop.name} to ${toStop.name}`;
}

function TransportEditor({ trip, leg, fromStopId, toStopId, onClose, onSaved }: { trip: Trip; leg?: TransportLeg; fromStopId?: string; toStopId?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = deviceTimezone();
  const initialFromStopId = leg?.fromStopId ?? fromStopId ?? sortedStops[0]?.id ?? '';
  const initialToStopId = leg?.toStopId ?? toStopId ?? sortedStops[1]?.id ?? sortedStops[0]?.id ?? '';
  const initialFromStop = sortedStops.find((stop) => stop.id === initialFromStopId);
  const initialToStop = sortedStops.find((stop) => stop.id === initialToStopId);
  const initialTimes = transportDateTimesForStops(initialFromStop, initialToStop);
  const initialInput = {
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
        departureTime: leg
          ? dateTimeLocalToIsoPreserving(input.departureTime, input.timezone, leg.departureTime)
          : dateTimeLocalToIso(input.departureTime, input.timezone),
        arrivalTime: leg
          ? dateTimeLocalToIsoPreserving(input.arrivalTime, input.timezone, leg.arrivalTime)
          : dateTimeLocalToIso(input.arrivalTime, input.timezone),
        timezone: leg && timesUnchanged ? leg.timezone : input.timezone,
      };
      const variables = leg ? { id: leg.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(leg ? operations.updateTransport : operations.addTransport, variables);
      onSaved(data[leg ? 'updateTransportLeg' : 'addTransportLeg']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={leg ? 'Edit transport' : 'Add transport'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <div className="form-grid form-grid-two"><Field label="From" fillStatus={autoFields.fromStopId ? 'auto' : undefined}><select value={input.fromStopId} onChange={(e) => selectRoute('fromStopId', e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.toStopId}>{stop.name}</option>)}</select></Field><Field label="To" fillStatus={autoFields.toStopId ? 'auto' : undefined}><select value={input.toStopId} onChange={(e) => selectRoute('toStopId', e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id} disabled={stop.id === input.fromStopId}>{stop.name}</option>)}</select></Field></div>
        <div className="form-grid form-grid-two"><Field label="Mode"><input required value={input.mode} onChange={(e) => setInput({ ...input, mode: e.target.value })} placeholder="Train, flight, ferry…" /></Field><Field label="Title" fillStatus={autoFields.title ? 'auto' : undefined}><input required value={input.title} onChange={(e) => { setDirtySuggested((current) => ({ ...current, title: true })); setAutoFields((current) => ({ ...current, title: false })); setInput({ ...input, title: e.target.value }); }} /></Field></div>
        <Field label="Details"><textarea rows={2} value={input.details ?? ''} onChange={(e) => setInput({ ...input, details: e.target.value || null })} placeholder="Booking reference, route notes, or anything useful" /></Field>
        <div className="form-grid form-grid-two"><Field label="Departure" fillStatus={autoFields.departureTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.departureTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, departureTime: true })); setAutoFields((current) => ({ ...current, departureTime: false })); setInput({ ...input, departureTime: dateTime || null }); }} /></Field><Field label="Arrival" fillStatus={autoFields.arrivalTime ? 'suggested' : undefined}><DatePickerInput includeTime value={input.arrivalTime ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, arrivalTime: true })); setAutoFields((current) => ({ ...current, arrivalTime: false })); setInput({ ...input, arrivalTime: dateTime || null }); }} /></Field></div>
        <p className="local-time-note">Times use your device’s local timezone.</p>
        {routeInvalid ? <p className="form-error">Choose two different destinations for this route.</p> : null}
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || routeInvalid || unchanged} type="submit">{busy ? 'Saving…' : 'Save transport'}</button></footer></form>
    </Dialog>
  );
}

function StayEditor({ trip, stay, stopId, onClose, onSaved }: { trip: Trip; stay?: Stay; stopId?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = deviceTimezone();
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
        timezone: stay && timesUnchanged ? stay.timezone : input.timezone,
      };
      const variables = stay ? { id: stay.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(stay ? operations.updateStay : operations.addStay, variables);
      onSaved(data[stay ? 'updateStay' : 'addStay']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={stay ? 'Edit stay' : 'Add stay'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field>
        <Field label="Stay name" fillStatus={autoFields.name ? 'auto' : undefined}><input required value={input.name} onChange={(e) => { setDirtySuggested((current) => ({ ...current, name: true })); setAutoFields((current) => ({ ...current, name: false })); setInput({ ...input, name: e.target.value }); }} /></Field>
        <div className="form-grid form-grid-two"><Field label="Check-in" fillStatus={autoFields.checkIn ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkIn ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkIn: true })); setAutoFields((current) => ({ ...current, checkIn: false })); setInput({ ...input, checkIn: dateTime || null }); }} /></Field><Field label="Check-out" fillStatus={autoFields.checkOut ? 'suggested' : undefined}><DatePickerInput includeTime value={input.checkOut ?? ''} onValueChange={(dateTime) => { setDirtySuggested((current) => ({ ...current, checkOut: true })); setAutoFields((current) => ({ ...current, checkOut: false })); setInput({ ...input, checkOut: dateTime || null }); }} /></Field></div>
        <p className="local-time-note">Times use your device’s local timezone.</p>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save stay'}</button></footer></form>
    </Dialog>
  );
}

function ActivityEditor({ trip, activity, stopId, onClose, onSaved }: { trip: Trip; activity?: Activity; stopId?: string; onClose: () => void; onSaved: (trip: Trip) => void }) {
  const sortedStops = sortStopsByDate(trip.stops);
  const localTimezone = deviceTimezone();
  const initialStopId = activity?.stopId ?? stopId ?? sortedStops[0]?.id ?? '';
  const initialStop = sortedStops.find((stop) => stop.id === initialStopId);
  const suggestedTime = activityDateTimeForStop(initialStop);
  const initialInput = {
    stopId: initialStopId,
    title: activity?.title ?? '',
    status: activity?.status ?? 'IDEA' as Activity['status'],
    scheduledAt: activity ? isoToDateTimeLocal(activity.scheduledAt, localTimezone) : suggestedTime,
    timezone: localTimezone,
  };
  const [input, setInput] = useState(() => initialInput);
  const [scheduledDirty, setScheduledDirty] = useState(Boolean(activity));
  const [autoFields, setAutoFields] = useState(() => ({
    stopId: !activity && Boolean(initialStopId),
    status: !activity,
    scheduledAt: !activity && Boolean(suggestedTime),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = Boolean(activity && JSON.stringify(input) === JSON.stringify(initialInput));
  const scheduledTimeUnchanged = input.scheduledAt === initialInput.scheduledAt;
  function selectStop(nextStopId: string) {
    const nextTime = activityDateTimeForStop(sortedStops.find((stop) => stop.id === nextStopId));
    setInput((current) => ({
      ...current,
      stopId: nextStopId,
      scheduledAt: scheduledDirty ? current.scheduledAt : nextTime,
    }));
    setAutoFields((current) => ({
      ...current,
      stopId: false,
      scheduledAt: scheduledDirty ? current.scheduledAt : Boolean(nextTime),
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
        timezone: activity && scheduledTimeUnchanged ? activity.timezone : input.timezone,
      };
      const variables = activity ? { id: activity.id, expectedRevision: trip.revision, input: normalized } : { tripId: trip.id, expectedRevision: trip.revision, input: normalized };
      const data = await graphqlRequest<Record<string, Trip>, Record<string, unknown>>(activity ? operations.updateActivity : operations.addActivity, variables);
      onSaved(data[activity ? 'updateActivity' : 'addActivity']!);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  }

  return (
    <Dialog title={activity ? 'Edit activity' : 'Add activity'} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} aria-busy={busy}><div className="form-stack">
        <Field label="Destination" fillStatus={autoFields.stopId ? 'auto' : undefined}><select value={input.stopId} onChange={(e) => selectStop(e.target.value)}>{trip.stops.map((stop) => <option value={stop.id} key={stop.id}>{stop.name}</option>)}</select></Field>
        <Field label="Activity title"><input required value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></Field>
        <div className="form-grid form-grid-two"><Field label="Status" fillStatus={autoFields.status ? 'auto' : undefined}><select value={input.status} onChange={(e) => { setAutoFields((current) => ({ ...current, status: false })); setInput({ ...input, status: e.target.value as Activity['status'] }); }}><option value="IDEA">Idea</option><option value="PLANNED">Planned</option><option value="BOOKED">Booked</option><option value="DONE">Done</option></select></Field><Field label="Scheduled time" fillStatus={autoFields.scheduledAt ? 'suggested' : undefined}><DatePickerInput includeTime value={input.scheduledAt ?? ''} onValueChange={(dateTime) => { setScheduledDirty(true); setAutoFields((current) => ({ ...current, scheduledAt: false })); setInput({ ...input, scheduledAt: dateTime || null }); }} /></Field></div>
        <p className="local-time-note">Times use your device’s local timezone.</p>
      </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-footer"><button className="button-text" type="button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || unchanged} type="submit">{busy ? 'Saving…' : 'Save activity'}</button></footer></form>
    </Dialog>
  );
}

function Section({ title, kicker, action, children }: { title: string; kicker: string; action?: ReactNode; children: ReactNode }) {
  return <section className="detail-section"><header className="section-heading"><div><p className="section-kicker">{kicker}</p><h2>{title}</h2></div>{action}</header>{children}</section>;
}

function TripDetail({ trip, onBack, onChanged, onDeleted, notify }: { trip: Trip; onBack: () => void; onChanged: (trip: Trip) => void; onDeleted: () => void; notify: (notice: Notice) => void }) {
  const [editor, setEditor] = useState<EntityEditor>(null);
  const sortedStops = useMemo(() => sortStopsByDate(trip.stops), [trip.stops]);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(() => sortedStops[0]?.id ?? null);
  const activeExpandedStopId = expandedStopId === null || sortedStops.some((stop) => stop.id === expandedStopId)
    ? expandedStopId
    : sortedStops[0]?.id ?? null;
  const stopNames = useMemo(() => new Map(sortedStops.map((stop) => [stop.id, stop.name])), [sortedStops]);

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
    <main id="main-content" className="detail-page" tabIndex={-1}>
      <button className="back-button" type="button" onClick={onBack}>← All trips</button>

      <section className="trip-hero"><div><h1>{trip.name}</h1><p>{formatDateRange(trip.startDate, trip.endDate)} · {trip.travelerCount} {trip.travelerCount === 1 ? 'traveler' : 'travelers'}</p></div><div className="hero-actions"><button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'trip' })}>Edit trip</button><button className="button-text button-danger" type="button" onClick={() => void deleteTrip()}>Delete</button></div></section>

      <Section title="Your itinerary" kicker="Destinations by date" action={<button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'stop' })}>+ Add destination</button>}>
        <div className="itinerary-timeline">
          {sortedStops.map((stop, index) => {
            const isExpanded = activeExpandedStopId === stop.id;
            const destinationStays = trip.stays.filter((stay) => stay.stopId === stop.id);
            const destinationActivities = trip.activities.filter((activity) => activity.stopId === stop.id);
            const outgoingLegs = trip.transportLegs.filter((leg) => leg.fromStopId === stop.id);
            const nextStop = sortedStops[index + 1];
            return (
              <div className="itinerary-block" key={stop.id}>
                <article className={`destination-card ${isExpanded ? 'destination-card-expanded' : ''}`}>
                  <header className="destination-row">
                    <button className="destination-toggle" type="button" aria-expanded={isExpanded} aria-controls={`destination-${stop.id}`} onClick={() => setExpandedStopId(isExpanded ? null : stop.id)}>
                      <span className="position-badge">{index + 1}</span>
                      <span className="destination-summary"><strong>{stop.name}</strong><small>{formatStopDates(stop)}</small></span>
                      <span className="destination-chevron" aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                    </button>
                    <div className="entity-actions destination-actions"><button className="button-text" type="button" aria-label={`Edit destination ${stop.name}`} onClick={() => setEditor({ kind: 'stop', value: stop })}>Edit</button><button className="button-text button-danger" type="button" aria-label={`Remove destination ${stop.name}`} disabled={sortedStops.length === 1} onClick={() => void removeEntity('stop', stop.id)}>Remove</button></div>
                  </header>
                  {isExpanded ? (
                    <div className="destination-details" id={`destination-${stop.id}`}>
                      <section className="destination-zone" aria-labelledby={`stays-${stop.id}`}>
                        <header><div><p className="entity-label">Accommodation</p><h3 id={`stays-${stop.id}`}>Stays</h3></div><button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'stay', stopId: stop.id })}>+ Add stay</button></header>
                        {destinationStays.length ? <div className="nested-entity-list">{destinationStays.map((stay) => <article className="nested-entity" key={stay.id}><div><strong>{stay.name}</strong><small>{formatDateTime(stay.checkIn, stay.timezone)} → {formatDateTime(stay.checkOut, stay.timezone)}</small></div><div className="entity-actions"><button className="button-text" type="button" onClick={() => setEditor({ kind: 'stay', value: stay })}>Edit</button><button className="button-text button-danger" type="button" onClick={() => void removeEntity('stay', stay.id)}>Remove</button></div></article>)}</div> : <p className="zone-empty">No accommodation added for {stop.name} yet.</p>}
                      </section>
                      <section className="destination-zone" aria-labelledby={`activities-${stop.id}`}>
                        <header><div><p className="entity-label">Things to do</p><h3 id={`activities-${stop.id}`}>Activities</h3></div><button className="button-secondary" type="button" onClick={() => setEditor({ kind: 'activity', stopId: stop.id })}>+ Add activity</button></header>
                        {destinationActivities.length ? <div className="nested-entity-list">{destinationActivities.map((activity) => <article className="nested-entity" key={activity.id}><div><span className={`entity-label activity-${activity.status.toLowerCase()}`}>{activity.status}</span><strong>{activity.title}</strong><small>{formatDateTime(activity.scheduledAt, activity.timezone)}</small></div><div className="entity-actions"><button className="button-text" type="button" onClick={() => setEditor({ kind: 'activity', value: activity })}>Edit</button><button className="button-text button-danger" type="button" onClick={() => void removeEntity('activity', activity.id)}>Remove</button></div></article>)}</div> : <p className="zone-empty">No activities added for {stop.name} yet.</p>}
                      </section>
                    </div>
                  ) : null}
                </article>
                {nextStop || outgoingLegs.length ? (
                  <section className="transport-bridge" aria-label={nextStop ? `Transport from ${stop.name} to ${nextStop.name}` : `Transport from ${stop.name}`}>
                    <div className="transport-marker" aria-hidden="true"><span>↘</span></div>
                    <div className="transport-content">
                      <header><div><p className="entity-label">Between destinations</p><h3>{nextStop ? `Travel to ${nextStop.name}` : `Leaving ${stop.name}`}</h3></div>{nextStop ? <button className="button-text" type="button" onClick={() => setEditor({ kind: 'transport', fromStopId: stop.id, toStopId: nextStop.id })}>+ Add transport</button> : null}</header>
                      {outgoingLegs.length ? <div className="transport-list">{outgoingLegs.map((leg) => <article className="transport-item" key={leg.id}><div><span className="entity-label">{leg.mode}</span><strong>{leg.title}</strong><small>{stopNames.get(leg.fromStopId)} → {stopNames.get(leg.toStopId)} · {formatDateTime(leg.departureTime, leg.timezone)}{leg.details ? ` · ${leg.details}` : ''}</small></div><div className="entity-actions"><button className="button-text" type="button" onClick={() => setEditor({ kind: 'transport', value: leg })}>Edit</button><button className="button-text button-danger" type="button" onClick={() => void removeEntity('transport', leg.id)}>Remove</button></div></article>)}</div> : <p className="transport-empty">Transport isn’t set yet.</p>}
                    </div>
                  </section>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      {editor?.kind === 'trip' ? <TripEditor trip={trip} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stop' ? <StopEditor trip={trip} stop={editor.value} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'transport' ? <TransportEditor trip={trip} leg={editor.value} fromStopId={editor.fromStopId} toStopId={editor.toStopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'stay' ? <StayEditor trip={trip} stay={editor.value} stopId={editor.stopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
      {editor?.kind === 'activity' ? <ActivityEditor trip={trip} activity={editor.value} stopId={editor.stopId} onClose={() => setEditor(null)} onSaved={(updated) => { setEditor(null); onChanged(updated); }} /> : null}
    </main>
  );
}

function TripsOverview({ trips, onCreate, onDraft, onOpen }: { trips: Trip[]; onCreate: () => void; onDraft: (form: TripInput, notes: DraftNotes, fillStatuses: Map<string, FillStatus>) => void; onOpen: (id: string) => void }) {
  return (
    <main id="main-content" className="page-wrap" tabIndex={-1}>
      <section className="page-heading"><div><p className="overline">Your travel plans</p><h1>Your trips</h1><p className="page-intro">Start with a rough idea or build the details yourself.</p></div>{trips.length ? <button className="button-primary" type="button" onClick={onCreate}>+ New trip</button> : null}</section>
      <div className="overview-layout">
        <HomeDraftComposer onDraft={onDraft} />
        <div className="overview-plans">
          {trips.length === 0 ? (
            <section className="empty-state"><span className="empty-mark" aria-hidden="true">01</span><h2>Your first trip starts here</h2><p>Add the essentials now. You can fill in accommodation, activities, and transport as the plan takes shape.</p><button className="button-primary" type="button" onClick={onCreate}>Create your first trip</button></section>
          ) : (
            <section className="trips-grid" aria-label="Trips">{trips.map((trip) => {
              const stops = sortStopsByDate(trip.stops);
              return <article className="trip-card-real" key={trip.id}><div className="trip-card-art" aria-hidden="true"><span>{stops[0]?.name.slice(0, 2).toUpperCase() ?? 'TD'}</span></div><div className="trip-card-content"><div><p className="trip-eyebrow">{formatDateRange(trip.startDate, trip.endDate)}</p><h2>{trip.name}</h2><p>{trip.travelerCount} {trip.travelerCount === 1 ? 'traveler' : 'travelers'} · {stops.length} {stops.length === 1 ? 'destination' : 'destinations'}</p></div><div className="route-ribbon route-ribbon-card">{stops.map((stop, index) => <span key={stop.id}><i>{index + 1}</i>{stop.name}</span>)}</div><div className="trip-card-stats"><span>{trip.transportLegs.length} transport</span><span>{trip.stays.length} stays</span><span>{trip.activities.length} activities</span></div><button className="button-text trip-open" type="button" onClick={() => onOpen(trip.id)}>Open trip <span aria-hidden="true">→</span></button></div></article>;
            })}</section>
          )}
        </div>
      </div>
    </main>
  );
}

export function TripDockApp() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [createRequest, setCreateRequest] = useState<{
    form?: TripInput;
    draftNotes?: DraftNotes;
    fillStatuses?: Map<string, FillStatus>;
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
      <header className="site-header"><div className="header-inner"><button className="logo-button" type="button" onClick={() => setSelectedTripId(null)} aria-label="TripDock trips home"><Logo /></button><nav aria-label="Primary"><button type="button" className="nav-link nav-link-active" onClick={() => setSelectedTripId(null)}>Trips</button></nav></div></header>
      {state.kind === 'loading' ? <main id="main-content" className="state-page" aria-busy="true"><Logo /><div className="loader" aria-hidden="true" /><h1>Opening your trips</h1><p>Getting your plans ready…</p></main> : null}
      {state.kind === 'error' ? <main id="main-content" className="state-page error-state"><Logo /><h1>TripDock could not open your data</h1><p role="alert">{state.message}</p><button className="button-primary" type="button" onClick={retry}>Retry connection</button></main> : null}
      {state.kind === 'ready' && !selectedTrip ? <TripsOverview trips={state.trips} onCreate={() => setCreateRequest({})} onDraft={(form, draftNotes, fillStatuses) => setCreateRequest({ form, draftNotes, fillStatuses })} onOpen={setSelectedTripId} /> : null}
      {state.kind === 'ready' && selectedTrip ? <TripDetail trip={selectedTrip} onBack={() => setSelectedTripId(null)} onChanged={replaceTrip} onDeleted={() => { setState({ kind: 'ready', trips: state.trips.filter((trip) => trip.id !== selectedTrip.id) }); setSelectedTripId(null); setNotice({ tone: 'success', message: 'Trip deleted.' }); }} notify={setNotice} /> : null}
      {createRequest ? <CreateTripDialog initialForm={createRequest.form} initialFillStatuses={createRequest.fillStatuses} draftNotes={createRequest.draftNotes} onClose={() => setCreateRequest(null)} onCreated={(trip) => { setCreateRequest(null); replaceTrip(trip); setSelectedTripId(trip.id); setNotice({ tone: 'success', message: 'Trip created.' }); }} /> : null}
      {notice ? <div className={`notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}
    </div>
  );
}

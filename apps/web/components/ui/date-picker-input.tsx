'use client';

import { useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { addCalendarDays, addCalendarMonths, calendarDateKey, currentCalendarDate, initialPickerMonth, moveCalendarMonth, pickerDisplayValue, startOfCalendarMonth } from './calendar-date';

export type DatePickerInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'onChange' | 'readOnly' | 'type' | 'value'
> & {
  includeTime?: boolean;
  locale?: string;
  onValueChange: (value: string) => void;
  value: string;
};

export function DatePickerInput({
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

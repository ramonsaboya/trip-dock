'use client';

import { useEffect, useRef, useState } from 'react';
import { DatePickerInput } from '../../components/ui/date-picker-input';
import { Field } from '../../components/ui/field';
import { remapDirtyTripDraftPaths } from '../../lib/trips/draft-alignment';
import { appendTripStop, removeTripStop, updateTripBoundaryDate, updateTripStopDate } from '../../lib/trips/stops';
import { type TripDraftFieldState, type TripDraftStop, type TripInput } from '../../lib/trips/types';
import { blankStop } from './trip-defaults';

export function TripFields({
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

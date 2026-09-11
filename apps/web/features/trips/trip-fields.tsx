'use client';

import { useEffect, useRef, useState } from 'react';
import { DatePickerInput } from '../../components/ui/date-picker-input';
import { Field } from '../../components/ui/field';
import { remapDirtyTripDraftPaths } from '../../lib/trips/draft-alignment';
import { updateTripStopDate } from '../../lib/trips/stops';
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
      stops: (index === value.stops.length ? [...value.stops, { ...blankStop(), arrivalDate: value.stops.at(-1)?.departureDate ?? null }] : value.stops).map((stop, stopIndex) =>
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
      tripBoundaryDirty: false,
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
    const next = { ...value, stops: value.stops.filter((_, stopIndex) => stopIndex !== index) };
    onChange(next);
    onStopRemoved?.(index);
  }

  return (
    <fieldset disabled={disabled} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
      <div className="form-stack">
      <p>Choose your destinations and dates. You can name your trip in the summary.</p>
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
              {index === 0 || stop.name.trim() ? <><Field label="Arrival date" fieldState={fieldStates?.get(stopFieldKey(index, 'arrivalDate'))}><DatePickerInput locale={locale} required max={stop.departureDate || undefined} value={stop.arrivalDate ?? ''} onValueChange={(date) => updateStopDate(index, 'arrivalDate', date)} /></Field>
              <Field label="Departure date" fieldState={fieldStates?.get(stopFieldKey(index, 'departureDate'))}><DatePickerInput locale={locale} required min={stop.arrivalDate || undefined} value={stop.departureDate ?? ''} onValueChange={(date) => updateStopDate(index, 'departureDate', date)} /></Field></> : null}
            </div>
          </div>
        ))}

      </fieldset>

      </div>
    </fieldset>
  );
}

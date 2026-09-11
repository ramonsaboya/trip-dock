'use client';

import { parseCalendarDate, pickerDisplayValue } from '../../../components/ui/calendar-date';
import { type TripDraftFieldState, type TripInput } from '../../../lib/trips/types';

export function nightCount(startDate: string | null | undefined, endDate: string | null | undefined): number | null {
  const start = parseCalendarDate(startDate ?? undefined);
  const end = parseCalendarDate(endDate ?? undefined);
  if (!start || !end || end < start) return null;
  return Math.round((end.valueOf() - start.valueOf()) / 86_400_000);
}

export function dateRangeLabel(
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

export function DraftReviewSummary({
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

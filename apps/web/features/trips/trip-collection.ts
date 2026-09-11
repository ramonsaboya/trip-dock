import { errorMessage } from '../../lib/error-message.ts';
import { graphqlRequest } from '../../lib/graphql/request.ts';
import { operations } from '../../lib/trips/operations.ts';
import type { Trip } from '../../lib/trips/types.ts';
import type { LoadState } from './trip-state.ts';

/** One request lifetime for initial load and retry. Abort also guards late completions. */
export function loadTripCollection(publish: (state: LoadState) => void): () => void {
  const controller = new AbortController();
  void graphqlRequest<{ trips: Trip[] }, Record<string, never>>(operations.trips, {}, controller.signal)
    .then(
      ({ trips }) => { if (!controller.signal.aborted) publish({ kind: 'ready', trips }); },
      (error: unknown) => {
        if (!controller.signal.aborted) publish({ kind: 'error', message: errorMessage(error) });
      },
    );
  return () => controller.abort();
}

export function replaceAcceptedTrip(state: LoadState, trip: Trip): LoadState {
  if (state.kind !== 'ready') return state;
  const exists = state.trips.some((item) => item.id === trip.id);
  return {
    kind: 'ready',
    trips: exists ? state.trips.map((item) => item.id === trip.id ? trip : item) : [trip, ...state.trips],
  };
}

export function removeAcceptedTrip(state: LoadState, id: string): LoadState {
  return state.kind === 'ready' ? { kind: 'ready', trips: state.trips.filter((trip) => trip.id !== id) } : state;
}

'use client';

import { useEffect, useState } from 'react';
import type { Trip } from '../../lib/trips/types';
import { loadTripCollection, removeAcceptedTrip, replaceAcceptedTrip } from './trip-collection';
import type { LoadState } from './trip-state';

/** Owns accepted server records only. Navigation, editors and drafts own their own state. */
export function useTripCollection() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => loadTripCollection(setState), [attempt]);

  return {
    state,
    replaceTrip: (trip: Trip) => setState((current) => replaceAcceptedTrip(current, trip)),
    removeTrip: (id: string) => setState((current) => removeAcceptedTrip(current, id)),
    retry: () => {
      setState({ kind: 'loading' });
      setAttempt((current) => current + 1);
    },
  };
}

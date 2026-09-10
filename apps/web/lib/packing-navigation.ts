import { useSyncExternalStore } from 'react';

export type TripNavigation = { tripId: string | null; view: 'schedule' | 'packing' };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function parseTripNavigation(hash: string): TripNavigation {
  const match = hash.match(new RegExp('^#trip/(' + uuid + ')/(schedule|packing)$', 'i'));
  if (match) return { tripId: match[1]!, view: match[2]!.toLowerCase() as TripNavigation['view'] };
  // Keep previously shared packing links tied to their original trip.
  const legacy = hash.match(new RegExp('^#packing/(' + uuid + ')$', 'i'));
  return legacy ? { tripId: legacy[1]!, view: 'packing' } : { tripId: null, view: 'schedule' };
}

export function tripLocation(tripId: string, view: TripNavigation['view'] = 'schedule') {
  return '#trip/' + tripId + '/' + view;
}
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
export function useTripNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return parseTripNavigation(hash);
}
export function navigateTrip(tripId: string, view: TripNavigation['view'] = 'schedule') {
  window.location.hash = tripLocation(tripId, view);
}
export function navigateHome() {
  window.location.hash = 'home';
}

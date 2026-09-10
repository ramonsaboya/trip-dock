import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
export function usePackingNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  const packing = hash === '#packing' || hash.startsWith('#packing/');
  const candidate = hash.slice('#packing/'.length);
  const tripId = packing && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
  return { packing, tripId };
}
export function navigatePacking(tripId: string | null) {
  window.location.hash = tripId ? 'packing/' + tripId : 'packing';
}

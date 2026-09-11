import { type Trip } from '../../lib/trips/types.ts';

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; trips: Trip[] };

export type Notice = { tone: 'success' | 'error'; message: string } | null;

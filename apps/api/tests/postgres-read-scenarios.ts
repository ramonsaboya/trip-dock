import assert from 'node:assert/strict';
import { UnconfiguredAiGateway } from '../src/ai.js';
import { loadTrip } from '../src/data.js';
import type { AppDatabase, DbTransaction } from '../src/db/client.js';
import { createApi } from '../src/graphql.js';
import { createTripService } from '../src/trips/trip-service.js';

// Interleave a committed writer immediately after the reader's first SELECT.
// Fluent query proxies are test-only: production uses ordinary Drizzle queries.
function afterRead<T extends object>(query: T, callback: () => Promise<void>): T {
  return new Proxy(query, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'then' && typeof value === 'function') {
        return (resolve: (rows: unknown) => unknown, reject: (error: unknown) => unknown) =>
          value.call(target, async (rows: unknown) => { await callback(); return rows; }).then(resolve, reject);
      }
      return typeof value === 'function'
        ? (...args: unknown[]) => afterRead(value.apply(target, args), callback)
        : value;
    },
  });
}

export async function exerciseReadSnapshots(db: AppDatabase) {
  const service = createTripService(db);
  const input = {
    name: 'Original', destinationArea: 'Synthetic area', startDate: '2027-06-01', endDate: '2027-06-09',
    stops: [{ name: 'Only stop', locationText: null, arrivalDate: '2027-06-01', departureDate: '2027-06-09' }],
  };
  const trip = await service.createTrip({ input });
  let interleaved = false;
  const reader = new Proxy(db, {
    get(target, property) {
      if (property !== 'transaction') return Reflect.get(target, property);
      return (work: (tx: DbTransaction) => Promise<unknown>, config: Parameters<AppDatabase['transaction']>[1]) =>
        target.transaction(tx => work(new Proxy(tx, {
          get(transaction, key) {
            if (key !== 'select') return Reflect.get(transaction, key);
            return (...args: Parameters<DbTransaction['select']>) => afterRead(transaction.select(...args), async () => {
              if (interleaved) return;
              interleaved = true;
              await service.updateTrip({ id: trip.id, expectedRevision: 0, input: {
                name: 'Concurrent', destinationArea: input.destinationArea, startDate: '2027-06-02', endDate: input.endDate,
              } });
            });
          },
        })), config);
    },
  });
  const api = createApi({ db: reader, aiGateway: new UnconfiguredAiGateway(), webOrigin: 'http://localhost:3000' });
  const response = await api.fetch('http://localhost/graphql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($id:ID!){trip(id:$id){name revision startDate stops{arrivalDate}}}', variables: { id: trip.id } }),
  });
  const result = await response.json();
  assert.equal(result.errors, undefined, JSON.stringify(result.errors));
  assert.ok(interleaved);
  assert.deepEqual(result.data.trip, { name: 'Original', revision: 0, startDate: '2027-06-01', stops: [{ arrivalDate: '2027-06-01' }] });
  assert.equal((await loadTrip(db, trip.id))!.startDate, '2027-06-02', 'the competing writer really committed');

  // Simulate another request winning just after COMMIT but before our service resumes.
  const firstInput = { name: 'First response', destinationArea: input.destinationArea, startDate: '2027-06-02', endDate: input.endDate };
  const interleavingDb = new Proxy(db, {
    get(target, property) {
      if (property !== 'transaction') return Reflect.get(target, property);
      return async (work: (tx: DbTransaction) => Promise<unknown>) => {
        const result = await target.transaction(work);
        await service.updateTrip({ id: trip.id, expectedRevision: 2, input: { ...firstInput, name: 'Later response' } });
        return result;
      };
    },
  });
  const first = await createTripService(interleavingDb).updateTrip({ id: trip.id, expectedRevision: 1, input: firstInput });
  assert.equal(first.name, 'First response');
  assert.equal(first.revision, 2);
  const later = await loadTrip(db, trip.id);
  assert.equal(later!.name, 'Later response');
  assert.equal(later!.revision, 3);
}

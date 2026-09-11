import type { AiGateway } from '../ai.js';
import { loadTrip, loadTrips } from '../data.js';
import type { AppDatabase } from '../db/client.js';
import { parseInput } from '../domain.js';
import { generateTripDraft } from '../trip-creation/service.js';
import { idSchema } from '../trips/inputs.js';
import { createItineraryService } from '../trips/itinerary-service.js';
import { createStopService } from '../trips/stop-service.js';
import { createTripService } from '../trips/trip-service.js';
import { handle } from './errors.js';

// Adapt application commands once; services never depend on GraphQL resolver arguments.
function mutationResolvers<T extends Record<string, (args: never) => Promise<unknown>>>(commands: T) {
  return Object.fromEntries(Object.entries(commands).map(([name, command]) => [
    name, (_root: unknown, args: never) => handle(() => command(args)),
  ]));
}

export function buildResolvers(db: AppDatabase, aiGateway: AiGateway) {
  return {
    Query: {
      trips: () => handle(() => db.transaction(tx => loadTrips(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' })),
      trip: (_root: unknown, args: { id: string }) => handle(() => {
        const id = parseInput(idSchema, args.id);
        return db.transaction(tx => loadTrip(tx, id), { isolationLevel: 'repeatable read', accessMode: 'read only' });
      }),
    },
    Mutation: mutationResolvers({
      ...createTripService(db),
      ...createStopService(db),
      ...createItineraryService(db),
      generateTripDraft: (args: { input: unknown }) => generateTripDraft(aiGateway, args),
    }),
  };
}

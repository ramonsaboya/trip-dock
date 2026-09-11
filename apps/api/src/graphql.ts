import { createSchema, createYoga } from 'graphql-yoga';
import { packingTypeDefs } from './packing-graphql.js';
import { packingResolvers } from './packing-data.js';
import type { AiGateway } from './ai.js';
import type { AppDatabase } from './db/client.js';
import { typeDefs } from './graphql/schema.js';
import { buildResolvers } from './graphql/resolvers.js';

export type CreateApiOptions = {
  db: AppDatabase;
  aiGateway: AiGateway;
  webOrigin: string;
  graphiql?: boolean;
  packingProfileId?: string;
};

export function createApi({ db, aiGateway, webOrigin, graphiql = false, packingProfileId }: CreateApiOptions) {
  const base = buildResolvers(db, aiGateway);
  const packing = packingResolvers(db, packingProfileId);
  return createYoga({
    schema: createSchema({ typeDefs: [typeDefs, packingTypeDefs], resolvers: { ...base, Query: { ...base.Query, ...packing.Query }, Mutation: { ...base.Mutation, ...packing.Mutation } } }),
    graphqlEndpoint: '/graphql',
    cors: {
      origin: webOrigin,
      methods: ['POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    },
    graphiql,
    logging: false,
    // Development must not send SQL, connection details or upstream errors to browsers.
    maskedErrors: { isDev: false },
  });
}

import { createServer } from 'node:http';

import { OpenAiGateway, UnconfiguredAiGateway } from './ai.js';
import { readRuntimeConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createApi } from './graphql.js';

const config = readRuntimeConfig();
const database = createDatabase(config.databaseUrl);
const aiGateway =
  config.openAiApiKey && config.openAiModel
    ? new OpenAiGateway(config.openAiModel, config.openAiApiKey)
    : new UnconfiguredAiGateway();
const yoga = createApi({
  db: database.db,
  aiGateway,
  webOrigin: config.webOrigin,
  graphiql: config.isDevelopment,
});
const server = createServer(yoga);

server.listen(config.apiPort, '127.0.0.1', () => {
  console.log(`TripDock API ready at http://127.0.0.1:${config.apiPort}/graphql`);
});

async function shutdown(signal: string) {
  console.log(`TripDock API received ${signal}; closing local connections.`);
  server.close();
  await database.pool.end();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export type RuntimeConfig = {
  databaseUrl: string;
  apiPort: number;
  webOrigin: string;
  openAiApiKey: string;
  openAiModel: string;
  isDevelopment: boolean;
};

export function readRuntimeConfig(): RuntimeConfig {
  const apiPort = Number(process.env.API_PORT ?? 4000);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const parsedOrigin = new URL(webOrigin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    throw new Error('WEB_ORIGIN must be an HTTP(S) origin.');
  }
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgresql://tripdock:tripdock@127.0.0.1:5432/tripdock',
    apiPort,
    webOrigin: parsedOrigin.origin,
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
    openAiModel: process.env.OPENAI_MODEL ?? '',
    isDevelopment: process.env.NODE_ENV !== 'production',
  };
}

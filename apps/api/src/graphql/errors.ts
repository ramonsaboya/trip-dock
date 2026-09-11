import { GraphQLError } from 'graphql';
import { ZodError } from 'zod';
import { AppError } from '../domain.js';

function toGraphQLError(error: unknown): never {
  if (error instanceof GraphQLError) throw error;
  if (error instanceof ZodError) {
    throw new GraphQLError(error.issues[0]?.message ?? 'Invalid input.', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  if (error instanceof AppError) {
    throw new GraphQLError(error.message, {
      extensions: { code: error.code, ...error.details },
    });
  }
  throw error;
}

export async function handle<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return toGraphQLError(error);
  }
}



export type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string; [key: string]: unknown } }>;
};

export class TripDockGraphQLError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code = 'GRAPHQL_ERROR',
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TripDockGraphQLError';
    this.code = code;
    this.details = details;
  }
}

export async function graphqlRequest<TData, TVariables extends Record<string, unknown>>(
  query: string,
  variables: TVariables,
  signal?: AbortSignal,
): Promise<TData> {
  const endpoint =
    process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new TripDockGraphQLError(
      'TripDock could not connect. Check that the app services are running, then retry.',
      'NETWORK_ERROR',
    );
  }
  if (!response.ok) {
    throw new TripDockGraphQLError(
      `TripDock returned HTTP ${response.status}.`,
      'HTTP_ERROR',
      { status: response.status },
    );
  }
  const payload = (await response.json()) as GraphQLResponse<TData>;
  const firstError = payload.errors?.[0];
  if (firstError) {
    const { code = 'GRAPHQL_ERROR', ...details } = firstError.extensions ?? {};
    throw new TripDockGraphQLError(firstError.message, code, details);
  }
  if (!payload.data) {
    throw new TripDockGraphQLError('TripDock returned no data.', 'EMPTY_RESPONSE');
  }
  return payload.data;
}

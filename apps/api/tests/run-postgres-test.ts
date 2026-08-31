process.env.TRIPDOCK_REQUIRE_POSTGRES_TEST = '1';

await import('./postgres.integration.test.js');

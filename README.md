# Matter Layer

Matter Layer is a private, firm-isolated legal AI workspace for managing matters, documents, workflows, and generated work product.

## Quick start

See [Getting Started](docs/getting-started.md).

## Configuration

- [Environment Variables](docs/environment-variables.md)
- Google OAuth Setup: run the app and open `/google-oauth`
- [Vercel Deployment](docs/deployment-vercel.md)

## Testing

Use Vitest for fast unit and integration tests of workflow-step logic,
document services, extraction services, schema validation, storage providers,
and other non-browser code:

```sh
npm run test
npm run test:watch
npm run test:coverage
```

Use Playwright only for browser-level user flows:

```sh
npm run test:e2e
```

Run both layers with:

```sh
npm run test:all
```

## Playwright test database

Playwright tests must use a separate PostgreSQL database from local
development. Keep `.env.local` pointed at the normal development database, for
example `matter_layer_dev`. Create `.env.test.local` from
`.env.test.local.example` and point it at a test-only database, for example
`matter_layer_test`.

The e2e scripts load `.env.test.local` automatically:

```sh
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:reset-db
```

Before Playwright starts, the test database setup verifies that `DATABASE_URL`
clearly contains `test`, runs `prisma db push --force-reset`, and deletes
application rows so each run starts clean. If the URL points at a non-test
database, the setup fails before mutating data.

## Security

- [Security Model](docs/security-model.md)
- [Matter Isolation](docs/matter-isolation.md)

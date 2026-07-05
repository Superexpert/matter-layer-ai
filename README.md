# Matter Layer

Matter Layer is a private, firm-isolated legal AI workspace for managing
matters, documents, workflows, and generated work product.

## Quick Start

1. Clone the repository.

```sh
git clone <repo-url>
cd matter-layer-ai
```

2. Install Node.js 24 and PostgreSQL.

Matter Layer requires Node.js `>=24 <25`. PostgreSQL must be running locally or
available through a connection URL.

3. Create a local development database.

```sh
createdb matter_layer_dev
```

4. Configure Google Auth.

Matter Layer cannot be used without Google sign-in. In Google Cloud Console,
create or select a project for Matter Layer, then configure Google Auth Platform
and create an OAuth web client:

- App name: `Matter Layer`
- Audience: `Internal` for a Google Workspace-only deployment
- Application type: `Web application`
- Local authorized redirect URI:
  `http://localhost:3000/api/auth/callback/google`

Copy the OAuth client ID and client secret. The client ID becomes
`AUTH_GOOGLE_ID`; the client secret becomes `AUTH_GOOGLE_SECRET`.

Generate the auth secret:

```sh
npx auth secret
```

5. Create `.env.local`.

```sh
cp .env.example .env.local
```

Update `.env.local` with the database URL and Google Auth values:

```sh
AUTH_SECRET="paste-generated-secret-here"
AUTH_GOOGLE_ID="paste-client-id-here"
AUTH_GOOGLE_SECRET="paste-client-secret-here"
NEXTAUTH_URL="http://localhost:3000"

DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/matter_layer_dev?schema=public"
```

If your local PostgreSQL user does not use a password, adjust `DATABASE_URL` to
match your local setup.

6. Install dependencies and push the Prisma schema.

```sh
npm install
npm run db:push
npm run sync:workflows
```

7. Start the development server.

```sh
npm run dev
```

Open `http://localhost:3000` and sign in with Google.

## Ollama (Optional)

Ollama lets Matter Layer use local AI models running on your own machine or
server instead of a hosted AI provider. It is optional for local development.

1. Install Ollama.

Download the installer from `https://ollama.com/download`, or use the command
line installer for your platform:

```sh
# macOS or Linux
curl -fsSL https://ollama.com/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://ollama.com/install.ps1 | iex
```

2. Start Ollama.

On macOS and Windows, open the Ollama app. On Linux, start the Ollama service if
the installer did not start it automatically.

3. Pull a local model.

```sh
ollama pull gemma3:4b
```

4. Confirm Ollama is running.

```sh
ollama list
```

Ollama's default local server URL is `http://localhost:11434`.

5. Configure Matter Layer.

Sign in as an admin, open the Admin page, choose `Ollama Local` as the AI
provider, keep the server URL as `http://localhost:11434` unless Ollama is
running on another server, refresh the model list, select the installed model,
and save the provider.

## Testing

Matter Layer uses Vitest for unit and integration tests, and Playwright for
browser-level user flows.

Create a separate PostgreSQL database for tests:

```sh
createdb matter_layer_test
cp .env.test.local.example .env.test.local
```

Update `.env.test.local` so `DATABASE_URL` points at the test database. The
database name must contain `test`; the Playwright reset guard refuses to mutate
a database whose URL does not clearly contain `test`.

Example:

```sh
AUTH_SECRET="test-auth-secret-at-least-32-characters"
AUTH_GOOGLE_ID="test-google-id"
AUTH_GOOGLE_SECRET="test-google-secret"
NEXTAUTH_URL="http://127.0.0.1:3000"

DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/matter_layer_test?schema=public"
```

Run unit and integration tests with Vitest:

```sh
npm run test
npm run test:watch
npm run test:coverage
```

Run only unit tests:

```sh
npm run test:unit
```

Run only integration tests:

```sh
npm run test:integration
```

Run browser-level Playwright tests:

```sh
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:headed
```

Reset the Playwright test database:

```sh
npm run test:e2e:reset-db
```

Run both Vitest and Playwright:

```sh
npm run test:all
```

The e2e scripts load `.env.test.local` automatically. Before Playwright starts,
the test setup verifies that `DATABASE_URL` clearly contains `test`, runs
`prisma db push --force-reset`, and deletes application rows so each run starts
clean.

# Local development

## Prerequisites

- Node ≥ 20.11
- PostgreSQL 16+ and Redis 7+ — either local installs or
  `docker compose up -d` (see `docker-compose.yml`).

## Setup

```bash
npm install
cp .env.example .env          # fill DATABASE_URL / DIRECT_DATABASE_URL / REDIS_URL / AUTH_SECRET / APP_URL
npx prisma migrate deploy
npm run db:seed               # SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD create the super-admin
npm run dev                   # http://localhost:3000
npm run worker                # separate terminal — campaigns, notifications, retries
```

Optional crons while developing:

```bash
npm run cron:reminders
npm run cron:retry-messages
```

## Integrations are optional

With every integration key unset the app still runs end to end:
e-mail prints to the console, WhatsApp/Stripe/AI features report "not configured"
and degrade (chat → human queue, payments disabled), nothing is faked. Add keys
per `docs/deployment/*.md` to light each one up.

## Tests

```bash
npm run typecheck
npm run lint
npm test            # unit always; DB integration only when RUN_DB_TESTS=1
```

DB integration tests need a throwaway database:

```bash
createdb barber_test
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/barber_test" \
  DIRECT_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/barber_test" \
  npx prisma migrate deploy
SEED_ADMIN_PASSWORD=test-admin-pw npx tsx prisma/seed.ts
```

Put `RUN_DB_TESTS=1` (+ the `DATABASE_URL` above) in `.env.test` (git-ignored);
`tests/setup.ts` loads it.

## Notes

- The logger emits JSON. For colour: `npm run dev | npx pino-pretty`.
- `next dev` can be slow to compile the authenticated route tree on some
  Windows/Node setups — the verification loop used in CI is
  `typecheck && lint && test && build`.

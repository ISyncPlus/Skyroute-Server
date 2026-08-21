# SkyRoute API

The server behind SkyRoute. Express 5, PostgreSQL and Prisma, in TypeScript.

This is the migration described in the technical report at Table 13.1: the nine
domain entities become relational tables, authentication moves off the client,
and the fare, seat and validation rules cross over **unchanged** - so a booking
priced by the browser build and one priced here produce the same number to the
naira.

---

## Getting started

You need Node 20.11+ and a PostgreSQL 14+ database.

```bash
cp .env.example .env      # then fill in every REPLACE_ME
npm install
npm run db:generate       # generate the Prisma client
npm run db:migrate        # create the tables
npm run db:seed           # airports, aircraft, 21 days of flights, demo accounts
npm run dev               # http://localhost:4000
```

`npm run setup` runs generate, deploy and seed in one go.

The server refuses to start while a placeholder is still in `.env`. That is
deliberate: a missing secret should fail loudly at boot, not quietly at the
first request that needs it.

### What you must fill in

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD` | Anything you like — the seed refuses to create an account without one |
| `GOOGLE_CLIENT_ID` / `_SECRET` | https://console.cloud.google.com/apis/credentials |
| `GITHUB_CLIENT_ID` / `_SECRET` | https://github.com/settings/developers |

OAuth is **optional**. A provider whose credentials are absent is simply not
mounted, and everything else works. Register these callback URLs:

```
http://localhost:4000/api/auth/oauth/google/callback
http://localhost:4000/api/auth/oauth/github/callback
```

---

## Architecture

The same four layers as the browser build, with the bottom one swapped:

```
  http/         Routes, validation, error boundary  — knows about HTTP
  services/     Use cases, authorisation, transactions — knows about the database
  domain/       Pricing, seats, validation, ids     — knows about NOTHING
  db/           Prisma client and constraints
```

`src/domain/` imports no Prisma, no Express and no database type. It is a set
of pure functions that can be unit-tested with no server and no database
running — which is why 163 tests execute in under three seconds.

`src/services/mappers.ts` is the only place Prisma rows become domain objects.
Confining the translation there is what keeps the JSON on the wire identical to
what the frontend already consumes.

---

## The three properties that matter

**A seat is never sold twice.** Not by checking first and hoping — checking
first is a race. A partial unique index on `(flight_id, seat_id)` over active
assignments makes it impossible at the storage layer:

```sql
CREATE UNIQUE INDEX seat_assignments_flight_seat_active_key
  ON seat_assignments (flight_id, seat_id) WHERE active;
```

It is *partial* on purpose. A plain unique index would forbid reselling 12A
after the booking holding it was cancelled — which is exactly what cancellation
is supposed to make possible. Cancelling flips `active` to false, dropping the
row out of the index while keeping the record of who sat where.

**A journey is all-or-nothing.** Every leg is validated and priced before any
row is written, inside one `SERIALIZABLE` transaction. Confirming an outbound
and then discovering the return is full would strand a customer mid-itinerary.
Serialization failures are retried three times, because two people buying at
the same instant is not an error — it just means the database made them take
turns.

**A declined payment leaves nothing behind.** The transaction is abandoned, so
there is no partial record to reconcile.

---

## API

Everything is under `/api`. Errors are always
`{ error: { code, message, fieldErrors? } }`.

### Auth — `/api/auth`

| | | |
|---|---|---|
| `POST` | `/register` | Create an account, sign in |
| `POST` | `/login` | Sign in |
| `POST` | `/logout` | Revoke this session |
| `POST` | `/logout-all` | Revoke every session |
| `GET` | `/me` | Current user, or `{ user: null }` |
| `PATCH` | `/me` | Update name or phone |
| `POST` | `/change-password` | Revokes all sessions |
| `GET` | `/oauth/providers` | Which providers are configured |
| `GET` | `/oauth/:provider` | Begin the handshake |
| `GET` | `/oauth/:provider/callback` | Provider returns here |
| `DELETE` | `/oauth/:provider` | Unlink |

### Flights — `/api/flights`

| | | |
|---|---|---|
| `GET` | `/airports` | All airports |
| `GET`/`POST` | `/search` | GET for one-way and return, POST for multi-city |
| `GET` | `/alternative-dates` | Dates on this route that have departures |
| `GET` | `/:flightId` | One flight |
| `GET` | `/:flightId/seats` | Derived seat map with per-cabin availability |

### Bookings — `/api/bookings`

| | | |
|---|---|---|
| `POST` | `/` | Book. Works signed in **or as a guest** |
| `GET` | `/` | My bookings (guest bookings never appear) |
| `POST` | `/lookup` | Reference + surname, no account needed |
| `GET` | `/:pnr` | By reference; ownership enforced |
| `POST` | `/:pnr/cancel` | Cancel; returns the refund |

### Admin — `/api/admin` (administrators only)

`GET /stats`, full CRUD on `/flights`, `GET /bookings`,
`POST /bookings/:pnr/cancel`, `GET /users`, `PATCH /users/:id/role`,
`POST /schedule/extend`.

---

## Security

- **Passwords: scrypt**, memory-hard, ~64 MB per hash, parameters stored
  alongside the digest so they can be raised later without invalidating
  anything. The browser build's SHA-256×1000 was reasonable for a client with
  only SubtleCrypto; it is not what you deploy, because SHA-256 is fast and
  parallelises beautifully on a GPU.
- **Sessions: opaque tokens** in HTTP-only, SameSite cookies, with only the
  SHA-256 digest in the database. Not JWTs — a JWT cannot be revoked before it
  expires without keeping server-side state anyway, at which point it is doing
  nothing a database row was not already doing while adding an
  algorithm-confusion surface. Signing out of a stolen session has to work.
- **Identical login failures.** Unknown email and wrong password return the
  same message, and an unknown email still pays the cost of a hash comparison,
  so the timing does not leak what the message refuses to say.
- **Authorisation lives in the services**, beside the record — not in route
  guards, which the next caller can forget to mount.
- **Rate limiting** on credentials (10 per 15 min in production) and globally.
- **A card number is never stored**, in any column. Only the last four digits.
- **OAuth linking requires a verified address.** An unverified email from a
  provider is not proof of ownership; treating it as such is one signup away
  from account takeover.

---

## Testing

```bash
npm test
```

163 tests across five suites, no database required:

| Suite | Tests | Covers |
|---|---|---|
| `validation.test.ts` | 57 | Email, Nigerian phone, passport, password rules, search rules, age bands, Luhn, card brands, expiry, PNR generation |
| `pricing.test.ts` | 49 | Every band boundary, cabin and passenger factors, seat fees, VAT, once-per-booking service charge, multi-leg combination, refund schedule |
| `seats.test.ts` | 20 | Seat derivation across aircraft, window/aisle/exit classification, occupancy including seats held on later legs, the selection guard |
| `security.test.ts` | 19 | scrypt round-trip, salt uniqueness, unicode normalisation, corrupted records, token entropy and irreversibility |
| `schedule.test.ts` | 18 | Reference-data integrity, generation, and **timezone independence** |

The timezone suite is the one worth pointing at. In the browser, `09:15` meant
nine-fifteen where the user was sitting, and `Date`'s local-time methods were
exactly right. A server might run in UTC in Frankfurt while the airline it
simulates operates out of Lagos, and a departure board that shifts by an hour
depending on where the process is deployed is not a departure board. The tests
run the generator with the process clock set to New York, Tokyo, Auckland and
UTC and assert the schedule is byte-identical.

---

## Notes

**A bug found during the port.** The original `generateUniquePnr` fell back to
`Date.now().toString(36)` after 50 collisions — base-36, which emits `0`, `1`,
`I` and `O`, precisely the four characters the PNR alphabet excludes. The
fallback could therefore mint a reference that `isValidPnr` then rejects: a
booking that exists and can never be looked up. Vanishingly rare, silent, and
unrecoverable. It now encodes in the PNR alphabet itself, and two tests hold
that line.

**Prisma deprecation.** `package.json#prisma` warns that it moves to
`prisma.config.ts` in Prisma 7. It works today; migrate when you upgrade.

**Connecting the frontend.** Point it at `http://localhost:4000/api` and send
`credentials: "include"` on every request, or the session cookie will not
travel. The response shapes are unchanged, so `lib/repository.ts` becomes fetch
calls and nothing above it needs to know.

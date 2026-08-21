/**
 * Seed the database.
 *
 * Idempotent by design: airports and aircraft are upserted, flights are keyed
 * by number-date-time and skipped if present, and the demo accounts are only
 * created if missing. Running it twice does not double anything, and running
 * it against a populated database tops up the schedule without disturbing
 * bookings that already exist.
 *
 *   npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import { AIRCRAFT_LAYOUTS, AIRPORTS, EXIT_ROWS, generateSchedule } from "../src/domain/schedule.js";
import { hashPassword } from "../src/lib/password.js";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

/** Written straight to stdout: the logger is silent at some log levels. */
const say = (message: string) => process.stdout.write(`${message}\n`);

async function seedAirports(): Promise<number> {
  for (const airport of AIRPORTS) {
    await prisma.airport.upsert({
      where: { code: airport.code },
      update: { city: airport.city, name: airport.name, country: airport.country },
      create: airport,
    });
  }
  return AIRPORTS.length;
}

async function seedAircraft(): Promise<number> {
  const types = Object.keys(AIRCRAFT_LAYOUTS);

  for (const type of types) {
    const cabins = AIRCRAFT_LAYOUTS[type] ?? [];

    await prisma.aircraft.upsert({
      where: { type },
      update: { exitRows: EXIT_ROWS[type] ?? [] },
      create: { type, exitRows: EXIT_ROWS[type] ?? [] },
    });

    for (const cabin of cabins) {
      await prisma.aircraftCabin.upsert({
        where: { aircraftType_cabin: { aircraftType: type, cabin: cabin.cabin } },
        update: {
          startRow: cabin.startRow,
          endRow: cabin.endRow,
          columns: cabin.columns,
        },
        create: {
          aircraftType: type,
          cabin: cabin.cabin,
          startRow: cabin.startRow,
          endRow: cabin.endRow,
          columns: cabin.columns,
        },
      });
    }
  }

  return types.length;
}

async function seedFlights(): Promise<{ created: number; existing: number }> {
  const generated = generateSchedule(new Date(), env.SCHEDULE_HORIZON_DAYS);

  const existing = new Set(
    (await prisma.flight.findMany({ select: { id: true } })).map((flight) => flight.id),
  );
  const fresh = generated.filter((flight) => !existing.has(flight.id));

  // createMany in one round trip; there are a few thousand rows and inserting
  // them one at a time turns a two-second seed into a two-minute one.
  if (fresh.length > 0) {
    await prisma.flight.createMany({
      data: fresh.map((flight) => ({
        id: flight.id,
        flightNumber: flight.flightNumber,
        airline: flight.airline,
        airlineCode: flight.airlineCode,
        originCode: flight.originCode,
        destinationCode: flight.destinationCode,
        departureTime: new Date(flight.departureTime),
        arrivalTime: new Date(flight.arrivalTime),
        durationMinutes: flight.durationMinutes,
        aircraftType: flight.aircraft,
        baseFare: flight.baseFare,
        currency: flight.currency,
        blockedSeats: flight.blockedSeats,
        status: flight.status,
      })),
      skipDuplicates: true,
    });
  }

  return { created: fresh.length, existing: generated.length - fresh.length };
}

/**
 * The demo accounts.
 *
 * Refuses to create either without a password from the environment. A default
 * password baked into a seed script is the kind of thing that survives all the
 * way to production and becomes the way in.
 */
async function seedAccounts(): Promise<string[]> {
  const created: string[] = [];

  const accounts = [
    {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      fullName: "SkyRoute Administrator",
      role: "admin" as const,
      phone: "08030000001",
      variable: "SEED_ADMIN_PASSWORD",
    },
    {
      email: env.SEED_CUSTOMER_EMAIL,
      password: env.SEED_CUSTOMER_PASSWORD,
      fullName: "Demo Customer",
      role: "customer" as const,
      phone: "08030000002",
      variable: "SEED_CUSTOMER_PASSWORD",
    },
  ];

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (existing) {
      say(`  · ${account.email} already exists — left untouched.`);
      continue;
    }

    if (!account.password || account.password.includes("REPLACE_ME")) {
      say(`  ! ${account.email} NOT created: set ${account.variable} in .env first.`);
      continue;
    }

    await prisma.user.create({
      data: {
        email: account.email.toLowerCase(),
        fullName: account.fullName,
        phone: account.phone,
        role: account.role,
        emailVerified: true,
        passwordHash: await hashPassword(account.password),
      },
    });

    created.push(account.email);
  }

  return created;
}

/**
 * The partial unique index on (flight_id, seat_id).
 *
 * Repeated from src/db/constraints.ts because `prisma migrate reset` runs this
 * seed directly, and a freshly reset database must not be left without the one
 * constraint that makes double-selling a seat impossible.
 */
async function applyConstraints(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS seat_assignments_flight_seat_active_key
      ON seat_assignments (flight_id, seat_id)
      WHERE active
  `);
}

async function main(): Promise<void> {
  say("\nSeeding SkyRoute\n----------------");

  const airports = await seedAirports();
  say(`  Airports        ${airports}`);

  const aircraft = await seedAircraft();
  say(`  Aircraft types  ${aircraft}`);

  const flights = await seedFlights();
  say(`  Flights         ${flights.created} created, ${flights.existing} already present`);

  const accounts = await seedAccounts();
  say(`  Accounts        ${accounts.length} created`);

  await applyConstraints();
  say("  Constraints     applied");

  say("\nDone.\n");
}

main()
  .catch((error) => {
    process.stderr.write(`\nSeeding failed: ${String(error)}\n\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

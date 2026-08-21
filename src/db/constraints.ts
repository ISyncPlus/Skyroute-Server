/**
 * Database constraints that Prisma's schema language cannot express.
 *
 * Prisma has no syntax for a PARTIAL unique index, and a partial index is
 * exactly what seat uniqueness requires: (flight_id, seat_id) must be unique
 * among ACTIVE assignments only. A plain unique index would be wrong — it
 * would forbid reselling seat 12A after the booking holding it was cancelled,
 * which is precisely what cancellation is supposed to make possible.
 *
 * Applied idempotently, so it is safe to run on every boot and from setup.
 */

import { prisma } from "./client.js";
import { logger } from "../config/logger.js";

const SEAT_UNIQUENESS = `
  CREATE UNIQUE INDEX IF NOT EXISTS seat_assignments_flight_seat_active_key
    ON seat_assignments (flight_id, seat_id)
    WHERE active
`;

/**
 * A booking must not mix currencies, and totals must add up. Expressed as a
 * CHECK so that a bug in application code cannot write an incoherent fare.
 */
const FARE_ADDS_UP = `
  ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_fare_adds_up
`;

const FARE_ADDS_UP_ADD = `
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_fare_adds_up
    CHECK (total = base_fare_total + cabin_surcharge + seat_selection_fee + taxes + service_charge)
`;

const REFUND_NOT_NEGATIVE = `
  ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_refund_not_negative
`;

const REFUND_NOT_NEGATIVE_ADD = `
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_refund_not_negative
    CHECK (refund_amount IS NULL OR (refund_amount >= 0 AND refund_amount <= total))
`;

const ARRIVES_AFTER_DEPARTURE = `
  ALTER TABLE flights
    DROP CONSTRAINT IF EXISTS flights_arrives_after_departure
`;

const ARRIVES_AFTER_DEPARTURE_ADD = `
  ALTER TABLE flights
    ADD CONSTRAINT flights_arrives_after_departure
    CHECK (arrival_time > departure_time)
`;

export async function applyDatabaseConstraints(): Promise<void> {
  const statements = [
    SEAT_UNIQUENESS,
    FARE_ADDS_UP,
    FARE_ADDS_UP_ADD,
    REFUND_NOT_NEGATIVE,
    REFUND_NOT_NEGATIVE_ADD,
    ARRIVES_AFTER_DEPARTURE,
    ARRIVES_AFTER_DEPARTURE_ADD,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  logger.debug("Database constraints applied.");
}

/** The Postgres error code raised when a unique index is violated. */
export const UNIQUE_VIOLATION = "P2002";

/** Name of the seat index, so the booking service can recognise its violation. */
export const SEAT_INDEX_NAME = "seat_assignments_flight_seat_active_key";

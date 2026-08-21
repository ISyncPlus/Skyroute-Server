/**
 * Bookings.
 *
 * This is the system's one real transaction and the module everything else
 * exists to support, so it is written defensively on purpose.
 *
 * Three properties it must hold, in order of how expensive they are to get
 * wrong:
 *
 *   1. A seat is never sold twice. Guaranteed by a partial unique index on
 *      (flight_id, seat_id) over active assignments, not by checking first and
 *      hoping. Checking first is a race; the index is a fact.
 *   2. A journey is all-or-nothing. Every leg is validated and priced before
 *      any row is written, and the whole thing runs inside one SERIALIZABLE
 *      transaction. Confirming an outbound and then discovering the return is
 *      full would strand a customer mid-itinerary with a booking they did not
 *      ask for.
 *   3. A declined payment leaves nothing behind. The transaction is abandoned,
 *      so there is no partial record to reconcile later.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { SEAT_INDEX_NAME } from "../db/constraints.js";
import { logger } from "../config/logger.js";
import {
  calculateFare,
  calculateRefund,
  combineFares,
  daysUntil,
  type FareContext,
} from "../domain/pricing.js";
import { countAvailable, loadFactor } from "../domain/seats.js";
import { generateTransactionReference, generateUniquePnr, isValidPnr } from "../domain/ids.js";
import { maskCardNumber, sanitiseText, MAX_PASSENGERS_PER_BOOKING } from "../domain/validation.js";
import { availableCabins, seatMapFrom } from "./flight.service.js";
import { toBooking, toFlight, type BookingWithRelations, type FlightWithAircraft } from "./mappers.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  paymentFailed,
  serverError,
} from "../http/errors.js";
import type {
  Booking,
  CabinClass,
  FareBreakdown,
  Flight,
  PassengerType,
  PaymentMethod,
  SessionUser,
  TripType,
} from "../domain/types.js";

const FLIGHT_INCLUDE = { aircraft: { include: { cabins: true } } } as const;

const BOOKING_INCLUDE = {
  passengers: true,
  segments: { include: { seatAssignments: true } },
  payment: true,
} as const;

const TRIP_TYPE_TO_DB = {
  "one-way": "ONE_WAY",
  "round-trip": "ROUND_TRIP",
  "multi-city": "MULTI_CITY",
} as const satisfies Record<TripType, Prisma.BookingCreateInput["tripType"]>;

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export interface CreateBookingLeg {
  flightId: string;
  cabin: CabinClass;
  /**
   * Seat per passenger, positionally matching `passengers`. Null where the
   * passenger is an infant or has no seat on this leg — a traveller can sit in
   * 12A outbound and 3C on the way home.
   */
  seatIds: (string | null)[];
}

export interface CreateBookingPassenger {
  title: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  passportNumber?: string | undefined;
  type: PassengerType;
}

export interface CreateBookingInput {
  legs: CreateBookingLeg[];
  tripType?: TripType | undefined;
  /** Null books as a guest. */
  userId: string | null;
  contactEmail: string;
  contactPhone: string;
  passengers: CreateBookingPassenger[];
  payment: {
    method: PaymentMethod;
    cardHolder?: string | undefined;
    cardNumber?: string | undefined;
    senderName?: string | undefined;
    /** Exercises the declined-payment path during testing. */
    forceFailure?: boolean | undefined;
  };
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

/** Postgres raises this when two SERIALIZABLE transactions cannot be ordered. */
const SERIALIZATION_FAILURE = "P2034";
const MAX_ATTEMPTS = 3;

export async function createBooking(
  input: CreateBookingInput,
  now: Date = new Date(),
): Promise<Booking> {
  /* A serialization failure is not an error in the business sense — it means
     two people bought at the same moment and the database made us take turns.
     The right response is to take our turn again, not to tell the customer
     something went wrong. */
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await attemptBooking(input, now);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE;

      if (!retryable || attempt === MAX_ATTEMPTS) throw error;

      logger.warn({ attempt }, "Booking hit a write conflict; retrying.");
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }

  throw serverError("The booking could not be completed. Please try again.");
}

async function attemptBooking(input: CreateBookingInput, now: Date): Promise<Booking> {
  if (input.passengers.length === 0) {
    throw badRequest("At least one passenger is required.");
  }
  if (input.passengers.length > MAX_PASSENGERS_PER_BOOKING) {
    throw badRequest(`A single booking may not exceed ${MAX_PASSENGERS_PER_BOOKING} passengers.`);
  }
  if (input.legs.length === 0) {
    throw badRequest("At least one flight is required.");
  }
  for (const leg of input.legs) {
    if (leg.seatIds.length !== input.passengers.length) {
      throw badRequest("A seat entry is required for every passenger on every flight.");
    }
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        /* ---- Validate and price EVERY leg before writing anything ---- */

        const priced: { flight: Flight; leg: CreateBookingLeg; fare: FareBreakdown }[] = [];

        for (const [index, leg] of input.legs.entries()) {
          // Only name the flight when there is more than one, so a one-way
          // booking keeps the plain wording its interface already expects.
          const where = input.legs.length > 1 ? ` on flight ${index + 1}` : "";

          const row = await tx.flight.findUnique({
            where: { id: leg.flightId },
            include: FLIGHT_INCLUDE,
          });
          if (!row) {
            throw notFound(`That flight could not be found${where}. It may have been removed.`);
          }

          const flight = toFlight(row as FlightWithAircraft);

          if (flight.status === "cancelled") {
            throw conflict(`This flight has been cancelled and cannot be booked${where}.`);
          }
          if (new Date(flight.departureTime).getTime() <= now.getTime()) {
            throw conflict(`This flight has already departed${where}.`);
          }
          if (!availableCabins(flight).includes(leg.cabin)) {
            throw badRequest(`The selected cabin is not available on this aircraft${where}.`);
          }

          /* Re-read occupancy INSIDE the transaction. The state the caller was
             holding when they opened the seat map is minutes old by now, and
             the only occupancy that matters is the one true at the instant of
             writing. */
          const taken = await tx.seatAssignment.findMany({
            where: { flightId: leg.flightId, active: true },
            select: { seatId: true },
          });
          const occupied = new Set(taken.map((seat) => seat.seatId));
          const seats = seatMapFrom(flight, occupied);
          const byId = new Map(seats.map((seat) => [seat.id, seat]));

          const requested = leg.seatIds.filter((seatId): seatId is string => Boolean(seatId));

          const duplicates = requested.filter((id, i) => requested.indexOf(id) !== i);
          if (duplicates.length > 0) {
            throw badRequest(`The same seat was selected more than once${where}.`);
          }

          const conflicts = requested.filter((seatId) => {
            const seat = byId.get(seatId);
            return !seat || seat.cabin !== leg.cabin || seat.status !== "available";
          });
          if (conflicts.length > 0) {
            throw conflict(
              `Seat(s) ${conflicts.join(", ")} are no longer available${where}. Please choose again.`,
            );
          }

          // Enough room for anyone travelling without a chosen seat.
          const unseated = leg.seatIds.filter(
            (seatId, position) => !seatId && input.passengers[position]?.type !== "infant",
          ).length;
          if (unseated > countAvailable(seats, leg.cabin) - requested.length) {
            throw conflict(`There are no longer enough seats in that cabin${where}.`);
          }

          const context: FareContext = {
            baseFare: flight.baseFare,
            cabin: leg.cabin,
            daysToDeparture: daysUntil(flight.departureTime, now),
            load: loadFactor(seats, leg.cabin),
          };

          priced.push({
            flight,
            leg,
            fare: calculateFare(
              context,
              input.passengers.map((passenger, position) => ({
                type: passenger.type,
                seatId: leg.seatIds[position] ?? null,
              })),
              seats,
            ),
          });
        }

        const firstFlight = priced[0]!.flight;
        // Levies the booking service fee once, not once per flight.
        const fare = combineFares(priced.map((entry) => entry.fare));

        /* ---- Payment ---- */

        const payment = authorisePayment(input, fare.total, firstFlight.currency, now);
        if (payment.status === "failed") {
          // Abandoning the transaction is what guarantees no partial record.
          throw paymentFailed(`Payment failed: ${payment.failureReason} No seats were reserved.`);
        }

        /* ---- Write ---- */

        const existing = await tx.booking.findMany({ select: { pnr: true } });
        const pnr = generateUniquePnr(existing.map((booking) => booking.pnr));

        const tripType: TripType =
          input.tripType ?? (input.legs.length > 1 ? "multi-city" : "one-way");

        await tx.booking.create({
          data: {
            pnr,
            userId: input.userId,
            tripType: TRIP_TYPE_TO_DB[tripType],
            status: "confirmed",
            contactEmail: sanitiseText(input.contactEmail, 120).toLowerCase(),
            contactPhone: sanitiseText(input.contactPhone, 20),
            baseFareTotal: fare.baseFareTotal,
            cabinSurcharge: fare.cabinSurcharge,
            seatSelectionFee: fare.seatSelectionFee,
            taxes: fare.taxes,
            serviceCharge: fare.serviceCharge,
            total: fare.total,
            currency: firstFlight.currency,
            createdAt: now,
            passengers: {
              create: input.passengers.map((passenger, position) => ({
                position,
                title: sanitiseText(passenger.title, 5),
                firstName: sanitiseText(passenger.firstName, 50),
                lastName: sanitiseText(passenger.lastName, 50),
                dateOfBirth: new Date(`${passenger.dateOfBirth}T00:00:00Z`),
                gender: sanitiseText(passenger.gender, 10),
                passportNumber: passenger.passportNumber
                  ? sanitiseText(passenger.passportNumber, 20).toUpperCase()
                  : null,
                type: passenger.type,
              })),
            },
            payment: {
              create: {
                method: payment.method,
                maskedCardNumber: payment.maskedCardNumber,
                cardHolder: payment.cardHolder,
                amount: payment.amount,
                currency: payment.currency,
                status: "successful",
                transactionReference: payment.transactionReference,
                paidAt: now,
              },
            },
          },
        });

        // Passenger ids are generated by the database, so seats can only be
        // attached once the rows exist and their positions are known.
        const passengers = await tx.passenger.findMany({
          where: { bookingPnr: pnr },
          orderBy: { position: "asc" },
        });

        for (const [position, entry] of priced.entries()) {
          const segment = await tx.bookingSegment.create({
            data: {
              bookingPnr: pnr,
              flightId: entry.leg.flightId,
              cabin: entry.leg.cabin,
              position,
            },
          });

          const assignments = passengers
            .map((passenger) => ({
              passenger,
              seatId: entry.leg.seatIds[passenger.position] ?? null,
            }))
            .filter((row): row is { passenger: (typeof passengers)[number]; seatId: string } =>
              Boolean(row.seatId),
            );

          if (assignments.length > 0) {
            // The unique index fires here if anyone beat us to a seat.
            await tx.seatAssignment.createMany({
              data: assignments.map(({ passenger, seatId }) => ({
                segmentId: segment.id,
                passengerId: passenger.id,
                flightId: entry.leg.flightId,
                seatId,
                active: true,
              })),
            });
          }
        }

        const created = await tx.booking.findUniqueOrThrow({
          where: { pnr },
          include: BOOKING_INCLUDE,
        });

        return toBooking(created as BookingWithRelations);
      },
      {
        // The strongest isolation Postgres offers. Anything weaker permits the
        // read-then-write race this whole function exists to prevent.
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
        maxWait: 10_000,
      },
    );
  } catch (error) {
    throw translateSeatCollision(error);
  }
}

/**
 * The unique index rejecting a seat is not a server fault — it is the correct
 * outcome of two people wanting 12A, reported to the loser in the same words
 * the pre-check would have used.
 */
function translateSeatCollision(error: unknown): unknown {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes(SEAT_INDEX_NAME)
  ) {
    return conflict(
      "One of the seats you chose was taken while you were paying. Nothing was charged — please choose again.",
    );
  }
  return error;
}

interface AuthorisedPayment {
  method: PaymentMethod;
  maskedCardNumber: string;
  cardHolder: string;
  amount: number;
  currency: string;
  status: "successful" | "failed";
  transactionReference: string;
  failureReason?: string;
}

/**
 * Simulated authorisation. No money moves and no card number is ever stored —
 * only the last four digits survive, exactly as on a real receipt.
 */
function authorisePayment(
  input: CreateBookingInput,
  amount: number,
  currency: string,
  _now: Date,
): AuthorisedPayment {
  const succeeded = !input.payment.forceFailure;

  let maskedCardNumber: string;
  let cardHolder: string;
  let failureReason: string;

  switch (input.payment.method) {
    case "transfer":
      maskedCardNumber = "Bank Transfer (Providus Bank · 1305012345)";
      cardHolder = sanitiseText(
        input.payment.senderName || input.payment.cardHolder || input.contactEmail || "Bank Transfer Depositor",
        80,
      );
      failureReason = "Bank transfer clearing failed or timed out.";
      break;

    case "wallet":
      maskedCardNumber = "SkyRoute Digital Wallet";
      cardHolder = sanitiseText(
        input.payment.cardHolder || input.contactEmail || "SkyRoute Wallet Account",
        80,
      );
      failureReason = "Insufficient wallet balance.";
      break;

    case "card":
    default:
      maskedCardNumber = maskCardNumber(input.payment.cardNumber ?? "");
      cardHolder = sanitiseText(input.payment.cardHolder ?? "", 80);
      failureReason = "Card declined by issuing bank.";
      break;
  }

  return {
    method: input.payment.method,
    maskedCardNumber,
    cardHolder,
    amount,
    currency,
    status: succeeded ? "successful" : "failed",
    transactionReference: generateTransactionReference(),
    ...(succeeded ? {} : { failureReason }),
  };
}

/* ------------------------------------------------------------------ */
/* Retrieval                                                           */
/* ------------------------------------------------------------------ */

export async function findByPnr(pnr: string): Promise<Booking | null> {
  if (!isValidPnr(pnr)) return null;

  const row = await prisma.booking.findUnique({
    where: { pnr: pnr.trim().toUpperCase() },
    include: BOOKING_INCLUDE,
  });

  return row ? toBooking(row as BookingWithRelations) : null;
}

/**
 * The "manage my booking" lookup: reference plus surname, which is how a guest
 * reaches a booking that belongs to no account.
 */
export async function findByPnrAndSurname(pnr: string, surname: string): Promise<Booking | null> {
  const booking = await findByPnr(pnr);
  if (!booking) return null;

  const normalised = surname.trim().toLowerCase();
  const matches = booking.passengers.some(
    (passenger) => passenger.lastName.toLowerCase() === normalised,
  );

  return matches ? booking : null;
}

export async function listForUser(userId: string): Promise<Booking[]> {
  const rows = await prisma.booking.findMany({
    where: { userId },
    include: BOOKING_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => toBooking(row as BookingWithRelations));
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Who is asking to cancel.
 *
 * A union rather than an optional surname, so a caller cannot quietly pass
 * neither and land in an unguarded branch. The type makes the insecure call
 * impossible to write rather than merely discouraged.
 */
export type CancelRequester =
  | { kind: "account"; user: SessionUser }
  | { kind: "guest"; surname: string };

export interface CancellationResult {
  booking: Booking;
  refund: number;
}

export async function cancelBooking(
  pnrInput: string,
  requestedBy: CancelRequester,
  now: Date = new Date(),
): Promise<CancellationResult> {
  const pnr = pnrInput.trim().toUpperCase();
  if (!isValidPnr(pnr)) throw notFound("No booking was found with that reference.");

  return prisma.$transaction(
    async (tx) => {
      const row = await tx.booking.findUnique({
        where: { pnr },
        include: BOOKING_INCLUDE,
      });
      if (!row) throw notFound("No booking was found with that reference.");

      const booking = toBooking(row as BookingWithRelations);

      /* ---- Authorisation ---- */

      if (requestedBy.kind === "guest") {
        const normalised = requestedBy.surname.trim().toLowerCase();
        const surnameMatches = booking.passengers.some(
          (passenger) => passenger.lastName.toLowerCase() === normalised,
        );
        // A guest may only reach a booking that belongs to nobody. Without the
        // userId check, knowing a reference and a surname would let a stranger
        // cancel an account holder's flight.
        if (booking.userId !== null || !surnameMatches) {
          throw forbidden("You do not have permission to cancel this booking.");
        }
      } else {
        const { user } = requestedBy;
        if (user.role !== "admin" && booking.userId !== user.id) {
          throw forbidden("You do not have permission to cancel this booking.");
        }
      }

      if (booking.status === "cancelled") {
        throw conflict("This booking has already been cancelled.");
      }

      /* ---- Timing ---- */

      const flights = await tx.flight.findMany({
        where: { id: { in: row.segments.map((segment) => segment.flightId) } },
        select: { departureTime: true },
      });
      if (flights.length === 0) {
        throw notFound("The flight for this booking no longer exists.");
      }

      /* Anchored to the FIRST departure. Anchoring to a later leg would let
         someone fly the outbound, cancel the return, and still collect the
         early-notice refund rate on the entire fare. */
      const firstDeparture = flights
        .map((flight) => flight.departureTime)
        .sort((a, b) => a.getTime() - b.getTime())[0]!;

      if (firstDeparture.getTime() <= now.getTime()) {
        throw conflict(
          flights.length > 1
            ? "This journey has already begun and can no longer be cancelled."
            : "This flight has already departed and can no longer be cancelled.",
        );
      }

      const refund = calculateRefund(booking.fare, firstDeparture.toISOString(), now);

      /* ---- Write ---- */

      await tx.booking.update({
        where: { pnr },
        data: { status: "cancelled", cancelledAt: now, refundAmount: refund },
      });

      /* Releasing the seats is what drops them out of the partial unique index
         and makes them sellable again. The rows are kept, not deleted, so the
         itinerary of a cancelled booking still shows who sat where. */
      await tx.seatAssignment.updateMany({
        where: { segment: { bookingPnr: pnr } },
        data: { active: false },
      });

      const updated = await tx.booking.findUniqueOrThrow({
        where: { pnr },
        include: BOOKING_INCLUDE,
      });

      return { booking: toBooking(updated as BookingWithRelations), refund };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * What a cancellation would refund, without performing it. The customer sees
 * the figure before they commit, which is the difference between a decision
 * and a surprise.
 */
export async function quoteRefund(pnr: string, now: Date = new Date()): Promise<number> {
  const booking = await findByPnr(pnr);
  if (!booking) throw notFound("No booking was found with that reference.");
  if (booking.status === "cancelled") return booking.refundAmount ?? 0;

  const flights = await prisma.flight.findMany({
    where: { id: { in: (booking.segments ?? []).map((segment) => segment.flightId) } },
    select: { departureTime: true },
  });
  if (flights.length === 0) return 0;

  const firstDeparture = flights
    .map((flight) => flight.departureTime)
    .sort((a, b) => a.getTime() - b.getTime())[0]!;

  return calculateRefund(booking.fare, firstDeparture.toISOString(), now);
}

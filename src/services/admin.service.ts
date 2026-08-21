/**
 * Administration.
 *
 * Every function here takes the acting user and checks it. The check lives
 * beside the work, not in the route, so that a new caller cannot reach the
 * operation without passing the guard.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { badRequest, conflict, forbidden, notFound, unauthorised } from "../http/errors.js";
import { toBooking, toFlight, type BookingWithRelations, type FlightWithAircraft } from "./mappers.js";
import { generateSchedule } from "../domain/schedule.js";
import { env } from "../config/env.js";
import type { Booking, Flight, FlightStatus, SessionUser } from "../domain/types.js";

const FLIGHT_INCLUDE = { aircraft: { include: { cabins: true } } } as const;
const BOOKING_INCLUDE = {
  passengers: true,
  segments: { include: { seatAssignments: true } },
  payment: true,
} as const;

function requireAdmin(actor: SessionUser | null): asserts actor is SessionUser {
  if (!actor) throw unauthorised("You must be signed in to perform this action.");
  if (actor.role !== "admin") {
    throw forbidden("Administrator privileges are required for this action.");
  }
}

/* ------------------------------------------------------------------ */
/* Flights                                                             */
/* ------------------------------------------------------------------ */

export interface FlightListQuery {
  status?: FlightStatus;
  originCode?: string;
  destinationCode?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listFlights(actor: SessionUser | null, query: FlightListQuery = {}) {
  requireAdmin(actor);

  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);

  const where: Prisma.FlightWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.originCode ? { originCode: query.originCode.toUpperCase() } : {}),
    ...(query.destinationCode ? { destinationCode: query.destinationCode.toUpperCase() } : {}),
    ...(query.from || query.to
      ? {
          departureTime: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00+01:00`) } : {}),
            ...(query.to ? { lt: new Date(`${query.to}T23:59:59+01:00`) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.flight.findMany({
      where,
      include: FLIGHT_INCLUDE,
      orderBy: { departureTime: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.flight.count({ where }),
  ]);

  return {
    flights: rows.map((row) => toFlight(row as FlightWithAircraft)),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export interface CreateFlightInput {
  flightNumber: string;
  airline: string;
  airlineCode: string;
  originCode: string;
  destinationCode: string;
  departureTime: string;
  arrivalTime: string;
  aircraft: string;
  baseFare: number;
  currency?: string | undefined;
  blockedSeats?: string[] | undefined;
  status?: FlightStatus | undefined;
}

export async function createFlight(
  actor: SessionUser | null,
  input: CreateFlightInput,
): Promise<Flight> {
  requireAdmin(actor);

  const departure = new Date(input.departureTime);
  const arrival = new Date(input.arrivalTime);

  if (Number.isNaN(departure.getTime()) || Number.isNaN(arrival.getTime())) {
    throw badRequest("Departure and arrival must be valid dates.");
  }
  if (arrival <= departure) {
    throw badRequest("Arrival time must be after departure time.");
  }
  if (input.originCode.toUpperCase() === input.destinationCode.toUpperCase()) {
    throw badRequest("Origin and destination must be different.");
  }

  const aircraft = await prisma.aircraft.findUnique({ where: { type: input.aircraft } });
  if (!aircraft) {
    throw badRequest(`Unknown aircraft type "${input.aircraft}". Add the layout first.`);
  }

  // Same identifier scheme as the generated schedule, so a hand-added flight is
  // indistinguishable from a generated one.
  const dateKey = departure.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const time = departure
    .toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })
    .replace(":", "");
  const id = `${input.flightNumber}-${dateKey}-${time}`;

  const existing = await prisma.flight.findUnique({ where: { id } });
  if (existing) {
    throw conflict("A flight with that number already exists on that date and time.");
  }

  const row = await prisma.flight.create({
    data: {
      id,
      flightNumber: input.flightNumber,
      airline: input.airline,
      airlineCode: input.airlineCode,
      originCode: input.originCode.toUpperCase(),
      destinationCode: input.destinationCode.toUpperCase(),
      departureTime: departure,
      arrivalTime: arrival,
      durationMinutes: Math.round((arrival.getTime() - departure.getTime()) / 60_000),
      aircraftType: input.aircraft,
      baseFare: input.baseFare,
      currency: input.currency ?? "NGN",
      blockedSeats: input.blockedSeats ?? [],
      status: input.status ?? "scheduled",
    },
    include: FLIGHT_INCLUDE,
  });

  return toFlight(row as FlightWithAircraft);
}

export async function updateFlight(
  actor: SessionUser | null,
  flightId: string,
  changes: Partial<CreateFlightInput>,
): Promise<Flight> {
  requireAdmin(actor);

  const current = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!current) throw notFound("That flight could not be found.");

  const departure = changes.departureTime ? new Date(changes.departureTime) : current.departureTime;
  const arrival = changes.arrivalTime ? new Date(changes.arrivalTime) : current.arrivalTime;

  if (arrival <= departure) {
    throw badRequest("Arrival time must be after departure time.");
  }

  const row = await prisma.flight.update({
    where: { id: flightId },
    data: {
      ...(changes.flightNumber !== undefined ? { flightNumber: changes.flightNumber } : {}),
      ...(changes.airline !== undefined ? { airline: changes.airline } : {}),
      ...(changes.airlineCode !== undefined ? { airlineCode: changes.airlineCode } : {}),
      ...(changes.originCode !== undefined
        ? { originCode: changes.originCode.toUpperCase() }
        : {}),
      ...(changes.destinationCode !== undefined
        ? { destinationCode: changes.destinationCode.toUpperCase() }
        : {}),
      ...(changes.departureTime !== undefined ? { departureTime: departure } : {}),
      ...(changes.arrivalTime !== undefined ? { arrivalTime: arrival } : {}),
      ...(changes.departureTime !== undefined || changes.arrivalTime !== undefined
        ? { durationMinutes: Math.round((arrival.getTime() - departure.getTime()) / 60_000) }
        : {}),
      ...(changes.aircraft !== undefined ? { aircraftType: changes.aircraft } : {}),
      ...(changes.baseFare !== undefined ? { baseFare: changes.baseFare } : {}),
      ...(changes.blockedSeats !== undefined ? { blockedSeats: changes.blockedSeats } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
    },
    include: FLIGHT_INCLUDE,
  });

  return toFlight(row as FlightWithAircraft);
}

/**
 * Deleting a flight that already carries passengers would orphan those
 * bookings, so it is refused. Cancelling it instead preserves the history and
 * is what the administrator actually means.
 */
export async function deleteFlight(
  actor: SessionUser | null,
  flightId: string,
): Promise<{ flightId: string }> {
  requireAdmin(actor);

  const held = await prisma.seatAssignment.count({
    where: { flightId, active: true },
  });
  const booked = await prisma.bookingSegment.count({
    where: { flightId, booking: { status: "confirmed" } },
  });

  if (held > 0 || booked > 0) {
    throw conflict(
      "This flight has confirmed bookings. Set its status to cancelled instead of deleting it.",
    );
  }

  try {
    await prisma.flight.delete({ where: { id: flightId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw notFound("That flight could not be found.");
    }
    throw error;
  }

  return { flightId };
}

/* ------------------------------------------------------------------ */
/* Bookings and users                                                  */
/* ------------------------------------------------------------------ */

export async function listAllBookings(
  actor: SessionUser | null,
  query: { status?: Booking["status"]; page?: number; pageSize?: number } = {},
) {
  requireAdmin(actor);

  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const where: Prisma.BookingWhereInput = query.status ? { status: query.status } : {};

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.booking.count({ where }),
  ]);

  return {
    bookings: rows.map((row) => toBooking(row as BookingWithRelations)),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function listUsers(actor: SessionUser | null) {
  requireAdmin(actor);

  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    bookingCount: row._count.bookings,
  }));
}

export async function setUserRole(
  actor: SessionUser | null,
  userId: string,
  role: "customer" | "admin",
) {
  requireAdmin(actor);

  // An administrator who demotes themselves could leave the system with no
  // administrator at all and no way to appoint one.
  if (userId === actor.id && role !== "admin") {
    throw conflict("You cannot remove your own administrator privileges.");
  }

  const user = await prisma.user.update({ where: { id: userId }, data: { role } });
  return { id: user.id, email: user.email, role: user.role };
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface SystemStats {
  totalFlights: number;
  scheduledFlights: number;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  totalPassengers: number;
  grossRevenue: number;
  refunded: number;
  netRevenue: number;
  registeredUsers: number;
  topRoutes: { route: string; bookings: number }[];
}

export async function getStats(actor: SessionUser | null): Promise<SystemStats> {
  requireAdmin(actor);

  const [
    totalFlights,
    scheduledFlights,
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    registeredUsers,
    revenue,
    refunds,
    passengerCount,
    routeRows,
  ] = await Promise.all([
    prisma.flight.count(),
    prisma.flight.count({ where: { status: "scheduled" } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: "confirmed" } }),
    prisma.booking.count({ where: { status: "cancelled" } }),
    prisma.user.count(),
    prisma.booking.aggregate({ where: { status: "confirmed" }, _sum: { total: true } }),
    prisma.booking.aggregate({ where: { status: "cancelled" }, _sum: { refundAmount: true } }),
    prisma.passenger.count({ where: { booking: { status: "confirmed" } } }),
    // Aggregated in the database rather than by loading every booking into
    // memory and counting there.
    prisma.$queryRaw<{ route: string; bookings: bigint }[]>`
      SELECT f.origin_code || ' to ' || f.destination_code AS route,
             COUNT(DISTINCT s.booking_pnr)                 AS bookings
        FROM booking_segments s
        JOIN flights  f ON f.id = s.flight_id
        JOIN bookings b ON b.pnr = s.booking_pnr
       WHERE b.status = 'confirmed'
         AND s.position = 0
       GROUP BY route
       ORDER BY bookings DESC
       LIMIT 5
    `,
  ]);

  const grossRevenue = revenue._sum.total ?? 0;
  const refunded = refunds._sum.refundAmount ?? 0;

  return {
    totalFlights,
    scheduledFlights,
    totalBookings,
    confirmedBookings,
    cancelledBookings,
    totalPassengers: passengerCount,
    grossRevenue,
    refunded,
    netRevenue: grossRevenue - refunded,
    registeredUsers,
    topRoutes: routeRows.map((row) => ({ route: row.route, bookings: Number(row.bookings) })),
  };
}

/* ------------------------------------------------------------------ */
/* Schedule maintenance                                                */
/* ------------------------------------------------------------------ */

/**
 * Extend the schedule so there are always departures to sell.
 *
 * Idempotent: flights are keyed by number-date-time, so re-running only adds
 * departures that do not exist yet. Nothing already sold is touched.
 */
export async function extendSchedule(
  actor: SessionUser | null,
  horizonDays: number = env.SCHEDULE_HORIZON_DAYS,
): Promise<{ created: number; skipped: number }> {
  requireAdmin(actor);

  const generated = generateSchedule(new Date(), horizonDays);
  const existing = new Set(
    (await prisma.flight.findMany({ select: { id: true } })).map((flight) => flight.id),
  );

  const fresh = generated.filter((flight) => !existing.has(flight.id));

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

  return { created: fresh.length, skipped: generated.length - fresh.length };
}

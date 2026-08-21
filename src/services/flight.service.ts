/**
 * Flights: lookup, search and seat maps.
 *
 * Availability and price are always derived at read time from the bookings
 * that exist, never read from a stored counter. A "seats remaining" column
 * would be a second source of truth, and the first time an update were missed
 * it would start selling seats that are not there.
 */

import { prisma } from "../db/client.js";
import { notFound } from "../http/errors.js";
import {
  buildSeatMap,
  countAvailable,
  countTotal,
  loadFactor,
} from "../domain/seats.js";
import { daysUntil, fareForPassenger, type FareContext } from "../domain/pricing.js";
import { toAirport, toFlight, type FlightWithAircraft } from "./mappers.js";
import type {
  Airport,
  Booking,
  CabinClass,
  Flight,
  FlightSearchResult,
  SearchCriteria,
  Seat,
} from "../domain/types.js";

/** Everything needed to turn a flight row into a domain Flight. */
const FLIGHT_INCLUDE = { aircraft: { include: { cabins: true } } } as const;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export async function listAirports(): Promise<Airport[]> {
  const rows = await prisma.airport.findMany({ orderBy: [{ country: "asc" }, { city: "asc" }] });
  return rows.map(toAirport);
}

export async function getFlight(flightId: string): Promise<Flight> {
  const row = await prisma.flight.findUnique({
    where: { id: flightId },
    include: FLIGHT_INCLUDE,
  });
  if (!row) throw notFound("That flight could not be found.");
  return toFlight(row as FlightWithAircraft);
}

/** Cabins actually fitted to the aircraft flying this service. */
export function availableCabins(flight: Flight): CabinClass[] {
  return flight.cabins.map((cabin) => cabin.cabin);
}

/**
 * Seats occupied on a flight.
 *
 * Read straight from seat_assignments rather than by walking bookings, because
 * the database already indexes exactly this question and the answer is needed
 * on every search result.
 */
async function occupiedSeatIds(flightIds: string[]): Promise<Map<string, Set<string>>> {
  if (flightIds.length === 0) return new Map();

  const rows = await prisma.seatAssignment.findMany({
    where: { flightId: { in: flightIds }, active: true },
    select: { flightId: true, seatId: true },
  });

  const byFlight = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byFlight.get(row.flightId) ?? new Set<string>();
    set.add(row.seatId);
    byFlight.set(row.flightId, set);
  }
  return byFlight;
}

/**
 * Build a seat map for a flight.
 *
 * The domain's buildSeatMap takes bookings because that is the shape the
 * browser had. Here the occupancy is already known, so a single synthetic
 * booking carries it in — cheaper than materialising every booking on the
 * flight, and it keeps one implementation of the seat-derivation rules rather
 * than a second copy that could drift from the tested one.
 */
export function seatMapFrom(flight: Flight, occupied: Set<string>): Seat[] {
  const carrier: Booking = {
    pnr: "OCCUPD",
    userId: null,
    flightId: flight.id,
    cabin: "economy",
    segments: [
      {
        flightId: flight.id,
        cabin: "economy",
        seats: Object.fromEntries([...occupied].map((seatId, index) => [`p${index}`, seatId])),
      },
    ],
    passengers: [],
    fare: {
      baseFareTotal: 0,
      cabinSurcharge: 0,
      seatSelectionFee: 0,
      taxes: 0,
      serviceCharge: 0,
      total: 0,
    },
    payment: null,
    status: "confirmed",
    contactEmail: "",
    contactPhone: "",
    createdAt: new Date(0).toISOString(),
  };

  return buildSeatMap(flight, [carrier]);
}

export interface SeatMapResponse {
  flight: Flight;
  seats: Seat[];
  cabins: {
    cabin: CabinClass;
    available: number;
    total: number;
    loadFactor: number;
  }[];
}

export async function getSeatMap(flightId: string): Promise<SeatMapResponse> {
  const flight = await getFlight(flightId);
  const occupied = (await occupiedSeatIds([flightId])).get(flightId) ?? new Set<string>();
  const seats = seatMapFrom(flight, occupied);

  return {
    flight,
    seats,
    cabins: availableCabins(flight).map((cabin) => ({
      cabin,
      available: countAvailable(seats, cabin),
      total: countTotal(seats, cabin),
      loadFactor: loadFactor(seats, cabin),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** The window of instants covered by a calendar date in the operating timezone. */
function dayBounds(departureDate: string): { gte: Date; lt: Date } {
  const gte = new Date(`${departureDate}T00:00:00+01:00`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

export interface SearchOneLegInput {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  cabin: CabinClass;
  adults: number;
  children: number;
  infants: number;
}

/**
 * One leg of a search.
 *
 * A flight is only returned if it can actually seat the whole party in the
 * requested cabin. Showing a fare the customer cannot buy wastes the two
 * minutes it takes them to reach the seat map and be told no.
 */
export async function searchLeg(
  input: SearchOneLegInput,
  now: Date = new Date(),
): Promise<FlightSearchResult[]> {
  const { gte, lt } = dayBounds(input.departureDate);
  const seatsNeeded = input.adults + input.children; // infants travel on a lap

  const rows = await prisma.flight.findMany({
    where: {
      originCode: input.originCode.toUpperCase(),
      destinationCode: input.destinationCode.toUpperCase(),
      departureTime: { gte: gte > now ? gte : now, lt },
      status: { not: "cancelled" },
    },
    include: FLIGHT_INCLUDE,
    orderBy: { departureTime: "asc" },
  });

  const flights = rows.map((row) => toFlight(row as FlightWithAircraft));
  const occupancy = await occupiedSeatIds(flights.map((flight) => flight.id));

  const airports = await prisma.airport.findMany({
    where: { code: { in: [input.originCode.toUpperCase(), input.destinationCode.toUpperCase()] } },
  });
  const origin = airports.find((airport) => airport.code === input.originCode.toUpperCase());
  const destination = airports.find(
    (airport) => airport.code === input.destinationCode.toUpperCase(),
  );
  if (!origin || !destination) return [];

  const results: FlightSearchResult[] = [];

  for (const flight of flights) {
    if (!availableCabins(flight).includes(input.cabin)) continue;

    const seats = seatMapFrom(flight, occupancy.get(flight.id) ?? new Set());
    const seatsAvailable = countAvailable(seats, input.cabin);
    if (seatsAvailable < seatsNeeded) continue;

    const context: FareContext = {
      baseFare: flight.baseFare,
      cabin: input.cabin,
      daysToDeparture: daysUntil(flight.departureTime, now),
      load: loadFactor(seats, input.cabin),
    };

    const pricePerAdult = fareForPassenger(context, "adult");
    const estimatedTotal =
      pricePerAdult * input.adults +
      fareForPassenger(context, "child") * input.children +
      fareForPassenger(context, "infant") * input.infants;

    results.push({
      flight,
      origin: toAirport(origin),
      destination: toAirport(destination),
      seatsAvailable,
      seatsTotal: countTotal(seats, input.cabin),
      pricePerAdult,
      estimatedTotal,
    });
  }

  return results;
}

export interface SearchResponse {
  /** One entry per leg, in the order they are flown. */
  legs: {
    originCode: string;
    destinationCode: string;
    departureDate: string;
    results: FlightSearchResult[];
  }[];
}

/**
 * A whole search: one leg for a one-way, two for a return, and as many as were
 * built for multi-city. Legs are resolved in parallel — they are independent
 * queries and there is no reason to pay for them one after another.
 */
export async function search(
  criteria: SearchCriteria,
  now: Date = new Date(),
): Promise<SearchResponse> {
  const legs: { originCode: string; destinationCode: string; departureDate: string }[] = [
    {
      originCode: criteria.originCode,
      destinationCode: criteria.destinationCode,
      departureDate: criteria.departureDate,
    },
  ];

  if (criteria.tripType === "round-trip" && criteria.returnDate) {
    legs.push({
      originCode: criteria.destinationCode,
      destinationCode: criteria.originCode,
      departureDate: criteria.returnDate,
    });
  }

  if (criteria.tripType === "multi-city" && criteria.extraLegs?.length) {
    legs.push(...criteria.extraLegs);
  }

  const resolved = await Promise.all(
    legs.map((leg) =>
      searchLeg(
        {
          ...leg,
          cabin: criteria.cabin,
          adults: criteria.adults,
          children: criteria.children,
          infants: criteria.infants,
        },
        now,
      ),
    ),
  );

  return {
    legs: legs.map((leg, index) => ({ ...leg, results: resolved[index] ?? [] })),
  };
}

/**
 * Dates in the schedule window that actually have a departure on this route.
 * Drives the "no flights that day — try these" suggestion, which is the
 * difference between an empty results page and a useful one.
 */
export async function datesWithFlights(
  originCode: string,
  destinationCode: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await prisma.flight.findMany({
    where: {
      originCode: originCode.toUpperCase(),
      destinationCode: destinationCode.toUpperCase(),
      departureTime: { gt: now },
      status: { not: "cancelled" },
    },
    select: { departureTime: true },
    orderBy: { departureTime: "asc" },
  });

  const dates = new Set(
    rows.map((row) => row.departureTime.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" })),
  );
  return [...dates];
}

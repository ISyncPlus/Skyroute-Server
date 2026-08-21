/**
 * Seat map logic.
 * ---------------
 * Seat maps are derived, never stored. Given a flight's cabin configuration
 * and the set of bookings made against it, the map is computed on demand.
 * Storing only the bookings and deriving availability guarantees the two can
 * never disagree - the classic "single source of truth" principle.
 */

import { EXIT_ROWS } from "./schedule.js";
import { bookingSegments } from "./types.js";
import type { Booking, CabinClass, Flight, Seat } from "./types.js";

/** Build the complete seat map for a flight, marking booked seats as occupied. */
export function buildSeatMap(flight: Flight, bookings: Booking[]): Seat[] {
  const occupied = getOccupiedSeatIds(flight.id, bookings);
  const blocked = new Set(flight.blockedSeats);
  const exitRows = new Set(EXIT_ROWS[flight.aircraft] ?? []);
  const seats: Seat[] = [];

  flight.cabins.forEach((cabin) => {
    const lastColumnIndex = cabin.columns.length - 1;

    for (let row = cabin.startRow; row <= cabin.endRow; row += 1) {
      cabin.columns.forEach((column, columnIndex) => {
        const id = `${row}${column}`;
        const isWindow = columnIndex === 0 || columnIndex === lastColumnIndex;
        const isAisle = isAisleColumn(cabin.columns, columnIndex);

        seats.push({
          id,
          row,
          column,
          cabin: cabin.cabin,
          isWindow,
          isAisle,
          isExitRow: exitRows.has(row),
          status: blocked.has(id) ? "blocked" : occupied.has(id) ? "occupied" : "available",
        });
      });
    }
  });

  return seats;
}

/**
 * Determine whether a column sits next to an aisle.
 * Narrow-body 3-3 (ABC|DEF): C and D. Regional 2-2 (AC|DF): C and D.
 * Wide-body 3-3-3 (ABC|DEFG|HK... simplified): the seats flanking each break.
 */
function isAisleColumn(columns: string[], index: number): boolean {
  const groupSize = columns.length <= 4 ? 2 : 3;
  const isEndOfGroup = (index + 1) % groupSize === 0;
  const isStartOfGroup = index % groupSize === 0;
  const isFirst = index === 0;
  const isLast = index === columns.length - 1;
  return (isEndOfGroup && !isLast) || (isStartOfGroup && !isFirst);
}

/**
 * Seat IDs already taken on a flight by confirmed bookings.
 *
 * Scans every segment of every booking, not just the first: the same flight
 * can be the outbound of one journey and the return of another, and a seat
 * sold on either must not be offered twice.
 */
export function getOccupiedSeatIds(flightId: string, bookings: Booking[]): Set<string> {
  const occupied = new Set<string>();
  bookings
    .filter((booking) => booking.status === "confirmed")
    .forEach((booking) => {
      bookingSegments(booking)
        .filter((segment) => segment.flightId === flightId)
        .forEach((segment) => {
          Object.values(segment.seats).forEach((seatId) => {
            if (seatId) occupied.add(seatId);
          });
        });
    });
  return occupied;
}

/** Seats in a given cabin. */
export function seatsInCabin(seats: Seat[], cabin: CabinClass): Seat[] {
  return seats.filter((seat) => seat.cabin === cabin);
}

/** Count of bookable seats remaining in a cabin. */
export function countAvailable(seats: Seat[], cabin?: CabinClass): number {
  return seats.filter(
    (seat) => seat.status === "available" && (cabin === undefined || seat.cabin === cabin),
  ).length;
}

/** Total seats fitted, optionally restricted to one cabin. */
export function countTotal(seats: Seat[], cabin?: CabinClass): number {
  return seats.filter((seat) => cabin === undefined || seat.cabin === cabin).length;
}

/** Proportion of seats sold, from 0 to 1. Used by the dynamic pricing engine. */
export function loadFactor(seats: Seat[], cabin?: CabinClass): number {
  const total = countTotal(seats, cabin);
  if (total === 0) return 0;
  return (total - countAvailable(seats, cabin)) / total;
}

/** Group a cabin's seats into rows for rendering. */
export function groupByRow(seats: Seat[]): { row: number; seats: Seat[] }[] {
  const rows = new Map<number, Seat[]>();
  seats.forEach((seat) => {
    const existing = rows.get(seat.row);
    if (existing) existing.push(seat);
    else rows.set(seat.row, [seat]);
  });
  return Array.from(rows.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([row, rowSeats]) => ({ row, seats: rowSeats }));
}

/**
 * Concurrency guard. Between the moment a user opens the seat map and the
 * moment they pay, another user (or another browser tab) may take the same
 * seat. This re-checks availability immediately before a booking is written.
 */
export function validateSeatSelection(
  flight: Flight,
  bookings: Booking[],
  requestedSeatIds: string[],
  cabin: CabinClass,
): { valid: boolean; conflicts: string[]; message?: string } {
  const seatMap = buildSeatMap(flight, bookings);
  const byId = new Map(seatMap.map((seat) => [seat.id, seat]));
  const conflicts: string[] = [];

  const duplicates = requestedSeatIds.filter((id, index) => requestedSeatIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    return { valid: false, conflicts: duplicates, message: "The same seat was selected more than once." };
  }

  requestedSeatIds.forEach((seatId) => {
    const seat = byId.get(seatId);
    if (!seat) {
      conflicts.push(seatId);
      return;
    }
    if (seat.cabin !== cabin) {
      conflicts.push(seatId);
      return;
    }
    if (seat.status !== "available") conflicts.push(seatId);
  });

  if (conflicts.length > 0) {
    return {
      valid: false,
      conflicts,
      message: `Seat(s) ${conflicts.join(", ")} are no longer available. Please choose again.`,
    };
  }

  return { valid: true, conflicts: [] };
}

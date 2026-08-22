/**
 * Row → domain mappers.
 *
 * The single boundary at which Prisma types become the plain shapes defined in
 * src/domain/types.ts. Confining the translation here is what allows the
 * services above and the domain below to remain ignorant of the database, and
 * it guarantees the JSON on the wire is byte-identical to what the browser
 * build produced from localStorage.
 */

import type {
  Aircraft,
  AircraftCabin,
  Airport as AirportRow,
  Booking as BookingRow,
  BookingSegment as SegmentRow,
  Flight as FlightRow,
  Passenger as PassengerRow,
  Payment as PaymentRow,
  SeatAssignment as SeatRow,
  User as UserRow,
} from "@prisma/client";

import type {
  Airport,
  Booking,
  BookingSegment,
  CabinConfig,
  FareBreakdown,
  Flight,
  Passenger,
  Payment,
  SessionUser,
  TripType,
} from "../domain/types.js";

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

export function toAirport(row: AirportRow): Airport {
  return { code: row.code, city: row.city, name: row.name, country: row.country };
}

export type AircraftWithCabins = Aircraft & { cabins: AircraftCabin[] };

/**
 * Cabins are returned in physical order — first, then business, then economy —
 * because the seat map is rendered nose to tail and the order it arrives in is
 * the order it is drawn.
 */
const CABIN_ORDER = { first: 0, business: 1, economy: 2 } as const;

export function toCabinConfigs(aircraft: AircraftWithCabins): CabinConfig[] {
  return [...aircraft.cabins]
    .sort((a, b) => CABIN_ORDER[a.cabin] - CABIN_ORDER[b.cabin])
    .map((cabin) => ({
      cabin: cabin.cabin,
      startRow: cabin.startRow,
      endRow: cabin.endRow,
      columns: cabin.columns,
    }));
}

export type FlightWithAircraft = FlightRow & { aircraft: AircraftWithCabins };

export function toFlight(row: FlightWithAircraft): Flight {
  return {
    id: row.id,
    flightNumber: row.flightNumber,
    airline: row.airline,
    airlineCode: row.airlineCode,
    originCode: row.originCode,
    destinationCode: row.destinationCode,
    departureTime: row.departureTime.toISOString(),
    arrivalTime: row.arrivalTime.toISOString(),
    durationMinutes: row.durationMinutes,
    aircraft: row.aircraftType,
    baseFare: row.baseFare,
    currency: row.currency,
    cabins: toCabinConfigs(row.aircraft),
    blockedSeats: row.blockedSeats,
    status: row.status,
  };
}

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */

export type BookingWithRelations = BookingRow & {
  passengers: PassengerRow[];
  segments: (SegmentRow & { seatAssignments: SeatRow[] })[];
  payment: PaymentRow | null;
};

/** YYYY-MM-DD from a date-only column, without a timezone shifting it a day. */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toFare(row: BookingRow): FareBreakdown {
  return {
    baseFareTotal: row.baseFareTotal,
    cabinSurcharge: row.cabinSurcharge,
    seatSelectionFee: row.seatSelectionFee,
    taxes: row.taxes,
    serviceCharge: row.serviceCharge,
    total: row.total,
  };
}

function toPayment(row: PaymentRow | null): Payment | null {
  if (!row) return null;
  return {
    id: row.id,
    method: row.method,
    maskedCardNumber: row.maskedCardNumber,
    cardHolder: row.cardHolder,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    transactionReference: row.transactionReference,
    paidAt: row.paidAt.toISOString(),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
  };
}

function toPassenger(row: PassengerRow, seatId: string | null): Passenger {
  return {
    id: row.id,
    title: row.title as Passenger["title"],
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: toDateOnly(row.dateOfBirth),
    gender: row.gender as Passenger["gender"],
    passportNumber: row.passportNumber ?? "",
    type: row.type,
    seatId,
  };
}

const TRIP_TYPES: Record<BookingRow["tripType"], TripType> = {
  ONE_WAY: "one-way",
  ROUND_TRIP: "round-trip",
  MULTI_CITY: "multi-city",
};

export function toBooking(row: BookingWithRelations): Booking {
  const passengers = [...row.passengers].sort((a, b) => a.position - b.position);
  const segments = [...row.segments].sort((a, b) => a.position - b.position);

  const mappedSegments: BookingSegment[] = segments.map((segment) => ({
    flightId: segment.flightId,
    cabin: segment.cabin,
    seats: Object.fromEntries(
      passengers.map((passenger) => [
        passenger.id,
        segment.seatAssignments.find((seat) => seat.passengerId === passenger.id)?.seatId ?? null,
      ]),
    ),
  }));

  const first = segments[0];

  /* seatId on the passenger is only meaningful for a single-flight booking.
     Across several legs a traveller holds a different seat on each, so naming
     one leg's seat as if it applied to the whole journey would be a lie the
     itinerary would then print. */
  const singleLeg = mappedSegments.length === 1 ? mappedSegments[0] : undefined;

  return {
    pnr: row.pnr,
    userId: row.userId,
    flightId: first?.flightId ?? "",
    cabin: first?.cabin ?? "economy",
    tripType: TRIP_TYPES[row.tripType],
    segments: mappedSegments,
    passengers: passengers.map((passenger) =>
      toPassenger(passenger, singleLeg ? (singleLeg.seats[passenger.id] ?? null) : null),
    ),
    fare: toFare(row),
    payment: toPayment(row.payment),
    status: row.status,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    createdAt: row.createdAt.toISOString(),
    ...(row.cancelledAt ? { cancelledAt: row.cancelledAt.toISOString() } : {}),
    ...(row.refundAmount !== null ? { refundAmount: row.refundAmount } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

/** Never includes the password hash — that column must not leave the service. */
export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatarUrl,
  };
}

export interface PublicUser extends SessionUser {
  phone: string | null;
  createdAt: string;
  /** Whether the account can sign in with a password at all. */
  hasPassword: boolean;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    ...toSessionUser(row),
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    hasPassword: row.passwordHash !== null,
  };
}

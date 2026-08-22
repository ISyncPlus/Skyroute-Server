/**
 * Domain model.
 *
 * These are the shapes the API speaks, and they are deliberately identical to
 * the types the SkyRoute frontend already uses. Keeping the wire format
 * unchanged means the browser client swaps localStorage for fetch() without a
 * single business rule or component being rewritten — which was the whole
 * point of isolating storage behind one module in the first place.
 *
 * Nothing in this folder imports Prisma, Express or any database type. The
 * domain does not know it is being persisted, and that is what makes it
 * testable without a database running.
 */

export type CabinClass = "economy" | "business" | "first";

export type PassengerType = "adult" | "child" | "infant";

export type BookingStatus = "confirmed" | "cancelled" | "pending";

export type PaymentStatus = "successful" | "failed" | "pending";

export type PaymentMethod = "card" | "transfer" | "wallet";

export type UserRole = "customer" | "admin";

export type SeatStatus = "available" | "occupied" | "blocked";

export type FlightStatus = "scheduled" | "delayed" | "cancelled";

export type TripType = "one-way" | "round-trip" | "multi-city";

export interface Airport {
  code: string;
  city: string;
  name: string;
  country: string;
}

export interface CabinConfig {
  cabin: CabinClass;
  startRow: number;
  endRow: number;
  columns: string[];
}

export interface Flight {
  id: string;
  flightNumber: string;
  airline: string;
  airlineCode: string;
  originCode: string;
  destinationCode: string;
  /** ISO-8601. */
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  aircraft: string;
  baseFare: number;
  currency: string;
  cabins: CabinConfig[];
  blockedSeats: string[];
  status: FlightStatus;
}

export interface Seat {
  id: string;
  row: number;
  column: string;
  cabin: CabinClass;
  isWindow: boolean;
  isAisle: boolean;
  isExitRow: boolean;
  status: SeatStatus;
}

export interface Passenger {
  id: string;
  title: "Mr" | "Mrs" | "Miss" | "Ms" | "Dr";
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  gender: "male" | "female";
  passportNumber: string;
  type: PassengerType;
  /**
   * The seat held on a one-segment booking, so a single-flight itinerary reads
   * without indexing into segments. Null on any multi-leg booking, where
   * {@link BookingSegment.seats} is the only truth.
   */
  seatId: string | null;
}

export interface BookingSegment {
  flightId: string;
  cabin: CabinClass;
  /** Passenger id → seat id. Null for an infant, who travels on a lap. */
  seats: Record<string, string | null>;
}

export interface FareBreakdown {
  baseFareTotal: number;
  cabinSurcharge: number;
  seatSelectionFee: number;
  taxes: number;
  serviceCharge: number;
  total: number;
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  maskedCardNumber: string;
  cardHolder: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  transactionReference: string;
  paidAt: string;
  failureReason?: string;
}

export interface Booking {
  pnr: string;
  /** Null when booked as a guest. */
  userId: string | null;
  flightId: string;
  cabin: CabinClass;
  tripType?: TripType;
  segments?: BookingSegment[];
  passengers: Passenger[];
  fare: FareBreakdown;
  payment: Payment | null;
  status: BookingStatus;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  cancelledAt?: string;
  refundAmount?: number;
}

/**
 * Every flight on a booking, in flown order — the one place that knows how to
 * read either shape.
 *
 * `segments` is authoritative when present. A single-flight booking that never
 * needed the richer shape carries `flightId`/`cabin` with the seat on the
 * passenger, and is widened here into a one-segment journey. Callers get a
 * plain array and never have to know which shape they were handed; without
 * this, every consumer grows its own fallback and they drift apart.
 */
export function bookingSegments(booking: Booking): BookingSegment[] {
  if (booking.segments?.length) return booking.segments;

  return [
    {
      flightId: booking.flightId,
      cabin: booking.cabin,
      seats: Object.fromEntries(
        booking.passengers.map((passenger) => [passenger.id, passenger.seatId]),
      ),
    },
  ];
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  avatarUrl?: string | null;
}

export interface SearchLeg {
  originCode: string;
  destinationCode: string;
  /** YYYY-MM-DD. */
  departureDate: string;
}

export interface SearchCriteria {
  originCode: string;
  destinationCode: string;
  departureDate: string;
  tripType?: TripType;
  returnDate?: string;
  extraLegs?: SearchLeg[];
  cabin: CabinClass;
  adults: number;
  children: number;
  infants: number;
}

export interface FlightSearchResult {
  flight: Flight;
  origin: Airport;
  destination: Airport;
  seatsAvailable: number;
  seatsTotal: number;
  pricePerAdult: number;
  estimatedTotal: number;
}

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  "round-trip": "Round trip",
  "one-way": "One way",
  "multi-city": "Multi-city",
};

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  business: "Business",
  first: "First Class",
};

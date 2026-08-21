/**
 * Fare engine.
 * ------------
 * A deliberately explicit, pure-function pricing model. Every input is passed
 * in and every output is derived, which makes the whole module trivially unit
 * testable and gives the technical report a concrete algorithm to document.
 *
 * Final fare per passenger =
 *   baseFare
 *   x advancePurchaseFactor(daysToDeparture)
 *   x demandFactor(loadFactor)
 *   x passengerTypeFactor(type)
 *   x cabinFactor(cabin)
 *
 * Booking total = sum(passenger fares) + seat fees + VAT + service charge.
 */

import type { CabinClass, FareBreakdown, Passenger, PassengerType, Seat } from "./types.js";

/** Nigerian VAT rate applied to air transport in the simulation. */
export const VAT_RATE = 0.075;

/** Flat, non-refundable booking service charge (NGN). */
export const SERVICE_CHARGE = 2500;

export const CABIN_FACTORS: Record<CabinClass, number> = {
  economy: 1,
  business: 2.6,
  first: 4.2,
};

export const PASSENGER_TYPE_FACTORS: Record<PassengerType, number> = {
  adult: 1,
  child: 0.75,
  infant: 0.1,
};

/** Paid seat selection in economy; complimentary in premium cabins. */
export const SEAT_FEES = {
  exitRow: 3500,
  window: 2000,
  aisle: 2000,
  middle: 1000,
} as const;

/** Booking earlier is cheaper - the classic airline advance-purchase curve. */
export function advancePurchaseFactor(daysToDeparture: number): number {
  if (daysToDeparture >= 30) return 0.9;
  if (daysToDeparture >= 14) return 1.0;
  if (daysToDeparture >= 7) return 1.15;
  if (daysToDeparture >= 3) return 1.32;
  return 1.5;
}

/** The fuller the cabin, the higher the price. `load` is 0 to 1. */
export function demandFactor(load: number): number {
  const clamped = Math.min(Math.max(load, 0), 1);
  if (clamped < 0.5) return 1.0;
  if (clamped < 0.75) return 1.08;
  if (clamped < 0.9) return 1.2;
  return 1.35;
}

/** Whole days between now and departure, floored at zero. */
export function daysUntil(departureTime: string, now: Date = new Date()): number {
  const departure = new Date(departureTime).getTime();
  const diffMs = departure - now.getTime();
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

/** Round to the nearest 100 naira so displayed prices look like real fares. */
export function roundFare(amount: number): number {
  return Math.round(amount / 100) * 100;
}

export interface FareContext {
  baseFare: number;
  cabin: CabinClass;
  daysToDeparture: number;
  load: number;
}

/** Price for one passenger of the given type, before taxes and fees. */
export function fareForPassenger(context: FareContext, type: PassengerType = "adult"): number {
  const { baseFare, cabin, daysToDeparture, load } = context;
  const raw =
    baseFare *
    advancePurchaseFactor(daysToDeparture) *
    demandFactor(load) *
    PASSENGER_TYPE_FACTORS[type] *
    CABIN_FACTORS[cabin];
  return roundFare(raw);
}

/** The headline "from" price shown on a search result card. */
export function headlineFare(context: FareContext): number {
  return fareForPassenger(context, "adult");
}

/** Fee charged for choosing a specific seat. Free outside economy. */
export function seatFee(seat: Seat | undefined): number {
  if (!seat) return 0;
  if (seat.cabin !== "economy") return 0;
  if (seat.isExitRow) return SEAT_FEES.exitRow;
  if (seat.isWindow) return SEAT_FEES.window;
  if (seat.isAisle) return SEAT_FEES.aisle;
  return SEAT_FEES.middle;
}

/** Full itemised quote for a booking. Infants are not charged a seat fee. */
export function calculateFare(
  context: FareContext,
  passengers: Pick<Passenger, "type" | "seatId">[],
  seatMap: Seat[],
): FareBreakdown {
  const seatsById = new Map(seatMap.map((seat) => [seat.id, seat]));

  // Economy-equivalent fare, kept separate from the premium-cabin uplift so the
  // customer can see what the cabin upgrade actually costs them.
  const economyContext: FareContext = { ...context, cabin: "economy" };

  let baseFareTotal = 0;
  let cabinSurcharge = 0;
  let seatSelectionFee = 0;

  passengers.forEach((passenger) => {
    const economyFare = fareForPassenger(economyContext, passenger.type);
    const cabinFare = fareForPassenger(context, passenger.type);
    baseFareTotal += economyFare;
    cabinSurcharge += cabinFare - economyFare;

    if (passenger.type !== "infant" && passenger.seatId) {
      seatSelectionFee += seatFee(seatsById.get(passenger.seatId));
    }
  });

  const taxable = baseFareTotal + cabinSurcharge + seatSelectionFee;
  const taxes = Math.round(taxable * VAT_RATE);
  const total = taxable + taxes + SERVICE_CHARGE;

  return {
    baseFareTotal,
    cabinSurcharge,
    seatSelectionFee,
    taxes,
    serviceCharge: SERVICE_CHARGE,
    total,
  };
}

/**
 * Combine the per-flight quotes of a multi-leg journey into the single fare
 * the customer actually pays.
 *
 * Two things this must not do naively. The booking service charge is levied
 * once per booking, not once per flight, so summing whole quotes would charge
 * a return trip twice for it. And tax is recomputed from the combined taxable
 * base rather than summed from each leg's already-rounded figure, so the total
 * cannot drift a naira away from `taxable * VAT_RATE`.
 */
export function combineFares(fares: FareBreakdown[]): FareBreakdown {
  const [only] = fares;
  if (fares.length === 1 && only) return only;

  const baseFareTotal = fares.reduce((sum, fare) => sum + fare.baseFareTotal, 0);
  const cabinSurcharge = fares.reduce((sum, fare) => sum + fare.cabinSurcharge, 0);
  const seatSelectionFee = fares.reduce((sum, fare) => sum + fare.seatSelectionFee, 0);

  const taxable = baseFareTotal + cabinSurcharge + seatSelectionFee;
  const taxes = Math.round(taxable * VAT_RATE);

  return {
    baseFareTotal,
    cabinSurcharge,
    seatSelectionFee,
    taxes,
    serviceCharge: SERVICE_CHARGE,
    total: taxable + taxes + SERVICE_CHARGE,
  };
}

/**
 * Cancellation policy. The service charge is never refunded; the remainder is
 * refunded on a sliding scale determined by how close to departure the
 * cancellation is made.
 */
export function refundRate(hoursToDeparture: number): number {
  if (hoursToDeparture >= 168) return 0.9; // 7 days or more
  if (hoursToDeparture >= 72) return 0.7; // 3 to 7 days
  if (hoursToDeparture >= 24) return 0.5; // 1 to 3 days
  return 0; // inside 24 hours - non-refundable
}

/** Naira amount to be returned to the customer on cancellation. */
export function calculateRefund(fare: FareBreakdown, departureTime: string, now: Date = new Date()): number {
  const hours = Math.max(0, (new Date(departureTime).getTime() - now.getTime()) / 3_600_000);
  const refundable = fare.total - fare.serviceCharge;
  return Math.round(refundable * refundRate(hours));
}

/** Display helper: NGN 118,000 */
export function formatMoney(amount: number, currency = "NGN"): string {
  return `${currency} ${Math.round(amount).toLocaleString("en-NG")}`;
}

/**
 * Fare engine.
 *
 * Boundaries are tested at the exact day and hour a band changes, because that
 * is where an off-by-one in a comparison hides and where a customer notices.
 */

import { describe, expect, it } from "vitest";
import {
  advancePurchaseFactor,
  calculateFare,
  calculateRefund,
  combineFares,
  CABIN_FACTORS,
  daysUntil,
  demandFactor,
  fareForPassenger,
  PASSENGER_TYPE_FACTORS,
  refundRate,
  roundFare,
  SEAT_FEES,
  seatFee,
  SERVICE_CHARGE,
  VAT_RATE,
  type FareContext,
} from "../src/domain/pricing.js";
import type { FareBreakdown, Seat } from "../src/domain/types.js";

const seat = (overrides: Partial<Seat> = {}): Seat => ({
  id: "12A",
  row: 12,
  column: "A",
  cabin: "economy",
  isWindow: false,
  isAisle: false,
  isExitRow: false,
  status: "available",
  ...overrides,
});

const context = (overrides: Partial<FareContext> = {}): FareContext => ({
  baseFare: 100_000,
  cabin: "economy",
  daysToDeparture: 20,
  load: 0,
  ...overrides,
});

describe("advance purchase factor", () => {
  it.each([
    [60, 0.9],
    [30, 0.9], // boundary
    [29, 1.0],
    [14, 1.0], // boundary
    [13, 1.15],
    [7, 1.15], // boundary
    [6, 1.32],
    [3, 1.32], // boundary
    [2, 1.5],
    [0, 1.5],
  ])("charges %ix days out at %s", (days, expected) => {
    expect(advancePurchaseFactor(days)).toBe(expected);
  });

  it("never gets cheaper as departure approaches", () => {
    for (let days = 1; days <= 60; days += 1) {
      expect(advancePurchaseFactor(days - 1)).toBeGreaterThanOrEqual(advancePurchaseFactor(days));
    }
  });
});

describe("demand factor", () => {
  it.each([
    [0, 1.0],
    [0.49, 1.0],
    [0.5, 1.08], // boundary
    [0.74, 1.08],
    [0.75, 1.2], // boundary
    [0.89, 1.2],
    [0.9, 1.35], // boundary
    [1, 1.35],
  ])("prices a cabin at %s load with factor %s", (load, expected) => {
    expect(demandFactor(load)).toBe(expected);
  });

  it("clamps nonsensical load values rather than extrapolating", () => {
    expect(demandFactor(-5)).toBe(1.0);
    expect(demandFactor(99)).toBe(1.35);
  });
});

describe("passenger and cabin factors", () => {
  it("charges a child less than an adult and an infant least", () => {
    expect(PASSENGER_TYPE_FACTORS.adult).toBeGreaterThan(PASSENGER_TYPE_FACTORS.child);
    expect(PASSENGER_TYPE_FACTORS.child).toBeGreaterThan(PASSENGER_TYPE_FACTORS.infant);
  });

  it("charges more for each cabin above economy", () => {
    expect(CABIN_FACTORS.economy).toBeLessThan(CABIN_FACTORS.business);
    expect(CABIN_FACTORS.business).toBeLessThan(CABIN_FACTORS.first);
  });

  it("rounds a fare to the nearest hundred naira", () => {
    expect(roundFare(118_049)).toBe(118_000);
    expect(roundFare(118_050)).toBe(118_100);
  });
});

describe("seat fees", () => {
  it("charges most for an exit row", () => {
    expect(seatFee(seat({ isExitRow: true }))).toBe(SEAT_FEES.exitRow);
  });

  it("prefers the exit-row fee when a seat is both exit row and window", () => {
    expect(seatFee(seat({ isExitRow: true, isWindow: true }))).toBe(SEAT_FEES.exitRow);
  });

  it("charges the middle-seat fee when a seat is neither window nor aisle", () => {
    expect(seatFee(seat())).toBe(SEAT_FEES.middle);
  });

  it("charges nothing outside economy", () => {
    expect(seatFee(seat({ cabin: "business", isWindow: true }))).toBe(0);
    expect(seatFee(seat({ cabin: "first", isExitRow: true }))).toBe(0);
  });

  it("charges nothing when no seat was chosen", () => {
    expect(seatFee(undefined)).toBe(0);
  });
});

describe("fare itemisation", () => {
  it("separates the cabin uplift from the base fare", () => {
    const fare = calculateFare(context({ cabin: "business" }), [{ type: "adult", seatId: null }], []);

    const economy = fareForPassenger(context({ cabin: "economy" }), "adult");
    expect(fare.baseFareTotal).toBe(economy);
    expect(fare.cabinSurcharge).toBe(fareForPassenger(context({ cabin: "business" }), "adult") - economy);
  });

  it("applies VAT to fare and seat fees together", () => {
    const seats = [seat({ id: "12A", isWindow: true })];
    const fare = calculateFare(context(), [{ type: "adult", seatId: "12A" }], seats);

    const taxable = fare.baseFareTotal + fare.cabinSurcharge + fare.seatSelectionFee;
    expect(fare.taxes).toBe(Math.round(taxable * VAT_RATE));
  });

  it("levies the service charge exactly once, whatever the party size", () => {
    const one = calculateFare(context(), [{ type: "adult", seatId: null }], []);
    const four = calculateFare(
      context(),
      Array.from({ length: 4 }, () => ({ type: "adult" as const, seatId: null })),
      [],
    );

    expect(one.serviceCharge).toBe(SERVICE_CHARGE);
    expect(four.serviceCharge).toBe(SERVICE_CHARGE);
  });

  it("never charges an infant a seat fee", () => {
    const seats = [seat({ id: "12A", isExitRow: true })];
    const fare = calculateFare(context(), [{ type: "infant", seatId: "12A" }], seats);
    expect(fare.seatSelectionFee).toBe(0);
  });

  it("produces a total that adds up", () => {
    const seats = [seat({ id: "12A", isAisle: true })];
    const fare = calculateFare(
      context({ cabin: "business" }),
      [
        { type: "adult", seatId: "12A" },
        { type: "child", seatId: null },
      ],
      seats,
    );

    expect(fare.total).toBe(
      fare.baseFareTotal + fare.cabinSurcharge + fare.seatSelectionFee + fare.taxes + fare.serviceCharge,
    );
  });
});

describe("combining fares across legs", () => {
  const leg = (): FareBreakdown =>
    calculateFare(context(), [{ type: "adult", seatId: null }], []);

  it("returns a single leg untouched", () => {
    const one = leg();
    expect(combineFares([one])).toEqual(one);
  });

  it("charges the service fee once for a return trip, not twice", () => {
    const combined = combineFares([leg(), leg()]);
    expect(combined.serviceCharge).toBe(SERVICE_CHARGE);
    expect(combined.total).toBeLessThan(leg().total * 2);
  });

  it("recomputes tax from the combined base rather than summing rounded halves", () => {
    const combined = combineFares([leg(), leg(), leg()]);
    const taxable = combined.baseFareTotal + combined.cabinSurcharge + combined.seatSelectionFee;

    // Summing three separately-rounded tax figures can drift a naira from this.
    expect(combined.taxes).toBe(Math.round(taxable * VAT_RATE));
    expect(combined.total).toBe(taxable + combined.taxes + SERVICE_CHARGE);
  });
});

describe("refunds", () => {
  it.each([
    [200, 0.9],
    [168, 0.9], // exactly 7 days
    [167, 0.7],
    [72, 0.7], // exactly 3 days
    [71, 0.5],
    [24, 0.5], // exactly 1 day
    [23, 0],
    [0, 0],
  ])("refunds %i hours out at %s", (hours, expected) => {
    expect(refundRate(hours)).toBe(expected);
  });

  it("never refunds the service charge", () => {
    const fare = calculateFare(context(), [{ type: "adult", seatId: null }], []);
    const now = new Date("2026-01-01T00:00:00Z");
    const departure = new Date("2026-02-01T00:00:00Z").toISOString();

    const refund = calculateRefund(fare, departure, now);
    expect(refund).toBe(Math.round((fare.total - fare.serviceCharge) * 0.9));
    expect(refund).toBeLessThan(fare.total);
  });

  it("refunds nothing inside twenty-four hours", () => {
    const fare = calculateFare(context(), [{ type: "adult", seatId: null }], []);
    const now = new Date("2026-01-01T00:00:00Z");
    const departure = new Date("2026-01-01T12:00:00Z").toISOString();

    expect(calculateRefund(fare, departure, now)).toBe(0);
  });

  it("treats a departure already past as non-refundable rather than going negative", () => {
    const fare = calculateFare(context(), [{ type: "adult", seatId: null }], []);
    const now = new Date("2026-02-01T00:00:00Z");
    const departure = new Date("2026-01-01T00:00:00Z").toISOString();

    expect(calculateRefund(fare, departure, now)).toBe(0);
  });
});

describe("days until departure", () => {
  it("floors at zero rather than reporting negative days", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(daysUntil("2026-06-01T12:00:00Z", now)).toBe(0);
  });

  it("counts whole days only", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(daysUntil("2026-06-13T11:00:00Z", now)).toBe(2);
    expect(daysUntil("2026-06-13T13:00:00Z", now)).toBe(3);
  });
});

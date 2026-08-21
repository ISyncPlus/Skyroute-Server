/** Seat map derivation, and the guard against selling a seat twice. */

import { describe, expect, it } from "vitest";
import {
  buildSeatMap,
  countAvailable,
  countTotal,
  getOccupiedSeatIds,
  groupByRow,
  loadFactor,
  seatsInCabin,
  validateSeatSelection,
} from "../src/domain/seats.js";
import { AIRCRAFT_LAYOUTS, EXIT_ROWS } from "../src/domain/schedule.js";
import type { Booking, Flight } from "../src/domain/types.js";

const flight = (overrides: Partial<Flight> = {}): Flight => ({
  id: "P4100-2026-09-01-0630",
  flightNumber: "P4100",
  airline: "Air Peace",
  airlineCode: "P4",
  originCode: "LOS",
  destinationCode: "ABV",
  departureTime: "2026-09-01T05:30:00.000Z",
  arrivalTime: "2026-09-01T06:40:00.000Z",
  durationMinutes: 70,
  aircraft: "Boeing 737-800",
  baseFare: 118_000,
  currency: "NGN",
  cabins: AIRCRAFT_LAYOUTS["Boeing 737-800"]!,
  blockedSeats: [],
  status: "scheduled",
  ...overrides,
});

/** A confirmed booking holding the given seats on the given flight. */
const holding = (flightId: string, seatIds: string[], cabin: Booking["cabin"] = "economy"): Booking => ({
  pnr: "ABC234",
  userId: null,
  flightId,
  cabin,
  segments: [
    {
      flightId,
      cabin,
      seats: Object.fromEntries(seatIds.map((seatId, index) => [`pax${index}`, seatId])),
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
  createdAt: new Date().toISOString(),
});

describe("seat map generation", () => {
  it("generates a seat for every row and column of every cabin", () => {
    const seats = buildSeatMap(flight(), []);
    const layout = AIRCRAFT_LAYOUTS["Boeing 737-800"]!;

    const expected = layout.reduce(
      (sum, cabin) => sum + (cabin.endRow - cabin.startRow + 1) * cabin.columns.length,
      0,
    );
    expect(seats).toHaveLength(expected);
  });

  it("marks the outermost columns as windows", () => {
    const seats = buildSeatMap(flight(), []);
    const row10 = seats.filter((seat) => seat.row === 10);

    expect(row10.find((seat) => seat.column === "A")?.isWindow).toBe(true);
    expect(row10.find((seat) => seat.column === "F")?.isWindow).toBe(true);
    expect(row10.find((seat) => seat.column === "C")?.isWindow).toBe(false);
  });

  it("marks the seats flanking the aisle on a 3-3 layout", () => {
    const seats = buildSeatMap(flight(), []);
    const row10 = seats.filter((seat) => seat.row === 10);

    expect(row10.find((seat) => seat.column === "C")?.isAisle).toBe(true);
    expect(row10.find((seat) => seat.column === "D")?.isAisle).toBe(true);
    expect(row10.find((seat) => seat.column === "B")?.isAisle).toBe(false);
  });

  it("marks the exit rows for the aircraft type", () => {
    const seats = buildSeatMap(flight(), []);
    const exitRows = EXIT_ROWS["Boeing 737-800"]!;

    for (const row of exitRows) {
      expect(seats.filter((seat) => seat.row === row).every((seat) => seat.isExitRow)).toBe(true);
    }
    expect(seats.find((seat) => seat.id === "20A")?.isExitRow).toBe(false);
  });

  it("generates a different map for a different aircraft", () => {
    const narrow = buildSeatMap(flight(), []);
    const wide = buildSeatMap(
      flight({ aircraft: "Boeing 787-9", cabins: AIRCRAFT_LAYOUTS["Boeing 787-9"]! }),
      [],
    );

    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(wide.some((seat) => seat.cabin === "first")).toBe(true);
    expect(narrow.some((seat) => seat.cabin === "first")).toBe(false);
  });

  it("marks blocked seats as blocked, not available", () => {
    const seats = buildSeatMap(flight({ blockedSeats: ["10A", "10B"] }), []);
    expect(seats.find((seat) => seat.id === "10A")?.status).toBe("blocked");
    expect(seats.find((seat) => seat.id === "10C")?.status).toBe("available");
  });
});

describe("occupancy", () => {
  it("marks a booked seat as occupied", () => {
    const target = flight();
    const seats = buildSeatMap(target, [holding(target.id, ["12A"])]);

    expect(seats.find((seat) => seat.id === "12A")?.status).toBe("occupied");
    expect(seats.find((seat) => seat.id === "12B")?.status).toBe("available");
  });

  it("ignores seats held by a cancelled booking", () => {
    const target = flight();
    const cancelled = { ...holding(target.id, ["12A"]), status: "cancelled" as const };

    expect(buildSeatMap(target, [cancelled]).find((seat) => seat.id === "12A")?.status).toBe(
      "available",
    );
  });

  it("counts a seat held on a LATER leg of someone else's journey", () => {
    const target = flight();
    const returnJourney: Booking = {
      ...holding("SOME-OTHER-FLIGHT", ["1A"]),
      segments: [
        { flightId: "SOME-OTHER-FLIGHT", cabin: "economy", seats: { pax0: "1A" } },
        // Our flight is the second leg of their trip.
        { flightId: target.id, cabin: "economy", seats: { pax0: "12A" } },
      ],
    };

    const occupied = getOccupiedSeatIds(target.id, [returnJourney]);
    expect(occupied.has("12A")).toBe(true);
  });

  it("keeps flights isolated from one another", () => {
    const target = flight();
    const other = holding("A-DIFFERENT-FLIGHT", ["12A"]);

    expect(buildSeatMap(target, [other]).find((seat) => seat.id === "12A")?.status).toBe(
      "available",
    );
  });
});

describe("counting and load", () => {
  it("counts only the requested cabin", () => {
    const seats = buildSeatMap(flight(), []);
    expect(countTotal(seats, "economy")).toBeLessThan(countTotal(seats));
    expect(seatsInCabin(seats, "business").every((seat) => seat.cabin === "business")).toBe(true);
  });

  it("reports zero load on an empty flight and rises as seats sell", () => {
    const target = flight();
    expect(loadFactor(buildSeatMap(target, []), "economy")).toBe(0);

    const sold = buildSeatMap(target, [holding(target.id, ["12A", "12B", "12C"])]);
    expect(loadFactor(sold, "economy")).toBeGreaterThan(0);
  });

  it("counts blocked seats as unavailable", () => {
    const withBlocks = buildSeatMap(flight({ blockedSeats: ["10A"] }), []);
    const without = buildSeatMap(flight(), []);
    expect(countAvailable(withBlocks)).toBe(countAvailable(without) - 1);
  });

  it("groups seats into ascending rows", () => {
    const rows = groupByRow(seatsInCabin(buildSeatMap(flight(), []), "economy"));
    const numbers = rows.map((row) => row.row);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});

describe("seat selection guard", () => {
  it("accepts seats that are free", () => {
    const target = flight();
    expect(validateSeatSelection(target, [], ["12A", "12B"], "economy").valid).toBe(true);
  });

  it("refuses a seat someone already holds", () => {
    const target = flight();
    const result = validateSeatSelection(target, [holding(target.id, ["12A"])], ["12A"], "economy");

    expect(result.valid).toBe(false);
    expect(result.conflicts).toContain("12A");
    expect(result.message).toMatch(/no longer available/i);
  });

  it("refuses the same seat requested twice in one booking", () => {
    const result = validateSeatSelection(flight(), [], ["12A", "12A"], "economy");
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/more than once/i);
  });

  it("refuses a seat that does not exist on the aircraft", () => {
    expect(validateSeatSelection(flight(), [], ["99Z"], "economy").valid).toBe(false);
  });

  it("refuses a seat from the wrong cabin", () => {
    // 1A is business on this layout; asking for it on an economy fare is a no.
    expect(validateSeatSelection(flight(), [], ["1A"], "economy").valid).toBe(false);
  });

  it("refuses a blocked seat", () => {
    expect(validateSeatSelection(flight({ blockedSeats: ["12A"] }), [], ["12A"], "economy").valid).toBe(
      false,
    );
  });
});

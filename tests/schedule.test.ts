/**
 * The schedule generator.
 *
 * The timezone assertions here are the point of the file. In the browser
 * "09:15" meant nine-fifteen where the user sat; on a server it must mean
 * nine-fifteen in Lagos no matter where the process runs, and the only way to
 * be sure is to run the generator with the process clock set elsewhere.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AIRCRAFT_LAYOUTS,
  AIRPORTS,
  atOperatingTime,
  EXIT_ROWS,
  findAirport,
  generateSchedule,
  ROUTES,
  SCHEDULE_HORIZON_DAYS,
  toDateKey,
} from "../src/domain/schedule.js";

describe("reference data", () => {
  it("uses unique, well-formed IATA codes", () => {
    const codes = AIRPORTS.map((airport) => airport.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
  });

  it("has a layout and exit rows for every aircraft a route flies", () => {
    for (const route of ROUTES) {
      expect(AIRCRAFT_LAYOUTS[route.aircraft], `layout for ${route.aircraft}`).toBeDefined();
      expect(EXIT_ROWS[route.aircraft], `exit rows for ${route.aircraft}`).toBeDefined();
    }
  });

  it("routes only between airports that exist", () => {
    const codes = new Set(AIRPORTS.map((airport) => airport.code));
    for (const route of ROUTES) {
      expect(codes.has(route.origin), `origin ${route.origin}`).toBe(true);
      expect(codes.has(route.destination), `destination ${route.destination}`).toBe(true);
    }
  });

  it("never routes an airport to itself", () => {
    expect(ROUTES.every((route) => route.origin !== route.destination)).toBe(true);
  });

  it("keeps exit rows inside a real cabin", () => {
    for (const [aircraft, rows] of Object.entries(EXIT_ROWS)) {
      const cabins = AIRCRAFT_LAYOUTS[aircraft];
      if (!cabins) continue;

      for (const row of rows) {
        const inACabin = cabins.some((cabin) => row >= cabin.startRow && row <= cabin.endRow);
        expect(inACabin, `${aircraft} row ${row}`).toBe(true);
      }
    }
  });

  it("finds an airport case-insensitively", () => {
    expect(findAirport("los")?.city).toBe("Lagos");
    expect(findAirport("ZZZ")).toBeUndefined();
  });
});

describe("schedule generation", () => {
  const from = new Date("2026-09-01T00:00:00+01:00");

  it("generates flights across the horizon", () => {
    const flights = generateSchedule(from, 7);
    expect(flights.length).toBeGreaterThan(100);
  });

  it("gives every flight a unique identifier", () => {
    const flights = generateSchedule(from, SCHEDULE_HORIZON_DAYS);
    const ids = flights.map((flight) => flight.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("always arrives after it departs", () => {
    for (const flight of generateSchedule(from, 3)) {
      expect(new Date(flight.arrivalTime).getTime()).toBeGreaterThan(
        new Date(flight.departureTime).getTime(),
      );
    }
  });

  it("never generates a departure in the past", () => {
    const flights = generateSchedule(from, 3);
    for (const flight of flights) {
      expect(new Date(flight.departureTime).getTime()).toBeGreaterThan(from.getTime());
    }
  });

  it("honours a route's days of week", () => {
    // JFK to LOS flies Tuesday, Thursday and Saturday only.
    const flights = generateSchedule(from, SCHEDULE_HORIZON_DAYS).filter(
      (flight) => flight.originCode === "JFK" && flight.destinationCode === "LOS",
    );

    expect(flights.length).toBeGreaterThan(0);
    for (const flight of flights) {
      const weekday = new Date(flight.departureTime).getUTCDay();
      expect([2, 4, 6]).toContain(weekday);
    }
  });

  it("matches the duration on the route template", () => {
    for (const flight of generateSchedule(from, 2)) {
      const minutes =
        (new Date(flight.arrivalTime).getTime() - new Date(flight.departureTime).getTime()) / 60_000;
      expect(minutes).toBe(flight.durationMinutes);
    }
  });
});

describe("operating timezone", () => {
  it("interprets a departure time as Lagos time, not UTC", () => {
    // 06:30 in Lagos is 05:30 UTC, year round.
    expect(atOperatingTime("2026-09-01", 6, 30).toISOString()).toBe("2026-09-01T05:30:00.000Z");
  });

  it("reads a date key back in Lagos time", () => {
    // 23:30 UTC is already the next day in Lagos.
    expect(toDateKey(new Date("2026-09-01T23:30:00Z"))).toBe("2026-09-02");
  });
});

/**
 * The regression that matters: run the whole generator with the process clock
 * pretending to be somewhere else, and confirm nothing moves. The browser
 * build would have failed this.
 */
describe("independence from the server's timezone", () => {
  const original = process.env.TZ;
  let reference: string[];

  beforeAll(() => {
    process.env.TZ = "UTC";
    reference = generateSchedule(new Date("2026-09-01T00:00:00+01:00"), 5).map(
      (flight) => `${flight.id}@${flight.departureTime}`,
    );
  });

  afterAll(() => {
    process.env.TZ = original;
  });

  it.each(["America/New_York", "Asia/Tokyo", "Pacific/Auckland", "UTC"])(
    "produces an identical schedule when the server is in %s",
    (timezone) => {
      process.env.TZ = timezone;
      const generated = generateSchedule(new Date("2026-09-01T00:00:00+01:00"), 5).map(
        (flight) => `${flight.id}@${flight.departureTime}`,
      );

      expect(generated).toEqual(reference);
    },
  );
});

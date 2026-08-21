/** Validation rules and identifier generation. */

import { describe, expect, it } from "vitest";
import {
  detectCardBrand,
  isValidEmail,
  isValidExpiry,
  isValidName,
  isValidPassport,
  isValidPhone,
  luhnCheck,
  maskCardNumber,
  MAX_PASSENGERS_PER_BOOKING,
  passengerTypeForAge,
  sanitiseText,
  validatePassenger,
  validatePassword,
  validatePayment,
  validateRegistration,
  validateSearch,
} from "../src/domain/validation.js";
import {
  generatePnr,
  generateTransactionReference,
  generateUniquePnr,
  isValidPnr,
  PNR_ALPHABET,
  PNR_LENGTH,
} from "../src/domain/ids.js";

describe("field patterns", () => {
  it.each(["ada@example.com", "a.b+tag@sub.domain.ng"])("accepts %s as an email", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each(["", "no-at-sign", "a@b", "a b@c.com", "a@.com"])("rejects %s as an email", (value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it.each(["08031234567", "+2348031234567", "2348031234567", "0803 123 4567"])(
    "accepts %s as a Nigerian phone number",
    (value) => {
      expect(isValidPhone(value)).toBe(true);
    },
  );

  it.each(["0803123456", "06031234567", "+1234567890", ""])(
    "rejects %s as a Nigerian phone number",
    (value) => {
      expect(isValidPhone(value)).toBe(false);
    },
  );

  it("accepts names with apostrophes and hyphens", () => {
    expect(isValidName("O'Brien")).toBe(true);
    expect(isValidName("Ezedimbu-Nwosu")).toBe(true);
    expect(isValidName("A")).toBe(false);
    expect(isValidName("123")).toBe(false);
  });

  it("accepts a passport of six to twelve alphanumerics", () => {
    expect(isValidPassport("A1234567")).toBe(true);
    expect(isValidPassport("12345")).toBe(false);
    expect(isValidPassport("A".repeat(13))).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts a password meeting every rule", () => {
    expect(validatePassword("Passw0rd").valid).toBe(true);
  });

  it.each([
    ["Pass1", /at least 8/i],
    ["PASSW0RD", /lower-case/i],
    ["passw0rd", /upper-case/i],
    ["Password", /number/i],
  ])("rejects %s", (password, message) => {
    const result = validatePassword(password);
    expect(result.valid).toBe(false);
    expect(result.errors.password).toMatch(message);
  });
});

describe("registration", () => {
  const valid = {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "08031234567",
    password: "Passw0rd",
    confirmPassword: "Passw0rd",
  };

  it("accepts a complete, valid form", () => {
    expect(validateRegistration(valid).valid).toBe(true);
  });

  it("requires both a first and last name", () => {
    const result = validateRegistration({ ...valid, fullName: "Ada" });
    expect(result.errors.fullName).toMatch(/first and last/i);
  });

  it("requires the confirmation to match", () => {
    const result = validateRegistration({ ...valid, confirmPassword: "Different1" });
    expect(result.errors.confirmPassword).toMatch(/do not match/i);
  });
});

describe("search rules", () => {
  const today = new Date("2026-06-10T09:00:00Z");
  const valid = {
    originCode: "LOS",
    destinationCode: "ABV",
    departureDate: "2026-06-15",
    cabin: "economy" as const,
    adults: 1,
    children: 0,
    infants: 0,
  };

  it("accepts a valid search", () => {
    expect(validateSearch(valid, today).valid).toBe(true);
  });

  it("refuses the same origin and destination", () => {
    const result = validateSearch({ ...valid, destinationCode: "LOS" }, today);
    expect(result.errors.destinationCode).toMatch(/must be different/i);
  });

  it("refuses a date in the past but allows today", () => {
    expect(validateSearch({ ...valid, departureDate: "2026-06-09" }, today).valid).toBe(false);
    expect(validateSearch({ ...valid, departureDate: "2026-06-10" }, today).valid).toBe(true);
  });

  it("requires at least one adult", () => {
    expect(validateSearch({ ...valid, adults: 0 }, today).valid).toBe(false);
  });

  it("requires an adult for every infant", () => {
    const result = validateSearch({ ...valid, adults: 1, infants: 2 }, today);
    expect(result.errors.infants).toMatch(/accompanied/i);
  });

  it("caps the party size", () => {
    const result = validateSearch(
      { ...valid, adults: MAX_PASSENGERS_PER_BOOKING, children: 1 },
      today,
    );
    expect(result.valid).toBe(false);
  });
});

describe("age bands", () => {
  it.each([
    ["2025-06-15", "infant"],
    ["2024-06-16", "infant"], // one day short of two
    ["2024-06-15", "child"], // exactly two
    ["2014-06-16", "child"], // one day short of twelve
    ["2014-06-15", "adult"], // exactly twelve
    ["1990-01-01", "adult"],
  ])("puts a birth date of %s in the %s band", (dateOfBirth, expected) => {
    expect(passengerTypeForAge(dateOfBirth, "2026-06-15")).toBe(expected);
  });

  it("returns null for a birth date after the travel date", () => {
    expect(passengerTypeForAge("2027-01-01", "2026-06-15")).toBeNull();
  });

  it("rejects a passenger whose age contradicts the fare they chose", () => {
    const result = validatePassenger(
      {
        firstName: "Baby",
        lastName: "Nwosu",
        dateOfBirth: "2025-06-15",
        passportNumber: "",
        type: "adult",
      },
      "2026-06-15",
      false,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.dateOfBirth).toMatch(/infant fare/i);
  });

  it("requires a passport only on international routes", () => {
    const passenger = {
      firstName: "Ada",
      lastName: "Lovelace",
      dateOfBirth: "1990-01-01",
      passportNumber: "",
      type: "adult" as const,
    };

    expect(validatePassenger(passenger, "2026-06-15", false).valid).toBe(true);
    expect(validatePassenger(passenger, "2026-06-15", true).valid).toBe(false);
  });
});

describe("card validation", () => {
  it("accepts numbers with a valid check digit", () => {
    expect(luhnCheck("4084084084084081")).toBe(true);
    expect(luhnCheck("4084 0840 8408 4081")).toBe(true);
  });

  it("rejects numbers with an invalid check digit", () => {
    expect(luhnCheck("4084084084084082")).toBe(false);
    expect(luhnCheck("1234567812345678")).toBe(false);
    expect(luhnCheck("")).toBe(false);
    expect(luhnCheck("123")).toBe(false);
  });

  it("detects the brand from the leading digits", () => {
    expect(detectCardBrand("4084084084084081")).toBe("Visa");
    expect(detectCardBrand("5399830000000000")).toBe("Mastercard");
    expect(detectCardBrand("5061234567890000")).toBe("Verve");
    expect(detectCardBrand("340000000000009")).toBe("American Express");
  });

  it("accepts an expiry through the last day of its month", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(isValidExpiry("06/26", now)).toBe(true);
    expect(isValidExpiry("05/26", now)).toBe(false);
    expect(isValidExpiry("13/26", now)).toBe(false);
    expect(isValidExpiry("nonsense", now)).toBe(false);
  });

  it("shows only the last four digits", () => {
    expect(maskCardNumber("4084084084084081")).toBe("**** **** **** 4081");
    expect(maskCardNumber("12")).toBe("****");
  });

  it("does not demand card details for a transfer or a wallet", () => {
    const empty = { cardHolder: "", cardNumber: "", expiry: "", cvv: "" };
    expect(validatePayment({ ...empty, method: "transfer" }).valid).toBe(true);
    expect(validatePayment({ ...empty, method: "wallet" }).valid).toBe(true);
    expect(validatePayment({ ...empty, method: "card" }).valid).toBe(false);
  });

  it("checks every card field", () => {
    const result = validatePayment({
      method: "card",
      cardHolder: "A",
      cardNumber: "1234",
      expiry: "01/20",
      cvv: "1",
    });

    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors)).toEqual(
      expect.arrayContaining(["cardHolder", "cardNumber", "expiry", "cvv"]),
    );
  });
});

describe("text sanitisation", () => {
  it("strips angle brackets so stored text cannot carry markup", () => {
    expect(sanitiseText("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
  });

  it("truncates to the given length and trims", () => {
    expect(sanitiseText("  padded  ")).toBe("padded");
    expect(sanitiseText("abcdefghij", 5)).toBe("abcde");
  });
});

describe("PNR generation", () => {
  it("generates six characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const pnr = generatePnr();
      expect(pnr).toHaveLength(PNR_LENGTH);
      expect(pnr.split("").every((char) => PNR_ALPHABET.includes(char))).toBe(true);
    }
  });

  it("excludes the characters that are misread aloud", () => {
    for (const char of ["I", "O", "0", "1"]) {
      expect(PNR_ALPHABET).not.toContain(char);
    }
  });

  it("avoids a code already in use", () => {
    const taken = new Set(Array.from({ length: 100 }, () => generatePnr()));
    for (let i = 0; i < 50; i += 1) {
      expect(taken.has(generateUniquePnr(taken))).toBe(false);
    }
  });

  it("still returns a VALID code when every attempt collides", () => {
    // A real Set that claims to contain everything, so the fallback path runs.
    class AlwaysTaken extends Set<string> {
      override has(): boolean {
        return true;
      }
    }

    const fallback = generateUniquePnr(new AlwaysTaken(), 3);

    expect(fallback).toHaveLength(PNR_LENGTH);
    // The fallback must survive the same lookup as any other reference —
    // a booking whose code cannot be typed back in is a lost booking.
    expect(isValidPnr(fallback)).toBe(true);
  });

  it("keeps the fallback inside the alphabet across a range of clocks", () => {
    class AlwaysTaken extends Set<string> {
      override has(): boolean {
        return true;
      }
    }

    for (let i = 0; i < 200; i += 1) {
      expect(isValidPnr(generateUniquePnr(new AlwaysTaken(), 1))).toBe(true);
    }
  });

  it("collides rarely across a realistic volume", () => {
    const codes = new Set(Array.from({ length: 20_000 }, () => generatePnr()));
    // 32^6 is about a billion, so 20k draws should almost never repeat.
    expect(codes.size).toBeGreaterThan(19_990);
  });

  it("validates format case-insensitively and rejects the excluded letters", () => {
    expect(isValidPnr("ABC234")).toBe(true);
    expect(isValidPnr(" abc234 ")).toBe(true);
    expect(isValidPnr("ABC23")).toBe(false);
    expect(isValidPnr("ABCI34")).toBe(false);
    expect(isValidPnr("ABC0O4")).toBe(false);
  });

  it("generates unique transaction references", () => {
    const refs = new Set(Array.from({ length: 500 }, () => generateTransactionReference()));
    expect(refs.size).toBeGreaterThan(490);
    expect([...refs][0]).toMatch(/^TXN-/);
  });
});

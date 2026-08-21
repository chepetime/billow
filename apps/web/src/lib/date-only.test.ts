import { describe, expect, it } from "vitest";

import { endOfMonth, parseDateOnly, toDateInputValue } from "@/lib/date-only";

describe("parseDateOnly", () => {
  it("parses to local midnight, not UTC midnight", () => {
    const date = parseDateOnly("2026-03-01");

    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(1);
    expect(date?.getHours()).toBe(0);
  });

  it("keeps the calendar day the user typed", () => {
    // The whole point: `new Date("2026-03-01")` is UTC midnight, which reads
    // back as Feb 28 anywhere west of Greenwich. This must not.
    const date = parseDateOnly("2026-03-01");
    expect(toDateInputValue(date as Date)).toBe("2026-03-01");
  });

  it("rejects a well-formed string naming a day that does not exist", () => {
    // The Date constructor rolls this over to March 3 rather than failing.
    expect(parseDateOnly("2026-02-31")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDateOnly("2028-02-29")).not.toBeNull();
    expect(parseDateOnly("2026-02-29")).toBeNull();
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    for (const value of ["", "2026-3-1", "01/03/2026", "2026-03-01T00:00:00"]) {
      expect(parseDateOnly(value), value).toBeNull();
    }
  });

  it("round-trips every day of a year", () => {
    const start = new Date(2026, 0, 1);
    for (let offset = 0; offset < 365; offset += 1) {
      const day = new Date(2026, 0, 1 + offset);
      const text = toDateInputValue(day);
      expect(toDateInputValue(parseDateOnly(text) as Date), text).toBe(text);
    }
    expect(start.getFullYear()).toBe(2026);
  });
});

describe("endOfMonth", () => {
  it("finds the last day without a lookup table", () => {
    expect(endOfMonth(new Date(2026, 1, 10))).toBe("2026-02-28");
    expect(endOfMonth(new Date(2028, 1, 10))).toBe("2028-02-29");
    expect(endOfMonth(new Date(2026, 3, 1))).toBe("2026-04-30");
    expect(endOfMonth(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

/**
 * Calendar dates that carry no time of day: invoice dates, milestone dates.
 *
 * The trap these helpers exist to avoid: `new Date("2026-03-01")` parses as
 * **UTC** midnight, but `Intl.DateTimeFormat` renders in the server's zone. In
 * Mexico City (UTC-6) that pair turns an invoice dated the 1st into "Feb 28"
 * everywhere it is displayed, and drops it out of the March totals — which
 * `currentMonthRange()` builds from local-time month boundaries.
 *
 * So a date-only value is stored as **local** midnight, and read back the same
 * way. Both directions have to agree; using the built-in parser on one side is
 * what re-introduces the shift.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse `YYYY-MM-DD` (what `<input type="date">` submits) into local midnight.
 * Returns null for anything else, including a well-formed string naming a day
 * that does not exist — `2026-02-31` round-trips to March 3 through the Date
 * constructor rather than failing, so the components are compared back.
 */
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/** Format a Date as `YYYY-MM-DD` in local time, for `<input type="date">`. */
export function toDateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The last day of the month containing `date`, as a date-only string.
 *
 * Day 0 of the *next* month is the last day of this one, which also gets
 * February and leap years right without a table.
 */
export function endOfMonth(date: Date): string {
  return toDateInputValue(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/**
 * Page titles that double as filenames.
 *
 * The invoice page is the page we print, and every browser's print-to-PDF
 * dialog seeds its filename from `document.title`. So that page's title is not
 * really prose — it is a filename, and it has to survive being one: Chrome
 * rewrites the characters it dislikes in place, which is how a client named
 * "Acme, S.A. de C.V." lands on disk as "Acme_ S.A. de C.V.pdf". Building the
 * slug here instead means the same invoice saves under the same name in every
 * browser.
 */

import { toDateInputValue } from "@/lib/date-only";

/**
 * ASCII, and nothing a filesystem or a download header has an opinion about.
 *
 * Accents are folded rather than dropped — this workspace bills in MXN, so
 * "Gulías" is the common case, and "Gulas" would be the wrong answer.
 */
export function toFilenameSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * `Invoice-12-Jose_Manuel_Gulias_Lugo-2026-08-31`.
 *
 * The date comes from `toDateInputValue`, not `toISOString`: an invoice dated
 * the 1st is stored as local midnight, and formatting it as UTC would file it
 * under the previous day everywhere west of Greenwich.
 */
export function invoiceDocumentTitle(invoice: {
  invoiceNumber: number;
  invoiceDate: Date;
  userProfile: { legalName: string };
}): string {
  const issuer = toFilenameSlug(invoice.userProfile.legalName);
  const date = toDateInputValue(invoice.invoiceDate);

  return ["Invoice", invoice.invoiceNumber, issuer, date]
    .filter((part) => part !== "")
    .join("-");
}

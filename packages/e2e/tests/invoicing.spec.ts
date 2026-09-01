import { expect, type Page, test } from "@playwright/test";

import { validCfdiXmlFile, validPdfFile, validPngFile } from "./fixtures/files";
import { uniqueSuffix } from "./fixtures/users";

/**
 * The invoicing workspace end to end: sender, bank account, client, then an
 * invoice through create → dated progress → monthly tax filing → duplicate.
 *
 * This is the path a real user takes on a fresh installation, and until this
 * file existed none of it had ever been exercised against a database. Three
 * things here are only observable at this level:
 *
 *   1. **Encrypted columns round-trip.** A sender's tax ID and a bank
 *      account's number go through the per-user data key on write and come
 *      back readable on the edit form. A unit test cannot see that, because
 *      the key is derived from the session.
 *   2. **The setup gate opens.** `/invoices/new` refuses to render a form
 *      until a sender, an account and a client all exist, so the ordering of
 *      the first three steps is part of the contract.
 *   3. **Duplicate lands on the edit screen** of a *new* draft rather than
 *      re-opening the original — the whole point of the recurring-invoice
 *      case.
 *
 * Everything is keyed on a random suffix (the database is never reset between
 * specs; see playwright.config.ts), so a rerun against a warm database adds a
 * fresh set of records instead of colliding with the last one's.
 */

const suffix = uniqueSuffix();

const sender = {
  displayName: `E2E Sender ${suffix}`,
  legalName: `E2E Sender Legal ${suffix}`,
  email: `billow-e2e-sender-${suffix}@example.com`,
  address: "500 Example Street, Suite 200",
  taxId: `TAX${suffix.toUpperCase()}`,
};

const bank = {
  label: `E2E Account ${suffix}`,
  bankName: "Example Bank",
  accountHolderName: `E2E Holder ${suffix}`,
  accountNumber: `9900${suffix.replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`,
};

const client = {
  name: `E2E Client ${suffix}`,
  email: `billow-e2e-client-${suffix}@example.com`,
  address1: "742 Sample Avenue",
  cityStatePostal: "Sample City, SC 12345",
  country: "Mexico",
};

/**
 * Invoice numbers are unique per user, and this spec may run repeatedly
 * against the same account. The form pre-fills the next free number, so the
 * value is read back rather than chosen — writing a literal here would pass
 * once and then collide forever.
 */
let invoiceNumber = "";
let originalInvoiceUrl = "";

test.describe.configure({ mode: "serial" });

test("the invoicing workspace, end to end", async ({ page }) => {
  await createSender(page);
  await createBankAccount(page);
  await createClient(page);
  await createInvoice(page);
  await recordMilestone(page, "Sent to client", "2026-08-01", "Sent");
  await clearMilestone(page, "Sent to client", "Draft");
  await recordMilestone(page, "Sent to client", "2026-08-01", "Sent");
  await editInvoice(page);
  await recordMilestone(page, "Approved by client", "2026-08-02", "Approved");
  await recordMilestone(page, "Payment received", "2026-08-03", "Paid");
  await recordCfdi(page);
  await clearCfdi(page);
  await recordCfdi(page);
  await recordMonthlyTaxFiling(page);
  await recordMonthlyTaxPayment(page);
  await duplicateInvoice(page);
});

async function createSender(page: Page) {
  await page.goto("/senders/new");

  // If this notice is showing, the session never reached the data key and the
  // tax ID below would be written as ciphertext-looking plaintext. Fail here
  // with a clear cause rather than three steps later on a mismatched value.
  await expect(
    page.getByRole("heading", { name: "Encrypted fields are locked" }),
  ).toBeHidden();

  await page.getByLabel("Display name").fill(sender.displayName);
  await page.getByLabel("Legal name").fill(sender.legalName);
  await page.getByLabel("Email").fill(sender.email);
  await page.getByLabel("Address").fill(sender.address);
  await page.getByLabel("Tax ID").fill(sender.taxId);
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(page).toHaveURL(/\/senders$/);
  await expect(page.getByText(sender.displayName).first()).toBeVisible();
}

async function createBankAccount(page: Page) {
  await page.goto("/banks/new");

  await page.getByLabel("Sender profile").selectOption({
    label: sender.displayName,
  });
  await page.getByLabel("Label").fill(bank.label);
  await page.getByLabel("Bank name").fill(bank.bankName);
  await page.getByLabel("Account holder name").fill(bank.accountHolderName);
  await page.getByLabel("Account number").fill(bank.accountNumber);
  await page.getByLabel("Use as the default account on new invoices").check();
  await page.getByRole("button", { name: "Save account" }).click();

  await expect(page).toHaveURL(/\/banks$/);
  await expect(page.getByText(bank.label).first()).toBeVisible();

  // The account number is encrypted on write. Reopening the record proves the
  // decrypt path works: a broken key would render the `encv1.` envelope, and
  // a broken write would render nothing.
  await page.getByText(bank.label).first().click();
  await expect(page.getByLabel("Account number")).toHaveValue(
    bank.accountNumber,
  );
}

async function createClient(page: Page) {
  await page.goto("/clients/new");

  await page.getByLabel("Company name").fill(client.name);
  await page.getByLabel("Billing email").fill(client.email);
  await page.getByLabel("Address line 1").fill(client.address1);
  await page
    .getByLabel("City, state, postal code")
    .fill(client.cityStatePostal);
  await page.getByLabel("Country").fill(client.country);
  await page.getByRole("button", { name: "Save client" }).click();

  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByText(client.name).first()).toBeVisible();
}

async function createInvoice(page: Page) {
  await page.goto("/invoices/new");

  // With all three records in place the setup gate must be gone.
  await expect(
    page.getByRole("heading", { name: "Set up your workspace first" }),
  ).toBeHidden();

  invoiceNumber = await page.getByLabel("Invoice number").inputValue();
  expect(Number(invoiceNumber)).toBeGreaterThan(0);

  await page.getByLabel("Sender").selectOption({ label: sender.displayName });
  await page.getByLabel("Client").selectOption({ label: client.name });
  await page.getByLabel("Currency").selectOption("MXN");

  await page.getByLabel("Description").fill("Consulting, October");
  await page.getByLabel("Qty").fill("2");
  await page.getByLabel("Rate").fill("1250.50");

  // The running total is computed in the browser from the same rounding rule
  // the database column uses, so it is worth asserting before the write.
  // Matched loosely on whitespace: `currencyDisplay: "code"` puts a
  // non-breaking space between the code and the amount.
  await expect(page.getByText(/MXN\s*2,501\.00/).first()).toBeVisible();

  await page.getByRole("button", { name: "Create invoice" }).click();

  await expect(page).toHaveURL(
    /\/invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  originalInvoiceUrl = page.url();
  await expect(page.getByText(client.name).first()).toBeVisible();
}

function progressRow(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title });
}

async function recordMilestone(
  page: Page,
  title: string,
  date: string,
  expectedStatus: string,
) {
  await page.goto(originalInvoiceUrl);
  const row = progressRow(page, title);
  await row.getByRole("button", { name: "Record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date").fill(date);
  await dialog.getByRole("button", { name: "Save date" }).click();
  // The invoice page renders InvoiceStatusBadge twice — once in the workflow
  // panel, once in the printable preview — and the two always agree, so
  // matching the first is the same assertion without the strict mode
  // violation an unqualified match now raises.
  await expect(
    page.getByText(expectedStatus, { exact: true }).first(),
  ).toBeVisible();
}

async function clearMilestone(
  page: Page,
  title: string,
  expectedStatus: string,
) {
  await page.goto(originalInvoiceUrl);
  await progressRow(page, title).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Clear date" }).click();
  // The invoice page renders InvoiceStatusBadge twice — once in the workflow
  // panel, once in the printable preview — and the two always agree, so
  // matching the first is the same assertion without the strict mode
  // violation an unqualified match now raises.
  await expect(
    page.getByText(expectedStatus, { exact: true }).first(),
  ).toBeVisible();
}

async function editInvoice(page: Page) {
  await page.goto(`${originalInvoiceUrl}/edit`);

  // Line items are replaced wholesale on update, so changing the rate is the
  // case that exercises the delete-and-recreate path rather than an in-place
  // column write.
  await page.getByLabel("Rate").fill("1000");
  await page.getByRole("button", { name: "Save invoice" }).click();

  await expect(page).toHaveURL(new RegExp(`${originalInvoiceUrl}$`));
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();

  await page.goto(`${originalInvoiceUrl}/edit`);
  await expect(page.getByLabel("Rate")).toHaveValue("1000");
  await expect(page.getByLabel("Status")).toHaveCount(0);
}

async function recordCfdi(page: Page) {
  await page.goto(originalInvoiceUrl);
  await progressRow(page, "Fiscal invoice (CFDI)")
    .getByRole("button", { name: "Record" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Issued date").fill("2026-08-04");
  await dialog
    .getByLabel("CFDI XML")
    .setInputFiles(validCfdiXmlFile(`cfdi-${suffix}.xml`));
  await dialog
    .getByLabel("CFDI PDF")
    .setInputFiles(validPdfFile(`cfdi-${suffix}.pdf`));
  await dialog.getByRole("button", { name: "Save CFDI" }).click();

  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`cfdi-${suffix}.xml`)).toBeVisible();
  await expect(page.getByText(`cfdi-${suffix}.pdf`)).toBeVisible();
}

async function clearCfdi(page: Page) {
  await progressRow(page, "Fiscal invoice (CFDI)")
    .getByRole("button", { name: "Edit" })
    .click();
  await page.getByRole("button", { name: "Clear CFDI" }).click();
  await page.getByRole("button", { name: "Yes, clear CFDI" }).click();

  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`cfdi-${suffix}.xml`)).toHaveCount(0);
  await expect(page.getByText(`cfdi-${suffix}.pdf`)).toHaveCount(0);
}

async function recordMonthlyTaxFiling(page: Page) {
  const row = progressRow(page, "Tax return filed");
  await row.getByRole("button", { name: "Record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Filing date").fill("2026-08-10");
  await dialog
    .getByLabel("Tax return PDF")
    .setInputFiles(validPdfFile(`tax-return-${suffix}.pdf`));
  await dialog.getByRole("button", { name: "Save filing" }).click();

  await expect(page.getByText(`tax-return-${suffix}.pdf`)).toBeVisible();
}

async function recordMonthlyTaxPayment(page: Page) {
  const row = progressRow(page, "Tax payment confirmed");
  await row.getByRole("button", { name: "Record" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount paid").fill("1234.56");
  await dialog.getByLabel("Currency").selectOption("MXN");
  await dialog.getByLabel("Payment date").fill("2026-08-12");
  await dialog
    .getByLabel("Payment confirmation")
    .setInputFiles(validPngFile(`tax-payment-${suffix}.png`));
  await dialog.getByRole("button", { name: "Save payment" }).click();

  await expect(page.getByText(`tax-payment-${suffix}.png`)).toBeVisible();
  await expect(progressRow(page, "Tax payment confirmed")).toContainText(
    "MXN 1,234.56",
  );
}

async function duplicateInvoice(page: Page) {
  await page.goto(originalInvoiceUrl);
  await page.getByRole("button", { name: "Duplicate" }).click();

  // A copy opens the *new* draft's edit screen. Landing back on the original
  // would mean duplicate silently did nothing.
  await expect(page).toHaveURL(
    /\/invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/edit$/,
  );
  expect(page.url()).not.toBe(`${originalInvoiceUrl}/edit`);

  // A duplicate is a fresh draft: next number, no progress dates, same lines.
  await expect(page.getByLabel("Description")).toHaveValue(
    "Consulting, October",
  );
  const copyNumber = await page.getByLabel("Invoice number").inputValue();
  expect(Number(copyNumber)).toBeGreaterThan(Number(invoiceNumber));

  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
}

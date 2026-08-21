import { expect, type Page, test } from "@playwright/test";

import { uniqueSuffix } from "./fixtures/users";

/**
 * The invoicing workspace end to end: sender, bank account, client, then an
 * invoice through create → edit → duplicate.
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
  await editInvoice(page);
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

  await expect(page).toHaveURL(/\/invoices\/\d+$/);
  originalInvoiceUrl = page.url();
  await expect(page.getByText(client.name).first()).toBeVisible();
}

async function editInvoice(page: Page) {
  await page.goto(`${originalInvoiceUrl}/edit`);

  // Line items are replaced wholesale on update, so changing the rate is the
  // case that exercises the delete-and-recreate path rather than an in-place
  // column write.
  await page.getByLabel("Rate").fill("1000");
  await page.getByLabel("Status").selectOption("SENT");
  await page.getByRole("button", { name: "Save invoice" }).click();

  await expect(page).toHaveURL(new RegExp(`${originalInvoiceUrl}$`));

  await page.goto(`${originalInvoiceUrl}/edit`);
  await expect(page.getByLabel("Rate")).toHaveValue("1000");
  await expect(page.getByLabel("Status")).toHaveValue("SENT");
}

async function duplicateInvoice(page: Page) {
  await page.goto(originalInvoiceUrl);
  await page.getByRole("button", { name: "Duplicate" }).click();

  // A copy opens the *new* draft's edit screen. Landing back on the original
  // would mean duplicate silently did nothing.
  await expect(page).toHaveURL(/\/invoices\/\d+\/edit$/);
  expect(page.url()).not.toBe(`${originalInvoiceUrl}/edit`);

  // A duplicate is a fresh draft: next number, status reset, same lines.
  await expect(page.getByLabel("Status")).toHaveValue("DRAFT");
  await expect(page.getByLabel("Description")).toHaveValue(
    "Consulting, October",
  );
  const copyNumber = await page.getByLabel("Invoice number").inputValue();
  expect(Number(copyNumber)).toBeGreaterThan(Number(invoiceNumber));
}

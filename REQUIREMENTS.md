# Billow Requirements

## Goal

Rebuild the current Invoice Center experience as Billow: a user-centered invoice
manager for Umbrel that stores reusable profile data, bank accounts, client
companies, invoices, line items, and invoice history in Postgres.

The old app proves the core invoice workflow. Billow should keep the useful
parts, then add onboarding and reusable records so the user does not edit the
same contractor, bank, and bill-to data on every invoice.

Billow is the product, not a worked example of the platform. Everything the
platform layer provides — auth, the data-key hierarchy, uploads, backup — exists
to serve invoicing.

**What makes Billow more than the old app is tracking.** Writing an invoice is
the short part of the job. The long part is knowing, months later, whether each
one was sent, acknowledged, paid, turned into a CFDI by the accountant, and
included in a filed monthly tax report. The old app answered none of that. The
dashboard should be able to answer "what is unfinished?" without the user
keeping a parallel spreadsheet.

## Current Reference

Reference app:

```text
/Users/jose/Projects/personal/invoice-center
```

Current reference behavior:

- Dashboard shows current, future, and past invoices.
- Invoice detail page has an editable form next to a live invoice preview.
- Invoice data persists in local SQLite.
- Invoice revisions save edit history.
- Contractor, bank, and client billing fields live on each invoice.

Billow target behavior:

- User creates their profile once during onboarding.
- User can manage one or more bank accounts.
- User can manage one or more client companies.
- User creates invoices from reusable profile, bank, and client records.
- Each invoice saves its own snapshot-worthy data and line items.
- Each invoice keeps revision history.
- Each invoice tracks its progress from draft through payment and the related
  tax work, so nothing silently stalls.
- Each month tracks whether the tax report was filed and paid, and for how much.
- The dashboard surfaces what is unfinished, not just what exists.
- Multiple users can sign in and manage their own invoice workspace.
- Billow supports import and export for moving invoice data in and out of the
  app.
- Empty production databases show onboarding, not broken seeded assumptions.

## Product Principles

- The first screen should be the app, not a marketing page.
- The app should support multiple authenticated users.
- Repeated invoice data should live in reusable records.
- Invoice creation should default to the most likely choices.
- Empty states should guide setup without hiding the product surface.
- The invoice preview should look close enough to send or print.
- Browser print and generated PDF export should both be supported.
- Data should survive Umbrel app updates through the existing Postgres volume.

## Primary Users

### Contractor

A user is a contractor who invoices one or more companies each month. They need
predictable invoice numbering, bank details, client details, and a fast way to
create the next invoice.

### Multi-User Household or Team

Billow should support more than one authenticated user. Each user should have
their own profiles, bank accounts, client companies, invoices, and settings
unless a later sharing feature says otherwise.

## Authentication

Billow will use BetterAuth.

Auth requirements:

- Users can create an account.
- Users can sign in and sign out.
- The first registered user becomes the admin.
- The admin can switch registration between open and closed.
- Invoice workspace data belongs to the signed-in user.
- Server actions and routes must check the current user before reading or
  writing workspace data.
- Onboarding runs per user after sign-in.
- Auth tables and Billow app tables should live in the same Postgres database.
- BetterAuth password reset flow should be enabled.

Implementation notes:

- Verify current BetterAuth Next.js and Prisma/Postgres setup docs before
  implementation.
- Add an admin-only setting for registration mode.
- Implement password reset through BetterAuth's supported flow.

### User Settings

Stores per-user preferences.

Required fields:

- Owning user
- Default currency
- Invoice numbering mode
- Next invoice number
- Registration mode for admin users

Currency requirements:

- Support multiple currencies.
- Each user picks a default currency.
- Invoice creation defaults to the user's currency.
- Each invoice stores its selected currency.
- The first currency picker should include USD, MXN, CAD, and EUR.

## Core Data

### User Profile

Stores sender information used across invoices.

Required fields:

- Owning user
- Display name
- Legal name
- Email
- Address

Optional fields:

- Tax ID
- Department
- Manager
- Notes

Decision: support multiple users. Within each user account, start with one
default sender profile and keep the schema ready for more.

### Bank Account

Stores payment instructions attached to invoices.

Required fields:

- Owning user
- Label
- Bank name
- Account holder name
- Account number or CLABE

Optional fields:

- Bank address
- Bank phone
- Account holder address
- Account type
- Institution number
- Transit number
- Routing number
- SWIFT
- IBAN
- CLABE
- Default account flag

Decision: mask bank details in list and summary views. Invoice previews and
exports may show the full payment instructions when the user takes an explicit
view, print, PDF, or export action.

### Client Company

Stores companies the user invoices.

Required fields:

- Owning user
- Company name
- Billing address line 1
- City, state, postal code
- Country
- Billing email

Optional fields:

- Legal name
- Address line 2
- Attention line
- Notes

Open question: should the app support multiple billing contacts per company in
the MVP?

### Invoice

Stores one invoice record.

Required fields:

- Owning user
- Opaque invoice ID
- Invoice number
- Invoice date
- Currency
- Sender profile
- Bank account
- Client company
- Line items
- Frozen sender snapshot
- Frozen bank snapshot
- Frozen client snapshot
- Status

The invoice ID is a generated, non-sequential UUID used in URLs and actions.
It is distinct from the user-controlled invoice number printed on the invoice.

Optional fields:

- Notes
- Payment terms
- Due date
- Purchase order number

Decision: support both automatic invoice numbering and manual edits. The app
should suggest the next number from the user's numbering settings, then allow
manual override with duplicate-number validation per user.

Invoices must store frozen sender, client, and bank snapshots used for the
rendered invoice. Editing a profile, client, or bank account should affect new
invoices by default, not silently rewrite old invoices.

### Invoice Line Item

Stores invoice rows.

Required fields:

- Description
- Quantity
- Rate
- Amount
- Sort position

Optional fields:

- Note
- Service date range

Open question: should the MVP include service date ranges per line item?

### Invoice Revision

Stores changes to an invoice after creation.

Required fields:

- Invoice
- Revision number
- Editor label
- Summary
- Payload
- Created timestamp

Decision: revisions should support audit-friendly invoice history. Store enough
data to reconstruct the invoice before and after a save. The implementation can
also store a concise changed-field summary for display.

## Lifecycle Tracking

Invoice progress is a set of dated business facts rather than a forward-only
state machine:

```text
Sent → Approved → Paid → Fiscal invoice (CFDI date + XML + PDF)
```

Each date remains independently editable so a mistaken click can be corrected
without erasing later work. `Invoice.status` is recalculated as a query-friendly
summary after each write; it is not the source of truth. Void remains an
explicit terminal exception. Every successful invoice-progress change appends a
full before/after revision.

Dashboard totals treat Draft, Sent, and Approved as open; Paid, Tax receipt,
legacy Tax return, and Done as paid; and Void as neither. Monthly filing belongs
to `TaxPeriod`, so it does not advance an individual invoice.

### Attention rules

The tracking drives one dashboard section listing the first missing fact or
document:

- Sent date
- Client approval date
- Payment date
- CFDI issue date, XML, and PDF
- Current-month tax-return filing date and PDF
- Current-month tax amount, payment date, and confirmation

Open question: the "past N days" thresholds should be per-user settings rather
than constants, but constants are acceptable for the first version.

### Invoice Document

Attachments belonging to an invoice, stored through the existing `Upload` model
so they inherit its storage keys, type sniffing, checksums, and per-user quota.

Required fields:

- Invoice
- Upload (one upload belongs to exactly one attachment)
- Kind: CFDI XML, CFDI PDF, payment proof, signed copy, other

Optional fields:

- Note

Uploads created this way must carry a `kind` that keeps them out of the account
attachments list — invoice documents are invoice-scoped, not account-scoped.

### Tax Period

One record per user per calendar month.

Required fields:

- Owning user
- Year
- Month
- Currency

Optional fields:

- Tax amount paid
- Filed date
- Paid date
- Notes
- Documents: the declaration PDF, the payment receipt

Decisions:

- One combined tax amount for the first version. Splitting into ISR and IVA is a
  later change and the schema should not make it painful.
- The period defaults to the currency the tax is actually paid in (MXN), which is
  independent of the currency any given invoice was issued in.
- A period's invoices are derived from `invoiceDate` falling in that month. No
  foreign key from invoice to period yet.

## Main Flows

### Onboarding

Triggered after sign-in when the user has no sender profile, bank account, or
client company.

Steps:

1. Enter sender profile.
2. Enter first bank account.
3. Enter first client company.
4. Enter invoice numbering preference.

Starter invoice creation should not be part of onboarding. Users may skip
sections that are not required to reach the dashboard, but invoice creation
should require the missing records before save.

MVP can place these sections on one page. Later versions can split onboarding
into steps if the form feels heavy.

### Dashboard

The dashboard should show:

- Signed-in user controls
- Setup progress if onboarding is incomplete
- Current month invoice count and total
- Open invoice count and total
- Paid invoice count and total
- Next invoice number
- Needs attention, from the attention rules above
- Recent invoices
- This month's tax period status
- Bank accounts
- Client companies
- Primary action to create an invoice

Invoice cards should expose:

- Invoice number
- Client
- Date
- Derived status
- Fiscal indicator: whether a CFDI is attached
- Total
- Quick access to view or edit

Dashboard grouping should be explored before choosing a single default.
Candidate views:

- Time-based: current, future, past
- Status-based: draft, sent, paid, void
- Client-based: grouped by company
- Aging-based: unpaid, due soon, overdue, paid
- Hybrid: primary status lanes with date filters

Decision: prototype the time-based view first and use it as the MVP default.
Keep the data model flexible enough to add status, client, aging, and hybrid
views later.

### Create Invoice

User chooses:

- Sender profile
- Client company
- Bank account
- Invoice number
- Invoice date
- Currency
- Line items

A new invoice starts in Draft.

Defaults:

- Sender profile: default or only profile
- Bank account: default or only bank account
- Client company: most recently used client
- Invoice number: next available number
- Invoice date: last day of the current month
- Currency: user's default currency

Decision: default invoice date to month end.

### Edit Invoice

User can edit:

- Header fields
- Client selection
- Bank account selection
- Line items
- Notes

Billow records a revision after each save. Existing invoices keep a frozen copy
of the sender, client, and bank details used when the invoice was saved.

### Track an Invoice

The invoice detail page presents the four invoice milestones as a progress
checklist. Each row records or edits its own date; the CFDI row also owns the XML
and PDF. The status badge follows the furthest completed fact, while the
dashboard continues to surface any earlier fact the user left blank.

### Monthly Tax Report

A month view lists, for the selected month:

- The invoices dated in that month, with their totals and CFDI state
- The tax amount paid
- Whether the report was filed
- Whether the tax was paid
- The attached declaration and payment receipt

Editing any of these creates the `TaxPeriod` record on demand — the user should
never have to "create a month" before filling it in.

### Preview and Print

Invoice preview should include:

- Sender details
- Bill-to details
- Invoice number
- Invoice date
- Line item table
- Total
- Bank payment instructions
- Remittance email

MVP should support browser print and downloadable PDF export.

Decision: the download is generated server-side with `@react-pdf/renderer`. It
is pure JavaScript, so it adds no native dependency and no Chromium to an image
that has to build for Umbrel's architecture. The accepted cost is a second
implementation of the invoice layout in its primitives — the HTML preview and the
PDF must be kept visually in step by hand, and a change to one is not a change to
the other. Browser print keeps working off the existing CSS and stays the
pixel-faithful path.

### Import and Export

Billow should support moving data in and out of the app.

Import requirements:

- Import user-owned invoice workspace data from a structured file.
- Validate imported profiles, bank accounts, clients, invoices, line items, and
  revision records before writing.
- Preserve invoice numbers and dates when the source file provides them.
- Report skipped rows and validation errors.
- Do not import from the old Invoice Center SQLite database as part of the MVP.

Export requirements:

- Export all data for the signed-in user.
- Admin users can export their own data. Cross-user export is out of scope for
  the MVP.
- Include profiles, bank accounts, client companies, invoices, line items,
  invoice snapshots, revisions, lifecycle status, tax periods, and the metadata
  for invoice and tax-period documents.
- Use a stable JSON format first.
- CSV export can be added for invoices and line items.

Open question: whether an export carries the uploaded document **bytes** or only
their metadata. Metadata-only keeps the JSON small and human-readable but makes
an export insufficient to rebuild an install, which is the main reason to have
one. The existing backup archive already moves upload bytes; export should
probably defer to it rather than grow a second mechanism.

## Technical Plan

### Already shipped

Do not rebuild these. Grep before trusting any checkbox — `TODO.md` records
three items that were marked todo while already implemented and were nearly
rebuilt from scratch as a result.

- Auth end to end: sign-up, sign-in, sign-out, sessions, two-factor, usernames,
  password reset, first-user-admin, registration mode, admin user list.
- The per-user data-key hierarchy and field encryption. `UserProfile.taxId`,
  `UserProfile.address`, and nine `BankAccount` columns are already encrypted at
  rest, reached through `getWorkspacePrisma()`.
- Uploads: storage keys, type sniffing, checksums, a 100 MB per-user quota, and
  download routes (`/api/v1/uploads`).
- Admin backup and restore, including upload bytes.
- The invoice **preview** and browser print, and a dashboard with
  month/open/paid totals computed in SQL.
- Prisma models for profiles, banks, clients, invoices, line items, revisions.
- **Phases 2 and 3 below**: full CRUD for sender profiles, bank accounts,
  clients and invoices, with the setup gate on invoice creation.

### Phase 1: Invoice identity and initial lifecycle — **done**

- Add an opaque UUID public ID without changing the internal relational keys.
- Extend the stored status through Tax receipt, Tax return, and Done.
- Route invoice reads and writes by public ID plus the owning user.
- Add lifecycle revision history (the original one-step action was later
  replaced by dated facts in Phase 4).
- Update dashboard aggregates, backup validation, CSV labels, and status badges.
- Record the UUID and status encryption boundary in the data inventory.

### Phase 2: Records CRUD — **done**

The prerequisite for everything else being usable.

- ~~Workspace onboarding~~ — delivered as per-record create screens reached from
  the dashboard's setup list and from a gate on the new-invoice page, rather
  than as one onboarding wizard. Same rule: sections are skippable, and the
  records are required before an invoice can be saved.
- Full CRUD for profiles (`/senders`), bank accounts (`/banks`), and client
  companies (`/clients`).
- All writes go through `getWorkspacePrisma()` — the plain client rejects
  plaintext writes to encrypted columns by design, and the repo-wide source
  check in `encrypted-writes.test.ts` fails the build if a call site drifts.
- Deleting a record still referenced by an invoice is refused with an
  explanation rather than a Prisma error.
- **Still open:** per-user settings for default currency and numbering mode.
  New invoices currently infer both from the most recent invoice.

### Phase 3: Invoice CRUD — **done**

- Create and edit invoices with line items, defaulting sender, bank, client,
  number, month-end date, and currency.
- Duplicate invoice-number validation per user, surfaced as a form message.
- An invoice revision appended on every save, with a readable change summary.
- "Duplicate" as the fast path for the recurring monthly case: copies the line
  items, takes the next number and this month's end date, opens the editor.
- **Still open:** frozen sender/bank/client snapshots. Invoices reference the
  live records today, so editing a client's address changes how an old invoice
  renders. The snapshot columns land with the Phase 1 migration.

### Phase 4: Tracking — **done**

The point of the whole exercise.

- Dated Sent, Approved, Paid, and CFDI milestones on the invoice detail page.
- Every date independently editable, with derived status and readable
  revisions.
- Dashboard "Needs attention" section driven by missing facts and documents.
- **Still open:** invoice-list filters and configurable attention thresholds.

### Phase 5: Documents — **partially done**

- CFDI XML and PDF upload on the invoice page, wired to strict content sniffing
  and invoice-scoped upload kinds.
- Replacing a workflow document deletes its old `Upload` and bytes.
- **Still open:** general payment-proof and signed-copy attachment management.

### Phase 6: Tax periods — **partially done**

- Records created on demand from an invoice in the relevant month.
- Filing date plus tax-return PDF, and amount paid plus payment date and
  confirmation file.
- Current-month filing/payment shown in dashboard attention.
- **Still open:** dedicated month and year overview pages.

### Phase 7: PDF, import, export

- `@react-pdf/renderer` download route for a single invoice.
- JSON export of a signed-in user's whole workspace, tracking included.
- JSON import with per-row validation and an error report.

### Verification, every phase

- `pnpm run db:generate`, `pnpm run db:validate`
- `pnpm lint`, `pnpm test:run`, `pnpm build`
- Start the app locally and check desktop and mobile layouts.
- Before a release, verify on the real Umbrel install — plain HTTP behind
  `app_proxy` breaks things a green pipeline never sees.

## Migration Questions

Decision: do not import the old Invoice Center SQLite database directly in the
MVP.

Billow should include import/export features so data can move between installs
or tools through a documented file format.

## Product Questions

Answered:

- Use BetterAuth.
- Support multiple users.
- Make the first user admin.
- Let admins open or close registration.
- Give admins a user list in the MVP.
- Keep each user's workspace private for now.
- Leave sharing out of scope.
- Do not import the old SQLite database directly.
- Add import/export support.
- Support automatic invoice numbering and manual invoice number edits.
- Keep frozen sender/client/bank snapshots on existing invoices.
- Support browser print and PDF export.
- Let users skip onboarding sections, but require the missing records before
  invoice save.
- Do not create a starter invoice during onboarding.
- Default invoice dates to month end.
- Mask bank details outside explicit view, print, PDF, and export actions.
- Support multiple currencies with a per-user default.
- Include USD, MXN, CAD, and EUR in the first currency picker.
- Use time-based dashboard grouping for the MVP.
- Use BetterAuth's password reset flow.
- Give every invoice an opaque UUID distinct from its printed invoice number.
- Track dated Sent → Approved → Paid → CFDI facts, with a derived stored status
  and Void as an exceptional terminal state.
- Append a revision for every invoice-progress edit.
- Label the fiscal document "Fiscal invoice (CFDI)" in the UI.
- One CFDI per invoice.
- The monthly tax report is its own per-month record, not an invoice field.
- One combined tax amount per month for now, not an ISR/IVA split.
- Generate the PDF download with `@react-pdf/renderer`, and keep browser print.

Open:

- **Which month owns an invoice.** Derived from `invoiceDate` for now, but a CFDI
  issued in the following month is normally declared in that following month, so
  the derivation will be wrong at every month boundary. An explicit override on
  the invoice is the likely fix.
- **Foreign-currency tax.** An invoice in USD is declared in MXN at the SAT rate
  for the day. Nothing currently captures that rate, so a USD invoice cannot be
  reconciled against a MXN tax period. Probably an `fxRate` and `fxRateDate` on
  the invoice, captured when the CFDI is marked.
- **Attention thresholds** as per-user settings rather than constants.

## Current Repository Note

The invoicing CRUD, dated progress workflow, CFDI documents, monthly tax filing,
dashboard attention, backup/restore, invoice preview, and browser print are real
and working. Treat the docs site as the source of truth for how the platform
pieces behave, and this file as the source of truth for what the product should
do next.

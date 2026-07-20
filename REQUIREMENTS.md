# Billow Requirements

## Goal

Rebuild the current Invoice Center experience as Billow: a user-centered invoice
manager for Umbrel that stores reusable profile data, bank accounts, client
companies, invoices, line items, and invoice history in Postgres.

The old app proves the core invoice workflow. Billow should keep the useful
parts, then add onboarding and reusable records so the user does not edit the
same contractor, bank, and bill-to data on every invoice.

## Current Reference

Reference app:

```text
/Users/jlugo/Projects/personal/invoice-center
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
- Invoice number
- Invoice date
- Status
- Currency
- Sender profile
- Bank account
- Client company
- Line items
- Frozen sender snapshot
- Frozen bank snapshot
- Frozen client snapshot

Statuses:

- Draft
- Sent
- Paid
- Void

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
- Recent invoices
- Bank accounts
- Client companies
- Primary action to create an invoice

Invoice cards should expose:

- Invoice number
- Client
- Date
- Status
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
- Status
- Currency
- Line items

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
- Status
- Notes

Billow records a revision after each save. Existing invoices keep a frozen copy
of the sender, client, and bank details used when the invoice was saved.

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
  invoice snapshots, and revisions.
- Use a stable JSON format first.
- CSV export can be added for invoices and line items.

## Technical Plan

### Phase 1: Requirements and Data Shape

- Finalize this document.
- Confirm onboarding fields and invoice numbering rules.
- Confirm BetterAuth registration and password-reset behavior.
- Confirm admin setting UX for opening and closing registration.
- Confirm import/export file format.
- Add Prisma models and migrations for profiles, banks, clients, invoices,
  line items, and revisions.
- Add auth tables and user ownership.
- Add per-user settings for default currency and invoice numbering.
- Keep `AppMetadata` for the Umbrel package.

### Phase 2: Persistence

- Add server-side repository functions for listing workspace data.
- Add server actions for onboarding, creating bank accounts, creating clients,
  creating invoices, and updating invoices.
- Add BetterAuth sign-up, sign-in, sign-out, and session handling.
- Scope all workspace reads and writes to the signed-in user.
- Promote the first registered user to admin.
- Add admin-only registration mode controls.
- Add an admin-only user list.
- Make the app tolerate an empty database.
- Keep production startup limited to `prisma migrate deploy` and `next start`.

### Phase 3: User Interface

- Replace the metadata placeholder home page with the invoice workspace.
- Add sign-in and sign-up screens.
- Add password reset screens using BetterAuth's flow.
- Add onboarding state for empty databases.
- Add profile, bank, client, and invoice panels.
- Add admin settings with registration mode and user list.
- Add invoice list and latest invoice preview.
- Add invoice detail/edit route after the dashboard works.
- Use the time-based dashboard grouping for the first version.

### Phase 4: Import, Export, and PDF

- Keep seed data for local development only.
- Add JSON export for a signed-in user's workspace.
- Add JSON import with validation and error reporting.
- Add browser print support.
- Add downloadable PDF generation.

### Phase 5: Verification

- Run `npm run db:generate`.
- Run `npx prisma validate`.
- Run `npm run lint`.
- Run `npm run build`.
- Start the app locally and check desktop/mobile layouts.

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

Open:

- No product questions remain for the MVP requirements draft.

## Current Repository Note

Implementation started before this document request and then stopped. The
working tree may contain partial Prisma and server-action files. Treat those as
draft implementation artifacts until this requirements document is confirmed.

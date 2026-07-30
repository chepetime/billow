---
name: data-classification
description: Keep Billow's database data classification current. Use when adding or changing a Prisma model or field, introducing persisted data, changing logs, exports, backups, uploads, or deciding a field-level encryption boundary.
---

# Classifying Billow data

Read `apps/docs/content/docs/data-classification.mdx` and the relevant Prisma
schema before changing persisted data. Treat the documentation as a required
part of the change, not an after-the-fact audit.

## Workflow

1. Identify every new or materially changed stored field, including JSON,
   filenames, metadata, derived records, logs, backup payloads, and file bytes.
2. Classify the model and fields as public, internal, or sensitive using the
   definitions in the data-classification page. A model is sensitive when any
   field is sensitive.
3. Update the inventory and explain the disclosure impact. Do not add a field
   without this update.
4. For sensitive data, review every read/write path: authorization, API
   response, UI, logging, error reporting, backup/restore, and deletion.
5. Decide whether field-level encryption is required. If the answer is no,
   record the reason (for example: uniqueness constraint, lookup before a user
   key exists, or explicit product decision) in the docs or code next to the
   field.
6. Add or update tests that prove sensitive fields are not exposed across users
   or returned from an inappropriate endpoint.

## Billow-specific guardrails

- Never put credentials, tokens, account numbers, tax IDs, addresses, or raw
  user content in logs. `ErrorLog.meta` is internal, but can accidentally carry
  sensitive data.
- A hash of an authentication credential is still sensitive.
- A generated storage key is not public merely because it is opaque; protect
  the associated upload through its owner and authorization checks.
- Backups are an export surface. A user-initiated backup may intentionally be
  plaintext, but this must be stated and access-controlled.
- Field-level encryption protects against a leaked database or storage snapshot,
  not a self-hosted administrator who modifies the running application and
  captures a user's key.
- Do not decide unilaterally whether client names or invoice amounts are
  encrypted. They are sensitive; encryption is a pending product decision
  because it changes list, search, and sort behaviour.

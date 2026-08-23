# Billow

Billow manages invoices from creation through payment and the related tax work.

## Language

**Invoice**:
A billing record sent to a client for goods or services, together with its payment and tax progress.

**Invoice ID**:
An opaque, stable identifier used to reference an invoice inside Billow. It is distinct from the invoice number and is never chosen by the user.
_Avoid_: Invoice number, database ID

**Invoice number**:
The user-controlled reference printed on an invoice. It is unique within a user's workspace and may follow a predictable sequence.
_Avoid_: Invoice ID

**Invoice progress**:
The dated facts that record when an invoice was sent, approved, paid, and issued as a fiscal invoice. Each fact can be corrected independently because it records what happened, not merely a position in a sequence.
_Avoid_: Workflow status, tax filing

**Approval**:
The client's acceptance of an invoice, recorded separately from delivery and payment.

**Fiscal invoice (CFDI)**:
The tax-authorized invoice issued for a billing invoice, consisting of an authoritative XML document and a human-readable PDF rendering.
_Avoid_: Tax receipt

**Monthly tax filing**:
The record for one calendar month's tax return and payment, shared by all invoices in that period rather than owned by one invoice.
_Avoid_: Invoice tax status, monthly tax report

**Tax return**:
The declaration document submitted as part of a monthly tax filing.

**Payment confirmation**:
The document proving that the amount due for a monthly tax filing was paid.

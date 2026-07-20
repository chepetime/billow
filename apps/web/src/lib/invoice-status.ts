import {
  InvoiceStatus,
  type InvoiceStatus as InvoiceStatusValue,
} from "@/generated/prisma/enums";

export function parseInvoiceStatus(value: string | null | undefined) {
  const status = value?.trim() || InvoiceStatus.DRAFT;
  if (Object.values(InvoiceStatus).includes(status as InvoiceStatusValue)) {
    return status as InvoiceStatusValue;
  }

  throw new Error(`Unsupported invoice status: ${status}`);
}

import { InvoiceStatus } from "@billow/db/enums";
import { Badge, badgeVariants } from "@billow/shadcn/components/badge";
import { invoiceStatusLabel, isScheduledInvoice } from "@/lib/invoice-status";

export { Badge, badgeVariants };

const invoiceStatusBadgeVariant: Record<
  InvoiceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  [InvoiceStatus.DRAFT]: "secondary",
  [InvoiceStatus.SENT]: "outline",
  [InvoiceStatus.APPROVED]: "outline",
  [InvoiceStatus.PAID]: "default",
  [InvoiceStatus.TAX_RECEIPT]: "default",
  [InvoiceStatus.TAX_RETURN]: "default",
  [InvoiceStatus.DONE]: "default",
  [InvoiceStatus.VOID]: "destructive",
};

/**
 * `sentAt` is optional so a caller with only a status still renders. Pass it
 * wherever the date is at hand: an invoice whose send date is still ahead
 * reads as "Scheduled", muted like a draft, because it has not gone out yet.
 */
export function InvoiceStatusBadge({
  status,
  sentAt,
}: {
  status: InvoiceStatus;
  sentAt?: Date | string | null;
}) {
  const scheduled = isScheduledInvoice(status, sentAt ?? null);

  return (
    <Badge
      variant={scheduled ? "secondary" : invoiceStatusBadgeVariant[status]}
    >
      {scheduled ? "Scheduled" : invoiceStatusLabel(status)}
    </Badge>
  );
}

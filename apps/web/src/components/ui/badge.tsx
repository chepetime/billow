import { InvoiceStatus } from "@billow/db/enums";
import { Badge, badgeVariants } from "@billow/shadcn/components/badge";
import { invoiceStatusLabel } from "@/lib/invoice-status";

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

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={invoiceStatusBadgeVariant[status]}>
      {invoiceStatusLabel(status)}
    </Badge>
  );
}

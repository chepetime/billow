import { InvoiceStatus } from "@billow/db/enums";
import { Badge, badgeVariants } from "@billow/shadcn/components/badge";

export { Badge, badgeVariants };

const invoiceStatusBadgeVariant: Record<
  InvoiceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  [InvoiceStatus.DRAFT]: "secondary",
  [InvoiceStatus.SENT]: "outline",
  [InvoiceStatus.PAID]: "default",
  [InvoiceStatus.VOID]: "destructive",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={invoiceStatusBadgeVariant[status]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

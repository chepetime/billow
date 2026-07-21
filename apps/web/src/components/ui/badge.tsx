import { cva, type VariantProps } from "class-variance-authority"

import { InvoiceStatus } from "@billow/db/enums"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        destructive: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
}

const invoiceStatusBadgeVariant: Record<
  InvoiceStatus,
  VariantProps<typeof badgeVariants>["variant"]
> = {
  [InvoiceStatus.DRAFT]: "secondary",
  [InvoiceStatus.SENT]: "outline",
  [InvoiceStatus.PAID]: "default",
  [InvoiceStatus.VOID]: "destructive",
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={invoiceStatusBadgeVariant[status]}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  )
}

export { Badge, badgeVariants, InvoiceStatusBadge }

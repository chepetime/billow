import { RiLoaderLine } from "@remixicon/react";
import { cn } from "#lib/utils";

// `children` is omitted because @remixicon/react types it as `undefined`,
// and spreading svg props that admit children onto one fails to compile. A
// spinner has no children to pass, so the narrower type costs nothing.
function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "children">) {
  return (
    <RiLoaderLine
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };

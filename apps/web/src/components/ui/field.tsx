import {
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@billow/shadcn/components/field";
import { Label } from "@billow/shadcn/components/label";
import { cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

export {
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
};

/**
 * Billow's form-field adapter. It preserves the app's compact form API while
 * the shadcn field primitives remain unmodified in @billow/shadcn.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined;

  // aria-describedby has to sit on the control itself. A screen reader
  // announces the description of the *focused* element, so pointing a wrapper
  // <div> at the error text described nothing to nobody -- every validation
  // message in the app was silent. Clone it onto the child instead, merging
  // rather than clobbering any value the caller already set.
  const described =
    describedBy && isValidElement<{ "aria-describedby"?: string }>(children)
      ? cloneElement(children, {
          "aria-describedby": [children.props["aria-describedby"], describedBy]
            .filter(Boolean)
            .join(" "),
        })
      : children;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div>{described}</div>
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

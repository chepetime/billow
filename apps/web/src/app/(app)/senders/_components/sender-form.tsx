"use client";

import { Button } from "@billow/shadcn/components/button";
import { Input } from "@billow/shadcn/components/input";
import { Textarea } from "@billow/shadcn/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { DeleteRecordButton } from "@/app/(app)/_components/delete-record-button";
import { Field } from "@/components/ui/field";
import {
  createSenderProfile,
  deleteSenderProfile,
  updateSenderProfile,
} from "@/lib/actions/senders";
import { notifySuccess } from "@/lib/notify";
import {
  type SenderProfileFormValues,
  type SenderProfileInput,
  senderProfileSchema,
} from "@/lib/schemas/workspace";

const EMPTY: SenderProfileFormValues = {
  displayName: "",
  legalName: "",
  email: "",
  address: "",
  taxId: "",
  department: "",
  manager: "",
};

export function SenderForm({
  id,
  defaultValues,
}: {
  id?: number;
  defaultValues?: SenderProfileFormValues;
}) {
  const router = useRouter();
  const [requestError, setRequestError] = useState<string | null>(null);

  // The third generic is the schema's *output*: optional text has become null
  // by the time `save` sees it, which is what the action takes.
  const form = useForm<SenderProfileFormValues, unknown, SenderProfileInput>({
    resolver: zodResolver(senderProfileSchema),
    defaultValues: defaultValues ?? EMPTY,
  });

  async function save(values: SenderProfileInput) {
    setRequestError(null);

    const result = id
      ? await updateSenderProfile(id, values)
      : await createSenderProfile(values);

    if (!result.ok) {
      setRequestError(result.error);
      return;
    }

    notifySuccess(id ? "Sender profile saved" : "Sender profile added");
    router.push("/senders");
    router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(save)} noValidate>
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <Field
          label="Display name"
          htmlFor="displayName"
          hint="Shown as the sender on the invoice."
          error={form.formState.errors.displayName?.message}
        >
          <Input
            id="displayName"
            aria-invalid={Boolean(form.formState.errors.displayName)}
            {...form.register("displayName")}
          />
        </Field>

        <Field
          label="Legal name"
          htmlFor="legalName"
          error={form.formState.errors.legalName?.message}
        >
          <Input
            id="legalName"
            aria-invalid={Boolean(form.formState.errors.legalName)}
            {...form.register("legalName")}
          />
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          error={form.formState.errors.email?.message}
        >
          <Input
            id="email"
            type="email"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register("email")}
          />
        </Field>

        <Field
          label="Address"
          htmlFor="address"
          error={form.formState.errors.address?.message}
        >
          <Textarea
            id="address"
            rows={3}
            aria-invalid={Boolean(form.formState.errors.address)}
            {...form.register("address")}
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Optional</h2>
          <p className="text-sm text-muted-foreground">
            Printed on the invoice when set.
          </p>
        </div>

        <Field
          label="Tax ID"
          htmlFor="taxId"
          hint="Encrypted at rest."
          error={form.formState.errors.taxId?.message}
        >
          <Input id="taxId" {...form.register("taxId")} />
        </Field>

        <Field
          label="Department"
          htmlFor="department"
          error={form.formState.errors.department?.message}
        >
          <Input id="department" {...form.register("department")} />
        </Field>

        <Field
          label="Manager"
          htmlFor="manager"
          error={form.formState.errors.manager?.message}
        >
          <Input id="manager" {...form.register("manager")} />
        </Field>
      </section>

      {requestError && (
        <p role="alert" className="text-sm text-destructive">
          {requestError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving..." : "Save profile"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/senders")}
        >
          Cancel
        </Button>
        {id !== undefined && (
          <div className="ml-auto">
            <DeleteRecordButton
              label="Delete profile"
              successMessage="Sender profile deleted"
              redirectTo="/senders"
              onDelete={() => deleteSenderProfile(id)}
            />
          </div>
        )}
      </div>
    </form>
  );
}

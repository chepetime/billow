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
  createClientCompany,
  deleteClientCompany,
  updateClientCompany,
} from "@/lib/actions/clients";
import { notifySuccess } from "@/lib/notify";
import {
  type ClientCompanyFormValues,
  type ClientCompanyInput,
  clientCompanySchema,
} from "@/lib/schemas/workspace";

const EMPTY: ClientCompanyFormValues = {
  name: "",
  legalName: "",
  address1: "",
  address2: "",
  cityStatePostal: "",
  country: "",
  email: "",
  attentionTo: "",
  notes: "",
};

export function ClientForm({
  id,
  defaultValues,
}: {
  id?: number;
  defaultValues?: ClientCompanyFormValues;
}) {
  const router = useRouter();
  const [requestError, setRequestError] = useState<string | null>(null);

  const form = useForm<ClientCompanyFormValues, unknown, ClientCompanyInput>({
    resolver: zodResolver(clientCompanySchema),
    defaultValues: defaultValues ?? EMPTY,
  });

  async function save(values: ClientCompanyInput) {
    setRequestError(null);

    const result = id
      ? await updateClientCompany(id, values)
      : await createClientCompany(values);

    if (!result.ok) {
      setRequestError(result.error);
      return;
    }

    notifySuccess(id ? "Client saved" : "Client added");
    router.push("/clients");
    router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(save)} noValidate>
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <Field
          label="Company name"
          htmlFor="name"
          error={form.formState.errors.name?.message}
        >
          <Input
            id="name"
            aria-invalid={Boolean(form.formState.errors.name)}
            {...form.register("name")}
          />
        </Field>

        <Field
          label="Legal name"
          htmlFor="legalName"
          hint="Optional. Used when it differs from the trading name."
          error={form.formState.errors.legalName?.message}
        >
          <Input id="legalName" {...form.register("legalName")} />
        </Field>

        <Field
          label="Billing email"
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
          label="Attention to"
          htmlFor="attentionTo"
          hint="Optional. For example, Accounts Payable."
          error={form.formState.errors.attentionTo?.message}
        >
          <Input id="attentionTo" {...form.register("attentionTo")} />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="text-base font-semibold">Billing address</h2>

        <Field
          label="Address line 1"
          htmlFor="address1"
          error={form.formState.errors.address1?.message}
        >
          <Input
            id="address1"
            aria-invalid={Boolean(form.formState.errors.address1)}
            {...form.register("address1")}
          />
        </Field>

        <Field
          label="Address line 2"
          htmlFor="address2"
          error={form.formState.errors.address2?.message}
        >
          <Input id="address2" {...form.register("address2")} />
        </Field>

        <Field
          label="City, state, postal code"
          htmlFor="cityStatePostal"
          error={form.formState.errors.cityStatePostal?.message}
        >
          <Input
            id="cityStatePostal"
            aria-invalid={Boolean(form.formState.errors.cityStatePostal)}
            {...form.register("cityStatePostal")}
          />
        </Field>

        <Field
          label="Country"
          htmlFor="country"
          error={form.formState.errors.country?.message}
        >
          <Input
            id="country"
            aria-invalid={Boolean(form.formState.errors.country)}
            {...form.register("country")}
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <Field
          label="Notes"
          htmlFor="notes"
          hint="Only for you. Never printed on an invoice."
          error={form.formState.errors.notes?.message}
        >
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </Field>
      </section>

      {requestError && (
        <p role="alert" className="text-sm text-destructive">
          {requestError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving..." : "Save client"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/clients")}
        >
          Cancel
        </Button>
        {id !== undefined && (
          <div className="ml-auto">
            <DeleteRecordButton
              label="Delete client"
              successMessage="Client deleted"
              redirectTo="/clients"
              onDelete={() => deleteClientCompany(id)}
            />
          </div>
        )}
      </div>
    </form>
  );
}

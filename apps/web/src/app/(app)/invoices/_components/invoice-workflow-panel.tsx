"use client";

import type { InvoiceStatus } from "@billow/db/enums";
import { Button } from "@billow/shadcn/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@billow/shadcn/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@billow/shadcn/components/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@billow/shadcn/components/field";
import { Input } from "@billow/shadcn/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@billow/shadcn/components/item";
import {
  NativeSelect,
  NativeSelectOption,
} from "@billow/shadcn/components/native-select";
import { Spinner } from "@billow/shadcn/components/spinner";
import {
  RiCheckLine,
  RiDownloadLine,
  RiFileCodeLine,
  RiFileList3Line,
  RiMailSendLine,
  RiMoneyDollarCircleLine,
  RiSecurePaymentLine,
} from "@billow/shadcn/icons";
import { useRouter } from "next/navigation";
import type { ElementType, FormEvent, ReactNode } from "react";
import { useState } from "react";

import { InvoiceStatusBadge } from "@/components/ui/badge";
import { updateInvoiceWorkflow } from "@/lib/actions/invoice-workflow";
import { toDateInputValue } from "@/lib/date-only";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { InvoiceWorkflowCommand } from "@/lib/schemas/invoice-workflow";
import { formatBytes, type UploadResponse } from "@/lib/schemas/uploads";
import { CURRENCIES } from "@/lib/schemas/workspace";
import { cn } from "@/lib/utils";

export type WorkflowDocument = {
  kind: string;
  upload: Pick<
    UploadResponse,
    "id" | "filename" | "contentType" | "size" | "createdAt"
  >;
};

export type InvoiceWorkflowView = {
  id: string;
  status: InvoiceStatus;
  sentOn: string | null;
  approvedOn: string | null;
  paidOn: string | null;
  cfdiIssuedOn: string | null;
  documents: WorkflowDocument[];
};

export type TaxPeriodWorkflowView = {
  label: string;
  filedOn: string | null;
  paidOn: string | null;
  amountPaid: number | null;
  currency: string;
  documents: WorkflowDocument[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDateOnly(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function today() {
  return toDateInputValue(new Date());
}

function findDocument(documents: WorkflowDocument[], kind: string) {
  return documents.find((document) => document.kind === kind) ?? null;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "Could not save the file.";
}

async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/v1/uploads", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as UploadResponse;
}

async function deleteUploads(ids: string[]) {
  await Promise.allSettled(
    ids.map((id) =>
      fetch(`/api/v1/uploads/${id}`, {
        method: "DELETE",
      }),
    ),
  );
}

async function saveWorkflow(command: InvoiceWorkflowCommand) {
  const result = await updateInvoiceWorkflow(command);
  if (!result.ok) {
    throw new Error(result.error);
  }
}

function DocumentLink({ document }: { document: WorkflowDocument }) {
  return (
    <a
      href={`/api/v1/uploads/${document.upload.id}`}
      download={document.upload.filename}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4"
    >
      <RiDownloadLine aria-hidden="true" className="shrink-0" />
      <span className="truncate">
        {document.upload.filename} · {formatBytes(document.upload.size)}
      </span>
    </a>
  );
}

function ProgressItem({
  complete,
  icon: Icon,
  title,
  description,
  documents,
  action,
}: {
  complete: boolean;
  icon: ElementType;
  title: string;
  description: string;
  documents?: WorkflowDocument[];
  action: ReactNode;
}) {
  return (
    <Item role="listitem" variant={complete ? "muted" : "outline"}>
      <ItemMedia variant="icon">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-full",
            complete
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {complete ? (
            <RiCheckLine aria-hidden="true" />
          ) : (
            <Icon aria-hidden="true" />
          )}
        </span>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
        {documents && documents.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {documents.map((document) => (
              <DocumentLink key={document.kind} document={document} />
            ))}
          </div>
        )}
      </ItemContent>
      <ItemActions>{action}</ItemActions>
    </Item>
  );
}

type Milestone = "sentAt" | "approvedAt" | "paidAt";

function MilestoneEditor({
  invoiceId,
  milestone,
  label,
  currentDate,
}: {
  invoiceId: string;
  milestone: Milestone;
  label: string;
  currentDate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [date, setDate] = useState(currentDate ?? today());

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setDate(currentDate ?? today());
    setOpen(nextOpen);
  }

  async function submit(date: string | null) {
    setPending(true);
    try {
      await saveWorkflow({ type: "milestone", invoiceId, milestone, date });
      notifySuccess(date ? `${label} date saved` : `${label} date cleared`);
      changeOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        `${label} date not saved`,
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(date);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button
        type="button"
        variant={currentDate ? "ghost" : "outline"}
        onClick={() => changeOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${currentDate ? "Edit" : "Record"} ${label.toLowerCase()} date`}
        className="min-h-11"
      >
        {currentDate ? "Edit" : "Record"}
      </Button>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{label} date</DialogTitle>
            <DialogDescription>
              Record the actual business date. You can edit it later without
              changing the other steps.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${milestone}-date`}>Date</FieldLabel>
              <Input
                id={`${milestone}-date`}
                name="date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.currentTarget.value)}
                required
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            {currentDate && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => void submit(null)}
                className="min-h-11"
              >
                Clear date
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
              className="min-h-11"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Saving..." : "Save date"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CfdiEditor({
  invoiceId,
  issuedOn,
  xml,
  pdf,
}: {
  invoiceId: string;
  issuedOn: string | null;
  xml: WorkflowDocument | null;
  pdf: WorkflowDocument | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [issuedDate, setIssuedDate] = useState(issuedOn ?? today());

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setIssuedDate(issuedOn ?? today());
    setOpen(nextOpen);
    if (!nextOpen) setConfirmingClear(false);
  }

  async function clearCfdi() {
    setPending(true);
    try {
      await saveWorkflow({ type: "clear-cfdi", invoiceId });
      notifySuccess("Fiscal invoice cleared");
      changeOpen(false);
      router.refresh();
    } catch (error) {
      notifyError(
        "Fiscal invoice not cleared",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const xmlFile = form.get("xml");
    const pdfFile = form.get("pdf");
    const uploadedIds: string[] = [];

    try {
      const uploadedXml =
        xmlFile instanceof File && xmlFile.size > 0
          ? await uploadFile(xmlFile)
          : null;
      if (uploadedXml) uploadedIds.push(uploadedXml.id);
      const uploadedPdf =
        pdfFile instanceof File && pdfFile.size > 0
          ? await uploadFile(pdfFile)
          : null;
      if (uploadedPdf) uploadedIds.push(uploadedPdf.id);

      await saveWorkflow({
        type: "cfdi",
        invoiceId,
        issuedOn: String(form.get("issuedOn") ?? ""),
        xmlUploadId: uploadedXml?.id,
        pdfUploadId: uploadedPdf?.id,
      });
      notifySuccess("Fiscal invoice saved");
      changeOpen(false);
      router.refresh();
    } catch (error) {
      await deleteUploads(uploadedIds);
      notifyError(
        "Fiscal invoice not saved",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button
        type="button"
        variant={issuedOn || xml || pdf ? "ghost" : "outline"}
        onClick={() => changeOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${issuedOn || xml || pdf ? "Edit" : "Record"} fiscal invoice (CFDI)`}
        className="min-h-11"
      >
        {issuedOn || xml || pdf ? "Edit" : "Record"}
      </Button>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Fiscal invoice (CFDI)</DialogTitle>
            <DialogDescription>
              Record when it was issued and attach both files returned by your
              accountant. The XML is authoritative; the PDF is the readable
              copy.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cfdi-issued-on">Issued date</FieldLabel>
              <Input
                id="cfdi-issued-on"
                name="issuedOn"
                type="date"
                value={issuedDate}
                onChange={(event) => setIssuedDate(event.currentTarget.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cfdi-xml">CFDI XML</FieldLabel>
              <Input
                id="cfdi-xml"
                name="xml"
                type="file"
                accept=".xml,application/xml,text/xml"
                required={!xml}
              />
              <FieldDescription>
                {xml
                  ? `Current: ${xml.upload.filename}`
                  : "Required to complete the CFDI step."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cfdi-pdf">CFDI PDF</FieldLabel>
              <Input
                id="cfdi-pdf"
                name="pdf"
                type="file"
                accept=".pdf,application/pdf"
                required={!pdf}
              />
              <FieldDescription>
                {pdf
                  ? `Current: ${pdf.upload.filename}`
                  : "Required to complete the CFDI step."}
              </FieldDescription>
            </Field>
          </FieldGroup>
          {confirmingClear && (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            >
              This removes the CFDI date, XML, and PDF. The invoice status will
              move back to its latest remaining milestone.
            </div>
          )}
          <DialogFooter>
            {confirmingClear ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirmingClear(false)}
                  className="min-h-11"
                >
                  Keep CFDI
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void clearCfdi()}
                  className="min-h-11"
                >
                  {pending && <Spinner data-icon="inline-start" />}
                  {pending ? "Clearing..." : "Yes, clear CFDI"}
                </Button>
              </>
            ) : (
              <>
                {(issuedOn || xml || pdf) && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirmingClear(true)}
                    className="min-h-11 text-destructive hover:text-destructive"
                  >
                    Clear CFDI
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => changeOpen(false)}
                  className="min-h-11"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending} className="min-h-11">
                  {pending && <Spinner data-icon="inline-start" />}
                  {pending ? "Saving..." : "Save CFDI"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaxFilingEditor({
  invoiceId,
  filedOn,
  taxReturn,
}: {
  invoiceId: string;
  filedOn: string | null;
  taxReturn: WorkflowDocument | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [filingDate, setFilingDate] = useState(filedOn ?? today());

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) setFilingDate(filedOn ?? today());
    setOpen(nextOpen);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const file = form.get("return");
    const uploadedIds: string[] = [];
    try {
      const uploaded =
        file instanceof File && file.size > 0 ? await uploadFile(file) : null;
      if (uploaded) uploadedIds.push(uploaded.id);
      await saveWorkflow({
        type: "tax-filing",
        invoiceId,
        filedOn: String(form.get("filedOn") ?? ""),
        returnUploadId: uploaded?.id,
      });
      notifySuccess("Monthly tax filing saved");
      changeOpen(false);
      router.refresh();
    } catch (error) {
      await deleteUploads(uploadedIds);
      notifyError(
        "Monthly tax filing not saved",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button
        type="button"
        variant={filedOn || taxReturn ? "ghost" : "outline"}
        onClick={() => changeOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${filedOn || taxReturn ? "Edit" : "Record"} monthly tax return`}
        className="min-h-11"
      >
        {filedOn || taxReturn ? "Edit" : "Record"}
      </Button>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Monthly tax return</DialogTitle>
            <DialogDescription>
              Record when the monthly return was filed and attach the filed
              declaration PDF.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tax-filed-on">Filing date</FieldLabel>
              <Input
                id="tax-filed-on"
                name="filedOn"
                type="date"
                value={filingDate}
                onChange={(event) => setFilingDate(event.currentTarget.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tax-return-file">Tax return PDF</FieldLabel>
              <Input
                id="tax-return-file"
                name="return"
                type="file"
                accept=".pdf,application/pdf"
                required={!taxReturn}
              />
              {taxReturn && (
                <FieldDescription>
                  Current: {taxReturn.upload.filename}
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
              className="min-h-11"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Saving..." : "Save filing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaxPaymentEditor({
  invoiceId,
  paidOn,
  amountPaid,
  currency,
  confirmation,
}: {
  invoiceId: string;
  paidOn: string | null;
  amountPaid: number | null;
  currency: string;
  confirmation: WorkflowDocument | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [amount, setAmount] = useState(
    amountPaid === null ? "" : String(amountPaid),
  );
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [paymentDate, setPaymentDate] = useState(paidOn ?? today());

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      setAmount(amountPaid === null ? "" : String(amountPaid));
      setSelectedCurrency(currency);
      setPaymentDate(paidOn ?? today());
    }
    setOpen(nextOpen);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const file = form.get("confirmation");
    const uploadedIds: string[] = [];
    try {
      const uploaded =
        file instanceof File && file.size > 0 ? await uploadFile(file) : null;
      if (uploaded) uploadedIds.push(uploaded.id);
      await saveWorkflow({
        type: "tax-payment",
        invoiceId,
        paidOn: String(form.get("paidOn") ?? ""),
        amountPaid: String(form.get("amountPaid") ?? ""),
        currency: String(
          form.get("currency") ?? "MXN",
        ) as (typeof CURRENCIES)[number],
        confirmationUploadId: uploaded?.id,
      });
      notifySuccess("Tax payment saved");
      changeOpen(false);
      router.refresh();
    } catch (error) {
      await deleteUploads(uploadedIds);
      notifyError(
        "Tax payment not saved",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button
        type="button"
        variant={paidOn || confirmation ? "ghost" : "outline"}
        onClick={() => changeOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${paidOn || confirmation ? "Edit" : "Record"} monthly tax payment`}
        className="min-h-11"
      >
        {paidOn || confirmation ? "Edit" : "Record"}
      </Button>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Monthly tax payment</DialogTitle>
            <DialogDescription>
              Record the total amount paid, payment date, and confirmation
              supplied by the tax authority or bank.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="tax-amount-paid">Amount paid</FieldLabel>
                <Input
                  id="tax-amount-paid"
                  name="amountPaid"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.currentTarget.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tax-currency">Currency</FieldLabel>
                <NativeSelect
                  id="tax-currency"
                  name="currency"
                  value={selectedCurrency}
                  onChange={(event) =>
                    setSelectedCurrency(event.currentTarget.value)
                  }
                >
                  {CURRENCIES.map((code) => (
                    <NativeSelectOption key={code} value={code}>
                      {code}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="tax-paid-on">Payment date</FieldLabel>
              <Input
                id="tax-paid-on"
                name="paidOn"
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.currentTarget.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tax-payment-confirmation">
                Payment confirmation
              </FieldLabel>
              <Input
                id="tax-payment-confirmation"
                name="confirmation"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                required={!confirmation}
              />
              {confirmation && (
                <FieldDescription>
                  Current: {confirmation.upload.filename}
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
              className="min-h-11"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending && <Spinner data-icon="inline-start" />}
              {pending ? "Saving..." : "Save payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceWorkflowPanel({
  invoice,
  taxPeriod,
}: {
  invoice: InvoiceWorkflowView;
  taxPeriod: TaxPeriodWorkflowView;
}) {
  const xml = findDocument(invoice.documents, "CFDI_XML");
  const pdf = findDocument(invoice.documents, "CFDI_PDF");
  const taxReturn = findDocument(taxPeriod.documents, "TAX_RETURN");
  const paymentConfirmation = findDocument(
    taxPeriod.documents,
    "PAYMENT_CONFIRMATION",
  );
  const cfdiComplete = Boolean(invoice.cfdiIssuedOn && xml && pdf);
  const filingComplete = Boolean(taxPeriod.filedOn && taxReturn);
  const paymentComplete = Boolean(
    taxPeriod.paidOn && taxPeriod.amountPaid !== null && paymentConfirmation,
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)] print:hidden">
      <Card>
        <CardHeader>
          <CardTitle>Invoice progress</CardTitle>
          <CardDescription>
            Record what happened and when. Every date remains independently
            editable.
          </CardDescription>
          <CardAction>
            <InvoiceStatusBadge status={invoice.status} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-2.5">
            <ProgressItem
              complete={Boolean(invoice.sentOn)}
              icon={RiMailSendLine}
              title="Sent to client"
              description={
                invoice.sentOn
                  ? `Sent ${formatDateOnly(invoice.sentOn)}`
                  : "Record when the invoice left your hands."
              }
              action={
                <MilestoneEditor
                  invoiceId={invoice.id}
                  milestone="sentAt"
                  label="Sent"
                  currentDate={invoice.sentOn}
                />
              }
            />
            <ProgressItem
              complete={Boolean(invoice.approvedOn)}
              icon={RiCheckLine}
              title="Approved by client"
              description={
                invoice.approvedOn
                  ? `Approved ${formatDateOnly(invoice.approvedOn)}`
                  : "Record the client's acceptance separately from payment."
              }
              action={
                <MilestoneEditor
                  invoiceId={invoice.id}
                  milestone="approvedAt"
                  label="Approval"
                  currentDate={invoice.approvedOn}
                />
              }
            />
            <ProgressItem
              complete={Boolean(invoice.paidOn)}
              icon={RiMoneyDollarCircleLine}
              title="Payment received"
              description={
                invoice.paidOn
                  ? `Paid ${formatDateOnly(invoice.paidOn)}`
                  : "Record the date the money arrived."
              }
              action={
                <MilestoneEditor
                  invoiceId={invoice.id}
                  milestone="paidAt"
                  label="Payment"
                  currentDate={invoice.paidOn}
                />
              }
            />
            <ProgressItem
              complete={cfdiComplete}
              icon={RiFileCodeLine}
              title="Fiscal invoice (CFDI)"
              description={
                invoice.cfdiIssuedOn
                  ? `${cfdiComplete ? "Complete" : "In progress"} · issued ${formatDateOnly(invoice.cfdiIssuedOn)}`
                  : "Add the issued date plus the authoritative XML and readable PDF."
              }
              documents={[xml, pdf].filter(
                (document): document is WorkflowDocument => document !== null,
              )}
              action={
                <CfdiEditor
                  invoiceId={invoice.id}
                  issuedOn={invoice.cfdiIssuedOn}
                  xml={xml}
                  pdf={pdf}
                />
              }
            />
          </ItemGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{taxPeriod.label} monthly tax filing</CardTitle>
          <CardDescription>
            This record is shared by every invoice in the month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-2.5">
            <ProgressItem
              complete={filingComplete}
              icon={RiFileList3Line}
              title="Tax return filed"
              description={
                taxPeriod.filedOn
                  ? `${filingComplete ? "Complete" : "Missing return PDF"} · filed ${formatDateOnly(taxPeriod.filedOn)}`
                  : "Record the filing date and attach the filed return."
              }
              documents={taxReturn ? [taxReturn] : []}
              action={
                <TaxFilingEditor
                  invoiceId={invoice.id}
                  filedOn={taxPeriod.filedOn}
                  taxReturn={taxReturn}
                />
              }
            />
            <ProgressItem
              complete={paymentComplete}
              icon={RiSecurePaymentLine}
              title="Tax payment confirmed"
              description={
                taxPeriod.paidOn && taxPeriod.amountPaid !== null
                  ? `${taxPeriod.currency} ${taxPeriod.amountPaid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · paid ${formatDateOnly(taxPeriod.paidOn)}`
                  : "Record the amount, payment date, and confirmation file."
              }
              documents={paymentConfirmation ? [paymentConfirmation] : []}
              action={
                <TaxPaymentEditor
                  invoiceId={invoice.id}
                  paidOn={taxPeriod.paidOn}
                  amountPaid={taxPeriod.amountPaid}
                  currency={taxPeriod.currency}
                  confirmation={paymentConfirmation}
                />
              }
            />
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
  );
}

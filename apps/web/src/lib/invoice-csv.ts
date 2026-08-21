const COLUMNS = [
  "Invoice Number",
  "Date",
  "Client",
  "Currency",
  "Status",
  "Total",
];

export type InvoiceCsvRow = {
  invoiceNumber: number;
  invoiceDate: Date;
  clientName: string;
  currency: string;
  status: string;
  total: number;
};

/**
 * Quotes a field per RFC 4180: only when it contains the delimiter, a quote,
 * or a newline, since a client name is free text a user typed and can hold
 * any of the three. An embedded quote is doubled, the standard's own escape.
 */
function csvField(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * A row per invoice, formatted for a spreadsheet or accounting tool rather
 * than for the screen: `YYYY-MM-DD` dates and a bare decimal total, not the
 * localized `formatInvoiceDate`/`formatCurrency` strings the UI uses — both
 * of those are meant to be read, not parsed, and a thousands separator or a
 * currency code glued to the number breaks numeric import.
 */
export function invoicesToCsv(rows: InvoiceCsvRow[]): string {
  const lines = [COLUMNS.join(",")];

  for (const row of rows) {
    const status = row.status.charAt(0) + row.status.slice(1).toLowerCase();

    lines.push(
      [
        String(row.invoiceNumber),
        row.invoiceDate.toISOString().slice(0, 10),
        csvField(row.clientName),
        row.currency,
        status,
        row.total.toFixed(2),
      ].join(","),
    );
  }

  // Trailing CRLF: RFC 4180 line endings, and the byte a spreadsheet app
  // expects to see closing the last row rather than an unterminated line.
  return `${lines.join("\r\n")}\r\n`;
}

import { Toaster } from "@billow/shadcn/components/toast";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { cn } from "@billow/shadcn/lib/utils";
import { Geist_Mono, Noto_Sans } from "next/font/google";

const notoSansHeading = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
});

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  // Every page below sets a bare title ("Invoices") and gets "Invoices ·
  // Billow" from the template. The one deliberate exception is the invoice
  // page, which prints: it sets `title.absolute` so the suffix stays out of
  // the PDF filename the browser derives from the title.
  title: {
    default: "Billow",
    template: "%s · Billow",
  },
  description:
    "A self-hosted app starter built on Next.js, React, Prisma, Postgres and better-auth.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolved per request from the NEXT_LOCALE cookie (see src/i18n/request.ts)
  // and used for <html lang>, so assistive technology and browser translation
  // see the language actually being rendered rather than a hardcoded "en".
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={cn(
        "h-full antialiased",
        "font-mono",
        geistMono.variable,
        notoSansHeading.variable,
      )}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <ThemeProvider>
            <Toaster>{children}</Toaster>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

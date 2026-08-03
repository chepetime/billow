import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Toaster } from "@billow/shadcn/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billow",
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
    <html lang={locale} className="h-full antialiased" suppressHydrationWarning>
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

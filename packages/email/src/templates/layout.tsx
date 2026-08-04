import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";
import type { ReactNode } from "react";

/**
 * Shared shell for every message.
 *
 * Styles are inline objects rather than Tailwind: mail clients strip <style>
 * blocks and support for class-based CSS is inconsistent, so inline is the
 * only reliably rendered form. Colours are fixed light values on purpose —
 * the app's dark theme does not follow the message into someone's inbox.
 */

const styles = {
  body: {
    backgroundColor: "#f6f7f9",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: 0,
    padding: "32px 0",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "520px",
    padding: "32px",
  },
  heading: {
    color: "#111827",
    fontSize: "20px",
    fontWeight: 600,
    margin: "0 0 16px",
  },
  footer: {
    color: "#6b7280",
    fontSize: "12px",
    lineHeight: "18px",
    margin: 0,
  },
  hr: {
    border: "none",
    borderTop: "1px solid #e5e7eb",
    margin: "28px 0 20px",
  },
} as const;

export interface EmailLayoutProps {
  preview: string;
  heading: string;
  appName: string;
  children: ReactNode;
}

export function EmailLayout({
  preview,
  heading,
  appName,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.heading}>{heading}</Text>
          <Section>{children}</Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Sent by {appName}, a self-hosted app. If you were not expecting this
            message you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const sharedStyles = {
  paragraph: {
    color: "#374151",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 16px",
  },
  button: {
    backgroundColor: "#111827",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600,
    padding: "11px 20px",
    textDecoration: "none",
  },
  fallbackLabel: {
    color: "#6b7280",
    fontSize: "12px",
    margin: "20px 0 4px",
  },
  fallbackLink: {
    color: "#2563eb",
    fontSize: "12px",
    margin: 0,
    wordBreak: "break-all" as const,
  },
} as const;

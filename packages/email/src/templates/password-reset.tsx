import { Button, Text } from "react-email";

import { EmailLayout, sharedStyles } from "./layout";

export interface PasswordResetEmailProps {
  appName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export function PasswordResetEmail({
  appName,
  resetUrl,
  expiresInMinutes,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout
      preview={`Reset your ${appName} password`}
      heading="Reset your password"
      appName={appName}
    >
      <Text style={sharedStyles.paragraph}>
        Someone asked to reset the password for your {appName} account. Choose a
        new one using the link below. It expires in {expiresInMinutes} minutes
        and can only be used once.
      </Text>

      <Button style={sharedStyles.button} href={resetUrl}>
        Choose a new password
      </Button>

      <Text style={sharedStyles.fallbackLabel}>
        Or paste this address into your browser:
      </Text>
      <Text style={sharedStyles.fallbackLink}>{resetUrl}</Text>

      <Text style={{ ...sharedStyles.paragraph, margin: "20px 0 0" }}>
        If you did not request this, no action is needed — your password stays
        as it is.
      </Text>
    </EmailLayout>
  );
}

/**
 * Plain-text alternative. Not optional: messages sent without one score worse
 * with spam filters, and some clients show nothing at all without it.
 */
export function passwordResetText({
  appName,
  resetUrl,
  expiresInMinutes,
}: PasswordResetEmailProps): string {
  return [
    `Reset your ${appName} password`,
    "",
    `Someone asked to reset the password for your ${appName} account.`,
    `Open the link below to choose a new one. It expires in ${expiresInMinutes} minutes and can only be used once.`,
    "",
    resetUrl,
    "",
    "If you did not request this, no action is needed - your password stays as it is.",
  ].join("\n");
}

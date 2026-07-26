import { Text } from "@react-email/components";

import { EmailLayout, sharedStyles } from "./layout";

export interface TestEmailProps {
  appName: string;
  sentAt: string;
  sentBy: string;
}

export function TestEmail({ appName, sentAt, sentBy }: TestEmailProps) {
  return (
    <EmailLayout
      preview={`${appName} email is working`}
      heading="Email is working"
      appName={appName}
    >
      <Text style={sharedStyles.paragraph}>
        This is a test message from your {appName} installation. Receiving it
        confirms the API key, the sender address, and this server&apos;s
        outbound connection all work.
      </Text>
      <Text style={sharedStyles.paragraph}>
        Requested by {sentBy} at {sentAt}.
      </Text>
    </EmailLayout>
  );
}

export function testEmailText({
  appName,
  sentAt,
  sentBy,
}: TestEmailProps): string {
  return [
    `${appName} email is working`,
    "",
    `This is a test message from your ${appName} installation.`,
    "Receiving it confirms the API key, the sender address, and this server's outbound connection all work.",
    "",
    `Requested by ${sentBy} at ${sentAt}.`,
  ].join("\n");
}

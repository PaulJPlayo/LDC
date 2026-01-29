import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

type NotificationModule = {
  createNotifications: (payload: Array<Record<string, unknown>>) => Promise<unknown>;
};

export default async function sendTestEmail({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  const notificationModule = container.resolve("notification") as unknown as NotificationModule;
  const [toArg, subjectArg] = (args ?? []) as string[];
  const to = toArg || process.env.TEST_EMAIL_TO || "";
  const subject = subjectArg || "LDC Admin Studio test email";

  if (!notificationModule?.createNotifications) {
    logger.error("Notification module is unavailable. Email not sent.");
    return;
  }

  if (!to) {
    throw new Error("Missing recipient email. Pass it as the first arg or set TEST_EMAIL_TO.");
  }

  const sentAt = new Date().toISOString();
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">LDC Admin Studio test email</h2>
      <p style="margin: 0 0 12px;">If you received this email, SendGrid is wired correctly.</p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">Sent at ${sentAt}</p>
    </div>
  `;

  await notificationModule.createNotifications([
    {
      to,
      channel: "email",
      content: {
        subject,
        html,
      },
      data: {
        sent_at: sentAt,
      },
    },
  ]);

  logger.info(`Test email queued for ${to}.`);
}

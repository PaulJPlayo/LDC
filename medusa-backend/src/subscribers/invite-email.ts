import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { UserEvents } from "@medusajs/framework/utils"

type InvitePayload = {
  id?: string
  email?: string
  token?: string
}

const buildInviteEmail = (inviteUrl: string, loginUrl: string) => {
  return {
    subject: "You're invited to LDC Admin Studio",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">You're invited to LDC Admin Studio</h2>
        <p style="margin: 0 0 12px;">
          Click the link below to set your password and activate your account.
        </p>
        <p style="margin: 0 0 16px;">
          <a href="${inviteUrl}" style="color: #6d5b8b; font-weight: 600;">Accept invite</a>
        </p>
        <p style="margin: 0 0 12px;">
          After setting your password, log in here:
          <a href="${loginUrl}" style="color: #6d5b8b;">${loginUrl}</a>
        </p>
        <p style="margin: 0; font-size: 12px; color: #6b7280;">
          If you didn’t request access, you can ignore this email.
        </p>
      </div>
    `,
  }
}

export default async function inviteEmailSubscriber({
  event: { data },
  container,
}: SubscriberArgs<InvitePayload | InvitePayload[]>) {
  const notificationModule = container.resolve("notification") as unknown as {
    createNotifications: (payload: Array<Record<string, unknown>>) => Promise<unknown>
  }
  const logger = container.resolve("logger") as { error: (message: string) => void }

  if (!notificationModule?.createNotifications) {
    logger.error("Notification module is unavailable. Invite email skipped.")
    return
  }

  const invites = Array.isArray(data) ? data : [data]
  const baseUrl = (process.env.ADMIN_INVITE_URL || "https://api.lovettsldc.com/app").replace(
    /\/$/,
    ""
  )
  const loginUrl = process.env.ADMIN_LOGIN_URL || "https://admin.lovettsldc.com"

  const notifications = invites
    .filter((invite) => invite?.email && invite?.token)
    .map((invite) => {
      const inviteUrl = `${baseUrl}/invite?token=${invite.token}`
      const content = buildInviteEmail(inviteUrl, loginUrl)
      return {
        to: invite.email,
        channel: "email",
        idempotency_key: invite.id || invite.email || invite.token,
        content,
        data: {
          invite_url: inviteUrl,
          admin_url: loginUrl,
        },
      }
    })

  if (!notifications.length) return

  try {
    await notificationModule.createNotifications(notifications)
  } catch (error) {
    logger.error(`Failed to send invite email: ${error}`)
  }
}

export const config: SubscriberConfig = {
  event: UserEvents.INVITE_TOKEN_GENERATED,
}

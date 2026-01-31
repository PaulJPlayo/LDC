import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules, UserEvents } from "@medusajs/framework/utils"

type UserLike = {
  id?: string
  email?: string
  metadata?: Record<string, unknown> | null
}

export default async function userRoleFromInvite({
  event: { data },
  container
}: SubscriberArgs<UserLike | { user?: UserLike } | { id?: string; email?: string }>) {
  const logger = container.resolve("logger") as { error: (message: string) => void }
  const userService = container.resolve(Modules.USER) as {
    retrieveUser: (id: string) => Promise<UserLike>
    listUsers: (filters: Record<string, unknown>) => Promise<UserLike[]>
    listInvites: (filters: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
    updateUsers: (payload: { id: string; metadata?: Record<string, unknown> }) => Promise<unknown>
  }

  const payload = (data as any) || {}
  const nestedUser = payload.user || {}
  let userId: string | undefined = payload.id || nestedUser.id
  let email: string | undefined = payload.email || nestedUser.email
  let metadata: Record<string, unknown> | null | undefined = payload.metadata || nestedUser.metadata

  if ((!email || !userId) && userId) {
    const user = await userService.retrieveUser(userId)
    email = user?.email
    metadata = user?.metadata
  }

  if (!email) {
    logger.error("Invite role sync skipped: missing user email.")
    return
  }

  if (!userId) {
    const user = await userService.listUsers({ email }).then((rows) => rows?.[0])
    userId = user?.id
    metadata = user?.metadata
  }

  if (!userId) {
    logger.error(`Invite role sync skipped: could not resolve user for ${email}.`)
    return
  }

  const currentRole =
    (metadata && (metadata as any).role) ||
    (metadata && Array.isArray((metadata as any).roles) ? (metadata as any).roles[0] : undefined)
  if (currentRole) {
    return
  }

  const invites = await userService.listInvites({ email })
  const latestInvite = Array.isArray(invites)
    ? invites
        .filter((invite) => invite && typeof invite === "object")
        .sort((a, b) => {
          const aTime = new Date(String((a as any).updated_at || (a as any).created_at || 0)).getTime()
          const bTime = new Date(String((b as any).updated_at || (b as any).created_at || 0)).getTime()
          return bTime - aTime
        })[0]
    : null

  const inviteRole =
    latestInvite?.metadata && (latestInvite.metadata as any).role
      ? String((latestInvite.metadata as any).role)
      : ""

  if (!inviteRole) {
    return
  }

  await userService.updateUsers({
    id: userId,
    metadata: { ...(metadata || {}), role: inviteRole }
  })
}

export const config: SubscriberConfig = {
  event: UserEvents.CREATED
}

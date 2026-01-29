import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString
} from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const token = String(req.query.token ?? "").trim()
  if (!token) {
    res.status(400).json({ valid: false, reason: "missing_token" })
    return
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "invite",
    variables: {
      filters: { token }
    },
    fields: ["id", "email", "expires_at", "accepted"]
  })

  try {
    const invites = await remoteQuery(queryObject)
    const invite = Array.isArray(invites) ? invites[0] : null

    if (!invite) {
      res.status(404).json({ valid: false, reason: "invalid" })
      return
    }

    const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null
    const isExpired = Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt < new Date())
    const isAccepted = Boolean(invite.accepted)

    if (isExpired) {
      res.status(410).json({
        valid: false,
        reason: "expired",
        invite: { email: invite.email, expires_at: invite.expires_at, accepted: invite.accepted }
      })
      return
    }

    if (isAccepted) {
      res.status(409).json({
        valid: false,
        reason: "accepted",
        invite: { email: invite.email, expires_at: invite.expires_at, accepted: invite.accepted }
      })
      return
    }

    res.json({
      valid: true,
      invite: { email: invite.email, expires_at: invite.expires_at, accepted: invite.accepted }
    })
  } catch (error) {
    res.status(500).json({ valid: false, reason: "error" })
  }
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GIFT_CARD_MODULE } from "../../../../modules/gift-cards"

const normalizeDateInput = (value: unknown) => {
  if (value === null) return null
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const giftCardService = req.scope.resolve(GIFT_CARD_MODULE)
  const { id } = req.params
  const giftCard = await giftCardService.retrieveGiftCard(id)
  res.json({ gift_card: giftCard })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const giftCardService = req.scope.resolve(GIFT_CARD_MODULE)
  const { id } = req.params
  const payload = req.body ?? {}
  const update: Record<string, unknown> = {}

  if ("is_disabled" in payload) {
    update.is_disabled = Boolean(payload.is_disabled)
  }

  if ("ends_at" in payload) {
    const normalized = normalizeDateInput(payload.ends_at)
    if (normalized === undefined) {
      res.status(400).json({ message: "Expiration date is invalid." })
      return
    }
    update.ends_at = normalized
  }

  if (payload.metadata && typeof payload.metadata === "object") {
    update.metadata = payload.metadata
  }

  const updated = await giftCardService.updateGiftCards({ id, ...update })
  const giftCard = Array.isArray(updated) ? updated[0] : updated
  res.json({ gift_card: giftCard })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const giftCardService = req.scope.resolve(GIFT_CARD_MODULE)
  const { id } = req.params
  await giftCardService.deleteGiftCards(id)
  res.status(200).json({ id })
}

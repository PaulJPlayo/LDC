import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils"
import crypto from "crypto"
import { GIFT_CARD_MODULE } from "../../../modules/gift-cards"
import GiftCardModuleService from "../../../modules/gift-cards/service"

const parseLimit = (value: unknown, fallback = 50) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 200)
}

const parseOffset = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

const parseBoolean = (value: unknown) => {
  if (value === "true" || value === true) return true
  if (value === "false" || value === false) return false
  return undefined
}

const generateGiftCardCode = () => {
  const chunk = crypto.randomBytes(4).toString("hex").toUpperCase()
  const tail = Date.now().toString(36).toUpperCase()
  return `LDC-${chunk}-${tail}`
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const giftCardService = req.scope.resolve(
    GIFT_CARD_MODULE
  ) as GiftCardModuleService
  const limit = parseLimit(req.query.limit, 50)
  const offset = parseOffset(req.query.offset)
  const query = String(req.query.q ?? "").trim().toLowerCase()
  const regionId = String(req.query.region_id ?? "").trim()
  const isDisabled = parseBoolean(req.query.is_disabled)

  const filters: Record<string, unknown> = {}
  if (regionId) filters.region_id = regionId
  if (typeof isDisabled === "boolean") filters.is_disabled = isDisabled

  let giftCards = []
  let count = 0

  if (query) {
    const allCards = await giftCardService.listGiftCards(filters, {
      order: { created_at: "DESC" }
    })
    const filtered = allCards.filter((card: any) => {
      const haystack = `${card?.code || ""} ${card?.id || ""}`.toLowerCase()
      return haystack.includes(query)
    })
    count = filtered.length
    giftCards = filtered.slice(offset, offset + limit)
  } else {
    const [cards, total] = await giftCardService.listAndCountGiftCards(filters, {
      skip: offset,
      take: limit,
      order: { created_at: "DESC" }
    })
    giftCards = cards
    count = total
  }

  res.json({ gift_cards: giftCards, count })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const giftCardService = req.scope.resolve(
    GIFT_CARD_MODULE
  ) as GiftCardModuleService
  const regionService = req.scope.resolve(Modules.REGION)
  const payload =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, any>)
      : {}
  const value = Number(payload.value)
  const regionId = String(payload.region_id ?? "").trim()
  const codeInput = String(payload.code ?? "").trim()
  const endsAtInput = String(payload.ends_at ?? "").trim()
  const isDisabled = Boolean(payload.is_disabled)
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? payload.metadata
      : undefined

  if (!regionId) {
    res.status(400).json({ message: "Region is required." })
    return
  }

  if (!Number.isFinite(value) || value <= 0) {
    res.status(400).json({ message: "Gift card value is required." })
    return
  }

  const endsAt =
    endsAtInput && !Number.isNaN(new Date(endsAtInput).getTime())
      ? new Date(endsAtInput)
      : endsAtInput
        ? null
        : undefined

  if (endsAtInput && endsAt === null) {
    res.status(400).json({ message: "Expiration date is invalid." })
    return
  }

  let currencyCode = ""
  try {
    const region = await regionService.retrieveRegion(regionId)
    currencyCode = region?.currency_code || ""
  } catch {
    res.status(404).json({ message: "Region not found." })
    return
  }

  const code = codeInput ? codeInput.toUpperCase() : generateGiftCardCode()

  const giftCard = await giftCardService.createGiftCards({
    code,
    value,
    balance: value,
    currency_code: currencyCode,
    region_id: regionId,
    is_disabled: isDisabled,
    ...(endsAt ? { ends_at: endsAt } : {}),
    ...(metadata ? { metadata } : {})
  })

  res.status(201).json({ gift_card: giftCard })
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils"
import {
  CUSTOMER_SAVED_WORKSPACE_MODULE,
} from "../../../../../modules/customer-saved-workspace"
import CustomerSavedWorkspaceModuleService from "../../../../../modules/customer-saved-workspace/service"

const SAVED_ITEM_TYPES = [
  "product_favorite",
  "doormat_build",
  "attire_build",
  "custom_design",
  "seasonal_design",
  "note",
] as const

const SAVED_CART_STATUSES = ["active", "archived", "deleted"] as const

const DEFAULT_ITEMS_LIMIT = 25
const MAX_ITEMS_LIMIT = 100
const DEFAULT_CARTS_LIMIT = 10
const MAX_CARTS_LIMIT = 50
const TEXT_LIMIT = 240
const LONG_TEXT_LIMIT = 500

class QueryError extends Error {
  status = 400
}

type SavedItemType = (typeof SAVED_ITEM_TYPES)[number]
type SavedCartStatus = (typeof SAVED_CART_STATUSES)[number]

type Pagination = {
  limit: number
  offset: number
}

const riskyKeys = new Set([
  "attachment_data",
  "attachmentdata",
  "raw_upload",
  "rawupload",
  "raw_upload_data",
  "rawuploaddata",
  "data_url",
  "dataurl",
  "base64",
  "base64_data",
  "base64data",
  "raw_file",
  "rawfile",
  "file_data",
  "filedata",
  "file",
  "blob",
  "payment",
  "payments",
  "payment_session",
  "paymentsession",
  "payment_sessions",
  "paymentsessions",
  "payment_collection",
  "paymentcollection",
  "payment_method",
  "paymentmethod",
  "card",
  "card_number",
  "cardnumber",
  "cvv",
  "cvc",
  "security_code",
  "authorization",
  "authorization_code",
  "token",
  "jwt",
  "cookie",
  "session",
  "password",
  "secret",
  "api_key",
  "apikey",
  "database_url",
  "databaseurl",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "")

const isRiskyKey = (key: string) => riskyKeys.has(normalizeKey(key))

const looksUnsafeText = (value: string) => {
  const text = value.trim()
  if (!text) return false
  if (/^data:/i.test(text) || /;base64,/i.test(text) || /^blob:/i.test(text)) return true
  if (/base64/i.test(text) && text.length > 120) return true
  if (text.length >= 512 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    return true
  }
  return false
}

const cleanText = (value: unknown, limit = TEXT_LIMIT) => {
  const text = String(value ?? "").trim()
  if (!text || looksUnsafeText(text)) return ""
  return text.slice(0, limit)
}

const cleanOptionalText = (value: unknown, limit = TEXT_LIMIT) => {
  const text = cleanText(value, limit)
  return text || null
}

const parseInteger = (value: unknown, fallback: number, max: number) => {
  if (value === undefined || value === null || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new QueryError("Pagination values must be non-negative numbers.")
  }
  return Math.min(Math.floor(parsed), max)
}

const parseOffset = (value: unknown) => {
  if (value === undefined || value === null || value === "") return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new QueryError("Pagination offset must be a non-negative number.")
  }
  return Math.floor(parsed)
}

const parsePagination = (
  query: Record<string, unknown>,
  limitKey: string,
  offsetKey: string,
  defaultLimit: number,
  maxLimit: number
): Pagination => ({
  limit: parseInteger(query[limitKey], defaultLimit, maxLimit),
  offset: parseOffset(query[offsetKey]),
})

const parseSavedItemType = (value: unknown) => {
  const type = cleanText(value)
  if (!type) return undefined
  if (!SAVED_ITEM_TYPES.includes(type as SavedItemType)) {
    throw new QueryError("Saved item type is invalid.")
  }
  return type as SavedItemType
}

const parseSavedCartStatus = (value: unknown) => {
  const status = cleanText(value)
  if (!status) return undefined
  if (!SAVED_CART_STATUSES.includes(status as SavedCartStatus)) {
    throw new QueryError("Saved cart status is invalid.")
  }
  return status as SavedCartStatus
}

const toNumberOrNull = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const sanitizeScalar = (value: unknown, limit = TEXT_LIMIT) => {
  if (value === null || value === undefined) return null
  if (typeof value === "number" || typeof value === "boolean") return value
  return cleanOptionalText(value, limit)
}

const sanitizeRecord = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return null
  if (value === null || value === undefined) return null
  if (typeof value !== "object") return sanitizeScalar(value, LONG_TEXT_LIMIT)
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeRecord(entry, depth + 1))
      .filter((entry) => entry !== null && entry !== undefined)
  }
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
    (result, [key, entry]) => {
      if (isRiskyKey(key)) return result
      const sanitized = sanitizeRecord(entry, depth + 1)
      if (sanitized !== null && sanitized !== undefined) {
        result[key] = sanitized
      }
      return result
    },
    {}
  )
}

const cleanSanitizedScalar = (value: unknown, limit = TEXT_LIMIT) => {
  const sanitized = sanitizeRecord(value)
  if (sanitized === null || sanitized === undefined || typeof sanitized === "object") {
    return ""
  }
  return cleanText(sanitized, limit)
}

const getStatus = (record: Record<string, unknown>) => {
  const explicitStatus = cleanText(record.status)
  if (explicitStatus) return explicitStatus
  if (record.deleted_at) return "deleted"
  if (record.archived_at) return "archived"
  return "active"
}

const serializeOption = (option: unknown) => {
  if (!isRecord(option)) return null
  const label = cleanSanitizedScalar(option.label)
  const value = cleanSanitizedScalar(option.value)
  if (label && isRiskyKey(label)) return null
  if (!label && !value) return null
  return { label, value }
}

const serializeOptions = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map(serializeOption)
    .filter(Boolean)

const shortKeyLabel = (value: unknown) => {
  const key = cleanText(value, 1000)
  if (!key) return null
  const tail = key.split("/").filter(Boolean).pop() || key
  if (tail.length <= 18) return tail
  return `...${tail.slice(-18)}`
}

const serializeUploadReference = (reference: unknown) => {
  if (!isRecord(reference)) return null
  const filename = cleanOptionalText(reference.filename || reference.name)
  const provider = cleanOptionalText(reference.provider)
  const keyLabel = shortKeyLabel(reference.key)
  const contentType = cleanOptionalText(reference.content_type || reference.contentType)
  const size = toNumberOrNull(reference.size)
  const status = cleanOptionalText(reference.status)

  if (!filename && !provider && !keyLabel) return null

  return {
    filename,
    provider,
    key_label: keyLabel,
    content_type: contentType,
    size,
    status,
  }
}

const collectUploadReferences = (...sources: unknown[]) => {
  const references: unknown[] = []
  sources.forEach((source) => {
    if (Array.isArray(source)) {
      references.push(...source)
    }
  })

  return references
    .map(serializeUploadReference)
    .filter(Boolean)
}

const serializeSavedItem = (item: unknown) => {
  const record = isRecord(item) ? item : {}
  const selectedOptions = serializeOptions(record.selected_options)
  const uploadReferences = collectUploadReferences(record.upload_references)

  return {
    id: cleanText(record.id, 100),
    type: cleanText(record.type, 80),
    title: cleanText(record.title) || "Saved item",
    source_path: cleanOptionalText(record.source_path),
    product_id: cleanOptionalText(record.product_id, 100),
    product_handle: cleanOptionalText(record.product_handle, 200),
    product_key: cleanOptionalText(record.product_key, 200),
    variant_id: cleanOptionalText(record.variant_id, 100),
    variant_title: cleanOptionalText(record.variant_title),
    quantity: toNumberOrNull(record.quantity) || 1,
    currency_code: cleanText(record.currency_code || "USD", 10) || "USD",
    price_snapshot_amount: toNumberOrNull(record.price_snapshot_amount),
    price_snapshot_display: cleanOptionalText(record.price_snapshot_display, 100),
    selected_options: selectedOptions,
    notes_preview: cleanOptionalText(record.notes, LONG_TEXT_LIMIT),
    upload_references: uploadReferences,
    created_at: cleanOptionalText(record.created_at, 80),
    updated_at: cleanOptionalText(record.updated_at, 80),
    archived_at: cleanOptionalText(record.archived_at, 80),
    status: getStatus(record),
  }
}

const extractLineItemUploadReferences = (lineItem: Record<string, unknown>) => {
  const display = isRecord(lineItem.display) ? lineItem.display : {}
  const metadata = isRecord(lineItem.metadata) ? lineItem.metadata : {}
  const selectedOptions = [
    ...(Array.isArray(lineItem.selected_options) ? lineItem.selected_options : []),
    ...(Array.isArray(display.options) ? display.options : []),
  ]

  const optionReferences = selectedOptions
    .filter(isRecord)
    .map((option) => ({
      filename: option.attachmentName || option.attachment_name || option.uploadName || option.upload_name,
      provider: option.attachmentProvider || option.attachment_provider,
      key: option.attachmentKey || option.attachment_key,
      content_type: option.attachmentContentType || option.attachment_content_type,
      size: option.attachmentSize || option.attachment_size,
      status: option.status,
    }))

  const metadataReference = {
    filename: metadata.design_attachment_name || metadata.designAttachmentName,
    provider: metadata.design_attachment_provider || metadata.designAttachmentProvider,
    key: metadata.design_attachment_key || metadata.designAttachmentKey,
    content_type: metadata.design_attachment_content_type || metadata.designAttachmentContentType,
    size: metadata.design_attachment_size || metadata.designAttachmentSize,
  }

  return collectUploadReferences(lineItem.upload_references, display.upload_references, [
    ...optionReferences,
    metadataReference,
  ])
}

const getLineItemTitle = (lineItem: Record<string, unknown>, index: number) =>
  cleanText(
    lineItem.title ||
      (isRecord(lineItem.display) ? lineItem.display.title || lineItem.display.name : "") ||
      `Item ${index + 1}`
  ) || `Item ${index + 1}`

const getLineItemQuantity = (lineItem: Record<string, unknown>) => {
  const quantity =
    toNumberOrNull(lineItem.quantity) ||
    (isRecord(lineItem.display) ? toNumberOrNull(lineItem.display.quantity) : null)
  return quantity && quantity > 0 ? quantity : 1
}

const getLineItemSelectedOptions = (lineItem: Record<string, unknown>) => {
  const display = isRecord(lineItem.display) ? lineItem.display : {}
  return [
    ...serializeOptions(lineItem.selected_options),
    ...serializeOptions(display.options),
  ]
}

const serializeCartLineItem = (lineItem: unknown, index: number) => {
  const record = isRecord(lineItem) ? lineItem : {}
  return {
    title: getLineItemTitle(record, index),
    quantity: getLineItemQuantity(record),
    selected_options: getLineItemSelectedOptions(record),
    upload_references: extractLineItemUploadReferences(record),
  }
}

const serializeSavedCart = (cart: unknown) => {
  const record = isRecord(cart) ? cart : {}
  const lineItems = Array.isArray(record.line_items) ? record.line_items : []

  return {
    id: cleanText(record.id, 100),
    name: cleanOptionalText(record.name) || "Saved cart",
    status: getStatus(record),
    item_count: toNumberOrNull(record.item_count) || lineItems.length,
    subtotal_snapshot_amount: toNumberOrNull(record.subtotal_snapshot_amount),
    currency_code: cleanText(record.currency_code || "USD", 10) || "USD",
    line_items: lineItems.map(serializeCartLineItem),
    created_at: cleanOptionalText(record.created_at, 80),
    updated_at: cleanOptionalText(record.updated_at, 80),
    archived_at: cleanOptionalText(record.archived_at, 80),
  }
}

const getService = (req: MedusaRequest) =>
  req.scope.resolve(CUSTOMER_SAVED_WORKSPACE_MODULE) as CustomerSavedWorkspaceModuleService

const getAdminActorId = (req: MedusaRequest) => {
  const actorId = (req as any).auth_context?.actor_id
  return typeof actorId === "string" && actorId.trim() ? actorId.trim() : null
}

const ensureCustomerExists = async (req: MedusaRequest, customerId: string) => {
  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  try {
    await customerService.retrieveCustomer(customerId)
    return true
  } catch {
    return false
  }
}

const listSavedCartsForAdmin = async (
  service: CustomerSavedWorkspaceModuleService,
  customerId: string,
  pagination: Pagination,
  status?: SavedCartStatus
) => {
  if (!status) {
    return await service.listSavedCarts(customerId, pagination)
  }

  return await (service as any).listAndCountCustomerSavedCarts(
    {
      customer_id: customerId,
      status,
    },
    {
      skip: pagination.offset,
      take: pagination.limit,
      order: { updated_at: "DESC" },
    }
  )
}

const getSavedCartTotalCount = async (
  service: CustomerSavedWorkspaceModuleService,
  customerId: string
) => {
  const [, count] = await service.listSavedCarts(customerId, { limit: 1, offset: 0 })
  return count || 0
}

const getSavedItemCounts = async (
  service: CustomerSavedWorkspaceModuleService,
  customerId: string
) => {
  const [, savedItemsCount] = await service.listSavedItems(customerId, { limit: 1, offset: 0 })
  const typeCounts = await Promise.all(
    SAVED_ITEM_TYPES.map(async (type) => {
      const [, count] = await service.listSavedItems(customerId, {
        type,
        limit: 1,
        offset: 0,
      })
      return [type, count || 0] as const
    })
  )

  return typeCounts.reduce<Record<string, number>>(
    (result, [type, count]) => {
      result[type] = count
      return result
    },
    {
      saved_items: savedItemsCount || 0,
    }
  )
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const adminActorId = getAdminActorId(req)
  if (!adminActorId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  try {
    const customerId = cleanText(req.params.id, 100)
    if (!customerId) {
      res.status(400).json({ message: "Customer id is required." })
      return
    }

    const customerExists = await ensureCustomerExists(req, customerId)
    if (!customerExists) {
      res.status(404).json({ message: "Customer not found." })
      return
    }

    const query = req.query as Record<string, unknown>
    const itemsPagination = parsePagination(
      query,
      "items_limit",
      "items_offset",
      DEFAULT_ITEMS_LIMIT,
      MAX_ITEMS_LIMIT
    )
    const cartsPagination = parsePagination(
      query,
      "carts_limit",
      "carts_offset",
      DEFAULT_CARTS_LIMIT,
      MAX_CARTS_LIMIT
    )
    const type = parseSavedItemType(query.type)
    const cartStatus = parseSavedCartStatus(query.cart_status)
    const service = getService(req)

    const [[savedItems, savedItemsCount], [savedCarts, savedCartsCount], itemCounts, savedCartsTotalCount] =
      await Promise.all([
        service.listSavedItems(customerId, {
          ...itemsPagination,
          ...(type ? { type } : {}),
        }),
        listSavedCartsForAdmin(service, customerId, cartsPagination, cartStatus),
        getSavedItemCounts(service, customerId),
        getSavedCartTotalCount(service, customerId),
      ])

    res.json({
      customer_id: customerId,
      counts: {
        saved_items: itemCounts.saved_items || 0,
        product_favorites: itemCounts.product_favorite || 0,
        doormat_builds: itemCounts.doormat_build || 0,
        attire_builds: itemCounts.attire_build || 0,
        custom_designs: itemCounts.custom_design || 0,
        seasonal_designs: itemCounts.seasonal_design || 0,
        notes: itemCounts.note || 0,
        saved_carts: savedCartsTotalCount || 0,
      },
      saved_items: {
        data: (Array.isArray(savedItems) ? savedItems : []).map(serializeSavedItem),
        count: savedItemsCount || 0,
        limit: itemsPagination.limit,
        offset: itemsPagination.offset,
      },
      saved_carts: {
        data: (Array.isArray(savedCarts) ? savedCarts : []).map(serializeSavedCart),
        count: savedCartsCount || 0,
        limit: cartsPagination.limit,
        offset: cartsPagination.offset,
      },
      read_only: true,
    })
  } catch (error) {
    if (error instanceof QueryError) {
      res.status(error.status).json({ message: error.message })
      return
    }

    res.status(500).json({ message: "Unable to load saved workspace." })
  }
}

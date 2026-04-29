export const SAVED_ITEM_TYPES = [
  "product_favorite",
  "attire_build",
  "doormat_build",
  "custom_design",
  "seasonal_design",
  "note",
] as const

export const SAVED_CART_STATUSES = ["active", "archived", "deleted"] as const
export const UPLOAD_REFERENCE_STATUSES = ["pending", "active", "deleted"] as const

export type SavedItemType = (typeof SAVED_ITEM_TYPES)[number]
export type SavedCartStatus = (typeof SAVED_CART_STATUSES)[number]
export type UploadReferenceStatus = (typeof UPLOAD_REFERENCE_STATUSES)[number]

export type SavedItemInput = {
  type: SavedItemType
  dedupe_key: string
  favorite_key?: string | null
  source_path?: string | null
  product_id?: string | null
  product_handle?: string | null
  product_key?: string | null
  variant_id?: string | null
  title: string
  variant_title?: string | null
  description?: string | null
  short_description?: string | null
  image_url?: string | null
  preview_image?: string | null
  preview_style?: string | null
  quantity: number
  currency_code: string
  price_snapshot_amount?: number | null
  price_snapshot_display?: string | null
  selected_options: unknown[]
  item_payload: Record<string, unknown>
  line_item_metadata?: Record<string, unknown> | null
  notes?: string | null
  upload_references: unknown[]
  live_reference?: Record<string, unknown> | null
  archived_at?: Date | null
}

export type SavedCartInput = {
  name?: string | null
  status?: SavedCartStatus
  currency_code: string
  region_id?: string | null
  cart_snapshot: Record<string, unknown>
  line_items: unknown[]
  item_count: number
  subtotal_snapshot_amount?: number | null
  dedupe_key?: string | null
  archived_at?: Date | null
}

export class SavedWorkspaceValidationError extends Error {
  status = 400

  constructor(message: string) {
    super(message)
    this.name = "SavedWorkspaceValidationError"
  }
}

const MAX_TEXT_LENGTH = 500
const MAX_NOTES_LENGTH = 2000
const MAX_JSON_BYTES = 100000
const MAX_CART_JSON_BYTES = 250000
const MAX_MERGE_ITEMS = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_LIST_LIMIT = 50

const unsafePayloadKeys = new Set([
  "attachment_data",
  "attachmentdata",
  "data_url",
  "dataurl",
  "base64",
  "base64_data",
  "base64data",
  "blob",
])

const paymentKeys = new Set([
  "payment",
  "payments",
  "payment_session",
  "paymentsession",
  "payment_sessions",
  "paymentsessions",
  "payment_collection",
  "paymentcollection",
  "payment_collections",
  "paymentcollections",
  "payment_method",
  "paymentmethod",
  "payment_methods",
  "paymentmethods",
  "card",
  "card_number",
  "cardnumber",
  "cvv",
  "cvc",
  "security_code",
  "authorization",
  "authorization_code",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const jsonSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null), "utf8")

const cleanText = (value: unknown, maxLength = MAX_TEXT_LENGTH) => {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed.slice(0, maxLength) : ""
}

const cleanOptionalText = (value: unknown, maxLength = MAX_TEXT_LENGTH) => {
  const cleaned = cleanText(value, maxLength)
  return cleaned || null
}

const parsePositiveInteger = (value: unknown, fallback: number) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const parseOptionalInteger = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed)
}

const parseOptionalDate = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

const hasDataUrlString = (value: string) => /^data:[^;]+;base64,/i.test(value.trim())

const looksLikeRawBase64 = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length < 512) return false
  if (trimmed.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
}

const containsUnsafeUploadPayload = (value: unknown): boolean => {
  if (typeof value === "string") {
    return hasDataUrlString(value) || looksLikeRawBase64(value)
  }

  if (Array.isArray(value)) {
    return value.some(entry => containsUnsafeUploadPayload(entry))
  }

  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (unsafePayloadKeys.has(normalizedKey)) {
      return entry !== null && entry !== undefined && String(entry).trim() !== ""
    }
    return containsUnsafeUploadPayload(entry)
  })
}

const containsPaymentDetails = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(entry => containsPaymentDetails(entry))
  }

  if (!isRecord(value)) return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "_")
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (paymentKeys.has(normalizedKey) || paymentKeys.has(compactKey)) {
      return true
    }
    return containsPaymentDetails(entry)
  })
}

const validateUploadReferences = (value: unknown[]) => {
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const status = cleanText(entry.status || "")
    if (status && !UPLOAD_REFERENCE_STATUSES.includes(status as UploadReferenceStatus)) {
      throw new SavedWorkspaceValidationError(
        `upload_references[${index}].status is invalid.`
      )
    }
  })
}

export const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.min(parsePositiveInteger(query.limit, DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
  const offset = Math.max(parsePositiveInteger(query.offset, 0), 0)
  return { limit, offset }
}

export const validateSavedItemType = (value: unknown): SavedItemType => {
  const type = cleanText(value)
  if (!SAVED_ITEM_TYPES.includes(type as SavedItemType)) {
    throw new SavedWorkspaceValidationError("Saved item type is invalid.")
  }
  return type as SavedItemType
}

export const validateMergeItems = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new SavedWorkspaceValidationError("Merge items must be an array.")
  }
  if (value.length > MAX_MERGE_ITEMS) {
    throw new SavedWorkspaceValidationError(`Merge is limited to ${MAX_MERGE_ITEMS} items.`)
  }
  return value
}

export const normalizeSavedItemInput = (payload: unknown): SavedItemInput => {
  if (!isRecord(payload)) {
    throw new SavedWorkspaceValidationError("Saved item payload is invalid.")
  }

  if ("customer_id" in payload) {
    throw new SavedWorkspaceValidationError("customer_id cannot be supplied.")
  }

  const type = validateSavedItemType(payload.type)
  const dedupeKey = cleanText(payload.dedupe_key, 1000)
  const title = cleanText(payload.title)

  if (!dedupeKey) {
    throw new SavedWorkspaceValidationError("dedupe_key is required.")
  }

  if (!title) {
    throw new SavedWorkspaceValidationError("title is required.")
  }

  const selectedOptions = Array.isArray(payload.selected_options)
    ? payload.selected_options
    : []
  const itemPayload = isRecord(payload.item_payload) ? payload.item_payload : {}
  const lineItemMetadata =
    payload.line_item_metadata === undefined || payload.line_item_metadata === null
      ? null
      : isRecord(payload.line_item_metadata)
        ? payload.line_item_metadata
        : null
  const uploadReferences = Array.isArray(payload.upload_references)
    ? payload.upload_references
    : []
  const liveReference =
    payload.live_reference === undefined || payload.live_reference === null
      ? null
      : isRecord(payload.live_reference)
        ? payload.live_reference
        : null

  if ("line_item_metadata" in payload && payload.line_item_metadata && !lineItemMetadata) {
    throw new SavedWorkspaceValidationError("line_item_metadata must be an object.")
  }

  if ("item_payload" in payload && payload.item_payload && !isRecord(payload.item_payload)) {
    throw new SavedWorkspaceValidationError("item_payload must be an object.")
  }

  if ("selected_options" in payload && !Array.isArray(payload.selected_options)) {
    throw new SavedWorkspaceValidationError("selected_options must be an array.")
  }

  if ("upload_references" in payload && !Array.isArray(payload.upload_references)) {
    throw new SavedWorkspaceValidationError("upload_references must be an array.")
  }

  validateUploadReferences(uploadReferences)

  const unsafePayloads = [selectedOptions, itemPayload, lineItemMetadata, uploadReferences, liveReference]
  if (unsafePayloads.some(entry => containsUnsafeUploadPayload(entry))) {
    throw new SavedWorkspaceValidationError(
      "Saved items may only reference persistent uploads."
    )
  }

  if (jsonSize(payload) > MAX_JSON_BYTES) {
    throw new SavedWorkspaceValidationError("Saved item payload is too large.")
  }

  const quantity = parsePositiveInteger(payload.quantity, 1)
  const notes =
    "notes" in payload ? cleanOptionalText(payload.notes, MAX_NOTES_LENGTH) : undefined

  return {
    type,
    dedupe_key: dedupeKey,
    favorite_key: cleanOptionalText(payload.favorite_key, 1000),
    source_path: cleanOptionalText(payload.source_path),
    product_id: cleanOptionalText(payload.product_id),
    product_handle: cleanOptionalText(payload.product_handle),
    product_key: cleanOptionalText(payload.product_key),
    variant_id: cleanOptionalText(payload.variant_id),
    title,
    variant_title: cleanOptionalText(payload.variant_title),
    description: cleanOptionalText(payload.description, 4000),
    short_description: cleanOptionalText(payload.short_description, 1000),
    image_url: cleanOptionalText(payload.image_url, 2000),
    preview_image: cleanOptionalText(payload.preview_image, 2000),
    preview_style: cleanOptionalText(payload.preview_style, 2000),
    quantity,
    currency_code: cleanText(payload.currency_code || "USD", 10).toUpperCase() || "USD",
    price_snapshot_amount: parseOptionalInteger(payload.price_snapshot_amount),
    price_snapshot_display: cleanOptionalText(payload.price_snapshot_display, 100),
    selected_options: selectedOptions,
    item_payload: itemPayload,
    line_item_metadata: lineItemMetadata,
    ...(notes !== undefined ? { notes } : {}),
    upload_references: uploadReferences,
    live_reference: liveReference,
    archived_at: parseOptionalDate(payload.archived_at),
  }
}

export const normalizeSavedCartInput = (payload: unknown): SavedCartInput => {
  if (!isRecord(payload)) {
    throw new SavedWorkspaceValidationError("Saved cart payload is invalid.")
  }

  if ("customer_id" in payload) {
    throw new SavedWorkspaceValidationError("customer_id cannot be supplied.")
  }

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : null
  const cartSnapshot = isRecord(payload.cart_snapshot) ? payload.cart_snapshot : null

  if (!lineItems) {
    throw new SavedWorkspaceValidationError("line_items must be an array.")
  }

  if (!cartSnapshot) {
    throw new SavedWorkspaceValidationError("cart_snapshot must be an object.")
  }

  if (containsPaymentDetails(cartSnapshot) || containsPaymentDetails(lineItems)) {
    throw new SavedWorkspaceValidationError("Saved carts cannot include payment details.")
  }

  if (containsUnsafeUploadPayload(cartSnapshot) || containsUnsafeUploadPayload(lineItems)) {
    throw new SavedWorkspaceValidationError(
      "Saved carts may only reference persistent uploads."
    )
  }

  if (jsonSize(payload) > MAX_CART_JSON_BYTES) {
    throw new SavedWorkspaceValidationError("Saved cart payload is too large.")
  }

  const statusInput = cleanText(payload.status || "active")
  if (!SAVED_CART_STATUSES.includes(statusInput as SavedCartStatus)) {
    throw new SavedWorkspaceValidationError("Saved cart status is invalid.")
  }

  return {
    name: cleanOptionalText(payload.name),
    status: statusInput as SavedCartStatus,
    currency_code: cleanText(payload.currency_code || "USD", 10).toUpperCase() || "USD",
    region_id: cleanOptionalText(payload.region_id),
    cart_snapshot: cartSnapshot,
    line_items: lineItems,
    item_count: parsePositiveInteger(payload.item_count, lineItems.length),
    subtotal_snapshot_amount: parseOptionalInteger(payload.subtotal_snapshot_amount),
    dedupe_key: cleanOptionalText(payload.dedupe_key, 1000),
    archived_at: parseOptionalDate(payload.archived_at),
  }
}

export const isSavedWorkspaceValidationError = (
  error: unknown
): error is SavedWorkspaceValidationError =>
  error instanceof SavedWorkspaceValidationError

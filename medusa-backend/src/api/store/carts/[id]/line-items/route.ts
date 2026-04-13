import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { addToCartWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"

const ATTIRE_PRODUCT_HANDLE = "attire-custom"

type StoreAddCartLineItemBody = {
  variant_id: string
  quantity: number
  metadata?: Record<string, unknown> | null
  additional_data?: Record<string, unknown>
}

type VariantHandleRecord = {
  id?: string
  product?: {
    handle?: string | null
  } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const parsePositiveNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

const toMinorUnitAmount = (value: number) => {
  if (Number.isInteger(value) && value >= 1000) {
    return value
  }

  return Math.round(value * 100)
}

const refetchCart = async (
  id: string,
  scope: MedusaRequest["scope"],
  fields: string[]
) => {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id } },
    fields,
  })

  const [cart] = await remoteQuery(queryObject)

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart with id '${id}' not found`
    )
  }

  return cart
}

const resolveAttireCustomUnitPrice = async (
  req: MedusaRequest,
  body: StoreAddCartLineItemBody
) => {
  const metadata = isRecord(body.metadata) ? body.metadata : null
  if (!metadata) {
    return undefined
  }

  const metadataHandle =
    typeof metadata.design_product_handle === "string"
      ? metadata.design_product_handle.trim()
      : ""

  if (metadataHandle !== ATTIRE_PRODUCT_HANDLE) {
    return undefined
  }

  const configuredPrice = parsePositiveNumber(metadata.design_total_price)
  if (!configuredPrice) {
    return undefined
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "variants",
    variables: {
      filters: {
        id: body.variant_id,
      },
    },
    fields: ["id", "product.handle"],
  })

  const [variant] = (await remoteQuery(queryObject)) as VariantHandleRecord[]
  const variantHandle = variant?.product?.handle?.trim()

  if (variantHandle !== ATTIRE_PRODUCT_HANDLE) {
    return undefined
  }

  return toMinorUnitAmount(configuredPrice)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.validatedBody ?? {}) as StoreAddCartLineItemBody
  const unitPrice = await resolveAttireCustomUnitPrice(req, body)
  const item = {
    ...body,
    ...(typeof unitPrice === "number" ? { unit_price: unitPrice } : {}),
  }

  const we = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await we.run(addToCartWorkflowId, {
    input: {
      cart_id: req.params.id,
      items: [item],
      additional_data: body.additional_data,
    },
  })

  const cart = await refetchCart(req.params.id, req.scope, req.queryConfig.fields)
  res.status(200).json({ cart })
}

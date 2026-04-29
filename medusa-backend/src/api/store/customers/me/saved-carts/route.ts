import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CUSTOMER_SAVED_WORKSPACE_MODULE,
} from "../../../../../modules/customer-saved-workspace"
import CustomerSavedWorkspaceModuleService from "../../../../../modules/customer-saved-workspace/service"
import {
  isSavedWorkspaceValidationError,
  parsePagination,
} from "../../../../../modules/customer-saved-workspace/validation"

const getCustomerId = (req: MedusaRequest) => {
  const actorId = (req as any).auth_context?.actor_id
  return typeof actorId === "string" && actorId.trim() ? actorId.trim() : null
}

const getService = (req: MedusaRequest) =>
  req.scope.resolve(CUSTOMER_SAVED_WORKSPACE_MODULE) as CustomerSavedWorkspaceModuleService

const handleError = (res: MedusaResponse, error: unknown) => {
  if (isSavedWorkspaceValidationError(error)) {
    res.status(error.status).json({ message: error.message })
    return true
  }
  return false
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  const query = req.query as Record<string, unknown>
  const { limit, offset } = parsePagination(query)
  const service = getService(req)
  const [savedCarts, count] = await service.listSavedCarts(customerId, { limit, offset })

  res.json({
    saved_carts: savedCarts,
    count,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  try {
    const service = getService(req)
    const savedCart = await service.createSavedCart(customerId, req.body)
    res.status(201).json({ saved_cart: savedCart })
  } catch (error) {
    if (!handleError(res, error)) throw error
  }
}

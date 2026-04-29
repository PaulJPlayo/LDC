import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CUSTOMER_SAVED_WORKSPACE_MODULE,
} from "../../../../../modules/customer-saved-workspace"
import CustomerSavedWorkspaceModuleService from "../../../../../modules/customer-saved-workspace/service"
import {
  isSavedWorkspaceValidationError,
  parsePagination,
  validateSavedItemType,
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

  try {
    const query = req.query as Record<string, unknown>
    const { limit, offset } = parsePagination(query)
    const type = query.type ? validateSavedItemType(query.type) : undefined
    const service = getService(req)
    const [savedItems, count] = await service.listSavedItems(customerId, {
      type,
      limit,
      offset,
    })

    res.json({
      saved_items: savedItems,
      count,
      limit,
      offset,
    })
  } catch (error) {
    if (!handleError(res, error)) throw error
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  try {
    const service = getService(req)
    const savedItem = await service.upsertSavedItem(customerId, req.body)
    res.status(200).json({ saved_item: savedItem })
  } catch (error) {
    if (!handleError(res, error)) throw error
  }
}

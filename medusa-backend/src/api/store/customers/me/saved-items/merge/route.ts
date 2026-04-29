import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CUSTOMER_SAVED_WORKSPACE_MODULE,
} from "../../../../../../modules/customer-saved-workspace"
import CustomerSavedWorkspaceModuleService from "../../../../../../modules/customer-saved-workspace/service"
import {
  isSavedWorkspaceValidationError,
  SavedWorkspaceValidationError,
} from "../../../../../../modules/customer-saved-workspace/validation"

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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)
        : {}

    if ("customer_id" in body) {
      throw new SavedWorkspaceValidationError("customer_id cannot be supplied.")
    }

    const strategy = String(body.strategy || "upsert_by_dedupe_key")
    if (strategy !== "upsert_by_dedupe_key") {
      throw new SavedWorkspaceValidationError("Merge strategy is invalid.")
    }

    const service = getService(req)
    const result = await service.mergeSavedItems(customerId, body.items)
    res.status(200).json(result)
  } catch (error) {
    if (!handleError(res, error)) throw error
  }
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CUSTOMER_SAVED_WORKSPACE_MODULE,
} from "../../../../../../modules/customer-saved-workspace"
import CustomerSavedWorkspaceModuleService from "../../../../../../modules/customer-saved-workspace/service"

const getCustomerId = (req: MedusaRequest) => {
  const actorId = (req as any).auth_context?.actor_id
  return typeof actorId === "string" && actorId.trim() ? actorId.trim() : null
}

const getService = (req: MedusaRequest) =>
  req.scope.resolve(CUSTOMER_SAVED_WORKSPACE_MODULE) as CustomerSavedWorkspaceModuleService

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const customerId = getCustomerId(req)
  if (!customerId) {
    res.status(401).json({ message: "Authentication required." })
    return
  }

  const id = String(req.params.id || "").trim()
  if (!id) {
    res.status(400).json({ message: "Saved item id is required." })
    return
  }

  const service = getService(req)
  const deleted = await service.softDeleteSavedItem(customerId, id)
  if (!deleted) {
    res.status(404).json({ message: "Saved item not found." })
    return
  }

  res.status(200).json({ id, deleted: true })
}

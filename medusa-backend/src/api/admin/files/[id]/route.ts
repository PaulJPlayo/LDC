import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  if (!id) {
    res.status(400).json({ message: "File id is required." })
    return
  }

  const fileModuleService = req.scope.resolve(Modules.FILE)
  await fileModuleService.deleteFiles(id)
  res.status(200).json({ id })
}

import { Module } from "@medusajs/framework/utils"
import CustomerSavedWorkspaceModuleService from "./service"

export const CUSTOMER_SAVED_WORKSPACE_MODULE = "customer_saved_workspace"

export default Module(CUSTOMER_SAVED_WORKSPACE_MODULE, {
  service: CustomerSavedWorkspaceModuleService,
})

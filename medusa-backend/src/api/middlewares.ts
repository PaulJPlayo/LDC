import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import express from "express"
import path from "path"

const staticDir = path.join(process.cwd(), "static")
const authenticateAdminSavedWorkspace = authenticate("user", ["session", "bearer"])

const authenticateAdminSavedWorkspaceRequest = (req, res, next) => {
  if (req.method === "OPTIONS") {
    next()
    return
  }

  return authenticateAdminSavedWorkspace(req, res, next)
}

const ensureStoreProductMetadata = (req, _res, next) => {
  if (req?.queryConfig?.fields) {
    if (!req.queryConfig.fields.includes("metadata")) {
      req.queryConfig.fields.push("metadata")
    }
  }
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/design-attachments",
      bodyParser: {
        sizeLimit: "10mb",
      },
    },
    {
      matcher: "/store/customers/me/saved-items*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/customers/me/saved-carts*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/admin/customers/:id/saved-workspace",
      middlewares: [authenticateAdminSavedWorkspaceRequest],
    },
    {
      matcher: "/store/products",
      middlewares: [ensureStoreProductMetadata],
    },
    {
      matcher: "/store/products/:id",
      middlewares: [ensureStoreProductMetadata],
    },
    {
      matcher: "/static",
      middlewares: [express.static(staticDir)],
    },
  ],
})

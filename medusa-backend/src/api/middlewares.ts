import { defineMiddlewares } from "@medusajs/framework/http"
import express from "express"
import path from "path"

const staticDir = path.join(process.cwd(), "static")

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

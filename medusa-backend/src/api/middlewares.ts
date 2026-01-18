import { defineMiddlewares } from "@medusajs/framework/http"
import express from "express"
import path from "path"

const staticDir = path.join(process.cwd(), "static")

export default defineMiddlewares({
  routes: [
    {
      matcher: "/static",
      middlewares: [express.static(staticDir)],
    },
  ],
})

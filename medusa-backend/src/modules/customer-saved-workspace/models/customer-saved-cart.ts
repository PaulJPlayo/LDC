import { model } from "@medusajs/framework/utils"

export const CUSTOMER_SAVED_CART_STATUSES = ["active", "archived", "deleted"] as const

const CustomerSavedCart = model.define("customer_saved_cart", {
  id: model.id({ prefix: "csc" }).primaryKey(),
  customer_id: model.text().index("IDX_customer_saved_cart_customer_id"),
  name: model.text().nullable(),
  status: model
    .enum([...CUSTOMER_SAVED_CART_STATUSES])
    .default("active")
    .index("IDX_customer_saved_cart_status"),
  currency_code: model.text().default("USD"),
  region_id: model.text().nullable(),
  cart_snapshot: model.json(),
  line_items: model.json(),
  item_count: model.number().default(0),
  subtotal_snapshot_amount: model.number().nullable(),
  dedupe_key: model.text().index("IDX_customer_saved_cart_dedupe_key").nullable(),
  archived_at: model.dateTime().nullable(),
})

export default CustomerSavedCart

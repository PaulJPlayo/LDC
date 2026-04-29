import { model } from "@medusajs/framework/utils"

export const CUSTOMER_SAVED_ITEM_TYPES = [
  "product_favorite",
  "attire_build",
  "doormat_build",
  "custom_design",
  "seasonal_design",
  "note",
] as const

const CustomerSavedItem = model.define("customer_saved_item", {
  id: model.id({ prefix: "csi" }).primaryKey(),
  customer_id: model.text().index("IDX_customer_saved_item_customer_id"),
  type: model.enum([...CUSTOMER_SAVED_ITEM_TYPES]).index("IDX_customer_saved_item_type"),
  favorite_key: model.text().nullable(),
  dedupe_key: model.text().index("IDX_customer_saved_item_dedupe_key"),
  source_path: model.text().nullable(),
  product_id: model.text().index("IDX_customer_saved_item_product_id").nullable(),
  product_handle: model.text().index("IDX_customer_saved_item_product_handle").nullable(),
  product_key: model.text().nullable(),
  variant_id: model.text().index("IDX_customer_saved_item_variant_id").nullable(),
  title: model.text(),
  variant_title: model.text().nullable(),
  description: model.text().nullable(),
  short_description: model.text().nullable(),
  image_url: model.text().nullable(),
  preview_image: model.text().nullable(),
  preview_style: model.text().nullable(),
  quantity: model.number().default(1),
  currency_code: model.text().default("USD"),
  price_snapshot_amount: model.number().nullable(),
  price_snapshot_display: model.text().nullable(),
  selected_options: model.json().nullable(),
  item_payload: model.json(),
  line_item_metadata: model.json().nullable(),
  notes: model.text().nullable(),
  upload_references: model.json().nullable(),
  live_reference: model.json().nullable(),
  archived_at: model.dateTime().nullable(),
})

export default CustomerSavedItem

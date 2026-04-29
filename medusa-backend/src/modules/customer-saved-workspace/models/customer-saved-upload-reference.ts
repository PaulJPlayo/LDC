import { model } from "@medusajs/framework/utils"

export const CUSTOMER_SAVED_UPLOAD_REFERENCE_STATUSES = [
  "pending",
  "active",
  "deleted",
] as const

const CustomerSavedUploadReference = model.define("customer_saved_upload_reference", {
  id: model.id({ prefix: "csu" }).primaryKey(),
  customer_id: model.text().index("IDX_customer_saved_upload_reference_customer_id"),
  saved_item_id: model
    .text()
    .index("IDX_customer_saved_upload_reference_saved_item_id")
    .nullable(),
  provider: model.text().default("s3"),
  key: model.text().unique("UIDX_customer_saved_upload_reference_key"),
  filename: model.text(),
  content_type: model.text().nullable(),
  size: model.number().nullable(),
  status: model
    .enum([...CUSTOMER_SAVED_UPLOAD_REFERENCE_STATUSES])
    .default("active")
    .index("IDX_customer_saved_upload_reference_status"),
  metadata: model.json().nullable(),
  uploaded_at: model.dateTime().nullable(),
})

export default CustomerSavedUploadReference

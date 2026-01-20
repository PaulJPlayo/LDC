import { model } from "@medusajs/framework/utils"

const GiftCard = model.define("gift_card", {
  id: model.id({ prefix: "gc" }).primaryKey(),
  code: model.text().unique(),
  value: model.number(),
  balance: model.number(),
  currency_code: model.text(),
  region_id: model.text(),
  is_disabled: model.boolean().default(false),
  ends_at: model.dateTime().nullable(),
  metadata: model.json().nullable()
})

export default GiftCard

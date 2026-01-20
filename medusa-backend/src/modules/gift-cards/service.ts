import { MedusaService } from "@medusajs/framework/utils"
import GiftCard from "./models/gift-card"

class GiftCardModuleService extends MedusaService({
  GiftCard
}) {}

export default GiftCardModuleService

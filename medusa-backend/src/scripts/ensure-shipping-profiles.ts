import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

type ShippingOptionRecord = {
  id: string
  name?: string
  shipping_profile_id?: string
}

type ShippingProfileRecord = {
  id: string
  name?: string
}

type ProductRecord = {
  id: string
  handle?: string
  shipping_profile_id?: string
}

export default async function ensureShippingProfiles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: shippingOptions } = (await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "shipping_profile_id"],
  })) as { data: ShippingOptionRecord[] }

  let targetProfileId =
    shippingOptions?.find((opt) => opt.shipping_profile_id)?.shipping_profile_id || ""

  if (!targetProfileId) {
    const { data: profiles } = (await query.graph({
      entity: "shipping_profile",
      fields: ["id", "name"],
    })) as { data: ShippingProfileRecord[] }
    targetProfileId = profiles?.[0]?.id || ""
  }

  if (!targetProfileId) {
    logger.error("No shipping profile found to assign to products.")
    return
  }

  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle", "shipping_profile_id"],
  })) as { data: ProductRecord[] }

  const updates = products
    .filter((product) => product.shipping_profile_id !== targetProfileId)
    .map((product) => ({
      id: product.id,
      shipping_profile_id: targetProfileId,
    }))

  if (!updates.length) {
    logger.info("All products already use the correct shipping profile.")
    return
  }

  await updateProductsWorkflow(container).run({
    input: {
      products: updates,
    },
  })

  logger.info(`Updated ${updates.length} product(s) to shipping_profile_id=${targetProfileId}`)
}

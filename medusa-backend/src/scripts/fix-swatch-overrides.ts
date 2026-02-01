import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type OverrideEntry = {
  productHandle: string
  variantTitleIncludes: string
  metadata: Record<string, string>
}

const overrides: OverrideEntry[] = [
  {
    productHandle: "tumbler-water-bottle-tumbler",
    variantTitleIncludes: "Vanilla pink",
    metadata: {
      swatchStyle:
        "background: radial-gradient(circle, #fff0f7 0%, #ffe4f0 55%, #f5cde2 100%);"
    }
  },
  {
    productHandle: "accessory-glass-bow-straws",
    variantTitleIncludes: "Bow",
    metadata: {
      swatchType: "accessory",
      swatchGlyph: "🎀",
      swatchStyle:
        "display:flex; align-items:center; justify-content:center; color:#ffffff; font-size:0.7rem; line-height:1; background:#a7f3d0;"
    }
  },
  {
    productHandle: "accessory-jelly-lids",
    variantTitleIncludes: "Jelly accessory",
    metadata: {
      swatchType: "accessory",
      swatchGlyph: "🪼",
      swatchStyle:
        "display:flex; align-items:center; justify-content:center; color:#0f172a; font-size:0.7rem; line-height:1; background:#5eead4;"
    }
  },
  {
    productHandle: "accessory-flower-premium",
    variantTitleIncludes: "Premium package",
    metadata: {
      swatchType: "accessory",
      swatchGlyph: "💎",
      swatchStyle:
        "display:flex; align-items:center; justify-content:center; color:#3b2209; font-size:0.7rem; line-height:1; background: linear-gradient(135deg,#f7e0c3 0%,#d6a96a 60%,#b6813f 100%); box-shadow: inset 0 0 0 1px rgba(120,64,14,0.25);"
    }
  }
]

export default async function fixSwatchOverrides({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)

  for (const override of overrides) {
    const products = await productService.listProducts({
      handle: override.productHandle,
    })
    if (!products.length) {
      logger.warn(`Missing product ${override.productHandle}`)
      continue
    }
    const product = products[0]
    const variants = (await productService.listProductVariants(
      { product_id: product.id },
      { relations: ["options", "options.option"] }
    )) as any[]

    const needle = override.variantTitleIncludes.toLowerCase()
    const target =
      variants.find((variant) =>
        String(variant.title || "")
          .toLowerCase()
          .trim()
          .endsWith(`- ${needle}`)
      ) ||
      variants.find((variant) =>
        String(variant.title || "")
          .toLowerCase()
          .includes(needle)
      )
    if (!target) {
      logger.warn(
        `Missing variant containing '${override.variantTitleIncludes}' for ${override.productHandle}`
      )
      continue
    }
    const currentMeta =
      target.metadata && typeof target.metadata === "object" ? target.metadata : {}
    const nextMeta = { ...currentMeta, ...override.metadata }
    await productService.updateProductVariants(target.id, {
      metadata: nextMeta,
    })
    logger.info(
      `Updated ${override.productHandle} -> ${target.title} swatch metadata`
    )
  }
}

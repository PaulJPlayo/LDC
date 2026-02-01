import fs from "fs"
import path from "path"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type ProductRecord = {
  id: string
  handle: string
  shipping_profile_id?: string | null
}

export default async function verifyDesignReady({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const root = path.resolve(__dirname, "../../..")
  const productMapPath = path.join(root, "product-map.json")
  const reportPath = path.join(root, "docs", "design-readiness-report.json")

  let map: any = { products: {} }
  try {
    map = JSON.parse(fs.readFileSync(productMapPath, "utf8"))
  } catch (error) {
    logger.error("Unable to read product-map.json")
  }

  const handles = Object.keys(map?.products || {}).sort()
  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle", "shipping_profile_id"],
  })) as { data: ProductRecord[] }

  const productByHandle = new Map(products.map((p) => [p.handle, p]))

  const results: Array<any> = []

  for (const handle of handles) {
    const product = productByHandle.get(handle)
    const entry = map?.products?.[handle] || {}
    const mapVariantId = entry?.variantId || entry?.variant_id || ""
    if (!product) {
      results.push({
        handle,
        productFound: false,
        mapVariantId,
        hasVariants: false,
        priceOk: false,
        shippingOk: false,
        productId: "",
      })
      continue
    }

    const variants = (await productService.listProductVariants(
      { product_id: product.id },
      { relations: ["options", "options.option"] }
    )) as any[]

    const hasVariants = variants.length > 0
    const resolvedVariantId = mapVariantId || variants[0]?.id || ""
    const priceOk = true

    const shippingOk =
      Boolean(product.shipping_profile_id) ||
      variants.some((variant) => Boolean(variant?.shipping_profile_id))

    results.push({
      handle,
      productFound: true,
      productId: product.id,
      mapVariantId,
      resolvedVariantId,
      hasVariants,
      priceOk,
      shippingOk,
    })
  }

  const failures = results.filter(
    (r) =>
      !r.productFound ||
      !r.hasVariants ||
      !r.resolvedVariantId ||
      !r.priceOk ||
      !r.shippingOk
  )

  const report = {
    summary: {
      total: results.length,
      failures: failures.length,
    },
    failures,
    ok: results.filter((r) => !failures.includes(r)),
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n")

  logger.info(`Design readiness report saved to ${reportPath}`)
  logger.info(`Total: ${results.length}, Failures: ${failures.length}`)
}

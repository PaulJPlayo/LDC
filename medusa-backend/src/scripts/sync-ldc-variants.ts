import fs from "fs";
import path from "path";
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createProductVariantsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";

type SeedVariant = {
  label?: string;
  title?: string;
  price?: number;
  image?: string | null;
};

type SeedProduct = {
  key: string;
  title: string;
  handle: string;
  price: number;
  image?: string | null;
  variants?: SeedVariant[];
};

type ProductRecord = {
  id: string;
  handle: string;
  title: string;
};

const slugify = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeTitle = (value?: string | null) => slugify(value || "");

const cleanLabel = (value?: string | null) =>
  String(value || "")
    .replace(/^\s*View\s+/i, "")
    .replace(/\s*(swatch|accent|option)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const uniqValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean)));

export default async function syncLdcVariants({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productService = container.resolve(Modules.PRODUCT);

  const dataPath = path.resolve(__dirname, "ldc-products.json");
  const seedData = JSON.parse(fs.readFileSync(dataPath, "utf8")) as {
    currency: string;
    products: SeedProduct[];
  };
  const currencyCode = seedData.currency || "usd";

  const assetBase = (
    process.env.LDC_ASSET_BASE_URL ||
    process.env.STORE_ASSET_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/?$/, "/");

  const resolveImage = (src?: string | null) => {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    if (!assetBase) return src;
    return assetBase + src.replace(/^\/+/, "");
  };

  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle", "title"],
  })) as { data: ProductRecord[] };
  const productByHandle = new Map(
    products.map((product) => [product.handle, product])
  );

  const productMapPath = path.resolve(__dirname, "../../..", "product-map.json");
  const productMap = JSON.parse(fs.readFileSync(productMapPath, "utf8"));
  productMap.version = Math.max(2, productMap.version || 1);
  productMap.products = productMap.products || {};

  for (const seedProduct of seedData.products) {
    const product = productByHandle.get(seedProduct.handle);
    if (!product) {
      logger.warn(`Missing product for handle ${seedProduct.handle}`);
      continue;
    }

    const variants = (await productService.listProductVariants(
      { product_id: product.id },
      { relations: ["options", "options.option"] }
    )) as Array<{
      id: string;
      title: string;
      thumbnail?: string | null;
      options?: Array<{
        value?: string | null;
        option?: { title?: string | null };
        option_title?: string | null;
        optionTitle?: string | null;
      }>;
    }>;

    const existingByTitle = new Map(
      variants.map((variant: { id: string; title: string }) => [
        normalizeTitle(variant.title),
        variant,
      ])
    );

    const existingByLabel = new Map<string, { id: string; title: string }>();
    for (const variant of variants) {
      const options = Array.isArray(variant.options) ? variant.options : [];
      const styleOption = options.find(optionValue => {
        const optionTitle =
          optionValue.option?.title ||
          optionValue.option_title ||
          optionValue.optionTitle ||
          "";
        return optionTitle === "Style";
      });
      const label = cleanLabel(styleOption?.value || "");
      if (label) {
        existingByLabel.set(slugify(label), variant);
      }
    }
    const defaultVariant = variants.find(
      (variant: { title: string }) => normalizeTitle(variant.title) === "default"
    );
    let defaultUsed = false;

    const entry = productMap.products[seedProduct.handle] || {
      title: seedProduct.title,
    };
    entry.title = seedProduct.title || entry.title;

    const desiredVariants = Array.isArray(seedProduct.variants)
      ? seedProduct.variants
      : [];

    const desiredLabels = desiredVariants.length
      ? desiredVariants
          .map((variant) => cleanLabel(variant.label || variant.title || ""))
          .filter((value): value is string => Boolean(value))
      : ["Default"];

    const existingOptions = await productService.listProductOptions(
      { product_id: product.id, title: "Style" },
      { relations: ["values"] }
    );
    const styleOption = existingOptions[0];
    const existingValues =
      styleOption?.values?.map((value: { value: string }) => value.value) || [];
    const mergedValues = uniqValues([...existingValues, ...desiredLabels]);

    if (!styleOption) {
      await productService.createProductOptions({
        product_id: product.id,
        title: "Style",
        values: mergedValues,
      });
    } else if (
      mergedValues.length !== existingValues.length ||
      mergedValues.some((value) => !existingValues.includes(value))
    ) {
      await productService.updateProductOptions(styleOption.id, {
        values: mergedValues,
      });
    }

    const variantMap: Record<
      string,
      { label: string; variantId: string; image?: string | null }
    > = {};

    for (const desired of desiredVariants) {
      const label = cleanLabel(desired.label || desired.title || "Default");
      if (!label) continue;
      const title =
        desired.title || `${seedProduct.title || product.title} - ${label}`;
      const image = resolveImage(desired.image || seedProduct.image);
      const price =
        typeof desired.price === "number" ? desired.price : seedProduct.price;
      const labelKey = slugify(label);
      const metadata = image ? { preview_image: image } : undefined;

      let existing =
        existingByLabel.get(labelKey) ||
        existingByTitle.get(normalizeTitle(title));
      if (!existing && defaultVariant && !defaultUsed) {
        existing = defaultVariant;
        defaultUsed = true;
      }

      if (existing) {
        await updateProductVariantsWorkflow(container).run({
          input: {
            product_variants: [
              {
                id: existing.id,
                title,
                options: {
                  Style: label,
                },
                ...(metadata ? { metadata } : {}),
                prices: price
                  ? [
                      {
                        amount: price,
                        currency_code: currencyCode,
                      },
                    ]
                  : undefined,
              },
            ],
          },
        });
        variantMap[labelKey] = {
          label,
          variantId: existing.id,
          image,
        };
        continue;
      }

      const { result } = await createProductVariantsWorkflow(container).run({
        input: {
          product_variants: [
            {
              product_id: product.id,
              title,
              sku: `LDC-${seedProduct.key
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, "-")}-${labelKey.toUpperCase()}`,
              options: {
                Style: label,
              },
              ...(metadata ? { metadata } : {}),
              prices: price
                ? [
                    {
                      amount: price,
                      currency_code: currencyCode,
                    },
                  ]
                : [],
            },
          ],
        },
      });

      const created = result?.[0];
      if (created?.id) {
        variantMap[labelKey] = {
          label,
          variantId: created.id,
          image,
        };
      }
    }

    const productImage = resolveImage(
      seedProduct.image || desiredVariants[0]?.image || null
    );
    const shouldUpdateTitle =
      seedProduct.title && seedProduct.title !== product.title;
    const shouldUpdateImage = Boolean(productImage);

    if (shouldUpdateTitle || shouldUpdateImage) {
      const updatePayload: {
        id: string;
        title?: string;
        thumbnail?: string;
      } = {
        id: product.id,
      };

      if (shouldUpdateTitle) {
        updatePayload.title = seedProduct.title;
      }
      if (shouldUpdateImage) {
        updatePayload.thumbnail = productImage!;
      }

      await updateProductsWorkflow(container).run({
        input: {
          products: [
            updatePayload,
          ],
        },
      });

      if (shouldUpdateImage) {
        entry.image = productImage!;
      }
    }

    if (Object.keys(variantMap).length) {
      entry.variants = variantMap;
      const fallback = Object.values(variantMap)[0];
      if (fallback?.variantId) {
        entry.variantId = fallback.variantId;
      }
    } else if (!entry.variantId && variants[0]?.id) {
      entry.variantId = variants[0].id;
    }

    productMap.products[seedProduct.handle] = entry;
  }

  fs.writeFileSync(productMapPath, JSON.stringify(productMap, null, 2) + "\n");
  logger.info("Synced LDC variants and updated product-map.json");
}

import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";

const normalize = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getVariantLabel = (variant: {
  title?: string | null;
  options?: Array<{
    value?: string | null;
    option?: { title?: string | null };
    option_title?: string | null;
    optionTitle?: string | null;
  }>;
}) => {
  const options = Array.isArray(variant.options) ? variant.options : [];
  const styleOption = options.find((optionValue) => {
    const title =
      optionValue?.option?.title ||
      optionValue?.option_title ||
      optionValue?.optionTitle ||
      "";
    return title === "Style";
  });
  const raw = styleOption?.value || variant.title || "";
  return String(raw || "").trim();
};

export default async function normalizeVariantLabel({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const productService = container.resolve(Modules.PRODUCT);

  const [handle, ...labelParts] = args || [];
  const label = labelParts.join(" ").trim();

  if (!handle || !label) {
    throw new Error(
      "Usage: npx medusa exec ./src/scripts/normalize-variant-label.ts <handle> <label>"
    );
  }

  const products = await productService.listProducts({ handle });
  if (!products.length) {
    throw new Error(`Product not found for handle: ${handle}`);
  }
  const product = products[0];

  const variants = (await productService.listProductVariants(
    { product_id: product.id },
    { relations: ["options", "options.option"] }
  )) as Array<{
    id: string;
    title?: string | null;
    options?: Array<{
      value?: string | null;
      option?: { title?: string | null };
      option_title?: string | null;
      optionTitle?: string | null;
    }>;
  }>;

  const desiredKey = normalize(label);
  const existing = variants.find(
    (variant) => normalize(getVariantLabel(variant)) === desiredKey
  );
  const target = existing || variants[0];

  if (!target) {
    throw new Error(`No variants found for handle: ${handle}`);
  }

  const options = await productService.listProductOptions(
    { product_id: product.id, title: "Style" },
    { relations: ["values"] }
  );
  const styleOption = options[0];

  if (styleOption) {
    await productService.updateProductOptions(styleOption.id, {
      values: [label],
    });
  } else {
    await productService.createProductOptions({
      product_id: product.id,
      title: "Style",
      values: [label],
    });
  }

  await updateProductVariantsWorkflow(container).run({
    input: {
      product_variants: [
        {
          id: target.id,
          title: label,
          options: {
            Style: label,
          },
        },
      ],
    },
  });

  const deleteIds = variants
    .filter((variant) => variant.id !== target.id)
    .map((variant) => variant.id);

  if (deleteIds.length) {
    await productService.deleteProductVariants(deleteIds);
    logger.info(`Deleted ${deleteIds.length} extra variant(s).`);
  }

  logger.info(`Normalized ${handle} to a single "${label}" variant.`);
}

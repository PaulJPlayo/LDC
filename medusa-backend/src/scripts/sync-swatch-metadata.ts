import fs from "fs";
import path from "path";
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";

type SwatchMeta = {
  label: string;
  labelKey: string;
  style?: string;
  glyph?: string;
  type?: string;
};

type ProductVariantRecord = {
  id: string;
  metadata?: Record<string, unknown> | null;
  options?: Array<{
    value?: string | null;
    option?: { title?: string | null };
    option_title?: string | null;
    optionTitle?: string | null;
  }>;
};

type ProductRecord = {
  id: string;
  handle: string;
};

const HTML_FILES = [
  "index.html",
  "tumblers.html",
  "cups.html",
  "accessories.html",
  "best-sellers.html",
];

const decodeHtml = (value: string) =>
  String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const slugify = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const cleanLabel = (value: string) =>
  String(value || "")
    .replace(/^\s*View\s+/i, "")
    .replace(/\s*(swatch|accent|option)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const parseAttributes = (line: string) => {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match = regex.exec(line);
  while (match) {
    attrs[match[1]] = decodeHtml(match[2]);
    match = regex.exec(line);
  }
  return attrs;
};

const findCardStart = (lines: string[], index: number) => {
  for (let i = index; i >= 0 && i >= index - 200; i -= 1) {
    const line = lines[i];
    if (/<(div|article)[^>]*class="[^"]*product-card[^"]*"/.test(line)) {
      return i;
    }
    if (/<(div|article)[^>]*class="[^"]*group relative[^"]*"/.test(line)) {
      return i;
    }
  }
  return Math.max(0, index - 120);
};

const extractSwatches = (blockLines: string[]) => {
  const swatches: SwatchMeta[] = [];
  const block = blockLines.join("\n");
  const sliderPositions: number[] = [];
  const sliderRegex = /data-swatch-slider/gi;
  let sliderMatch = sliderRegex.exec(block);
  while (sliderMatch) {
    sliderPositions.push(sliderMatch.index);
    sliderMatch = sliderRegex.exec(block);
  }
  sliderPositions.sort((a, b) => a - b);

  const swatchRegex =
    /<span\b[^>]*class="[^"]*\bswatch\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let match = swatchRegex.exec(block);
  while (match) {
    const tag = match[0];
    const attrs = parseAttributes(tag);
    const className = attrs["class"] || "";
    if (
      /\bswatch-arrow\b/i.test(className) ||
      /\bswatch-slider\b/i.test(className) ||
      /\bswatch-slider-track\b/i.test(className) ||
      /\bswatch-slider-window\b/i.test(className)
    ) {
      match = swatchRegex.exec(block);
      continue;
    }
    const rawLabel =
      attrs["data-color-label"] ||
      attrs["data-accessory-label"] ||
      attrs["aria-label"] ||
      attrs["data-image-alt"] ||
      attrs["title"] ||
      "";
    const label = cleanLabel(rawLabel);
    if (!label) {
      match = swatchRegex.exec(block);
      continue;
    }
    const labelKey = slugify(label);
    let sliderIndex = 0;
    if (sliderPositions.length) {
      const swatchPos = match.index || 0;
      for (let i = 0; i < sliderPositions.length; i += 1) {
        if (sliderPositions[i] <= swatchPos) {
          sliderIndex = i;
        } else {
          break;
        }
      }
    }
    const style = attrs["style"];
    const type =
      attrs["data-swatch-type"] ||
      (attrs["data-accessory-label"] ? "accessory" : "") ||
      (sliderIndex > 0 ? "accessory" : "");
    let glyph = "";
    const raw = decodeHtml(match[1]).trim();
    if (raw) {
      glyph = raw;
    }
    swatches.push({
      label,
      labelKey,
      style: style || undefined,
      glyph: glyph || undefined,
      type: type || undefined,
    });
    match = swatchRegex.exec(block);
  }
  return swatches;
};

const mergeSwatches = (existing: SwatchMeta[], incoming: SwatchMeta[]) => {
  const map = new Map<string, SwatchMeta>();
  existing.forEach((item) => map.set(item.labelKey, { ...item }));
  incoming.forEach((item) => {
    const current = map.get(item.labelKey);
    if (!current) {
      map.set(item.labelKey, { ...item });
      return;
    }
    if (!current.style && item.style) current.style = item.style;
    if (!current.glyph && item.glyph) current.glyph = item.glyph;
    if (!current.type && item.type) current.type = item.type;
    map.set(item.labelKey, current);
  });
  return Array.from(map.values());
};

const readSwatchesByProduct = (root: string) => {
  const map = new Map<string, SwatchMeta[]>();
  const files = HTML_FILES.map((file) => path.join(root, file)).filter((file) =>
    fs.existsSync(file)
  );

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/data-product-key="([^"]+)"/);
      if (!match) continue;
      const key = match[1];
      const start = findCardStart(lines, i);
      const block = lines.slice(start, i + 1);
      const swatches = extractSwatches(block);
      if (!swatches.length) continue;
      const existing = map.get(key) || [];
      map.set(key, mergeSwatches(existing, swatches));
    }
  }
  return map;
};

const getVariantLabel = (variant: ProductVariantRecord) => {
  const options = Array.isArray(variant.options) ? variant.options : [];
  const styleOption = options.find((optionValue) => {
    const title =
      optionValue?.option?.title ||
      optionValue?.option_title ||
      optionValue?.optionTitle ||
      "";
    return /style|color|accent/i.test(title);
  });
  const label = cleanLabel(String(styleOption?.value || ""));
  return label || "Default";
};

const normalizeMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {} as Record<string, unknown>;
  }
  return { ...metadata };
};

export default async function syncSwatchMetadata({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productService = container.resolve(Modules.PRODUCT);

  const root = path.resolve(__dirname, "../../..");
  const swatchesByProduct = readSwatchesByProduct(root);
  if (!swatchesByProduct.size) {
    logger.warn("No swatches found in storefront HTML.");
    return;
  }

  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  })) as { data: ProductRecord[] };
  const productByHandle = new Map(
    products.map((product) => [product.handle, product])
  );

  const updates: Array<{
    id: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const [handle, swatches] of swatchesByProduct.entries()) {
    const product = productByHandle.get(handle);
    if (!product) {
      logger.warn(`Missing product for handle ${handle}.`);
      continue;
    }

    const variants = (await productService.listProductVariants(
      { product_id: product.id },
      { relations: ["options", "options.option"] }
    )) as ProductVariantRecord[];

    const variantByLabel = new Map<string, ProductVariantRecord>();
    variants.forEach((variant) => {
      const label = slugify(getVariantLabel(variant));
      if (label) {
        variantByLabel.set(label, variant);
      }
    });

    const allowFallback =
      variants.length === 1 && swatches.length === 1;
    const fallbackVariant = allowFallback ? variants[0] : undefined;

    for (const swatch of swatches) {
      const variant = variantByLabel.get(swatch.labelKey) || fallbackVariant;
      if (!variant) {
        logger.warn(
          `Missing variant for ${handle} swatch ${swatch.label}.`
        );
        continue;
      }
      if (!variant.id) {
        logger.warn(
          `Skipping swatch update for ${handle} (missing variant id).`
        );
        continue;
      }
      const metadata = normalizeMetadata(variant.metadata);
      if (swatch.style) metadata.swatchStyle = swatch.style;
      if (swatch.glyph) metadata.swatchGlyph = swatch.glyph;
      if (swatch.type) metadata.swatchType = swatch.type;
      updates.push({
        id: variant.id,
        metadata,
      });
    }
  }

  if (!updates.length) {
    logger.warn("No variant metadata updates to apply.");
    return;
  }

  const mergedUpdates = Array.from(
    updates.reduce((acc, update) => {
      const existing = acc.get(update.id);
      if (!existing) {
        acc.set(update.id, update);
        return acc;
      }
      acc.set(update.id, {
        id: update.id,
        metadata: {
          ...(existing.metadata || {}),
          ...(update.metadata || {}),
        },
      });
      return acc;
    }, new Map<string, { id: string; metadata: Record<string, unknown> }>())
  ).map(([, value]) => value);

  await updateProductVariantsWorkflow(container).run({
    input: {
      product_variants: mergedUpdates,
    },
  });

  logger.info(
    `Updated ${mergedUpdates.length} variant(s) with swatch metadata.`
  );
}

import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

type ProductRecord = {
  id: string;
  handle?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
};

type NormalizeResult =
  | {
      value: string[] | Record<string, unknown>;
      changed: boolean;
      reason: string;
    }
  | {
      value: string[];
      changed: boolean;
      reason: string;
    };

const SECTION_KEYS = [
  "new-arrivals",
  "best-sellers",
  "restock",
  "sale",
  "under-25",
  "last-chance",
];

const ensureString = (value: unknown) =>
  String(value ?? "").trim();

const dedupe = (items: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
};

const normalizeArray = (value: unknown[]): NormalizeResult => {
  const raw = value.map(ensureString).filter(Boolean);
  const normalized = dedupe(raw);
  const changed = JSON.stringify(raw) !== JSON.stringify(normalized);
  return {
    value: normalized,
    changed,
    reason: "normalized_array",
  };
};

const normalizeObject = (value: Record<string, unknown>): NormalizeResult => {
  const normalized: Record<string, unknown> = {};
  let changed = false;
  Object.entries(value).forEach(([key, val]) => {
    const trimmedKey = ensureString(key);
    if (!trimmedKey) {
      changed = true;
      return;
    }
    if (trimmedKey !== key) {
      changed = true;
    }
    normalized[trimmedKey] = val;
  });

  const sameKeys =
    Object.keys(value).length === Object.keys(normalized).length &&
    Object.keys(value).every((key) => ensureString(key) in normalized);
  if (!sameKeys) {
    changed = true;
  }

  return {
    value: normalized,
    changed,
    reason: "normalized_object",
  };
};

const normalizeSections = (input: unknown): NormalizeResult => {
  if (input === null || input === undefined) {
    return { value: [], changed: true, reason: "missing_sections" };
  }

  if (Array.isArray(input)) {
    return normalizeArray(input);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return { value: [], changed: true, reason: "empty_string_sections" };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeArray(parsed);
      }
      if (parsed && typeof parsed === "object") {
        return normalizeObject(parsed as Record<string, unknown>);
      }
    } catch {
      // Fall back to CSV parsing
    }
    const list = trimmed
      .split(",")
      .map(ensureString)
      .filter(Boolean);
    return {
      value: dedupe(list),
      changed: true,
      reason: "normalized_string",
    };
  }

  if (typeof input === "object") {
    return normalizeObject(input as Record<string, unknown>);
  }

  return { value: [], changed: true, reason: "invalid_sections" };
};

const chunk = <T,>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

export default async function normalizeStorefrontSections({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "metadata"],
  })) as { data: ProductRecord[] };

  const summary: Record<string, number> = {
    total: products.length,
    updated: 0,
    missing_metadata: 0,
    missing_sections: 0,
    empty_string_sections: 0,
    normalized_string: 0,
    normalized_array: 0,
    normalized_object: 0,
    invalid_sections: 0,
  };

  const updates: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  const updatedHandles: string[] = [];

  for (const product of products) {
    const reasons = new Set<string>();
    const metadata =
      product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
        ? { ...(product.metadata as Record<string, unknown>) }
        : null;

    let nextMetadata = metadata;
    if (!nextMetadata) {
      summary.missing_metadata += 1;
      reasons.add("missing_metadata");
      nextMetadata = {};
    }

    const normalized = normalizeSections(nextMetadata.storefront_sections);
    if (normalized.changed) {
      (summary as Record<string, number>)[normalized.reason] =
        (summary as Record<string, number>)[normalized.reason] + 1;
      reasons.add(normalized.reason);
      nextMetadata.storefront_sections = normalized.value;
    }

    if (reasons.size) {
      updates.push({ id: product.id, metadata: nextMetadata });
      const label = product.handle || product.title || product.id;
      updatedHandles.push(label);
    }
  }

  if (!updates.length) {
    logger.info("No storefront section metadata updates required.");
    logger.info(`Section keys allowed: ${SECTION_KEYS.join(", ")}`);
    return;
  }

  for (const batch of chunk(updates, 100)) {
    await updateProductsWorkflow(container).run({
      input: {
        products: batch,
      },
    });
  }

  summary.updated = updates.length;
  logger.info(`Updated ${summary.updated} of ${summary.total} product(s).`);
  logger.info(`Section keys allowed: ${SECTION_KEYS.join(", ")}`);
  logger.info(
    `Fix summary: ${Object.entries(summary)
      .filter(([key]) => key !== "total" && key !== "updated")
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`
  );
  logger.info(`Sample updated products: ${updatedHandles.slice(0, 12).join(", ")}`);
}

import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

type ProductRecord = {
  id: string;
  handle?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
};

type NormalizeResult<T> = {
  value: T;
  changed: boolean;
  reason: string;
};

const ensureString = (value: unknown) => String(value ?? "").trim();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

const normalizeArray = (value: unknown[]): NormalizeResult<string[]> => {
  const raw = value.map(ensureString).filter(Boolean);
  const normalized = dedupe(raw);
  const changed = JSON.stringify(raw) !== JSON.stringify(normalized);
  return {
    value: normalized,
    changed,
    reason: "normalized_array_sections",
  };
};

const normalizeSections = (input: unknown): NormalizeResult<string[]> => {
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
      if (isPlainObject(parsed)) {
        const keys = Object.keys(parsed).map(ensureString).filter(Boolean);
        return {
          value: dedupe(keys),
          changed: true,
          reason: "normalized_object_sections",
        };
      }
    } catch {
      // fall through to CSV
    }
    const list = trimmed
      .split(",")
      .map(ensureString)
      .filter(Boolean);
    return {
      value: dedupe(list),
      changed: true,
      reason: "normalized_string_sections",
    };
  }

  if (isPlainObject(input)) {
    const keys = Object.keys(input).map(ensureString).filter(Boolean);
    return {
      value: dedupe(keys),
      changed: true,
      reason: "normalized_object_sections",
    };
  }

  return { value: [], changed: true, reason: "invalid_sections" };
};

const normalizeOrder = (input: unknown): NormalizeResult<number | null> => {
  if (input === null || input === undefined) {
    return { value: null, changed: true, reason: "missing_order" };
  }

  if (typeof input === "number") {
    if (Number.isFinite(input)) {
      return { value: input, changed: false, reason: "order_ok" };
    }
    return { value: null, changed: true, reason: "invalid_order" };
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return { value: null, changed: true, reason: "empty_string_order" };
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return { value: parsed, changed: true, reason: "normalized_string_order" };
    }
    return { value: null, changed: true, reason: "invalid_order" };
  }

  return { value: null, changed: true, reason: "invalid_order" };
};

const chunk = <T,>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

export default async function normalizeProductMetadata({ container }: ExecArgs) {
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
    normalized_string_sections: 0,
    normalized_array_sections: 0,
    normalized_object_sections: 0,
    invalid_sections: 0,
    missing_order: 0,
    empty_string_order: 0,
    normalized_string_order: 0,
    invalid_order: 0,
  };

  const updates: Array<{ id: string; metadata: Record<string, unknown> }> = [];

  for (const product of products) {
    const reasons = new Set<string>();
    const metadata = isPlainObject(product.metadata)
      ? { ...(product.metadata as Record<string, unknown>) }
      : null;

    let nextMetadata = metadata;
    if (!nextMetadata) {
      summary.missing_metadata += 1;
      reasons.add("missing_metadata");
      nextMetadata = {};
    }

    const normalizedSections = normalizeSections(nextMetadata.storefront_sections);
    if (normalizedSections.changed) {
      summary[normalizedSections.reason] += 1;
      reasons.add(normalizedSections.reason);
      nextMetadata.storefront_sections = normalizedSections.value;
    }

    const normalizedOrder = normalizeOrder(nextMetadata.storefront_order);
    if (normalizedOrder.changed) {
      summary[normalizedOrder.reason] += 1;
      reasons.add(normalizedOrder.reason);
      nextMetadata.storefront_order = normalizedOrder.value;
    }

    if (reasons.size) {
      updates.push({ id: product.id, metadata: nextMetadata });
      const label = product.handle || product.title || product.id;
      logger.info(
        `Normalized ${label}: ${Array.from(reasons).sort().join(", ")}`
      );
    }
  }

  if (!updates.length) {
    logger.info("No product metadata updates required.");
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
  logger.info(
    `Fix summary: ${Object.entries(summary)
      .filter(([key]) => key !== "total" && key !== "updated")
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}`
  );
}

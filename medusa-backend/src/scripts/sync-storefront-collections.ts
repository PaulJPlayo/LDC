import fs from "fs";
import path from "path";
import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

type SectionKind = "collection" | "tag";

type SectionSpec = {
  key: string;
  kind: SectionKind;
  file: string;
  title?: string;
  handle?: string;
  tagValue?: string;
};

type ProductRecord = {
  id: string;
  handle: string;
  metadata?: Record<string, unknown> | null;
  tags?: { id: string; value?: string }[] | null;
  collection?: { id: string } | null;
};

const SECTION_SPECS: SectionSpec[] = [
  {
    key: "tumblers",
    kind: "collection",
    file: "tumblers.html",
    title: "Tumblers",
    handle: "tumblers",
  },
  {
    key: "cups",
    kind: "collection",
    file: "cups.html",
    title: "Cups",
    handle: "cups",
  },
  {
    key: "accessories",
    kind: "collection",
    file: "accessories.html",
    title: "Accessories",
    handle: "accessories",
  },
  {
    key: "best-sellers",
    kind: "tag",
    file: "best-sellers.html",
    tagValue: "Best Sellers",
  },
  {
    key: "new-arrivals",
    kind: "tag",
    file: "new-arrivals.html",
    tagValue: "New Arrivals",
  },
  {
    key: "sale",
    kind: "tag",
    file: "sale.html",
    tagValue: "Sale",
  },
  {
    key: "under-25",
    kind: "tag",
    file: "under-25.html",
    tagValue: "Under 25",
  },
];

const parseProductKeys = (filePath: string) => {
  if (!fs.existsSync(filePath)) return [];
  const contents = fs.readFileSync(filePath, "utf8");
  const regex = /data-product-key="([^"]+)"/g;
  const keys: string[] = [];
  const seen = new Set<string>();
  let match = regex.exec(contents);
  while (match) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    match = regex.exec(contents);
  }
  return keys;
};

const normalizeMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {} as Record<string, unknown>;
  }
  return { ...metadata };
};

const normalizeOrderMap = (metadata: Record<string, unknown>) => {
  const existing = metadata.storefront_order;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>) };
  }
  return {} as Record<string, unknown>;
};

const getSectionProducts = (
  root: string,
  section: SectionSpec
): string[] => {
  const filePath = path.resolve(root, section.file);
  return parseProductKeys(filePath);
};

export default async function syncStorefrontCollections({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productService = container.resolve(Modules.PRODUCT);

  const root = path.resolve(__dirname, "../../..");
  const sections = SECTION_SPECS.map((section) => ({
    ...section,
    handles: getSectionProducts(root, section),
  }));

  sections.forEach((section) => {
    if (!section.handles.length) {
      logger.warn(
        `No products found in ${section.file} for section ${section.key}.`
      );
    }
  });

  const { data: products } = (await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata", "collection.id", "tags.id", "tags.value"],
  })) as { data: ProductRecord[] };

  const productByHandle = new Map(
    products.map((product) => [product.handle, product])
  );

  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "handle", "title"],
  });
  const collectionByHandle = new Map(
    collections.map((collection: { id: string; handle?: string }) => [
      collection.handle,
      collection,
    ])
  );

  const { data: tags } = await query.graph({
    entity: "product_tag",
    fields: ["id", "value"],
  });
  const tagByValue = new Map(
    tags.map((tag: { id: string; value?: string }) => [tag.value, tag])
  );

  for (const section of sections.filter((item) => item.kind === "collection")) {
    if (!section.handle) continue;
    if (collectionByHandle.has(section.handle)) continue;
    const created = await productService.createProductCollections({
      title: section.title || section.handle,
      handle: section.handle,
    });
    const collection = Array.isArray(created) ? created[0] : created;
    if (collection?.handle) {
      collectionByHandle.set(collection.handle, collection);
      logger.info(`Created collection ${collection.handle}.`);
    }
  }

  for (const section of sections.filter((item) => item.kind === "tag")) {
    const value = section.tagValue || section.key;
    if (tagByValue.has(value)) continue;
    const created = await productService.createProductTags({
      value,
    });
    const tag = Array.isArray(created) ? created[0] : created;
    if (tag?.value) {
      tagByValue.set(tag.value, tag);
      logger.info(`Created tag ${tag.value}.`);
    }
  }

  const updates = new Map<
    string,
    { id: string; collection_id?: string; tag_ids?: string[]; metadata?: Record<string, unknown> }
  >();
  const tagSets = new Map<string, Set<string>>();

  const getUpdate = (product: ProductRecord) => {
    let update = updates.get(product.id);
    if (!update) {
      update = { id: product.id };
      updates.set(product.id, update);
    }
    return update;
  };

  const getTagSet = (product: ProductRecord, update: { tag_ids?: string[] }) => {
    let tagSet = tagSets.get(product.id);
    if (!tagSet) {
      const current = Array.isArray(product.tags)
        ? product.tags.map((tag) => tag.id).filter(Boolean)
        : [];
      tagSet = new Set(current);
      tagSets.set(product.id, tagSet);
      update.tag_ids = Array.from(tagSet);
    }
    return tagSet;
  };

  const setStorefrontOrder = (
    update: { metadata?: Record<string, unknown> },
    product: ProductRecord,
    sectionKey: string,
    order: number
  ) => {
    const metadata = update.metadata || normalizeMetadata(product.metadata);
    const storefrontOrder = normalizeOrderMap(metadata);
    storefrontOrder[sectionKey] = order;
    metadata.storefront_order = storefrontOrder;
    update.metadata = metadata;
  };

  for (const section of sections) {
    const handles = section.handles;
    if (!handles.length) continue;

    if (section.kind === "collection" && section.handle) {
      const collection = collectionByHandle.get(section.handle);
      if (!collection?.id) {
        logger.warn(`Missing collection ${section.handle}, skipping assignment.`);
        continue;
      }
      handles.forEach((handle, index) => {
        const product = productByHandle.get(handle);
        if (!product) {
          logger.warn(`Missing product for handle ${handle} in ${section.key}.`);
          return;
        }
        const update = getUpdate(product);
        update.collection_id = collection.id;
        setStorefrontOrder(update, product, section.key, index + 1);
      });
    }

    if (section.kind === "tag") {
      const tagValue = section.tagValue || section.key;
      const tag = tagByValue.get(tagValue);
      if (!tag?.id) {
        logger.warn(`Missing tag ${tagValue}, skipping assignment.`);
        return;
      }
      handles.forEach((handle, index) => {
        const product = productByHandle.get(handle);
        if (!product) {
          logger.warn(`Missing product for handle ${handle} in ${section.key}.`);
          return;
        }
        const update = getUpdate(product);
        const tagSet = getTagSet(product, update);
        tagSet.add(tag.id);
        update.tag_ids = Array.from(tagSet);
        setStorefrontOrder(update, product, section.key, index + 1);
      });
    }
  }

  const updatePayload = Array.from(updates.values());
  if (!updatePayload.length) {
    logger.info("No products to update.");
    return;
  }

  await updateProductsWorkflow(container).run({
    input: {
      products: updatePayload,
    },
  });

  logger.info(`Updated ${updatePayload.length} product(s).`);
}

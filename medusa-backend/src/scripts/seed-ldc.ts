import fs from "fs";
import path from "path";
import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

type LdcSeedProduct = {
  key: string;
  title: string;
  handle: string;
  price: number;
  image?: string | null;
  variants?: {
    label?: string;
    title?: string;
    price?: number;
    image?: string | null;
  }[];
};

export default async function seedLdcData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  const dataPath = path.resolve(__dirname, "ldc-products.json");
  const seedData = JSON.parse(fs.readFileSync(dataPath, "utf8")) as {
    currency: string;
    products: LdcSeedProduct[];
  };
  const currencyCode = seedData.currency || "usd";
  const assetBase =
    (process.env.LDC_ASSET_BASE_URL || process.env.STORE_ASSET_BASE_URL || "")
      .trim()
      .replace(/\/?$/, "/");

  if (!seedData.products?.length) {
    logger.warn("No LDC products found to seed.");
    return;
  }

  logger.info("Preparing LDC store data...");
  const [store] = await storeModuleService.listStores();
  if (!store) {
    throw new Error("No store found. Cannot seed products.");
  }

  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
          },
        ],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        {
          currency_code: currencyCode,
          is_default: true,
        },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  const countries = ["us"];
  const { data: regionData } = await query.graph({
    entity: "region",
    fields: ["id", "name"],
  });
  let region = regionData.find((item: { name: string }) =>
    item.name.toLowerCase().includes("united")
  );

  if (!region) {
    const { result: regionResult } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "United States",
            currency_code: currencyCode,
            countries,
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = regionResult[0];
  }

  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["country_code"],
  });
  const existingCountries = new Set(
    taxRegions.map((item: { country_code: string }) => item.country_code)
  );
  const missingCountries = countries.filter(
    (country) => !existingCountries.has(country)
  );

  if (missingCountries.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missingCountries.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
      })),
    });
  }

  const { data: locationData } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });
  let stockLocation = locationData.find(
    (item: { name: string }) => item.name === "LDC Warehouse"
  );

  if (!stockLocation) {
    const { result: stockLocationResult } = await createStockLocationsWorkflow(
      container
    ).run({
      input: {
        locations: [
          {
            name: "LDC Warehouse",
            address: {
              city: "Charlotte",
              country_code: "US",
              address_1: "",
            },
          },
        ],
      },
    });
    stockLocation = stockLocationResult[0];
  }

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_location_id: stockLocation.id,
      },
    },
  });

  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Default Shipping Profile",
              type: "default",
            },
          ],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const { data: fulfillmentSetData } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id"],
  });
  let fulfillmentSet = fulfillmentSetData.find(
    (item: { name: string }) => item.name === "LDC Warehouse delivery"
  );

  if (!fulfillmentSet) {
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "LDC Warehouse delivery",
      type: "shipping",
      service_zones: [
        {
          name: "United States",
          geo_zones: [
            {
              country_code: "us",
              type: "country",
            },
          ],
        },
      ],
    });
  }

  const safeLink = async (payload: Record<string, any>) => {
    try {
      await link.create(payload);
    } catch (error) {
      // Ignore duplicate link errors.
    }
  };

  await safeLink({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  await safeLink({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "service_zone_id"],
  });
  const serviceZoneId = fulfillmentSet.service_zones[0].id;
  const existingOptionNames = new Set(
    shippingOptions
      .filter((option: { service_zone_id: string }) => option.service_zone_id === serviceZoneId)
      .map((option: { name: string }) => option.name)
  );

  const allShippingOptions = [
    {
      name: "Standard Shipping",
      price_type: "flat" as const,
      provider_id: "manual_manual",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfile.id,
      type: {
        label: "Standard",
        description: "Ships in 3-5 days.",
        code: "standard",
      },
      prices: [
        {
          currency_code: currencyCode,
          amount: 10,
        },
        {
          region_id: region.id,
          amount: 10,
        },
      ],
      rules: [
        {
          attribute: "enabled_in_store",
          value: "true",
          operator: "eq" as const,
        },
        {
          attribute: "is_return",
          value: "false",
          operator: "eq" as const,
        },
      ],
    },
    {
      name: "Express Shipping",
      price_type: "flat" as const,
      provider_id: "manual_manual",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfile.id,
      type: {
        label: "Express",
        description: "Ships in 1-2 days.",
        code: "express",
      },
      prices: [
        {
          currency_code: currencyCode,
          amount: 20,
        },
        {
          region_id: region.id,
          amount: 20,
        },
      ],
      rules: [
        {
          attribute: "enabled_in_store",
          value: "true",
          operator: "eq" as const,
        },
        {
          attribute: "is_return",
          value: "false",
          operator: "eq" as const,
        },
      ],
    },
  ] as const;
  const optionsToCreate = allShippingOptions.filter(
    (option) => !existingOptionNames.has(option.name)
  );

  if (optionsToCreate.length) {
    await createShippingOptionsWorkflow(container).run({
      input: optionsToCreate as any,
    });
  }

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });

  const { data: apiKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "type"],
  });
  let publishableKey = apiKeys.find(
    (item: { title: string; type: string }) =>
      item.title === "LDC Storefront" && item.type === "publishable"
  );

  if (!publishableKey) {
    const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
      container
    ).run({
      input: {
        api_keys: [
          {
            title: "LDC Storefront",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });
    publishableKey = publishableApiKeyResult[0];
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });

  const keyOutputPath = path.resolve(
    __dirname,
    "../../..",
    "medusa-backend",
    "ldc-publishable-key.json"
  );
  fs.writeFileSync(
    keyOutputPath,
    JSON.stringify(
      {
        publishableKey: publishableKey.token,
        salesChannelId: defaultSalesChannel[0].id,
      },
      null,
      2
    ) + "\n"
  );

  logger.info("Seeding LDC products...");

  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  });
  const existingHandles = new Set(
    existingProducts.map((item: { handle: string }) => item.handle)
  );

  const resolveImage = (src?: string | null) => {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return src;
    if (!assetBase) return src;
    return assetBase + src.replace(/^\/+/, "");
  };

  const productsToCreate = seedData.products
    .filter((product) => !existingHandles.has(product.handle))
    .map((product) => ({
      title: product.title,
      handle: product.handle,
      status: ProductStatus.PUBLISHED,
      shipping_profile_id: shippingProfile.id,
      thumbnail: resolveImage(product.image) || undefined,
      metadata: {
        product_key: product.key,
      },
      options: [
        {
          title: "Style",
          values:
            product.variants?.length
              ? product.variants
                  .map((variant) => variant.label || variant.title)
                  .filter((value): value is string => Boolean(value))
              : ["Default"],
        },
      ],
      variants:
        product.variants?.length
          ? product.variants.map((variant, index) => {
              const label = variant.label || variant.title || "Default";
              const variantTitle =
                variant.title || `${product.title} - ${label}`;
              return {
                title: variantTitle,
                sku: `LDC-${product.key
                  .toUpperCase()
                  .replace(/[^A-Z0-9]+/g, "-")}-${index + 1}`,
                thumbnail: resolveImage(variant.image || product.image),
                options: {
                  Style: label,
                },
                prices: [
                  {
                    amount:
                      typeof variant.price === "number"
                        ? variant.price
                        : product.price,
                    currency_code: currencyCode,
                  },
                ],
              };
            })
          : [
              {
                title: "Default",
                sku: `LDC-${product.key
                  .toUpperCase()
                  .replace(/[^A-Z0-9]+/g, "-")}`,
                thumbnail: resolveImage(product.image),
                options: {
                  Style: "Default",
                },
                prices: [
                  {
                    amount: product.price,
                    currency_code: currencyCode,
                  },
                ],
              },
            ],
      sales_channels: [
        {
          id: defaultSalesChannel[0].id,
        },
      ],
    }));

  if (productsToCreate.length) {
    await createProductsWorkflow(container).run({
      input: {
        products: productsToCreate,
      },
    });
  }

  const { data: createdProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "variants.id"],
  });

  const productMapPath = path.resolve(__dirname, "../../..", "product-map.json");
  const productMap = JSON.parse(fs.readFileSync(productMapPath, "utf8"));
  const mapEntries = productMap.products || {};

  for (const product of createdProducts) {
    const handle = product.handle;
    const variantId = product.variants?.[0]?.id;
    if (variantId && mapEntries[handle]) {
      mapEntries[handle].variantId = variantId;
    }
  }

  fs.writeFileSync(productMapPath, JSON.stringify(productMap, null, 2) + "\n");

  logger.info("Seeding inventory levels...");
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = inventoryItems.map(
    (item: { id: string }) => ({
      location_id: stockLocation.id,
      stocked_quantity: 1000000,
      inventory_item_id: item.id,
    })
  );

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  });

  logger.info("LDC seed complete.");
}

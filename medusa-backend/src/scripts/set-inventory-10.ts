import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function setInventoryToTen({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryService = container.resolve(Modules.INVENTORY);

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });

  if (!stockLocations?.length) {
    logger.warn("No stock locations found. Inventory levels were not updated.");
    return;
  }

  const defaultLocationId = stockLocations[0].id;

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels = (await inventoryService.listInventoryLevels(
    {},
    { relations: ["inventory_item"] }
  )) as {
    id: string;
    location_id?: string;
    inventory_item_id?: string;
    inventory_item?: { id?: string };
  }[];

  const updates: {
    id: string;
    stocked_quantity: number;
    inventory_item_id: string;
    location_id: string;
  }[] = [];
  const creates: {
    inventory_item_id: string;
    location_id: string;
    stocked_quantity: number;
  }[] = [];

  const defaultLevelsByItem = new Set<string>();

  for (const level of inventoryLevels) {
    const inventoryItemId =
      level.inventory_item_id || level.inventory_item?.id || "";
    const locationId = level.location_id || "";

    if (!inventoryItemId || !locationId) {
      continue;
    }

    updates.push({
      id: level.id,
      stocked_quantity: 10,
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });

    if (locationId === defaultLocationId) {
      defaultLevelsByItem.add(inventoryItemId);
    }
  }

  for (const item of inventoryItems) {
    if (!defaultLevelsByItem.has(item.id)) {
      creates.push({
        inventory_item_id: item.id,
        location_id: defaultLocationId,
        stocked_quantity: 10,
      });
    }
  }

  if (updates.length) {
    await updateInventoryLevelsWorkflow(container).run({
      input: {
        updates,
      },
    });
  }

  if (creates.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: creates,
      },
    });
  }

  logger.info(
    `Set inventory to 10 (updated ${updates.length}, created ${creates.length}).`
  );
}

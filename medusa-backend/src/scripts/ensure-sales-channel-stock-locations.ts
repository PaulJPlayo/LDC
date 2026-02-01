import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows"

type SalesChannelRecord = { id: string }
type StockLocationRecord = { id: string }

export default async function ensureSalesChannelStockLocations({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: salesChannels } = (await query.graph({
    entity: "sales_channel",
    fields: ["id"],
  })) as { data: SalesChannelRecord[] }

  const { data: stockLocations } = (await query.graph({
    entity: "stock_location",
    fields: ["id"],
  })) as { data: StockLocationRecord[] }

  if (!salesChannels.length || !stockLocations.length) {
    logger.warn("No sales channels or stock locations found.")
    return
  }

  const channelIds = salesChannels.map((channel) => channel.id)
  for (const location of stockLocations) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: location.id,
        add: channelIds,
      },
    })
  }

  logger.info(
    `Linked ${salesChannels.length} sales channel(s) to ${stockLocations.length} stock location(s).`
  )
}

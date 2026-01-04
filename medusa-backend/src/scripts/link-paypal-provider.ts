import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

export default async function linkPayPalProvider({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const paymentModule = container.resolve(Modules.PAYMENT);
  const regionModule = container.resolve(Modules.REGION);

  const regions = await regionModule.listRegions();
  if (!regions.length) {
    throw new Error("No regions found. Run the seed script first.");
  }

  const region =
    regions.find((item: { name?: string }) =>
      item.name?.toLowerCase().includes("united")
    ) || regions[0];

  const providers = await paymentModule.listPaymentProviders();
  const paypalProvider = providers.find((provider: { id: string }) =>
    provider.id.includes("paypal")
  );

  if (!paypalProvider) {
    throw new Error("PayPal provider not found. Check medusa-config.ts setup.");
  }

  const { data: existingLinks } = await query.graph({
    entity: "region_payment_provider",
    fields: ["region_id", "payment_provider_id"],
    filters: {
      region_id: region.id,
      payment_provider_id: paypalProvider.id,
    },
  });

  if (existingLinks.length) {
    logger.info("PayPal provider already linked to region.");
    return;
  }

  await link.create({
    [Modules.REGION]: { region_id: region.id },
    [Modules.PAYMENT]: { payment_provider_id: paypalProvider.id },
  });

  logger.info(`Linked PayPal provider (${paypalProvider.id}) to ${region.name}.`);
}

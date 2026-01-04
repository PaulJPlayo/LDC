import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import PayPalProviderService from "./paypal";

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayPalProviderService],
});

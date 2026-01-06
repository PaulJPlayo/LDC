import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

export default async function createAdminUser({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const userService = container.resolve(Modules.USER);
  const authService = container.resolve(Modules.AUTH);

  const [emailArg, passwordArg] = (args ?? []) as string[];
  const email = emailArg || process.env.ADMIN_EMAIL;
  const password = passwordArg || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Missing email or password. Pass them as args or set ADMIN_EMAIL/ADMIN_PASSWORD."
    );
  }

  const existing = await userService.listUsers({ email });
  if (existing.length) {
    logger.info(`User already exists for ${email}.`);
    return;
  }

  const user = await userService.createUsers({ email });
  const { authIdentity, error } = await authService.register("emailpass", {
    body: {
      email,
      password,
    },
  });

  if (error || !authIdentity) {
    throw new Error("Failed to register auth identity.");
  }

  await authService.updateAuthIdentities({
    id: authIdentity.id,
    app_metadata: {
      user_id: user.id,
    },
  });

  logger.info("Admin user created successfully.");
}

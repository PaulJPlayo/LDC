import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

type PriceSummary = {
  total?: number;
  to_update?: number;
  min_amount?: string | number | null;
  max_amount?: string | number | null;
};

const parseNumber = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export default async function normalizePriceAmounts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const summaryResult = await pg.raw(`
    select
      count(*)::int as total,
      sum(case when amount < 1000 and mod(amount, 100) <> 0 then 1 else 0 end)::int as to_update,
      min(amount) as min_amount,
      max(amount) as max_amount
    from price
    where deleted_at is null
  `);

  const summaryRows = Array.isArray(summaryResult?.rows)
    ? summaryResult.rows
    : Array.isArray(summaryResult)
      ? summaryResult
      : [];
  const summary = (summaryRows[0] || {}) as PriceSummary;

  const total = parseNumber(summary.total) ?? 0;
  const toUpdate = parseNumber(summary.to_update) ?? 0;
  const minAmount = parseNumber(summary.min_amount);
  const maxAmount = parseNumber(summary.max_amount);

  logger.info(
    `Price audit: total=${total} to_update=${toUpdate} min=${minAmount ?? "-"} max=${maxAmount ?? "-"}`
  );

  if (!toUpdate) {
    logger.info("No prices matched the normalization rule. No changes applied.");
    return;
  }

  const updateResult = await pg.raw(`
    update price
    set amount = amount * 100
    where deleted_at is null
      and amount < 1000
      and mod(amount, 100) <> 0
  `);

  const updatedCount =
    parseNumber(updateResult?.rowCount) ??
    parseNumber(updateResult?.rowcount) ??
    null;

  logger.info(
    `Normalized price amounts: updated=${updatedCount ?? toUpdate}.`
  );
}

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260120182454 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "gift_card" drop constraint if exists "gift_card_code_unique";`);
    this.addSql(`create table if not exists "gift_card" ("id" text not null, "code" text not null, "value" integer not null, "balance" integer not null, "currency_code" text not null, "region_id" text not null, "is_disabled" boolean not null default false, "ends_at" timestamptz null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "gift_card_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gift_card_code_unique" ON "gift_card" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_gift_card_deleted_at" ON "gift_card" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gift_card" cascade;`);
  }

}

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260429130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "customer_saved_item" ("id" text not null, "customer_id" text not null, "type" text not null, "favorite_key" text null, "dedupe_key" text not null, "source_path" text null, "product_id" text null, "product_handle" text null, "product_key" text null, "variant_id" text null, "title" text not null, "variant_title" text null, "description" text null, "short_description" text null, "image_url" text null, "preview_image" text null, "preview_style" text null, "quantity" integer not null default 1, "currency_code" text not null default 'USD', "price_snapshot_amount" integer null, "price_snapshot_display" text null, "selected_options" jsonb not null default '[]'::jsonb, "item_payload" jsonb not null default '{}'::jsonb, "line_item_metadata" jsonb null, "notes" text null, "upload_references" jsonb not null default '[]'::jsonb, "live_reference" jsonb null, "archived_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_saved_item_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_saved_item" drop constraint if exists "customer_saved_item_type_check";`);
    this.addSql(`alter table "customer_saved_item" add constraint "customer_saved_item_type_check" check ("type" in ('product_favorite', 'attire_build', 'doormat_build', 'custom_design', 'seasonal_design', 'note'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_customer_id" ON "customer_saved_item" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_customer_type" ON "customer_saved_item" ("customer_id", "type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_customer_updated_at" ON "customer_saved_item" ("customer_id", "updated_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_product_id" ON "customer_saved_item" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_variant_id" ON "customer_saved_item" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_product_handle" ON "customer_saved_item" ("product_handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_item_deleted_at" ON "customer_saved_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UIDX_customer_saved_item_customer_dedupe_active" ON "customer_saved_item" ("customer_id", "dedupe_key") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_saved_upload_reference" ("id" text not null, "customer_id" text not null, "saved_item_id" text null, "provider" text not null default 's3', "key" text not null, "filename" text not null, "content_type" text null, "size" integer null, "status" text not null default 'active', "metadata" jsonb null, "uploaded_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_saved_upload_reference_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_saved_upload_reference" drop constraint if exists "customer_saved_upload_reference_status_check";`);
    this.addSql(`alter table "customer_saved_upload_reference" add constraint "customer_saved_upload_reference_status_check" check ("status" in ('pending', 'active', 'deleted'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_upload_reference_customer_id" ON "customer_saved_upload_reference" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_upload_reference_saved_item_id" ON "customer_saved_upload_reference" ("saved_item_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_upload_reference_status" ON "customer_saved_upload_reference" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_upload_reference_deleted_at" ON "customer_saved_upload_reference" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UIDX_customer_saved_upload_reference_key" ON "customer_saved_upload_reference" ("key") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_saved_cart" ("id" text not null, "customer_id" text not null, "name" text null, "status" text not null default 'active', "currency_code" text not null default 'USD', "region_id" text null, "cart_snapshot" jsonb not null default '{}'::jsonb, "line_items" jsonb not null default '[]'::jsonb, "item_count" integer not null default 0, "subtotal_snapshot_amount" integer null, "dedupe_key" text null, "archived_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_saved_cart_pkey" primary key ("id"));`);
    this.addSql(`alter table "customer_saved_cart" drop constraint if exists "customer_saved_cart_status_check";`);
    this.addSql(`alter table "customer_saved_cart" add constraint "customer_saved_cart_status_check" check ("status" in ('active', 'archived', 'deleted'));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_cart_customer_id" ON "customer_saved_cart" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_cart_status" ON "customer_saved_cart" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_cart_customer_status" ON "customer_saved_cart" ("customer_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_cart_customer_updated_at" ON "customer_saved_cart" ("customer_id", "updated_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_saved_cart_deleted_at" ON "customer_saved_cart" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UIDX_customer_saved_cart_customer_dedupe_active" ON "customer_saved_cart" ("customer_id", "dedupe_key") WHERE deleted_at IS NULL AND dedupe_key IS NOT NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_saved_cart" cascade;`);
    this.addSql(`drop table if exists "customer_saved_upload_reference" cascade;`);
    this.addSql(`drop table if exists "customer_saved_item" cascade;`);
  }

}

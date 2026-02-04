# LDC Admin Studio Parity Audit (Medusa Admin)
Date: 2026-01-20

Legend:
- [x] Implemented in LDC Admin Studio
- [~] Implemented but needs manual verification
- [ ] Missing / Not implemented

## Authentication & Session
- [~] Admin login via email/password
- [~] Session persistence + logout
- [ ] Role-based access enforcement (admin vs member permissions)

## Dashboard
- [~] KPI tiles (revenue, orders, AOV)
- [~] Latest orders, draft orders, returns, exchanges
- [~] Low stock module
- [~] Notification panel

## Orders
- [~] List + filters (status/payment/fulfillment) + bulk actions + export
- [~] Order detail (items, totals, payments, shipping)
- [~] Capture/refund payments
- [~] Fulfillment workflow + tracking/label + delivery
- [~] Returns/exchanges from order
- [~] Internal notes + activity feed

## Draft Orders
- [~] Create with shipping method + custom items
- [~] Edit flow + convert to order
- [~] Detail parity with orders

## Returns & Exchanges
- [~] Returns list + detail + cancel
- [~] Exchange list + detail + cancel
- [~] Inbound return shipping with labels/tracking
- [~] Exchange inbound/outbound items + shipping
- [~] Return reasons CRUD
- [~] Refund reasons CRUD

## Products & Variants
- [~] Product list filters + archive + bulk actions + export
- [~] Product detail editing (title, status, description, thumbnail, collections, categories, sales channels)
- [~] Variant list + detail + edit
- [~] Variant creation from product + variant page
- [~] Product/variant thumbnails + media library integration
- [~] Product import (CSV) + status checks
- [ ] Advanced media gallery ordering/pinning (Medusa Admin has richer controls)

## Catalog Structure
- [~] Collections CRUD + bulk assignment + thumbnails
- [~] Categories CRUD + bulk assignment + thumbnails
- [~] Product types CRUD + assignment
- [~] Product tags CRUD + assignment

## Pricing, Promotions, Campaigns
- [~] Price lists CRUD + rules/conditions
- [~] Promotions CRUD
- [~] Campaigns CRUD

## Customers
- [~] Customer list filters + bulk actions + export
- [~] Customer detail edit + notes + metadata
- [~] Customer groups CRUD + assignment + notes

## Inventory & Locations
- [~] Inventory list filters (location/low stock/managed)
- [~] Bulk edit stock levels
- [~] Inventory item detail with per-location levels
- [~] Stock locations CRUD + view inventory
- [ ] Inventory transfers (not in UI)

## Gift Cards
- [~] Issue + list + detail (balance + disable)

## Operations / Settings
- [~] Regions CRUD + payment providers
- [~] Shipping profiles CRUD
- [~] Shipping options CRUD + service zones
- [~] Tax regions/rates CRUD + rules
- [~] Sales channels CRUD + product availability
- [~] Store settings (currencies/locales/defaults)
- [~] API keys CRUD
- [~] Team members CRUD + role edit
- [~] Invites CRUD + resend
- [~] Notifications feed + export links
- [~] Uploads/media library (upload/delete/copy URL)

## Known Differences / Gaps
- Role enforcement not implemented (member/admin permissions are not gated).
- Fulfillment set/service zone management UI is minimal (no dedicated management screens).
- Notifications management lacks mark read/clear controls.
- Media gallery controls are simpler than Medusa Admin (no image ordering/pinning beyond thumbnail).
- Some screens depend on backend configuration (payment/tax/fulfillment providers); missing providers show load errors.

## Verification Needed (Manual QA)
- End-to-end order lifecycle: payment → fulfillment → shipment → delivery
- Returns/exchanges with labels + tracking links
- Export CSV links from notifications
- Product import status report + data updates
- Gift card issuance + balance changes

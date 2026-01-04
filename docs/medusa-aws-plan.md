# Medusa + AWS Plan (LDC)

## Goal
Use a Medusa backend on AWS to power real checkout, customer accounts, and automated email/SMS messaging while keeping the current static site UI.

## Why Medusa
- Matches the existing JS/TS stack.
- Lightweight compared to heavier headless platforms.
- Storefront APIs cover carts, customers, and orders without requiring an admin UI.

## High-Level Architecture
- Frontend: S3 static hosting + CloudFront CDN (current site).
- Backend API: Medusa server (ECS/Fargate or EC2/Lightsail).
- Database: Postgres (RDS).
- Cache/queue: Redis (ElastiCache) for sessions + cart state.
- Email: Amazon SES (order confirmations, shipping updates, account emails).
- SMS: Twilio or AWS SNS (order/shipping alerts).
- Payments: PayPal (primary).
- Assets: S3 for product images, uploads, and attachments.

## Data Flow (Storefront)
1. Customer browses products (static UI).
2. "Add to cart" calls Medusa Store API to create or update a cart.
3. Cart drawer reads from Medusa cart and updates badge counts.
4. Checkout creates a payment session (PayPal) and completes the order.
5. Order completion triggers email + SMS via webhook handlers.
6. Customer accounts are managed via Medusa customer endpoints.

## Key API Endpoints (Medusa Store API)
- POST /store/carts -> create cart
- POST /store/carts/{id}/line-items -> add item
- POST /store/carts/{id}/line-items/{line_id} -> update item
- DELETE /store/carts/{id}/line-items/{line_id} -> remove item
- GET /store/carts/{id} -> read cart
- POST /store/auth -> customer login
- POST /store/customers -> customer sign up
- GET /store/customers/me -> customer profile
- GET /store/customers/me/orders -> order history
- POST /store/carts/{id}/payment-sessions -> init payment

## Required Environment Variables (Backend)
- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- COOKIE_SECRET
- MEDUSA_BACKEND_URL
- STORE_CORS (frontend origins)
- ADMIN_CORS (future use)
- PAYPAL_CLIENT_ID
- PAYPAL_CLIENT_SECRET
- PAYPAL_ENV (sandbox|live)
- SES_REGION / SES_FROM_EMAIL
- TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER (if Twilio)

## Frontend Integration Plan
- Add a shared `commerce.js` that:
  - Creates/loads a Medusa cart ID and stores it in localStorage.
  - Syncs cart counts into the existing badge UI.
  - Replaces current localStorage cart actions when `window.LDC_MEDUSA_ENABLED = true`.
  - Handles login/sign-up using Medusa customer endpoints.
- Enable the storefront by setting `data-medusa-enabled=\"true\"` and `data-medusa-backend=\"https://api.example.com\"` on the `<body>`.
- Add `product-map.json` to map storefront product keys to Medusa variant IDs.
- Add a customer account page (basic order history list).
- Replace the static checkout page with a Medusa-powered flow.

## Product Mapping Notes
- Each add-to-cart button can declare `data-product-key`.
- `product-map.json` maps that key to a Medusa `variantId`.
- If no key is supplied, `commerce.js` tries to derive one from the card title.

## Account Page Notes
- `account.html` ships with `data-medusa-enabled=\"true\"` and a localhost backend URL.
- Update `data-medusa-backend` to your API domain before going live.

## Product Data Strategy (No Admin UI)
- Use Medusa seed scripts or API calls to create products + variants.
- Maintain a `product-map.json` (page element -> variant ID) to connect existing UI buttons to Medusa variants.

## Email + SMS Automation
- Medusa order events trigger:
  - Email: SES (order confirmation, shipped, refund).
  - SMS: Twilio or SNS (order confirmation + shipping updates).
- Use Medusa subscribers/webhooks to dispatch messages.

## Deployment Steps (AWS)
1. Create Postgres (RDS) + Redis (ElastiCache).
2. Deploy Medusa API to ECS/Fargate (or EC2/Lightsail) with env vars.
3. Configure PayPal app + webhook endpoint.
4. Configure SES + SMS provider.
5. Upload frontend to S3 + CloudFront.
6. Set CORS for Medusa to allow the site domain.

## Next Build Tasks
- Scaffold Medusa backend in this repo.
- Implement `commerce.js` and hook into cart + auth flows.
- Create account/orders page.
- Add a product mapping layer for variant IDs.
- Replace static checkout with Medusa flow.

## Implementation Checklist (Next Steps)
- Install backend dependencies (`yarn install` in `medusa-backend`).
- Configure `.env` with Postgres, Redis, and CORS origins.
- Add PayPal payment provider and webhook handling.
- Wire SES email templates and SMS provider (Twilio or SNS).
- Seed products and generate variant IDs for the storefront mapping.
- Enable `data-medusa-enabled=\"true\"` on the storefront when API is live.
- Populate `product-map.json` with real Medusa variant IDs.
- Use `account.html` as the customer account + order history page.

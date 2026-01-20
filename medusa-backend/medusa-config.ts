import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const parseCors = (value?: string) =>
  (value || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

const withPreviewOrigins = (list: string[]) => {
  const defaults = [
    'http://127.0.0.1:5501',
    'http://localhost:5174',
    'https://admin.lovettsldc.com'
  ]
  defaults.forEach(origin => {
    if (!list.includes(origin)) {
      list.push(origin)
    }
  })
  return list
}

const storeCors = withPreviewOrigins(parseCors(process.env.STORE_CORS)).join(',')
const adminCors = withPreviewOrigins(parseCors(process.env.ADMIN_CORS)).join(',')
const authCors = withPreviewOrigins(parseCors(process.env.AUTH_CORS)).join(',')
const databaseDriverOptions =
  process.env.DATABASE_SSL === 'true'
    ? { connection: { ssl: { rejectUnauthorized: false } } }
    : undefined

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors,
      adminCors,
      authCors,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: {
    payment: {
      options: {
        providers: [
          {
            resolve: "./src/providers/paypal/index.ts",
            id: "paypal",
            options: {
              clientId: process.env.PAYPAL_CLIENT_ID,
              clientSecret: process.env.PAYPAL_CLIENT_SECRET,
              mode: process.env.PAYPAL_MODE || "sandbox",
              brandName: process.env.PAYPAL_BRAND_NAME || "Lovett's Designs & Crafts",
            },
          },
        ],
      },
    },
    gift_cards: {
      resolve: "./src/modules/gift-cards"
    }
  },
  admin: {
    disable: false
  }
})

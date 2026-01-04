import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const parseCors = (value?: string) =>
  (value || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

const withLocalPreview = (list: string[]) => {
  if (!list.includes('http://127.0.0.1:5501')) {
    list.push('http://127.0.0.1:5501')
  }
  return list
}

const storeCors = withLocalPreview(parseCors(process.env.STORE_CORS)).join(',')
const adminCors = withLocalPreview(parseCors(process.env.ADMIN_CORS)).join(',')
const authCors = withLocalPreview(parseCors(process.env.AUTH_CORS)).join(',')

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
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
  },
  admin: {
    disable: false
  }
})

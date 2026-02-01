import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PutObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import crypto from "crypto"

type UploadBody = {
  filename?: string
  content_type?: string
  data_url?: string
}

const MAX_BYTES = Number(process.env.LDC_S3_MAX_BYTES || 6 * 1024 * 1024)
const BUCKET = process.env.LDC_S3_BUCKET || ""
const REGION = process.env.AWS_REGION || process.env.LDC_S3_REGION || "us-east-2"
const PREFIX = (process.env.LDC_S3_PREFIX || "design-attachments").replace(/\/+$/, "")
const PUBLIC_BASE = (process.env.LDC_S3_PUBLIC_URL || "").replace(/\/+$/, "")
const SIGNED_TTL = Number(process.env.LDC_S3_SIGNED_URL_TTL || 60 * 60 * 24 * 7)

const getClient = () => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.LDC_S3_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY || process.env.LDC_S3_SECRET_ACCESS_KEY
  const sessionToken = process.env.AWS_SESSION_TOKEN
  const credentials =
    accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey, sessionToken }
      : undefined
  return new S3Client({ region: REGION, credentials })
}

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120)

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { contentType: match[1], data: match[2] }
}

const buildKey = (filename: string) => {
  const now = new Date()
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(
    now.getUTCDate()
  ).padStart(2, "0")}`
  return `${PREFIX}/${datePath}/${crypto.randomUUID()}-${filename}`
}

const buildUrl = async (client: S3Client, key: string) => {
  if (PUBLIC_BASE) return `${PUBLIC_BASE}/${key}`
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(client, command, { expiresIn: SIGNED_TTL })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!BUCKET) {
    res.status(500).json({ message: "Attachment storage bucket is not configured." })
    return
  }
  const body = (req.body || {}) as UploadBody
  const rawName = body.filename || "design-attachment"
  const safeName = sanitizeFilename(rawName) || "design-attachment"
  const dataUrl = body.data_url || ""
  const parsed = parseDataUrl(dataUrl)
  if (!parsed?.data) {
    res.status(400).json({ message: "Invalid attachment payload." })
    return
  }
  const buffer = Buffer.from(parsed.data, "base64")
  if (buffer.byteLength > MAX_BYTES) {
    res.status(413).json({ message: "Attachment is too large." })
    return
  }
  const key = buildKey(safeName)
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: body.content_type || parsed.contentType || "application/octet-stream"
    })
  )
  const url = await buildUrl(client, key)
  res.json({ key, filename: safeName, url })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!BUCKET) {
    res.status(500).json({ message: "Attachment storage bucket is not configured." })
    return
  }
  const key = String(req.query.key || "").trim()
  if (!key) {
    res.status(400).json({ message: "Missing attachment key." })
    return
  }
  const client = getClient()
  const url = await buildUrl(client, key)
  res.json({ key, url })
}

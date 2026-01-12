import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils"
import fs from "fs/promises"
import path from "path"

type FileEntry = {
  key: string
  filename: string
  created_at: string
  size: number
  mtimeMs: number
}

const defaultUploadDir = () => path.join(process.cwd(), "static")

const readFilesRecursive = async (dir: string, baseDir: string) => {
  const entries: FileEntry[] = []
  let dirEntries: fs.Dirent[] = []

  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err: any) {
    if (err?.code === "ENOENT") return entries
    throw err
  }

  for (const entry of dirEntries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const childEntries = await readFilesRecursive(fullPath, baseDir)
      entries.push(...childEntries)
      continue
    }
    if (!entry.isFile()) continue
    const stats = await fs.stat(fullPath)
    const relativePath = path
      .relative(baseDir, fullPath)
      .split(path.sep)
      .join("/")
    entries.push({
      key: relativePath,
      filename: path.basename(relativePath),
      created_at: stats.birthtime.toISOString(),
      size: stats.size,
      mtimeMs: stats.mtimeMs
    })
  }

  return entries
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fileModuleService = req.scope.resolve(Modules.FILE)
  const limit = Number(req.query.limit ?? 50)
  const offset = Number(req.query.offset ?? 0)
  const query = String(req.query.q ?? "").trim().toLowerCase()

  const baseDir = defaultUploadDir()
  const entries = await readFilesRecursive(baseDir, baseDir)
  const filtered = query
    ? entries.filter((entry) => {
        const haystack = `${entry.filename} ${entry.key}`.toLowerCase()
        return haystack.includes(query)
      })
    : entries

  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const paged = filtered.slice(offset, offset + Math.max(1, limit || 0))
  const files = await Promise.all(
    paged.map(async (entry) => {
      let url = ""
      try {
        const result = await fileModuleService.retrieveFile(entry.key)
        url = result?.url || ""
      } catch {
        url = ""
      }
      return {
        id: entry.key,
        filename: entry.filename,
        url,
        size: entry.size,
        created_at: entry.created_at
      }
    })
  )

  res.json({ files, count: filtered.length })
}

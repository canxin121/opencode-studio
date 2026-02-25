import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'src')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue'])

const TYPE_IMPORT_FROM_VUE_RE =
  /import\s+type\s+\{[^}]+\}\s+from\s+['"][^'"]+\.vue['"]|import\s+[^\n]*\{[^}]*type[^}]*\}\s+from\s+['"][^'"]+\.vue['"]/m
const EXPORTED_TYPE_IN_VUE_RE = /export\s+type\s+\w+/m

const violations = []

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath)
      continue
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    await checkFile(fullPath)
  }
}

async function checkFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
  const text = await readFile(filePath, 'utf8')

  if (TYPE_IMPORT_FROM_VUE_RE.test(text)) {
    violations.push(`${relPath}: type import from .vue is not allowed`)
  }

  if (filePath.endsWith('.vue') && EXPORTED_TYPE_IN_VUE_RE.test(text)) {
    violations.push(`${relPath}: exporting types from .vue is not allowed`)
  }
}

await walk(ROOT)

if (violations.length > 0) {
  console.error('Import rule violations found:\n')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Import rules check passed.')

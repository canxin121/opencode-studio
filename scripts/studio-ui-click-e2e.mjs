#!/usr/bin/env node
/*
  Playwright-driven UI usage checks for OpenCode Studio.

  Goal: simulate a human opening the UI, selecting a directory, creating a session,
  using composer tools, and navigating a couple of core surfaces.

  This script is intended to be used in manual GitHub Actions and local debugging.
  It does not ship in release artifacts.
*/

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function usage() {
  const msg = `
Usage:
  studio-ui-click-e2e.mjs (--base-url URL | --cdp-url URL) [--directory PATH] [--timeout SECONDS] [--label NAME] [--out-dir PATH] [--headed]

Options:
  --base-url URL     Base URL of the Studio backend (service UI test, uses external browser)
  --cdp-url URL      Chrome DevTools endpoint to attach (desktop WebView test, in-app)
  --directory PATH   Directory to select via UI (default: cwd)
  --timeout SECONDS  Overall timeout for UI waits (default: 180)
  --label NAME       Label used to name the output folder (default: ui)
  --out-dir PATH     Base output dir (default: $STUDIO_UI_E2E_OUT_DIR or temp dir)
  --headed           Run Chromium headed (default: headless)

Artifacts:
  - trace.zip, screenshot.png, page.html, run.log
`
  process.stdout.write(msg)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || '')
    if (!a) continue
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }

    const eq = a.indexOf('=')
    if (eq >= 0) {
      out[a.slice(0, eq)] = a.slice(eq + 1)
      continue
    }

    const key = a
    const next = argv[i + 1]
    if (next && !String(next).startsWith('--')) {
      out[key] = String(next)
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

function normalizeBaseUrl(raw) {
  const txt = String(raw || '').trim().replace(/\/+$/g, '')
  if (!txt) return ''
  if (!/^https?:\/\//i.test(txt)) return ''
  return txt
}

function normalizeLabel(raw) {
  const txt = String(raw || '').trim()
  if (!txt) return 'ui'
  const safe = txt.replace(/[^A-Za-z0-9._-]+/g, '-')
  return safe || 'ui'
}

function normalizeDirectory(raw) {
  const txt = String(raw || '').trim()
  if (!txt) return ''
  // Match UI-side normalization: treat backslashes as slashes.
  return txt.replace(/\\/g, '/')
}

function directoryEntryLabel(directory) {
  const norm = normalizeDirectory(directory).replace(/\/+$/g, '')
  if (!norm) return 'Project'
  const parts = norm.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : norm
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

function nowStamp() {
  const d = new Date()
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(
    d.getSeconds(),
  )}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args['--help'] || args['-h']) {
    usage()
    process.exit(0)
  }

  const baseUrl = normalizeBaseUrl(args['--base-url'])
  const cdpUrl = normalizeBaseUrl(args['--cdp-url'])
  if (!baseUrl && !cdpUrl) {
    usage()
    throw new Error('either --base-url or --cdp-url is required (http/https URL)')
  }
  const mode = cdpUrl ? 'cdp' : 'web'

  const timeoutSecondsRaw = args['--timeout'] ?? process.env.STUDIO_UI_E2E_TIMEOUT ?? '180'
  const timeoutSeconds = Number.parseInt(String(timeoutSecondsRaw), 10)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10) {
    throw new Error(`invalid --timeout '${timeoutSecondsRaw}' (expected integer >= 10)`) 
  }
  const timeoutMs = timeoutSeconds * 1000

  const directory = normalizeDirectory(args['--directory'] ?? process.env.STUDIO_UI_E2E_DIRECTORY ?? process.cwd())
  if (!directory) {
    throw new Error('resolved directory is empty')
  }

  const label = normalizeLabel(args['--label'] ?? process.env.STUDIO_UI_E2E_LABEL ?? 'ui')

  const outDirBase = String(args['--out-dir'] ?? process.env.STUDIO_UI_E2E_OUT_DIR ?? '').trim()
  const outRoot = outDirBase
    ? path.resolve(outDirBase)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-studio-ui-e2e.'))
  const runDir = path.join(outRoot, `${label}-${nowStamp()}`)
  await ensureDir(runDir)

  const logPath = path.join(runDir, 'run.log')
  const logLines = []
  const log = async (...parts) => {
    const msg = parts
      .map((p) => {
        if (p instanceof Error) return p.stack || p.message || String(p)
        return String(p)
      })
      .join(' ')
    const line = `[ui-click ${new Date().toISOString()}] ${msg}`
    logLines.push(line)
    process.stdout.write(`${line}\n`)
    try {
      await fs.appendFile(logPath, `${line}\n`)
    } catch {
      // ignore
    }
  }

  await log('Starting UI click E2E')
  if (baseUrl) await log('Base URL:', baseUrl)
  if (cdpUrl) await log('CDP URL:', cdpUrl)
  await log('Directory:', directory)
  await log('Timeout (s):', String(timeoutSeconds))
  await log('Artifacts dir:', runDir)

  let playwright
  try {
    playwright = await import('playwright')
  } catch (err) {
    await log('Playwright import failed:', err)
    throw new Error(
      "Playwright is not installed. Install it (and Chromium) before running: npm install --no-save playwright && npx playwright install chromium",
    )
  }

  const headed = Boolean(args['--headed'] || process.env.STUDIO_UI_E2E_HEADED === '1')

  async function findAttachedPage(browser) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const contexts = browser.contexts()
      const pages = contexts.flatMap((c) => c.pages())
      for (const p of pages) {
        try {
          await p.waitForLoadState('domcontentloaded', { timeout: 1500 })
        } catch {
          // ignore
        }
        try {
          await p.waitForSelector('#app', { timeout: 500 })
          return p
        } catch {
          // not our app page
        }
      }
      await sleep(250)
    }

    const contexts = browser.contexts()
    const pages = contexts.flatMap((c) => c.pages())
    const urls = pages.map((p) => p.url()).filter(Boolean)
    throw new Error(`no app webview page detected via CDP within ${timeoutSeconds}s (pages=${urls.length}): ${urls.join(' | ')}`)
  }

  let browser
  let context
  let page

  if (mode === 'web') {
    if (!baseUrl) {
      usage()
      throw new Error('--base-url is required in web mode')
    }

    const launchArgs = []
    if (process.platform === 'linux') {
      // Useful on CI/container-like environments; no-op elsewhere.
      launchArgs.push('--no-sandbox', '--disable-dev-shm-usage')
    }
    browser = await playwright.chromium.launch({
      headless: !headed,
      args: launchArgs,
    })

    context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 760 },
    })

    // Force English locale for stable selectors (UI reads from localStorage).
    await context.addInitScript(() => {
      try {
        localStorage.setItem('studio.ui.locale', 'en-US')
      } catch {
        // ignore
      }
    })

    page = await context.newPage()
  } else {
    browser = await playwright.chromium.connectOverCDP(cdpUrl)
    await log('Connected to CDP; contexts=', String(browser.contexts().length))
    page = await findAttachedPage(browser)
    context = page.context()

    await log('Attached page URL:', page.url())

    // Best-effort: force a desktop-ish viewport so the app renders the full header/nav.
    try {
      await page.setViewportSize({ width: 1280, height: 760 })
    } catch (err) {
      await log('Viewport set failed (continuing):', err)
    }

    // If a base URL is provided, force navigation inside the WebView.
    if (baseUrl) {
      await log('Navigate: /chat (in-webview via CDP)')
      try {
        await page.goto(`${baseUrl}/chat`, { waitUntil: 'domcontentloaded' })
      } catch (err) {
        await log('page.goto failed (continuing):', err)
        try {
          await page.evaluate((u) => {
            try {
              window.location.href = String(u)
            } catch {
              // ignore
            }
          }, `${baseUrl}/chat`)
          await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
        } catch (err2) {
          await log('location.href navigation failed (continuing):', err2)
        }
      }
    }

    // Force English locale for stable selectors (desktop loads before we can init-script).
    // Note: do this after navigating to baseUrl (if provided) so we write to the correct origin.
    try {
      const current = await page.evaluate(() => {
        try {
          return String(localStorage.getItem('studio.ui.locale') || '')
        } catch {
          return ''
        }
      })
      if (current !== 'en-US') {
        await log('Setting UI locale to en-US and reloading')
        await page.evaluate(() => {
          try {
            localStorage.setItem('studio.ui.locale', 'en-US')
          } catch {
            // ignore
          }
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
      }
    } catch (err) {
      await log('Locale set/reload failed (continuing):', err)
    }
  }

  page.setDefaultTimeout(timeoutMs)

  const consoleErrors = []
  page.on('console', (msg) => {
    const t = msg.type()
    const text = msg.text()
    if (t === 'error' || t === 'warning') {
      consoleErrors.push(`[console.${t}] ${text}`)
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err?.stack || err?.message || String(err)}`)
  })
  page.on('requestfailed', (req) => {
    const url = req.url()
    const method = req.method()
    const failure = req.failure()?.errorText || 'unknown'
    consoleErrors.push(`[requestfailed] ${method} ${url} (${failure})`)
  })

  const tracePath = path.join(runDir, 'trace.zip')
  let tracingEnabled = false
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracingEnabled = true
  } catch (err) {
    await log('Tracing not available in this mode (continuing):', err)
  }

  const screenshotPath = path.join(runDir, 'screenshot.png')
  const htmlPath = path.join(runDir, 'page.html')

  async function saveFailureArtifacts(extraLabel) {
    const suffix = extraLabel ? `-${normalizeLabel(extraLabel)}` : ''
    try {
      await page.screenshot({ path: screenshotPath.replace(/\.png$/, `${suffix}.png`), fullPage: true })
    } catch {
      // ignore
    }
    try {
      const html = await page.content().catch(() => '')
      if (html) {
        await fs.writeFile(htmlPath.replace(/\.html$/, `${suffix}.html`), html)
      }
    } catch {
      // ignore
    }
  }

  try {
    if (mode === 'web') {
      await log('Navigate: /chat (external browser)')
      await page.goto(`${baseUrl}/chat`, { waitUntil: 'domcontentloaded' })
    } else {
      await log('Attach mode: waiting for app UI (in-webview)')
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
      } catch {
        // ignore
      }
    }

    await log('Wait: app shell')
    await page.waitForSelector('#app', { timeout: timeoutMs })
    await log('Wait: directory picker button')
    await page.locator('button[aria-label="Change directory"]').waitFor({ state: 'visible', timeout: timeoutMs })

    // Directory selection
    await log('Open directory picker')
    await page.locator('button[aria-label="Change directory"]').click()
    const dirDialog = page.getByRole('dialog', { name: 'Select Directory' })
    await dirDialog.waitFor({ timeout: timeoutMs })

    await log('Fill directory input')
    const dirInput = dirDialog.getByPlaceholder('/path/to/directory')
    await dirInput.fill(directory)

    await log('Confirm directory')
    await dirDialog.getByRole('button', { name: 'Use directory' }).click()
    await dirDialog.waitFor({ state: 'hidden', timeout: timeoutMs })

    // New session (sidebar actions are hover-only)
    const dirLabel = directoryEntryLabel(directory)
    await log('Locate directory row:', dirLabel)
    const sidebar = page.locator('aside')
    const dirRow = sidebar.locator('button', { hasText: dirLabel }).first()
    await dirRow.waitFor({ timeout: timeoutMs })
    await dirRow.hover()

    await log('Click: New session')
    await dirRow.locator('button[aria-label="New session"]').click()

    await log('Wait: /chat?session=...')
    await page.waitForURL(/\/chat.*[?&](session|sessionId|sessionid)=/i, { timeout: timeoutMs })
    const currentUrl = new URL(page.url())
    const sessionId =
      currentUrl.searchParams.get('session') ||
      currentUrl.searchParams.get('sessionId') ||
      currentUrl.searchParams.get('sessionid') ||
      ''
    if (!sessionId) {
      throw new Error(`session id missing from URL: ${page.url()}`)
    }
    await log('Selected session:', sessionId)

    // Composer interactions
    const composer = page.locator('textarea[data-chat-input="true"]')
    await log('Wait: composer input')
    await composer.waitFor({ state: 'visible', timeout: timeoutMs })
    await composer.click()
    await composer.fill('E2E: UI click smoke (no send).')

    await log('Open composer tools menu')
    await page.getByRole('button', { name: 'Tools' }).click()
    await page.getByRole('button', { name: 'Initialize AGENTS.md' }).click()
    await composer.waitFor({ state: 'visible', timeout: timeoutMs })
    const v1 = await composer.inputValue()
    if (!v1.includes('/init')) {
      throw new Error(`expected composer to include '/init' after tool action; got: ${JSON.stringify(v1)}`)
    }
    await log('Tools action OK: inserted /init')

    await log('Open composer tools menu (review)')
    await page.getByRole('button', { name: 'Tools' }).click()
    await page.getByRole('button', { name: 'Review changes' }).click()
    const v2 = await composer.inputValue()
    if (!v2.includes('/review')) {
      throw new Error(`expected composer to include '/review' after tool action; got: ${JSON.stringify(v2)}`)
    }
    await log('Tools action OK: inserted /review')

    // Help dialog
    await log('Open Help dialog')
    await page.getByRole('button', { name: 'Help' }).click()
    const helpDialog = page.getByRole('dialog', { name: 'Help' })
    await helpDialog.waitFor({ timeout: timeoutMs })
    await page.keyboard.press('Escape')
    await helpDialog.waitFor({ state: 'hidden', timeout: timeoutMs })
    await log('Help dialog OK')

    // Settings navigation
    await log('Navigate to Settings')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForURL(/\/settings\b/i, { timeout: timeoutMs })
    await page.locator('.settings-page').waitFor({ timeout: timeoutMs })
    await log('Settings page OK')

    await log('Navigate back to Chat')
    try {
      await page.goBack({ waitUntil: 'domcontentloaded' })
    } catch {
      // Fallback: force navigation when router links are not reliably accessible (e.g. compact header layout).
      if (baseUrl) {
        await page.goto(`${baseUrl}/chat`, { waitUntil: 'domcontentloaded' })
      }
    }
    try {
      await page.waitForURL(/\/chat\b/i, { timeout: timeoutMs })
    } catch {
      // ignore
    }
    await page.locator('textarea[data-chat-input="true"]').waitFor({ state: 'visible', timeout: timeoutMs })

    // Delete the created session (sidebar actions are hover-only).
    // Prefer the locate/highlight flow, but fall back to the selected session row.
    const locateBtn = page.getByRole('button', { name: 'Locate current session in sidebar' })
    await log('Locate current session in sidebar')
    await locateBtn.click()

    async function findDeletableSessionRow() {
      const highlighted = sidebar.locator('button[class*="ring-primary/40"][class*="ring-inset"]').first()
      try {
        await highlighted.waitFor({ timeout: 1200 })
        return highlighted
      } catch {
        // continue
      }

      const selected = sidebar
        .locator('button[class*="bg-primary/12"]', { has: sidebar.locator('button[aria-label="Delete session"]') })
        .first()
      try {
        await selected.waitFor({ timeout: 1200 })
        return selected
      } catch {
        // continue
      }
      return null
    }

    let rowForDelete = await findDeletableSessionRow()
    if (!rowForDelete) {
      // Retry once to refresh the transient highlight.
      await log('Locate highlight not found; retry locate')
      await locateBtn.click()
      rowForDelete = await findDeletableSessionRow()
    }
    if (!rowForDelete) {
      throw new Error('Unable to locate the current session row in sidebar for deletion')
    }

    await log('Delete located session via sidebar UI')
    await rowForDelete.hover()
    await rowForDelete.locator('button[aria-label="Delete session"]').click()
    const confirmDelete = page.getByRole('button', { name: 'Delete' }).first()
    await confirmDelete.waitFor({ timeout: timeoutMs })
    await confirmDelete.click()

    // Deleting the currently-selected session may or may not immediately clear the router query param.
    // Treat success as: the delete confirm UI closes AND the app can create a new session afterwards.
    try {
      await confirmDelete.waitFor({ state: 'hidden', timeout: 5000 })
    } catch {
      // ignore
    }

    await log('Create a fresh session after delete')
    await dirRow.hover()
    await dirRow.locator('button[aria-label="New session"]').click()
    await page.waitForURL(/\/chat.*[?&](session|sessionId|sessionid)=/i, { timeout: timeoutMs })
    const urlAfter = new URL(page.url())
    let postDeleteSessionId =
      urlAfter.searchParams.get('session') ||
      urlAfter.searchParams.get('sessionId') ||
      urlAfter.searchParams.get('sessionid') ||
      ''
    postDeleteSessionId = String(postDeleteSessionId || '').trim()

    if (!postDeleteSessionId) {
      throw new Error(`post-delete session id missing from URL: ${page.url()}`)
    }

    if (postDeleteSessionId === sessionId) {
      await log('Session id unchanged after new session click; retry once')
      await page.waitForTimeout(600)
      await dirRow.hover()
      await dirRow.locator('button[aria-label="New session"]').click()
      await page.waitForTimeout(300)
      const urlRetry = new URL(page.url())
      const retryId =
        urlRetry.searchParams.get('session') ||
        urlRetry.searchParams.get('sessionId') ||
        urlRetry.searchParams.get('sessionid') ||
        ''
      const retryTrimmed = String(retryId || '').trim()
      if (!retryTrimmed) {
        throw new Error(`post-delete retry session id missing from URL: ${page.url()}`)
      }
      if (retryTrimmed === sessionId) {
        throw new Error(`new session id did not change after delete/new-session flow: ${page.url()}`)
      }
      postDeleteSessionId = retryTrimmed
    }

    await log('Post-delete session OK:', postDeleteSessionId)

    await log('PASS')
  } catch (err) {
    await log('FAIL:', err)
    await saveFailureArtifacts('fail')
    if (consoleErrors.length) {
      await log('Console/Network errors (first 50):')
      for (const line of consoleErrors.slice(0, 50)) {
        await log(line)
      }
    }
    throw err
  } finally {
    try {
      if (tracingEnabled) {
        await context.tracing.stop({ path: tracePath })
      }
    } catch {
      // ignore
    }
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }

  // Emit a short, stable hint for callers (useful in CI logs).
  process.stdout.write(`UI_E2E_ARTIFACT_DIR=${runDir}\n`)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exit(1)
})

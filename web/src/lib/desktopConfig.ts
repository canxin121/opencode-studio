type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

export type DesktopConfig = {
  backend: {
    host: string
    port: number
    cors_origins: string[]
    cors_allow_all: boolean
    ui_password?: string | null
    opencode_host: string
    opencode_port?: number | null
    skip_opencode_start: boolean
    opencode_log_level?: string | null
  }
}

function readTauriInvoke(): TauriInvoke | null {
  try {
    const candidate = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke
    return typeof candidate === 'function' ? (candidate as TauriInvoke) : null
  } catch {
    return null
  }
}

function asDesktopConfig(value: unknown): DesktopConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  if (!root.backend || typeof root.backend !== 'object' || Array.isArray(root.backend)) return null
  const backend = root.backend as Record<string, unknown>

  const portRaw = Number(backend.port)
  const port = Number.isFinite(portRaw) ? Math.max(0, Math.floor(portRaw)) : 3000

  const corsRaw = Array.isArray(backend.cors_origins) ? backend.cors_origins : []
  const cors_origins = corsRaw.map((v) => String(v || '').trim()).filter((v) => v.length > 0)

  return {
    backend: {
      host: typeof backend.host === 'string' ? backend.host : '127.0.0.1',
      port,
      cors_origins,
      cors_allow_all: backend.cors_allow_all === true,
      ui_password: typeof backend.ui_password === 'string' ? backend.ui_password : null,
      opencode_host: typeof backend.opencode_host === 'string' ? backend.opencode_host : '127.0.0.1',
      opencode_port: typeof backend.opencode_port === 'number' ? backend.opencode_port : null,
      skip_opencode_start: backend.skip_opencode_start === true,
      opencode_log_level: typeof backend.opencode_log_level === 'string' ? backend.opencode_log_level : null,
    },
  }
}

export function isDesktopRuntime(): boolean {
  return !!readTauriInvoke()
}

export async function desktopConfigGet(): Promise<DesktopConfig | null> {
  const invoke = readTauriInvoke()
  if (!invoke) return null
  const raw = await invoke('desktop_config_get')
  return asDesktopConfig(raw)
}

export async function desktopConfigSave(config: DesktopConfig): Promise<DesktopConfig | null> {
  const invoke = readTauriInvoke()
  if (!invoke) return null
  const raw = await invoke('desktop_config_save', { config })
  return asDesktopConfig(raw)
}

export async function desktopBackendRestart(): Promise<void> {
  const invoke = readTauriInvoke()
  if (!invoke) return
  await invoke('desktop_backend_restart')
}

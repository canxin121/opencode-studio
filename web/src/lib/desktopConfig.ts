type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

export type DesktopConfig = {
  autostart_on_boot: boolean
  backend: {
    host: string
    port: number
    cors_origins: string[]
    cors_allow_all: boolean
    backend_log_level?: string | null
    ui_password?: string | null
    opencode_host: string
    opencode_port?: number | null
    skip_opencode_start: boolean
    opencode_log_level?: string | null
  }
}

export type DesktopRuntimeInfo = {
  installerVersion: string
  installerTarget: string
  installerChannel: 'main' | 'cef'
  installerType: string
  installerManager: string
}

export type DesktopUpdateProgress = {
  running: boolean
  kind: 'service' | 'installer' | ''
  phase: string
  message: string
  downloadedBytes: number
  totalBytes: number | null
  error: string | null
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
    autostart_on_boot: root.autostart_on_boot !== false,
    backend: {
      host: typeof backend.host === 'string' ? backend.host : '127.0.0.1',
      port,
      cors_origins,
      cors_allow_all: backend.cors_allow_all === true,
      backend_log_level: typeof backend.backend_log_level === 'string' ? backend.backend_log_level : null,
      ui_password: typeof backend.ui_password === 'string' ? backend.ui_password : null,
      opencode_host: typeof backend.opencode_host === 'string' ? backend.opencode_host : '127.0.0.1',
      opencode_port: typeof backend.opencode_port === 'number' ? backend.opencode_port : null,
      skip_opencode_start: backend.skip_opencode_start === true,
      opencode_log_level: typeof backend.opencode_log_level === 'string' ? backend.opencode_log_level : null,
    },
  }
}

function asDesktopRuntimeInfo(value: unknown): DesktopRuntimeInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  const installerVersion = typeof root.installerVersion === 'string' ? root.installerVersion.trim() : ''
  const installerTarget = typeof root.installerTarget === 'string' ? root.installerTarget.trim() : ''
  const rawChannel = typeof root.installerChannel === 'string' ? root.installerChannel.trim().toLowerCase() : 'main'
  const installerChannel: 'main' | 'cef' = rawChannel === 'cef' ? 'cef' : 'main'
  const installerType = typeof root.installerType === 'string' ? root.installerType.trim().toLowerCase() : ''
  const installerManager = typeof root.installerManager === 'string' ? root.installerManager.trim().toLowerCase() : ''
  if (!installerVersion || !installerTarget || !installerType || !installerManager) return null
  return {
    installerVersion,
    installerTarget,
    installerChannel,
    installerType,
    installerManager,
  }
}

function asDesktopUpdateProgress(value: unknown): DesktopUpdateProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  const rawKind = typeof root.kind === 'string' ? root.kind.trim().toLowerCase() : ''
  const kind: 'service' | 'installer' | '' = rawKind === 'service' || rawKind === 'installer' ? rawKind : ''
  const downloadedRaw = Number(root.downloadedBytes)
  const totalRaw = Number(root.totalBytes)
  return {
    running: root.running === true,
    kind,
    phase: typeof root.phase === 'string' ? root.phase.trim() : '',
    message: typeof root.message === 'string' ? root.message.trim() : '',
    downloadedBytes: Number.isFinite(downloadedRaw) && downloadedRaw > 0 ? Math.floor(downloadedRaw) : 0,
    totalBytes: Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : null,
    error: typeof root.error === 'string' && root.error.trim() ? root.error.trim() : null,
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

export async function desktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  const invoke = readTauriInvoke()
  if (!invoke) return null
  const raw = await invoke('desktop_runtime_info')
  return asDesktopRuntimeInfo(raw)
}

export async function desktopOpenExternal(url: string): Promise<void> {
  const invoke = readTauriInvoke()
  if (!invoke) {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return
  }
  await invoke('desktop_open_external', { url })
}

export async function desktopServiceUpdate(assetUrl: string): Promise<void> {
  const invoke = readTauriInvoke()
  if (!invoke) {
    throw new Error('Service self-update is only available in desktop runtime')
  }
  await invoke('desktop_service_update', { assetUrl, asset_url: assetUrl })
}

export async function desktopInstallerUpdate(assetUrl: string, assetName?: string): Promise<void> {
  const invoke = readTauriInvoke()
  if (!invoke) {
    throw new Error('Installer self-update is only available in desktop runtime')
  }
  await invoke('desktop_installer_update', {
    assetUrl,
    assetName: assetName || null,
    asset_url: assetUrl,
    asset_name: assetName || null,
  })
}

export async function desktopUpdateProgressGet(): Promise<DesktopUpdateProgress | null> {
  const invoke = readTauriInvoke()
  if (!invoke) return null
  const raw = await invoke('desktop_update_progress_get')
  return asDesktopUpdateProgress(raw)
}

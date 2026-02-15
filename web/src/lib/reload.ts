import { apiJson } from './api'

export type ReloadResponse = {
  success?: boolean
  requiresReload?: boolean
  message?: string
  reloadDelayMs?: number
}

export async function reloadOpenCodeConfig(): Promise<ReloadResponse> {
  const resp = await apiJson<ReloadResponse>('/api/config/reload', {
    method: 'POST',
  })
  const delay = typeof resp.reloadDelayMs === 'number' ? resp.reloadDelayMs : 800
  await new Promise((resolve) => window.setTimeout(resolve, delay))
  return resp
}

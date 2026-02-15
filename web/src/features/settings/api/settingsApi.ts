import { apiJson } from '@/lib/api'

export async function clearBackendSessionCache(): Promise<{ ok: boolean }> {
  return apiJson<{ ok: boolean }>('/api/opencode-studio/cache/clear', { method: 'POST' })
}

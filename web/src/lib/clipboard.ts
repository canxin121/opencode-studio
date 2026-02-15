export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '')
  if (!value) return false

  // Prefer modern clipboard API when available.
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall back.
  }

  // Fallback for non-secure contexts / older browsers.
  try {
    if (typeof document === 'undefined') return false
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

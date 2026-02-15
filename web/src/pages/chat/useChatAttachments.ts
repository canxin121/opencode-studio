import { ref, type Ref } from 'vue'

type ToastKind = 'info' | 'success' | 'error'
type Toasts = { push: (kind: ToastKind, message: string, timeoutMs?: number) => void }

type ComposerExpose = {
  openFilePicker?: () => void
}

export type AttachedFile = {
  id: string
  filename: string
  size: number
  mime: string
  url?: string // data: URL (optional for server-side attachments)
  serverPath?: string
}

// Attachment handling (local uploads + project file references).
export function useChatAttachments(opts: { toasts: Toasts; composerRef: Ref<ComposerExpose | null> }) {
  const { toasts, composerRef } = opts

  const attachedFiles = ref<AttachedFile[]>([])

  // Keep local attachments conservative so base64+JSON stays within server body limits.
  const MAX_LOCAL_ATTACHMENT_BYTES = 25 * 1024 * 1024
  const MAX_LOCAL_ATTACHMENT_TOTAL_BYTES = 35 * 1024 * 1024

  const attachProjectDialogOpen = ref(false)
  const attachProjectPath = ref('')

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function readFileAsDataUrl(file: File): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }

  async function attachLocalFiles(files: FileList | File[]) {
    const list = Array.from(files)
    let localTotal = attachedFiles.value
      .filter((f) => !f.serverPath)
      .reduce((acc, f) => acc + (Number.isFinite(f.size) ? f.size : 0), 0)

    for (const file of list) {
      if (!(file instanceof File)) continue

      if (file.size > MAX_LOCAL_ATTACHMENT_BYTES) {
        toasts.push('error', `File too large: ${file.name} (${formatBytes(file.size)})`)
        continue
      }
      if (localTotal + file.size > MAX_LOCAL_ATTACHMENT_TOTAL_BYTES) {
        toasts.push('error', `Attachments too large (max ${formatBytes(MAX_LOCAL_ATTACHMENT_TOTAL_BYTES)})`)
        continue
      }

      const filename = (file.name || 'file').trim()
      const size = Number(file.size || 0)
      const mime = (file.type || 'application/octet-stream').trim()

      // Basic duplicate check.
      if (attachedFiles.value.some((f) => f.filename === filename && f.size === size)) continue

      const url = await readFileAsDataUrl(file)
      if (!url.startsWith('data:')) continue

      attachedFiles.value = [
        ...attachedFiles.value,
        {
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filename,
          size,
          mime,
          url,
        },
      ]

      localTotal += file.size
    }
  }

  async function handleDrop(e: DragEvent) {
    const files = e.dataTransfer?.files
    if (files && files.length) {
      await attachLocalFiles(files)
    }
  }

  async function handlePaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files
    if (files && files.length) {
      await attachLocalFiles(files)
    }
  }

  async function handleFileInputChange(e: Event | FileList) {
    const files = e instanceof FileList ? e : (e.target as HTMLInputElement | null)?.files
    if (!files) return
    await attachLocalFiles(files)

    if (!(e instanceof FileList)) {
      const input = e.target as HTMLInputElement | null
      if (input) input.value = ''
    }
  }

  function removeAttachment(id: string) {
    attachedFiles.value = attachedFiles.value.filter((f) => f.id !== id)
  }

  function clearAttachments() {
    attachedFiles.value = []
  }

  function openFilePicker() {
    // New UI uses AttachmentPicker (encapsulated hidden input).
    if (composerRef.value?.openFilePicker) {
      composerRef.value.openFilePicker()
    }
  }

  function openProjectAttachDialog() {
    attachProjectPath.value = ''
    attachProjectDialogOpen.value = true
  }

  function basename(path: string): string {
    const p = (path || '').replace(/\\/g, '/').trim()
    if (!p) return 'file'
    const parts = p.split('/').filter(Boolean)
    return parts[parts.length - 1] || p
  }

  function guessMimeFromName(name: string): string {
    const n = (name || '').toLowerCase()
    if (n.endsWith('.png')) return 'image/png'
    if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
    if (n.endsWith('.gif')) return 'image/gif'
    if (n.endsWith('.webp')) return 'image/webp'
    if (n.endsWith('.svg')) return 'image/svg+xml'
    if (n.endsWith('.pdf')) return 'application/pdf'
    if (n.endsWith('.json')) return 'application/json'
    if (n.endsWith('.md')) return 'text/markdown'
    if (n.endsWith('.txt')) return 'text/plain'
    if (n.endsWith('.ts') || n.endsWith('.tsx')) return 'text/plain'
    if (n.endsWith('.js') || n.endsWith('.jsx')) return 'text/plain'
    if (n.endsWith('.css')) return 'text/plain'
    if (n.endsWith('.html')) return 'text/plain'
    return 'application/octet-stream'
  }

  async function attachProjectFile(path: string) {
    const p = (path || '').trim()
    if (!p) return

    const filename = basename(p)
    if (attachedFiles.value.some((f) => f.serverPath === p)) return

    // Avoid pulling file contents into the browser. We send a lightweight reference
    // and let the server expand it into a data: URL when posting.
    const mime = guessMimeFromName(filename)

    attachedFiles.value = [
      ...attachedFiles.value,
      {
        id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename,
        size: 0,
        mime,
        url: '',
        serverPath: p,
      },
    ]
  }

  async function addProjectAttachment() {
    const p = (attachProjectPath.value || '').trim()
    if (!p) return
    await attachProjectFile(p)
    attachProjectPath.value = ''
  }

  return {
    attachedFiles,
    attachProjectDialogOpen,
    attachProjectPath,
    formatBytes,
    handleDrop,
    handlePaste,
    handleFileInputChange,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    openProjectAttachDialog,
    addProjectAttachment,
  }
}

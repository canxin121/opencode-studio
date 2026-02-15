export const PERMISSION_QUICK_GROUPS: Array<Array<{ key: string; label: string }>> = [
  [
    { key: '*', label: 'All tools' },
    { key: 'read', label: 'read' },
    { key: 'edit', label: 'edit' },
  ],
  [
    { key: 'glob', label: 'glob' },
    { key: 'grep', label: 'grep' },
    { key: 'list', label: 'list' },
  ],
  [
    { key: 'bash', label: 'bash' },
    { key: 'task', label: 'task' },
    { key: 'skill', label: 'skill' },
  ],
  [
    { key: 'external_directory', label: 'external_directory' },
    { key: 'lsp', label: 'lsp' },
    { key: 'question', label: 'question' },
  ],
  [
    { key: 'webfetch', label: 'webfetch' },
    { key: 'websearch', label: 'websearch' },
    { key: 'codesearch', label: 'codesearch' },
  ],
  [
    { key: 'todowrite', label: 'todowrite' },
    { key: 'todoread', label: 'todoread' },
    { key: 'doom_loop', label: 'doom_loop' },
  ],
]

export type DirectoryEntry = { id: string; path: string; label?: string }

// Backward-compatible alias during the naming migration.
export type Project = DirectoryEntry

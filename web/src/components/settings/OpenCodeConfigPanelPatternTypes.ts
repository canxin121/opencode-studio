export type PatternEntry = { pattern: string; action: 'allow' | 'ask' | 'deny' }

export type PatternEditorState = { open: boolean; entries: PatternEntry[]; error: string | null }

export type BranchViewItem = {
  name: string
  current: boolean
  label?: string | null
}

export function filterBranchesForSwitch<T extends BranchViewItem>(branches: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  const withScore = branches
    .map((branch) => {
      const name = (branch.name || '').trim()
      const label = (branch.label || '').trim()
      const nameLower = name.toLowerCase()
      const labelLower = label.toLowerCase()

      if (!q) {
        return { branch, score: branch.current ? -1 : 0, index: 0 }
      }

      const inName = nameLower.indexOf(q)
      const inLabel = labelLower.indexOf(q)
      if (inName < 0 && inLabel < 0) return null

      const index = inName >= 0 ? inName : inLabel + 100
      const exact = nameLower === q ? -3 : 0
      const prefix = inName === 0 ? -2 : 0
      const current = branch.current ? -1 : 0
      return {
        branch,
        score: exact + prefix + current,
        index,
      }
    })
    .filter((item): item is { branch: T; score: number; index: number } => Boolean(item))

  withScore.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.index !== b.index) return a.index - b.index
    return a.branch.name.localeCompare(b.branch.name)
  })

  return withScore.map((item) => item.branch)
}

export function pickQuickSwitchBranch<T extends BranchViewItem>(branches: T[]): T | null {
  for (const branch of branches) {
    if (!branch.current) return branch
  }
  return null
}

export type CommitFileSummaryItem = {
  insertions: number
  deletions: number
}

export function summarizeCommitFiles(files: CommitFileSummaryItem[]): {
  files: number
  insertions: number
  deletions: number
} {
  let insertions = 0
  let deletions = 0
  for (const file of files) {
    insertions += Number(file.insertions) || 0
    deletions += Number(file.deletions) || 0
  }
  return {
    files: files.length,
    insertions,
    deletions,
  }
}

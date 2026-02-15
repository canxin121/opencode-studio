export interface GitStatusFile {
  path: string
  index: string
  workingDir: string
  insertions?: number
  deletions?: number
}

export interface GitDiffStat {
  insertions: number
  deletions: number
}

export interface GitStatusResponse {
  current: string
  tracking: string | null
  ahead: number
  behind: number
  files: GitStatusFile[]
  diffStats?: Record<string, GitDiffStat>
  totalFiles: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  mergeCount: number
  offset: number
  limit: number
  hasMore: boolean
  scope: string
}

export interface GitWatchStatusPayload {
  current: string
  tracking: string | null
  ahead: number
  behind: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  mergeCount: number
  isClean: boolean
}

export interface GitBranch {
  name: string
  current: boolean
  label?: string | null
  tracking?: string | null
  ahead?: number | null
  behind?: number | null
}

export interface GitBranchesResponse {
  branches: Record<string, GitBranch>
}

export interface GitRemoteInfo {
  name: string
  url: string
  protocol: string
  host?: string | null
}

export interface GitRemoteInfoResponse {
  remotes: GitRemoteInfo[]
}

export interface GitTagInfo {
  name: string
  object: string
  subject?: string | null
  creatorDate?: string | null
}

export interface GitTagsListResponse {
  tags: GitTagInfo[]
}

export interface GitRemoteBranchListResponse {
  remote: string
  branches: string[]
}

export interface GitWorktreeInfo {
  worktree: string
  head?: string | null
  branch?: string | null
  locked: boolean
  prunable: boolean
  lockedReason?: string | null
  prunableReason?: string | null
}

export interface GitSigningInfoResponse {
  commitGpgsign: boolean
  gpgFormat: string
  signingKey?: string | null
  gpgProgram?: string | null

  sshSigningKey?: string | null
  sshAuthSockPresent: boolean
  sshAgentHasKeys: boolean
  sshAgentError?: string | null
}

export interface GitStateResponse {
  currentBranch?: string | null
  upstream?: string | null
  mergeInProgress: boolean
  rebaseInProgress: boolean
  cherryPickInProgress: boolean
  revertInProgress: boolean
}

export interface GitStashEntry {
  ref: string
  title: string
}

export interface GitStashListResponse {
  stashes: GitStashEntry[]
}

export interface GitStashShowResponse {
  ref: string
  diff: string
}

export interface GitLogCommit {
  hash: string
  shortHash: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authorDate: string
  graph?: string
  refs?: string[]
  parents?: string[]
}

export interface GitCommitFile {
  path: string
  status: string
  insertions: number
  deletions: number
  oldPath?: string | null
}

export interface GitLogResponse {
  commits: GitLogCommit[]
  hasMore: boolean
  nextOffset: number
}

export interface GitCommitDiffResponse {
  diff: string
}

export interface GitDiffSummary {
  files: number
  hunks: number
  changedLines: number
}

export interface GitDiffHunkMeta {
  id: string
  header: string
  range: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  additions: number
  deletions: number
  anchorLine: number
  lines: string[]
  patch: string
  patchReady: boolean
}

export interface GitDiffMeta {
  fileHeader: string[]
  hasPatchHeader: boolean
  hunks: GitDiffHunkMeta[]
  summary: GitDiffSummary
}

export interface GitDiffResponse {
  diff: string
  meta?: GitDiffMeta
}

export interface GitCommitFileContentResponse {
  content: string
  exists: boolean
  binary: boolean
  truncated: boolean
}

export interface GitCompareResponse {
  diff: string
}

export interface GitCommitFilesResponse {
  files: GitCommitFile[]
}

export interface GitBlameLine {
  line: number
  hash: string
  author: string
  authorEmail: string
  authorTime: number
  summary: string
}

export interface GitBlameResponse {
  lines: GitBlameLine[]
}

export interface GitSubmoduleInfo {
  path: string
  url: string
  branch?: string | null
}

export interface GitSubmoduleListResponse {
  submodules: GitSubmoduleInfo[]
}

export interface GitLfsStatusResponse {
  installed: boolean
  version?: string | null
  tracked: string[]
}

export interface GitLfsLockInfo {
  id: string
  path: string
  owner?: string | null
  lockedAt?: string | null
}

export interface GitLfsLocksResponse {
  locks: GitLfsLockInfo[]
}

export type GitRepoEntry = { root: string; relative: string; kind: string }

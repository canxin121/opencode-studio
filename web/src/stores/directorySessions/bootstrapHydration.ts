export type NonCriticalHydrationTask = () => Promise<unknown>

export function runNonCriticalSidebarHydration(
  preloadTasks: NonCriticalHydrationTask[],
  followupTasks: NonCriticalHydrationTask[],
) {
  void Promise.allSettled(preloadTasks.map((task) => task()))
    .then(() => Promise.allSettled(followupTasks.map((task) => task())))
    .catch(() => {})
}

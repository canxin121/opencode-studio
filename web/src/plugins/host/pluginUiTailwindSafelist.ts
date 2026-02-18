// Tailwind safelist for plugin module UIs.
//
// Plugin "module" mounts run inside Studio's DOM and share Studio's Tailwind output.
// Because plugin source lives outside this repo, Tailwind won't see class names used
// by plugins unless we explicitly include them somewhere under `web/src`.
//
// Keep this list small and generic; it should only cover common semantic tokens
// that plugin UIs are expected to use.
//
// NOTE: This file does not need to be imported anywhere. Tailwind v4 scans
// `web/src/**/*.{ts,tsx,vue,css}` via `web/src/style.css`.

export const PLUGIN_UI_TAILWIND_SAFELIST = `
bg-emerald-600/40
text-emerald-700/70
text-amber-600/70
bg-emerald-500/15
`

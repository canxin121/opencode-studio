# OpenCode Studio Independent TypeScript Plugin System - Implementation Plan

## 1) Objective and hard constraints

Build a Studio-side plugin platform that is independent from OpenCode core internals while still using `opencode.json` plugin list as discovery input.

Hard constraints:

- Zero-line change in OpenCode core source.
- Changes allowed only in:
  - `opencode-studio`
  - `opencode_dir/opencode-planpilot`
- Plugin configuration must be persisted by plugin-owned storage only (no Studio-owned persistent DB/file for plugin config state).
- Plugins must be able to mount UI to Studio surfaces (priority: chat) and support rich interaction (Planpilot plan/step/goal CRUD).
- Architecture must be TypeScript-centric, extensible, and not depend on OpenCode internal message channels.

## 2) Scope and non-goals

In scope:

- A generic Studio plugin runtime contract.
- Plugin discovery from OpenCode config plugin list.
- Plugin manifest/capability model.
- Plugin action execution model.
- Plugin UI mounting model for Settings and Chat surfaces.
- Planpilot reference implementation for full CRUD + status in chat.

Out of scope (phase-1):

- Running arbitrary third-party plugin code directly in Studio main JS context.
- OpenCode core plugin protocol changes.
- Plugin marketplace/distribution backend.

## 3) High-level architecture

### 3.1 Core idea

Treat Studio plugins as external providers with two contracts:

1. **Control contract** (manifest + actions + events) over Studio HTTP/SSE via Studio server bridge.
2. **UI contract** (web bundle entry) loaded by Studio web app in a host mount container.

Studio owns orchestration only. Plugin owns domain logic and persistence.

### 3.2 Runtime components

1. **Studio Plugin Registry (server, Rust)**
   - Reads plugin identifiers from `GET /api/config/opencode` data (`plugin` array).
   - Resolves each plugin's Studio manifest location and web entry metadata.
   - Keeps in-memory registry (ephemeral cache only).

2. **Studio Plugin Bridge (server, Rust -> Node process)**
   - Executes plugin bridge command for action invocations.
   - Optionally starts plugin event stream adapter for SSE relay.
   - No plugin business data persisted in Studio.

3. **Studio Plugin Host (web, TS/Vue)**
   - Fetches manifests and mounts plugin UI in declared surfaces.
   - Routes action calls through Studio plugin endpoints.
   - Provides shared host SDK APIs (`invokeAction`, `subscribeEvents`, runtime context).

4. **Plugin-side Studio SDK (TS package)**
   - Helper types for manifest/action/event contracts.
   - Build helpers for plugin web entry and bridge handler.

### 3.3 Discovery source

- Source of truth for enabled plugins: `opencode.json` plugin list (already editable in Studio).
- Studio resolves each listed plugin independently for Studio capabilities.
- If plugin lacks Studio manifest, it remains enabled for OpenCode but ignored by Studio runtime.

## 4) Contracts

### 4.1 Manifest contract (`studio.manifest.json`)

Each plugin provides a manifest file packaged with plugin artifacts.

Required fields:

- `id`: stable plugin id (e.g., `opencode-planpilot`).
- `version`: plugin version.
- `displayName`.
- `bridge`: executable spec for action/event adapter.
- `ui`: web entry metadata.
- `capabilities`: list of capabilities.

Recommended fields:

- `settingsSchema`: JSON Schema for plugin config editing.
- `mounts`: UI mount declarations.

Example mount declarations:

- `settings.panel`
- `chat.sidebar`
- `chat.activity.inline`
- `chat.message.footer`

### 4.2 Action contract

Unified action endpoint shape:

- Request: `{ action: string, payload: unknown, context: HostContext }`
- Response: `{ ok: boolean, data?: unknown, error?: { code, message, details? } }`

Mandatory baseline actions for settings integration:

- `config.get`
- `config.set`
- `health.ping`

Planpilot-specific actions (examples):

- `plan.list`, `plan.create`, `plan.update`, `plan.done`
- `step.create`, `step.update`, `step.done`
- `goal.create`, `goal.update`, `goal.done`
- `runtime.status`, `runtime.continue_now`, `runtime.pause_auto`, `runtime.resume_auto`

### 4.3 Event contract (optional but recommended)

Plugin emits host-consumable events:

- `plugin.status.changed`
- `planpilot.plan.updated`
- `planpilot.step.updated`
- `planpilot.goal.updated`

Transport: Studio SSE endpoint relays plugin bridge events to web subscribers.

## 5) Persistence model (plugin-owned only)

### 5.1 Principle

Studio never stores plugin config values persistently.

- Studio may keep in-memory request/session cache for UX only.
- Durable writes are delegated to plugin via `config.set`.
- Reads always go through plugin `config.get`.

### 5.2 Planpilot mapping

- Existing Planpilot config stays at plugin-owned location (under `~/.config/opencode/.planpilot`).
- Existing Planpilot SQLite remains plugin-owned source of truth for plan/step/goal state.
- Studio invokes Planpilot actions; Studio does not mirror or normalize plan tables in its own storage.

## 6) Studio server implementation plan (Rust)

### Phase A - Registry + manifest read

1. Add `plugin_runtime` server module.
2. Build plugin registry refresh flow triggered by:
   - startup
   - successful `PUT /api/config/opencode`
3. For each configured plugin id, resolve Studio manifest by deterministic rules:
   - Prefer explicit path in plugin package metadata (`opencodeStudio.manifest`).
   - Fallback conventions (`dist/studio.manifest.json`, `studio.manifest.json`).
4. Expose endpoints:
   - `GET /api/plugins`
   - `GET /api/plugins/:id/manifest`

### Phase B - action bridge

5. Add endpoint `POST /api/plugins/:id/action`.
6. Execute plugin bridge command with JSON stdin/stdout protocol.
7. Add per-plugin timeout and structured error mapping.
8. Add lightweight in-memory circuit breaker for repeated bridge failures.

### Phase C - events + assets

9. Add `GET /api/plugins/:id/events` SSE relay when plugin supports events.
10. Add `GET /api/plugins/:id/assets/*` static passthrough for plugin UI bundle assets.

## 7) Studio web implementation plan (TS/Vue)

### Phase D - host runtime

1. Add `web/src/plugins/host/` modules:
   - manifest store
   - action client
   - event subscriber
   - mount resolver
2. Fetch manifests after runtime bootstrap and opencode config load.
3. Track plugin health states: `ready | degraded | unavailable`.

### Phase E - settings integration

4. Extend Settings page with plugin section renderer.
5. If plugin exposes `settingsSchema`, render generic schema-driven form.
6. Save flow:
   - UI edits local draft only.
   - Save calls `config.set` action.
   - Reload calls `config.get` action.

### Phase F - chat integration

7. Add chat mount slots for declared surfaces (`chat.sidebar`, `chat.activity.inline`, etc.).
8. Load plugin UI entry in plugin host wrapper (iframe or micro-frontend mount).
9. Provide host SDK bridge for action invoke + SSE subscribe.
10. For Planpilot, mount:
   - plan status card in chat sidebar
   - interactive plan/step/goal CRUD panel in chat surface

## 8) Plugin-side implementation plan (`opencode-planpilot`)

### Phase G - Studio manifest and bridge

1. Add `studio.manifest.json` generation in build output.
2. Add Node bridge entrypoint:
   - accepts action request JSON
   - maps action -> existing Planpilot app/service methods
   - returns normalized response
3. Add optional event emitter adapter from Planpilot state changes.

### Phase H - Studio web UI package

4. Add `src/studio-web/` TS UI app (plugin-owned micro-frontend).
5. Implement host SDK integration:
   - call plugin actions via Studio host
   - subscribe to plan update events
6. Implement CRUD widgets:
   - plans list/detail
   - step/goal CRUD/status toggles
   - runtime controls (continue/pause/resume)

### Phase I - plugin config integration

7. Expose `settingsSchema`, `config.get`, `config.set` via bridge.
8. Keep all durable config writes in existing plugin config files.

## 9) Data flow

### 9.1 Settings config flow

1. Studio loads plugin manifest.
2. Studio renders schema-based settings panel.
3. User changes fields and saves.
4. Studio -> `POST /api/plugins/:id/action` (`config.set`).
5. Plugin persists to plugin-owned config.
6. Studio refreshes via `config.get`.

### 9.2 Chat UI + CRUD flow (Planpilot)

1. Chat page resolves plugin mounts.
2. Planpilot widget loads and requests `plan.list`.
3. User creates/updates plan/step/goal.
4. Widget invokes action; Planpilot updates SQLite.
5. Plugin emits update event; Studio SSE relays.
6. Widget refreshes state incrementally.

## 10) Versioning and compatibility

- Introduce `studioApiVersion` in manifest (e.g., `1`).
- Host supports compatibility policy:
  - same major required
  - minor backward-compatible features gated by capability checks
- Add deprecation markers for contract fields and actions.

## 11) Testing strategy

### 11.1 Server

- Unit tests: manifest parsing, registry refresh, action bridge error mapping.
- Integration tests: plugin endpoints with mock bridge.
- Robustness tests: malformed manifest and malformed bridge response rejection.

### 11.2 Web

- Unit tests: mount resolver, plugin stores, action client.
- Component tests: settings schema form rendering and save cycle.
- E2E tests: chat mount renders and CRUD roundtrip for Planpilot.

### 11.3 Plugin (Planpilot)

- Unit tests for action handlers and config API.
- Integration tests for bridge stdin/stdout protocol.
- UI tests for plan/step/goal CRUD interactions.

## 12) Delivery phases and milestones

1. **M1**: Registry + manifest endpoints + host manifest store.
2. **M2**: Action bridge + generic settings config CRUD.
3. **M3**: Chat mount host + plugin asset loader.
4. **M4**: Planpilot chat widgets with full plan/step/goal CRUD.
5. **M5**: stability/perf/tests/docs polish.

## 13) Acceptance criteria

- OpenCode core repository has no changes.
- Enabling/disabling plugin in `opencode.json` immediately affects Studio plugin availability.
- Plugin settings can be edited in Studio and persist correctly with zero Studio-owned persistent storage.
- Planpilot status and CRUD operations work inside chat surface.
- Plugin failures degrade gracefully without crashing Studio chat/settings.
- Tests for registry, bridge, settings flow, and Planpilot CRUD pass.

## 14) Implementation order recommendation

Build vertical slices instead of all infrastructure first:

1. Manifest + list endpoint + web manifest load.
2. `config.get`/`config.set` bridge + settings panel.
3. Chat mount host + minimal Planpilot status card.
4. Full Planpilot CRUD + event sync.
5. Integration polish and full test matrix.

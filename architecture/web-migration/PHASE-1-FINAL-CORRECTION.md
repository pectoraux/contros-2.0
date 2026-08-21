# Phase 1 — Final Boundary & Behavior Correction

**Status**: READY FOR ONE MORE CORRECTION PASS — 2026-08-21
**Required by**: Principal Architect's review of commit `1e70c8d89aad3f43c2924e8f53c18bd1f07cf3b6`
**Scope**: Final correction pass. No application wiring. No new features. No Web/WASM.

---

## 0. Background

Commit `1e70c8d` fixed the 6 original violations but introduced 4 new blockers identified by the Principal Architect:

1. `DocumentService` still issues shell commands (tab/window operations) via `DocsEventBus`
2. Several methods are permanent stubs (`consumePendingOpen` → `null`, `consumeNewBlank` → `false`, `saveNew` → throws)
3. The bridge manufactures synthetic sessions (`{ filePath, hash: '' }`) and has a single-session slot despite multi-tab support
4. The runtime factory uses `any` escape hatches (`docsService?: any`, `null as any` for unwired services)

Plus a concrete defect: `Files.uniquePath()` lacks behavioral tests.

This document is the **Final Boundary & Behavior Correction Plan**. It addresses all 4 blockers + the defect.

---

## Blocker 1 — `DocumentService` issues shell commands via `DocsEventBus`

### Current state

`DocsEventBus` contains:
```ts
requestOpenTab?: (openPath?: string, opts?: { newBlank?: boolean }) => void
requestListTabs?: () => DocsTabInfo[]
requestFocusTab?: (id: string) => void
```

`DocumentServiceImpl` calls them:
```ts
async openNewTab(openPath?): Promise<void> {
  this.eventBus.requestOpenTab?.(openPath ?? undefined, ...)
}
async listDocsTabs(): Promise<DocsTabInfo[]> {
  return this.eventBus.requestListTabs?.() ?? []
}
async focusDocsTab(id: string): Promise<void> {
  this.eventBus.requestFocusTab?.(id)
}
```

### Architectural violation

> The service may publish domain events, but it must not issue shell commands.

`requestOpenTab` / `requestListTabs` / `requestFocusTab` are shell commands dressed as events. A "request" the shell "subscribes to" is just an inverted method call. The domain service has no business telling the shell to open a tab or list its tabs.

### Correction

**Remove tab/window operations from `DocumentService` entirely.**

These three methods (`openNewTab`, `listDocsTabs`, `focusDocsTab`) are NOT domain operations — they're shell coordination. They belong in a `DocsShellCoordinator` (which lives in `apps/docs/src/main/`), not in the domain service.

The `DocsEventBus` shrinks to **domain-only events**:
```ts
export interface DocsEventBus {
  opened: (result: OpenFileResult) => void
  renamed: (paths: { oldPath: string; newPath: string }) => void
  teardown: () => void
  menuCommand: (command: MenuCommand, payload?: string) => void
  closeCheck: () => void
  closeSaveRequest: () => void
}
```

No `requestOpenTab` / `requestListTabs` / `requestFocusTab`. The shell owns tab management directly.

### Files affected

- `packages/runtime-contracts/src/services/docs.ts` — remove `openNewTab`, `listDocsTabs`, `focusDocsTab` from `DocumentService`
- `packages/services-docs/src/document-service.ts` — remove the three methods + remove `requestOpenTab/requestListTabs/requestFocusTab` from `DocsEventBus`
- `packages/renderer-bridge/src/bridges/docs-bridge.ts` — the bridge now delegates `openNewTab`/`listDocsTabs`/`focusDocsTab` to `runtime.windowing` (which is the shell-level capability), NOT to `runtime.docs`

### Behavior-preservation test

- The bridge still implements the `DesktopApi` interface (which has `openNewTab`/`listDocsTabs`/`focusDocsTab`) — it just delegates to `runtime.windowing`, not to `runtime.docs`
- The `DesktopApi` contract is unchanged
- Architecture test: `DocumentService` interface has zero tab/window methods

---

## Blocker 2 — Methods are permanent stubs

### Current state

| Method | Current behavior | Why it's a stub |
|---|---|---|
| `consumePendingOpen()` | `return null` | The pending-open queue lives in the shell; the service can't see it |
| `consumeNewBlank()` | `return false` | The new-blank flag set lives in the shell |
| `saveNew()` | `throw new Error('not yet implemented — requires Settings capability')` | Requires `Settings.getDefaultSaveDir()` which isn't in deps |

### Architectural violation

> The frozen requirement is: behavior before architecture.
>
> We cannot wire a service into the existing application when several existing behaviors have become permanent stubs.

### Correction

**Classify every `DocumentService` method explicitly as either:**

- `EXTRACTED AND BEHAVIOR-COMPLETE` — the method's behavior is fully implemented in the service, going through capabilities
- `NOT PART OF THIS EXTRACTION` — the method stays in the shell (`apps/docs/src/main/`) and the service does NOT declare it

| Method | Classification | Action |
|---|---|---|
| `openDialog()` | EXTRACTED | Stays in service |
| `open(path)` | EXTRACTED | Stays |
| `save(session, data, auto)` | EXTRACTED | Stays |
| `saveAs(session, defaultName, data)` | EXTRACTED | Stays |
| `writeRecovery(session, data)` | EXTRACTED | Stays |
| `recentFiles()` | EXTRACTED | Stays |
| `pickImage()` | EXTRACTED | Stays |
| `pickAttachments()` | EXTRACTED | Stays |
| `addAttachmentPaths(paths)` | EXTRACTED | Stays |
| `addPastedImage(data, ext)` | EXTRACTED | Stays |
| `readAttachment(path, offset, maxChars)` | EXTRACTED | Stays |
| `readAttachmentImage(path)` | EXTRACTED | Stays |
| `fontMetrics(family)` | EXTRACTED | Stays |
| `print()` | EXTRACTED | Stays |
| `exportPdf(...)` | EXTRACTED | Stays |
| `printPdfBuffer(...)` | EXTRACTED | Stays |
| `saveMergedPdf(...)` | EXTRACTED | Stays |
| `getAiSettings()` | EXTRACTED | Stays (delegates to `runtime.ai`) |
| `setAiSettings()` | EXTRACTED | Stays |
| `aiChat()` | EXTRACTED | Stays |
| `aiStream()` | EXTRACTED | Stays |
| `aiStreamCancel()` | EXTRACTED | Stays |
| `onAiStream()` | EXTRACTED | Stays |
| `onOpened()` | EXTRACTED | Stays |
| `onRenamed()` | EXTRACTED | Stays |
| `onTeardown()` | EXTRACTED | Stays |
| `onMenuCommand()` | EXTRACTED | Stays |
| `onCloseCheck()` | EXTRACTED | Stays |
| `reportCloseCheck()` | EXTRACTED | Stays |
| `onCloseSaveRequest()` | EXTRACTED | Stays |
| `reportCloseSaveResult()` | EXTRACTED | Stays |
| `reportViewMenuState()` | EXTRACTED | Stays |
| `consumePendingOpen()` | **NOT PART OF THIS EXTRACTION** | Remove from `DocumentService`; the shell owns the pending-open queue |
| `consumeNewBlank()` | **NOT PART OF THIS EXTRACTION** | Remove from `DocumentService`; the shell owns the new-blank flag |
| `saveNew(session, defaultName, data)` | **EXTRACTED — fix the stub** | Add `Settings` capability to `DocumentServiceDeps`; implement using `Settings.getDefaultSaveDir()` + `Files.uniquePath()` |
| `openNewTab()` | **NOT PART OF THIS EXTRACTION** | Remove from `DocumentService` (see Blocker 1) |
| `listDocsTabs()` | **NOT PART OF THIS EXTRACTION** | Remove (see Blocker 1) |
| `focusDocsTab()` | **NOT PART OF THIS EXTRACTION** | Remove (see Blocker 1) |

### Files affected

- `packages/runtime-contracts/src/services/docs.ts` — remove `consumePendingOpen`, `consumeNewBlank`, `openNewTab`, `listDocsTabs`, `focusDocsTab` from `DocumentService`
- `packages/services-docs/src/document-service.ts` — remove those 5 methods; fix `saveNew` to use `Settings.getDefaultSaveDir()` + `Files.uniquePath()`
- `packages/services-docs/src/document-service.ts` — add `settings: Settings` to `DocumentServiceDeps`

### Behavior-preservation test

- `saveNew()` is now behavior-complete (delegates to `Settings` + `Files`)
- The 5 removed methods are no longer claimed as extracted — they stay in the shell
- The `DesktopApi` contract is unchanged (the bridge still implements those methods; it delegates to the shell via `runtime.windowing`)

---

## Blocker 3 — Synthetic sessions + single-session bridge

### Current state

```ts
// packages/renderer-bridge/src/bridges/docs-bridge.ts
let activeSession: DocumentSession | null = null

saveDocx: async (path, data, auto) => {
  const session: DocumentSession = activeSession && activeSession.filePath === path
    ? activeSession
    : { filePath: path, hash: '' }  // ← SYNTHETIC session
  ...
}
```

Two problems:
1. The bridge has a **single** `activeSession` slot, but Docs supports multiple tabs. A multi-tab app needs a `Map<wcId, DocumentSession>`.
2. The fallback `{ filePath: path, hash: '' }` manufactures a fake session outside the document lifecycle. `hash: ''` means the archive lookup will fail, the external-modified check will skip (no `diskState`), and the recovery key will be wrong.

### Architectural violation

> The session association must be owned by the application shell/preload boundary in a way that faithfully preserves the existing renderer contract.

### Correction

**Introduce a `SessionRegistry` that the shell owns and the bridge queries.**

```ts
// packages/services-docs/src/session-registry.ts
export interface SessionRegistry {
  /** Get the session for a given file path (the renderer's current path). */
  get(filePath: string): DocumentSession | null
  /** Register a session (called after open/saveAs/saveNew succeed). */
  register(session: DocumentSession): void
  /** Drop a session (called on tab close / teardown). */
  drop(filePath: string): void
}
```

The bridge receives the `SessionRegistry` as a dependency (injected by the shell at preload time). The bridge's `saveDocx(path, data, auto)`:

```ts
saveDocx: async (path, data, auto) => {
  const session = registry.get(path)
  if (!session) {
    // The renderer is trying to save a path that was never opened.
    // The existing docs-main returns { ok: false, error: 'save target is not an opened document' }.
    return { ok: false, error: 'save target is not an opened document' }
  }
  const result = await docs.save(session, new Uint8Array(data), auto)
  if (result.session) registry.register(result.session)
  return result
}
```

No synthetic sessions. No single-session slot. The bridge is stateless (it queries the registry); the shell owns the state.

### Files affected

- `packages/services-docs/src/session-registry.ts` — NEW — the `SessionRegistry` interface + an in-memory implementation
- `packages/services-docs/src/document-service.ts` — `openDialog`/`open`/`saveAs`/`saveNew` return the session (already do); the shell registers it
- `packages/renderer-bridge/src/bridges/docs-bridge.ts` — accept `SessionRegistry` as a dep; query it instead of holding `activeSession`; no synthetic fallback
- `packages/renderer-bridge/src/index.ts` — the bridge factory now takes `(runtime, registry)` for docs

### Behavior-preservation test

- `saveDocx('/path/never-opened.docx', bytes)` returns `{ ok: false, error: 'save target is not an opened document' }` (matches existing docs-main behavior)
- `saveDocx('/path/opened.docx', bytes)` after `openDocxPath('/path/opened.docx')` succeeds
- Multi-tab: opening two paths, saving each, both work (the registry holds both sessions)

---

## Blocker 4 — `any` escape hatches + invalid "full runtime" model

### Current state

```ts
// packages/platform-electron/src/runtime/electron-runtime.ts
export interface ElectronRuntimeConfig {
  docsService?: any  // ← any
}

const runtime: RuntimeContext = {
  ...
  docs: config.docsService ?? null,  // ← null (RuntimeContext.docs is typed DocumentService, not null)
  sheets: null as any,  // ← any
  slides: null as any,  // ← any
  pdf: null as any,  // ← any
  markdown: null as any,  // ← any
  project: projectStore as any,  // ← any
}
```

### Architectural violation

> `null as any` is not an architectural state model.

The `RuntimeContext` interface says `docs: DocumentService`, but the factory assigns `null`. That's a type lie. The runtime contract should explicitly represent the partial-migration state.

### Correction

**Introduce a typed `PartialRuntimeContext` for the migration period.**

```ts
// packages/runtime-contracts/src/runtime.ts

/** A service slot during migration: either the implemented service, or 'not-yet-wired'. */
export type ServiceSlot<T> = T | { readonly __notYetWired: true; readonly reason: string }

export interface RuntimeContext {
  readonly platform: 'electron' | 'web'
  readonly version: string

  // Capabilities (always present)
  readonly storage: Storage
  readonly files: Files
  readonly identity: Identity
  readonly ai: AI
  readonly printing: Printing
  readonly clipboard: Clipboard
  readonly notifications: Notifications
  readonly windowing: Windowing
  readonly settings: Settings

  // Domain services — ServiceSlot<T> explicitly represents the migration state
  readonly docs: ServiceSlot<DocumentService>
  readonly sheets: ServiceSlot<SpreadsheetService>
  readonly slides: ServiceSlot<PresentationService>
  readonly pdf: ServiceSlot<PdfService>
  readonly markdown: ServiceSlot<MarkdownService>

  readonly project: ProjectStoreService
}

/** Marker for an unwired service slot. */
export const NOT_YET_WIRED = (reason: string): { readonly __notYetWired: true; readonly reason: string } =>
  ({ __notYetWired: true as const, reason })

/** Type guard: is this service slot wired? */
export function isWired<T>(slot: ServiceSlot<T>): slot is T {
  return !((slot as any).__notYetWired)
}
```

The factory:
```ts
const runtime: RuntimeContext = {
  ...
  docs: config.docsService ?? NOT_YET_WIRED('Docs service not yet constructed — Phase 1 increment 2 wires it'),
  sheets: NOT_YET_WIRED('Sheets service — Phase 1 increment 3'),
  slides: NOT_YET_WIRED('Slides service — Phase 1 increment 4'),
  pdf: NOT_YET_WIRED('PDF service — Phase 1 increment 5'),
  markdown: NOT_YET_WIRED('Markdown service — Phase 1 increment 6'),
  project: projectStore,
}
```

The bridge checks `isWired(runtime.docs)` before delegating; if not wired, it throws a clear error.

### Files affected

- `packages/runtime-contracts/src/runtime.ts` — `ServiceSlot<T>` type + `NOT_YET_WIRED` marker + `isWired` guard
- `packages/runtime-contracts/src/services/docs.ts` — `DocumentService` no longer has the 5 removed methods
- `packages/platform-electron/src/runtime/electron-runtime.ts` — `docsService?: DocumentService` (typed, not `any`); use `NOT_YET_WIRED` for unwired services; `project: projectStore` (typed, no `as any`)
- `packages/renderer-bridge/src/bridges/docs-bridge.ts` — check `isWired(runtime.docs)` before delegating

### Behavior-preservation test

- `npx tsc --noEmit` passes with zero `as any` in the runtime factory (excluding the `dialog as any` / `shell as any` casts for Electron type narrowing — those are a separate concern, addressed below)
- The `dialog as any` / `shell as any` casts: replace with proper typed wrappers (the `ElectronFilesDeps` already declares the typed subset of `dialog`/`shell` it needs — the `as any` is just to satisfy the `showOpenDialogWithMemory` signature which takes Electron's `Dialog` type. Fix by widening the `showOpenDialogWithMemory` parameter type or wrapping.)

---

## Defect — `Files.uniquePath()` lacks behavioral tests

### Current state

```ts
async uniquePath(dir: string, fileName: string): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const base = fileName.replace(/\.docx$/i, '')
  let candidate = join(dir, `${base}.docx`)
  let n = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${base} ${n}.docx`)
    n++
  }
  return candidate
}
```

No tests. The regex `/\.docx$/i` only handles `.docx` — other extensions (`.pdf`, `.txt`) would have the extension stripped incorrectly (e.g. `report.pdf` → `report.pdf.docx`).

### Correction

1. Fix the regex to handle any extension (or none): `fileName.replace(/\.[^.]+$/, '')`
2. Add behavioral tests:
   - `uniquePath(dir, 'foo.docx')` → `dir/foo.docx` (when dir is empty)
   - `uniquePath(dir, 'foo.docx')` when `foo.docx` exists → `dir/foo 1.docx`
   - `uniquePath(dir, 'foo.docx')` when `foo.docx` + `foo 1.docx` exist → `dir/foo 2.docx`
   - `uniquePath(dir, 'report.pdf')` → `dir/report.pdf` (unrelated extension preserved)
   - `uniquePath(dir, 'noext')` → `dir/noext` (no extension)

### Files affected

- `packages/platform-electron/src/capabilities/electron-files.ts` — fix regex
- `packages/platform-electron/tests/electron-files.test.ts` — NEW — behavioral tests for `uniquePath`

---

## Implementation order

1. Update `packages/runtime-contracts/src/runtime.ts` — add `ServiceSlot<T>` + `NOT_YET_WIRED` + `isWired`
2. Update `packages/runtime-contracts/src/services/docs.ts` — remove `consumePendingOpen`, `consumeNewBlank`, `openNewTab`, `listDocsTabs`, `focusDocsTab` from `DocumentService`
3. Create `packages/services-docs/src/session-registry.ts` — `SessionRegistry` interface + in-memory impl
4. Rewrite `packages/services-docs/src/document-service.ts`:
   - Remove `consumePendingOpen`, `consumeNewBlank`, `openNewTab`, `listDocsTabs`, `focusDocsTab`
   - Remove `requestOpenTab`/`requestListTabs`/`requestFocusTab` from `DocsEventBus`
   - Add `settings: Settings` to `DocumentServiceDeps`
   - Implement `saveNew` using `Settings.getDefaultSaveDir()` + `Files.uniquePath()`
5. Create `packages/services-docs/src/session-registry.ts` — `SessionRegistry` interface + `InMemorySessionRegistry`
6. Rewrite `packages/renderer-bridge/src/bridges/docs-bridge.ts`:
   - Accept `SessionRegistry` as a dep
   - No `activeSession` slot; query the registry
   - No synthetic `{ filePath, hash: '' }` fallback — return the existing error
   - Delegate `openNewTab`/`listDocsTabs`/`focusDocsTab` to `runtime.windowing`
   - Check `isWired(runtime.docs)` before delegating
7. Rewrite `packages/platform-electron/src/runtime/electron-runtime.ts`:
   - `docsService?: DocumentService` (typed)
   - Use `NOT_YET_WIRED(reason)` for unwired services
   - `project: projectStore` (no `as any`)
   - Address `dialog as any` / `shell as any` casts
8. Fix `packages/platform-electron/src/capabilities/electron-files.ts` — `uniquePath` regex
9. Add `packages/platform-electron/tests/electron-files.test.ts` — behavioral tests for `uniquePath`
10. Add `packages/services-docs/tests/document-service.test.ts` — service-level tests for open/save/saveAs/saveNew/recovery/external-modified/recents
11. Update existing tests that referenced the removed methods
12. Verify typecheck + tests; verify `apps/` untouched
13. Commit + push
14. Report with the required status block

---

## What is NOT done (per Principal Architect directive)

- ❌ NO application wiring (`apps/docs/src/main/` + preload unchanged)
- ❌ NO renderer changes (frozen)
- ❌ NO shared contract changes (`DesktopApi` interface unchanged)
- ❌ NO new features
- ❌ NO Web adapter, NO WASM, NO backend
- ❌ NO claim that the DOCX byte-preserving transformation has been extracted

---

## Stop criteria

The correction is complete when ALL of the following are true:

1. `DocumentService` interface has zero tab/window methods (`openNewTab`/`listDocsTabs`/`focusDocsTab`)
2. `DocsEventBus` has zero shell-command methods (`requestOpenTab`/`requestListTabs`/`requestFocusTab`)
3. Every `DocumentService` method is either behavior-complete or explicitly removed
4. `saveNew` is behavior-complete (uses `Settings.getDefaultSaveDir()` + `Files.uniquePath()`)
5. `SessionRegistry` exists; the bridge queries it; no synthetic sessions
6. `RuntimeContext` uses `ServiceSlot<T>` for service slots; zero `as any` in the runtime factory (excluding narrowly-scoped Electron type narrowing, which is documented)
7. `Files.uniquePath()` handles any extension (not just `.docx`); has 5+ behavioral tests
8. Service-level tests cover open/save/saveAs/saveNew/recovery/external-modified/recents
9. `apps/` is byte-identical to its pre-correction state
10. All existing tests pass (no regression)

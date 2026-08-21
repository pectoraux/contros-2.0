# ADR-002: Renderer Compatibility Bridge Strategy

**Status**: Approved (frozen) — 2026-08-21
**Supersedes**: none
**Superseded by**: none
**Required by**: [ADR-001: Platform Extraction Architecture](./ADR-001-platform-extraction-architecture.md)

---

## 1. Context

ADR-001 froze the target architecture: a four-layer platform-neutral office runtime (Runtime Contracts → Domain Services → Platform Capabilities → Adapters) with the existing renderers preserved as Layer 5 applications.

The final architectural correction introduces a fifth layer between the renderers and the domain services: **the Renderer Compatibility Bridge**. This layer exists because the renderers are the most valuable existing asset — Docs has years of TipTap/editor state assumptions, Slides expects a specific session lifecycle, Sheets is deeply coupled to Univer and gateway state, PDF expects filesystem-like flows. Replacing `window.desktop.save()` with `documentService.save()` inside every renderer is a large migration surface that risks destabilizing mature code.

The bridge preserves the existing `window.*` API shapes that renderers consume today, but routes every call internally to the appropriate domain service. The renderer does not know the migration happened. The bridge is then gradually removed in Phase 6 (cleanup), after all editors run under both adapters and the migration is verified.

**The strategic insight**: GenOffice is not being rewritten. It is being **unbundled from Electron**. The bridge is the scaffolding that lets the unbundling happen underneath the renderers without disturbing them.

## 2. API Mapping Strategy

### 2.1 The bridge surface

The bridge exposes the exact same globals the renderers consume today, with identical TypeScript signatures:

| Global | Signature source | Consumed by |
|---|---|---|
| `window.aiOffice` | `apps/shell/src/shared/home-api.ts:60-146` (35 methods) | Shell renderer (Home, SettingsModal, Onboarding, StarPromptCard) |
| `window.aiOfficeTabs` | `apps/shell/src/shared/tabs-api.ts:12-42` (8 methods + 2 push) | Shell renderer (TabBar) |
| `window.aiOfficeProject` | `apps/shell/src/shared/home-api.ts:229-244` (7 methods) | Shell renderer (ProjectPanel) |
| `window.desktop` | `apps/docs/src/shared/ipc.ts:140-279` (~35 methods) | Docs renderer |
| `window.desktopApi` | `apps/sheets/src/shared/desktop-api.ts:2109-2201` (35 methods) | Sheets renderer |
| `window.slidesApi` | `apps/slides/src/shared/ipc.ts` (~140 methods) | Slides renderer |
| `window.pdfApi` | `apps/pdf/src/shared/ipc.ts` (~30 methods) | PDF renderer |
| `window.markdownApi` | `apps/markdown/src/shared/ipc.ts` (~12 methods) | Markdown renderer |
| `window.projectApi` | `@genoffice/project-store` interface (8 methods) | All editor renderers (chat history) |
| `window.aiOfficeUpdate` | `apps/shell/src/shared/update-api.ts` (5 methods + 1 push) | Update window renderer |

**Total**: ~280 methods across 10 distinct `window.*` global names. These interfaces are the bridge contract — every method signature, parameter type, and return type is preserved verbatim.

> **Milestone 1 reconciliation (frozen 2026-08-21):** The previous draft of this ADR said "10 explicit typed bridge factories". The actual Milestone 1 implementation produced **11 bridge factories** covering **10 distinct `window.*` global names**. The +1 factory is required because `window.desktop` is consumed by TWO different renderers (docs + slides) with TWO different TypeScript shapes:
>
> - `apps/docs/src/shared/ipc.ts` declares `window.desktop: DesktopApi` (~35 methods)
> - `apps/slides/src/shared/ipc.ts` declares `window.desktop: DesktopFilesApi` (6 methods)
>
> Same global name, different shapes — each editor bundle declares its own `Window` augmentation. Two separate bridge factories are required:
> - `createDocsDesktopBridge` (returns `DesktopApi`)
> - `createSlidesDesktopBridge` (returns `DesktopFilesApi`)
>
> The Project pair (`createProjectApiBridge` + `createProjectHomeBridge`) covers TWO DIFFERENT global names with DIFFERENT shapes:
> - `window.projectApi` → `ProjectApi` (10 methods, used by editor renderers)
> - `window.aiOfficeProject` → `ProjectHomeApi` (7 methods, used by shell renderer)
>
> The authoritative bridge factory inventory (verified against the actual checked-in `apps/*/src/shared/*-api.ts` interfaces) is:
>
> 1. `createHomeBridge` → `window.aiOffice` (HomeApi)
> 2. `createTabsBridge` → `window.aiOfficeTabs` (TabsApi)
> 3. `createProjectApiBridge` → `window.projectApi` (ProjectApi, editor variant)
> 4. `createProjectHomeBridge` → `window.aiOfficeProject` (ProjectHomeApi, shell variant)
> 5. `createUpdateBridge` → `window.aiOfficeUpdate` (UpdateWindowApi)
> 6. `createDocsDesktopBridge` → `window.desktop` (DesktopApi, docs variant)
> 7. `createSheetsDesktopApiBridge` → `window.desktopApi` (DesktopApi, sheets variant)
> 8. `createSlidesApiBridge` → `window.slidesApi` (SlidesApi)
> 9. `createSlidesDesktopBridge` → `window.desktop` (DesktopFilesApi, slides variant)
> 10. `createPdfApiBridge` → `window.pdfApi` (PdfApi)
> 11. `createMarkdownApiBridge` → `window.markdownApi` (MarkdownApi)
>
> No factory is redundant. The authoritative contract source from this point forward is the actual checked-in `apps/*/src/shared/*-api.ts` files; ADR pseudocode is illustrative only.

### 2.2 The mapping pattern (explicit typed method mappings)

Each global becomes a thin proxy that delegates to a domain service method. The mapping is **explicit and statically typed** — not implemented via `Proxy`. Explicit mappings are auditable, statically checkable, deterministic, and make the migration surface visible. A `Proxy` would obscure exactly the contract we are trying to freeze.

```typescript
// packages/renderer-bridge/src/bridges/docs-bridge.ts
import type { DesktopApi } from '@genoffice/docs-shared'  // existing type from apps/docs/src/shared/ipc.ts
import type { DocumentService, RuntimeContext } from '@genoffice/runtime-contracts'

export function createDesktopBridge(docs: DocumentService, runtime: RuntimeContext): DesktopApi {
  return {
    // File operations
    open: () => docs.openDialog().then(r => r ?? null),
    openPath: (path: string) => docs.open(path).then(() => null),
    consumePendingOpen: () => docs.consumePendingOpen(),
    consumeNewBlank: () => docs.consumeNewBlank(),
    save: (path, data, auto) => docs.save(path, new Uint8Array(data), { auto }),
    saveAs: (defaultName, data) => docs.saveAs(defaultName, new Uint8Array(data)),
    saveNew: (defaultName, data) => docs.saveNew(defaultName, new Uint8Array(data)),
    writeRecovery: (path, data) => docs.writeRecovery(path, new Uint8Array(data)),
    recent: () => docs.recent(),

    // Image / attachment operations
    pickImage: () => docs.pickImage(),
    filesPick: () => docs.pickAttachments(),
    filesAdd: (paths) => docs.addAttachments(paths),
    filesAddPastedImage: (data, ext) => docs.addPastedImage(data, ext),
    filesRead: (path, offset, maxChars) => docs.readAttachment(path, offset, maxChars),
    filesReadImage: (path) => docs.readAttachmentImage(path),

    // Print / export
    print: () => docs.print(),
    exportPdf: (defaultName, w, h, outPath) =>
      docs.exportPdf({ defaultName, pageWidthTwips: w, pageHeightTwips: h, outPath }),
    printPdfBuffer: (w, h) => docs.printPdfBuffer(w, h),
    saveMergedPdf: (defaultName, parts) => docs.saveMergedPdf(defaultName, parts),

    // Font metrics
    fontMetrics: (family) => docs.fontMetrics(family),

    // AI passthrough (delegates to runtime.ai, not docs service)
    aiStream: (req) => runtime.ai.stream(req),
    onAiStream: (cb) => runtime.ai.onStream(cb),
    aiStreamCancel: (id) => runtime.ai.streamCancel(id),
    aiChat: (req) => runtime.ai.chat(req),
    aiGskStatus: (withEmail) => runtime.identity.accountStatus(),
    aiGskLogin: () => runtime.identity.login(),
    webSearch: (q, n) => runtime.ai.webSearch(q, n),
    imageSearch: (q, n) => runtime.ai.imageSearch(q, n),
    fetchImage: (url) => runtime.ai.fetchImage(url),

    // App-level (delegates to runtime.settings + runtime.windowing)
    getLanguage: () => runtime.settings.getLanguage(),
    onLanguageChanged: (cb) => runtime.settings.onLanguageChanged(cb),
    getTheme: () => runtime.settings.getTheme(),
    onThemeChanged: (cb) => runtime.settings.onThemeChanged(cb),
    onChromePressed: (cb) => runtime.windowing.onChromePressed(cb),

    // Events (push from service to renderer)
    onTeardown: (cb) => docs.onTeardown(cb),
    onOpened: (cb) => docs.onOpened(cb),
    onRenamed: (cb) => docs.onRenamed(cb),
    onCloseSaveRequest: (cb) => docs.onCloseSaveRequest(cb),
    reportCloseSaveResult: (ok) => docs.reportCloseSaveResult(ok),
    onMenuAction: (cb) => docs.onMenuAction(cb),

    // Window/tab (delegates to runtime.windowing)
    newWindow: (openPath) => runtime.windowing.newTab('docs', openPath),
    listTabs: () => runtime.windowing.listTabs(),
    focusTab: (id) => runtime.windowing.activateTab(id),

    // File-system passthrough (only Electron supports absolute paths)
    getPathForFile: (file) => runtime.files.getPathForFile(file),
  }
}
```

**Key observations about this mapping**:

1. **One bridge per editor** — `createDesktopBridge`, `createSlidesApiBridge`, `createPdfApiBridge`, etc. Each is a pure function that takes the relevant domain service(s) and returns the existing global shape.

2. **Some methods delegate to the editor's domain service** (e.g. `docs.save` → `documentService.save`). Others delegate to platform capabilities (e.g. `docs.aiStream` → `runtime.ai.stream`). The bridge is the single dispatch point.

3. **The signature is preserved verbatim** — `DesktopApi` is imported from the existing `apps/docs/src/shared/ipc.ts`. The bridge is type-checked against the exact interface the renderer expects. If the renderer's expected API changes, the bridge fails to compile.

4. **Adapter-specific conversions happen in the bridge, not the renderer** — e.g. Electron's `data: ArrayBuffer` becomes `new Uint8Array(data)` before passing to the service. The renderer keeps passing `ArrayBuffer`; the service receives `Uint8Array`.

### 2.3 The bridge installation (NOT inside the bridge package)

**Architectural clarification (frozen)**: `packages/renderer-bridge` is **pure object factories**. It must **not** know about either installation mechanism. It must **not** mutate `window`.

The bridge package produces:

```
createDesktopBridge(docs, runtime)  →  DesktopApi object
```

and nothing more. The installation mechanisms live elsewhere:

- **Electron preload** = Electron installation mechanism:
  ```typescript
  // apps/docs/src/preload/index.ts (post-extraction)
  import { contextBridge } from 'electron'
  import { getRuntime } from '@genoffice/runtime-contracts'
  import { createDesktopBridge, createProjectBridge } from '@genoffice/renderer-bridge'

  const runtime = getRuntime()
  contextBridge.exposeInMainWorld('desktop', createDesktopBridge(runtime.docs, runtime))
  contextBridge.exposeInMainWorld('projectApi', createProjectBridge(runtime.project))
  ```

- **Web iframe bootstrap** = browser installation mechanism:
  ```typescript
  // apps/web-shell/src/iframes/docs-bootstrap.ts
  import { getRuntime } from '@genoffice/runtime-contracts'
  import { createDesktopBridge, createProjectBridge } from '@genoffice/renderer-bridge'

  const runtime = getRuntime()
  ;(window as any).desktop = createDesktopBridge(runtime.docs, runtime)
  ;(window as any).projectApi = createProjectBridge(runtime.project)

  // Then load the editor bundle
  import('./docs-renderer.js')
  ```

This separation keeps Rule 2 (below) genuinely enforceable: `packages/renderer-bridge` contains zero references to `contextBridge`, `window`, `ipcRenderer`, or `postMessage`. Architecture tests verify this.

### 2.4 Bidirectional event flow

Events that push from main → renderer (e.g. `onOpened`, `onRenamed`, `onTeardown`, `onCloseSaveRequest`, `onChromePressed`, `onThemeChanged`, `onLanguageChanged`) are handled by the bridge via subscription adapters:

```typescript
// packages/renderer-bridge/src/bridges/docs-bridge.ts (continued)
onOpened: (cb) => docs.onOpened(cb),
onRenamed: (cb) => docs.onRenamed(cb),
onTeardown: (cb) => docs.onTeardown(cb),
onCloseSaveRequest: (cb) => docs.onCloseSaveRequest(cb),
reportCloseSaveResult: (ok) => docs.reportCloseSaveResult(ok),
onMenuAction: (cb) => docs.onMenuAction(cb),

// Cross-cutting events (delegate to runtime, not docs service)
onLanguageChanged: (cb) => runtime.settings.onLanguageChanged(cb),
onThemeChanged: (cb) => runtime.settings.onThemeChanged(cb),
onChromePressed: (cb) => runtime.windowing.onChromePressed(cb),
```

The service exposes `onXxx(handler): () => void` subscription methods. The bridge forwards them. The renderer's existing `useEffect(() => window.desktop.onOpened(handler), [])` patterns work unchanged.

## 3. Migration Rules

### Rule 1 — Bridge methods are 1:1 with existing `window.*` methods

Every method on every bridge corresponds to exactly one method on the existing `window.*` global. No methods are added, removed, renamed, or re-typed during migration. The bridge is a faithful proxy, not an opportunity to refactor the API.

**Enforcement**: the bridge imports the existing types (`DesktopApi` from `apps/docs/src/shared/ipc.ts`, `SlidesApi` from `apps/slides/src/shared/ipc.ts`, etc.) and returns objects typed as those interfaces. TypeScript compilation fails if the bridge deviates.

### Rule 2 — Bridge methods delegate to domain services, never to IPC directly

A bridge method must call `runtime.docs.X()` / `runtime.ai.X()` / `runtime.storage.X()` / etc. It must never call `ipcRenderer.invoke(...)` or `window.parent.postMessage(...)` directly. The bridge is platform-neutral; platform-specific transport is the adapter's job.

**Enforcement**: architecture test that greps `packages/renderer-bridge/src/` for `ipcRenderer`, `ipcMain`, `postMessage`, `fetch`, `indexedDB`, `localStorage`, `window.open`, `contextBridge` — all forbidden. Violations fail CI.

### Rule 3 — Bridge methods perform signature conversion only, no business logic

The bridge may convert types (e.g. `ArrayBuffer` → `Uint8Array`, `string` → `FileHandle`), but must not implement product behavior. If a method needs to call two services (e.g. `window.desktop.save` calls `documentService.save` + `runtime.identity.touchActivity`), that composition belongs in the domain service, not the bridge.

**Enforcement**: code review checklist + architecture test limiting each bridge method to a single service call + type conversion. Methods exceeding ~5 lines are flagged.

### Rule 4 — Renderer code is not touched during Phase 1–5

The renderers continue to call `window.desktop.save()`, `window.slidesApi.editText()`, etc. exactly as they do today. No renderer file is modified to call `runtime.docs.save()` directly until Phase 6.

**Enforcement**: `git diff` audit per phase — `apps/*/src/renderer/` must show zero changes during Phases 1–5 (except for build config updates to consume the new Vite bundles).

### Rule 5 — The bridge is the only place `window.*` globals are assigned

During migration, the `window.desktop` / `window.slidesApi` / `window.pdfApi` / `window.markdownApi` / `window.aiOffice` / `window.aiOfficeTabs` / `window.aiOfficeProject` / `window.projectApi` / `window.aiOfficeUpdate` assignments happen in exactly two places: the Electron preload (`apps/*/src/preload/index.ts`) and the Web iframe bootstrap (`apps/web-shell/src/iframes/*-bootstrap.ts`). Both call `createXxxBridge(runtime)` from `@genoffice/renderer-bridge`. No other code assigns to these globals.

**Note**: the bridge package itself does **not** mutate `window` — see §2.3. The mutation happens in the preload/bootstrap, which calls the bridge factory.

**Enforcement**: architecture test that greps the entire repo for assignments to `window.desktop =`, `window.slidesApi =`, etc. Only the preload and bootstrap files match.

### Rule 6 — New features go in the domain services, not the bridge

If a new feature requires a new method (e.g. a new "share" capability), it is added to `DocumentService` in `runtime-contracts`, implemented in `services-docs`, and exposed on the bridge as a new method on `DesktopApi`. The bridge grows only when the renderer contract grows — never opportunistically.

**Enforcement**: any PR adding a method to a bridge must also add it to the corresponding service interface in `runtime-contracts` AND to both adapter implementations. Architecture test verifies all three exist.

### Rule 7 — The bridge is removed in Phase 6, not before

Phase 6 removes the bridge by migrating renderer code from `window.desktop.save()` to `runtime.docs.save()` directly, file by file. This is the only phase that touches renderer code at scale. Until Phase 6, the bridge is the single source of truth for the `window.*` API shape.

**Enforcement**: Phase 6 is gated by (a) all five editors running under both adapters with parity tests green, (b) a tracking issue listing every `window.*` reference in renderers, (c) incremental migration with per-file PRs.

## 4. Deprecation Plan

### 4.1 Phase 0–5: bridge is active, no deprecation

During Phases 0–5, the bridge is the canonical way renderers consume the runtime. No `window.*` method is deprecated. The renderer code is frozen.

### 4.2 Phase 6: incremental renderer migration

Phase 6 migrates renderer code from `window.*` to `runtime.*` directly, file by file. The deprecation is **per-file**, not per-method:

1. Pick a renderer file (e.g. `apps/docs/src/renderer/file-actions.ts`).
2. Replace every `window.desktop.X()` call with `runtime.docs.X()` (imported from `@genoffice/runtime-contracts`).
3. Run the docs vitest suite + pagination corpus to verify zero behavior change.
4. Merge the PR.
5. Repeat for the next file.

The bridge remains installed throughout Phase 6 — files that haven't been migrated yet still use it. Once every renderer file is migrated, the bridge is removed.

### 4.3 Phase 6 completion criteria

Phase 6 is complete when:

1. **Zero `window.desktop` / `window.slidesApi` / `window.pdfApi` / `window.markdownApi` / `window.aiOffice` / `window.aiOfficeTabs` / `window.aiOfficeProject` / `window.projectApi` references in `apps/*/src/renderer/`**. (Architecture test enforces.)
2. **Zero `window.desktop` / etc. assignments anywhere except preload shims and iframe bootstraps**. (Architecture test enforces.)
3. **`packages/renderer-bridge` is deleted from the workspace**. Its `package.json` is removed, its `src/` is deleted, and the workspace `package.json` no longer lists it as a dependency.

### 4.4 The shim survives for renderer-internal types only

Some types are defined in `apps/*/src/shared/*-api.ts` (e.g. `DesktopApi`, `SlidesApi`) and imported by both the bridge and the renderer. After the bridge is removed, these types may still be imported by the renderer for parameter/return-type annotations. The types are harmless (they're just TypeScript interfaces, no runtime code). They can be cleaned up opportunistically or left in place.

The runtime contracts in `packages/runtime-contracts` may optionally re-export these types under new names (e.g. `DocumentApi` instead of `DesktopApi`) for clarity, but this is cosmetic and not required for Phase 6 completion.

## 5. Testing Strategy

### 5.1 Bridge contract tests (Phase 1) — three categories

`packages/renderer-bridge/tests/` contains three categories of tests per bridge, implementing Architectural Correction B (shape + dispatch + boundary):

#### 5.1.1 Shape / coverage tests

Verify that every method on the existing interface is implemented by the bridge. Reflection-based:

```typescript
// packages/renderer-bridge/tests/contract/docs-bridge.shape.test.ts
import { createDesktopBridge } from '../src/bridges/docs-bridge'
import type { DesktopApi } from '@genoffice/docs-shared'
import { mockRuntime, mockDocumentService } from './mocks'

test('createDesktopBridge implements every DesktopApi method', () => {
  const bridge = createDesktopBridge(mockDocumentService, mockRuntime)
  const bridgeMethods = Object.keys(bridge).sort()
  const expectedMethods = [
    // ...every property name on DesktopApi, sorted
  ]
  expect(bridgeMethods).toEqual(expectedMethods)
})
```

This test fails if a method is added to `DesktopApi` but not implemented on the bridge, OR if the bridge has extra methods that aren't on the contract.

#### 5.1.2 Dispatch tests

Verify that each bridge method calls the expected service method with the expected arguments. Mock the service, call the bridge method, assert the mock was called.

```typescript
// packages/renderer-bridge/tests/contract/docs-bridge.dispatch.test.ts
test('DesktopApi.save dispatches to DocumentService.save with converted types', async () => {
  const docs = mockDocumentService()
  docs.save = vi.fn().mockResolvedValue({ ok: true })
  const bridge = createDesktopBridge(docs, mockRuntime())

  const path = '/path/to/file.docx'
  const data = new ArrayBuffer(8)
  const auto = true
  await bridge.save(path, data, auto)

  expect(docs.save).toHaveBeenCalledWith(path, expect.any(Uint8Array), { auto })
  // Verify the Uint8Array conversion happened
  const passedBytes = docs.save.mock.calls[0][1]
  expect(passedBytes).toBeInstanceOf(Uint8Array)
  expect(passedBytes.byteLength).toBe(8)
})

test('DesktopApi.aiStream dispatches to runtime.ai.stream (not to DocumentService)', async () => {
  const docs = mockDocumentService()
  const runtime = mockRuntime()
  runtime.ai.stream = vi.fn().mockResolvedValue(undefined)
  const bridge = createDesktopBridge(docs, runtime)

  const req = { requestId: 'r1', /* ... */ } as any
  await bridge.aiStream(req)

  expect(runtime.ai.stream).toHaveBeenCalledWith(req)
  expect(docs.save).not.toHaveBeenCalled()  // dispatch verification — wrong service not called
})

test('DesktopApi.onThemeChanged dispatches to runtime.settings.onThemeChanged', () => {
  const runtime = mockRuntime()
  runtime.settings.onThemeChanged = vi.fn().mockReturnValue(() => {})
  const bridge = createDesktopBridge(mockDocumentService(), runtime)

  const handler = () => {}
  bridge.onThemeChanged(handler)

  expect(runtime.settings.onThemeChanged).toHaveBeenCalledWith(handler)
})
```

These tests are the critical safeguard against a bridge that technically satisfies 280 method signatures while dispatching a method to the wrong service. The mocks assert (a) the correct service method was called with the correct arguments, AND (b) the obviously-wrong service methods were NOT called.

#### 5.1.3 Architecture-boundary tests

Verify that the bridge package itself imports nothing platform-specific:

```typescript
// packages/renderer-bridge/tests/architecture.test.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

test('packages/renderer-bridge/src contains no Electron imports', () => {
  const forbidden = ['electron', 'ipcRenderer', 'ipcMain', 'contextBridge', 'BrowserWindow']
  const srcDir = join(__dirname, '..', 'src')
  const offenders = scanForImports(srcDir, forbidden)
  expect(offenders).toEqual([])
})

test('packages/renderer-bridge/src contains no browser API mutations', () => {
  const forbidden = ['window.', 'document.', 'localStorage', 'indexedDB', 'postMessage', 'fetch(']
  const srcDir = join(__dirname, '..', 'src')
  const offenders = scanForTokens(srcDir, forbidden)
  expect(offenders).toEqual([])
})

test('packages/renderer-bridge/src contains no node: imports', () => {
  const forbidden = [/from ['"]node:/]
  const srcDir = join(__dirname, '..', 'src')
  const offenders = scanForImports(srcDir, forbidden)
  expect(offenders).toEqual([])
})
```

These tests enforce Rule 2 (bridge is platform-neutral) and the architectural clarification in §2.3 (bridge does not mutate `window`).

### 5.2 Adapter parity tests (Phases 2–5)

For each editor, run the existing vitest suite against both adapters. The suite must pass identically under both.

**Electron adapter tests**: the existing `apps/*/tests/` vitest suites, run in Node with the Electron main process. These are the existing tests — they keep running unchanged.

**Web adapter tests**: the same suites, run in a browser via Playwright. The test harness loads the editor in a headless Chrome iframe, installs the Web bridge, and runs the same test cases. This is the parity verification — if the Web adapter produces different behavior than the Electron adapter, the test fails.

**Parity corpus** (per editor):
- Docs: 23-fixture pagination corpus + Word/LibreOffice baselines (`apps/docs/tests/pagination-corpus/`)
- Sheets: 100+ tests covering the xlsx gateway (`apps/sheets/tests/`)
- Slides: 50+ tests covering edit fidelity, animations, masters (`apps/slides/tests/`)
- PDF: 30+ tests covering text editing, annotations, forms (`apps/pdf/tests/`)
- Markdown: 5 tests covering DOCX export, paste, slash commands (`apps/markdown/tests/`)

### 5.3 End-to-end smoke tests (Phases 3–5)

Per editor, an end-to-end Playwright test that:
1. Opens the web shell in a headless browser.
2. Clicks "New AI Docs" (or equivalent).
3. Verifies the editor iframe loads.
4. Types text, saves, reopens the file.
5. Verifies byte-preservation (where applicable) by comparing the saved file's hash to the original.

These tests are slow (5–10 seconds each) and run only on PRs that touch the relevant editor.

### 5.4 Bridge removal verification (Phase 6)

Once Phase 6 begins (per-file renderer migration), each migrated file's vitest suite must pass without the bridge installed. The test harness temporarily stubs `window.desktop = undefined` for migrated files, forcing them to use `runtime.docs` directly.

Phase 6 is complete when:
1. Every renderer file's tests pass without the bridge.
2. The architecture test confirms zero `window.*` references in `apps/*/src/renderer/`.
3. `packages/renderer-bridge` is deleted from the workspace.

## 6. Removal Criteria

The bridge is removed when **all** of the following are true:

### 6.1 Functional criteria

- [ ] All five editors (Markdown, PDF, Docs, Slides, Sheets) run under both adapters (Electron + Web) with full feature parity.
- [ ] Every vitest suite in `apps/*/tests/` passes against both adapters.
- [ ] Every end-to-end smoke test (§5.3) passes against both adapters.
- [ ] The pagination corpus (Docs) produces identical Word/LibreOffice baselines under both adapters.
- [ ] The xlsx gateway test suite (Sheets) passes against the WASM-compiled Rust engine AND the server-side fallback.

### 6.2 Renderer migration criteria

- [ ] Zero `window.desktop`, `window.slidesApi`, `window.pdfApi`, `window.markdownApi`, `window.aiOffice`, `window.aiOfficeTabs`, `window.aiOfficeProject`, `window.projectApi`, `window.aiOfficeUpdate` references in `apps/*/src/renderer/` (enforced by architecture test).
- [ ] Zero `window.desktop =`, `window.slidesApi =`, etc. assignments anywhere except the Electron preload shims and the Web iframe bootstraps (enforced by architecture test).
- [ ] Every renderer file imports `getRuntime` from `@genoffice/runtime-contracts` and calls service methods directly.

### 6.3 Cleanup criteria

- [ ] `packages/renderer-bridge` is deleted from the workspace.
- [ ] The workspace `package.json` no longer lists `@genoffice/renderer-bridge` as a dependency.
- [ ] No remaining imports of `@genoffice/renderer-bridge` anywhere in the repo (enforced by architecture test).
- [ ] The `apps/*/src/shared/*-api.ts` type files may remain (they're just types), but their runtime code (if any) is removed.

### 6.4 Timeline expectation

- Phases 0–5 (bridge active): 6–9 months estimated.
- Phase 6 (incremental renderer migration): 2–3 months estimated.
- Total bridge lifetime: 8–12 months.

The bridge is not a permanent fixture. It is scaffolding. Its purpose is to let the runtime extraction happen without disturbing the renderers; once the extraction is complete and verified, the scaffold is removed.

---

## Final Implementation Order (Frozen)

The implementation order from the approval directive is adopted verbatim.

```
Milestone 1  →  Electron compatibility runtime  →  Electron consolidation  →
Web shell    →  Markdown                         →  PDF                    →
Docs         →  Slides                           →  Sheets                 →
renderer migration  →  bridge deletion           →  cloud backend         →  collaboration
```

### Milestone 1 — Architecture Extraction (Behaviorally Inert)

Create three new packages with skeleton implementations + contract tests:

1. **`packages/runtime-contracts/`** — interfaces + types only.
2. **`packages/platform/`** — capability interfaces + shared types.
3. **`packages/renderer-bridge/`** — bridge factories (skeleton, delegating to stub services) + shape tests + dispatch tests + architecture-boundary tests.

**Absolutely forbidden in Milestone 1**:
- renderer modifications
- main-process modifications
- preload modifications
- shell modifications
- Web shell
- domain implementations
- Electron adapter implementation
- Web adapter implementation
- IPC replacement
- filesystem replacement
- WASM work
- database/backend work
- collaboration work
- architectural refactoring outside the three packages

The existing Electron application must continue operating through its **existing architecture**. The three new packages are initially **dead code**. That is intentional.

**Milestone 1 must be behaviorally inert.** The observable application behavior before and after the milestone must be identical because none of the existing application code imports the new packages. This makes the first commit exceptionally safe: if anything breaks, the regression is immediately attributable to workspace/package configuration rather than runtime migration.

See [MILESTONE-1-HANDOFF.md](./MILESTONE-1-HANDOFF.md) for the exact file-level scope.

---

## Architectural Corrections (frozen into this ADR)

These two corrections were applied during the architecture review pass and are now part of the frozen spec:

**Correction A — `getRuntime()` is bootstrap-only, not a domain dependency.**
Domain services receive their dependencies explicitly through construction (`new DocumentServiceImpl(storage, files, ai, ...)`). They never internally call `getRuntime()`. This prevents the new architecture from quietly recreating the same hidden-global coupling that the migration is intended to eliminate.

**Correction B — Bridge tests must cover both shape and dispatch.**
A bridge that technically satisfies 280 method signatures while dispatching a method to the wrong service is a silent contract violation. Milestone 1 includes shape/coverage tests + dispatch tests + architecture-boundary tests (see §5.1 above for the concrete test categories).

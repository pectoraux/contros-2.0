# Phase 1 Extraction Map — Docs Editor

**Status**: Frozen plan — 2026-08-21
**Required by**: ADR-001, ADR-002
**Implements**: Phase 1 (Electron Compatibility Runtime), first increment = Docs

> **CRITICAL CONSTRAINT (per user directive):** This is a **semantic extraction**, not a mechanical IPC migration.
>
> The target is **NOT** `ipcMain handler → ElectronProvider`.
>
> The target IS:
>
> ```
> Renderer → Bridge → Domain Service → Platform Capability → Electron Adapter
> ```
>
> For each existing IPC handler we identify whether it is:
>
> - **(a) Platform primitive** — pure OS/runtime capability (filesystem, dialog, network, clipboard, font lookup). Belongs in `platform-electron`.
> - **(b) Domain behavior** — product-level semantic operation (byte-preserving save plan, attachment text extraction, recent files curation, external-change guard). Belongs in `services-docs`.
> - **(c) Shell/window orchestration** — multi-tab/multi-window coordination, application menu, close-guard flow. Stays in `apps/docs/src/main/`.
>
> The first verified increment wires ONLY Docs through the new runtime. Sheets/Slides/PDF/Markdown continue using their existing main-process code untouched.

---

## 1. Forensic audit summary

### 1.1 Files affected by Phase 1 (Docs increment)

| File | LOC | Role |
|---|---|---|
| `apps/docs/src/main/docs-main.ts` | 3,846 | All docs IPC handlers + window/view lifecycle + menu + close-guard + project store wiring + AI IPC + recent-files/starred state + path-grant tracking + recovery-dir logic |
| `apps/docs/src/main/atomic-write.ts` | 52 | Atomic write primitive (tmp + rename with Windows retry) |
| `apps/docs/src/main/external-change.ts` | 24 | External-modified detection (mtime+size+hash) |
| `apps/docs/src/main/updater.ts` | 244 | electron-updater integration (Azure CDN feed) |
| `apps/docs/src/main/index.ts` | 3 | Entry: `startDocsStandalone()` |
| `apps/docs/src/preload/index.ts` | 152 | DesktopApi + ProjectApi → `contextBridge.exposeInMainWorld` |
| `apps/docs/src/shared/ipc.ts` | — | **FROZEN — DO NOT TOUCH.** The authoritative `DesktopApi` contract. |
| `apps/docs/src/shared/open-file.ts` | 9 | Argv parser for `.docx` path (used by standalone launch) |
| `packages/electron-utils/src/*.ts` | 9 files | Cross-suite Electron utilities (menus, dialogs, safe URLs, default-save-dir, navigation-guard, context-menu, remote-image) |
| `packages/project-store/src/*.ts` | — | Filesystem-backed project store — already a workspace package; Phase 1 wraps it (does NOT move it) |
| `packages/font-metrics/src/*.ts` | — | Native font probing — already a workspace package; Phase 1 wraps it (does NOT move it) |
| `packages/file-parse/src/*.ts` | — | Multi-format text extraction — already a workspace package; Phase 1 wraps it (does NOT move it) |
| `packages/ai-search/src/*.ts` | — | GSK CLI wrapper + Serper/DuckDuckGo — already a workspace package; Phase 1 wraps it |
| `packages/ai-provider/src/*.ts` | — | AI provider types — already a workspace package |

### 1.2 Docs IPC handler inventory (45 handlers)

| Channel | File:line | Categorization | Destination |
|---|---|---|---|
| `app:get-language` | docs-main:2828 | (a) platform primitive | `platform-electron` Settings capability |
| `app:theme-changed` (push) | docs-main (shell broadcasts) | (a) platform primitive | `platform-electron` Settings.onThemeChanged |
| `app:chrome-pressed` (push) | docs-main (shell broadcasts) | (c) shell/window orchestration | stays in shell |
| `docs:font-metrics` | docs-main:2831 | (a) platform primitive | `platform-electron` FontRegistry capability (wraps `@genoffice/font-metrics`) |
| `docs:open` | docs-main:2835 | (b) domain behavior + (a) platform primitive (dialog) | `services-docs` `DocumentService.openDialog()` → calls `Files.pickOpen()` → `DocumentService.open(path)` which calls `docx-engine.parseDocx()` + `Storage.writeBlob()` (originals archive) |
| `docs:open-path` | docs-main:2845 | (b) domain behavior | `services-docs` `DocumentService.open(path)` — the same open without the dialog |
| `docs:consume-pending-open` | docs-main:2847 | (c) shell/window orchestration | stays in `apps/docs/src/main/` (reads `pendingOpenPath` queue) but calls `services-docs.DocumentService.open()` to do the work |
| `docs:consume-new-blank` | docs-main:2861 | (c) shell/window orchestration | stays in `apps/docs/src/main/` (reads `pendingNewBlankIds` set) |
| `docs:save` | docs-main:2870 | (b) domain behavior + (a) platform primitive | `services-docs` `DocumentService.save()` — runs external-change check, calls `Files.write()` (atomic), updates `Storage` (recovery clear, recent), pushes menu rebuild via `Windowing` callback |
| `docs:write-recovery` | docs-main:2917 | (b) domain behavior + (a) platform primitive | `services-docs` `DocumentService.writeRecovery()` → `Files.write(recoveryPath, bytes)` |
| `docs:save-as` | docs-main:2945 | (b) domain behavior + (a) platform primitive (dialog) | `services-docs` `DocumentService.saveAs()` → calls `Files.pickSave()` → `Files.write()` |
| `docs:save-new` | docs-main:2970 | (b) domain behavior + (a) platform primitive | `services-docs` `DocumentService.saveNew()` → resolves unique path in `Settings.getDefaultSaveDir()` → `Files.write()` |
| `docs:recent` | docs-main:2994 | (b) domain behavior | `services-docs` `DocumentService.recentFiles()` → reads `Storage.readObject('recents', ...)` |
| `docs:pick-image` | docs-main:2998 | (a) platform primitive | `services-docs` `DocumentService.pickImage()` → `Files.pickOpen({accept:[png,jpg,jpeg,gif]})` → reads bytes → returns base64 |
| `docs:print` | docs-main:3090 | (a) platform primitive | `services-docs` `DocumentService.print()` → `Printing.print()` (webContents.print) |
| `docs:export-pdf` | docs-main:3104 | (b) domain behavior + (a) platform primitive | `services-docs` `DocumentService.exportPdf()` → `Files.pickSave()` (when no outPath) → `Printing.printToBytes()` → `Files.write()` |
| `docs:print-pdf-buffer` | docs-main:3147 | (a) platform primitive | `services-docs` `DocumentService.printPdfBuffer()` → `Printing.printToBytes()` (returns base64 to renderer) |
| `docs:save-merged-pdf` | docs-main:3167 | (b) domain behavior | `services-docs` `DocumentService.saveMergedPdf()` → calls `pdf-lib` (already pure JS) to merge → `Files.write()` |
| `docs:teardown` (push) | docs-main:2200 | (c) shell/window orchestration | stays in `apps/docs/src/main/` (close-guard flow); pushes to renderer via bridge `DocumentService.onTeardown()` |
| `docs:close-check` (push) | docs-main:3593 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; pushes via bridge `DocumentService.onCloseCheck()` |
| `docs:close-check-result` | docs-main:3611 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; bridge `DocumentService.reportCloseCheck()` |
| `docs:close-save-request` (push) | docs-main (close-guard) | (c) shell/window orchestration | stays in `apps/docs/src/main/`; pushes via bridge `DocumentService.onCloseSaveRequest()` |
| `docs:close-save-result` | docs-main:3627 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; bridge `DocumentService.reportCloseSaveResult()` |
| `docs:view-menu-state` | docs-main:3593 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; bridge `DocumentService.reportViewMenuState()` |
| `docs:opened` (push) | docs-main (renamed/opened) | (c) shell/window orchestration | stays in `apps/docs/src/main/`; pushes via bridge `DocumentService.onOpened()` |
| `docs:renamed` (push) | docs-main (renamed) | (c) shell/window orchestration | stays in `apps/docs/src/main/`; pushes via bridge `DocumentService.onRenamed()` |
| `menu:command` (push) | docs-main:3248 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; pushes via bridge `DocumentService.onMenuCommand()` |
| `files:pick` | docs-main:3016 | (a) platform primitive | `services-docs` `DocumentService.pickAttachments()` → `Files.pickOpen({multiple})` → `file-parse` extracts metadata |
| `files:add` | docs-main:3029 | (b) domain behavior | `services-docs` `DocumentService.addAttachmentPaths(paths)` → uses `file-parse` to validate |
| `files:add-pasted-image` | docs-main:3080 | (b) domain behavior + (a) platform primitive | `services-docs` `DocumentService.addPastedImage()` → saves temp file via `Files.write()` → returns metadata |
| `files:read` | docs-main:3031 | (b) domain behavior | `services-docs` `DocumentService.readAttachment()` → uses `@genoffice/file-parse` `parseFileToText()` |
| `files:read-image` | docs-main:3063 | (a) platform primitive | `services-docs` `DocumentService.readAttachmentImage()` → `Files.read()` → base64 |
| `win:new` | docs-main:3200 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; calls `shellHooks.openTab()` or `createDocsWindow()` |
| `win:list` | docs-main:3210 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; calls `shellHooks.listTabs()` or `BrowserWindow.getAllWindows()` |
| `win:focus` | docs-main:3219 | (c) shell/window orchestration | stays in `apps/docs/src/main/`; calls `shellHooks.focusTab()` or `BrowserWindow.fromId()` |
| `ai:get-settings` | docs-main:2469 | (a) platform primitive | `platform-electron` AI capability |
| `ai:set-settings` | docs-main:2492 | (a) platform primitive | `platform-electron` AI capability |
| `ai:stream` | docs-main:2496 | (a) platform primitive | `platform-electron` AI.stream() → uses `@genoffice/ai-provider` `streamForProvider` |
| `ai:stream-chunk` (push) | docs-main (stream loop) | (a) platform primitive | `platform-electron` AI.onStream() |
| `ai:stream-cancel` | docs-main:2565 | (a) platform primitive | `platform-electron` AI.streamCancel() |
| `ai:chat` | docs-main:2610 | (a) platform primitive | `platform-electron` AI.chat() |
| `ai:gsk-status` | docs-main:2478 | (a) platform primitive | `platform-electron` Identity.accountStatus() |
| `ai:gsk-login` | docs-main:2488 | (a) platform primitive | `platform-electron` Identity.login() |
| `ai:web-search` | docs-main:2570 | (a) platform primitive | `platform-electron` AI.webSearch() → uses `@genoffice/ai-search` |
| `ai:image-search` | docs-main:2577 | (a) platform primitive | `platform-electron` AI.imageSearch() → uses `@genoffice/ai-search` |
| `ai:fetch-image` | docs-main:2586 | (a) platform primitive | `platform-electron` AI.fetchImage() → uses `@genoffice/electron-utils` `fetchRemoteImage` |
| `project:resolveChat` | docs-main:2688 | (b) domain behavior (chat history) | `services-docs` calls `ProjectStore.resolveChat()` (the existing `@genoffice/project-store` package) |
| `project:appendChat` | docs-main:2708 | (b) domain behavior | `services-docs` calls `ProjectStore.appendChat()` |
| `project:loadChat` | docs-main:2739 | (b) domain behavior | `services-docs` calls `ProjectStore.loadChat()` |
| `project:rebindChat` | docs-main:2755 | (b) domain behavior | `services-docs` calls `ProjectStore.rebindChat()` |
| `project:list` | docs-main:2783 | (b) domain behavior | `services-docs` calls `ProjectStore.listProjects()` |
| `project:files` | docs-main:2788 | (b) domain behavior | `services-docs` calls `ProjectStore.listFiles()` |
| `project:create` | docs-main:2793 | (b) domain behavior | `services-docs` calls `ProjectStore.createProject()` |
| `project:rename` | docs-main:2801 | (b) domain behavior | `services-docs` calls `ProjectStore.renameProject()` |
| `project:delete` | docs-main:2806 | (b) domain behavior | `services-docs` calls `ProjectStore.deleteProject()` |
| `project:moveFile` | docs-main:2811 | (b) domain behavior | `services-docs` calls `ProjectStore.moveFile()` |
| `project:timeline` | docs-main:2816 | (b) domain behavior | `services-docs` calls `ProjectStore.getTimeline()` |

### 1.3 Categorization totals

| Category | Count | Destination |
|---|---|---|
| **(a) Platform primitives** | 16 handlers | `packages/platform-electron/` |
| **(b) Domain behavior** | 22 handlers | `packages/services-docs/` |
| **(c) Shell/window orchestration** | 14 handlers (incl. 8 push events) | stays in `apps/docs/src/main/` |
| **Total** | 52 entries (45 invoke + 7 push) | |

The push events (renderer-bound) are how main → renderer communicates; they remain in `apps/docs/src/main/` because they require access to `webContents.send()`. The domain service exposes `onXxx(handler)` subscription methods; the main-process glue subscribes to those and forwards to the active webContents.

---

## 2. Dependency direction (the critical architectural constraint)

```
                         apps/docs/src/main/index.ts (bootstrap)
                                    │
                                    ▼
                         setRuntime(createElectronRuntime({
                           appKind: 'docs',
                           shellHooks,         // ← shell/window orchestration stays here
                           pendingOpenPath,    // ← shell/window orchestration
                           pendingNewBlankIds, // ← shell/window orchestration
                         }))
                                    │
                                    ▼
                ┌───────────────────────────────────────────┐
                │  RuntimeContext (frozen, from Milestone 1) │
                │  storage / files / ai / identity /         │
                │  printing / clipboard / notifications /    │
                │  windowing / settings                      │
                │  + docs (DocumentService)                  │
                │  + project (ProjectStoreService)            │
                └───────────────────────────────────────────┘
                                    ▲
                                    │ constructed by
                                    │
                ┌───────────────────────────────────────────┐
                │  packages/platform-electron/               │
                │  ElectronStorage (node:fs + userData/)    │
                │  ElectronFiles (dialog + node:fs + shell) │
                │  ElectronAI (net.fetch + gsk CLI)         │
                │  ElectronIdentity (gsk CLI via ai-search)  │
                │  ElectronPrinting (webContents.printToPDF)│
                │  ElectronClipboard (clipboard + nativeImg)│
                │  ElectronNotifications (Notification)      │
                │  ElectronWindowing (BrowserWindow +       │
                │    WebContentsView + nativeTheme + shell) │
                │  ElectronSettings (app-settings.json +     │
                │    nativeTheme broadcast)                  │
                │  + FontRegistry (wraps font-metrics)       │
                └───────────────────────────────────────────┘
                                    ▲
                                    │ used by
                                    │
                ┌───────────────────────────────────────────┐
                │  packages/services-docs/                   │
                │  DocumentServiceImpl(storage, files, ai,   │  ← constructor injection
                │    printing, fonts, projectStore,          │     (NO getRuntime() inside!)
                │    runtimeForEvents)                        │
                │                                            │
                │  Composes:                                 │
                │    @genoffice/docx-engine (parseDocx,       │
                │      saveDocx, buildBlankDocx)              │
                │    @genoffice/file-parse (parseFileToText) │
                │    + byte-preserving save plan logic        │
                │      (moved from renderer's convert.ts)    │
                └───────────────────────────────────────────┘
                                    ▲
                                    │ consumed by
                                    │
                ┌───────────────────────────────────────────┐
                │  apps/docs/src/preload/index.ts (shim)     │
                │  contextBridge.exposeInMainWorld('desktop',│
                │    createDocsDesktopBridge(getRuntime()))   │
                │  contextBridge.exposeInMainWorld(          │
                │    'projectApi',                            │
                │    createProjectApiBridge(getRuntime()))    │
                └───────────────────────────────────────────┘
                                    ▲
                                    │ calls window.desktop.*
                                    │
                ┌───────────────────────────────────────────┐
                │  apps/docs/src/renderer/ (UNCHANGED)       │
                │  React + TipTap + ProseMirror + docx-engine │
                │  Calls window.desktop.saveDocx(path, bytes) │
                │  exactly as before                         │
                └───────────────────────────────────────────┘
```

**Critical invariants**:

1. **Domain services receive dependencies via constructor.** `new DocumentServiceImpl(storage, files, ai, printing, fonts, projectStore, eventBus)` — they NEVER call `getRuntime()` internally.
2. **The bridge receives the runtime as a parameter.** `createDocsDesktopBridge(getRuntime())` — it doesn't call `getRuntime()` itself either.
3. **`getRuntime()` is bootstrap-only.** It is called once at app startup in `apps/docs/src/main/index.ts`. After that, all dependencies flow through constructor parameters.
4. **Renderer code stays frozen.** The bridge preserves the exact `DesktopApi` shape; the renderer cannot tell the difference.

---

## 3. What moves where — concrete file plan

### 3.1 New packages created in Phase 1 increment 1

| Package | New in this increment? | Contents |
|---|---|---|
| `packages/platform-electron/` | ✅ New | All 9 `Electron*` capability implementations + `ElectronRuntime` factory + `FontRegistry` wrapper |
| `packages/services-docs/` | ✅ New | `DocumentServiceImpl` (full implementation) — composes `@genoffice/docx-engine` + the 9 capabilities |

### 3.2 Existing packages — wrapping (NOT moving)

| Existing package | Phase 1 action |
|---|---|
| `@genoffice/docx-engine` | No change. `services-docs` imports it directly. |
| `@genoffice/file-parse` | No change. `services-docs` imports it directly. |
| `@genoffice/project-store` | No change. `platform-electron` constructs an instance and exposes it as `runtime.project`. |
| `@genoffice/font-metrics` | No change. `platform-electron` wraps `familyVerticalMetrics` behind the `FontRegistry` capability. |
| `@genoffice/ai-provider` | No change. `platform-electron` uses `streamForProvider` / `chatForProvider` from this package. |
| `@genoffice/ai-search` | No change. `platform-electron` uses `webSearch` / `imageSearch` / `gskLoginInfo` etc. from this package. |
| `@genoffice/i18n` | No change. `platform-electron` Settings capability uses `getUiLang()` / `setUiLang()`. |
| `@genoffice/electron-utils` | No change YET. `platform-electron` imports from it directly. (Absorb happens in a later cleanup phase.) |

### 3.3 Apps files modified

| File | Change |
|---|---|
| `apps/docs/src/main/index.ts` | Grows from 3 LOC to ~30 LOC — calls `createElectronRuntime({ appKind: 'docs' })` + `setRuntime(runtime)` + `startDocsStandalone()` |
| `apps/docs/src/main/docs-main.ts` | Shrinks from 3,846 LOC to ~400 LOC. The 16 platform-primitive handlers + 22 domain-behavior handlers are removed (they live in `platform-electron` + `services-docs` now). The 14 shell/window-orchestration handlers stay. The window/view creation (`createDocsWindow`, `createDocsView`) stays. The menu builder stays. The close-guard flow stays. |
| `apps/docs/src/main/atomic-write.ts` | **Stays in place** — `platform-electron` `ElectronFiles` imports it directly. (In a later cleanup phase it can move into `platform-electron`.) |
| `apps/docs/src/main/external-change.ts` | **Stays in place** — `services-docs` `DocumentServiceImpl` imports it directly. |
| `apps/docs/src/main/updater.ts` | **Stays in place** for now — updater wiring is part of shell orchestration, not in scope for the Docs increment. |
| `apps/docs/src/preload/index.ts` | Shrinks from 152 LOC to ~10 LOC — calls `createDocsDesktopBridge(getRuntime())` + `createProjectApiBridge(getRuntime())` + `contextBridge.exposeInMainWorld(...)`. The existing `DesktopApi` typed object literal is replaced by the bridge factory. |
| `apps/docs/src/shared/ipc.ts` | **UNCHANGED — frozen.** |
| `apps/docs/src/shared/open-file.ts` | **UNCHANGED.** |
| `apps/docs/src/renderer/*` | **UNCHANGED — frozen.** |

### 3.4 Root config changes (minimal)

| File | Change |
|---|---|
| `package.json` | Add `@genoffice/platform-electron` and `@genoffice/services-docs` to the `test` + `typecheck` script chains. |
| `tsconfig.base.json` | No change (the `@genoffice/*-shared` aliases from Milestone 1 cover what these packages need). |

---

## 4. Behavior-preservation test plan

Every test below must pass identically before/after the extraction. **If any regresses, the extraction is wrong.**

### 4.1 Existing test suites (no new tests written — these are the gate)

| Suite | Location | Test count | What it verifies |
|---|---|---|---|
| Docs vitest suite | `apps/docs/tests/` | ~50 tests | Atomic write, external-change, recent-files, save-error-localization, doc-dirty, etc. |
| Docs pagination corpus | `apps/docs/tests/pagination-corpus/` | 23 fixtures | Word-faithful pagination against Word + LibreOffice baselines |
| Docx-engine vitest suite | `packages/docx-engine/tests/` | ~50 tests | Byte-preserving save plan, paragraph patching, table edit fidelity, math, sections, headers/footers |
| File-parse vitest suite | `packages/file-parse/tests/` | ~10 tests | Attachment text extraction for docx/xlsx/pptx/pdf |
| Project-store vitest suite | `packages/project-store/tests/` | ~5 tests | Filesystem project store |
| Electron-utils vitest suite | `packages/electron-utils/tests/` | ~7 tests | Safe URLs, dialog memory, context menu, default-save-dir |
| AI-provider vitest suite | `packages/ai-provider/tests/` | ~5 tests | Provider config + stream/chat |
| AI-search vitest suite | `packages/ai-search/tests/` | ~5 tests | Web/image search, gsk auth |
| Font-metrics vitest suite | `packages/font-metrics/tests/` | ~3 tests | Vertical metrics |
| Milestone 1 contract tests | `packages/renderer-bridge/tests/`, `packages/runtime-contracts/tests/`, `packages/platform/tests/` | 82 tests | The bridge shape + dispatch + architecture boundary |

### 4.2 New tests for the Phase 1 increment

| New suite | Location | What it verifies |
|---|---|---|
| `packages/services-docs/tests/document-service.test.ts` | new | `DocumentServiceImpl.open()` calls `Files.read()` + `docx-engine.parseDocx()` + `Storage.writeBlob()` (originals archive). `save()` runs external-change check, calls `Files.write()` (atomic), clears recovery. `saveAs()` calls `Files.pickSave()`. Mocked capabilities; verifies delegation + non-delegation + arg/return transformation. |
| `packages/platform-electron/tests/capabilities.test.ts` | new | Each `Electron*` capability correctly wraps the underlying Electron API. Mocked Electron; verifies the wrapper is a thin pass-through. |
| `packages/platform-electron/tests/architecture.test.ts` | new | Verifies `platform-electron` may import `electron`, `node:*`, `@genoffice/electron-utils`, `@genoffice/font-metrics`, `@genoffice/ai-search`, `@genoffice/project-store`, `@genoffice/i18n` — but NOT `@genoffice/runtime-contracts`, `@genoffice/platform`, `@genoffice/renderer-bridge`, or any renderer code. |

### 4.3 Manual smoke (must work identically)

1. Launch the Electron app (or docs standalone).
2. File → New → type text → Save → choose path → file written to disk.
3. File → Open → choose a `.docx` → document loads, byte-preservation archive created under `userData/originals/<sha256>.docx`.
4. Edit a paragraph → Save → only the dirty block's XML regenerates; rest of file is byte-identical.
5. File → Save As → new path → renderer's title bar updates; original file untouched.
6. File → Export PDF → save dialog → PDF written.
7. Close window with unsaved changes → close-guard prompt appears → Save/Don't Save/Cancel all work.
8. Recent files list updates after each save.
9. AI panel → send a message → streaming chunks arrive.
10. Track-changes toggle in AI panel → AI edits land as tracked revisions.

If any of these regress, the extraction is wrong.

---

## 5. What stays in `apps/docs/src/main/docs-main.ts`

The following remain **after** Phase 1 increment 1 (they are shell/window orchestration, not domain behavior or platform primitives):

- `createDocsWindow(openPath?)` — BrowserWindow creation
- `createDocsView(openPath?)` — WebContentsView creation (shell tab mode)
- `hasDocsWindow()` — window enumeration
- `startDocsStandalone()` — standalone app bootstrap (calls `createElectronRuntime` + `setRuntime` + `createDocsWindow`)
- `configureDocsRuntime(config)` — registers the runtime config (preload path, renderer URL)
- `setDocsShellWindow(win)` — shell back-reference
- `setDocsShellHooks(hooks)` — shell hooks for tab management
- `setActiveDocsResolver(fn)` — active webContents resolver
- `setDocsFileSavedHook(hook)` — callback when a file is saved
- `setSessionPathResolver(fn)` — session path resolver
- `setDocsExtraFileMenuItems(items)` — shell-injected File menu items
- `setDocsMenuGate(gate)` — menu installation gate
- `buildDocsMenu()` — native application menu (File/Edit/View/Insert/Format/Tools/Window/Help)
- `markDocsNewBlank(wcId)` — track "New Document" tabs
- `openExternalDocx(filePath)` — open a `.docx` from Finder/Explorer
- `teardownDocsRenderer(contents)` — tab-close workaround (webContents kept alive)
- `docsQueryDirty(contents)` — async dirty query
- `requestDocsClose(contents, …)` — close-guard entry point
- `projectFileRenamed(oldPath, newPath)` — propagate rename to project store
- All the `pendingWindowOpens` / `pendingOpenPath` / `pendingNewBlankIds` / `tornDownWcIds` / `recoveryClearEpochs` queues and sets
- The `docs:close-check-result` / `docs:close-save-result` / `docs:view-menu-state` `ipcMain.on(...)` handlers (they coordinate with the close-guard flow)
- The `win:new` / `win:list` / `win:focus` handlers (they delegate to `shellHooks` or `BrowserWindow`)

These shrink as Phase 1 progresses through Sheets/Slides/PDF/Markdown (they share the same patterns), but for the Docs increment they remain to preserve behavior.

---

## 6. What does NOT happen in Phase 1 increment 1

- ❌ The renderer code stays frozen (`apps/docs/src/renderer/*`).
- ❌ The `apps/docs/src/shared/ipc.ts` contract stays frozen.
- ❌ No Web adapter is created.
- ❌ No WASM work.
- ❌ No backend work.
- ❌ Sheets/Slides/PDF/Markdown mains are NOT touched. They continue using their existing main-process code. The new `platform-electron` + `services-docs` packages are wired ONLY into Docs.
- ❌ `packages/electron-utils` is NOT absorbed into `platform-electron` yet. That happens in a later cleanup phase.
- ❌ `atomic-write.ts` and `external-change.ts` stay in `apps/docs/src/main/`. They're imported by `platform-electron` / `services-docs` directly. (Moving them is a cosmetic cleanup that can happen later.)

---

## 7. Stop criteria for increment 1

Phase 1 increment 1 is complete when ALL of the following are true:

1. `packages/platform-electron/` exists with all 9 `Electron*` capability implementations.
2. `packages/services-docs/` exists with a full `DocumentServiceImpl`.
3. `apps/docs/src/main/index.ts` calls `createElectronRuntime()` + `setRuntime()`.
4. `apps/docs/src/main/docs-main.ts` no longer contains the 16 platform-primitive handlers or the 22 domain-behavior handlers — they live in `platform-electron` + `services-docs`.
5. `apps/docs/src/preload/index.ts` uses `createDocsDesktopBridge(getRuntime())` + `createProjectApiBridge(getRuntime())`.
6. `apps/docs/src/renderer/` is byte-identical to its pre-Phase-1 state (verified via `git diff f1548fb -- apps/docs/src/renderer/` returning empty).
7. `apps/docs/src/shared/ipc.ts` is byte-identical (verified via `git diff f1548fb -- apps/docs/src/shared/` returning empty).
8. All test suites in §4.1 pass identically.
9. The manual smoke in §4.3 works identically.

After this, Phase 1 increment 2 = Sheets (much harder because of the Rust sidecar — but the sidecar is NOT being WASM-compiled in Phase 1; it stays as a child process and the SpreadsheetService just wraps the existing sidecar-client code).

---

## 8. Critical architectural warning (restated per user directive)

**Do NOT move Electron IPC handlers into `platform-electron` as a mechanical refactor.**

The wrong way (REJECTED):
```
ipcMain.handle('docs:save', …)
   ↓
ElectronProvider.docs.save()
```

The right way:
```
ipcMain.handle('docs:save', …)        ← deleted
   ↓
Renderer calls window.desktop.saveDocx(path, bytes, auto)
   ↓
createDocsDesktopBridge(getRuntime()).saveDocx(path, bytes, auto)   ← the bridge
   ↓
DocumentService.save(path, bytes, { auto })   ← the domain service
   ↓
  • DocumentServiceImpl checks external-modified via external-change.ts
  • calls Files.write(path, bytes)   ← the platform capability
  • calls Storage.deleteBlob(recoveryKey)   ← the platform capability
  • calls runtime.windowing.notifyTabsChanged() to refresh recent files
   ↓
ElectronFiles.write(handle, bytes)   ← the adapter
   ↓
atomicWriteFile(path, Buffer.from(bytes))   ← the existing primitive
```

The domain service implements the **byte-preserving save plan** — that's the semantic behavior. The platform capability implements the **atomic write primitive** — that's the OS capability. The Electron adapter is one of two adapters (the other being Web, in a later phase).

**Constructor injection is mandatory.** Domain services receive dependencies via `new DocumentServiceImpl(storage, files, ai, printing, fonts, projectStore, eventBus)`. They MUST NOT call `getRuntime()` internally.

**The bridge is the only place `getRuntime()` may be called by non-bootstrap code.** And even there, only once at preload time.

---

## 9. Implementation order within increment 1

1. Create `packages/platform-electron/` skeleton (package.json, tsconfig, vitest.config).
2. Implement the 9 `Electron*` capability classes (thin wrappers).
3. Implement `ElectronRuntime` factory (constructs all 9 capabilities + a `ProjectStore` instance + a `DocumentServiceImpl`).
4. Create `packages/services-docs/` skeleton.
5. Implement `DocumentServiceImpl` (the bulk of the work — moving the byte-preservation save plan from the renderer's `convert.ts` + `file-actions.ts` into the service).
6. Update `apps/docs/src/main/index.ts` to call `createElectronRuntime` + `setRuntime` + `startDocsStandalone`.
7. Refactor `apps/docs/src/main/docs-main.ts`: delete the 38 handlers that moved; keep the 14 shell/window-orchestration handlers + window/view/menu/close-guard code.
8. Update `apps/docs/src/preload/index.ts` to use the bridge factories.
9. Run all test suites + manual smoke.
10. Commit + push.
11. Stop and report.

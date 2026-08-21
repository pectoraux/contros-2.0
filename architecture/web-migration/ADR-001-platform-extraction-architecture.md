# ADR-001: GenOffice Platform Extraction Architecture

**Status**: Approved (frozen) — 2026-08-21
**Supersedes**: none
**Superseded by**: none
**Requires**: [ADR-002: Renderer Compatibility Bridge Strategy](./ADR-002-renderer-compatibility-bridge.md)

---

## 1. Context

GenOffice is a production-grade open-source AI office suite shipped as an Electron desktop application. The repository contains six Electron apps (`shell`, `docs`, `sheets`, `slides`, `pdf`, `markdown`) plus 13 shared packages, totaling the 2026-08 snapshot of `genspark-ai/genoffice` plus an unrelated Contractor SaaS graft (`apps/web`, `packages/web-host`, `packages/contractor-core`) that is explicitly out of scope.

A forensic audit established three facts that drive this ADR:

1. **The renderers are already browser code.** Every file under `apps/*/src/renderer/` imports zero Electron symbols. They consume typed `window.*` globals (`window.aiOffice`, `window.desktop`, `window.slidesApi`, `window.pdfApi`, `window.markdownApi`) defined in `apps/*/src/shared/*-api.ts` and exposed via Electron's `contextBridge`. There are no `node:` or `electron` imports in any renderer.

2. **The engines are already platform-neutral.** `@genoffice/docx-engine`, `@genoffice/pptx-engine`, `@genoffice/pptx-render`, `@genoffice/file-parse`, `@genoffice/agent-core`, `@genoffice/ai-provider`, `@genoffice/i18n`, `@genoffice/ui` contain zero platform-bound imports. They ship as TypeScript source and run unmodified in any JS runtime.

3. **The Electron coupling is narrow.** It lives in three places: each editor's `src/main/*-main.ts` (IPC handlers + `BrowserWindow`/`WebContentsView` lifecycle), each editor's `src/preload/index.ts` (the `contextBridge` wrappers), and `packages/electron-utils` (menus, dialogs, safe URLs, default save dir). The Rust `.xlsx` sidecar (`apps/sheets/native/xlsx-engine`) is the one non-JS component.

The strategic objective is not to "port GenOffice to the web." It is to **extract GenOffice into a platform-neutral office runtime** that has two adapters (Electron + Web). The Electron app remains the reference implementation. The Web app is a faithful second consumer of the same runtime.

## 2. Existing Architecture Analysis

### 2.1 Process topology (Electron, current)

```
Electron Main Process (single Node process)
├── apps/shell/src/main/index.ts (2,893 LOC)
│   ├── App lifecycle, single-instance lock, userData migration
│   ├── Native menu per active tab (File/Edit/View/Window/Help)
│   ├── Auto-updater (electron-updater over Azure CDN)
│   ├── Genspark gsk CLI spawning (auth, cloud-projects sync)
│   ├── TabManager (BrowserWindow.contentView.addChildView)
│   ├── IPC: home:*, project:*, tabs:*
│   └── Preload exposes: window.aiOffice, window.aiOfficeTabs, window.aiOfficeProject
│
├── Editor mains (imported as TS sources, same process)
│   ├── apps/docs/src/main/docs-main.ts (3,847 LOC)
│   ├── apps/sheets/src/main/sheets-main.ts (3,102 LOC)
│   ├── apps/slides/src/main/slides-main.ts (4,200 LOC)
│   ├── apps/pdf/src/main/pdf-main.ts (1,156 LOC)
│   └── apps/markdown/src/main/markdown-main.ts (790 LOC)
│
└── Native sidecar
    └── apps/sheets/native/xlsx-engine (Rust binary, stdio JSON-line protocol)

Renderer Processes (one per open tab, sibling WebContentsViews)
├── apps/shell/src/renderer (TabBar + Home + SettingsModal + Onboarding)
├── apps/docs/src/renderer (TipTap 3 + ProseMirror + @genoffice/docx-engine)
├── apps/sheets/src/renderer (Univer + 22-module xlsx gateway + 15-module domain)
├── apps/slides/src/renderer (Konva + @genoffice/pptx-engine + @genoffice/pptx-render)
├── apps/pdf/src/renderer (pdf.js + pdf-lib + PDFium WASM + HarfBuzz WASM)
└── apps/markdown/src/renderer (TipTap 3 + @genoffice/docx-engine for DOCX export)
```

### 2.2 The IPC contract surface (what the renderers expect)

Each editor exposes its API as a typed TypeScript interface in `apps/*/src/shared/*-api.ts`. The preload bridges expose these as `window.*` globals. These interfaces are the migration contract — they define the exact surface the renderers depend on:

| Editor | Global | Methods | Defined in |
|---|---|---|---|
| Shell | `window.aiOffice` | 35 (recents, open/browse, new-*, theme, language, account, onboarding, cloud projects, file ops) | `apps/shell/src/shared/home-api.ts` |
| Shell | `window.aiOfficeTabs` | 8 + 2 push (list/activate/close/reorder/showMenu/showNewMenu/onChanged/chrome-pressed) | `apps/shell/src/shared/tabs-api.ts` |
| Shell | `window.aiOfficeProject` | 7 (listProjects/listFiles/create/rename/delete/moveFile/timeline) | `apps/shell/src/shared/home-api.ts` |
| Docs | `window.desktop` | ~35 (open/save/save-as/print/export-pdf/font-metrics/attachments) + `window.projectApi` | `apps/docs/src/shared/ipc.ts` |
| Sheets | `window.desktopApi` | 35 (selectWorkbook/read-range/recalc/save/export-pdf/ai/files) + `window.projectApi` | `apps/sheets/src/shared/desktop-api.ts` |
| Slides | `window.slidesApi` | ~140 (open/edit-text/edit-transform/edit-fill/add-element/master-*/presenter-*/history/ai) + `window.desktop` + `window.projectApi` | `apps/slides/src/shared/ipc.ts` |
| PDF | `window.pdfApi` | ~30 (read-file/save/list-page-images/page-preview-png/extract-pages/merge-pdf/signatures/ai) | `apps/pdf/src/shared/ipc.ts` |
| Markdown | `window.markdownApi` | ~12 (read-file/save/pick-image/export-docx/export-pdf) + `window.projectApi` | `apps/markdown/src/shared/ipc.ts` |

**Total**: ~280 methods across 10 globals. This is the migration surface.

### 2.3 The engine layer (already platform-neutral)

| Package | LOC (approx) | Browser-ready? |
|---|---|---|
| `@genoffice/docx-engine` | ~15,000 | ✅ Pure TS, no Node fs |
| `@genoffice/pptx-engine` | ~12,000 | ✅ Pure TS |
| `@genoffice/pptx-render` | ~8,000 | ✅ Pure TS |
| `@genoffice/file-parse` | ~2,000 | ✅ Pure TS |
| `@genoffice/agent-core` | ~3,000 | ✅ Pure TS |
| `@genoffice/ai-provider` | ~2,000 | ✅ Pure TS |
| `@genoffice/i18n` | ~1,500 | ✅ Pure TS |
| `@genoffice/ui` | ~2,000 | ✅ Pure CSS + TS |
| `@genoffice/project-store` | ~1,000 | ⚠️ Refactor: extract interface, swap fs impl for IndexedDB impl |
| `@genoffice/font-metrics` | ~1,500 | ⚠️ Refactor: extract FontRegistry port; renderer already has pure-JS fallback |
| `@genoffice/ai-search` | ~2,000 | ⚠️ Refactor: extract transport port (gsk CLI → HTTP) |
| `@genoffice/electron-utils` | ~1,500 | ❌ Absorb into `platform-electron` |
| `apps/sheets/native/xlsx-engine` (Rust) | ~3,000 | ⚠️ WASM-compile (Phase 7) |

### 2.4 What's already right

- The renderers were designed for sandboxed isolation (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`). They never reach outside their `window.*` contract.
- The engines were designed as pure TS libraries with no side effects.
- The `vite.renderer.config.ts` in each editor already supports building the renderer as a standalone Vite bundle (used for embedded shell dev mode). The build infrastructure for iframe-per-editor deployment already exists.
- Heavy test coverage: each editor has 50-100 vitest tests; docs has a 23-fixture pagination corpus with Word + LibreOffice baselines.

### 2.5 What's wrong (and what this ADR corrects)

- The IPC contract is *implementation-shaped*, not *capability-shaped*. `window.desktop.consumePendingOpen()` is an IPC detail; `DocumentService.open()` is a capability. Wrapping the former doesn't fix this — it just renames it.
- The editor domain logic (e.g. docs' byte-preservation save plan, slides' session/undo stack, sheets' workbook gateway) is tangled with IPC handlers in `*-main.ts`. Extracting it into domain services is the strategic move.
- A naive "platform-runtime + electron-platform + web-platform" 3-package split (rejected alternative §10.8) was too coarse. It would have produced 5000+ line adapter packages and a 200+ method God Interface.

## 3. Decision

GenOffice will be reorganized into a **four-layer platform-neutral office runtime** with two adapters:

1. **Layer 1 — Runtime Contracts** (`packages/runtime-contracts`): TypeScript interfaces only. Zero implementations. The single architectural seam every other layer depends on.

2. **Layer 2 — Domain Runtime Services** (`packages/services-docs`, `services-sheets`, `services-slides`, `services-pdf`, `services-markdown`): One package per editor. Each contains the editor's product logic expressed in platform-neutral terms. Composes Layer 1 engines with Layer 3 platform capabilities. The renderers consume these services **via the compatibility bridge defined in ADR-002**, not directly.

3. **Layer 3 — Platform Capability Layer** (`packages/platform`): Eight capability interfaces (`Storage`, `Identity`, `AI`, `Files`, `Printing`, `Clipboard`, `Notifications`, `Windowing`) plus shared types (`FileHandle`, `FileStat`, `SaveResult`, etc.). Platform-neutral — no Electron or browser imports.

4. **Layer 4 — Adapters** (`packages/platform-electron`, `packages/platform-web`): Two implementations of Layer 3. `platform-electron` is the reference implementation, refactored from the existing `apps/*/src/main/*-main.ts` + `packages/electron-utils`. `platform-web` is new, using browser primitives (File System Access API, IndexedDB, Service Worker, Web Workers, `postMessage`).

**Layer 5 — Renderers** (`apps/*/src/renderer/`, unchanged) consume Layer 2 services through the **Renderer Compatibility Bridge** (ADR-002). They never import Layer 3 or Layer 4 directly. During Phases 1–5 the bridge is the canonical API surface; in Phase 6 it is removed and renderers consume the services directly.

**The Electron app remains the reference implementation.** The Web app is a faithful second consumer of the same runtime. Both adapters must produce identical behavior for every capability — verified by running the same vitest suites against both.

## 4. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 5 — Applications                                                     │
│                                                                             │
│  apps/web-shell/                apps/shell/                                 │
│  (NEW: Vite + React 19 SPA)    (existing: electron-vite renderer)           │
│  • TabBar (Chrome-style)        • TabBar (existing, unchanged)               │
│  • Home + Settings + Onboarding • Home + Settings + Onboarding              │
│  • Service Worker updater       • electron-updater                          │
│  • Mounts editors as iframes    • Mounts editors as WebContentsViews        │
│                                                                             │
│  apps/{docs,sheets,slides,pdf,markdown}/src/renderer/                       │
│  (UNCHANGED during Phases 1–5 — pure React/TipTap/Konva/Univer/pdf.js)     │
│  Consumes Layer 2 services via the compatibility bridge (ADR-002).         │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │ consumes via bridge
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Renderer Compatibility Bridge (ADR-002)                                   │
│  packages/renderer-bridge/                                                │
│  createDesktopBridge, createSlidesApiBridge, createPdfApiBridge, etc.      │
│  Pure object factories. No window mutation inside this package.            │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │ delegates to
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 2 — Domain Runtime Services                                          │
│                                                                             │
│  packages/services-docs/         packages/services-sheets/                  │
│  • DocumentService              • SpreadsheetService                        │
│    open() save() export()         openWorkbook() editCell() calculate()     │
│    recover() observeChanges()     export()                                  │
│  Composes @genoffice/docx-engine  Composes xlsx-gateway + WASM engine      │
│                                                                             │
│  packages/services-slides/      packages/services-pdf/                     │
│  • PresentationService           • PdfService                              │
│    openDeck() editObject()         open() editPage() save() export()        │
│    render() export()               annotate() sign()                       │
│  Composes pptx-engine + render    Composes pdf.js + pdf-lib + PDFium WASM  │
│                                                                             │
│  packages/services-markdown/                                               │
│  • MarkdownService                                                         │
│    open() save() exportDocx() exportPdf()                                 │
│  Composes TipTap + @genoffice/docx-engine                                 │
│                                                                             │
│  IMPORTANT: Domain services receive dependencies via constructor.         │
│  They never call getRuntime() internally.                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │ consumes
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Platform Capability Layer                                        │
│                                                                             │
│  packages/platform/                                                        │
│  Interfaces only: Storage, Identity, AI, Files, Printing, Clipboard,       │
│  Notifications, Windowing. Shared types: FileHandle, FileStat, SaveResult. │
│  Zero Electron or browser imports.                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │ implemented by
                                       ▼
┌──────────────────────────────────────────────────────┬──────────────────────┐
│  Layer 4a — Electron Adapter                          │  Layer 4b — Web      │
│  packages/platform-electron/                         │  Adapter             │
│  • ElectronStorage (node:fs + userData/)             │  packages/platform-  │
│  • ElectronIdentity (gsk CLI)                        │  web/                │
│  • ElectronAI (Chromium net.fetch + main proc)       │  • WebStorage        │
│  • ElectronFiles (dialog.showOpen/Save)              │    (IndexedDB + OPFS) │
│  • ElectronPrinting (BrowserWindow.printToPDF)        │  • WebIdentity       │
│  • ElectronClipboard (clipboard)                      │    (backend OAuth)   │
│  • ElectronNotifications (Notification)               │  • WebAI (HTTP/SSE   │
│  • ElectronWindowing (BrowserWindow, WebContentsView)│    to backend proxy) │
│  Refactored from existing apps/*/src/main/*-main.ts  │  • WebFiles (FS      │
│  + packages/electron-utils                          │    Access API)       │
│  REFERENCE IMPLEMENTATION                            │  • WebPrinting       │
│                                                      │    (window.print +  │
│                                                      │    pdf-lib)          │
│                                                      │  • WebClipboard     │
│                                                      │    (navigator.clipbd)│
│                                                      │  • WebNotifications  │
│                                                      │    (Notification)   │
│                                                      │  • WebWindowing     │
│                                                      │    (iframes)        │
└──────────────────────────────────────────────────────┴──────────────────────┘
```

## 5. Package Boundaries

### 5.1 New packages (9 total — 3 in Milestone 1, 6 in later phases)

| Package | Layer | Milestone | Purpose | Imports allowed |
|---|---|---|---|---|
| `packages/runtime-contracts` | 1 | **1** | TypeScript interfaces + types only. `RuntimeContext`, `DocumentService`, `SpreadsheetService`, `PresentationService`, `PdfService`, `MarkdownService`, plus the 8 platform capability interfaces. | Layer 1 packages only |
| `packages/platform` | 3 | **1** | The 8 capability interfaces + shared types. Platform-neutral. | Layer 1 only |
| `packages/renderer-bridge` | (between 2 and 5) | **1** | Pure object factories that return the existing `window.*` API shapes, delegating to domain services. **No window mutation inside the package.** | Layer 1 + existing `apps/*/src/shared/*-api.ts` types |
| `packages/services-docs` | 2 | 3 | `DocumentServiceImpl` composing `@genoffice/docx-engine` + `Storage` + `Files` + `AI` + `Printing`. | Layer 1 + Layer 3 |
| `packages/services-sheets` | 2 | 7 | `SpreadsheetServiceImpl` composing xlsx gateway + WASM Rust engine + Univer glue. | Layer 1 + Layer 3 |
| `packages/services-slides` | 2 | 6 | `PresentationServiceImpl` composing `@genoffice/pptx-engine` + `@genoffice/pptx-render` + session/undo state. | Layer 1 + Layer 3 |
| `packages/services-pdf` | 2 | 4 | `PdfServiceImpl` composing pdf.js + pdf-lib + PDFium WASM + HarfBuzz WASM. | Layer 1 + Layer 3 |
| `packages/services-markdown` | 2 | 3 | `MarkdownServiceImpl` composing TipTap + `@genoffice/docx-engine` (for export). | Layer 1 + Layer 3 |
| `packages/platform-electron` | 4a | 2 | `ElectronRuntime` + every `Electron*` capability. Refactored from existing `apps/*/src/main/*-main.ts` + `packages/electron-utils`. | Layer 1 + Layer 3 + `electron`, `node:*`, `@genoffice/electron-utils` |
| `packages/platform-web` | 4b | 3 | `WebRuntime` + every `Web*` capability. New, browser primitives. | Layer 1 + Layer 3 + browser APIs |

### 5.2 Existing packages — refactor boundary

| Package | Action | Reason |
|---|---|---|
| `@genoffice/docx-engine` | No change | Already neutral |
| `@genoffice/pptx-engine` | No change | Already neutral |
| `@genoffice/pptx-render` | No change | Already neutral |
| `@genoffice/file-parse` | No change | Already neutral |
| `@genoffice/agent-core` | No change | Already neutral |
| `@genoffice/ai-provider` | No change | Already neutral |
| `@genoffice/i18n` | No change | Already neutral |
| `@genoffice/ui` | No change | Already neutral |
| `@genoffice/project-store` | Refactor: extract `ProjectStore` interface to `packages/platform`, keep current filesystem impl in `@genoffice/project-store` (consumed by `platform-electron`); add `IdbProjectStore` in `platform-web` | Interface segregation |
| `@genoffice/font-metrics` | Refactor: extract `FontRegistry` interface to `packages/platform`; current native impl stays in `@genoffice/font-metrics` (consumed by `platform-electron`); `BundledFontRegistry` in `platform-web` ships web fonts | Renderer already has pure-JS fallback; native binary unused in current docs renderer |
| `@genoffice/ai-search` | Refactor: extract `AiSearchTransport` interface to `packages/platform`; current gsk-CLI impl stays (consumed by `platform-electron`); `HttpAiSearchTransport` in `platform-web` | Transport decoupling |
| `@genoffice/electron-utils` | Absorb into `packages/platform-electron` | All Electron-bound; not reusable on Web |

### 5.3 App-level shrinkage (post-Phase 2)

Each editor's `src/main/*-main.ts` shrinks from 790–4200 LOC to ~50 LOC:

```typescript
// apps/docs/src/main/index.ts (post-extraction)
import { app } from 'electron'
import { createElectronRuntime } from '@genoffice/platform-electron'
import { setRuntime } from '@genoffice/runtime-contracts'
import { createDocsWindow } from './window'

const runtime = createElectronRuntime({ appKind: 'docs' })
setRuntime(runtime)
app.whenReady().then(createDocsWindow)
```

Each editor's `src/preload/index.ts` shrinks to a thin shim that calls `createXxxBridge(getRuntime())` from `@genoffice/renderer-bridge` (see ADR-002 §2.3 for the full installation pattern).

## 6. Service Boundaries

### 6.1 The five domain services

Each service is a TypeScript class implementing an interface from `runtime-contracts`. Each method is a product capability, not an IPC transcription.

**Constructor injection is mandatory** (per Architectural Correction A). Domain services receive their dependencies explicitly:

```typescript
// CORRECT — constructor injection
new DocumentServiceImpl(storage, files, ai, printing, fonts)

// FORBIDDEN — internal getRuntime() call
class DocumentServiceImpl {
  save() {
    const runtime = getRuntime()  // ❌ hidden global dependency
    return runtime.storage.write(...)
  }
}
```

`getRuntime()` is **bootstrap infrastructure only** — called once at app startup to construct the runtime, then passed (or its members passed) to constructors. Domain services never call it internally.

The full service interface definitions are in `packages/runtime-contracts/src/services/*.ts`. See ADR-002 §2 for the bridge mappings that connect these services to the existing `window.*` globals.

### 6.2 The eight platform capabilities

```typescript
// packages/platform/src/capabilities/storage.ts
interface Storage {
  // Key-value (for settings, app-settings.json equivalent)
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>

  // Object stores (for recents, projects, chat history, autosave)
  readObject(store: string, key: string): Promise<unknown | null>
  writeObject(store: string, key: string, value: unknown): Promise<void>
  deleteObject(store: string, key: string): Promise<void>
  listObjects(store: string): Promise<string[]>

  // Binary blob storage (for originals archive, recovery copies)
  readBlob(key: string): Promise<Uint8Array | null>
  writeBlob(key: string, bytes: Uint8Array): Promise<void>
  deleteBlob(key: string): Promise<void>
}
// Electron: node:fs + userData/*.json + userData/originals/<hash>
// Web: IndexedDB (key-value stores + binary blob store) + OPFS for large blobs

// packages/platform/src/capabilities/files.ts
interface Files {
  pickOpen(opts?: { accept?: string[]; multiple?: boolean }): Promise<FileHandle[] | null>
  pickSave(opts: { defaultName: string; accept?: string[] }): Promise<FileHandle | null>
  pickDirectory(): Promise<DirectoryHandle | null>

  read(handle: FileHandle | string): Promise<{ bytes: Uint8Array; stat: FileStat }>
  write(handle: FileHandle | string, bytes: Uint8Array): Promise<void>  // atomic
  stat(handle: FileHandle | string): Promise<FileStat>
  rename(handle: FileHandle | string, newName: string): Promise<FileHandle | string>
  trash(paths: string[]): Promise<void>
  revealInFolder(path: string): Promise<void>
  openPath(path: string): Promise<void>
}
// Electron: dialog.showOpenDialog/showSaveDialog + node:fs + shell.trashItem/showItemInFolder/openPath
// Web: showOpenFilePicker/showSaveFilePicker + FileSystemFileHandle; trash/reveal → backend (degrade to download)

// packages/platform/src/capabilities/identity.ts
interface Identity {
  accountStatus(): Promise<AccountStatus>
  login(): Promise<boolean>
  logout(): Promise<void>
  onLoginEvent(handler: (ev: AccountLoginEvent) => void): () => void
  openLoginUrl(): Promise<void>
  openCreditUsage(): Promise<void>
  openGenTeam(): Promise<void>
}
// Electron: gsk CLI via @genoffice/ai-search
// Web: backend OAuth flow (device-code) + IndexedDB session cache

// packages/platform/src/capabilities/ai.ts
interface AI {
  getSettings(): Promise<AiSettings>
  setSettings(settings: AiSettings): Promise<void>
  stream(request: AiStreamRequest): Promise<void>
  streamCancel(requestId: string): Promise<void>
  onStream(handler: (chunk: AiStreamChunk) => void): () => void
  chat(request: AiChatRequest): Promise<AiChatResponse>
  webSearch(query: string, maxResults?: number): Promise<SearchResults>
  imageSearch(query: string, maxResults?: number): Promise<ImageResults>
  fetchImage(url: string): Promise<{ base64: string; mime: string } | null>
  generateImage(op: GenerateImageOp): Promise<{ url: string }>
  analyzeMedia(params: AnalyzeMediaParams): Promise<MediaAnalysis>
}
// Electron: net.fetch in main process + gsk CLI for cloud tools
// Web: HTTP/SSE to backend proxy that holds Genspark key + does SSRF guards

// packages/platform/src/capabilities/printing.ts
interface Printing {
  print(opts?: PrintOptions): Promise<{ ok: boolean; error?: string }>
  exportPdf(opts: ExportPdfOptions): Promise<{ ok: boolean; path?: string; error?: string }>
  printToBytes(opts: PrintToBytesOptions): Promise<Uint8Array>
}
// Electron: BrowserWindow.printToPDF + shell.print
// Web: window.print() + pdf-lib assembly

// packages/platform/src/capabilities/clipboard.ts
interface Clipboard {
  read(): Promise<ClipboardContent>
  write(content: ClipboardContent): Promise<void>
  readImage(): Promise<{ data: ArrayBuffer; ext: string } | null>
  writeImage(data: ArrayBuffer, ext: string): Promise<void>
}
// Electron: clipboard + nativeImage
// Web: navigator.clipboard + ClipboardItem

// packages/platform/src/capabilities/notifications.ts
interface Notifications {
  show(title: string, body: string, opts?: NotificationOptions): Promise<void>
  requestPermission(): Promise<boolean>
}
// Electron: Notification
// Web: Notification API

// packages/platform/src/capabilities/windowing.ts
interface Windowing {
  // Tab management
  listTabs(): Promise<TabSummary[]>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  reorderTab(id: string, toIndex: number): Promise<void>
  showTabMenu(x: number, y: number): Promise<void>
  showNewMenu(x: number, y: number): Promise<void>
  notifyChromePressed(): void
  onTabsChanged(handler: (tabs: TabSummary[]) => void): () => void
  onChromePressed(handler: () => void): () => void

  // Window-level
  setProgressBar(progress: number): Promise<void>  // 0-1, -1 to clear, 2 for indeterminate
  setTheme(theme: UiTheme): Promise<void>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void

  // External links
  openExternal(url: string): Promise<void>
}
// Electron: TabManager + BrowserWindow + nativeTheme + shell.openExternal
// Web: in-memory TabRecord[] + iframe management + prefers-color-scheme + window.open
```

### 6.3 The RuntimeContext bundle (bootstrap only)

```typescript
// packages/runtime-contracts/src/runtime.ts
interface RuntimeContext {
  readonly platform: 'electron' | 'web'
  readonly version: string

  // Platform capabilities (Layer 3)
  readonly storage: Storage
  readonly files: Files
  readonly identity: Identity
  readonly ai: AI
  readonly printing: Printing
  readonly clipboard: Clipboard
  readonly notifications: Notifications
  readonly windowing: Windowing

  // Domain services (Layer 2) — lazily instantiated per editor kind
  readonly docs: DocumentService
  readonly sheets: SpreadsheetService
  readonly slides: PresentationService
  readonly pdf: PdfService
  readonly markdown: MarkdownService

  // Project (cross-editor — chat history + file grouping)
  readonly project: ProjectStore  // interface extracted from @genoffice/project-store
}

// Bootstrap-only mechanism. Domain services MUST NOT call this internally.
let current: RuntimeContext | null = null
export function setRuntime(ctx: RuntimeContext): void { current = ctx }
export function getRuntime(): RuntimeContext {
  if (!current) throw new Error('RuntimeContext not initialized — call setRuntime first')
  return current
}
```

**Architectural Correction A (frozen)**: `getRuntime()` is **bootstrap infrastructure only**. It is called once at app startup to construct the runtime. Domain services receive their dependencies explicitly through construction (`new DocumentServiceImpl(storage, files, ai, ...)`). They never internally call `getRuntime()`. This prevents the new architecture from quietly recreating the same hidden-global coupling that the migration is intended to eliminate.

The renderers (Layer 5) consume the runtime via the compatibility bridge (ADR-002), which itself receives the runtime from the bootstrap. The bridge is the only place where `getRuntime()` may be called by non-bootstrap code, and only during Phases 1–5; in Phase 6 it is removed entirely.

## 7. Electron Compatibility Strategy

**The Electron app is the reference implementation. It must keep working throughout the extraction, with zero behavior change.**

### 7.1 Backward-compat shim via the bridge

The bridge (ADR-002) exposes the existing `window.*` API shapes that renderers consume today. The renderer does not know the migration happened. The bridge is installed at preload bootstrap, then gradually removed in Phase 6 (renderer migration), after all editors run under both adapters and the migration is verified.

### 7.2 Test parity

Every `apps/*/tests/` vitest suite must pass against the extracted code. The 23-fixture docs pagination corpus provides objective parity verification. Sheets has 100+ tests covering the xlsx gateway. Slides has 50+ tests. The extraction is verified by running the existing test suite, not by writing new tests.

### 7.3 The Electron main process shrinks, not disappears

Each editor's `src/main/*-main.ts` shrinks to ~50 LOC (see §5.3). The editor's `src/main/window.ts` (window/view creation) stays. The editor's `src/main/updater.ts` (electron-updater) moves to `packages/platform-electron/src/updater.ts`. The bulk of the IPC handler code moves to `packages/services-<editor>/src/` (the domain service implementation) + `packages/platform-electron/src/` (the Electron capability implementations).

## 8. Web Runtime Strategy

### 8.1 Editor loading model: iframe isolation (Option C)

Each editor runs in its own iframe, same-origin to the shell. The shell SPA (`apps/web-shell`) manages the iframes — one iframe per editor kind, lazily created on first tab-open, hidden via `display: none` (preserves React state) when its tab is inactive.

```
apps/web-shell (Vite + React 19 SPA)
  index.html
  src/main.tsx                ← mounts <AppFrame>
  src/AppFrame.tsx            ← TabBar + iframe container
  src/TabBar.tsx              ← copied from apps/shell (Chrome-style drag-reorder)
  src/Home.tsx                ← copied from apps/shell (IndexedDB-backed)
  src/SettingsModal.tsx       ← copied from apps/shell
  src/Onboarding.tsx          ← copied from apps/shell
  src/StarPromptCard.tsx      ← copied from apps/shell
  src/iframes/                ← one bootstrap per editor
    docs-bootstrap.ts         ← installs window.desktop = createDesktopBridge(getRuntime())
    sheets-bootstrap.ts
    slides-bootstrap.ts
    pdf-bootstrap.ts
    markdown-bootstrap.ts
  src/sw.ts                   ← Service Worker (auto-update)
  src/worker-bridge.ts        ← postMessage RPC to editor iframes

apps/docs/src/renderer/        ← unchanged — built as standalone Vite bundle
apps/sheets/src/renderer/      ← unchanged
apps/slides/src/renderer/      ← unchanged
apps/pdf/src/renderer/        ← unchanged
apps/markdown/src/renderer/   ← unchanged
```

**Each editor iframe loads its Vite-built bundle, runs the bootstrap script that installs `window.*` shims via the bridge, then mounts the renderer.** The renderer code is byte-for-byte identical to the Electron renderer.

### 8.2 Cross-frame communication

The shell and editor iframes communicate via `postMessage` with a small RPC envelope (typed request/response). The editor's `WebRuntime` is constructed by the iframe bootstrap; the editor's bridge calls service methods that proxy (via `postMessage`) to the shell where the actual `Web*` capability implementations live.

**Same-origin iframes** (chosen for v1) simplify this — no origin validation needed. Cross-origin isolation is a v2 concern.

### 8.3 Editor-internal state in Web Workers

Three services hold heavy state that must not block the UI thread:

| Service | State | Web Worker |
|---|---|---|
| `SpreadsheetService` | WASM-compiled Rust engine (the xlsx sidecar) | `apps/sheets/src/web-worker/xlsx-engine.worker.ts` — WASM instantiates once, communicates via `postMessage` JSON-line protocol (same as the existing stdio protocol) |
| `PresentationService` | `Session` class (50-deep undo stack, aiSnapshots, history batch) | `apps/slides/src/web-worker/session.worker.ts` — `structuredClone`-based snapshots (already used by `session-state.ts:84-88`) |
| `PdfService` | PDFium WASM + HarfBuzz subset WASM | `apps/pdf/src/web-worker/pdfium.worker.ts` — same `_FPDF*` interface, same chained-call serialization (`chainPdfium`) |

The shell's `WebRuntime` instantiates one worker per editor iframe (lazy). The editor's domain service implementation proxies to the worker via `postMessage`.

### 8.4 Backend requirements (minimal)

The web app needs a backend **only** for things browsers cannot do:

1. **AI proxy** (mandatory) — holds Genspark key + does SSRF guards + bypasses CORS for OpenAI/Anthropic/Gemini APIs. ~200 LOC.
2. **GSK CLI spawning** (mandatory for cloud projects sync, image generation, PDF→Docx cloud conversion) — the gsk CLI cannot run in a browser. ~150 LOC.
3. **Reveal-in-folder + trash** (optional, can degrade to download + remove-from-recents) — ~50 LOC.
4. **XLSX sidecar fallback** (only if WASM port is rejected OR for >50 MB workbooks that exceed WASM memory) — runs the existing Rust binary as a child process, exposes the stdio JSON-line protocol over WebSocket. ~200 LOC.

**Total backend surface: ~500-700 LOC** (WASM primary path) or ~1500 LOC (server-side sidecar fallback).

## 9. Migration Sequence

The extraction is phased. **Each phase is independently shippable** — the Electron app keeps working, and the web app grows capability incrementally.

- **Phase 0 — Architecture Extraction**: Create the package skeleton with empty implementations. No renderer changes. No Electron main changes. No behavior change. The existing Electron app keeps working — the new packages are empty skeletons that nothing imports yet. **Behaviorally inert.**
- **Phase 1 — Compatibility Runtime**: Implement the bridge + domain services + Electron adapter, all delegating to the existing main-process code. The bridge is installed via the preload; the renderer doesn't know.
- **Phase 2 — Electron Adapter Migration**: Folded into Phase 1. The Electron adapter is the reference implementation and is migrated in lockstep with the bridge.
- **Phase 3 — Web Shell**: Create `apps/web-shell`. Stub services. Shell boots in browser, looks identical to desktop shell. Editor tabs open placeholder iframes.
- **Phase 4 — Web Compatibility Bridge (per-editor migration begins)**: For each editor, implement the Web versions of the editor-specific platform capabilities + the Web version of the editor's domain service, then mount the existing renderer in an iframe.
- **Phase 5 — Editor Migration Order** (frozen):
  1. **Markdown** — smallest, validates architecture, low risk
  2. **PDF** — mostly browser-native already, validates file APIs + export pipeline
  3. **Docs** — flagship product, validates complex document lifecycle + storage abstraction
  4. **Slides** — complex state machine, undo/session architecture
  5. **Sheets** — hardest dependency (Rust/WASM, formula engine, largest risk)
- **Phase 6 — Remove Electron Assumptions (renderer migration)**: Per-file incremental migration of renderer code from `window.*` to `runtime.*` direct consumption. Bridge is removed when complete.
- **Phase 7 — Cloud Backend**: AI proxy, GSK CLI spawning, optional xlsx-sidecar fallback, account system + cloud projects sync.
- **Phase 8 — Collaboration** (deferred to v2): Yjs or Automerge CRDT for real-time co-editing.

**Why this order**:
- Phase 0 before Phase 1: defines contracts before moving code.
- Phase 2 before editors: gives us a working web shell to mount editors into.
- Markdown first: smallest editor, fastest to migrate, proves the extraction pattern is repeatable.
- PDF second: PDFium WASM is browser-native, mostly mechanical.
- Docs third: highest-value editor with best test coverage (23-fixture pagination corpus).
- Slides fourth: validates the Web Worker session pattern.
- Sheets last among editors: the Rust sidecar WASM compilation is the single biggest technical risk.
- Phase 7 (Cloud) after editors: cloud features depend on all editors working.
- Phase 8 (Collaboration) last: largest single phase, optional for v1.

## 10. Rejected Alternatives

### 10.1 God Interface platform API
**Rejected**: `PlatformContext` with ~13 ports totaling 200+ methods that transcribed IPC 1:1. Would have produced "Electron IPC renamed to Platform API" — a polished renaming, not a true runtime extraction. Replaced by: domain services (`DocumentService`, etc.) composing platform primitives (`Storage`, `Files`, `AI`, etc.).

### 10.2 Single React SPA (Option A for web runtime)
**Rejected**: would load all editors at once, causing memory pressure. One editor's bug could crash the shell. Loses the isolation boundary the renderers were designed for. Replaced by: iframe isolation (Option C).

### 10.3 Microfrontend (Option B for web runtime)
**Rejected**: orchestration complexity (module federation / import maps), shared dependency dedup is painful. Replaced by: iframe isolation (Option C).

### 10.4 Browser-native xlsx engine from scratch (Option C for sheets)
**Rejected**: too much reimplementation risk for the formula recalc surface (IronCalc covers hundreds of functions). Replaced by: WASM compilation of the existing Rust binary, with server-side fallback for >50 MB workbooks.

### 10.5 Server-side xlsx sidecar as primary path
**Rejected as primary**: adds backend dependency, latency, hosting cost, cold-start. Kept as **fallback** for >50 MB workbooks that exceed WASM memory.

### 10.6 Cross-origin iframe isolation
**Rejected for v1**: same-origin iframes simplify `postMessage`. Cross-origin isolation is a v2 concern.

### 10.7 Hard cutover (no backward-compat shim)
**Rejected**: would require rewriting all renderer code simultaneously. The bridge (ADR-002) lets renderers run unchanged during migration, then is removed in Phase 6 cleanup.

### 10.8 Three-package split (`platform-runtime` + `electron-platform` + `web-platform`)
**Rejected**: too coarse. `electron-platform` would have been 5000+ lines mixing shell concerns, editor concerns, and Electron glue. No domain services layer. Replaced by: 9-package split (`runtime-contracts` + 5 `services-*` + `platform` + 2 adapters).

### 10.9 Moving renderers into the services packages
**Rejected**: renderers stay in `apps/*/src/renderer/`. Moving them would couple render-time concerns (JSX, CSS, DOM) with runtime concerns (parsing, saving, state).

### 10.10 Direct renderer migration (no compatibility bridge)
**Rejected**: would force rewriting every `window.desktop.save()` call across all renderers before the migration could ship. The compatibility bridge (ADR-002) lets the migration happen underneath the renderers without disturbing them.

### 10.11 `Proxy`-based bridge implementation
**Rejected**: a `Proxy` would obscure exactly the contract we are trying to freeze. Explicit typed method mappings are auditable, statically checkable, deterministic, and make the migration surface visible.

### 10.12 `getRuntime()` as a long-term global runtime mechanism
**Rejected**: would quietly recreate the same hidden-global coupling that the migration is intended to eliminate. `getRuntime()` is bootstrap-only; domain services receive dependencies via constructor injection.

## 11. Risks

### 11.1 High-risk items

1. **Rust `.xlsx` sidecar WASM port (Phase 7)** — The biggest single migration risk. `quick-xml`, `zip`, `roxmltree`, `calamine`, `ironcalc` are pure Rust but `ironcalc` uses `catch_unwind` for panic safety; WASM panics abort the instance, so the fail-soft guarantee needs rethinking. Memory budget: the sidecar currently streams 256-row chunks from disk for large workbooks; in-browser we must hold the whole file in memory (realistic ceiling: ~50 MB workbook → ~500 MB WASM memory; beyond that, fall back to server-side).
   - **Mitigation**: WASM for ≤50 MB, server-side fallback for larger. Implement behind `WorkbookEngineProvider` so the strategy is swappable. Phase 7 is scheduled last among editors so we have all others working before tackling this.

2. **Font metric fidelity (Phases 3, 6)** — The desktop app's word-faithful pagination (Docs) and PowerPoint-grade text metrics (Slides) depend on real font files. Browsers cannot read system fonts except via `queryLocalFonts()` (Chrome-only) or by shipping bundled web fonts.
   - **Mitigation**: ship curated web-font bundles (Carlito for Calibri metric compatibility, Noto Sans CJK subsets, Arabic Tahoma, etc.). Verify parity via the existing 23-fixture pagination corpus baselines.

3. **The compatibility bridge becomes permanent** — If renderer code is never migrated from `window.desktop` to `runtime.docs`, the bridge becomes a permanent maintenance burden.
   - **Mitigation**: Phase 6 (renderer migration) is a hard gate. Architecture test that fails if `window.desktop` is referenced in `packages/services-*` or `packages/platform-*`. Bridge is deleted from the workspace once Phase 6 completes.

### 11.2 Medium-risk items

4. **Cross-frame `postMessage` complexity** — Each editor iframe talks to the shell via `postMessage` RPC.
   - **Mitigation**: typed RPC client with full TypeScript inference. Same-origin iframes for v1.

5. **File System Access API browser support** — Chrome/Edge only.
   - **Mitigation**: graceful degradation to `<input type="file">` for open + `<a download>` for save.

6. **AI proxy + Genspark key secrecy** — The desktop app signs in via gsk CLI in the main process. The web app cannot run a CLI.
   - **Mitigation**: backend OAuth-in-the-browser flow (Genspark supports device-code flow already) + backend holds the key in env. Sessions via stateless signed cookies.

7. **Memory budget for many open tabs** — Each editor iframe holds its full React tree + ProseMirror/Univer/Konva state.
   - **Mitigation**: hard cap at 12 tabs with LRU eviction prompt; "hibernate" inactive tabs after 5 min.

8. **Electron-only close-guard flow** — Browsers' `beforeunload` is unreliable for async flows.
   - **Mitigation**: in-app UI for the close-guard. `beforeunload` is just a fallback.

### 11.3 Low-risk items

9. **Native menu parity** — Browsers cannot install OS menus. Replaced by in-app menu bar. The Ribbon already covers 95% of menu commands.

10. **macOS vibrancy** — `titleBarStyle: 'hiddenInset' + vibrancy: 'sidebar'` punches through to the desktop. Browser approximation: `backdrop-filter: blur(20px)` + `background: rgba(255,255,255,0.7)`. Acceptable degradation.

11. **Auto-updater** — `electron-updater` becomes a Service Worker manifest endpoint + `controllerchange` prompt.

12. **PDF export** — `BrowserWindow.printToPDF` becomes `PaginationPreview` clone + `pdf-lib` assembly.

### 11.4 Things that work in our favor

- The renderers are already browser code (zero Electron imports).
- The engines are already platform-neutral (zero Node/Electron imports).
- The IPC contracts are typed TypeScript interfaces (define the exact migration surface).
- Heavy test coverage (50-100 vitest tests per editor; 23-fixture pagination corpus).
- The Contractor SaaS infrastructure provides reusable patterns even though its code is wrong-domain.

---

## Architectural Corrections (frozen into this ADR)

These two corrections were applied during the architecture review pass and are now part of the frozen spec:

**Correction A — `getRuntime()` is bootstrap-only, not a domain dependency.**
Domain services receive their dependencies explicitly through construction (`new DocumentServiceImpl(storage, files, ai, ...)`). They never internally call `getRuntime()`. This prevents the new architecture from quietly recreating the same hidden-global coupling that the migration is intended to eliminate.

**Correction B — Bridge tests must cover both shape and dispatch.**
A bridge that technically satisfies 280 method signatures while dispatching a method to the wrong service is a silent contract violation. Milestone 1 includes shape/coverage tests + dispatch tests + architecture-boundary tests. See ADR-002 §5 for the full testing strategy.

# Milestone 1 Handoff — Frozen Scope for the Next Engineer

> **Read this first.** This document defines the exact, frozen scope of Milestone 1. Implement only what is described here. Do not "improve" the architecture while implementing. The purpose of this milestone is to establish the frozen seams, not to solve the migration prematurely.
>
> **Architecture status**: ADR-001 + ADR-002 are frozen and approved. See:
> - [ADR-001: Platform Extraction Architecture](./ADR-001-platform-extraction-architecture.md)
> - [ADR-002: Renderer Compatibility Bridge Strategy](./ADR-002-renderer-compatibility-bridge.md)
>
> **Milestone 1 status**: Approved. Behaviorally inert. Three packages only.

---

## TL;DR

Create three new workspace packages:

```
packages/runtime-contracts/   ← TypeScript interfaces only
packages/platform/            ← Platform capability interfaces + shared types
packages/renderer-bridge/     ← Typed compatibility factories + contract tests
```

**No editor UI. No renderer. No Electron main. No preload. No shell. No web shell. No domain implementations. No adapter implementations. No IPC replacement. No filesystem replacement. No WASM. No backend. No collaboration work. No architectural refactoring outside the three packages.**

The three new packages are initially **dead code** — nothing in the existing application imports them. That is intentional. The first commit must be **behaviorally inert**: the observable application behavior before and after the milestone must be identical.

---

## The three packages — exact file-level scope

### 1. `packages/runtime-contracts/`

TypeScript interfaces only. Zero runtime code (no classes, no functions, no constants with values — only type declarations and `interface` definitions).

```
packages/runtime-contracts/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                              ← re-exports everything
    runtime.ts                            ← RuntimeContext interface + getRuntime()/setRuntime()
    services/
      docs.ts                             ← DocumentService interface
      sheets.ts                           ← SpreadsheetService interface
      slides.ts                           ← PresentationService interface
      pdf.ts                              ← PdfService interface
      markdown.ts                         ← MarkdownService interface
      project.ts                          ← ProjectStore interface (extracted from @genoffice/project-store)
  tests/
    runtime.test.ts                       ← verifies getRuntime() throws before setRuntime() is called
```

**File contents (sketch)**:

```typescript
// src/runtime.ts
import type { DocumentService } from './services/docs'
import type { SpreadsheetService } from './services/sheets'
import type { PresentationService } from './services/slides'
import type { PdfService } from './services/pdf'
import type { MarkdownService } from './services/markdown'
import type { ProjectStore } from './services/project'
import type {
  Storage, Files, Identity, AI, Printing, Clipboard, Notifications, Windowing,
} from '@genoffice/platform'

export interface RuntimeContext {
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

  // Domain services (Layer 2)
  readonly docs: DocumentService
  readonly sheets: SpreadsheetService
  readonly slides: PresentationService
  readonly pdf: PdfService
  readonly markdown: MarkdownService

  // Project (cross-editor — chat history + file grouping)
  readonly project: ProjectStore
}

// Bootstrap-only mechanism. Domain services MUST NOT call this internally.
// (Architectural Correction A — see ADR-001 §6.3 and ADR-002 §3 Rule A)
let current: RuntimeContext | null = null
export function setRuntime(ctx: RuntimeContext): void { current = ctx }
export function getRuntime(): RuntimeContext {
  if (!current) throw new Error('RuntimeContext not initialized — call setRuntime first')
  return current
}
```

Each service interface declares the methods listed in ADR-001 §6.1. **Do not implement them** — declare the interface only.

The `tests/runtime.test.ts` verifies:

```typescript
import { getRuntime, setRuntime } from '../src/runtime'

test('getRuntime throws before setRuntime is called', () => {
  // Note: this test depends on module state; ensure isolation by either
  // (a) running in a fresh module instance, or (b) designing getRuntime
  // to read from a parameter rather than module state.
  expect(() => getRuntime()).toThrow(/not initialized/)
})

test('setRuntime + getRuntime round-trips the context', () => {
  const mock: RuntimeContext = { /* ... */ } as any
  setRuntime(mock)
  expect(getRuntime()).toBe(mock)
})
```

**Important**: there is an inherent tension between "domain services never call getRuntime" (Correction A) and a mutable global singleton. Resolution: the singleton exists for bootstrap (Electron preload, Web iframe bootstrap), but the bridge and the domain services receive the runtime (or its individual capabilities) via constructor parameters. The singleton is a convenience for the bootstrap layer only.

### 2. `packages/platform/`

The 8 capability interfaces + shared types. Platform-neutral — no Electron or browser imports.

```
packages/platform/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                              ← re-exports everything
    capabilities/
      storage.ts                          ← Storage interface
      files.ts                            ← Files interface + FileHandle, FileStat, SaveResult types
      identity.ts                         ← Identity interface
      ai.ts                                ← AI interface
      printing.ts                         ← Printing interface
      clipboard.ts                        ← Clipboard interface
      notifications.ts                    ← Notifications interface
      windowing.ts                        ← Windowing interface + TabSummary, UiTheme, UiLanguage types
    types.ts                              ← shared types (AccountStatus, AiSettings, AiStreamChunk, etc.)
  tests/
    architecture.test.ts                  ← verifies zero electron / node:* / browser API imports in this package
```

**Capability interface definitions**: copy from ADR-001 §6.2 — every method signature there is the source of truth. **Do not invent new methods.** If a renderer's `window.*` API needs a method that doesn't fit one of the 8 capabilities, raise the issue rather than expanding the surface.

**Shared types**: extract from `apps/*/src/shared/*-api.ts`. Examples:
- `AccountStatus`, `AccountLoginEvent`, `CloudProjectEntry`, `CloudProjectsSnapshot` — from `apps/shell/src/shared/home-api.ts`
- `AiSettings`, `AiStreamRequest`, `AiStreamChunk`, `AiChatRequest`, `AiChatResponse` — from `@genoffice/ai-provider`
- `UiLanguage`, `UiTheme`, `UpdateChannel`, `UpdateUiState` — from `apps/shell/src/shared/home-api.ts` and `apps/shell/src/shared/update-api.ts`
- `FileHandle`, `FileStat`, `SaveResult`, `OpenFileResult` — new types, defined here
- `TabSummary`, `TabKind` — from `apps/shell/src/shared/tabs-api.ts`
- `RecentEntry`, `RecentQuery`, `RecentPage` — from `apps/shell/src/shared/home-api.ts`
- `ProjectSummaryEntry`, `TimelineEntryItem` — from `apps/shell/src/shared/home-api.ts`

**Important**: do not move these types out of `apps/*/src/shared/` — that would break renderer imports. Re-export them from `packages/platform/src/types.ts` for the new packages to consume. The original locations remain canonical until Phase 6 cleanup.

The `tests/architecture.test.ts` verifies zero platform-specific imports:

```typescript
import { scanForImports } from './helpers'

test('packages/platform/src contains no Electron imports', () => {
  const offenders = scanForImports(__dirname + '/../src', ['electron', 'ipcRenderer', 'ipcMain', 'contextBridge', 'BrowserWindow'])
  expect(offenders).toEqual([])
})

test('packages/platform/src contains no node: imports', () => {
  const offenders = scanForImports(__dirname + '/../src', [/from ['"]node:/])
  expect(offenders).toEqual([])
})

test('packages/platform/src contains no direct browser API usage', () => {
  const offenders = scanForImports(__dirname + '/../src', ['window.', 'document.', 'localStorage', 'indexedDB', 'showOpenFilePicker', 'showSaveFilePicker'])
  expect(offenders).toEqual([])
})
```

### 3. `packages/renderer-bridge/`

Pure object factories that return the existing `window.*` API shapes, delegating to domain services. **No `window` mutation inside the package** (Architectural clarification, ADR-002 §2.3). The package produces objects; the preload/bootstrap installs them onto `window`.

```
packages/renderer-bridge/
  package.json                            ← depends on @genoffice/runtime-contracts + @genoffice/platform
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                              ← re-exports all bridge factories
    bridges/
      docs-bridge.ts                     ← createDesktopBridge(docs, runtime): DesktopApi
      sheets-bridge.ts                   ← createDesktopApiBridge(sheets, runtime): DesktopApi (sheets variant)
      slides-bridge.ts                   ← createSlidesApiBridge(slides, runtime): SlidesApi
      pdf-bridge.ts                      ← createPdfApiBridge(pdf, runtime): PdfApi
      markdown-bridge.ts                 ← createMarkdownApiBridge(markdown, runtime): MarkdownApi
      home-bridge.ts                     ← createHomeBridge(runtime): HomeApi
      tabs-bridge.ts                     ← createTabsBridge(runtime): TabsApi
      project-bridge.ts                  ← createProjectBridge(project): ProjectApi
      update-bridge.ts                   ← createUpdateBridge(updater): UpdateApi
  tests/
    contract/
      docs-bridge.shape.test.ts         ← shape/coverage test
      docs-bridge.dispatch.test.ts       ← dispatch verification
      sheets-bridge.shape.test.ts
      sheets-bridge.dispatch.test.ts
      slides-bridge.shape.test.ts
      slides-bridge.dispatch.test.ts
      pdf-bridge.shape.test.ts
      pdf-bridge.dispatch.test.ts
      markdown-bridge.shape.test.ts
      markdown-bridge.dispatch.test.ts
      home-bridge.shape.test.ts
      home-bridge.dispatch.test.ts
      tabs-bridge.shape.test.ts
      tabs-bridge.dispatch.test.ts
      project-bridge.shape.test.ts
      project-bridge.dispatch.test.ts
      update-bridge.shape.test.ts
      update-bridge.dispatch.test.ts
    architecture.test.ts                 ← verifies zero Electron / browser imports; no window mutation
    helpers/
      mocks.ts                            ← mockRuntime, mockDocumentService, etc.
      scan.ts                             ← scanForImports, scanForTokens helpers
```

**Bridge factory pattern** (sketch for docs; same pattern for all bridges):

```typescript
// src/bridges/docs-bridge.ts
import type { DesktopApi } from '@genoffice/docs-shared'  // path alias to apps/docs/src/shared/ipc.ts
import type { DocumentService, RuntimeContext } from '@genoffice/runtime-contracts'

export function createDesktopBridge(docs: DocumentService, runtime: RuntimeContext): DesktopApi {
  return {
    // File operations
    open: () => docs.openDialog().then(r => r ?? null),
    openPath: (path: string) => docs.open(path).then(() => null),
    consumePendingOpen: () => docs.consumePendingOpen(),
    consumeNewBlank: () => docs.consumeNewBlank(),
    save: (path, data, auto) => docs.save(path, new Uint8Array(data), { auto }),
    // ... every other method, 1:1 with DesktopApi, delegating to the correct service
  }
}
```

**Critical** (Architectural Correction B): the dispatch tests must verify that **the correct service is called AND the wrong service is NOT called**. A bridge that dispatches to the wrong service but happens to return the right type would otherwise pass a shape test silently.

**Critical** (Architectural clarification, ADR-002 §2.3): the bridge package **must not** mutate `window`. The package produces objects only. The installation (`window.desktop = createDesktopBridge(...)`) happens in the preload (Phase 2) or iframe bootstrap (Phase 4), not in the bridge package.

**Important — workspace dependency setup**: this package depends on types defined in `apps/*/src/shared/*-api.ts`. Those files are TypeScript source in workspace packages. Set up path aliases in `tsconfig.json` and `package.json` to import them as `@genoffice/docs-shared`, `@genoffice/sheets-shared`, etc. Do not duplicate the type definitions — import them verbatim.

The shape test for each bridge verifies that every method on the existing interface is implemented:

```typescript
// tests/contract/docs-bridge.shape.test.ts
import { createDesktopBridge } from '../../src/bridges/docs-bridge'
import type { DesktopApi } from '@genoffice/docs-shared'
import { mockRuntime, mockDocumentService } from '../helpers/mocks'

test('createDesktopBridge implements every DesktopApi method', () => {
  const bridge = createDesktopBridge(mockDocumentService(), mockRuntime())
  const bridgeKeys = Object.keys(bridge).sort()
  // DesktopApi is an interface — at runtime we need a list of expected keys.
  // Define EXPECTED_DESKTOP_API_KEYS as a snapshot of the interface's method names.
  expect(bridgeKeys).toEqual(EXPECTED_DESKTOP_API_KEYS)
})
```

The dispatch tests verify the correct service is called (see ADR-002 §5.1.2 for the concrete test patterns).

The architecture test verifies the bridge package imports nothing platform-specific:

```typescript
// tests/architecture.test.ts
test('packages/renderer-bridge/src contains no Electron imports', () => {
  const offenders = scanForImports(__dirname + '/../src', ['electron', 'ipcRenderer', 'ipcMain', 'contextBridge', 'BrowserWindow'])
  expect(offenders).toEqual([])
})

test('packages/renderer-bridge/src contains no window mutation', () => {
  const offenders = scanForTokens(__dirname + '/../src', ['window.', 'document.', 'localStorage', 'indexedDB', 'postMessage', 'fetch('])
  expect(offenders).toEqual([])
})

test('packages/renderer-bridge/src contains no node: imports', () => {
  const offenders = scanForImports(__dirname + '/../src', [/from ['"]node:/])
  expect(offenders).toEqual([])
})
```

---

## Workspace setup

### Add the new packages to `package.json` (workspace root)

Edit `/home/z/my-project/research/genoffice/package.json` `workspaces` field — it already includes `packages/*`, so the new packages are picked up automatically. No change needed.

### Add TypeScript path aliases (for the `@genoffice/*-shared` imports in `renderer-bridge`)

Edit `/home/z/my-project/research/genoffice/tsconfig.base.json` to add path aliases:

```json
{
  "compilerOptions": {
    "paths": {
      "@genoffice/docs-shared": ["./apps/docs/src/shared/ipc.ts"],
      "@genoffice/sheets-shared": ["./apps/sheets/src/shared/desktop-api.ts"],
      "@genoffice/slides-shared": ["./apps/slides/src/shared/ipc.ts"],
      "@genoffice/pdf-shared": ["./apps/pdf/src/shared/ipc.ts"],
      "@genoffice/markdown-shared": ["./apps/markdown/src/shared/ipc.ts"],
      "@genoffice/shell-home-shared": ["./apps/shell/src/shared/home-api.ts"],
      "@genoffice/shell-tabs-shared": ["./apps/shell/src/shared/tabs-api.ts"],
      "@genoffice/shell-update-shared": ["./apps/shell/src/shared/update-api.ts"]
    }
  }
}
```

(Correct the paths above after reading the actual files; the goal is to alias the `*-shared` import names to the existing TypeScript source files in `apps/*/src/shared/`.)

### Update the root `test` and `typecheck` scripts

Edit `/home/z/my-project/research/genoffice/package.json` `scripts.test` and `scripts.typecheck` to add the new packages at the end of the existing chain:

```json
{
  "scripts": {
    "test": "... existing chain ... && npm run test -w @genoffice/runtime-contracts && npm run test -w @genoffice/platform && npm run test -w @genoffice/renderer-bridge",
    "typecheck": "... existing chain ... && npm run typecheck -w @genoffice/runtime-contracts && npm run typecheck -w @genoffice/platform && npm run typecheck -w @genoffice/renderer-bridge"
  }
}
```

---

## Verification criteria

Milestone 1 is complete when **all** of the following are true:

### Build / typecheck
- [ ] `npm run typecheck -w @genoffice/runtime-contracts` passes.
- [ ] `npm run typecheck -w @genoffice/platform` passes.
- [ ] `npm run typecheck -w @genoffice/renderer-bridge` passes.
- [ ] `npm run typecheck` (root) passes — no existing package broken.

### Tests
- [ ] `npm run test -w @genoffice/runtime-contracts` passes (1 test: `getRuntime` throws before `setRuntime`).
- [ ] `npm run test -w @genoffice/platform` passes (1 architecture test: zero platform-specific imports).
- [ ] `npm run test -w @genoffice/renderer-bridge` passes (9 shape tests + 9 dispatch tests + 1 architecture test = 19 tests).
- [ ] `npm test` (root) still passes — no existing test broken.

### Behaviorally inert
- [ ] `git diff apps/` shows zero changes (renderers and mains untouched).
- [ ] `git diff apps/shell/` shows zero changes (shell untouched).
- [ ] The Electron app launches, opens a document, edits, saves, closes — identical behavior to before the milestone.

### What's NOT in Milestone 1

- ❌ No changes to `apps/*/src/renderer/` (renderer code frozen).
- ❌ No changes to `apps/*/src/main/` (Electron main still works as before).
- ❌ No changes to `apps/*/src/preload/` (preload still exposes the existing globals via the existing IPC).
- ❌ No changes to `apps/shell/` (shell still works as before).
- ❌ No new `apps/web-shell/` (that's Phase 3).
- ❌ No domain service implementations (those are stubs that throw `Error('not implemented')`).
- ❌ No adapter implementations (those are stubs).
- ❌ No CI workflow changes (existing tests still pass; new packages have their own typecheck + contract tests).
- ❌ No WASM work (that's Phase 7).
- ❌ No backend work (that's Phase 7).
- ❌ No collaboration work (that's Phase 8).

---

## If anything breaks during Milestone 1

Because Milestone 1 is **behaviorally inert** (no existing code imports the new packages), any regression is immediately attributable to workspace/package configuration rather than runtime migration. Investigate:

1. Did the TypeScript path aliases break an existing package's typecheck? Check `tsconfig.base.json` changes.
2. Did adding the new packages to the `test`/`typecheck` scripts break the chain? Check `package.json` scripts.
3. Did a workspace resolution issue prevent the existing packages from resolving their deps? Run `npm ls` and check for new warnings.

If you can't isolate the regression to one of these three causes, **stop**. Do not "fix" the regression by modifying existing application code. File the issue and ask the architect.

---

## Stop after Milestone 1 verification

The next engineer/LLM should implement **only Milestone 1** and stop after verification. Do not start Phase 1 (Electron compatibility runtime) until the architect has reviewed Milestone 1's output and explicitly approved proceeding.

The verification deliverable is:
1. The three new packages committed to `main`.
2. All verification criteria above passing in CI.
3. A PR description that lists every file added, every test added, and confirms the behavioral-inertness check (zero changes to `apps/`).

Once that PR is merged, the architect will decide whether to proceed with Phase 1 (Electron compatibility runtime — moving existing main-process code into `packages/platform-electron` and wiring the bridge via the preload).

---

## Reference

- [ADR-001: Platform Extraction Architecture](./ADR-001-platform-extraction-architecture.md) — the target architecture.
- [ADR-002: Renderer Compatibility Bridge Strategy](./ADR-002-renderer-compatibility-bridge.md) — the bridge strategy, including the seven migration rules and the testing strategy.
- [README.md](./README.md) — overview of the web-migration architecture folder.

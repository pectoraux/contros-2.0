# Phase 1 Boundary Correction Plan

**Status**: BLOCKED / READY FOR REVIEW — 2026-08-21
**Required by**: Principal Architect's review of commit `65c4aae5fc36b88b47e137d0b879c2d2c94ac65a`
**Scope**: Refactor **only the new packages** (`platform-electron`, `services-docs`). No application wiring. No new features. No Web/WASM work.

---

## 0. Background

Commit `65c4aae5fc` added two new packages (`packages/platform-electron/`, `packages/services-docs/`) as a Phase 1 skeleton. The Principal Architect independently reviewed the committed code on GitHub and identified **6 architectural violations** that make the skeleton unsafe to wire into `apps/docs`.

This document is the **Boundary Correction Plan**. It enumerates every violation with:

- **Current dependency** (what the code does today)
- **Architectural violation** (which frozen rule it breaks)
- **Correct capability/abstraction** (what should be there)
- **Replacement dependency** (the new code shape)
- **Files affected**
- **Behavior-preservation test** (how we verify no regression)

After the plan, the corrected packages are implemented. **No application code is modified.**

---

## Violation 1 — `services-docs` directly uses `node:fs`, `node:path`, `node:crypto`, `node:buffer`

### Current dependency

`packages/services-docs/src/document-service.ts` imports:

```ts
import { createHash } from 'node:crypto'
import { existsSync, statSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs'
import { copyFileSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Buffer } from 'node:buffer'
```

…and directly calls `mkdirSync`, `copyFileSync`, `writeFileSync`, `existsSync`, `readdirSync`, `statSync`, `unlinkSync` at 13+ sites (lines 309, 321, 360, 362, 558, 560, 562, 565, 576, 578, 591, 623, 625, 641, 645, 663).

`packages/services-docs/src/atomic-write-impl.ts` imports `node:crypto`, `node:fs/promises`, `node:path`, `node:buffer`.

### Architectural violation

> **Frozen rule (ADR-001 §6.2 + Correction A):** Domain services compose Layer 1 engines with Layer 3 platform capabilities. They must NOT import `node:*` or Electron APIs. The whole point of the migration is to eliminate this exact coupling.

A domain service that imports `node:fs` is, by definition, an Electron-bound service. The fact that it *also* receives `Storage` and `Files` capabilities via constructor does not fix the violation — it just gives the service two filesystem paths, one of which is hidden.

### Correct capability/abstraction

All filesystem operations must go through the `Files` and `Storage` capability interfaces:

| Current (violation) | Correct (capability) |
|---|---|
| `existsSync(path)` | `Files.stat(path)` (returns null on missing — wrap in try/catch) |
| `statSync(path)` | `Files.stat(path)` |
| `readFileSync(path)` | `Files.read(path)` → `{ bytes, stat }` |
| `writeFileSync(path, bytes)` | `Files.write(path, bytes)` |
| `mkdirSync(dir, { recursive: true })` | (remove — `Files.write` already creates parent dirs) |
| `copyFileSync(src, dst)` | `Files.read(src)` → `Files.write(dst, bytes)` |
| `readdirSync(dir)` | `Storage.listObjects(store)` (for the originals archive) |
| `unlinkSync(path)` | `Storage.deleteBlob(key)` |
| `createHash('sha256').update(bytes).digest('hex')` | `Files.stat(path)` already returns the hash (computed by the adapter) OR a new `Hashing` capability if needed |
| `basename(path)` / `dirname(path)` / `join(...)` | (path manipulation is OK — it's pure data, not fs access) |

The originals archive (`userData/originals/<sha256>.docx`) is a **binary blob store**, not a directory of files the service manages. The service says "archive this original under key X"; the `Storage.writeBlob(key, bytes)` capability decides where and how.

### Replacement dependency

```ts
// BEFORE (violation)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
// ... direct fs calls throughout

// AFTER (corrected)
import type { Storage, Files, AI, Printing, FileHandle, FileStat } from '@genoffice/platform'
// no node:* imports at all
// service calls this.deps.storage.writeBlob(hash, bytes) instead of copyFileSync
// service calls this.deps.files.write(path, bytes) instead of writeFileSync
// service calls this.deps.storage.listObjects('originals') instead of readdirSync
```

### Files affected

- `packages/services-docs/src/document-service.ts` — full rewrite of fs-touching methods
- `packages/services-docs/src/atomic-write-impl.ts` — **deleted** (atomic write is the `Files.write` capability's job; the service has no business knowing about tmp+rename)
- `packages/services-docs/src/atomic-write.ts` — **deleted** (re-export shim no longer needed)
- `packages/services-docs/src/external-change-impl.ts` — kept (it's pure logic, no fs imports)
- `packages/services-docs/src/external-change.ts` — kept

### Behavior-preservation test

- `npm run typecheck -w @genoffice/services-docs` passes
- New architecture test (in `packages/services-docs/tests/architecture.test.ts`) scans for `node:` and `electron` imports — must return zero hits
- The service is not yet wired into `apps/docs`, so no runtime behavior to preserve. The gate is: does the corrected service still typecheck against `DocumentService` from `@genoffice/runtime-contracts`?

---

## Violation 2 — `DocumentServiceImpl` has shell/runtime concerns embedded

### Current dependency

`DocumentServiceDeps` includes:

```ts
canWrite: (wcId: number, filePath: string) => boolean
allowWrite: (wcId: number, filePath: string) => void
getActiveWcId: () => number | null
openTab?: (openPath?: string, opts?: { newBlank?: boolean }) => void
listTabs?: () => DocsTabInfo[]
focusTab?: (id: string) => void
saveDialog?: (defaultName: string) => Promise<string | null>
```

The service calls `getActiveWcId()` at 8+ sites, `canWrite(wcId, path)` at 4+ sites, `allowWrite(wcId, path)` at 3+ sites.

### Architectural violation

> **Frozen rule (extraction map §2):** Tab/window orchestration belongs in `apps/docs/src/main/`, NOT in the domain service. The service must not know about `webContents` identity, path-grant tracking, or shell tab callbacks.

A domain service that knows about `wcId` is coupled to Electron's renderer-process model. The Web adapter has no `wcId` concept — it would have to invent a fake one, defeating the abstraction.

### Correct capability/abstraction

The service should be **session-scoped**, not renderer-scoped. The shell creates a `DocumentSession` per renderer tab and passes it to the service:

```ts
// BEFORE (violation)
class DocumentServiceImpl {
  constructor(deps: {
    getActiveWcId: () => number | null,
    canWrite: (wcId, path) => boolean,
    allowWrite: (wcId, path) => void,
    ...
  }) {}
  
  async open(path: string): Promise<OpenFileResult | null> {
    const wcId = this.deps.getActiveWcId()
    if (wcId === null) return null
    // ... tracks sessions by wcId internally
  }
}

// AFTER (corrected)
class DocumentServiceImpl {
  constructor(deps: {
    storage: Storage,
    files: Files,
    ai: AI,
    printing: Printing,
    fontRegistry: FontRegistry,
    // NO shell hooks, NO wcId, NO canWrite/allowWrite
  }) {}
  
  // Session-scoped methods — the shell owns the session lifecycle
  async open(path: string): Promise<{ session: DocumentSession; result: OpenFileResult } | null> {
    // returns a session object; the shell holds the reference
  }
  
  async save(session: DocumentSession, data: Uint8Array, opts?): Promise<SaveResult> {
    // uses session.path, session.hash, session.diskState — no wcId lookup
  }
}
```

The shell (`apps/docs/src/main/docs-main.ts`) owns:
- The map of `wcId → DocumentSession`
- Path-grant tracking (`canWrite` / `allowWrite`)
- Tab creation (`openTab`), listing (`listTabs`), focus (`focusTab`)
- The close-guard flow

The service owns:
- The byte-preserving save plan (open → archive → save → external-modified check → clear recovery)
- Attachment collection
- Font metrics lookup

### Replacement dependency

- Remove `canWrite`, `allowWrite`, `getActiveWcId`, `openTab`, `listTabs`, `focusTab`, `saveDialog` from `DocumentServiceDeps`.
- Add a `DocumentSession` type that the service returns from `open()` and accepts in `save()` / `saveAs()` / `writeRecovery()` etc.
- The `openNewTab` / `listDocsTabs` / `focusDocsTab` methods stay on `DocumentService` (they're on the interface) but their implementations delegate to an `EventBus` request that the shell subscribes to.

### Files affected

- `packages/services-docs/src/document-service.ts` — full rewrite of session model
- `packages/runtime-contracts/src/services/docs.ts` — update `DocumentService` interface to be session-scoped (NOTE: this is a contract change, but the contract is not yet wired into any renderer, so it's safe)

### Behavior-preservation test

- The service typechecks against the corrected `DocumentService` interface
- No `wcId` / `webContents` / `BrowserWindow` references in `services-docs`
- The shell (not yet written) will own the session map; this is verified in Increment 2 (not this correction)

---

## Violation 3 — "Byte-preserving save plan" claim is overstated

### Current dependency

`DocumentServiceImpl.save(path, data, auto)` accepts `data: Uint8Array` and writes it via `Files.write()`. The service does NOT perform the DOCX transformation (the `pmDocToSavePlan` + `saveDocx` logic from `@genoffice/docx-engine`).

### Architectural violation

> The extraction map claimed: *"byte-preserving save plan logic (moved from renderer's convert.ts)"* — but the renderer is frozen and untouched. The committed service does persistence, not transformation.

### Correct capability/abstraction

**Distinguish two concerns:**

1. **Persistence semantics** — the service decides *when* to write, *where* to write, whether to check external-modified, whether to clear recovery. This IS in the service.
2. **Transformation semantics** — the `@genoffice/docx-engine` `saveDocx(parsed, saveBlocks, options)` call that produces the actual bytes. This currently lives in `apps/docs/src/renderer/file-actions.ts` + `editor/convert.ts`. It has NOT been moved.

**The corrected plan:**
- The service's `save()` method accepts bytes produced by the renderer (which still calls `saveDocx` from `@genoffice/docx-engine` in the renderer process).
- The service does NOT claim to do the transformation.
- A future increment (post-Increment 2) may move the transformation into the service, but only when the renderer can be unfrozen and the bridge can pass structured save plans instead of raw bytes.

### Replacement dependency

- Update the `DocumentService.save()` docstring to say: *"Persists the bytes the renderer produced. The byte-preserving DOCX transformation (saveDocx from @genoffice/docx-engine) remains in the renderer for now; this service handles persistence + external-modified check + recovery copy management."*
- Do NOT claim the transformation has been extracted.

### Files affected

- `packages/services-docs/src/document-service.ts` — docstring corrections only

### Behavior-preservation test

- No behavior change — the service already does persistence, not transformation. The correction is to the *claim*, not the code.

---

## Violation 4 — Service duplicates infrastructure instead of consuming capabilities

### Current dependency

`DocumentServiceImpl` contains private methods:
- `archiveOriginal(filePath, bytes, hash)` — uses `copyFileSync` / `writeFileSync`
- `pruneOriginals(dir)` — uses `readdirSync` / `statSync` / `unlinkSync`
- `clearRecoveryCopy(filePath)` — uses `existsSync` / `unlinkSync`
- `uniquePathIn(dir, fileName)` — uses `existsSync` / `mkdirSync`
- `collectAttachments(paths)` — uses `statSync`

### Architectural violation

> **Frozen rule:** Domain services compose capabilities. They don't re-implement capability mechanisms.

`archiveOriginal` is conceptually "store this blob under this key" — that's `Storage.writeBlob`. `pruneOriginals` is "list blobs in this store, delete the oldest" — that's `Storage.listObjects` + `Storage.deleteBlob`. `clearRecoveryCopy` is "delete this blob" — `Storage.deleteBlob`. `uniquePathIn` is "find a non-conflicting filename in a directory" — that's a `Files` capability method (or a shell concern).

### Correct capability/abstraction

| Current private method | Replacement |
|---|---|
| `archiveOriginal(filePath, bytes, hash)` | `this.deps.storage.writeBlob('originals:' + hash, bytes)` |
| `pruneOriginals(dir)` | `this.deps.storage.listObjects('originals')` → sort by mtime → `deleteBlob` oldest until under cap. (Or move prune to a periodic shell task — the service shouldn't be a garbage collector.) |
| `clearRecoveryCopy(filePath)` | `this.deps.storage.deleteBlob('recovery:' + sha1(filePath))` |
| `uniquePathIn(dir, fileName)` | Add `Files.uniquePath(dir, fileName): Promise<string>` to the `Files` capability. |
| `collectAttachments(paths)` | `this.deps.files.stat(path)` for each path → build metadata |

### Replacement dependency

The service's private helpers shrink dramatically. The originals-archive logic becomes 1 line: `await this.deps.storage.writeBlob(key, bytes)`. The prune logic moves to a `Storage` capability method OR is dropped from the service entirely (let the adapter handle cache eviction — the service just writes blobs; it doesn't manage the store's size).

### Files affected

- `packages/services-docs/src/document-service.ts` — replace all private fs helpers with capability calls
- `packages/platform/src/capabilities/files.ts` — add `uniquePath(dir, fileName)` method to the `Files` interface
- `packages/platform-electron/src/capabilities/electron-files.ts` — implement `uniquePath` using `existsSync`

### Behavior-preservation test

- The service typechecks
- No `mkdirSync` / `copyFileSync` / `readdirSync` / `unlinkSync` / `existsSync` calls in `services-docs`
- The originals archive still works (verified when wired in Increment 2)

---

## Violation 5 — `attachDocsService()` is a service-locator escape hatch

### Current dependency

```ts
// packages/platform-electron/src/runtime/electron-runtime.ts
export function attachDocsService(docsService: any): void {
  const runtime = getRuntimeForAttach()
  ;(runtime as any).docs = docsService
}

function getRuntimeForAttach(): RuntimeContext {
  const { getRuntime } = require('@genoffice/runtime-contracts')
  return getRuntime() as RuntimeContext
}
```

### Architectural violation

> **Frozen rule (Correction A):** `getRuntime()` is bootstrap-only. The `attachDocsService` pattern is a hidden service-locator: it calls `getRuntime()` *after* bootstrap to mutate the runtime. This defeats the constructor-injection discipline.

The justification given was "avoid circular dependency" — but the correct fix is to construct the dependency graph explicitly, not to mutate the singleton after the fact.

### Correct capability/abstraction

The runtime construction is a **two-phase bootstrap**:

1. **Phase A** — construct the capabilities (no service dependencies yet):
   ```ts
   const storage = new ElectronStorage(...)
   const files = new ElectronFiles(...)
   const settings = new ElectronSettings(...)
   // ... all 9 capabilities
   const projectStore = new ProjectStore(...)
   ```

2. **Phase B** — construct the services (depend on capabilities from phase A):
   ```ts
   const docsService = new DocumentServiceImpl({ storage, files, ai, printing, fontRegistry, ... }, eventBus)
   ```

3. **Phase C** — construct the runtime (bundles capabilities + services):
   ```ts
   const runtime: RuntimeContext = {
     platform: 'electron',
     version: appVersion,
     storage, files, settings, ai, identity, printing, clipboard, notifications, windowing,
     docs: docsService,
     sheets: null, // later increment
     slides: null,
     pdf: null,
     markdown: null,
     project: projectStore,
   }
   setRuntime(runtime) // THE ONLY setRuntime call
   ```

No `attachDocsService`. No `getRuntimeForAttach`. The runtime is constructed complete; `setRuntime` is called once.

### Replacement dependency

- Delete `attachDocsService` and `getRuntimeForAttach` from `packages/platform-electron/src/runtime/electron-runtime.ts`
- The `createElectronRuntime` factory takes an optional `docsService` parameter (constructed by the caller, e.g. `apps/docs/src/main/index.ts`) and includes it in the runtime bundle
- OR: the factory constructs the `DocumentServiceImpl` itself (preferred — keeps the construction graph in one place)

### Files affected

- `packages/platform-electron/src/runtime/electron-runtime.ts` — delete `attachDocsService` + `getRuntimeForAttach`; the factory constructs the full runtime in one pass
- `packages/platform-electron/src/index.ts` — remove `attachDocsService` from exports

### Behavior-preservation test

- `grep -E "attachDocsService|getRuntimeForAttach" packages/platform-electron/` returns zero hits
- The factory typechecks
- `setRuntime` is called exactly once in `createElectronRuntime`

---

## Violation 6 — "All nine capabilities" claim is misleading (AI stubs)

### Current dependency

`ElectronAI` contains:
```ts
async stream(_request: AiStreamRequest): Promise<void> {
  // No-op — docs-main still owns this for Phase 1 increment 1.
}
async streamCancel(_requestId: string): Promise<void> { /* No-op */ }
async chat(_request: AiChatRequest): Promise<AiChatResponse> {
  return {} as AiChatResponse  // Phase 1 increment 1: docs-main still owns ai:chat.
}
async generateImage(_op: GenerateImageOp): Promise<GenerateImageResult> {
  return { error: 'generateImage not yet wired in Phase 1 increment 1' }
}
```

`ElectronWindowing` is also mostly stubs (`listTabs`, `activateTab`, etc. all return `[]` / no-op).

### Architectural violation

> The package technically implements the `AI` interface, but it does NOT implement the AI capability. Presenting stubs as "the extracted Electron capability" is misleading.

### Correct capability/abstraction

Two options:

**Option A (preferred):** Remove the stubs. The `ElectronAI` class implements only the methods that are actually wired (`getSettings`, `setSettings`, `webSearch`, `imageSearch`, `fetchImage`). For the rest (`stream`, `streamCancel`, `chat`, `generateImage`, `analyzeMedia`), the class throws `Error('not implemented in this increment — use the existing docs-main handler')`. This is honest: the capability is partially implemented.

**Option B:** Split `AI` into two interfaces — `AIRead` (settings, search, fetchImage) and `AIStream` (stream, chat, cancel). `ElectronAI` implements `AIRead` only. The runtime exposes `ai: AIRead` until `AIStream` is implemented. (This is a contract change — more invasive.)

**Option A is chosen** — it's honest and doesn't require splitting the contract. The throws are explicit; the docstring explains why.

### Replacement dependency

```ts
async stream(request: AiStreamRequest): Promise<void> {
  throw new Error(
    'ElectronAI.stream not implemented in Phase 1 increment 1 — ' +
    'the existing registerAiIpc handler in apps/docs/src/main/docs-main.ts ' +
    'still owns this until the stream loop is generalized in a later increment.'
  )
}
```

### Files affected

- `packages/platform-electron/src/capabilities/electron-ai.ts` — replace stubs with explicit throws
- `packages/platform-electron/src/capabilities/electron-windowing.ts` — replace stubs with explicit throws (or remove the methods that are pure shell orchestration and not in scope)

### Behavior-preservation test

- Calling `runtime.ai.stream(...)` throws with a clear message (not a silent no-op)
- The existing `docs-main.ts` `registerAiIpc` handler still works (it's not wired through the capability yet)

---

## Violation 7 (noted) — Skeleton is too large for an unverified first increment

### Current state

Commit `65c4aae5fc` adds 2,584 lines across 29 files, including a ~600-line `DocumentServiceImpl`.

### Architectural observation

The migration principle was: *small extraction → wire it → prove behavior → continue*. The skeleton created a substantial parallel architecture without exercising it through the real application path.

### Correct approach

This correction increment keeps the package sizes appropriate:
- `services-docs` shrinks dramatically (no fs helpers, no shell hooks → ~250-300 LOC)
- `platform-electron` stays roughly the same size but the stubs are honest
- No application wiring happens in this correction

The next increment (Increment 2, after this correction is approved) wires **one** capability through the real application path before extracting more. The recommended order:

1. Wire `Files.pickOpen()` + `Files.read()` through `createElectronRuntime` into the docs `open` handler only. Verify the docs `open` flow works end-to-end.
2. Wire `Files.write()` through to the docs `save` handler. Verify save works.
3. Continue incrementally.

---

## Implementation order for this correction

1. Update `packages/runtime-contracts/src/services/docs.ts` — make `DocumentService` session-scoped (remove `wcId` dependencies)
2. Add `uniquePath(dir, fileName)` to `packages/platform/src/capabilities/files.ts`
3. Rewrite `packages/services-docs/src/document-service.ts`:
   - Remove all `node:*` imports
   - Remove `canWrite` / `allowWrite` / `getActiveWcId` / `openTab` / `listTabs` / `focusTab` / `saveDialog` from deps
   - Add `DocumentSession` type (returned from `open()`, accepted by `save()` etc.)
   - Replace all private fs helpers with `Storage` / `Files` capability calls
   - Delete `atomic-write-impl.ts` + `atomic-write.ts` (atomic write is the adapter's job)
4. Rewrite `packages/platform-electron/src/runtime/electron-runtime.ts`:
   - Delete `attachDocsService` + `getRuntimeForAttach`
   - The factory constructs the full runtime in one pass (capabilities → services → runtime → setRuntime)
5. Replace AI/Windowing stubs with explicit throws
6. Add `packages/services-docs/tests/architecture.test.ts` — verifies zero `node:` / `electron` imports
7. Verify typecheck + tests pass
8. Verify `apps/` untouched
9. Commit + push
10. Report: `ARCHITECTURE STATUS: BLOCKED / READY FOR REVIEW`

---

## What is NOT done in this correction

- ❌ No application wiring (apps/docs/src/main/ + preload unchanged)
- ❌ No renderer changes (frozen)
- ❌ No shared contract changes (the `DesktopApi` interface is unchanged; the `DocumentService` interface in runtime-contracts is updated to be session-scoped, but it's not yet consumed by any renderer)
- ❌ No new features
- ❌ No Web adapter
- ❌ No WASM
- ❌ No backend
- ❌ No claim that the DOCX transformation has been extracted

---

## Stop criteria for this correction

The correction is complete when ALL of the following are true:

1. `grep -rE "from 'node:" packages/services-docs/src/` returns **zero hits**
2. `grep -rE "from 'electron'" packages/services-docs/src/` returns **zero hits**
3. `grep -rE "BrowserWindow|webContents|wcId" packages/services-docs/src/` returns **zero hits**
4. `grep -rE "canWrite|allowWrite|getActiveWcId|openTab|listTabs|focusTab" packages/services-docs/src/` returns **zero hits** (these move to the shell in Increment 2)
5. `grep -rE "attachDocsService|getRuntimeForAttach" packages/platform-electron/src/` returns **zero hits**
6. `npx tsc --noEmit -p packages/services-docs/tsconfig.json` passes
7. `npx tsc --noEmit -p packages/platform-electron/tsconfig.json` passes
8. New architecture test `packages/services-docs/tests/architecture.test.ts` passes
9. All Milestone 1 tests still pass (82 tests)
10. `apps/` is byte-identical to its pre-correction state (git diff `65c4aae5fc` -- apps/ is empty)

After this correction, the architect reviews the corrected dependency graph before approving Increment 2 (application wiring).

# ADR-003: Standalone Docs `app:get-theme` Known Defect

## Status

ACCEPTED (known defect, not blocking the Docs preload migration)

## Context

The GenOffice Docs application supports two runtime modes:

1. **Shell-hosted** — docs runs as a `WebContentsView` tab inside the
   unified shell (`apps/shell`). The shell owns global concerns: theme,
   language, window lifecycle, tab management.

2. **Standalone** — docs runs as its own Electron app
   (`apps/docs/src/main/index.ts → startDocsStandalone()`). This mode is
   used for development (`npm run dev`), for the standalone docs product
   build, and for the E2E smoke test.

The `DesktopApi.getTheme()` method calls `ipcRenderer.invoke('app:get-theme')`.
The `app:get-theme` IPC handler is registered ONLY in the shell main process
(`apps/shell/src/main/index.ts:2101`), NOT in the docs standalone main process
(`apps/docs/src/main/docs-main.ts`).

This means in standalone mode:

```text
window.desktop.getTheme()
    → ipcRenderer.invoke('app:get-theme')
    → "No handler registered for 'app:get-theme'"
```

## Decision

This is classified as a **pre-existing standalone-mode defect**, not a
preload migration regression. The defect existed before the preload
migration (commit `9b283bb`) and is unrelated to the typed bridge
architecture.

The Docs preload migration is **approved for shell-hosted mode** (the
primary runtime path). The standalone defect is tracked here for a
future, narrowly scoped fix.

## Future Fix (not part of the current migration)

The fix would add `app:get-theme` (and potentially `app:get-language`,
which IS registered in standalone) to the standalone docs main process,
or extract a shared settings-registration function used by both the
shell and standalone docs.

The fix should NOT be hidden inside the preload migration — it's a
standalone-mode gap, not a bridge architecture issue.

## Verification

- Shell-hosted docs: `app:get-theme` is registered by the shell → PASS
- Standalone docs: `app:get-theme` is NOT registered → known defect
- The real CDP smoke test (`real-desktop-smoke.test.ts`) runs in shell
  mode and verifies no "No handler registered for 'app:get-theme'" error.

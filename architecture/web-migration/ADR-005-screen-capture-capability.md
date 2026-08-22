# ADR-005: Screen Capture Capability

## Status

PROPOSED (formal platform capability amendment, pending Principal Architect approval)

## Context

The GenOffice Sheets application uses Electron's `desktopCapturer` and
`screen.getAllDisplays()` for screenshot functionality — capturing screen
sources (displays and windows) and taking full-resolution screenshots.

This behavior is currently embedded in `apps/sheets/src/main/sheets-main.ts`
(L1869–1940). It is not a Sheets-specific concern — screen capture is a
legitimate cross-runtime capability that other editors (Slides, Docs) may
also need.

The frozen nine-capability list (Storage, Files, Identity, AI, Printing,
Clipboard, Notifications, Windowing, Settings) does not include screen
capture.

## Decision

Screen capture becomes a new platform capability: `ScreenCapture`.

### Architecture

```text
platform
    ScreenCapture (interface)
          ↓
platform-electron
    ElectronScreenCapture (implements ScreenCapture)
          ↓
desktopCapturer + screen.getAllDisplays()
```

### Interface (proposed)

```text
ScreenCapture {
    enumerateSources(): Promise<ScreenSource[]>
    captureSource(sourceId: string): Promise<ScreenCaptureResult>
    getPermissionStatus(): Promise<ScreenCapturePermission>
}
```

### Types

```text
ScreenSource {
    id: string
    name: string
    kind: 'screen' | 'window'
    thumbnail?: { base64: string; mime: string; width: number; height: number }
}

ScreenCaptureResult {
    base64: string
    mime: string
    width: number
    height: number
}

ScreenCapturePermission = 'granted' | 'denied' | 'prompt' | 'unknown'
```

### Capture source enumeration

`enumerateSources()` returns all available capture sources (displays and
application windows). The caller filters which sources to present.

### Capture request

`captureSource(sourceId)` captures a full-resolution screenshot of the
identified source. The `sourceId` comes from `enumerateSources()`.

### Permission / denied semantics

`getPermissionStatus()` checks the OS-level screen-recording permission
(macOS: `systemPreferences.getMediaAccessStatus('screen')`). Returns
`'denied'` if the user has not granted permission. The shell coordinator
can use this to show a permission prompt or direct the user to System
Preferences.

### Screen vs window distinction

`ScreenSource.kind` distinguishes displays (`'screen'`) from application
windows (`'window'`). The caller (renderer/shell) decides which to show.

### Source exclusion semantics

The caller may exclude specific sources (e.g., the app's own window)
from the list. The capability does not perform exclusion — it returns
all sources; the caller filters.

### Electron implementation

`ElectronScreenCapture` uses:
- `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize, fetchWindowIcons })`
  for enumeration
- `desktopCapturer.getSources({ types: [source.kind], thumbnailSize: { width: MAX, height: MAX } })`
  + full-resolution capture via `screen.getAllDisplays()` coordinate
  mapping for full-res screenshots
- `systemPreferences.getMediaAccessStatus('screen')` for permission

### Future browser implementation

A future `BrowserScreenCapture` would use `navigator.mediaDevices.getDisplayMedia()`
+ canvas capture. The permission model differs (user picks a source at
prompt time, not programmatically). The capability interface must accommodate
this — `enumerateSources()` may return a single "user-selected" source
after a permission prompt in browser mode.

### Formal amendment to the capability list

The frozen platform capability list is amended from:

```text
Storage, Files, Identity, AI, Printing, Clipboard,
Notifications, Windowing, Settings
```

to:

```text
Storage, Files, Identity, AI, Printing, Clipboard,
Notifications, Windowing, Settings, ScreenCapture
```

This is a formal architecture amendment. It does NOT modify the existing
nine capabilities — it adds a tenth.

## Consequences

- `platform` gains a `ScreenCapture` interface.
- `platform-electron` gains an `ElectronScreenCapture` implementation.
- `RuntimeContext` gains a `screenCapture: ScreenCapture` field.
- Sheets (and future editors) can use screen capture via the runtime
  context instead of importing Electron directly.
- The capability is optional — a runtime that doesn't support screen
  capture can provide a no-op or throwing implementation.

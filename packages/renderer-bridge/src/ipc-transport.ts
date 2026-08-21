/**
 * IpcTransport — runtime-independent typed IPC interface for preload/preload-like
 * adapters.
 *
 * The renderer-bridge package MUST NOT import Electron. Instead, the
 * preload (or future web runtime) provides an IpcTransport implementation
 * backed by `ipcRenderer` (Electron), `postMessage` (web worker), or
 * `fetch` (remote).
 *
 * TYPED CHANNELS (Increment 2I):
 *   The transport is generic over typed channel maps:
 *     - RequestChannels: invoke(channel, ...args) → Promise<Return>
 *     - SendChannels: send(channel, ...args) → void
 *     - EventChannels: on(channel, listener) → unsubscribe
 *
 *   Each channel map encodes the argument tuple and the return/payload type.
 *   TypeScript infers the exact types from the channel name — NO casts
 *   (`as never`, `as any`, `as unknown as`) are needed anywhere in the
 *   bridge.
 *
 * Architecture:
 *
 *   Renderer (window.desktop)
 *       ↓
 *   DesktopApi (bridge — typed methods)
 *       ↓
 *   TypedIpcTransport.invoke('docs:open') — type-checked channel + args + return
 *       ↓
 *   [Electron: ipcRenderer.invoke('docs:open')]
 *       ↓
 *   ipcMain handler (derives event.sender → wcId, callerWindow)
 *       ↓
 *   DocsShellCoordinatorImpl(wcId, callerWindow, ...)
 *
 * The bridge has NO caller identity. The caller is derived at the IPC
 * handler boundary from IpcMainInvokeEvent.sender — NOT in the bridge,
 * NOT from global state, NOT from focused-window inference.
 */

/**
 * A typed IPC transport generic over three channel maps:
 *   - R: request channels (invoke → Promise<Return>)
 *   - S: send channels (send → void)
 *   - E: event channels (on → listener receives Payload)
 *
 * Each channel map maps a channel name (string literal) to an object with
 * the argument tuple and return/payload type.
 */
export interface TypedIpcTransport<
  R extends Record<string, { Args: unknown[]; Return: unknown }>,
  S extends Record<string, { Args: unknown[] }>,
  E extends Record<string, { Payload: unknown[] }>,
> {
  /**
   * Invoke a main-process IPC handler and await its response.
   * Maps to `ipcRenderer.invoke(channel, ...args)` in Electron.
   *
   * The channel name and argument tuple are type-checked against the
   * RequestChannels map (R). The return type is inferred from the map.
   */
  invoke<C extends keyof R & string>(
    channel: C,
    ...args: [...R[C]['Args']]
  ): Promise<R[C]['Return']>

  /**
   * Send a fire-and-forget IPC message (no response awaited).
   * Maps to `ipcRenderer.send(channel, ...args)` in Electron.
   *
   * The channel name and argument tuple are type-checked against the
   * SendChannels map (S).
   */
  send<C extends keyof S & string>(channel: C, ...args: [...S[C]['Args']]): void

  /**
   * Subscribe to a push-event channel. Returns an unsubscribe function.
   * Maps to `ipcRenderer.on(channel, listener)` +
   * `ipcRenderer.removeListener(channel, listener)` in Electron.
   *
   * The listener receives the payload tuple (type-checked against the
   * EventChannels map E). The IpcTransport implementation strips the
   * IpcRendererEvent before calling the listener.
   */
  on<C extends keyof E & string>(
    channel: C,
    listener: (...payload: [...E[C]['Payload']]) => void,
  ): () => void
}

/**
 * A runtime-independent IPC transport for the Docs application.
 *
 * Uses the DocsIpcContract channel maps (docs-ipc-contract.ts) for
 * compile-time type safety on every IPC call.
 */
export type DocsIpcTransport = TypedIpcTransport<
  // Lazy import via type-only to avoid circular deps — the contract file
  // imports only types from @genoffice/docs-shared, @genoffice/ai-provider,
  // and @genoffice/font-metrics (all type-only).
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  import('./docs-ipc-contract.js').DocsIpcRequestChannels,
  import('./docs-ipc-contract.js').DocsIpcSendChannels,
  import('./docs-ipc-contract.js').DocsIpcEventChannels
>

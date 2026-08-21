/**
 * @genoffice/platform — barrel export.
 *
 * Platform-neutral capability interfaces and shared types. Zero implementations.
 * Zero Electron imports. Zero browser API imports.
 *
 * Layer 3 of the GenOffice runtime stack (ADR-001). The 9 capability interfaces
 * (Storage, Files, Identity, AI, Printing, Clipboard, Notifications, Windowing,
 * Settings) define the platform contract that Layer 4 adapters implement.
 */
export * from './types.js'
export * from './capabilities/storage.js'
export * from './capabilities/files.js'
export * from './capabilities/identity.js'
export * from './capabilities/ai.js'
export * from './capabilities/printing.js'
export * from './capabilities/clipboard.js'
export * from './capabilities/notifications.js'
export * from './capabilities/windowing.js'
export * from './capabilities/settings.js'

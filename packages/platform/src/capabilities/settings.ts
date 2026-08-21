/**
 * Settings capability — user preferences (theme, language, update channel,
 * onboarding, default save dir, app version).
 *
 * Electron: userData/app-settings.json (read/written by the shell main process).
 * Web: IndexedDB key-value store.
 *
 * NOTE: ADR-001 §6.2 listed 8 capabilities and did not include Settings; the
 * bridge code in ADR-002 §2.2 referenced `runtime.settings.getTheme()` etc.
 * This 9th capability resolves that ADR inconsistency (correction, not an
 * architecture improvement).
 *
 * Push subscriptions for theme/language changes live here (not in Windowing);
 * Windowing keeps the chrome-pressed and tabs-changed subscriptions.
 */
import type { UiTheme, UiLanguage, UpdateChannel } from '../types.js'

export interface Settings {
  // ── Theme ────────────────────────────────────────────────────────────
  getTheme(): Promise<UiTheme>
  setTheme(theme: UiTheme): Promise<void>
  onThemeChanged(handler: (theme: UiTheme) => void): () => void

  // ── Language ─────────────────────────────────────────────────────────
  getLanguage(): Promise<UiLanguage>
  setLanguage(lang: UiLanguage): Promise<void>
  onLanguageChanged(handler: (lang: UiLanguage) => void): () => void

  // ── Update channel ──────────────────────────────────────────────────
  getUpdateChannel(): Promise<UpdateChannel>
  setUpdateChannel(channel: UpdateChannel): Promise<void>

  // ── Onboarding ───────────────────────────────────────────────────────
  onboardingSeen(): Promise<boolean>
  setOnboardingSeen(): Promise<void>

  // ── Default save directory ───────────────────────────────────────────
  getDefaultSaveDir(): Promise<string>
  pickDefaultSaveDir(): Promise<string | null>

  // ── App version ──────────────────────────────────────────────────────
  getAppVersion(): Promise<string>
}

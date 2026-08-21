/**
 * ElectronSettings — implements the Settings capability using app-settings.json
 * + the i18n module + nativeTheme broadcasts.
 *
 * Wraps the existing settings logic from apps/shell/src/main/app-settings.ts
 * + apps/docs/src/main/docs-main.ts (theme/language broadcasts).
 *
 * IMPORTANT (ADR-001 Correction A): constructor injection. No getRuntime().
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getUiLang, setUiLang, type Lang } from '@genoffice/i18n'
import type { Settings, UiTheme, UiLanguage, UpdateChannel } from '@genoffice/platform'

export interface ElectronSettingsDeps {
  /** Returns the userData directory path. */
  userDataDir: string
  /** Returns the Documents directory (for default save dir fallback). */
  documentsDir: string
  /** nativeTheme-like object with settable themeSource. */
  nativeTheme: { themeSource: string; on: (event: string, cb: () => void) => void }
  /** A list of webContents to broadcast theme/language changes to. */
  broadcast: (channel: string, ...args: unknown[]) => void
  /** App version (from package.json). */
  appVersion: string
}

export class ElectronSettings implements Settings {
  private readonly settingsPath: string
  private themeListeners = new Set<(t: UiTheme) => void>()
  private langListeners = new Set<(l: UiLanguage) => void>()

  constructor(private readonly deps: ElectronSettingsDeps) {
    this.settingsPath = join(deps.userDataDir, 'app-settings.json')
    mkdirSync(deps.userDataDir, { recursive: true })

    // Forward nativeTheme changes to subscribers + broadcast to renderers
    deps.nativeTheme.on('updated', () => {
      const t = this.readSetting<'light' | 'dark' | 'system'>('theme', 'system')
      for (const fn of this.themeListeners) fn(t)
    })
  }

  // ── Theme ─────────────────────────────────────────────────────────────

  async getTheme(): Promise<UiTheme> {
    return this.readSetting<'light' | 'dark' | 'system'>('theme', 'system')
  }

  async setTheme(theme: UiTheme): Promise<void> {
    this.writeSetting('theme', theme)
    this.deps.nativeTheme.themeSource = theme
    for (const fn of this.themeListeners) fn(theme)
    this.deps.broadcast('app:theme-changed', theme)
  }

  onThemeChanged(handler: (theme: UiTheme) => void): () => void {
    this.themeListeners.add(handler)
    return () => this.themeListeners.delete(handler)
  }

  // ── Language ──────────────────────────────────────────────────────────

  async getLanguage(): Promise<UiLanguage> {
    return getUiLang() as UiLanguage
  }

  async setLanguage(lang: UiLanguage): Promise<void> {
    setUiLang(lang as Lang)
    for (const fn of this.langListeners) fn(lang)
    this.deps.broadcast('app:language-changed', lang)
  }

  onLanguageChanged(handler: (lang: UiLanguage) => void): () => void {
    this.langListeners.add(handler)
    return () => this.langListeners.delete(handler)
  }

  // ── Update channel ──────────────────────────────────────────────────

  async getUpdateChannel(): Promise<UpdateChannel> {
    return this.readSetting<'stable' | 'beta'>('updateChannel', 'stable')
  }

  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    this.writeSetting('updateChannel', channel)
  }

  // ── Onboarding ───────────────────────────────────────────────────────

  async onboardingSeen(): Promise<boolean> {
    return this.readSetting<boolean>('onboardingSeen', false)
  }

  async setOnboardingSeen(): Promise<void> {
    this.writeSetting('onboardingSeen', true)
  }

  // ── Default save dir ─────────────────────────────────────────────────

  async getDefaultSaveDir(): Promise<string> {
    const configured = this.readSetting<string | null>('defaultSaveDir', null)
    if (configured && configured.trim()) return configured
    return join(this.deps.documentsDir, 'GenOffice')
  }

  async pickDefaultSaveDir(): Promise<string | null> {
    // The picker is platform-specific (Electron dialog.openDirectory); the
    // actual picking is done by the shell in apps/shell/src/main/index.ts.
    // For Phase 1, this is delegated to a shell hook that the ElectronRuntime
    // receives. If no hook, return null.
    return null
  }

  // ── App version ──────────────────────────────────────────────────────

  async getAppVersion(): Promise<string> {
    return this.deps.appVersion
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private readSetting<T>(key: string, fallback: T): T {
    try {
      const raw = readFileSync(this.settingsPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback
      const value = (parsed as Record<string, unknown>)[key]
      return (value as T | undefined) ?? fallback
    } catch {
      return fallback
    }
  }

  private writeSetting<T>(key: string, value: T): void {
    let map: Record<string, unknown> = {}
    try {
      const raw = readFileSync(this.settingsPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = parsed as Record<string, unknown>
      }
    } catch {
      /* file doesn't exist yet */
    }
    map[key] = value
    writeFileSync(this.settingsPath, JSON.stringify(map, null, 2), 'utf8')
  }
}

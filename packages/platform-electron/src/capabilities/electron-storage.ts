/**
 * ElectronStorage — implements the Storage capability using node:fs + userData/.
 *
 * Wraps the existing app-settings.json + userData/originals/<hash> +
 * userData/docs-autosave/<sha1>.docx patterns from apps/docs/src/main/docs-main.ts.
 *
 * Settings (key-value) → userData/app-settings.json (read-modify-write).
 * Object stores → userData/<store>.json (one file per store, key-value map).
 * Binary blobs → userData/blobs/<sha256(key)> (one file per blob).
 *
 * IMPORTANT (ADR-001 Correction A): this class receives its dependencies via
 * constructor. It does NOT call getRuntime() internally.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { Storage } from '@genoffice/platform'

export interface ElectronStorageDeps {
  /** Returns the userData directory path (app.getPath('userData')). */
  userDataDir: string
}

export class ElectronStorage implements Storage {
  private readonly settingsPath: string
  private readonly objectStoreDir: string
  private readonly blobDir: string

  constructor(deps: ElectronStorageDeps) {
    this.settingsPath = join(deps.userDataDir, 'app-settings.json')
    this.objectStoreDir = join(deps.userDataDir, 'object-stores')
    this.blobDir = join(deps.userDataDir, 'blobs')
    mkdirSync(this.objectStoreDir, { recursive: true })
    mkdirSync(this.blobDir, { recursive: true })
  }

  // ── Key-value (settings) ─────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    const all = this.readSettings()
    return (all[key] as T | undefined) ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    const all = this.readSettings()
    all[key] = value
    this.writeSettings(all)
  }

  async delete(key: string): Promise<void> {
    const all = this.readSettings()
    delete all[key]
    this.writeSettings(all)
  }

  // ── Object stores ────────────────────────────────────────────────────

  async readObject(store: string, key: string): Promise<unknown | null> {
    const file = this.objectStorePath(store)
    const map = this.readObjectStore(file)
    return map[key] ?? null
  }

  async writeObject(store: string, key: string, value: unknown): Promise<void> {
    const file = this.objectStorePath(store)
    const map = this.readObjectStore(file)
    map[key] = value
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(map, null, 2), 'utf8')
  }

  async deleteObject(store: string, key: string): Promise<void> {
    const file = this.objectStorePath(store)
    const map = this.readObjectStore(file)
    delete map[key]
    writeFileSync(file, JSON.stringify(map, null, 2), 'utf8')
  }

  async listObjects(store: string): Promise<string[]> {
    const file = this.objectStorePath(store)
    if (!existsSync(file)) return []
    return Object.keys(this.readObjectStore(file))
  }

  // ── Binary blobs ──────────────────────────────────────────────────────

  async readBlob(key: string): Promise<Uint8Array | null> {
    const file = this.blobPath(key)
    if (!existsSync(file)) return null
    return new Uint8Array(readFileSync(file))
  }

  async writeBlob(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.blobPath(key)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }

  async deleteBlob(key: string): Promise<void> {
    const file = this.blobPath(key)
    if (existsSync(file)) unlinkSync(file)
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private readSettings(): Record<string, unknown> {
    try {
      const raw = readFileSync(this.settingsPath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private writeSettings(map: Record<string, unknown>): void {
    writeFileSync(this.settingsPath, JSON.stringify(map, null, 2), 'utf8')
  }

  private objectStorePath(store: string): string {
    // Sanitize store name (could be 'home', 'recents', etc.)
    const safe = store.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.objectStoreDir, `${safe}.json`)
  }

  private readObjectStore(file: string): Record<string, unknown> {
    if (!existsSync(file)) return {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private blobPath(key: string): string {
    // Sanitize key — could be a sha256 hash, a file path, etc.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_')
    return join(this.blobDir, safe)
  }
}

/**
 * SessionRegistry — owns the map of file-path → DocumentSession.
 *
 * The shell (apps/docs/src/main/) constructs this and passes it to the
 * docs bridge at preload time. The bridge queries the registry to find
 * the session for a given path; it does NOT hold its own session state.
 *
 * This replaces the single-slot `activeSession` in the bridge — the
 * registry supports multiple simultaneous tabs (one session per open file).
 *
 * IMPORTANT: this is a pure data structure (no fs access, no node:* imports).
 * It lives in services-docs because it's docs-specific, but it's
 * platform-neutral (the Web adapter will use the same registry).
 */
import type { DocumentSession } from '@genoffice/runtime-contracts'

export interface SessionRegistry {
  /** Get the session for a given file path (the renderer's current path). */
  get(filePath: string): DocumentSession | null
  /** Register a session (called after open/saveAs/saveNew succeed). */
  register(session: DocumentSession): void
  /** Drop a session (called on tab close / teardown). */
  drop(filePath: string): void
  /** List all registered sessions (for debugging / multi-tab coordination). */
  list(): DocumentSession[]
}

/** In-memory SessionRegistry implementation. */
export class InMemorySessionRegistry implements SessionRegistry {
  private readonly sessions = new Map<string, DocumentSession>()

  get(filePath: string): DocumentSession | null {
    return this.sessions.get(filePath) ?? null
  }

  register(session: DocumentSession): void {
    this.sessions.set(session.filePath, session)
  }

  drop(filePath: string): void {
    this.sessions.delete(filePath)
  }

  list(): DocumentSession[] {
    return Array.from(this.sessions.values())
  }
}

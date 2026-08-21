/**
 * Notifications capability — system toast notifications.
 *
 * Electron: Notification (Electron native).
 * Web: Notification API (with permission request).
 */
import type { NotificationOptions } from '../types.js'

export interface Notifications {
  /** Show a notification (requests permission if not already granted). */
  show(title: string, opts?: NotificationOptions): Promise<void>
  /** Request notification permission; returns whether granted. */
  requestPermission(): Promise<boolean>
}

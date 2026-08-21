/**
 * ElectronNotifications — implements the Notifications capability using
 * Electron's Notification API.
 */
import type { Notifications, NotificationOptions } from '@genoffice/platform'

export interface ElectronNotificationsDeps {
  /** Lazily-imported Electron Notification constructor. */
  NotificationCtor: new (opts: { title: string; body?: string; icon?: string; tag?: string }) => {
    show: () => void
    on: (event: string, cb: () => void) => void
  }
}

export class ElectronNotifications implements Notifications {
  constructor(private readonly deps: ElectronNotificationsDeps) {}

  async show(title: string, opts?: NotificationOptions): Promise<void> {
    const n = new this.deps.NotificationCtor({
      title,
      body: opts?.body,
      icon: opts?.icon,
      tag: opts?.tag,
    })
    n.show()
  }

  async requestPermission(): Promise<boolean> {
    // Electron always grants; no permission flow needed.
    return true
  }
}

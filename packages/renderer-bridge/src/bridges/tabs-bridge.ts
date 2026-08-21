/**
 * createTabsBridge — maps the existing window.aiOfficeTabs (TabsApi) API
 * to the Windowing capability.
 */
import type { TabsApi } from '@genoffice/shell-tabs-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

export function createTabsBridge(runtime: RuntimeContext): TabsApi {
  return {
    list: () => runtime.windowing.listTabs(),
    activate: (id) => runtime.windowing.activateTab(id),
    close: (id) => runtime.windowing.closeTab(id),
    showMenu: (x, y) => runtime.windowing.showTabMenu(x, y),
    showNewMenu: (x, y) => runtime.windowing.showNewMenu(x, y),
    reorder: (id, toIndex) => runtime.windowing.reorderTab(id, toIndex),
    notifyChromePressed: () => runtime.windowing.notifyChromePressed(),
    onChanged: (handler) => runtime.windowing.onTabsChanged(handler),
    onChromePressed: (handler) => runtime.windowing.onChromePressed(handler),
  }
}

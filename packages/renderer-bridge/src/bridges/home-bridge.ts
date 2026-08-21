/**
 * createHomeBridge — maps the existing window.aiOffice (HomeApi) API to
 * the RuntimeContext's capabilities.
 *
 * Uses runtime-validated conversion functions — ZERO type assertions.
 */
import type { HomeApi } from '@genoffice/shell-home-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import {
  fromStorageRecentPage,
  fromStorageRecentEntries,
  fromStorageStarPrompt,
  fromStorageCloudProjects,
} from '../conversions/docs-conversions.js'

export function createHomeBridge(runtime: RuntimeContext): HomeApi {
  return {
    recents: (query) =>
      runtime.storage
        .readObject('home', 'recents:' + JSON.stringify(query ?? {}))
        .then((r) => fromStorageRecentPage(r, { entries: [], total: 0, totalAll: 0 })),
    starred: (query) =>
      runtime.storage
        .readObject('home', 'starred:' + JSON.stringify(query ?? {}))
        .then((r) => fromStorageRecentPage(r, { entries: [], total: 0, totalAll: 0 })),
    statPaths: (paths) =>
      runtime.storage
        .readObject('home', 'statPaths:' + JSON.stringify(paths))
        .then((r) => fromStorageRecentEntries(r, [])),
    toggleStar: (path) =>
      runtime.storage.writeObject('home', 'toggleStar:' + path, { path }).then(() => undefined),
    removeRecent: (paths) =>
      runtime.storage.writeObject('home', 'removeRecent', { paths }).then(() => undefined),

    openPath: (path) => runtime.windowing.activateTab(path).then(() => undefined),
    browse: () =>
      runtime.files
        .pickOpen({ accept: ['.docx', '.xlsx', '.pptx', '.pdf', '.md', '.markdown', '.csv', '.xls'] })
        .then(() => undefined),
    newDoc: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newSheet: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newSlide: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newMarkdown: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),

    revealPath: (path) => runtime.files.revealInFolder(path),
    renameFile: (path, newName) =>
      runtime.files.rename(path, newName).then((h) => ({ ok: true, path: typeof h === 'string' ? h : String(h) })),
    duplicateFile: (path) =>
      runtime.files.read(path).then(({ bytes }) => runtime.files.write(path + '.copy', bytes)),
    deleteFiles: (paths) => runtime.files.trash(paths),
    openTrash: () => runtime.files.openPath('trash://'),

    getLanguage: () => runtime.settings.getLanguage(),
    setLanguage: (lang) => runtime.settings.setLanguage(lang),
    getUpdateChannel: () => runtime.settings.getUpdateChannel(),
    setUpdateChannel: (channel) => runtime.settings.setUpdateChannel(channel),

    accountStatus: () => runtime.identity.accountStatus(),
    accountLogin: () => runtime.identity.login(),
    onAccountLogin: (handler) => runtime.identity.onLoginEvent(handler),
    openLoginUrl: () => runtime.identity.openLoginUrl(),
    accountLogout: () => runtime.identity.logout(),

    getAppVersion: () => runtime.settings.getAppVersion(),
    onboardingSeen: () => runtime.settings.onboardingSeen(),
    setOnboardingSeen: () => runtime.settings.setOnboardingSeen(),

    getTheme: () => runtime.settings.getTheme(),
    setTheme: (theme) => runtime.settings.setTheme(theme),
    getDefaultSaveDir: () => runtime.settings.getDefaultSaveDir(),
    pickDefaultSaveDir: () => runtime.settings.pickDefaultSaveDir(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),

    openGenTeam: () => runtime.identity.openGenTeam(),
    openCreditUsage: () => runtime.identity.openCreditUsage(),
    openGitHubRepo: () => runtime.windowing.openGitHubRepo(),
    githubStars: () => runtime.storage.get<number | null>('githubStars').then((v) => v ?? null),

    starPromptShouldShow: () =>
      runtime.storage
        .readObject('home', 'starPromptShouldShow')
        .then((r) => fromStorageStarPrompt(r, { show: false, docOpens: 0 })),
    starPromptAction: (action) =>
      runtime.storage.writeObject('home', 'starPromptAction', { action }).then(() => undefined),

    cloudProjectsCached: () =>
      runtime.storage
        .readObject('home', 'cloudProjectsCached')
        .then((r) => fromStorageCloudProjects(r) ?? null),
    cloudProjectsSync: () =>
      runtime.storage
        .readObject('home', 'cloudProjectsSync')
        .then((r) => fromStorageCloudProjects(r) ?? null),
    openCloudProject: (projectUrl) => runtime.windowing.openExternal(projectUrl),
  }
}

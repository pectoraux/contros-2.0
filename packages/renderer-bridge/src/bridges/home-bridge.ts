/**
 * createHomeBridge — maps the existing window.aiOffice (HomeApi) API to
 * the RuntimeContext's capabilities and services.
 *
 * Pure factory: returns an object typed as HomeApi. Does NOT mutate window.
 * The preload (Electron) or iframe bootstrap (Web) installs the result.
 *
 * Per ADR-002 Rule 3: methods perform signature conversion only, no business logic.
 */
import type { HomeApi } from '@genoffice/shell-home-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

export function createHomeBridge(runtime: RuntimeContext): HomeApi {
  return {
    // ── Recents & starred (delegate to runtime.storage via the home service) ──
    // NOTE: For Milestone 1 these delegate to runtime.storage object stores.
    // In Phase 1 a dedicated HomeService may be introduced.
    recents: (query) => runtime.storage.readObject('home', 'recents:' + JSON.stringify(query ?? {})).then((r) => r as never),
    starred: (query) => runtime.storage.readObject('home', 'starred:' + JSON.stringify(query ?? {})).then((r) => r as never),
    statPaths: (paths) => runtime.storage.readObject('home', 'statPaths:' + JSON.stringify(paths)).then((r) => r as never),
    toggleStar: (path) => runtime.storage.writeObject('home', 'toggleStar:' + path, { path }).then(() => undefined),
    removeRecent: (paths) => runtime.storage.writeObject('home', 'removeRecent', { paths }).then(() => undefined),

    // ── File operations (route to the right editor by extension) ──────
    openPath: (path) => runtime.windowing.activateTab(path).then(() => undefined),
    browse: () => runtime.files.pickOpen({ accept: ['.docx', '.xlsx', '.pptx', '.pdf', '.md', '.markdown', '.csv', '.xls'] }).then(() => undefined),
    newDoc: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newSheet: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newSlide: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),
    newMarkdown: () => runtime.windowing.showNewMenu(0, 0).then(() => undefined),

    // ── File-system operations ────────────────────────────────────────
    revealPath: (path) => runtime.files.revealInFolder(path),
    renameFile: (path, newName) => runtime.files.rename(path, newName).then((h) => ({ ok: true, path: typeof h === 'string' ? h : String(h) })),
    duplicateFile: (path) => runtime.files.read(path).then(({ bytes }) => runtime.files.write(path + '.copy', bytes)),
    deleteFiles: (paths) => runtime.files.trash(paths),
    openTrash: () => runtime.files.openPath('trash://'),

    // ── Language / theme / settings ──────────────────────────────────
    getLanguage: () => runtime.settings.getLanguage(),
    setLanguage: (lang) => runtime.settings.setLanguage(lang),
    getUpdateChannel: () => runtime.settings.getUpdateChannel(),
    setUpdateChannel: (channel) => runtime.settings.setUpdateChannel(channel),

    // ── Account ──────────────────────────────────────────────────────
    accountStatus: () => runtime.identity.accountStatus(),
    accountLogin: () => runtime.identity.login(),
    onAccountLogin: (handler) => runtime.identity.onLoginEvent(handler),
    openLoginUrl: () => runtime.identity.openLoginUrl(),
    accountLogout: () => runtime.identity.logout(),

    // ── App version / onboarding ─────────────────────────────────────
    getAppVersion: () => runtime.settings.getAppVersion(),
    onboardingSeen: () => runtime.settings.onboardingSeen(),
    setOnboardingSeen: () => runtime.settings.setOnboardingSeen(),

    // ── Theme ────────────────────────────────────────────────────────
    getTheme: () => runtime.settings.getTheme(),
    setTheme: (theme) => runtime.settings.setTheme(theme),
    getDefaultSaveDir: () => runtime.settings.getDefaultSaveDir(),
    pickDefaultSaveDir: () => runtime.settings.pickDefaultSaveDir(),
    onThemeChanged: (handler) => runtime.settings.onThemeChanged(handler),

    // ── External links ───────────────────────────────────────────────
    openGenTeam: () => runtime.identity.openGenTeam(),
    openCreditUsage: () => runtime.identity.openCreditUsage(),
    openGitHubRepo: () => runtime.windowing.openGitHubRepo(),
    githubStars: () => runtime.storage.get<number | null>('githubStars').then((v) => v ?? null),

    // ── Star prompt ──────────────────────────────────────────────────
    starPromptShouldShow: () => runtime.storage.readObject('home', 'starPromptShouldShow').then((r) => (r as never) ?? { show: false, docOpens: 0 }),
    starPromptAction: (action) => runtime.storage.writeObject('home', 'starPromptAction', { action }).then(() => undefined),

    // ── Cloud projects (GSK) ─────────────────────────────────────────
    cloudProjectsCached: () => runtime.storage.readObject('home', 'cloudProjectsCached').then((r) => (r as never) ?? null),
    cloudProjectsSync: () => runtime.storage.readObject('home', 'cloudProjectsSync').then((r) => (r as never) ?? null),
    openCloudProject: (projectUrl) => runtime.windowing.openExternal(projectUrl),
  }
}

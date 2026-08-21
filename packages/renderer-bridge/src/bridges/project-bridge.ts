/**
 * createProjectBridge — maps window.projectApi (ProjectApi from @genoffice/project-store)
 * and window.aiOfficeProject (ProjectHomeApi from shell-home-shared) to the project service.
 *
 * The shell renderer uses ProjectHomeApi (7 methods, includes listFiles which is
 * shell-specific and NOT on ProjectApi). The editor renderers use the full
 * ProjectApi (10 methods). Both delegate to runtime.project.
 *
 * NOTE: ProjectHomeApi uses ProjectSummaryEntry / TimelineEntryItem (defined in
 * home-api.ts); ProjectApi uses ProjectSummary / TimelineEntry (defined in
 * project-store/types.ts). These types have similar shapes but are distinct.
 * The bridge casts between them; in Phase 1 a proper type alignment resolves this.
 */
import type { ProjectApi } from '@genoffice/project-store'
import type { ProjectHomeApi } from '@genoffice/shell-home-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'

/** Full ProjectApi (used by editors as window.projectApi). */
export function createProjectApiBridge(runtime: RuntimeContext): ProjectApi {
  const p = runtime.project
  return {
    resolveChat: (args) => p.resolveChat(args),
    appendChat: (args) => p.appendChat(args),
    loadChat: (args) => p.loadChat(args),
    rebindChat: (args) => p.rebindChat(args),
    listProjects: () => p.listProjects(),
    createProject: (args) => p.createProject(args),
    renameProject: (args) => p.renameProject(args),
    deleteProject: (args) => p.deleteProject(args),
    moveFile: (args) => p.moveFile(args),
    getTimeline: (args) => p.getTimeline(args),
  }
}

/**
 * Shell-side ProjectHomeApi (subset of ProjectApi, exposed as window.aiOfficeProject).
 *
 * `listFiles` is shell-specific (not on ProjectApi). For Milestone 1, delegates
 * to runtime.project via a cast — the Phase 1 ProjectStoreService extension
 * will add listFiles formally. The other methods convert between the shell's
 * arg shape (positional) and the project-store's arg shape (object).
 */
export function createProjectHomeBridge(runtime: RuntimeContext): ProjectHomeApi {
  const p = runtime.project as ProjectApi & {
    listFiles?(projectId: string): Promise<string[]>
  }
  return {
    listProjects: () => p.listProjects().then((r) => r as never),
    listFiles: (projectId) =>
      (p.listFiles ? p.listFiles(projectId) : Promise.resolve([])).then((r) => r as never),
    createProject: (name) => p.createProject({ name }).then((r) => r as never),
    renameProject: (id, name) => p.renameProject({ id, name }),
    deleteProject: (id) => p.deleteProject({ id }),
    moveFile: (filePath, projectId) => p.moveFile({ filePath, projectId }),
    getTimeline: (projectId, limit) => p.getTimeline({ projectId, limit }).then((r) => r as never),
  }
}

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
 * The bridge uses fromStorage() for the conversion — explicit, not a cast.
 */
import type { ProjectApi } from '@genoffice/project-store'
import type { ProjectHomeApi } from '@genoffice/shell-home-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { fromStorage } from '../conversions/docs-conversions.js'

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
 * to runtime.project via a typed wrapper. The other methods convert between
 * the shell's arg shape (positional) and the project-store's arg shape (object).
 *
 * Uses fromStorage() for type conversion — explicit, not a cast.
 */
export function createProjectHomeBridge(runtime: RuntimeContext): ProjectHomeApi {
  const p = runtime.project as ProjectApi & {
    listFiles?(projectId: string): Promise<string[]>
  }
  return {
    listProjects: () => p.listProjects().then((r) => fromStorage(r, [])),
    listFiles: (projectId) =>
      (p.listFiles ? p.listFiles(projectId) : Promise.resolve([])).then((r) => fromStorage(r, [])),
    createProject: (name) => p.createProject({ name }).then((r) => fromStorage(r, { id: '', name: '', createdAt: '', updatedAt: '', fileCount: 0, lastActiveAt: '', isDefault: false })),
    renameProject: (id, name) => p.renameProject({ id, name }),
    deleteProject: (id) => p.deleteProject({ id }),
    moveFile: (filePath, projectId) => p.moveFile({ filePath, projectId }),
    getTimeline: (projectId, limit) => p.getTimeline({ projectId, limit }).then((r) => fromStorage(r, [])),
  }
}

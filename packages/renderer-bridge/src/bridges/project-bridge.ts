/**
 * createProjectBridge — maps window.projectApi and window.aiOfficeProject
 * to the project service.
 *
 * The ProjectHomeApi has a `listFiles` method that is NOT on ProjectApi.
 * The runtime.project may or may not have it. The bridge accepts an
 * explicit optional listFiles function rather than casting.
 */
import type { ProjectApi } from '@genoffice/project-store'
import type { ProjectHomeApi } from '@genoffice/shell-home-shared'
import type { RuntimeContext } from '@genoffice/runtime-contracts'
import { fromStorageProjectSummary } from '../conversions/docs-conversions.js'

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

export interface ProjectHomeBridgeDeps {
  project: ProjectApi
  listFiles?: (projectId: string) => Promise<string[]>
}

/**
 * Shell-side ProjectHomeApi. Takes an explicit deps object with the
 * project service and an optional listFiles function.
 */
export function createProjectHomeBridge(deps: ProjectHomeBridgeDeps): ProjectHomeApi {
  const { project: p, listFiles } = deps
  return {
    listProjects: () => p.listProjects().then((r) => (Array.isArray(r) ? r : [])),
    listFiles: (projectId) =>
      (listFiles ? listFiles(projectId) : Promise.resolve([])).then((r) =>
        Array.isArray(r) ? r : [],
      ),
    createProject: (name) =>
      p.createProject({ name }).then((r) =>
        fromStorageProjectSummary(r, {
          id: '',
          name: '',
          createdAt: '',
          updatedAt: '',
          fileCount: 0,
          lastActiveAt: '',
          isDefault: false,
        }),
      ),
    renameProject: (id, name) => p.renameProject({ id, name }),
    deleteProject: (id) => p.deleteProject({ id }),
    moveFile: (filePath, projectId) => p.moveFile({ filePath, projectId }),
    getTimeline: (projectId, limit) =>
      p.getTimeline({ projectId, limit }).then((r) => (Array.isArray(r) ? r : [])),
  }
}

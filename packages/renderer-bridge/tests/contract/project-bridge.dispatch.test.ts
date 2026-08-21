/** Dispatch test for createProjectApiBridge + createProjectHomeBridge. */
import { describe, test, expect, vi } from 'vitest'
import { createProjectApiBridge, createProjectHomeBridge } from '../../src/bridges/project-bridge.js'
import { mockRuntime } from '../helpers/mocks.js'

describe('createProjectApiBridge dispatch', () => {
  test('listProjects dispatches to runtime.project.listProjects (NOT createProject, NOT deleteProject)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectApiBridge(runtime)

    await bridge.listProjects()

    expect(project.listProjects).toHaveBeenCalledTimes(1)
    expect(project.createProject).not.toHaveBeenCalled()
    expect(project.deleteProject).not.toHaveBeenCalled()
  })

  test('createProject wraps the name in an object (argument transformation)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectApiBridge(runtime)

    await bridge.createProject({ name: 'My Project' })

    expect(project.createProject).toHaveBeenCalledWith({ name: 'My Project' })
  })
})

describe('createProjectHomeBridge dispatch', () => {
  test('createProject takes a positional name and wraps it in an object (argument transformation)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectHomeBridge(runtime)

    await bridge.createProject('Q4 Report')

    expect(project.createProject).toHaveBeenCalledWith({ name: 'Q4 Report' })
  })

  test('renameProject takes positional (id, name) and wraps them (argument transformation)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectHomeBridge(runtime)

    await bridge.renameProject('proj-1', 'Renamed')

    expect(project.renameProject).toHaveBeenCalledWith({ id: 'proj-1', name: 'Renamed' })
  })

  test('moveFile takes positional (filePath, projectId) and wraps them (argument transformation)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectHomeBridge(runtime)

    await bridge.moveFile('/path/to/file.docx', 'proj-2')

    expect(project.moveFile).toHaveBeenCalledWith({ filePath: '/path/to/file.docx', projectId: 'proj-2' })
  })

  test('deleteProject dispatches to project.deleteProject (NOT moveFile)', async () => {
    const runtime = mockRuntime()
    const project = runtime.project
    const bridge = createProjectHomeBridge(runtime)

    await bridge.deleteProject('proj-3')

    expect(project.deleteProject).toHaveBeenCalledWith({ id: 'proj-3' })
    expect(project.moveFile).not.toHaveBeenCalled()
  })
})

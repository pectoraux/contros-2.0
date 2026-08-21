/**
 * ProjectStore — domain runtime service for project management + chat history.
 *
 * Re-exports the canonical ProjectApi interface from @genoffice/project-store
 * (already a workspace package). The bridge (createProjectBridge) maps both
 * window.projectApi (editor variant) and window.aiOfficeProject (shell variant)
 * to this service.
 *
 * IMPORTANT (ADR-001 Correction A): implementations receive their dependencies
 * via constructor injection. They MUST NOT call getRuntime() internally.
 */

// The canonical ProjectApi interface is the public export of @genoffice/project-store.
// The arg-type interfaces (CreateProjectArgs, etc.) are NOT part of the package's
// public API; they're used internally by the bridge via positional-to-object
// argument transformation.
import type { ProjectApi } from '@genoffice/project-store'

// Re-export the types that @genoffice/project-store does export publicly.
export type {
  ProjectApi,
  AppendChatArgs,
  LoadChatArgs,
  RebindChatArgs,
  ResolveChatArgs,
  ResolveChatResult,
  ChatMessage,
  ChatMeta,
  ProjectData,
  ProjectIndex,
  ProjectInfo,
  ProjectSummary,
  TimelineEntry,
  ToolActivity,
} from '@genoffice/project-store'

/**
 * The ProjectStore service interface.
 *
 * For Milestone 1, this is identical to the existing ProjectApi from
 * @genoffice/project-store. The bridge delegates 1:1. In Phase 1, the
 * service may be refined (e.g. to add caching or cross-editor coordination).
 */
export type ProjectStoreService = ProjectApi

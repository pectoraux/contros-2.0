/**
 * Environment declarations for @genoffice/platform-electron.
 *
 * The `bidi-js` module (used by @genoffice/pptx-render) ships without
 * TypeScript types. This declaration satisfies the compiler when
 * platform-electron transitively imports from pptx-render.
 */
declare module 'bidi-js'

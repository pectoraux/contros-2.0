/**
 * Environment declarations for @genoffice/services-docs.
 *
 * The `bidi-js` module (used by @genoffice/pptx-render) ships without
 * TypeScript types. This declaration satisfies the compiler when
 * services-docs transitively imports from pptx-render.
 */
declare module 'bidi-js'

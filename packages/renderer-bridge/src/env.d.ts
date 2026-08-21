/**
 * Environment declarations for @genoffice/renderer-bridge.
 *
 * The `bidi-js` module (used by @genoffice/pptx-render) ships without
 * TypeScript types. This declaration satisfies the compiler when
 * renderer-bridge transitively imports from pptx-render via the
 * @genoffice/slides-shared alias.
 */
declare module 'bidi-js'

/**
 * Environment declarations for @genoffice/runtime-contracts.
 *
 * The `bidi-js` module (used by @genoffice/pptx-render) ships without
 * TypeScript types. This declaration satisfies the compiler when
 * runtime-contracts transitively imports from pptx-render via the
 * @genoffice/slides-shared alias.
 */
declare module 'bidi-js'

/**
 * Vercel Serverless Function entry point.
 *
 * Vercel requires serverless functions in an `api/` directory at the project root.
 * This file re-exports the handler from packages/web-host/src/vercel-handler.ts.
 * The actual logic — route handling, CoreApi delegation, auth — lives there.
 * This file is a 1-line adapter so Vercel can find the function.
 *
 * NOTE: Vercel's build system uses esbuild to bundle api/*.ts files. It follows
 * imports to .ts files outside the api/ directory. The import must use the .ts
 * extension (not .js) so Vercel's bundler resolves it correctly.
 */

export { default } from '../packages/web-host/src/vercel-handler.ts'

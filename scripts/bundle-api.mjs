/**
 * Bundle the Vercel serverless function into a single self-contained .mjs file.
 *
 * Why: Vercel's @vercel/node builder treats `node_modules` (including workspace
 * symlinks) as external. At runtime, Node's ESM loader tries to resolve workspace
 * package exports (which point to .ts source files), and fails because Node
 * cannot natively load TypeScript.
 *
 * This script uses esbuild to inline ALL imports — workspace packages, local
 * source — into a single file. Only true native deps (pg) are kept external;
 * Vercel's node_modules has them at runtime.
 *
 * Output: api/serverless.mjs (ESM, Node-targeted, self-contained except pg).
 */

import { build, analyzeMetafile } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ENTRY = path.join(ROOT, 'packages', 'web-host', 'src', 'vercel-handler.ts')
const OUT_DIR = path.join(ROOT, 'api')
const OUT_FILE = path.join(OUT_DIR, 'serverless.mjs')

// Vercel installs node_modules with pg available at runtime — keep it external.
// Workspace packages (@contractor/core, @contractor/web-host) MUST be inlined
// because their package.json `exports` point to .ts source files, which Node
// cannot load natively. esbuild follows the exports field and bundles the .ts.
const EXTERNAL = ['pg', '@types/pg']

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: OUT_FILE,
    external: EXTERNAL,
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    metafile: true,
    logLevel: 'info',
    preserveSymlinks: false,
    mainFields: ['module', 'main'],
    conditions: ['node', 'import', 'default'],
  })

  if (result.metafile) {
    const outSize = (await readFile(OUT_FILE)).length
    console.log(`\nBundled: ${ENTRY.replace(ROOT, '.')}`)
    console.log(`Output:  api/serverless.mjs (${(outSize / 1024).toFixed(1)} KB)`)
    console.log(`External: ${EXTERNAL.join(', ')}`)
  }
}

main().catch(err => {
  console.error('Bundle failed:', err)
  process.exit(1)
})

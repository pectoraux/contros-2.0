/**
 * AST-based dependency scanner (Increment 3I).
 *
 * Uses the TypeScript compiler API to parse source files into an AST and
 * extract actual module specifiers from import/export/require nodes.
 *
 * This replaces the regex-based scanner (Increment 3H) which could produce
 * false PASSes or false positives from comments, JSDoc, and string literals.
 *
 * The AST approach GUARANTEES:
 *   - Comments (// and /* * /) are NOT reported
 *   - JSDoc is NOT reported
 *   - String literals that are NOT import specifiers are NOT reported
 *   - ALL import forms ARE detected:
 *       import 'module'
 *       import type 'module'
 *       import Foo from 'module'
 *       import type { Foo } from 'module'
 *       import { Foo } from 'module'
 *       export { Foo } from 'module'
 *       export type { Foo } from 'module'
 *       export * from 'module'
 *       require('module')
 *       import('module')
 */

import * as ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ImportHit {
  readonly file: string
  readonly line: number
  readonly specifier: string
  readonly kind: string
}

/**
 * List all .ts/.tsx source files under rootDir recursively.
 */
export function listSourceFiles(rootDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue
        walk(full)
      } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
        out.push(full)
      }
    }
  }
  walk(rootDir)
  return out
}

/**
 * Parse a source file with the TypeScript compiler and extract all module
 * specifiers from import/export/require nodes.
 *
 * Returns an array of ImportHit objects, each containing the file path,
 * line number, module specifier, and the kind of import (for debugging).
 */
export function extractImports(filePath: string): ImportHit[] {
  const text = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const hits: ImportHit[] = []

  const visit = (node: ts.Node): void => {
    // ── import declarations ──
    // import 'module'
    // import type 'module'
    // import Foo from 'module'
    // import type { Foo } from 'module'
    // import { Foo } from 'module'
    if (ts.isImportDeclaration(node)) {
      const specifier = getModuleSpecifier(node.moduleSpecifier)
      if (specifier !== null) {
        hits.push({
          file: filePath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          specifier,
          kind: 'import',
        })
      }
    }

    // ── export declarations with a module specifier ──
    // export { Foo } from 'module'
    // export type { Foo } from 'module'
    // export * from 'module'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = getModuleSpecifier(node.moduleSpecifier)
      if (specifier !== null) {
        hits.push({
          file: filePath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          specifier,
          kind: 'export',
        })
      }
    }

    // ── require('module') calls ──
    // import('module') calls (dynamic import — parsed as CallExpression
    // where the expression is an ImportKeyword, not an Identifier)
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      let fn: string | null = null

      // require('module') — expression is an Identifier with text "require"
      if (expr.kind === ts.SyntaxKind.Identifier) {
        const text = (expr as ts.Identifier).text
        if (text === 'require') fn = 'require'
      }

      // import('module') — expression is an ImportKeyword (dynamic import)
      if (expr.kind === ts.SyntaxKind.ImportKeyword) {
        fn = 'import'
      }

      if (fn !== null) {
        const arg = node.arguments[0]
        if (arg && ts.isStringLiteral(arg)) {
          hits.push({
            file: filePath,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            specifier: arg.text,
            kind: fn,
          })
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return hits
}

function getModuleSpecifier(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr)) {
    return expr.text
  }
  return null
}

/**
 * Scan all source files under rootDir and return imports matching the
 * forbidden patterns.
 *
 * @param rootDir — the directory to scan recursively
 * @param forbidden — array of strings (exact match or prefix) or regexes
 * @returns array of ImportHit objects for matching imports
 */
export function scanForForbiddenImports(
  rootDir: string,
  forbidden: Array<string | RegExp>,
): ImportHit[] {
  const hits: ImportHit[] = []
  for (const file of listSourceFiles(rootDir)) {
    const imports = extractImports(file)
    for (const imp of imports) {
      for (const f of forbidden) {
        const isHit =
          typeof f === 'string'
            ? imp.specifier === f || imp.specifier.startsWith(f + '/')
            : f.test(imp.specifier)
        if (isHit) {
          hits.push(imp)
        }
      }
    }
  }
  return hits
}

/**
 * Scan all source files under rootDir and return imports matching the
 * allowed patterns (positive verification).
 *
 * @param rootDir — the directory to scan recursively
 * @param allowed — array of strings (exact match or prefix) or regexes
 * @returns array of ImportHit objects for matching imports
 */
export function scanForAllowedImports(
  rootDir: string,
  allowed: Array<string | RegExp>,
): ImportHit[] {
  return scanForForbiddenImports(rootDir, allowed)
}

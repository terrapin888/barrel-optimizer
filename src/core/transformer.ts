/**
 * Barrel Optimizer - Transformer Module
 *
 * This module implements the AST transformation logic using @swc/core.
 * It rewrites barrel imports to direct file imports for better tree-shaking.
 *
 * Key Design Decisions:
 * 1. Uses SWC for fast AST parsing and code generation
 * 2. Implements bail-out strategy for namespace imports (import * as)
 * 3. Supports alias handling (import { Foo as Bar })
 * 4. Uses atomic replacement (split single import into multiple)
 */

import { parseSync, printSync } from "@swc/core";
import type { Module, ImportDeclaration, ModuleItem } from "@swc/core";
import type { ImportMap } from "./analyzer.js";

/**
 * Configuration for the transformer.
 */
export interface TransformConfig {
  /** The ImportMap from the analyzer (maps export names to file paths) */
  importMap: ImportMap;
  /** Target library names to optimize (e.g., ['@toss/ui', '@toss/utils']) */
  targetLibraries: string[];
  /** Base path for converting absolute paths to relative (usually project root) */
  basePath?: string;
  /** Whether to preserve the original source location info */
  preserveSourceMap?: boolean;
}

/**
 * Result of a transformation.
 */
export interface TransformResult {
  /** The transformed code */
  code: string;
  /** Whether any transformations were applied */
  transformed: boolean;
  /** List of imports that were skipped (with reasons) */
  skipped: Array<{ source: string; reason: string }>;
  /** List of imports that were transformed */
  optimized: Array<{ original: string; rewrites: string[] }>;
}

/**
 * Logger interface for bail-out warnings and debug info.
 */
interface Logger {
  warn: (message: string) => void;
  debug: (message: string) => void;
}

const defaultLogger: Logger = {
  warn: (msg) => console.warn(`[Transformer] ${msg}`),
  debug: (msg) => console.debug(`[Transformer] ${msg}`),
};

/**
 * Checks if an import declaration contains a namespace specifier (import * as X).
 */
function hasNamespaceSpecifier(node: ImportDeclaration): boolean {
  return node.specifiers.some(
    (specifier) => specifier.type === "ImportNamespaceSpecifier"
  );
}

/**
 * Checks if an import declaration has a default import (import Foo from ...).
 */
function hasDefaultSpecifier(node: ImportDeclaration): boolean {
  return node.specifiers.some(
    (specifier) => specifier.type === "ImportDefaultSpecifier"
  );
}

/**
 * Extracts named import specifiers from an import declaration.
 * Returns only the named imports (not default or namespace).
 */
function getNamedSpecifiers(
  node: ImportDeclaration
): Array<{ imported: string; local: string }> {
  const result: Array<{ imported: string; local: string }> = [];

  for (const specifier of node.specifiers) {
    if (specifier.type === "ImportSpecifier") {
      // Type assertion since we know it's ImportSpecifier
      const spec = specifier as {
        type: "ImportSpecifier";
        local: { value: string };
        imported?: { type: string; value: string } | null;
      };

      const local = spec.local.value;
      const imported = spec.imported?.value ?? local;

      result.push({ imported, local });
    }
  }

  return result;
}

/**
 * Creates an ImportDeclaration AST node with a default import.
 */
function createDefaultImport(localName: string, source: string): ImportDeclaration {
  return {
    type: "ImportDeclaration",
    span: { start: 0, end: 0, ctxt: 0 },
    specifiers: [
      {
        type: "ImportDefaultSpecifier",
        span: { start: 0, end: 0, ctxt: 0 },
        local: {
          type: "Identifier",
          span: { start: 0, end: 0, ctxt: 0 },
          value: localName,
          optional: false,
          ctxt: 0,
        },
      },
    ],
    source: {
      type: "StringLiteral",
      span: { start: 0, end: 0, ctxt: 0 },
      value: source,
      raw: `"${source}"`,
    },
    typeOnly: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Creates a named import declaration (import { X } from '...').
 * Used when we can't convert to default import.
 */
function createNamedImport(
  imported: string,
  local: string,
  source: string
): ImportDeclaration {
  return {
    type: "ImportDeclaration",
    span: { start: 0, end: 0, ctxt: 0 },
    specifiers: [
      {
        type: "ImportSpecifier",
        span: { start: 0, end: 0, ctxt: 0 },
        local: {
          type: "Identifier",
          span: { start: 0, end: 0, ctxt: 0 },
          value: local,
          optional: false,
          ctxt: 0,
        },
        imported:
          imported !== local
            ? {
                type: "Identifier",
                span: { start: 0, end: 0, ctxt: 0 },
                value: imported,
                optional: false,
                ctxt: 0,
              }
            : undefined,
        isTypeOnly: false,
      },
    ],
    source: {
      type: "StringLiteral",
      span: { start: 0, end: 0, ctxt: 0 },
      value: source,
      raw: `"${source}"`,
    },
    typeOnly: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Transforms a single ImportDeclaration node.
 * Returns an array of new ImportDeclaration nodes (atomic split).
 *
 * @param node - The original ImportDeclaration
 * @param config - Transformer configuration
 * @param logger - Logger for warnings
 * @returns Array of transformed ImportDeclarations, or null if no transformation
 */
function transformImportDeclaration(
  node: ImportDeclaration,
  config: TransformConfig,
  logger: Logger,
  result: TransformResult
): ImportDeclaration[] | null {
  const source = node.source.value;

  // Check if this import is from a target library
  const isTargetLibrary = config.targetLibraries.some(
    (lib) => source === lib || source.startsWith(`${lib}/`)
  );

  if (!isTargetLibrary) {
    return null; // Not our target, leave unchanged
  }

  // BAIL-OUT: Namespace imports (import * as X from '...')
  // We cannot optimize these because we don't know which exports are used
  if (hasNamespaceSpecifier(node)) {
    logger.warn(
      `Skipping namespace import: import * as ... from '${source}'. ` +
        `Namespace imports cannot be optimized for tree-shaking.`
    );
    result.skipped.push({
      source,
      reason: "Namespace import (import * as) detected",
    });
    return null;
  }

  // BAIL-OUT: If there are no specifiers (side-effect import: import '...')
  if (node.specifiers.length === 0) {
    logger.debug(`Skipping side-effect import: import '${source}'`);
    result.skipped.push({
      source,
      reason: "Side-effect import (no specifiers)",
    });
    return null;
  }

  // Get named specifiers (the ones we can optimize)
  const namedSpecifiers = getNamedSpecifiers(node);

  // If there are no named specifiers (only default import), skip
  if (namedSpecifiers.length === 0) {
    logger.debug(
      `Skipping import with no named specifiers: import from '${source}'`
    );
    return null;
  }

  const newImports: ImportDeclaration[] = [];
  const optimizedRewrites: string[] = [];

  // Track if we have a default import that needs to be preserved
  const hasDefault = hasDefaultSpecifier(node);
  if (hasDefault) {
    // Preserve the default import as-is
    const defaultSpec = node.specifiers.find(
      (s) => s.type === "ImportDefaultSpecifier"
    );
    if (defaultSpec) {
      newImports.push({
        type: "ImportDeclaration",
        span: { start: 0, end: 0, ctxt: 0 },
        specifiers: [defaultSpec],
        source: node.source,
        typeOnly: node.typeOnly,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }

  // Transform each named import to a direct file import
  for (const { imported, local } of namedSpecifiers) {
    const resolvedPath = config.importMap.get(imported);

    if (!resolvedPath) {
      // Export not found in ImportMap
      // This could be a type-only export or an export we missed
      logger.warn(
        `Could not resolve '${imported}' from '${source}'. ` +
          `Keeping original import.`
      );

      // Create a named import to the original source for unresolved imports
      newImports.push(createNamedImport(imported, local, source));
      continue;
    }

    // Create the optimized import path
    // Convert Windows paths to forward slashes
    const importPath = resolvedPath.replace(/\\/g, "/");

    // Create a default import with the local name (handles aliases)
    // import { Button as TossBtn } → import TossBtn from '...'
    newImports.push(createDefaultImport(local, importPath));
    optimizedRewrites.push(`${imported} → ${importPath}`);
  }

  // Only report as optimized if we actually transformed something
  if (optimizedRewrites.length > 0) {
    result.optimized.push({
      original: source,
      rewrites: optimizedRewrites,
    });
    result.transformed = true;
  }

  return newImports;
}

/**
 * Main transformation function.
 * Parses the code, transforms imports, and returns the result.
 *
 * @param code - The source code to transform
 * @param importMap - Map of export names to file paths
 * @param targetLibraries - Libraries to optimize (defaults to all keys in importMap's paths)
 * @param options - Additional options
 * @returns TransformResult with transformed code and metadata
 */
export function transformCode(
  code: string,
  importMap: ImportMap,
  targetLibraries?: string[],
  options?: {
    filename?: string;
    logger?: Logger;
  }
): TransformResult {
  const logger = options?.logger ?? defaultLogger;
  const filename = options?.filename ?? "input.ts";

  // Infer target libraries from importMap if not provided
  const targets = targetLibraries ?? inferTargetLibraries(importMap);

  const result: TransformResult = {
    code,
    transformed: false,
    skipped: [],
    optimized: [],
  };

  const config: TransformConfig = {
    importMap,
    targetLibraries: targets,
  };

  // Parse the code into an AST
  let ast: Module;
  try {
    ast = parseSync(code, {
      syntax: "typescript",
      tsx: filename.endsWith(".tsx"),
      decorators: true,
    });
  } catch (error) {
    logger.warn(`Failed to parse ${filename}: ${error}`);
    return result;
  }

  // Transform the module body
  const newBody: ModuleItem[] = [];
  let hasChanges = false;

  for (const item of ast.body) {
    if (item.type === "ImportDeclaration") {
      const transformed = transformImportDeclaration(
        item,
        config,
        logger,
        result
      );

      if (transformed !== null) {
        // Replace the original import with the transformed imports
        newBody.push(...transformed);
        hasChanges = true;
      } else {
        // Keep the original import
        newBody.push(item);
      }
    } else {
      // Non-import statements pass through unchanged
      newBody.push(item);
    }
  }

  if (!hasChanges) {
    return result;
  }

  // Update the AST with the new body
  ast.body = newBody;

  // Print the transformed AST back to code
  try {
    const output = printSync(ast, {
      minify: false,
    });
    result.code = output.code;
    result.transformed = true;
  } catch (error) {
    logger.warn(`Failed to print transformed code: ${error}`);
    return { ...result, transformed: false };
  }

  return result;
}

/**
 * Infers target libraries from the ImportMap by extracting common prefixes.
 * This is used when targetLibraries is not explicitly provided.
 */
function inferTargetLibraries(importMap: ImportMap): string[] {
  const libraries = new Set<string>();

  for (const filePath of importMap.values()) {
    // Extract library name from node_modules path
    // e.g., /path/to/node_modules/@toss/ui/dist/Button.js → @toss/ui
    const nodeModulesMatch = filePath.match(
      /node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)/
    );

    if (nodeModulesMatch?.[1]) {
      libraries.add(nodeModulesMatch[1].replace(/\\/g, "/"));
    }
  }

  return Array.from(libraries);
}

/**
 * Transforms multiple files in parallel.
 * Useful for batch processing.
 *
 * @param files - Map of filename to source code
 * @param importMap - The ImportMap from analyzer
 * @param targetLibraries - Libraries to optimize
 * @returns Map of filename to TransformResult
 */
export async function transformFiles(
  files: Map<string, string>,
  importMap: ImportMap,
  targetLibraries?: string[]
): Promise<Map<string, TransformResult>> {
  const results = new Map<string, TransformResult>();

  // Process files in parallel
  const entries = Array.from(files.entries());
  const transformedEntries = await Promise.all(
    entries.map(async ([filename, code]) => {
      const result = transformCode(code, importMap, targetLibraries, {
        filename,
      });
      return [filename, result] as const;
    })
  );

  for (const [filename, transformedResult] of transformedEntries) {
    results.set(filename, transformedResult);
  }

  return results;
}

/**
 * Creates a transform function with a pre-configured ImportMap.
 * Useful for creating a reusable transformer for a specific library.
 *
 * @param importMap - The ImportMap from analyzer
 * @param targetLibraries - Libraries to optimize
 * @returns A transform function that only requires source code
 */
export function createTransformer(
  importMap: ImportMap,
  targetLibraries?: string[]
): (code: string, filename?: string) => TransformResult {
  return (code: string, filename?: string) => {
    const options = filename ? { filename } : undefined;
    return transformCode(code, importMap, targetLibraries, options);
  };
}

/**
 * Barrel Optimizer - Analyzer Module
 *
 * This module implements the core path discovery logic for the barrel file optimizer.
 * It uses DFS (Depth-First Search) to traverse export chains and build an ImportMap
 * that maps exported identifiers to their actual file paths.
 *
 * Key Design Decisions:
 * 1. Uses es-module-lexer for fast, non-AST parsing of exports
 * 2. Implements cycle detection via a visited set to handle circular dependencies
 * 3. Supports multiple file extensions (.js, .ts, .mjs, .cjs, .tsx, .jsx)
 */

import { init, parse } from "es-module-lexer";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * ImportMap: Maps exported identifier names to their resolved file paths.
 * Example: { "Button": "/absolute/path/to/Button.js" }
 */
export type ImportMap = Map<string, string>;

/**
 * Supported file extensions for module resolution.
 * Order matters: we try each extension in sequence until a file is found.
 */
const SUPPORTED_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];

/**
 * Index file names to try when resolving directory imports.
 */
const INDEX_FILES = ["index.js", "index.mjs", "index.ts", "index.tsx"];

/**
 * Resolves a module specifier to an actual file path.
 * Handles cases where extensions are omitted in import statements.
 *
 * @param basePath - The directory containing the importing file
 * @param specifier - The module specifier (e.g., './Button' or './utils/index')
 * @returns The resolved absolute file path, or null if not found
 */
async function resolveModulePath(
  basePath: string,
  specifier: string
): Promise<string | null> {
  // Handle relative specifiers only (we don't resolve bare specifiers here)
  if (!specifier.startsWith(".")) {
    return null;
  }

  const absolutePath = path.resolve(basePath, specifier);

  // 1. Try the path as-is (if it already has an extension)
  if (await fileExists(absolutePath)) {
    return absolutePath;
  }

  // 2. Try appending each supported extension
  for (const ext of SUPPORTED_EXTENSIONS) {
    const pathWithExt = absolutePath + ext;
    if (await fileExists(pathWithExt)) {
      return pathWithExt;
    }
  }

  // 3. Try as a directory with index file
  for (const indexFile of INDEX_FILES) {
    const indexPath = path.join(absolutePath, indexFile);
    if (await fileExists(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

/**
 * Checks if a file exists and is a regular file (not a directory).
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively resolves a conditional export value to a string path.
 * Handles deeply nested conditional exports like:
 * { "import": { "types": "...", "default": "..." } }
 *
 * @param value - The export value to resolve
 * @returns The resolved string path, or undefined if not found
 */
function resolveConditionalExport(value: unknown): string | undefined {
  // Direct string value
  if (typeof value === "string") {
    return value;
  }

  // Object with conditional exports
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;

    // Priority order for conditional exports (ESM-first)
    const priorities = ["import", "module", "default", "require", "node"];

    for (const key of priorities) {
      if (key in obj) {
        const resolved = resolveConditionalExport(obj[key]);
        if (resolved) {
          return resolved;
        }
      }
    }

    // If none of the priority keys found, try to find any string value
    for (const key of Object.keys(obj)) {
      // Skip "types" as it's TypeScript declaration files
      if (key === "types") continue;

      const resolved = resolveConditionalExport(obj[key]);
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

/**
 * Reads the package.json of a library and resolves its entry point.
 *
 * @param libraryName - The name of the npm package
 * @param rootPath - The root path to search from (usually project root)
 * @returns The absolute path to the library's entry point
 */
async function resolveLibraryEntryPoint(
  libraryName: string,
  rootPath: string
): Promise<string> {
  const nodeModulesPath = path.join(rootPath, "node_modules", libraryName);
  const packageJsonPath = path.join(nodeModulesPath, "package.json");

  let packageJson: {
    main?: string;
    module?: string;
    exports?: Record<string, unknown> | string;
  };

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    throw new Error(
      `Failed to read package.json for library: ${libraryName} at ${packageJsonPath}`
    );
  }

  // Priority: module > main > index.js (ESM-first approach)
  // The 'module' field typically points to ES modules, which is what we want
  let entryPoint: string | undefined;

  // Handle "exports" field (modern packages)
  if (packageJson.exports) {
    const exportsField = packageJson.exports;

    // Handle string exports: "exports": "./dist/index.js"
    if (typeof exportsField === "string") {
      entryPoint = exportsField;
    }
    // Handle object exports with "." entry point
    else if (typeof exportsField === "object" && exportsField !== null) {
      const rootExport = exportsField["."];

      // Recursively resolve the conditional export
      entryPoint = resolveConditionalExport(rootExport);
    }
  }

  // Fallback to module/main fields
  entryPoint ??= packageJson.module ?? packageJson.main ?? "index.js";

  const resolvedEntry = path.resolve(nodeModulesPath, entryPoint);

  // Verify the entry point exists
  if (!(await fileExists(resolvedEntry))) {
    throw new Error(
      `Entry point not found for library: ${libraryName} at ${resolvedEntry}`
    );
  }

  return resolvedEntry;
}

/**
 * Parses a module file and extracts its exports using es-module-lexer.
 * This is much faster than full AST parsing.
 *
 * @param filePath - Absolute path to the module file
 * @returns Object containing named exports and re-export sources
 */
interface ParsedExports {
  /** Direct named exports: export { Foo } or export const Foo = ... */
  namedExports: string[];
  /** Re-exports with source: export { Foo } from './foo' */
  reExports: Array<{ names: string[]; source: string }>;
  /** Star re-exports: export * from './bar' */
  starReExports: string[];
}

async function parseModuleExports(filePath: string): Promise<ParsedExports> {
  const content = await fs.readFile(filePath, "utf-8");

  // es-module-lexer returns [imports, exports]
  const [, exports] = parse(content);

  const namedExports: string[] = [];
  const reExports: Array<{ names: string[]; source: string }> = [];
  const starReExports: string[] = [];

  for (const exp of exports) {
    // exp.n is the exported name
    // exp.ln is the local name (for re-exports, this is the original name)
    // For star exports, n is null in some cases

    if (exp.n === null) {
      // This typically indicates `export * from '...'`
      // We need to check the source file content to get the source path
      continue;
    }

    namedExports.push(exp.n);
  }

  // es-module-lexer doesn't directly give us re-export sources in a clean way
  // We need to do a regex-based extraction for re-exports
  // This is still faster than full AST parsing

  // Match: export { ... } from '...' or export { ... } from "..."
  const reExportRegex =
    /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = reExportRegex.exec(content)) !== null) {
    const namesStr = match[1];
    const source = match[2];

    if (!namesStr || !source) continue;

    // Parse the names: "Foo, Bar as Baz, Qux"
    const names = namesStr.split(",").map((name) => {
      const trimmed = name.trim();
      // Handle "Foo as Bar" - we want the exported name (Bar)
      const asMatch = trimmed.match(/(\w+)\s+as\s+(\w+)/);
      if (asMatch?.[2]) {
        return asMatch[2]; // Return the aliased name
      }
      return trimmed;
    }).filter((n): n is string => Boolean(n));

    reExports.push({ names, source });
  }

  // Match: export * from '...' or export * from "..."
  const starReExportRegex = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;

  while ((match = starReExportRegex.exec(content)) !== null) {
    const source = match[1];
    if (source) {
      starReExports.push(source);
    }
  }

  return { namedExports, reExports, starReExports };
}

/**
 * DFS Context: Tracks state during the recursive traversal.
 */
interface DFSContext {
  /** The ImportMap being built */
  importMap: ImportMap;
  /** Set of visited file paths to prevent infinite loops (circular dependency handling) */
  visited: Set<string>;
  /** Root path of the project (for resolving node_modules) */
  rootPath: string;
  /** Name of the library being analyzed */
  libraryName: string;
}

/**
 * Performs DFS traversal of a module's export chain.
 *
 * Algorithm:
 * 1. Check if we've already visited this file (cycle detection)
 * 2. Mark the file as visited
 * 3. Parse the file's exports
 * 4. For each named export, add to ImportMap
 * 5. For each re-export, recursively analyze the source
 * 6. For each star re-export, recursively analyze and merge all exports
 *
 * @param filePath - The current file being analyzed
 * @param ctx - The DFS context containing state
 */
async function dfsAnalyze(filePath: string, ctx: DFSContext): Promise<void> {
  // Normalize the path to ensure consistent comparison
  const normalizedPath = path.normalize(filePath);

  // CYCLE DETECTION: If we've already visited this file, bail out.
  // This prevents infinite loops when modules have circular dependencies.
  // Example: A exports from B, B exports from A
  if (ctx.visited.has(normalizedPath)) {
    return;
  }

  // Mark as visited BEFORE processing to handle cycles correctly
  ctx.visited.add(normalizedPath);

  let parsedExports: ParsedExports;

  try {
    parsedExports = await parseModuleExports(normalizedPath);
  } catch (error) {
    // If we can't parse a file, log a warning and continue
    // This allows the analyzer to be resilient to edge cases
    console.warn(`[Analyzer] Failed to parse ${normalizedPath}:`, error);
    return;
  }

  const currentDir = path.dirname(normalizedPath);

  // Process re-exports: export { Foo } from './foo'
  // These map the exported name to the source file's path
  for (const reExport of parsedExports.reExports) {
    const resolvedSource = await resolveModulePath(currentDir, reExport.source);

    if (resolvedSource) {
      // For each named re-export, we can directly map to the source file
      for (const name of reExport.names) {
        // Only set if not already mapped (first definition wins)
        // This handles cases where the same export might appear multiple times
        if (!ctx.importMap.has(name)) {
          ctx.importMap.set(name, resolvedSource);
        }
      }

      // Recursively analyze the source file to discover nested re-exports
      await dfsAnalyze(resolvedSource, ctx);
    }
  }

  // Process star re-exports: export * from './bar'
  // We need to recursively analyze and merge ALL exports from the source
  for (const starSource of parsedExports.starReExports) {
    const resolvedSource = await resolveModulePath(currentDir, starSource);

    if (resolvedSource) {
      // Create a temporary context to collect exports from the star source
      const tempMap: ImportMap = new Map();
      const tempCtx: DFSContext = {
        importMap: tempMap,
        visited: ctx.visited, // Share visited set to maintain cycle detection
        rootPath: ctx.rootPath,
        libraryName: ctx.libraryName,
      };

      // Recursively analyze the star source
      await dfsAnalyze(resolvedSource, tempCtx);

      // Merge collected exports into main ImportMap
      // For star exports, the resolved path should be the star source file itself
      // because that's where the actual export lives
      for (const [name] of tempMap) {
        if (!ctx.importMap.has(name)) {
          // For star re-exports, we map to the file where the export originates
          ctx.importMap.set(name, tempMap.get(name)!);
        }
      }

      // Also need to check if the star source itself has direct exports
      try {
        const starParsed = await parseModuleExports(resolvedSource);
        for (const name of starParsed.namedExports) {
          if (!ctx.importMap.has(name)) {
            ctx.importMap.set(name, resolvedSource);
          }
        }
      } catch {
        // Ignore parse errors for star sources
      }
    }
  }

  // Process direct named exports from this file
  // These are exports defined in the current file itself
  for (const name of parsedExports.namedExports) {
    // Check if this name was already mapped by a re-export
    // Re-exports take precedence because they point to the actual source
    if (!ctx.importMap.has(name)) {
      ctx.importMap.set(name, normalizedPath);
    }
  }
}

/**
 * Analyzes a library and builds an ImportMap of all its exports.
 *
 * This is the main entry point for the analyzer. It:
 * 1. Resolves the library's entry point from package.json
 * 2. Initializes es-module-lexer
 * 3. Performs DFS traversal of the export chain
 * 4. Returns a map of export names to their source file paths
 *
 * @param libraryName - The npm package name (e.g., '@toss/ui')
 * @param rootPath - The project root path containing node_modules
 * @returns ImportMap mapping export names to absolute file paths
 *
 * @example
 * const importMap = await analyzeLibrary('@toss/ui', '/path/to/project');
 * // importMap: Map { "Button" => "/path/to/node_modules/@toss/ui/dist/Button.js" }
 */
export async function analyzeLibrary(
  libraryName: string,
  rootPath: string
): Promise<ImportMap> {
  // Initialize es-module-lexer (must be called before parsing)
  await init;

  // Resolve the library's entry point
  const entryPoint = await resolveLibraryEntryPoint(libraryName, rootPath);

  // Initialize DFS context
  const ctx: DFSContext = {
    importMap: new Map(),
    visited: new Set(), // Prevents infinite loops from circular dependencies
    rootPath,
    libraryName,
  };

  // Start DFS from the entry point
  await dfsAnalyze(entryPoint, ctx);

  return ctx.importMap;
}

/**
 * Analyzes multiple libraries in parallel and merges their ImportMaps.
 * Useful for optimizing imports from multiple packages at once.
 *
 * @param libraryNames - Array of npm package names
 * @param rootPath - The project root path containing node_modules
 * @returns Merged ImportMap with library name prefixes to avoid collisions
 *
 * @example
 * const importMap = await analyzeLibraries(['@toss/ui', '@toss/utils'], '/path/to/project');
 */
export async function analyzeLibraries(
  libraryNames: string[],
  rootPath: string
): Promise<Map<string, ImportMap>> {
  const results = await Promise.all(
    libraryNames.map(async (name) => {
      const importMap = await analyzeLibrary(name, rootPath);
      return [name, importMap] as const;
    })
  );

  return new Map(results);
}

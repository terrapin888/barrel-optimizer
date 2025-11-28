#!/usr/bin/env node
/**
 * Barrel Optimizer - CLI Entry Point
 *
 * A zero-overhead barrel file optimizer for better tree-shaking.
 * This CLI tool analyzes libraries and transforms imports to direct file paths.
 *
 * Usage:
 *   barrel-optimizer optimize <file|directory> --library <lib-name>
 *   barrel-optimizer analyze <library-name>
 */

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { analyzeLibrary, type ImportMap } from "../core/analyzer";
import { transformCode, type TransformResult } from "../core/transformer";

// Package version (will be replaced during build)
const VERSION = "1.0.0";

/**
 * CLI Logger with chalk styling
 */
const log = {
  info: (msg: string) => console.log(chalk.blue("ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("✓"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.log(chalk.red("✖"), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),

  // Styled headers
  header: (msg: string) => {
    console.log();
    console.log(chalk.bold.cyan("═".repeat(60)));
    console.log(chalk.bold.cyan(`  ${msg}`));
    console.log(chalk.bold.cyan("═".repeat(60)));
    console.log();
  },

  // Stats display
  stat: (label: string, value: string | number) => {
    console.log(`  ${chalk.gray(label.padEnd(20))} ${chalk.white.bold(value)}`);
  },

  // Code block display
  code: (code: string, language = "typescript") => {
    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.gray(code));
    console.log(chalk.dim("─".repeat(50)));
  },
};

/**
 * Spinner for long-running operations
 */
class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private current = 0;
  private interval: NodeJS.Timeout | null = null;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    process.stdout.write(`${chalk.cyan(this.frames[0])} ${this.message}`);
    this.interval = setInterval(() => {
      this.current = (this.current + 1) % this.frames.length;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `${chalk.cyan(this.frames[this.current])} ${this.message}`
      );
    }, 80);
  }

  stop(success = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    if (success) {
      console.log(`${chalk.green("✓")} ${this.message}`);
    } else {
      console.log(`${chalk.red("✖")} ${this.message}`);
    }
  }
}

/**
 * Finds the nearest node_modules directory by traversing up from the given path.
 */
async function findNodeModules(startPath: string): Promise<string | null> {
  let currentPath = path.resolve(startPath);

  while (currentPath !== path.dirname(currentPath)) {
    const nodeModulesPath = path.join(currentPath, "node_modules");

    try {
      const stat = await fs.stat(nodeModulesPath);
      if (stat.isDirectory()) {
        return currentPath; // Return the project root, not node_modules itself
      }
    } catch {
      // Directory doesn't exist, continue traversing up
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

/**
 * Collects all TypeScript/JavaScript files from a directory recursively.
 */
async function collectFiles(
  dirPath: string,
  extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs"]
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules and hidden directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return files;
}

/**
 * Formats file size in human-readable format.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Analyze command: Inspects a library and displays its export map.
 */
async function analyzeCommand(
  libraryName: string,
  options: { cwd?: string }
): Promise<void> {
  log.header(`Analyzing: ${libraryName}`);

  const cwd = options.cwd ?? process.cwd();
  const projectRoot = await findNodeModules(cwd);

  if (!projectRoot) {
    log.error("Could not find node_modules directory.");
    log.dim("Make sure you're in a project with installed dependencies.");
    process.exit(1);
  }

  log.info(`Project root: ${chalk.dim(projectRoot)}`);

  const spinner = new Spinner(`Analyzing ${libraryName}...`);
  spinner.start();

  let importMap: ImportMap;
  const startTime = Date.now();

  try {
    importMap = await analyzeLibrary(libraryName, projectRoot);
    spinner.stop(true);
  } catch (error) {
    spinner.stop(false);
    log.error(`Failed to analyze library: ${error}`);
    process.exit(1);
  }

  const duration = Date.now() - startTime;

  console.log();
  log.success(
    `Found ${chalk.bold.green(importMap.size)} exports in ${duration}ms`
  );
  console.log();

  // Display exports grouped by file
  const byFile = new Map<string, string[]>();
  for (const [name, filePath] of importMap) {
    const existing = byFile.get(filePath) ?? [];
    existing.push(name);
    byFile.set(filePath, existing);
  }

  console.log(chalk.bold("Export Map:"));
  console.log();

  let fileCount = 0;
  for (const [filePath, exports] of byFile) {
    fileCount++;
    if (fileCount > 20) {
      log.dim(`  ... and ${byFile.size - 20} more files`);
      break;
    }

    // Shorten the path for display
    const shortPath = filePath.replace(projectRoot, "").replace(/^[/\\]/, "");
    console.log(`  ${chalk.cyan(shortPath)}`);
    console.log(`    ${chalk.gray("→")} ${exports.join(", ")}`);
  }

  console.log();
  log.stat("Total exports", importMap.size);
  log.stat("Source files", byFile.size);
  log.stat("Analysis time", `${duration}ms`);
  console.log();
}

/**
 * Optimize command: Transforms imports in source files.
 */
async function optimizeCommand(
  target: string,
  options: {
    library?: string[];
    write?: boolean;
    cwd?: string;
    verbose?: boolean;
  }
): Promise<void> {
  log.header("Barrel Optimizer");

  const cwd = options.cwd ?? process.cwd();
  const targetPath = path.resolve(cwd, target);

  // Check if target exists
  let targetStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    targetStat = await fs.stat(targetPath);
  } catch {
    log.error(`Target not found: ${targetPath}`);
    process.exit(1);
  }

  // Find project root (with node_modules)
  const projectRoot = await findNodeModules(targetPath);
  if (!projectRoot) {
    log.error("Could not find node_modules directory.");
    log.dim("Make sure you're in a project with installed dependencies.");
    process.exit(1);
  }

  log.info(`Project root: ${chalk.dim(projectRoot)}`);

  // Get libraries to analyze
  const libraries = options.library ?? ["@toss/ui"];
  log.info(`Target libraries: ${chalk.cyan(libraries.join(", "))}`);

  // Analyze libraries
  const mergedImportMap: ImportMap = new Map();
  const analyzeSpinner = new Spinner("Analyzing libraries...");
  analyzeSpinner.start();

  const analyzeStart = Date.now();
  try {
    for (const lib of libraries) {
      const libMap = await analyzeLibrary(lib, projectRoot);
      for (const [name, filePath] of libMap) {
        mergedImportMap.set(name, filePath);
      }
    }
    analyzeSpinner.stop(true);
  } catch (error) {
    analyzeSpinner.stop(false);
    log.error(`Failed to analyze libraries: ${error}`);
    process.exit(1);
  }

  log.success(
    `Discovered ${chalk.bold.green(mergedImportMap.size)} exports in ${Date.now() - analyzeStart}ms`
  );

  // Collect files to process
  let files: string[];
  if (targetStat.isDirectory()) {
    files = await collectFiles(targetPath);
    log.info(`Found ${chalk.cyan(files.length)} source files`);
  } else {
    files = [targetPath];
  }

  if (files.length === 0) {
    log.warn("No source files found to optimize.");
    return;
  }

  // Transform files
  console.log();
  const transformSpinner = new Spinner("Transforming imports...");
  transformSpinner.start();

  const results: Array<{
    file: string;
    result: TransformResult;
    originalSize: number;
  }> = [];

  const transformStart = Date.now();

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const result = transformCode(content, mergedImportMap, libraries, {
        filename: file,
        logger: {
          warn: () => {}, // Suppress warnings during batch processing
          debug: () => {},
        },
      });

      results.push({
        file,
        result,
        originalSize: content.length,
      });

      // Write back if requested and transformed
      if (options.write && result.transformed) {
        await fs.writeFile(file, result.code, "utf-8");
      }
    } catch (error) {
      log.warn(`Failed to process ${file}: ${error}`);
    }
  }

  transformSpinner.stop(true);

  const transformDuration = Date.now() - transformStart;

  // Display results
  console.log();
  log.header("Optimization Results");

  const transformedFiles = results.filter((r) => r.result.transformed);
  const skippedImports = results.flatMap((r) => r.result.skipped);
  const optimizedImports = results.flatMap((r) => r.result.optimized);

  // Show transformed files
  if (transformedFiles.length > 0) {
    console.log(chalk.bold.green("Transformed Files:"));
    console.log();

    for (const { file, result } of transformedFiles.slice(0, 10)) {
      const relativePath = path.relative(cwd, file);
      console.log(`  ${chalk.green("✓")} ${chalk.white(relativePath)}`);

      if (options.verbose) {
        for (const opt of result.optimized) {
          console.log(`    ${chalk.gray("└─")} ${opt.original}`);
          for (const rewrite of opt.rewrites) {
            console.log(`       ${chalk.dim(rewrite)}`);
          }
        }
      }
    }

    if (transformedFiles.length > 10) {
      log.dim(`  ... and ${transformedFiles.length - 10} more files`);
    }
    console.log();
  }

  // Show skipped imports (bail-outs)
  if (skippedImports.length > 0 && options.verbose) {
    console.log(chalk.bold.yellow("Skipped Imports (Bail-outs):"));
    console.log();

    for (const skip of skippedImports.slice(0, 5)) {
      console.log(`  ${chalk.yellow("⚠")} ${skip.source}`);
      console.log(`    ${chalk.dim(skip.reason)}`);
    }

    if (skippedImports.length > 5) {
      log.dim(`  ... and ${skippedImports.length - 5} more`);
    }
    console.log();
  }

  // Summary stats
  console.log(chalk.bold("Summary:"));
  console.log();
  log.stat("Files processed", files.length);
  log.stat("Files transformed", transformedFiles.length);
  log.stat("Imports optimized", optimizedImports.length);
  log.stat("Imports skipped", skippedImports.length);
  log.stat("Transform time", `${transformDuration}ms`);
  console.log();

  // Show sample output for single file
  if (!options.write && files.length === 1 && transformedFiles.length > 0) {
    console.log(chalk.bold("Transformed Code:"));
    log.code(transformedFiles[0].result.code);
  }

  if (!options.write && transformedFiles.length > 0) {
    console.log();
    log.info(
      `Run with ${chalk.cyan("--write")} to apply changes to files.`
    );
  }

  if (options.write && transformedFiles.length > 0) {
    log.success(
      `${transformedFiles.length} file(s) updated successfully!`
    );
  }
}

/**
 * Main CLI program
 */
const program = new Command();

program
  .name("barrel-optimizer")
  .description(
    chalk.bold("Zero-Overhead Barrel File Optimizer") +
      "\n" +
      chalk.dim("Optimize imports for better tree-shaking in large monorepos.")
  )
  .version(VERSION);

// Analyze command
program
  .command("analyze <library>")
  .description("Analyze a library and display its export map")
  .option("--cwd <path>", "Working directory", process.cwd())
  .action(analyzeCommand);

// Optimize command
program
  .command("optimize <target>")
  .description("Optimize imports in a file or directory")
  .option(
    "-l, --library <names...>",
    "Libraries to optimize",
    ["@toss/ui"]
  )
  .option("-w, --write", "Write changes to files", false)
  .option("--cwd <path>", "Working directory", process.cwd())
  .option("-v, --verbose", "Show detailed output", false)
  .action(optimizeCommand);

// Build command (alias for optimize with --write)
program
  .command("build <target>")
  .description("Alias for optimize --write")
  .option("-l, --library <names...>", "Libraries to optimize", ["@toss/ui"])
  .option("--cwd <path>", "Working directory", process.cwd())
  .option("-v, --verbose", "Show detailed output", false)
  .action((target, options) =>
    optimizeCommand(target, { ...options, write: true })
  );

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

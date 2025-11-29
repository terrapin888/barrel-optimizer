#!/usr/bin/env node
/**
 * Stress Test Benchmark for barrel-optimizer
 *
 * Simulates a massive monorepo environment to prove production readiness:
 * - 500 component library (@heavy/ui)
 * - 1,000 source files
 * - ~10,000 total imports
 *
 * Usage: node scripts/stress-benchmark.mjs
 */

import { analyzeLibrary } from "../dist/core/analyzer.js";
import { transformCode } from "../dist/core/transformer.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  benchmarkDir: path.resolve(__dirname, "../.benchmark_env"),
  libraryName: "@heavy/ui",
  componentCount: 500,      // Number of components in library
  sourceFileCount: 1000,    // Number of source files to transform
  importsPerFile: 10,       // Random imports per source file
};

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    heapUsed: used.heapUsed,
    heapTotal: used.heapTotal,
    rss: used.rss,
  };
}

function randomSample(array, count) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// ═══════════════════════════════════════════════════════════════════
// Environment Setup
// ═══════════════════════════════════════════════════════════════════

function setupBenchmarkEnvironment() {
  const { benchmarkDir, libraryName, componentCount, sourceFileCount, importsPerFile } = CONFIG;

  // Clean up existing
  if (fs.existsSync(benchmarkDir)) {
    fs.rmSync(benchmarkDir, { recursive: true, force: true });
  }

  // Create directories
  const libraryPath = path.join(benchmarkDir, "node_modules", libraryName);
  const distPath = path.join(libraryPath, "dist");
  const srcPath = path.join(benchmarkDir, "src");

  fs.mkdirSync(distPath, { recursive: true });
  fs.mkdirSync(srcPath, { recursive: true });

  // Step 1: Generate component files
  console.log(chalk.cyan(`\n📦 Generating ${componentCount} component files...`));

  const componentNames = [];
  for (let i = 0; i < componentCount; i++) {
    const name = `Comp${i}`;
    componentNames.push(name);

    const componentCode = `// ${name}.js - Auto-generated component
export function ${name}(props) {
  return { type: '${name}', props };
}
${name}.displayName = '${name}';

// Some extra code to simulate real component size
const styles = {
  container: { padding: '16px', margin: '8px' },
  button: { background: 'blue', color: 'white' },
};

export const ${name}Styles = styles;
`;
    fs.writeFileSync(path.join(distPath, `${name}.js`), componentCode);
  }

  // Step 2: Generate barrel file (index.js)
  console.log(chalk.cyan(`📄 Generating barrel file with ${componentCount} exports...`));

  const barrelExports = componentNames
    .map(name => `export { ${name} } from './dist/${name}.js';`)
    .join("\n");

  const barrelFile = `// @heavy/ui - Auto-generated barrel file
// ${componentCount} components exported

${barrelExports}
`;
  fs.writeFileSync(path.join(libraryPath, "index.js"), barrelFile);

  // Step 3: Generate package.json
  const packageJson = {
    name: libraryName,
    version: "1.0.0",
    main: "index.js",
    module: "index.js",
  };
  fs.writeFileSync(
    path.join(libraryPath, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  // Step 4: Generate source files
  console.log(chalk.cyan(`📝 Generating ${sourceFileCount} source files with ${importsPerFile} imports each...`));

  const sourceFiles = [];
  let totalImports = 0;

  for (let i = 0; i < sourceFileCount; i++) {
    const selectedComponents = randomSample(componentNames, importsPerFile);
    totalImports += selectedComponents.length;

    const imports = selectedComponents.join(", ");
    const usage = selectedComponents.map(c => `${c}({})`).join(",\n    ");

    const sourceCode = `// File${i}.ts - Auto-generated source file
import { ${imports} } from '${libraryName}';

export function Component${i}() {
  return [
    ${usage}
  ];
}
`;
    const filePath = path.join(srcPath, `File${i}.ts`);
    fs.writeFileSync(filePath, sourceCode);
    sourceFiles.push({ path: filePath, content: sourceCode });
  }

  console.log(chalk.green(`✓ Environment ready: ${totalImports} total imports generated\n`));

  return {
    benchmarkDir,
    libraryPath,
    srcPath,
    sourceFiles,
    componentCount,
    sourceFileCount,
    totalImports,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Benchmark Execution
// ═══════════════════════════════════════════════════════════════════

async function runBenchmark() {
  console.clear();
  console.log(chalk.bgMagenta.white.bold("                                                      "));
  console.log(chalk.bgMagenta.white.bold("   🏋️  BARREL OPTIMIZER - STRESS TEST BENCHMARK       "));
  console.log(chalk.bgMagenta.white.bold("                                                      "));

  // Setup
  const env = setupBenchmarkEnvironment();

  // Get initial memory
  global.gc?.(); // Force GC if available
  const memoryBefore = getMemoryUsage();

  // ─────────────────────────────────────────────────────────────────
  // Phase 1: Analyze Library
  // ─────────────────────────────────────────────────────────────────
  console.log(chalk.yellow("🔍 Phase 1: Analyzing library exports..."));

  const analyzeStart = performance.now();
  const importMap = await analyzeLibrary(CONFIG.libraryName, env.benchmarkDir);
  const analyzeEnd = performance.now();
  const analyzeTime = analyzeEnd - analyzeStart;

  console.log(chalk.green(`   ✓ Discovered ${importMap.size} exports in ${formatMs(analyzeTime)}`));

  // ─────────────────────────────────────────────────────────────────
  // Phase 2: Transform Source Files
  // ─────────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n⚡ Phase 2: Transforming source files..."));

  const transformStart = performance.now();

  let transformedCount = 0;
  let optimizedImports = 0;
  let skippedImports = 0;

  for (const file of env.sourceFiles) {
    const result = transformCode(file.content, importMap, [CONFIG.libraryName], {
      filename: file.path,
      logger: { warn: () => {}, debug: () => {} }, // Suppress logs
    });

    if (result.transformed) {
      transformedCount++;
    }
    optimizedImports += result.optimized.reduce((sum, o) => sum + o.rewrites.length, 0);
    skippedImports += result.skipped.length;
  }

  const transformEnd = performance.now();
  const transformTime = transformEnd - transformStart;

  console.log(chalk.green(`   ✓ Transformed ${transformedCount} files in ${formatMs(transformTime)}`));

  // Get final memory
  const memoryAfter = getMemoryUsage();
  const memoryUsed = memoryAfter.heapUsed - memoryBefore.heapUsed;

  // ─────────────────────────────────────────────────────────────────
  // Phase 3: Cleanup
  // ─────────────────────────────────────────────────────────────────
  console.log(chalk.yellow("\n🧹 Cleaning up benchmark environment..."));
  fs.rmSync(env.benchmarkDir, { recursive: true, force: true });
  console.log(chalk.green("   ✓ Cleanup complete"));

  // ═════════════════════════════════════════════════════════════════
  // Results
  // ═════════════════════════════════════════════════════════════════
  const totalTime = analyzeTime + transformTime;
  const avgTimePerFile = transformTime / env.sourceFileCount;
  const importsPerSecond = Math.round(optimizedImports / (transformTime / 1000));

  console.log("\n");
  console.log(chalk.bgCyan.black.bold("                                                                "));
  console.log(chalk.bgCyan.black.bold("   📊 BENCHMARK RESULTS                                         "));
  console.log(chalk.bgCyan.black.bold("                                                                "));
  console.log();

  // Environment Summary
  console.log(chalk.white.bold("  Environment:"));
  console.log(chalk.gray("  ────────────────────────────────────────────────────"));
  console.log(`  ${chalk.gray("Target Library:")}      ${chalk.cyan(CONFIG.libraryName)}`);
  console.log(`  ${chalk.gray("Library Exports:")}     ${chalk.cyan(env.componentCount)} components`);
  console.log(`  ${chalk.gray("Source Files:")}        ${chalk.cyan(env.sourceFileCount)} files`);
  console.log(`  ${chalk.gray("Total Imports:")}       ${chalk.cyan("~" + env.totalImports)} imports`);
  console.log();

  // Performance Metrics
  console.log(chalk.white.bold("  Performance:"));
  console.log(chalk.gray("  ────────────────────────────────────────────────────"));
  console.log(`  ${chalk.gray("🔍 Analysis Time:")}     ${chalk.green(formatMs(analyzeTime))}`);
  console.log(`  ${chalk.gray("⚡ Transform Time:")}    ${chalk.green(formatMs(transformTime))}`);
  console.log(`  ${chalk.gray("⏱️  Total Time:")}        ${chalk.green.bold(formatMs(totalTime))}`);
  console.log();

  // Derived Metrics
  console.log(chalk.white.bold("  Throughput:"));
  console.log(chalk.gray("  ────────────────────────────────────────────────────"));
  console.log(`  ${chalk.gray("Avg Time/File:")}       ${chalk.yellow(formatMs(avgTimePerFile))}`);
  console.log(`  ${chalk.gray("Imports/Second:")}      ${chalk.yellow(importsPerSecond.toLocaleString())}`);
  console.log(`  ${chalk.gray("Files Transformed:")}   ${chalk.yellow(transformedCount)}/${env.sourceFileCount}`);
  console.log(`  ${chalk.gray("Imports Optimized:")}   ${chalk.yellow(optimizedImports.toLocaleString())}`);
  console.log();

  // Memory
  console.log(chalk.white.bold("  Memory:"));
  console.log(chalk.gray("  ────────────────────────────────────────────────────"));
  console.log(`  ${chalk.gray("Heap Used:")}           ${chalk.blue(formatBytes(memoryAfter.heapUsed))}`);
  console.log(`  ${chalk.gray("Heap Total:")}          ${chalk.blue(formatBytes(memoryAfter.heapTotal))}`);
  console.log(`  ${chalk.gray("RSS:")}                 ${chalk.blue(formatBytes(memoryAfter.rss))}`);
  console.log();

  // Verdict
  console.log(chalk.gray("  ════════════════════════════════════════════════════"));
  console.log();

  if (totalTime < 1000) {
    console.log(chalk.bgGreen.black.bold("  ✅ EXCELLENT: Sub-second performance for 1000 files!  "));
  } else if (totalTime < 5000) {
    console.log(chalk.bgYellow.black.bold("  ⚠️  GOOD: Performance within acceptable range         "));
  } else {
    console.log(chalk.bgRed.white.bold("  ❌ NEEDS OPTIMIZATION: Performance exceeds 5 seconds  "));
  }

  console.log();
  console.log(chalk.gray("  Benchmark completed at: " + new Date().toISOString()));
  console.log();

  // Return results for programmatic use
  return {
    analyzeTime,
    transformTime,
    totalTime,
    avgTimePerFile,
    importsPerSecond,
    memoryUsed: memoryAfter.heapUsed,
    filesTransformed: transformedCount,
    importsOptimized: optimizedImports,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

runBenchmark().catch((error) => {
  console.error(chalk.red("\n❌ Benchmark failed:"), error);
  process.exit(1);
});

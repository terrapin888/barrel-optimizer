#!/usr/bin/env node
/**
 * Real-World Verification Script
 *
 * Proves barrel-optimizer works on BOTH Legacy Toss ecosystem and Modern packages:
 *
 * Group A: Legacy Slash (@toss/*)
 *   - @toss/utils, @toss/hooks, @toss/date
 *
 * Group B: Modern Toss Stack
 *   - es-toolkit, es-hangul, suspensive
 *
 * Group C: Third Party Heavyweight
 *   - @mui/material
 *
 * Usage: node scripts/verify-real-world.mjs
 */

import { execSync } from "node:child_process";
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
  tempDir: path.resolve(__dirname, "../.real_world_temp"),
  categories: [
    {
      name: "Legacy (@toss)",
      description: "Legacy Slash libraries - still widely used",
      libraries: [
        { name: "@toss/utils", description: "Toss utility functions" },
        { name: "@toss/react", description: "Toss React utilities" },
        { name: "@toss/react-query", description: "Toss React Query helpers" },
      ],
    },
    {
      name: "Modern (New)",
      description: "Modern Toss Stack - the future",
      libraries: [
        { name: "es-toolkit", description: "High performance utility" },
        { name: "es-hangul", description: "Modern Hangul library" },
        { name: "@suspensive/react", description: "React Suspense handling" },
      ],
    },
    {
      name: "Benchmark",
      description: "Third Party Heavyweight",
      libraries: [
        { name: "@mui/material", description: "Material UI (massive barrel)" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════

function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function printHeader(text) {
  console.log();
  console.log(chalk.bgCyan.black.bold("                                                                            "));
  console.log(chalk.bgCyan.black.bold(`   ${text.padEnd(72)} `));
  console.log(chalk.bgCyan.black.bold("                                                                            "));
  console.log();
}

function printStep(step, text) {
  console.log(chalk.cyan(`[${step}]`) + " " + chalk.white(text));
}

function printSuccess(text) {
  console.log(chalk.green("    ✓ ") + chalk.white(text));
}

function printError(text) {
  console.log(chalk.red("    ✗ ") + chalk.white(text));
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Setup
// ═══════════════════════════════════════════════════════════════════

function setupPhase() {
  printStep("1/3", "Setting up temporary environment...");

  // Clean up existing temp directory
  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
  }

  // Create temp directory
  fs.mkdirSync(CONFIG.tempDir, { recursive: true });

  // Create minimal package.json
  const packageJson = {
    name: "barrel-optimizer-verification",
    version: "1.0.0",
    private: true,
  };
  fs.writeFileSync(
    path.join(CONFIG.tempDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  printSuccess("Created temporary directory: .real_world_temp/");

  // Collect all library names
  const allLibraries = CONFIG.categories.flatMap((cat) =>
    cat.libraries.map((lib) => lib.name)
  );
  const libraryNames = allLibraries.join(" ");

  printStep("2/3", `Installing ${allLibraries.length} production libraries...`);
  console.log(chalk.gray(`    ${libraryNames}`));

  try {
    execSync(`npm install ${libraryNames} --no-save --ignore-scripts --legacy-peer-deps`, {
      cwd: CONFIG.tempDir,
      stdio: "pipe",
    });
    printSuccess("All libraries installed successfully");
  } catch (error) {
    printError("Failed to install libraries");
    console.error(chalk.red(error.message));
    process.exit(1);
  }

  return CONFIG.tempDir;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Verification
// ═══════════════════════════════════════════════════════════════════

async function verificationPhase(tempDir) {
  printStep("3/3", "Running analyzer against all libraries...");
  console.log();

  // Dynamic import of analyzer (ESM)
  const { analyzeLibrary } = await import("../dist/core/analyzer.js");

  const results = [];

  for (const category of CONFIG.categories) {
    for (const lib of category.libraries) {
      console.log(chalk.gray(`    Analyzing ${lib.name}...`));

      const startTime = performance.now();
      let exportCount = 0;
      let status = "PASS";
      let error = null;

      try {
        const importMap = await analyzeLibrary(lib.name, tempDir);
        exportCount = importMap.size;
      } catch (err) {
        status = "FAIL";
        error = err.message;
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      results.push({
        category: category.name,
        name: lib.name,
        description: lib.description,
        exportCount,
        duration,
        status,
        error,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Reporting
// ═══════════════════════════════════════════════════════════════════

function reportingPhase(results) {
  console.log();
  console.log(chalk.bgMagenta.white.bold("                                                                            "));
  console.log(chalk.bgMagenta.white.bold("   🌍 Universal Compatibility Verification                                   "));
  console.log(chalk.bgMagenta.white.bold("                                                                            "));
  console.log();

  // Column widths
  const col = { cat: 14, lib: 18, exports: 10, time: 10, status: 10 };

  // Table header
  const headerLine =
    chalk.white.bold("Category".padEnd(col.cat)) +
    chalk.gray("│") +
    chalk.white.bold("Library".padEnd(col.lib)) +
    chalk.gray("│") +
    chalk.white.bold("Exports".padEnd(col.exports)) +
    chalk.gray("│") +
    chalk.white.bold("Time".padEnd(col.time)) +
    chalk.gray("│") +
    chalk.white.bold("Status".padEnd(col.status));

  const separatorLine = chalk.gray(
    "─".repeat(col.cat) +
      "┼" +
      "─".repeat(col.lib) +
      "┼" +
      "─".repeat(col.exports) +
      "┼" +
      "─".repeat(col.time) +
      "┼" +
      "─".repeat(col.status)
  );

  console.log(headerLine);
  console.log(separatorLine);

  let allPassed = true;
  let currentCategory = "";
  let passedCount = 0;
  let totalExports = 0;
  let totalTime = 0;

  for (const result of results) {
    // Print separator between categories
    if (currentCategory !== "" && currentCategory !== result.category) {
      console.log(separatorLine);
    }

    // Show category only for first item in group
    const categoryDisplay =
      currentCategory === result.category
        ? " ".repeat(col.cat)
        : chalk.yellow(result.category.padEnd(col.cat));

    currentCategory = result.category;

    const libName = result.name.padEnd(col.lib);
    const exports =
      result.status === "PASS"
        ? chalk.cyan(`${result.exportCount}+`.padEnd(col.exports))
        : chalk.red("N/A".padEnd(col.exports));
    const time =
      result.status === "PASS"
        ? chalk.white(formatMs(result.duration).padEnd(col.time))
        : chalk.red("N/A".padEnd(col.time));
    const status =
      result.status === "PASS"
        ? chalk.green("✅ PASS".padEnd(col.status))
        : chalk.red("❌ FAIL".padEnd(col.status));

    console.log(
      categoryDisplay +
        chalk.gray("│") +
        chalk.white(libName) +
        chalk.gray("│") +
        exports +
        chalk.gray("│") +
        time +
        chalk.gray("│") +
        status
    );

    if (result.status === "FAIL") {
      allPassed = false;
      console.log(chalk.red(`              └─ Error: ${result.error}`));
    } else {
      passedCount++;
      totalExports += result.exportCount;
      totalTime += result.duration;
    }
  }

  console.log(separatorLine);
  console.log();

  // Verdict
  if (allPassed) {
    console.log(
      chalk.bgGreen.black.bold("  🏆 VERDICT: Fully compatible with Toss's Legacy and Modern tech stack.  ")
    );
  } else {
    console.log(
      chalk.bgRed.white.bold("  ❌ VERDICT: Some libraries failed verification.  ")
    );
  }

  // Statistics
  console.log();
  console.log(chalk.white.bold("📊 Summary Statistics:"));
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Libraries tested: ${chalk.cyan(results.length)}`)
  );
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Libraries passed: ${chalk.green(passedCount)}/${results.length}`)
  );
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Total exports discovered: ${chalk.cyan(totalExports.toLocaleString())}`)
  );
  console.log(
    chalk.gray("   └─ ") +
      chalk.white(`Total analysis time: ${chalk.yellow(formatMs(totalTime))}`)
  );
  console.log();

  // Category breakdown
  console.log(chalk.white.bold("📋 Category Breakdown:"));

  const categoryStats = new Map();
  for (const result of results) {
    if (!categoryStats.has(result.category)) {
      categoryStats.set(result.category, { passed: 0, total: 0, exports: 0 });
    }
    const stats = categoryStats.get(result.category);
    stats.total++;
    if (result.status === "PASS") {
      stats.passed++;
      stats.exports += result.exportCount;
    }
  }

  const catEntries = Array.from(categoryStats.entries());
  catEntries.forEach(([category, stats], index) => {
    const prefix = index === catEntries.length - 1 ? "   └─ " : "   ├─ ";
    const statusIcon = stats.passed === stats.total ? "✅" : "⚠️";
    console.log(
      chalk.gray(prefix) +
        chalk.yellow(category) +
        chalk.white(`: ${statusIcon} ${stats.passed}/${stats.total} libraries, ${chalk.cyan(stats.exports)} exports`)
    );
  });

  console.log();

  return allPassed;
}

// ═══════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════

function cleanup() {
  console.log(chalk.gray("🧹 Cleaning up temporary files..."));
  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
  }
  console.log(chalk.gray("   Done."));
  console.log();
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.clear();
  printHeader("🔬 BARREL OPTIMIZER - Universal Compatibility Verification");

  try {
    // Phase 1: Setup
    const tempDir = setupPhase();
    console.log();

    // Phase 2: Verification
    const results = await verificationPhase(tempDir);

    // Phase 3: Reporting
    const allPassed = reportingPhase(results);

    // Cleanup
    cleanup();

    // Exit code
    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error(chalk.red("\n❌ Verification failed:"), error);
    cleanup();
    process.exit(1);
  }
}

main();

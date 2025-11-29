#!/usr/bin/env node
/**
 * Real-World Verification Script
 *
 * Proves barrel-optimizer works on production-grade libraries:
 * - @toss/utils (Target company's library)
 * - @mui/material (Massive barrel file stress test)
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
  libraries: [
    { name: "@toss/utils", description: "Toss utility library" },
    { name: "@mui/material", description: "Material UI (massive barrel)" },
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
  console.log(chalk.bgCyan.black.bold("                                                                  "));
  console.log(chalk.bgCyan.black.bold(`   ${text.padEnd(62)} `));
  console.log(chalk.bgCyan.black.bold("                                                                  "));
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

  // Install libraries
  const libraryNames = CONFIG.libraries.map((l) => l.name).join(" ");
  printStep("2/3", `Installing production libraries: ${chalk.yellow(libraryNames)}`);

  try {
    execSync(`npm install ${libraryNames} --no-save --ignore-scripts`, {
      cwd: CONFIG.tempDir,
      stdio: "pipe",
    });
    printSuccess("Libraries installed successfully");
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
  printStep("3/3", "Running analyzer against real-world libraries...");
  console.log();

  // Dynamic import of analyzer (ESM)
  const { analyzeLibrary } = await import("../dist/core/analyzer.js");

  const results = [];

  for (const lib of CONFIG.libraries) {
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
      name: lib.name,
      description: lib.description,
      exportCount,
      duration,
      status,
      error,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Reporting
// ═══════════════════════════════════════════════════════════════════

function reportingPhase(results) {
  console.log();
  console.log(chalk.bgMagenta.white.bold("                                                                  "));
  console.log(chalk.bgMagenta.white.bold("   🌍 Real-World Verification Results                             "));
  console.log(chalk.bgMagenta.white.bold("                                                                  "));
  console.log();

  // Table header
  const colWidths = { name: 20, count: 18, time: 15, status: 10 };
  const separator = chalk.gray(
    "─".repeat(colWidths.name) +
      "┼" +
      "─".repeat(colWidths.count) +
      "┼" +
      "─".repeat(colWidths.time) +
      "┼" +
      "─".repeat(colWidths.status)
  );

  console.log(
    chalk.white.bold("Library".padEnd(colWidths.name)) +
      chalk.gray("│") +
      chalk.white.bold("Exports Found".padEnd(colWidths.count)) +
      chalk.gray("│") +
      chalk.white.bold("Analysis Time".padEnd(colWidths.time)) +
      chalk.gray("│") +
      chalk.white.bold("Status".padEnd(colWidths.status))
  );
  console.log(separator);

  let allPassed = true;

  for (const result of results) {
    const name = result.name.padEnd(colWidths.name);
    const count =
      result.status === "PASS"
        ? chalk.cyan(`${result.exportCount.toLocaleString()}+`.padEnd(colWidths.count))
        : chalk.red("N/A".padEnd(colWidths.count));
    const time =
      result.status === "PASS"
        ? chalk.yellow(formatMs(result.duration).padEnd(colWidths.time))
        : chalk.red("N/A".padEnd(colWidths.time));
    const status =
      result.status === "PASS"
        ? chalk.green("✅ PASS".padEnd(colWidths.status))
        : chalk.red("❌ FAIL".padEnd(colWidths.status));

    console.log(chalk.white(name) + chalk.gray("│") + count + chalk.gray("│") + time + chalk.gray("│") + status);

    if (result.status === "FAIL") {
      allPassed = false;
      console.log(chalk.red(`  └─ Error: ${result.error}`));
    }
  }

  console.log(separator);
  console.log();

  // Summary
  if (allPassed) {
    console.log(chalk.bgGreen.black.bold("  ✅ All libraries verified successfully!  "));
    console.log();
    console.log(chalk.gray("> ") + chalk.white("Proven compatibility with complex production libraries."));
  } else {
    console.log(chalk.bgRed.white.bold("  ❌ Some libraries failed verification  "));
    console.log();
    console.log(chalk.gray("> ") + chalk.yellow("Check error messages above for details."));
  }

  // Statistics
  const totalExports = results
    .filter((r) => r.status === "PASS")
    .reduce((sum, r) => sum + r.exportCount, 0);
  const avgTime =
    results.filter((r) => r.status === "PASS").reduce((sum, r) => sum + r.duration, 0) /
    results.filter((r) => r.status === "PASS").length;

  console.log();
  console.log(chalk.white.bold("📊 Summary:"));
  console.log(chalk.gray("   ├─ ") + chalk.white(`Total exports discovered: ${chalk.cyan(totalExports.toLocaleString())}`));
  console.log(chalk.gray("   ├─ ") + chalk.white(`Average analysis time: ${chalk.yellow(formatMs(avgTime))}`));
  console.log(chalk.gray("   └─ ") + chalk.white(`Libraries verified: ${chalk.green(results.filter((r) => r.status === "PASS").length)}/${results.length}`));
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
  printHeader("🔬 BARREL OPTIMIZER - Real-World Verification");

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

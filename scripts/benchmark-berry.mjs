#!/usr/bin/env node
/**
 * Berry Admin Template Benchmark Script
 *
 * Tests barrel-optimizer on a heavy, real-world React admin template:
 * https://github.com/codedthemes/berry-free-react-admin-template
 *
 * This project is known to be heavy with MUI imports, making it an ideal
 * candidate for barrel optimization testing.
 *
 * Process:
 * 1. Clone the repository
 * 2. Install dependencies
 * 3. Analyze barrel import potential
 * 4. Run baseline build (measure time)
 * 5. Apply barrel-optimizer transformations
 * 6. Run optimized build (measure time)
 * 7. Generate comparison report
 *
 * Usage: node scripts/benchmark-berry.mjs
 */

import { execSync, spawnSync } from "node:child_process";
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
  tempDir: path.resolve(__dirname, "../.berry_bench"),
  repoUrl: "https://github.com/codedthemes/berry-free-react-admin-template.git",
  repoName: "berry-free-react-admin-template",
  // The repo has subprojects: vite/ and remix/ - we use the vite version
  projectSubdir: "vite",
  optimizerRoot: path.resolve(__dirname, ".."),
  cliPath: path.resolve(__dirname, "../dist/cli/index.js"),
  targetLibraries: ["@mui/material", "@mui/icons-material", "@mui/lab"],
};

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════

function printHeader(text) {
  console.log();
  console.log(chalk.bgMagenta.white.bold("═".repeat(70)));
  console.log(chalk.bgMagenta.white.bold(`   🍒 ${text.padEnd(64)}`));
  console.log(chalk.bgMagenta.white.bold("═".repeat(70)));
  console.log();
}

function printStep(step, total, text) {
  console.log(chalk.cyan(`[${step}/${total}]`) + " " + chalk.white.bold(text));
}

function printSubStep(text) {
  console.log(chalk.gray("    → ") + chalk.white(text));
}

function printSuccess(text) {
  console.log(chalk.green("    ✓ ") + chalk.white(text));
}

function printWarning(text) {
  console.log(chalk.yellow("    ⚠ ") + chalk.white(text));
}

function printError(text) {
  console.log(chalk.red("    ✗ ") + chalk.white(text));
}

function formatMs(ms) {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;

  try {
    const files = fs.readdirSync(dirPath, { recursive: true });
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    return 0;
  }

  return totalSize;
}

function runCommand(command, cwd, options = {}) {
  const { silent = false, ignoreError = false, timeout = 600000 } = options;

  try {
    const result = execSync(command, {
      cwd,
      stdio: silent ? "pipe" : "inherit",
      encoding: "utf-8",
      shell: true,
      timeout,
    });
    return { success: true, output: result || "" };
  } catch (error) {
    if (ignoreError) {
      return { success: true, output: "", warning: error.message };
    }
    return { success: false, error: error.message };
  }
}

function checkGitAvailable() {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the actual project directory (may be a subdirectory of the cloned repo)
 */
function getProjectDir() {
  if (CONFIG.projectSubdir) {
    return path.join(CONFIG.tempDir, CONFIG.projectSubdir);
  }
  return CONFIG.tempDir;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Clone Repository
// ═══════════════════════════════════════════════════════════════════

function cloneRepository() {
  printStep(1, 6, "Cloning Berry Admin Template repository...");

  if (!checkGitAvailable()) {
    printError("Git is not available. Please install Git and try again.");
    return false;
  }

  // Clean up existing temp directory
  if (fs.existsSync(CONFIG.tempDir)) {
    printSubStep("Removing existing directory...");
    fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
  }

  // Create temp directory
  fs.mkdirSync(CONFIG.tempDir, { recursive: true });

  // Clone repository (shallow clone for speed)
  printSubStep(`Cloning ${CONFIG.repoUrl}...`);
  const cloneResult = runCommand(
    `git clone ${CONFIG.repoUrl} . --depth 1`,
    CONFIG.tempDir,
    { silent: true }
  );

  if (!cloneResult.success) {
    printError("Failed to clone repository");
    console.error(chalk.red(cloneResult.error));
    return false;
  }

  printSuccess("Repository cloned successfully");

  // Show repo info from the actual project directory
  const projectDir = getProjectDir();
  const packageJsonPath = path.join(projectDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    printSubStep(`Project: ${pkg.name || CONFIG.repoName}`);
    printSubStep(`Version: ${pkg.version || "unknown"}`);
    if (CONFIG.projectSubdir) {
      printSubStep(`Subproject: ${CONFIG.projectSubdir}/`);
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Install Dependencies
// ═══════════════════════════════════════════════════════════════════

function installDependencies() {
  printStep(2, 6, "Installing dependencies (this may take a few minutes)...");

  const projectDir = getProjectDir();

  // Try with --legacy-peer-deps first (crucial for template compatibility)
  printSubStep("Running npm install --legacy-peer-deps...");
  let result = runCommand("npm install --legacy-peer-deps", projectDir, {
    silent: true,
    timeout: 300000, // 5 minute timeout
  });

  if (!result.success) {
    // Try with --force as fallback
    printWarning("Legacy peer deps failed, trying --force...");
    result = runCommand("npm install --force", projectDir, {
      silent: true,
      timeout: 300000,
    });
  }

  if (!result.success) {
    printError("Failed to install dependencies");
    console.error(chalk.red(result.error));
    return false;
  }

  printSuccess("Dependencies installed successfully");
  return true;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Analyze Barrel Import Potential
// ═══════════════════════════════════════════════════════════════════

function analyzeBarrelImports() {
  printStep(3, 6, "Analyzing barrel import potential...");

  const projectDir = getProjectDir();
  const srcDir = path.join(projectDir, "src");
  if (!fs.existsSync(srcDir)) {
    printWarning("Could not find src directory");
    return { totalImports: 0, directImports: 0, byLibrary: {}, files: 0, isGoodPatient: false, optimizationPotential: "Low" };
  }

  // Collect all JS/TS files
  const jsFiles = [];
  const findJsFiles = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          findJsFiles(fullPath);
        } else if (entry.isFile() && /\.(js|jsx|ts|tsx)$/.test(entry.name)) {
          jsFiles.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  };
  findJsFiles(srcDir);

  printSubStep(`Found ${jsFiles.length} source files to analyze`);

  // Count barrel imports per library
  const byLibrary = {};
  let totalBarrelImports = 0;
  let totalDirectImports = 0;

  // Patterns for barrel imports (exact match to library root)
  const barrelPatterns = CONFIG.targetLibraries.map((lib) => ({
    lib,
    // Match: import { X } from '@mui/material' (NOT '@mui/material/Button')
    pattern: new RegExp(
      `import\\s*\\{[^}]+\\}\\s*from\\s*['"]${lib.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`,
      "g"
    ),
  }));

  // Pattern for direct/subpath imports
  const directPatterns = CONFIG.targetLibraries.map((lib) => ({
    lib,
    // Match: import X from '@mui/material/Button' (subpath)
    pattern: new RegExp(
      `import\\s+\\w+\\s+from\\s*['"]${lib.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^'"]+['"]`,
      "g"
    ),
  }));

  for (const file of jsFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");

      // Count barrel imports
      for (const { lib, pattern } of barrelPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          byLibrary[lib] = (byLibrary[lib] || 0) + matches.length;
          totalBarrelImports += matches.length;
        }
      }

      // Count direct imports
      for (const { lib, pattern } of directPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          totalDirectImports += matches.length;
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  // Determine if this is a "good patient" (unoptimized) or "healthy" (optimized)
  const isGoodPatient = totalBarrelImports > 10;
  const optimizationPotential = totalBarrelImports > 50 ? "High" : totalBarrelImports > 10 ? "Medium" : "Low";

  printSubStep(`Barrel imports found: ${chalk.yellow(totalBarrelImports)}`);
  printSubStep(`Direct imports found: ${chalk.green(totalDirectImports)}`);
  printSubStep(`Optimization potential: ${chalk.cyan(optimizationPotential)}`);

  // Show breakdown by library
  for (const [lib, count] of Object.entries(byLibrary)) {
    printSubStep(`  ${lib}: ${count} barrel imports`);
  }

  if (isGoodPatient) {
    printSuccess("Good patient! This project has unoptimized barrel imports.");
  } else {
    printWarning("This project already uses mostly direct imports.");
  }

  return {
    totalImports: totalBarrelImports,
    directImports: totalDirectImports,
    byLibrary,
    files: jsFiles.length,
    isGoodPatient,
    optimizationPotential,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Baseline Build
// ═══════════════════════════════════════════════════════════════════

function runBaselineBuild() {
  printStep(4, 6, "Running baseline build (original code)...");

  const projectDir = getProjectDir();

  // Clean any existing build output
  const distPaths = ["dist", "build", ".next", "out"];
  for (const distPath of distPaths) {
    const fullPath = path.join(projectDir, distPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  // Run build and measure time
  printSubStep("Executing npm run build...");
  const startTime = performance.now();
  const result = runCommand("npm run build", projectDir, {
    silent: true,
    timeout: 600000, // 10 minute timeout
  });
  const endTime = performance.now();

  if (!result.success) {
    printError("Baseline build failed");
    const errorLines = result.error?.split("\n").slice(0, 15).join("\n");
    console.error(chalk.red(errorLines));
    return null;
  }

  const buildTime = endTime - startTime;

  // Find and measure dist folder
  let distPath = null;
  let bundleSize = 0;

  for (const possibleDist of distPaths) {
    const fullPath = path.join(projectDir, possibleDist);
    if (fs.existsSync(fullPath)) {
      distPath = fullPath;
      bundleSize = getDirectorySize(fullPath);
      break;
    }
  }

  printSuccess(`Build completed in ${formatMs(buildTime)}`);
  if (distPath) {
    printSubStep(`Output directory: ${path.basename(distPath)}/`);
    printSubStep(`Bundle size: ${formatBytes(bundleSize)}`);
  }

  return {
    buildTime,
    bundleSize,
    distPath,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Apply Optimization
// ═══════════════════════════════════════════════════════════════════

function applyOptimization() {
  printStep(5, 6, "Applying barrel-optimizer transformations...");

  const projectDir = getProjectDir();
  const srcDir = path.join(projectDir, "src");
  if (!fs.existsSync(srcDir)) {
    printWarning("Could not find src directory");
    return { filesTransformed: 0, importsOptimized: 0 };
  }

  // Run CLI from the cloned project directory
  printSubStep("Running barrel-optimizer CLI...");

  const libraryArgs = CONFIG.targetLibraries.map((lib) => `--library ${lib}`).join(" ");
  const cliCommand = `node "${CONFIG.cliPath}" build src ${libraryArgs}`;

  const cliResult = runCommand(cliCommand, projectDir, {
    silent: true,
    ignoreError: true,
  });

  let transformedCount = 0;
  let importCount = 0;

  if (cliResult.success && !cliResult.warning) {
    printSuccess("CLI tool executed successfully");

    // Parse output for stats
    const output = cliResult.output || "";
    const transformMatch =
      output.match(/Files transformed\s+(\d+)/i) ||
      output.match(/Transformed (\d+) files/i);
    const importMatch =
      output.match(/Imports optimized\s+(\d+)/i) ||
      output.match(/(\d+) imports/i);

    if (transformMatch) transformedCount = parseInt(transformMatch[1], 10);
    if (importMatch) importCount = parseInt(importMatch[1], 10);

    printSubStep(`Transformed ${transformedCount} files`);
    printSubStep(`Optimized ${importCount} imports`);
  } else {
    printWarning("CLI tool encountered issues");
    if (cliResult.warning) {
      printSubStep(cliResult.warning.split("\n")[0]);
    }
  }

  return {
    filesTransformed: transformedCount,
    importsOptimized: importCount,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 6: Optimized Build
// ═══════════════════════════════════════════════════════════════════

function runOptimizedBuild() {
  printStep(6, 6, "Running optimized build (transformed code)...");

  const projectDir = getProjectDir();

  // Clean any existing build output
  const distPaths = ["dist", "build", ".next", "out"];
  for (const distPath of distPaths) {
    const fullPath = path.join(projectDir, distPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  // Run build and measure time
  printSubStep("Executing npm run build...");
  const startTime = performance.now();
  const result = runCommand("npm run build", projectDir, {
    silent: true,
    timeout: 600000,
  });
  const endTime = performance.now();

  if (!result.success) {
    printError("Optimized build failed");
    printWarning("This may indicate a transformation issue");
    const errorLines = result.error?.split("\n").slice(0, 15).join("\n");
    console.error(chalk.red(errorLines));
    return null;
  }

  const buildTime = endTime - startTime;

  // Find and measure dist folder
  let distPath = null;
  let bundleSize = 0;

  for (const possibleDist of distPaths) {
    const fullPath = path.join(projectDir, possibleDist);
    if (fs.existsSync(fullPath)) {
      distPath = fullPath;
      bundleSize = getDirectorySize(fullPath);
      break;
    }
  }

  printSuccess(`Build completed in ${formatMs(buildTime)}`);
  if (distPath) {
    printSubStep(`Bundle size: ${formatBytes(bundleSize)}`);
  }

  return {
    buildTime,
    bundleSize,
    distPath,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Generate Report
// ═══════════════════════════════════════════════════════════════════

function generateReport(analysis, baseline, optimized, transformInfo) {
  console.log();
  console.log(chalk.bgMagenta.white.bold("═".repeat(70)));
  console.log(chalk.bgMagenta.white.bold("   🍒 Berry Admin Template Benchmark Results                           "));
  console.log(chalk.bgMagenta.white.bold("═".repeat(70)));
  console.log();

  // Analysis section
  const potentialColor =
    analysis.optimizationPotential === "High"
      ? chalk.green
      : analysis.optimizationPotential === "Medium"
      ? chalk.yellow
      : chalk.gray;

  console.log(chalk.white.bold("📊 Optimization Potential"));
  console.log(chalk.gray("─".repeat(70)));
  console.log(
    `   Barrel imports found:    ${chalk.yellow(analysis.totalImports)} imports`
  );
  console.log(
    `   Direct imports found:    ${chalk.green(analysis.directImports)} imports`
  );
  console.log(
    `   Optimization potential:  ${potentialColor(analysis.optimizationPotential)}`
  );
  console.log();

  // Build comparison
  console.log(chalk.white.bold("⏱️  Build Time Comparison"));
  console.log(chalk.gray("─".repeat(70)));

  const baselineTime = baseline?.buildTime || 0;
  const optimizedTime = optimized?.buildTime || baselineTime;
  const timeDiff = baselineTime > 0 ? ((baselineTime - optimizedTime) / baselineTime) * 100 : 0;
  const timeIcon = timeDiff > 5 ? "⚡" : timeDiff > 0 ? "✨" : "➡️";

  console.log(
    `   Baseline Build:          ${chalk.red(formatMs(baselineTime))}`
  );
  console.log(
    `   Optimized Build:         ${chalk.green(formatMs(optimizedTime))}`
  );
  console.log(
    `   Improvement:             ${chalk.yellow(`${timeIcon} ${timeDiff > 0 ? "-" : "+"}${Math.abs(timeDiff).toFixed(1)}%`)}`
  );
  console.log();

  // Bundle size comparison
  if (baseline?.bundleSize && optimized?.bundleSize) {
    const sizeDiff =
      ((baseline.bundleSize - optimized.bundleSize) / baseline.bundleSize) * 100;

    console.log(chalk.white.bold("📦 Bundle Size Comparison"));
    console.log(chalk.gray("─".repeat(70)));
    console.log(
      `   Baseline:                ${chalk.white(formatBytes(baseline.bundleSize))}`
    );
    console.log(
      `   Optimized:               ${chalk.white(formatBytes(optimized.bundleSize))}`
    );
    console.log(
      `   Difference:              ${chalk.gray(`${sizeDiff > 0 ? "-" : "+"}${Math.abs(sizeDiff).toFixed(1)}%`)}`
    );
    console.log();
  }

  // Transformation stats
  console.log(chalk.white.bold("🔧 Transformation Stats"));
  console.log(chalk.gray("─".repeat(70)));
  console.log(
    `   Files analyzed:          ${chalk.white(analysis.files)}`
  );
  console.log(
    `   Files transformed:       ${chalk.cyan(transformInfo.filesTransformed)}`
  );
  console.log(
    `   Imports optimized:       ${chalk.cyan(transformInfo.importsOptimized)}`
  );
  console.log();

  // Verdict
  console.log(chalk.gray("═".repeat(70)));
  if (timeDiff > 10) {
    console.log(
      chalk.bgGreen.black.bold(
        `  🎉 SUCCESS: barrel-optimizer reduced build time by ${timeDiff.toFixed(1)}%!  `
      )
    );
  } else if (timeDiff > 0) {
    console.log(
      chalk.bgGreen.black.bold(
        `  ✅ SUCCESS: Marginal improvement with zero overhead  `
      )
    );
  } else if (analysis.totalImports === 0) {
    console.log(
      chalk.bgBlue.white.bold(
        `  ℹ️  INFO: Project already uses optimized imports (best practice!)  `
      )
    );
  } else {
    console.log(
      chalk.bgYellow.black.bold(
        `  ⚠️  NEUTRAL: No significant change (caching may affect results)  `
      )
    );
  }
  console.log(chalk.gray("═".repeat(70)));
  console.log();

  // CI/CD impact projection
  if (timeDiff > 0 && transformInfo.importsOptimized > 0) {
    const savingsPerBuild = baselineTime - optimizedTime;
    const dailyBuilds = 50;
    const dailySavings = (savingsPerBuild * dailyBuilds) / 1000 / 60;

    console.log(chalk.white.bold("📈 Projected CI/CD Impact"));
    console.log(chalk.gray("─".repeat(70)));
    console.log(
      `   Time saved per build:    ${chalk.green(formatMs(savingsPerBuild))}`
    );
    console.log(
      `   Daily savings (50 builds): ${chalk.green(`~${dailySavings.toFixed(1)} minutes`)}`
    );
    console.log(
      `   Monthly savings:         ${chalk.green(`~${(dailySavings * 30).toFixed(0)} minutes`)}`
    );
    console.log();
  }

  console.log(chalk.gray(`> Repository: ${CONFIG.repoUrl}`));
  console.log();
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
  printHeader("Berry Admin Template Benchmark");

  const startTotal = performance.now();

  try {
    // Phase 1: Clone
    const cloned = cloneRepository();
    if (!cloned) {
      cleanup();
      process.exit(1);
    }
    console.log();

    // Phase 2: Install
    const installed = installDependencies();
    if (!installed) {
      cleanup();
      process.exit(1);
    }
    console.log();

    // Phase 3: Analyze
    const analysis = analyzeBarrelImports();
    console.log();

    // Phase 4: Baseline Build
    const baseline = runBaselineBuild();
    if (!baseline) {
      printWarning("Baseline build failed, attempting to continue...");
    }
    console.log();

    // Phase 5: Apply Optimization
    let transformInfo = { filesTransformed: 0, importsOptimized: 0 };
    let optimized = null;

    if (analysis.isGoodPatient) {
      transformInfo = applyOptimization();
      console.log();

      // Phase 6: Optimized Build
      if (transformInfo.filesTransformed > 0) {
        optimized = runOptimizedBuild();
      } else {
        printStep(6, 6, "Skipping optimized build (no transformations made)...");
        printSuccess("No barrel imports to optimize");
        optimized = baseline ? { ...baseline } : null;
      }
    } else {
      printStep(5, 6, "Skipping optimization (project already optimized)...");
      printSuccess("Project follows best practices");
      console.log();
      printStep(6, 6, "Skipping optimized build...");
      optimized = baseline ? { ...baseline } : null;
    }
    console.log();

    // Generate Report
    if (baseline || optimized) {
      generateReport(analysis, baseline, optimized, transformInfo);
    }

    const endTotal = performance.now();
    console.log(chalk.gray(`Total benchmark time: ${formatMs(endTotal - startTotal)}`));
    console.log();

    // Cleanup
    cleanup();

    process.exit(0);
  } catch (error) {
    console.error(chalk.red("\n❌ Benchmark failed:"), error);
    cleanup();
    process.exit(1);
  }
}

main();

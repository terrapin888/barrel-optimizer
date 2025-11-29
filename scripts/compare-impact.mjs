#!/usr/bin/env node
/**
 * Bundle Impact Comparison Script
 *
 * Simulates how a bundler resolves files to demonstrate the cost savings
 * of using barrel-optimizer.
 *
 * Scenario A: Without Optimization
 *   - Bundler hits index.js (barrel file)
 *   - Must parse ALL 500 component files to check for side effects
 *   - Cost: 501 files, ~1MB
 *
 * Scenario B: With Optimization
 *   - Our tool transforms to direct import
 *   - Bundler hits only the single component file
 *   - Cost: 1 file, ~2KB
 *
 * Usage: node scripts/compare-impact.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  tempDir: path.resolve(__dirname, "../.impact_temp"),
  componentCount: 500,
  componentSizeKB: 2, // Each component is ~2KB
  parseTimePerFileMs: 0.3, // Estimated parse time per file
};

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════

function printHeader(text) {
  console.log();
  console.log(chalk.bgBlue.white.bold("                                                                            "));
  console.log(chalk.bgBlue.white.bold(`   ${text.padEnd(72)} `));
  console.log(chalk.bgBlue.white.bold("                                                                            "));
  console.log();
}

function printStep(step, text) {
  console.log(chalk.blue(`[${step}]`) + " " + chalk.white(text));
}

function printSuccess(text) {
  console.log(chalk.green("    ✓ ") + chalk.white(text));
}

function formatNumber(num) {
  return num.toLocaleString();
}

function formatSize(kb) {
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatPercent(before, after) {
  const reduction = ((before - after) / before) * 100;
  return `-${reduction.toFixed(1)}%`;
}

function formatSpeedup(before, after) {
  const speedup = before / after;
  return `${speedup.toFixed(0)}x Faster`;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Setup Mock Environment
// ═══════════════════════════════════════════════════════════════════

function setupMockEnvironment() {
  printStep("1/3", "Creating simulated heavy library environment...");

  // Clean up existing temp directory
  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
  }

  // Create directory structure
  const libDir = path.join(CONFIG.tempDir, "node_modules/@heavy/ui/dist");
  fs.mkdirSync(libDir, { recursive: true });

  // Create 500 component files (each ~2KB)
  const componentTemplate = (name) => `
/**
 * ${name} Component
 * A production-grade UI component with comprehensive features.
 */

import React from 'react';

// Component styles (inline for demonstration)
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    padding: '16px',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  header: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '12px',
  },
  content: {
    fontSize: '14px',
    lineHeight: '1.5',
    color: '#333333',
  },
  footer: {
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: '1px solid #eeeeee',
  },
};

// Utility functions
function validateProps(props) {
  if (!props) throw new Error('Props required');
  return true;
}

function formatDisplayName(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Main component
export function ${name}(props) {
  validateProps(props);

  const { children, className, style, ...rest } = props;

  return React.createElement('div', {
    className: \`${name.toLowerCase()} \${className || ''}\`,
    style: { ...styles.container, ...style },
    ...rest
  }, children);
}

// Default export
export default ${name};

// Additional exports
export const ${name}Styles = styles;
export const ${name}Utils = { validateProps, formatDisplayName };
`.trim();

  // Generate component files
  for (let i = 1; i <= CONFIG.componentCount; i++) {
    const componentName = `Comp${i}`;
    const componentPath = path.join(libDir, `${componentName}.js`);
    fs.writeFileSync(componentPath, componentTemplate(componentName));
  }

  printSuccess(`Created ${CONFIG.componentCount} component files (~${CONFIG.componentSizeKB}KB each)`);

  // Create barrel file (index.js)
  const exports = Array.from({ length: CONFIG.componentCount }, (_, i) => {
    const name = `Comp${i + 1}`;
    return `export { ${name}, default as ${name}Default, ${name}Styles, ${name}Utils } from './dist/${name}.js';`;
  }).join("\n");

  const indexPath = path.join(CONFIG.tempDir, "node_modules/@heavy/ui/index.js");
  fs.writeFileSync(indexPath, `// Barrel file - exports all ${CONFIG.componentCount} components\n${exports}\n`);

  printSuccess("Created barrel file (index.js) with all exports");

  // Create app source file
  const srcDir = path.join(CONFIG.tempDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // Before optimization
  const appBeforePath = path.join(srcDir, "app-before.ts");
  fs.writeFileSync(appBeforePath, `// Before optimization - imports from barrel file
import { Comp1 } from '@heavy/ui';

export function App() {
  return <Comp1>Hello World</Comp1>;
}
`);

  // After optimization
  const appAfterPath = path.join(srcDir, "app-after.ts");
  fs.writeFileSync(appAfterPath, `// After optimization - direct import
import Comp1 from '@heavy/ui/dist/Comp1.js';

export function App() {
  return <Comp1>Hello World</Comp1>;
}
`);

  printSuccess("Created app source files (before/after optimization)");

  return CONFIG.tempDir;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Calculate Impact
// ═══════════════════════════════════════════════════════════════════

function calculateImpact() {
  printStep("2/3", "Calculating bundle impact metrics...");
  console.log();

  // Scenario A: Without Optimization
  const scenarioA = {
    name: "Without Optimization",
    filesProcessed: CONFIG.componentCount + 1, // All components + index.js
    totalSizeKB: CONFIG.componentCount * CONFIG.componentSizeKB + 5, // Components + index overhead
    parseTimeMs: (CONFIG.componentCount + 1) * CONFIG.parseTimePerFileMs,
  };

  // Scenario B: With Optimization
  const scenarioB = {
    name: "With Optimization",
    filesProcessed: 1, // Only the single component
    totalSizeKB: CONFIG.componentSizeKB,
    parseTimeMs: CONFIG.parseTimePerFileMs,
  };

  console.log(chalk.gray("    Scenario A (Without Tool):"));
  console.log(chalk.gray(`      - Bundler loads index.js`));
  console.log(chalk.gray(`      - Must resolve ALL ${CONFIG.componentCount} exports to check side-effects`));
  console.log(chalk.gray(`      - Result: ${scenarioA.filesProcessed} files, ${formatSize(scenarioA.totalSizeKB)}`));
  console.log();
  console.log(chalk.gray("    Scenario B (With Tool):"));
  console.log(chalk.gray(`      - Import transformed to: import Comp1 from '@heavy/ui/dist/Comp1.js'`));
  console.log(chalk.gray(`      - Bundler loads ONLY the required file`));
  console.log(chalk.gray(`      - Result: ${scenarioB.filesProcessed} file, ${formatSize(scenarioB.totalSizeKB)}`));
  console.log();

  return { scenarioA, scenarioB };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Generate Report
// ═══════════════════════════════════════════════════════════════════

function generateReport(impact) {
  const { scenarioA, scenarioB } = impact;

  printStep("3/3", "Generating impact analysis report...");
  console.log();

  // Report header
  console.log(chalk.bgMagenta.white.bold("                                                                            "));
  console.log(chalk.bgMagenta.white.bold("   📉 Bundle Impact Analysis Report                                         "));
  console.log(chalk.bgMagenta.white.bold("                                                                            "));
  console.log();

  // Column widths
  const col = { metric: 24, without: 20, with: 20, improvement: 16 };

  // Table header
  const headerLine =
    chalk.white.bold("Metric".padEnd(col.metric)) +
    chalk.gray("│") +
    chalk.red.bold("Without Tool (❌)".padEnd(col.without)) +
    chalk.gray("│") +
    chalk.green.bold("With Tool (✅)".padEnd(col.with)) +
    chalk.gray("│") +
    chalk.yellow.bold("Improvement".padEnd(col.improvement));

  const separatorLine = chalk.gray(
    "─".repeat(col.metric) +
      "┼" +
      "─".repeat(col.without) +
      "┼" +
      "─".repeat(col.with) +
      "┼" +
      "─".repeat(col.improvement)
  );

  console.log(headerLine);
  console.log(separatorLine);

  // Row 1: Files Processed
  const filesImprovement = formatPercent(scenarioA.filesProcessed, scenarioB.filesProcessed);
  console.log(
    chalk.white("Files Processed".padEnd(col.metric)) +
      chalk.gray("│") +
      chalk.red(`${formatNumber(scenarioA.filesProcessed)} files`.padEnd(col.without)) +
      chalk.gray("│") +
      chalk.green(`${formatNumber(scenarioB.filesProcessed)} file`.padEnd(col.with)) +
      chalk.gray("│") +
      chalk.yellow(`📉 ${filesImprovement}`.padEnd(col.improvement))
  );

  // Row 2: Virtual Bundle Size
  const sizeImprovement = formatPercent(scenarioA.totalSizeKB, scenarioB.totalSizeKB);
  console.log(
    chalk.white("Virtual Bundle Size".padEnd(col.metric)) +
      chalk.gray("│") +
      chalk.red(`~${formatSize(scenarioA.totalSizeKB)}`.padEnd(col.without)) +
      chalk.gray("│") +
      chalk.green(`~${formatSize(scenarioB.totalSizeKB)}`.padEnd(col.with)) +
      chalk.gray("│") +
      chalk.yellow(`📉 ${sizeImprovement}`.padEnd(col.improvement))
  );

  // Row 3: Estimated Parse Time
  const timeSpeedup = formatSpeedup(scenarioA.parseTimeMs, scenarioB.parseTimeMs);
  console.log(
    chalk.white("Est. Parse Time".padEnd(col.metric)) +
      chalk.gray("│") +
      chalk.red(`~${scenarioA.parseTimeMs.toFixed(0)} ms`.padEnd(col.without)) +
      chalk.gray("│") +
      chalk.green(`~${scenarioB.parseTimeMs.toFixed(1)} ms`.padEnd(col.with)) +
      chalk.gray("│") +
      chalk.yellow(`🚀 ${timeSpeedup}`.padEnd(col.improvement))
  );

  // Row 4: Module Graph Nodes
  const nodesImprovement = formatPercent(scenarioA.filesProcessed, scenarioB.filesProcessed);
  console.log(
    chalk.white("Module Graph Nodes".padEnd(col.metric)) +
      chalk.gray("│") +
      chalk.red(`${formatNumber(scenarioA.filesProcessed)} nodes`.padEnd(col.without)) +
      chalk.gray("│") +
      chalk.green(`${formatNumber(scenarioB.filesProcessed)} node`.padEnd(col.with)) +
      chalk.gray("│") +
      chalk.yellow(`📉 ${nodesImprovement}`.padEnd(col.improvement))
  );

  console.log(separatorLine);
  console.log();

  // Conclusion
  console.log(chalk.bgGreen.black.bold("  ✅ CONCLUSION: Eliminating Barrel Files reduces build overhead by 99%+  "));
  console.log();

  // Visual representation
  console.log(chalk.white.bold("📊 Visual Impact:"));
  console.log();

  // Without optimization bar
  const barWidth = 60;
  const withoutBar = "█".repeat(barWidth);
  const withBar = "█";

  console.log(chalk.gray("   Without Tool:"));
  console.log(chalk.red(`   ${withoutBar} ${formatSize(scenarioA.totalSizeKB)}`));
  console.log();
  console.log(chalk.gray("   With Tool:"));
  console.log(chalk.green(`   ${withBar} ${formatSize(scenarioB.totalSizeKB)}`));
  console.log();

  // Key insight
  console.log(chalk.white.bold("💡 Key Insight:"));
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Barrel files force bundlers to load ${chalk.red("ALL")} exports`)
  );
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Even with tree-shaking, the initial parse cost is ${chalk.red("unavoidable")}`)
  );
  console.log(
    chalk.gray("   └─ ") +
      chalk.white(`Direct imports skip the barrel entirely → ${chalk.green("instant savings")}`)
  );
  console.log();

  // Real-world extrapolation
  console.log(chalk.white.bold("🏢 Real-World Impact (Large Monorepo):"));
  const realWorldMultiplier = 10; // 10 barrel imports in a typical app
  const realSavingsKB = (scenarioA.totalSizeKB - scenarioB.totalSizeKB) * realWorldMultiplier;
  const realSavingsMs = (scenarioA.parseTimeMs - scenarioB.parseTimeMs) * realWorldMultiplier;

  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`If your app imports from ${realWorldMultiplier} barrel files:`)
  );
  console.log(
    chalk.gray("   ├─ ") +
      chalk.white(`Potential savings: ${chalk.green(formatSize(realSavingsKB))} of parse overhead`)
  );
  console.log(
    chalk.gray("   └─ ") +
      chalk.white(`Time saved per build: ${chalk.green(`~${realSavingsMs.toFixed(0)} ms`)}`)
  );
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

function main() {
  console.clear();
  printHeader("📉 BARREL OPTIMIZER - Bundle Impact Analysis");

  try {
    // Phase 1: Setup
    setupMockEnvironment();
    console.log();

    // Phase 2: Calculate
    const impact = calculateImpact();

    // Phase 3: Report
    generateReport(impact);

    // Cleanup
    cleanup();

    process.exit(0);
  } catch (error) {
    console.error(chalk.red("\n❌ Analysis failed:"), error);
    cleanup();
    process.exit(1);
  }
}

main();

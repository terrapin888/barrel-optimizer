#!/usr/bin/env node
/**
 * Cleanup Script
 *
 * Removes all generated test folders and temporary artifacts.
 *
 * Usage: node scripts/cleanup.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Directories to clean up
const CLEANUP_TARGETS = [
  ".real_world_temp",
  "test-env",
  ".benchmark_env",
];

console.log("🧹 Cleaning up project...\n");

let cleanedCount = 0;

for (const target of CLEANUP_TARGETS) {
  const targetPath = path.join(rootDir, target);

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    console.log(`   ✓ Removed ${target}/`);
    cleanedCount++;
  } else {
    console.log(`   - ${target}/ (not found, skipping)`);
  }
}

console.log();

if (cleanedCount > 0) {
  console.log(`✨ Project cleaned up successfully! (${cleanedCount} directories removed)`);
} else {
  console.log("✨ Project is already clean!");
}

console.log();

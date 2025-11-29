#!/usr/bin/env node
/**
 * Direct test of analyzer + transformer
 */

import { analyzeLibrary } from "../dist/core/analyzer.js";
import { transformCode } from "../dist/core/transformer.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ENV = path.resolve(__dirname, "../test-env");

async function main() {
  console.log("=== Direct Transform Test ===\n");

  // Step 1: Analyze library
  console.log("1. Analyzing @test/ui...");
  const importMap = await analyzeLibrary("@test/ui", TEST_ENV);

  console.log(`   Found ${importMap.size} exports:`);
  for (const [name, filePath] of importMap) {
    const shortPath = filePath.replace(TEST_ENV, "").replace(/\\/g, "/");
    console.log(`   - ${name} → ${shortPath}`);
  }
  console.log();

  // Step 2: Read source file
  const sourcePath = path.join(TEST_ENV, "playground/source.ts");
  const sourceCode = fs.readFileSync(sourcePath, "utf-8");

  console.log("2. Original source code:");
  console.log("---");
  console.log(sourceCode);
  console.log("---\n");

  // Step 3: Transform
  console.log("3. Transforming...");
  const result = transformCode(sourceCode, importMap, ["@test/ui"]);

  console.log(`   transformed: ${result.transformed}`);
  console.log(`   optimized: ${result.optimized.length}`);
  console.log(`   skipped: ${result.skipped.length}`);
  console.log();

  if (result.optimized.length > 0) {
    console.log("   Optimizations:");
    for (const opt of result.optimized) {
      console.log(`   - ${opt.original}:`);
      for (const r of opt.rewrites) {
        console.log(`     ${r}`);
      }
    }
    console.log();
  }

  console.log("4. Transformed code:");
  console.log("---");
  console.log(result.code);
  console.log("---");
}

main().catch(console.error);

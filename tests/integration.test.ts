/**
 * Integration Tests
 *
 * Tests against REAL npm packages (not mocks) to validate actual behavior.
 * These tests require the packages to be installed in node_modules.
 *
 * Target: es-toolkit (Toss's modern utility library with barrel exports)
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { analyzeLibrary } from "../src/core/analyzer.js";
import { transformCode } from "../src/core/transformer.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");

describe("Integration Tests (Real Dependencies)", () => {
  describe("es-toolkit Analysis", () => {
    let importMap: Map<string, string>;

    beforeAll(async () => {
      // Analyze the real es-toolkit package
      importMap = await analyzeLibrary("es-toolkit", PROJECT_ROOT);
    }, 30000); // 30s timeout for real package analysis

    it("should discover exports from es-toolkit", () => {
      // es-toolkit should have many exports (100+)
      expect(importMap.size).toBeGreaterThan(50);
    });

    it("should find common utility functions", () => {
      // These are well-known es-toolkit exports
      const commonExports = ["chunk", "debounce", "throttle", "groupBy", "uniq"];

      for (const name of commonExports) {
        expect(importMap.has(name)).toBe(true);
      }
    });

    it("should resolve to actual file paths", () => {
      const chunkPath = importMap.get("chunk");

      expect(chunkPath).toBeDefined();
      expect(chunkPath).toContain("node_modules");
      expect(chunkPath).toContain("es-toolkit");
    });

    it("should not have circular dependency issues", () => {
      // If there were circular deps, the analysis would hang or crash
      // The fact we got here means it worked
      expect(importMap.size).toBeGreaterThan(0);
    });
  });

  describe("es-toolkit Transformation", () => {
    let importMap: Map<string, string>;

    beforeAll(async () => {
      importMap = await analyzeLibrary("es-toolkit", PROJECT_ROOT);
    }, 30000);

    it("should transform barrel imports to direct imports", () => {
      const code = `import { chunk, debounce } from 'es-toolkit';`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      expect(result.transformed).toBe(true);
      expect(result.code).toContain("es-toolkit/");
      expect(result.optimized.length).toBe(1);
      expect(result.optimized[0]?.rewrites.length).toBe(2);
    });

    it("should preserve aliases during transformation", () => {
      const code = `import { chunk as splitArray, debounce as debounceFn } from 'es-toolkit';`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      expect(result.transformed).toBe(true);
      // Aliases should be preserved in the output
      expect(result.code).toContain("splitArray");
      expect(result.code).toContain("debounceFn");
    });

    it("should bail out on namespace imports", () => {
      const code = `import * as _ from 'es-toolkit';`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      expect(result.transformed).toBe(false);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]?.reason).toContain("Namespace");
    });

    it("should not transform subpath imports", () => {
      // Subpath imports are already optimized
      const code = `import { chunk } from 'es-toolkit/array';`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      // Should NOT transform - it's already a direct import
      expect(result.transformed).toBe(false);
    });

    it("should handle multiple imports in same file", () => {
      const code = `
import { chunk, uniq } from 'es-toolkit';
import { groupBy } from 'es-toolkit';

const data = [1, 2, 2, 3];
const unique = uniq(data);
`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      expect(result.transformed).toBe(true);
      // Both import statements should be transformed
      expect(result.optimized.length).toBe(2);
    });

    it("should preserve non-target imports", () => {
      const code = `
import { chunk } from 'es-toolkit';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
`;

      const result = transformCode(code, importMap, ["es-toolkit"]);

      expect(result.transformed).toBe(true);
      // Node.js imports should be preserved unchanged
      expect(result.code).toContain("node:path");
      expect(result.code).toContain("node:fs/promises");
    });
  });

  describe("End-to-End Workflow", () => {
    it("should complete full analyze → transform workflow", async () => {
      // Step 1: Analyze
      const importMap = await analyzeLibrary("es-toolkit", PROJECT_ROOT);
      expect(importMap.size).toBeGreaterThan(0);

      // Step 2: Transform
      const sourceCode = `
import { chunk, debounce, throttle } from 'es-toolkit';

export function processData(data: number[]) {
  const chunks = chunk(data, 10);
  return chunks;
}
`;

      const result = transformCode(sourceCode, importMap, ["es-toolkit"], {
        filename: "test.ts",
      });

      // Step 3: Verify
      expect(result.transformed).toBe(true);
      expect(result.code).toContain("es-toolkit/");
      expect(result.code).toContain("processData");
      expect(result.code).toContain("export");

      // Transformed code should still be valid TypeScript structure
      expect(result.code).not.toContain("undefined");
    }, 30000);
  });
});

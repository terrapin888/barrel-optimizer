/**
 * Analyzer Module Unit Tests
 *
 * Tests focus on:
 * 1. Circular dependency prevention (DFS visited set)
 * 2. Correct path mapping for exports
 * 3. Nested barrel file resolution
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Mock fs module for isolated testing
vi.mock("node:fs/promises");

const mockedFs = vi.mocked(fs);

/**
 * Helper to create a mock file system structure
 */
function mockFileSystem(files: Record<string, string>) {
  mockedFs.readFile.mockImplementation(async (filePath) => {
    const normalizedPath = String(filePath).replace(/\\/g, "/");
    for (const [mockPath, content] of Object.entries(files)) {
      if (normalizedPath.endsWith(mockPath) || normalizedPath.includes(mockPath)) {
        return content;
      }
    }
    throw new Error(`ENOENT: ${filePath}`);
  });

  mockedFs.stat.mockImplementation(async (filePath) => {
    const normalizedPath = String(filePath).replace(/\\/g, "/");
    for (const mockPath of Object.keys(files)) {
      if (normalizedPath.endsWith(mockPath) || normalizedPath.includes(mockPath)) {
        return { isFile: () => true } as fs.Stats;
      }
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
}

describe("Analyzer Module", () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  describe("analyzeLibrary", () => {
    it("should correctly map simple named exports", async () => {
      // Setup: Mock a simple barrel file structure
      mockFileSystem({
        "node_modules/@test/ui/package.json": JSON.stringify({
          name: "@test/ui",
          main: "./dist/index.js",
        }),
        "node_modules/@test/ui/dist/index.js": `
          export { Button } from './Button.js';
          export { Input } from './Input.js';
        `,
        "node_modules/@test/ui/dist/Button.js": `
          export const Button = () => {};
        `,
        "node_modules/@test/ui/dist/Input.js": `
          export const Input = () => {};
        `,
      });

      // Dynamic import to get fresh module with mocks applied
      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/ui", "/project");

      // Verify: Both exports should be mapped
      expect(importMap.size).toBeGreaterThanOrEqual(2);
      expect(importMap.has("Button")).toBe(true);
      expect(importMap.has("Input")).toBe(true);

      // Paths should point to actual source files
      const buttonPath = importMap.get("Button");
      expect(buttonPath).toContain("Button");
    });

    it("should handle re-exports with aliases", async () => {
      mockFileSystem({
        "node_modules/@test/utils/package.json": JSON.stringify({
          name: "@test/utils",
          module: "./esm/index.js",
        }),
        "node_modules/@test/utils/esm/index.js": `
          export { default as chunk } from './chunk.js';
          export { debounce as debounceFn } from './debounce.js';
        `,
        "node_modules/@test/utils/esm/chunk.js": `
          export default function chunk() {}
        `,
        "node_modules/@test/utils/esm/debounce.js": `
          export function debounce() {}
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/utils", "/project");

      // Aliased exports should use the exported name (not original)
      expect(importMap.has("chunk")).toBe(true);
      expect(importMap.has("debounceFn")).toBe(true);
    });

    it("should prevent infinite loops on circular dependencies", async () => {
      // Setup: Create circular dependency A -> B -> A
      mockFileSystem({
        "node_modules/@test/circular/package.json": JSON.stringify({
          name: "@test/circular",
          main: "./index.js",
        }),
        "node_modules/@test/circular/index.js": `
          export { Foo } from './moduleA.js';
          export { Bar } from './moduleB.js';
        `,
        "node_modules/@test/circular/moduleA.js": `
          export { Bar } from './moduleB.js';
          export const Foo = 'foo';
        `,
        "node_modules/@test/circular/moduleB.js": `
          export { Foo } from './moduleA.js';
          export const Bar = 'bar';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      // Should NOT throw or hang - DFS visited set prevents infinite loop
      const startTime = Date.now();
      const importMap = await analyzeLibrary("@test/circular", "/project");
      const elapsed = Date.now() - startTime;

      // Verify: Should complete quickly (< 1 second) without hanging
      expect(elapsed).toBeLessThan(1000);

      // Both exports should be discovered
      expect(importMap.has("Foo")).toBe(true);
      expect(importMap.has("Bar")).toBe(true);
    });

    it("should handle star re-exports (export * from)", async () => {
      mockFileSystem({
        "node_modules/@test/star/package.json": JSON.stringify({
          name: "@test/star",
          main: "./index.js",
        }),
        "node_modules/@test/star/index.js": `
          export * from './components.js';
          export * from './hooks.js';
        `,
        "node_modules/@test/star/components.js": `
          export const Button = () => {};
          export const Modal = () => {};
        `,
        "node_modules/@test/star/hooks.js": `
          export const useToggle = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star", "/project");

      // All exports from star re-exports should be discovered
      expect(importMap.has("Button")).toBe(true);
      expect(importMap.has("Modal")).toBe(true);
      expect(importMap.has("useToggle")).toBe(true);
    });

    it("should resolve conditional exports in package.json", async () => {
      mockFileSystem({
        "node_modules/@test/modern/package.json": JSON.stringify({
          name: "@test/modern",
          exports: {
            ".": {
              import: "./esm/index.js",
              require: "./cjs/index.js",
            },
          },
        }),
        "node_modules/@test/modern/esm/index.js": `
          export { Component } from './Component.js';
        `,
        "node_modules/@test/modern/esm/Component.js": `
          export const Component = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/modern", "/project");

      // Should resolve "import" condition (ESM-first)
      expect(importMap.has("Component")).toBe(true);
      const componentPath = importMap.get("Component");
      expect(componentPath).toContain("esm");
    });

    it("should handle deeply nested barrel files (3+ levels)", async () => {
      // Structure: index.js → sub/index.js → components/index.js → Button.js, Modal.js
      // This tests DFS traversal through multiple levels of barrel re-exports
      mockFileSystem({
        "node_modules/@test/nested/package.json": JSON.stringify({
          name: "@test/nested",
          main: "./index.js",
        }),
        // Level 1: Root barrel
        "node_modules/@test/nested/index.js": `
          export * from './sub/index.js';
          export { RootUtil } from './utils.js';
        `,
        "node_modules/@test/nested/utils.js": `
          export const RootUtil = () => {};
        `,
        // Level 2: Sub-barrel
        "node_modules/@test/nested/sub/index.js": `
          export * from './components/index.js';
          export { SubHelper } from './helpers.js';
        `,
        "node_modules/@test/nested/sub/helpers.js": `
          export const SubHelper = () => {};
        `,
        // Level 3: Components barrel
        "node_modules/@test/nested/sub/components/index.js": `
          export { Button } from './Button.js';
          export { Modal } from './Modal.js';
          export * from './forms/index.js';
        `,
        "node_modules/@test/nested/sub/components/Button.js": `
          export const Button = () => {};
        `,
        "node_modules/@test/nested/sub/components/Modal.js": `
          export const Modal = () => {};
        `,
        // Level 4: Even deeper nesting
        "node_modules/@test/nested/sub/components/forms/index.js": `
          export { Input } from './Input.js';
          export { Select } from './Select.js';
        `,
        "node_modules/@test/nested/sub/components/forms/Input.js": `
          export const Input = () => {};
        `,
        "node_modules/@test/nested/sub/components/forms/Select.js": `
          export const Select = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const startTime = Date.now();
      const importMap = await analyzeLibrary("@test/nested", "/project");
      const elapsed = Date.now() - startTime;

      // Should complete quickly despite deep nesting
      expect(elapsed).toBeLessThan(2000);

      // Level 1 exports
      expect(importMap.has("RootUtil")).toBe(true);

      // Level 2 exports (via star re-export)
      expect(importMap.has("SubHelper")).toBe(true);

      // Level 3 exports (via nested star re-export)
      expect(importMap.has("Button")).toBe(true);
      expect(importMap.has("Modal")).toBe(true);

      // Level 4 exports (via deeply nested star re-export)
      expect(importMap.has("Input")).toBe(true);
      expect(importMap.has("Select")).toBe(true);

      // Verify paths point to actual source files (not intermediate barrels)
      const buttonPath = importMap.get("Button");
      expect(buttonPath).toContain("Button.js");
      expect(buttonPath).toContain("components");

      const inputPath = importMap.get("Input");
      expect(inputPath).toContain("Input.js");
      expect(inputPath).toContain("forms");
    });
  });

  describe("analyzeLibraries (Multi-Library)", () => {
    it("should analyze multiple libraries in parallel", async () => {
      mockFileSystem({
        // Library A
        "node_modules/@test/lib-a/package.json": JSON.stringify({
          name: "@test/lib-a",
          main: "./index.js",
        }),
        "node_modules/@test/lib-a/index.js": `
          export { ComponentA } from './ComponentA.js';
        `,
        "node_modules/@test/lib-a/ComponentA.js": `
          export const ComponentA = () => {};
        `,
        // Library B
        "node_modules/@test/lib-b/package.json": JSON.stringify({
          name: "@test/lib-b",
          main: "./index.js",
        }),
        "node_modules/@test/lib-b/index.js": `
          export { ComponentB } from './ComponentB.js';
        `,
        "node_modules/@test/lib-b/ComponentB.js": `
          export const ComponentB = () => {};
        `,
      });

      const { analyzeLibraries } = await import("../src/core/analyzer.js");

      const libraryMaps = await analyzeLibraries(
        ["@test/lib-a", "@test/lib-b"],
        "/project"
      );

      // Should return a Map with library name as key
      expect(libraryMaps.size).toBe(2);
      expect(libraryMaps.has("@test/lib-a")).toBe(true);
      expect(libraryMaps.has("@test/lib-b")).toBe(true);

      // Each library should have its own ImportMap
      const libAMap = libraryMaps.get("@test/lib-a");
      const libBMap = libraryMaps.get("@test/lib-b");

      expect(libAMap?.has("ComponentA")).toBe(true);
      expect(libBMap?.has("ComponentB")).toBe(true);
    });

    it("should handle empty library array", async () => {
      const { analyzeLibraries } = await import("../src/core/analyzer.js");

      const libraryMaps = await analyzeLibraries([], "/project");

      expect(libraryMaps.size).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty barrel files gracefully", async () => {
      mockFileSystem({
        "node_modules/@test/empty/package.json": JSON.stringify({
          name: "@test/empty",
          main: "./index.js",
        }),
        "node_modules/@test/empty/index.js": `
          // Empty barrel file
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/empty", "/project");

      // Should return empty map without errors
      expect(importMap.size).toBe(0);
    });

    it("should capture direct exports from star re-exported modules", async () => {
      // This tests lines 386-391: star source's own namedExports
      mockFileSystem({
        "node_modules/@test/star-direct/package.json": JSON.stringify({
          name: "@test/star-direct",
          main: "./index.js",
        }),
        "node_modules/@test/star-direct/index.js": `
          export * from './utils.js';
        `,
        // The utils.js file has DIRECT exports (not re-exports)
        // These should be captured by the parseModuleExports call in line 387
        "node_modules/@test/star-direct/utils.js": `
          export const formatDate = () => {};
          export const parseDate = () => {};
          export function debounce() {}
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-direct", "/project");

      // Direct exports from star source should be discovered
      expect(importMap.has("formatDate")).toBe(true);
      expect(importMap.has("parseDate")).toBe(true);
      expect(importMap.has("debounce")).toBe(true);

      // All should point to utils.js
      const formatPath = importMap.get("formatDate");
      expect(formatPath).toContain("utils.js");
    });

    it("should gracefully handle parse errors in star re-export sources", async () => {
      // This tests lines 393-395: catch block for parse errors
      // We simulate a file that exists but causes parse errors
      const originalReadFile = mockedFs.readFile;

      mockedFs.readFile.mockImplementation(async (filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, "/");

        if (normalizedPath.includes("package.json")) {
          return JSON.stringify({
            name: "@test/parse-error",
            main: "./index.js",
          });
        }

        if (normalizedPath.includes("index.js")) {
          return `export * from './broken.js';`;
        }

        if (normalizedPath.includes("broken.js")) {
          // Return syntactically invalid JS that will cause parse error
          return `export const { invalid syntax here `;
        }

        throw new Error(`ENOENT: ${filePath}`);
      });

      mockedFs.stat.mockImplementation(async (filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, "/");
        if (
          normalizedPath.includes("package.json") ||
          normalizedPath.includes("index.js") ||
          normalizedPath.includes("broken.js")
        ) {
          return { isFile: () => true } as fs.Stats;
        }
        throw new Error(`ENOENT: ${filePath}`);
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      // Should NOT throw - errors are caught and ignored
      const importMap = await analyzeLibrary("@test/parse-error", "/project");

      // Should return empty or partial map without crashing
      expect(importMap).toBeDefined();
      expect(importMap instanceof Map).toBe(true);
    });

    it("should handle re-exports from external packages", async () => {
      mockFileSystem({
        "node_modules/@test/external/package.json": JSON.stringify({
          name: "@test/external",
          main: "./index.js",
        }),
        "node_modules/@test/external/index.js": `
          export { useState } from 'react';
          export { MyComponent } from './MyComponent.js';
        `,
        "node_modules/@test/external/MyComponent.js": `
          export const MyComponent = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/external", "/project");

      // External re-exports are captured as named exports (the export statement is parsed)
      // This is expected behavior - the analyzer captures what's exported from the barrel
      expect(importMap.has("useState")).toBe(true);
      // Should include local exports
      expect(importMap.has("MyComponent")).toBe(true);
    });

    it("should handle null export names from es-module-lexer (star exports)", async () => {
      // This test covers lines 257-261: when exp.n === null
      // es-module-lexer returns null for export names in certain edge cases
      // like `export * from './module'` where the actual names are resolved later
      mockFileSystem({
        "node_modules/@test/null-export/package.json": JSON.stringify({
          name: "@test/null-export",
          main: "./index.js",
        }),
        // A file with only star exports - es-module-lexer may return null for exp.n
        "node_modules/@test/null-export/index.js": `
          export * from './utils.js';
          export * from './helpers.js';
        `,
        "node_modules/@test/null-export/utils.js": `
          export const utilA = () => {};
          export const utilB = () => {};
        `,
        "node_modules/@test/null-export/helpers.js": `
          export const helperA = () => {};
          export const helperB = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/null-export", "/project");

      // Even with null export names from star exports, should discover all exports
      expect(importMap.has("utilA")).toBe(true);
      expect(importMap.has("utilB")).toBe(true);
      expect(importMap.has("helperA")).toBe(true);
      expect(importMap.has("helperB")).toBe(true);
    });

    it("should handle star source with new exports not in map (lines 418-420)", async () => {
      // This specifically tests the code path where star source has direct exports
      // that haven't been added to the map yet
      mockFileSystem({
        "node_modules/@test/star-new/package.json": JSON.stringify({
          name: "@test/star-new",
          main: "./index.js",
        }),
        "node_modules/@test/star-new/index.js": `
          export * from './moduleA.js';
        `,
        // moduleA has a star re-export AND direct exports
        "node_modules/@test/star-new/moduleA.js": `
          export * from './moduleB.js';
          export const directExportA = 'a';
          export function directFuncA() {}
        `,
        "node_modules/@test/star-new/moduleB.js": `
          export const fromModuleB = 'b';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-new", "/project");

      // Direct exports from star source should be captured
      expect(importMap.has("directExportA")).toBe(true);
      expect(importMap.has("directFuncA")).toBe(true);
      expect(importMap.has("fromModuleB")).toBe(true);

      // Verify paths are correct
      const directPath = importMap.get("directExportA");
      expect(directPath).toContain("moduleA.js");
    });

    it("should use custom logger when provided", async () => {
      const warnings: string[] = [];
      const debugMessages: string[] = [];

      mockFileSystem({
        "node_modules/@test/logger/package.json": JSON.stringify({
          name: "@test/logger",
          main: "./index.js",
        }),
        "node_modules/@test/logger/index.js": `
          export { Component } from './Component.js';
        `,
        "node_modules/@test/logger/Component.js": `
          export const Component = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/logger", "/project", {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: (msg) => debugMessages.push(msg),
        },
      });

      // Should successfully analyze
      expect(importMap.has("Component")).toBe(true);
    });

    it("should handle star exports with only re-exports (lines 257-261)", async () => {
      // This test specifically targets the case where es-module-lexer
      // returns exports with null names (star re-exports)
      mockFileSystem({
        "node_modules/@test/star-only/package.json": JSON.stringify({
          name: "@test/star-only",
          main: "./index.js",
        }),
        // Index file with ONLY star exports, no named exports
        "node_modules/@test/star-only/index.js": `
          export * from './a.js';
          export * from './b.js';
          export * from './c.js';
        `,
        "node_modules/@test/star-only/a.js": `
          export const funcA = () => 'a';
        `,
        "node_modules/@test/star-only/b.js": `
          export const funcB = () => 'b';
        `,
        "node_modules/@test/star-only/c.js": `
          export const funcC = () => 'c';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-only", "/project");

      // All exports should be discovered through star re-exports
      expect(importMap.has("funcA")).toBe(true);
      expect(importMap.has("funcB")).toBe(true);
      expect(importMap.has("funcC")).toBe(true);
    });

    it("should add star source direct exports when not already mapped (lines 418-420)", async () => {
      // This test specifically targets the branch at line 418:
      // if (!ctx.importMap.has(name)) { ctx.importMap.set(name, resolvedSource); }
      mockFileSystem({
        "node_modules/@test/star-priority/package.json": JSON.stringify({
          name: "@test/star-priority",
          main: "./index.js",
        }),
        "node_modules/@test/star-priority/index.js": `
          export * from './utils.js';
        `,
        // utils.js has ONLY direct exports (no re-exports)
        // These should trigger line 417-420 where we parse star source
        // and add its namedExports to the map
        "node_modules/@test/star-priority/utils.js": `
          export const utilOne = 1;
          export const utilTwo = 2;
          export function utilThree() {}
          export class UtilFour {}
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-priority", "/project");

      // All direct exports from star source should be mapped
      expect(importMap.has("utilOne")).toBe(true);
      expect(importMap.has("utilTwo")).toBe(true);
      expect(importMap.has("utilThree")).toBe(true);
      expect(importMap.has("UtilFour")).toBe(true);

      // All should point to utils.js
      expect(importMap.get("utilOne")).toContain("utils.js");
      expect(importMap.get("utilTwo")).toContain("utils.js");
    });

    it("should not override existing map entries for star source exports (line 418 else branch)", async () => {
      // This tests the case where a name is already in the map
      // so line 418's condition is false and we skip setting
      mockFileSystem({
        "node_modules/@test/star-existing/package.json": JSON.stringify({
          name: "@test/star-existing",
          main: "./index.js",
        }),
        // Named re-export takes precedence over star re-export
        "node_modules/@test/star-existing/index.js": `
          export { shared } from './specific.js';
          export * from './general.js';
        `,
        "node_modules/@test/star-existing/specific.js": `
          export const shared = 'specific';
        `,
        // general.js also exports 'shared' but should NOT override
        "node_modules/@test/star-existing/general.js": `
          export const shared = 'general';
          export const unique = 'unique';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-existing", "/project");

      // 'shared' should point to specific.js (first definition wins)
      expect(importMap.get("shared")).toContain("specific.js");
      // 'unique' should still be captured from general.js
      expect(importMap.has("unique")).toBe(true);
    });

    it("should handle re-exports with as aliases (line 286 asMatch branch)", async () => {
      // This tests the alias handling in re-exports: export { Foo as Bar }
      mockFileSystem({
        "node_modules/@test/alias/package.json": JSON.stringify({
          name: "@test/alias",
          main: "./index.js",
        }),
        "node_modules/@test/alias/index.js": `
          export { original as aliased } from './source.js';
          export { noAlias } from './source.js';
          export { a as b, c as d, e } from './multi.js';
        `,
        "node_modules/@test/alias/source.js": `
          export const original = 'original';
          export const noAlias = 'noAlias';
        `,
        "node_modules/@test/alias/multi.js": `
          export const a = 'a';
          export const c = 'c';
          export const e = 'e';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/alias", "/project");

      // Aliased exports should use the exported name
      expect(importMap.has("aliased")).toBe(true);
      expect(importMap.has("noAlias")).toBe(true);
      expect(importMap.has("b")).toBe(true);
      expect(importMap.has("d")).toBe(true);
      expect(importMap.has("e")).toBe(true);
      // Original names are also captured from the source file traversal
      expect(importMap.has("original")).toBe(true);
    });

    it("should handle default re-exports (export { default as Name })", async () => {
      mockFileSystem({
        "node_modules/@test/default-reexport/package.json": JSON.stringify({
          name: "@test/default-reexport",
          main: "./index.js",
        }),
        "node_modules/@test/default-reexport/index.js": `
          export { default as MyDefault } from './defaultExport.js';
        `,
        "node_modules/@test/default-reexport/defaultExport.js": `
          export default function defaultFn() {}
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/default-reexport", "/project");

      // Default re-exported as named should work
      expect(importMap.has("MyDefault")).toBe(true);
    });

    it("should handle pure star re-export file (lines 257-261 exp.n null case)", async () => {
      // This test creates a barrel file with ONLY star exports
      // es-module-lexer returns null for exp.n with star exports
      mockFileSystem({
        "node_modules/@test/pure-star/package.json": JSON.stringify({
          name: "@test/pure-star",
          main: "./index.js",
        }),
        // File with ONLY star exports - no named exports
        "node_modules/@test/pure-star/index.js": `export * from './a.js';
export * from './b.js';`,
        "node_modules/@test/pure-star/a.js": `export const fromA = 1;`,
        "node_modules/@test/pure-star/b.js": `export const fromB = 2;`,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/pure-star", "/project");

      // Exports should be discovered via star re-exports
      expect(importMap.has("fromA")).toBe(true);
      expect(importMap.has("fromB")).toBe(true);
    });

    it("should handle file resolution failure gracefully", async () => {
      // This tests error handling when a re-exported file doesn't exist
      mockFileSystem({
        "node_modules/@test/missing/package.json": JSON.stringify({
          name: "@test/missing",
          main: "./index.js",
        }),
        "node_modules/@test/missing/index.js": `
          export { Missing } from './nonexistent.js';
          export { Exists } from './exists.js';
        `,
        "node_modules/@test/missing/exists.js": `
          export const Exists = 'exists';
        `,
        // Note: nonexistent.js is NOT in the mock file system
      });

      const warnings: string[] = [];
      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/missing", "/project", {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: () => {},
        },
      });

      // Should still capture the existing export
      expect(importMap.has("Exists")).toBe(true);
      // Missing export may or may not be in map depending on error handling
      // Key: should not throw
      expect(importMap).toBeDefined();
    });

    it("should handle star re-export to missing file", async () => {
      mockFileSystem({
        "node_modules/@test/star-missing/package.json": JSON.stringify({
          name: "@test/star-missing",
          main: "./index.js",
        }),
        "node_modules/@test/star-missing/index.js": `
          export * from './missing.js';
          export { Good } from './good.js';
        `,
        "node_modules/@test/star-missing/good.js": `
          export const Good = 'good';
        `,
        // Note: missing.js is NOT in the mock file system
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/star-missing", "/project");

      // Should still capture the good export
      expect(importMap.has("Good")).toBe(true);
      // Should not throw even with missing star source
      expect(importMap).toBeDefined();
    });

    it("should resolve deeply nested conditional exports", async () => {
      mockFileSystem({
        "node_modules/@test/nested-exports/package.json": JSON.stringify({
          name: "@test/nested-exports",
          exports: {
            ".": {
              import: {
                types: "./dist/types/index.d.ts",
                default: "./dist/esm/index.js",
              },
              require: "./dist/cjs/index.js",
            },
          },
        }),
        "node_modules/@test/nested-exports/dist/esm/index.js": `
          export { Component } from './Component.js';
        `,
        "node_modules/@test/nested-exports/dist/esm/Component.js": `
          export const Component = () => {};
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/nested-exports", "/project");

      // Should resolve through nested conditional exports
      expect(importMap.has("Component")).toBe(true);
    });

    it("should handle package with only types field (no main)", async () => {
      mockFileSystem({
        "node_modules/@test/types-only/package.json": JSON.stringify({
          name: "@test/types-only",
          types: "./index.d.ts",
          module: "./index.js",
        }),
        "node_modules/@test/types-only/index.js": `
          export const TypesOnly = 'works';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/types-only", "/project");

      expect(importMap.has("TypesOnly")).toBe(true);
    });

    it("should handle extensionless imports that resolve to .js", async () => {
      mockFileSystem({
        "node_modules/@test/extensionless/package.json": JSON.stringify({
          name: "@test/extensionless",
          main: "./index.js",
        }),
        "node_modules/@test/extensionless/index.js": `
          export { Util } from './util';
        `,
        "node_modules/@test/extensionless/util.js": `
          export const Util = 'util';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/extensionless", "/project");

      expect(importMap.has("Util")).toBe(true);
    });

    it("should handle directory imports with index file", async () => {
      mockFileSystem({
        "node_modules/@test/dir-index/package.json": JSON.stringify({
          name: "@test/dir-index",
          main: "./index.js",
        }),
        "node_modules/@test/dir-index/index.js": `
          export { SubModule } from './subdir';
        `,
        "node_modules/@test/dir-index/subdir/index.js": `
          export const SubModule = 'from subdir';
        `,
      });

      const { analyzeLibrary } = await import("../src/core/analyzer.js");

      const importMap = await analyzeLibrary("@test/dir-index", "/project");

      expect(importMap.has("SubModule")).toBe(true);
    });
  });
});

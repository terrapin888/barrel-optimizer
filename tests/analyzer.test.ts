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

    it("should skip non-relative imports in re-exports", async () => {
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

      // Should NOT include external package exports
      expect(importMap.has("useState")).toBe(false);
      // Should include local exports
      expect(importMap.has("MyComponent")).toBe(true);
    });
  });
});

/**
 * Transformer Module Unit Tests
 *
 * Tests focus on:
 * 1. Alias handling (import { Foo as Bar })
 * 2. Bail-out on namespace imports (import * as X)
 * 3. Side-effect import preservation
 * 4. Multiple imports splitting
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "../src/core/transformer.js";
import type { ImportMap } from "../src/core/analyzer.js";

/**
 * Helper to create a mock ImportMap
 */
function createMockImportMap(entries: [string, string][]): ImportMap {
  return new Map(entries);
}

/**
 * Suppress console warnings during tests
 */
const silentLogger = {
  warn: () => {},
  debug: () => {},
};

describe("Transformer Module", () => {
  describe("transformCode", () => {
    it("should transform barrel imports to direct imports", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button/Button.js"],
        ["TextField", "/project/node_modules/@mui/material/esm/TextField/TextField.js"],
      ]);

      const code = `import { Button, TextField } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      expect(result.code).toContain("@mui/material/Button");
      expect(result.code).toContain("@mui/material/TextField");
      expect(result.optimized.length).toBe(1);
      expect(result.optimized[0]?.rewrites.length).toBe(2);
    });

    it("should handle import aliases correctly", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@toss/ui/dist/Button.js"],
        ["Modal", "/project/node_modules/@toss/ui/dist/Modal.js"],
      ]);

      const code = `import { Button as TossButton, Modal as Dialog } from '@toss/ui';`;

      const result = transformCode(code, importMap, ["@toss/ui"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Should preserve alias in the output
      expect(result.code).toContain("TossButton");
      expect(result.code).toContain("Dialog");
      // Should use direct import paths
      expect(result.code).toContain("@toss/ui/Button");
      expect(result.code).toContain("@toss/ui/Modal");
    });

    it("should BAIL-OUT on namespace imports (import * as)", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `import * as MUI from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // Should NOT transform namespace imports
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]?.reason).toContain("Namespace import");
    });

    it("should preserve side-effect imports unchanged", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `import '@mui/material/styles';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // Side-effect imports should be preserved
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
    });

    it("should NOT transform subpath imports (already optimized)", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // This is already a direct import, should not be transformed
      const code = `import { Button } from '@mui/material/Button';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // Subpath imports are already optimized
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
    });

    it("should handle mixed imports with default and named", () => {
      const importMap = createMockImportMap([
        ["styled", "/project/node_modules/@mui/material/esm/styles/styled.js"],
      ]);

      // Note: Default imports from barrel files are preserved
      const code = `import MUI, { styled } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // Named import should be transformed
      expect(result.transformed).toBe(true);
      expect(result.code).toContain("@mui/material/styles/styled");
    });

    it("should handle multiple barrel imports in the same file", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
        ["chunk", "/project/node_modules/lodash-es/chunk.js"],
      ]);

      const code = `
import { Button } from '@mui/material';
import { chunk } from 'lodash-es';
const x = 1;
`;

      const result = transformCode(code, importMap, ["@mui/material", "lodash-es"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      expect(result.code).toContain("@mui/material/Button");
      expect(result.code).toContain("lodash-es/chunk");
      expect(result.optimized.length).toBe(2);
    });

    it("should warn for exports not found in ImportMap", () => {
      const warnings: string[] = [];
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // TextField is NOT in the import map
      const code = `import { Button, TextField } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: () => {},
        },
      });

      // Button should be transformed, TextField should trigger warning
      expect(result.transformed).toBe(true);
      expect(warnings.some((w) => w.includes("TextField"))).toBe(true);
    });

    it("should handle empty import specifiers (type-only)", () => {
      const importMap = createMockImportMap([
        ["ButtonProps", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `import type { ButtonProps } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        filename: "test.ts",
        logger: silentLogger,
      });

      // Type-only imports should be handled
      expect(result.code).toBeDefined();
    });

    it("should strip dist/esm folders from output paths", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button/Button.js"],
      ]);

      const code = `import { Button } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Should NOT include 'esm' in the output path
      expect(result.code).not.toContain("/esm/");
      // Should produce clean path like @mui/material/Button
      expect(result.code).toContain("@mui/material/Button");
    });
  });

  describe("Edge Cases", () => {
    it("should handle scoped packages correctly", () => {
      const importMap = createMockImportMap([
        ["useToggle", "/project/node_modules/@toss/react/dist/hooks/useToggle.js"],
      ]);

      const code = `import { useToggle } from '@toss/react';`;

      const result = transformCode(code, importMap, ["@toss/react"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      expect(result.code).toContain("@toss/react/");
    });

    it("should handle Windows paths correctly", () => {
      const importMap = createMockImportMap([
        ["Button", "C:\\Users\\test\\project\\node_modules\\@mui\\material\\esm\\Button.js"],
      ]);

      const code = `import { Button } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Should normalize to forward slashes
      expect(result.code).not.toContain("\\");
      expect(result.code).toContain("@mui/material/Button");
    });

    it("should not transform non-target libraries", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `import { useState } from 'react';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // React is not a target library
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
    });

    it("should handle index file deduplication", () => {
      const importMap = createMockImportMap([
        ["theme", "/project/node_modules/@mui/material/esm/styles/index.js"],
      ]);

      const code = `import { theme } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Should produce @mui/material/styles (not @mui/material/styles/index)
      expect(result.code).not.toContain("index");
    });
  });

  describe("Safety Guarantees", () => {
    it("should never lose imports during transformation", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
        ["TextField", "/project/node_modules/@mui/material/esm/TextField.js"],
        ["Modal", "/project/node_modules/@mui/material/esm/Modal.js"],
      ]);

      const code = `import { Button, TextField, Modal } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // All three imports should be present in output
      expect(result.code).toContain("Button");
      expect(result.code).toContain("TextField");
      expect(result.code).toContain("Modal");
    });

    it("should preserve non-import statements", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `
import { Button } from '@mui/material';

const MyComponent = () => {
  return <Button>Click me</Button>;
};

export default MyComponent;
`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        filename: "test.tsx",
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Component code should be preserved
      expect(result.code).toContain("MyComponent");
      expect(result.code).toContain("export default");
    });
  });
});

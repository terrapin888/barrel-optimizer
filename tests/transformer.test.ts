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
import { transformCode, transformFiles, createTransformer } from "../src/core/transformer.js";
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

      const warnings: string[] = [];
      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: () => {},
        },
      });

      // Should NOT transform namespace imports
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]?.reason).toContain("Namespace import");
      expect(result.skipped[0]?.source).toBe("@mui/material");
      // Should also warn about namespace import (covers line 345-348)
      expect(warnings.some((w) => w.includes("Namespace import"))).toBe(true);
    });

    it("should track skipped side-effect imports in result.skipped (lines 358-364)", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // Side-effect import from exact target library (root barrel)
      const code = `import '@mui/material';`;

      const debugMessages: string[] = [];
      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: {
          warn: () => {},
          debug: (msg) => debugMessages.push(msg),
        },
      });

      // Should NOT transform side-effect imports
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
      // Side-effect imports should be tracked in skipped array (lines 359-363)
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]?.reason).toContain("Side-effect");
      expect(result.skipped[0]?.source).toBe("@mui/material");
      // Should log debug message (line 358)
      expect(debugMessages.some((m) => m.toLowerCase().includes("side-effect"))).toBe(true);
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

    it("should handle mixed value and type imports correctly", () => {
      // Tests: import { Button, type ButtonProps } from 'lib';
      // Only the value import (Button) should be transformed
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button/Button.js"],
        ["ButtonProps", "/project/node_modules/@mui/material/esm/Button/Button.js"],
      ]);

      const code = `import { Button, type ButtonProps } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        filename: "test.ts",
        logger: silentLogger,
      });

      // Value import should be transformed
      expect(result.transformed).toBe(true);
      expect(result.code).toContain("@mui/material/Button");

      // The type import should be preserved (either inline or separate)
      // Key: We should not lose the type import
      expect(result.code).toContain("ButtonProps");
    });

    it("should skip inline type imports during transformation", () => {
      // Tests that inline type specifiers (type X) are correctly identified
      const importMap = createMockImportMap([
        ["useCallback", "/project/node_modules/react/esm/useCallback.js"],
        ["ReactNode", "/project/node_modules/react/esm/types.js"],
        ["FC", "/project/node_modules/react/esm/types.js"],
      ]);

      const code = `import { useCallback, type ReactNode, type FC } from 'react';`;

      const result = transformCode(code, importMap, ["react"], {
        filename: "test.tsx",
        logger: silentLogger,
      });

      // Should transform the value import
      expect(result.code).toContain("useCallback");

      // Type imports should be preserved (not lost)
      expect(result.code).toContain("ReactNode");
      expect(result.code).toContain("FC");
    });

    it("should handle type-only import statements separately", () => {
      // Tests: import type { ButtonProps } from 'lib';
      // These are statement-level type imports, not inline
      const importMap = createMockImportMap([
        ["ButtonProps", "/project/node_modules/@mui/material/esm/Button/Button.js"],
      ]);

      const code = `import type { ButtonProps, ModalProps } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        filename: "test.ts",
        logger: silentLogger,
      });

      // Type-only imports may or may not be transformed (depends on implementation)
      // Key guarantee: they should not cause errors and should be preserved
      expect(result.code).toContain("ButtonProps");
      expect(result.code).toContain("ModalProps");
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

  describe("transformFiles (Batch Processing)", () => {
    it("should transform multiple files in batch", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
        ["TextField", "/project/node_modules/@mui/material/esm/TextField.js"],
      ]);

      const files = new Map<string, string>([
        ["src/ComponentA.tsx", `import { Button } from '@mui/material';`],
        ["src/ComponentB.tsx", `import { TextField } from '@mui/material';`],
        ["src/ComponentC.tsx", `import { useState } from 'react';`], // Not transformed
      ]);

      const results = transformFiles(files, importMap, ["@mui/material"]);

      // Should return results for all files
      expect(results.size).toBe(3);

      // ComponentA should be transformed
      const resultA = results.get("src/ComponentA.tsx");
      expect(resultA?.transformed).toBe(true);
      expect(resultA?.code).toContain("@mui/material/Button");

      // ComponentB should be transformed
      const resultB = results.get("src/ComponentB.tsx");
      expect(resultB?.transformed).toBe(true);
      expect(resultB?.code).toContain("@mui/material/TextField");

      // ComponentC should NOT be transformed (react is not target)
      const resultC = results.get("src/ComponentC.tsx");
      expect(resultC?.transformed).toBe(false);
    });

    it("should handle empty file map", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const files = new Map<string, string>();

      const results = transformFiles(files, importMap, ["@mui/material"]);

      expect(results.size).toBe(0);
    });
  });

  describe("createTransformer (Factory Function)", () => {
    it("should create a reusable transformer function", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
        ["TextField", "/project/node_modules/@mui/material/esm/TextField.js"],
      ]);

      const transform = createTransformer(importMap, ["@mui/material"]);

      // Use the transformer multiple times
      const result1 = transform(`import { Button } from '@mui/material';`);
      const result2 = transform(`import { TextField } from '@mui/material';`);

      expect(result1.transformed).toBe(true);
      expect(result1.code).toContain("@mui/material/Button");

      expect(result2.transformed).toBe(true);
      expect(result2.code).toContain("@mui/material/TextField");
    });

    it("should accept optional filename parameter", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const transform = createTransformer(importMap, ["@mui/material"]);

      // Call with filename
      const result = transform(
        `import { Button } from '@mui/material';`,
        "MyComponent.tsx"
      );

      expect(result.transformed).toBe(true);
    });

    it("should work without explicit target libraries", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // Create transformer without specifying target libraries
      // Should auto-detect from ImportMap
      const transform = createTransformer(importMap);

      const result = transform(`import { Button } from '@mui/material';`);

      // Should still transform if library is detected from paths
      expect(result).toBeDefined();
    });
  });

  describe("Error Handling Paths", () => {
    it("should handle parse errors gracefully (lines 491-494)", () => {
      // This tests the catch block at lines 491-494 when SWC parseSync fails
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // Syntactically invalid JavaScript that will cause SWC to throw
      const invalidCode = `import { Button from '@mui/material'; const x = {`;

      const warnings: string[] = [];
      const result = transformCode(invalidCode, importMap, ["@mui/material"], {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: () => {},
        },
      });

      // Should NOT throw - errors are caught and handled gracefully
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(invalidCode); // Original code returned
      expect(warnings.some((w) => w.includes("Failed to parse"))).toBe(true);
    });

    it("should handle severely malformed code without crashing", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      // Various types of malformed code
      const malformedCodes = [
        `import { Button } from '@mui/material' const x`,  // Missing semicolon in unusual place
        `import { from '@mui/material';`,                   // Missing identifier
        `import @mui/material;`,                            // Invalid syntax
        `{{{`,                                              // Just brackets
      ];

      for (const badCode of malformedCodes) {
        const result = transformCode(badCode, importMap, ["@mui/material"], {
          logger: silentLogger,
        });

        // Should never throw, should return original code
        expect(result).toBeDefined();
        expect(result.transformed).toBe(false);
      }
    });

    it("should handle code with only comments", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `
// This is a comment
/* Multi-line
   comment */
`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // No imports to transform
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
    });

    it("should handle empty string input", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const result = transformCode("", importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(false);
      expect(result.code).toBe("");
    });

    it("should handle whitespace-only input", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const result = transformCode("   \n\t\n   ", importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(false);
    });

    it("should handle code without any imports", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `
const x = 1;
function foo() { return x; }
export default foo;
`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
    });

    it("should skip imports with only default specifier (lines 370-375)", () => {
      // This tests the code path where namedSpecifiers.length === 0
      // i.e., only default import without any named imports
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `import MUI from '@mui/material';`;

      const debugMessages: string[] = [];
      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: {
          warn: () => {},
          debug: (msg) => debugMessages.push(msg),
        },
      });

      // Should not transform default-only imports
      expect(result.transformed).toBe(false);
      expect(result.code).toBe(code);
      // Should log debug message about skipping
      expect(debugMessages.some((m) => m.includes("no named specifiers"))).toBe(true);
    });
  });

  describe("Path Conversion Edge Cases", () => {
    it("should handle paths without node_modules", () => {
      const importMap = createMockImportMap([
        ["Button", "/some/random/path/Button.js"],
      ]);

      const code = `import { Button } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      // Should still work, returning the path as-is
      expect(result.transformed).toBe(true);
    });

    it("should handle non-scoped packages", () => {
      const importMap = createMockImportMap([
        ["chunk", "/project/node_modules/lodash-es/chunk.js"],
        ["debounce", "/project/node_modules/lodash-es/debounce.js"],
      ]);

      const code = `import { chunk, debounce } from 'lodash-es';`;

      const result = transformCode(code, importMap, ["lodash-es"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      expect(result.code).toContain("lodash-es/chunk");
      expect(result.code).toContain("lodash-es/debounce");
    });

    it("should handle deeply nested dist paths", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/dist/components/Button/Button.js"],
      ]);

      const code = `import { Button } from '@mui/material';`;

      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: silentLogger,
      });

      expect(result.transformed).toBe(true);
      // Should strip dist folder
      expect(result.code).not.toContain("/dist/");
      // Should produce clean path
      expect(result.code).toContain("@mui/material/components/Button");
    });

    it("should handle path at package root (lines 178-180)", () => {
      // This tests when pathAfterPackage.length === 0
      // The path points directly to the package with no subpath
      const importMap = createMockImportMap([
        ["default", "/project/node_modules/lodash-es/index.js"],
      ]);

      const code = `import { default as _ } from 'lodash-es';`;

      const result = transformCode(code, importMap, ["lodash-es"], {
        logger: silentLogger,
      });

      // Should handle the edge case where export is at package root
      expect(result).toBeDefined();
    });

    it("should handle multiple namespace imports in same file", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
        ["chunk", "/project/node_modules/lodash-es/chunk.js"],
      ]);

      const code = `
import * as MUI from '@mui/material';
import * as _ from 'lodash-es';
const x = MUI.Button;
`;

      const warnings: string[] = [];
      const result = transformCode(code, importMap, ["@mui/material", "lodash-es"], {
        logger: {
          warn: (msg) => warnings.push(msg),
          debug: () => {},
        },
      });

      // Both namespace imports should be skipped and tracked
      expect(result.transformed).toBe(false);
      expect(result.skipped.length).toBe(2);
      expect(warnings.length).toBe(2);
    });

    it("should handle mixed side-effect and named imports", () => {
      const importMap = createMockImportMap([
        ["Button", "/project/node_modules/@mui/material/esm/Button.js"],
      ]);

      const code = `
import '@mui/material';
import { Button } from '@mui/material';
`;

      const debugMessages: string[] = [];
      const result = transformCode(code, importMap, ["@mui/material"], {
        logger: {
          warn: () => {},
          debug: (msg) => debugMessages.push(msg),
        },
      });

      // Named import should be transformed, side-effect should be skipped
      expect(result.transformed).toBe(true);
      expect(result.skipped.length).toBe(1);
      expect(result.optimized.length).toBe(1);
    });
  });
});

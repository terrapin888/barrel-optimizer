# API Reference

This document describes the programmatic API of `barrel-optimizer` for use as a library in your build tools, plugins, or custom scripts.

## Installation

```bash
npm install barrel-optimizer
```

## Quick Start

```typescript
import { analyzeLibrary, transformCode } from 'barrel-optimizer';

// Step 1: Build the ImportMap from a library
const importMap = await analyzeLibrary('@mui/material', process.cwd());

// Step 2: Transform source code using the ImportMap
const sourceCode = `import { Button, TextField } from '@mui/material';`;
const result = transformCode(sourceCode, importMap, ['@mui/material']);

console.log(result.code);
// Output:
// import Button from '@mui/material/Button';
// import TextField from '@mui/material/TextField';
```

---

## Core Functions

### `analyzeLibrary`

Analyzes a single library and builds an ImportMap by traversing its barrel file exports.

```typescript
function analyzeLibrary(
  libraryName: string,
  rootPath: string,
  options?: AnalyzeOptions
): Promise<ImportMap>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `libraryName` | `string` | The npm package name (e.g., `'@mui/material'`, `'es-toolkit'`) |
| `rootPath` | `string` | The project root path containing `node_modules` |
| `options` | `AnalyzeOptions` | Optional configuration (see below) |

#### Returns

`Promise<ImportMap>` - A Map where keys are export names and values are absolute file paths.

#### Example

```typescript
import { analyzeLibrary } from 'barrel-optimizer';

const importMap = await analyzeLibrary('@toss/ui', '/path/to/project');

// ImportMap contents:
// Map {
//   'Button' => '/path/to/project/node_modules/@toss/ui/dist/Button.js',
//   'Modal' => '/path/to/project/node_modules/@toss/ui/dist/Modal.js',
//   'useToggle' => '/path/to/project/node_modules/@toss/ui/dist/hooks/useToggle.js'
// }
```

---

### `analyzeLibraries`

Analyzes multiple libraries in parallel and returns a Map of library names to their ImportMaps.

```typescript
function analyzeLibraries(
  libraryNames: string[],
  rootPath: string,
  options?: AnalyzeOptions
): Promise<Map<string, ImportMap>>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `libraryNames` | `string[]` | Array of npm package names |
| `rootPath` | `string` | The project root path containing `node_modules` |
| `options` | `AnalyzeOptions` | Optional configuration |

#### Returns

`Promise<Map<string, ImportMap>>` - A Map where keys are library names and values are their ImportMaps.

#### Example

```typescript
import { analyzeLibraries } from 'barrel-optimizer';

const libraryMaps = await analyzeLibraries(
  ['@mui/material', 'es-toolkit'],
  process.cwd()
);

const muiMap = libraryMaps.get('@mui/material');
const toolkitMap = libraryMaps.get('es-toolkit');
```

---

### `transformCode`

Transforms source code by rewriting barrel imports to direct file imports.

```typescript
function transformCode(
  code: string,
  importMap: ImportMap,
  targetLibraries?: string[],
  options?: {
    filename?: string;
    logger?: { warn: (msg: string) => void; debug: (msg: string) => void };
  }
): TransformResult
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `code` | `string` | The source code to transform |
| `importMap` | `ImportMap` | The ImportMap from `analyzeLibrary` |
| `targetLibraries` | `string[]` | Libraries to optimize (auto-detected if not provided) |
| `options.filename` | `string` | Source filename for error messages |
| `options.logger` | `object` | Custom logger for warnings |

#### Returns

`TransformResult` - An object containing the transformed code and metadata.

#### Example

```typescript
import { analyzeLibrary, transformCode } from 'barrel-optimizer';

const importMap = await analyzeLibrary('@mui/material', process.cwd());

const result = transformCode(
  `import { Button, TextField } from '@mui/material';`,
  importMap,
  ['@mui/material']
);

console.log(result.transformed); // true
console.log(result.code);
// import Button from '@mui/material/Button';
// import TextField from '@mui/material/TextField';

console.log(result.optimized);
// [{ original: '@mui/material', rewrites: ['@mui/material/Button', '@mui/material/TextField'] }]
```

---

### `transformFiles`

Transforms multiple files in batch. Useful for processing entire directories.

```typescript
function transformFiles(
  files: Map<string, string>,
  importMap: ImportMap,
  targetLibraries?: string[]
): Map<string, TransformResult>
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `files` | `Map<string, string>` | Map of filename to source code |
| `importMap` | `ImportMap` | The ImportMap from `analyzeLibrary` |
| `targetLibraries` | `string[]` | Libraries to optimize |

#### Returns

`Map<string, TransformResult>` - Map of filename to transformation results.

#### Example

```typescript
import { analyzeLibrary, transformFiles } from 'barrel-optimizer';

const importMap = await analyzeLibrary('@mui/material', process.cwd());

const files = new Map([
  ['src/Button.tsx', `import { Button } from '@mui/material';`],
  ['src/Form.tsx', `import { TextField, Select } from '@mui/material';`],
]);

const results = transformFiles(files, importMap, ['@mui/material']);

for (const [filename, result] of results) {
  if (result.transformed) {
    console.log(`${filename}: ${result.optimized.length} imports optimized`);
  }
}
```

---

### `createTransformer`

Creates a reusable transformer function with pre-configured ImportMap.

```typescript
function createTransformer(
  importMap: ImportMap,
  targetLibraries?: string[]
): (code: string, filename?: string) => TransformResult
```

#### Parameters

| Name | Type | Description |
|------|------|-------------|
| `importMap` | `ImportMap` | The ImportMap from `analyzeLibrary` |
| `targetLibraries` | `string[]` | Libraries to optimize |

#### Returns

A transform function that only requires source code as input.

#### Example

```typescript
import { analyzeLibrary, createTransformer } from 'barrel-optimizer';

const importMap = await analyzeLibrary('@toss/ui', process.cwd());
const transform = createTransformer(importMap, ['@toss/ui']);

// Use repeatedly without re-specifying importMap
const result1 = transform(`import { Button } from '@toss/ui';`);
const result2 = transform(`import { Modal } from '@toss/ui';`);
```

---

## Types

### `ImportMap`

```typescript
type ImportMap = Map<string, string>;
// Key: Export name (e.g., 'Button')
// Value: Absolute file path (e.g., '/path/to/node_modules/@mui/material/esm/Button.js')
```

### `AnalyzeOptions`

```typescript
interface AnalyzeOptions {
  /** Custom logger for warnings and debug messages. Silent by default. */
  logger?: AnalyzerLogger;
}
```

### `AnalyzerLogger`

```typescript
interface AnalyzerLogger {
  warn: (message: string, error?: unknown) => void;
  debug?: (message: string) => void;
}
```

### `TransformResult`

```typescript
interface TransformResult {
  /** The transformed code */
  code: string;
  /** Whether any transformations were applied */
  transformed: boolean;
  /** List of imports that were skipped (with reasons) */
  skipped: Array<{ source: string; reason: string }>;
  /** List of imports that were transformed */
  optimized: Array<{ original: string; rewrites: string[] }>;
}
```

---

## Error Handling

The library is designed to be resilient:

- **Parse errors**: Files that fail to parse are skipped with a warning (if logger provided)
- **Missing exports**: Exports not found in ImportMap trigger a warning but don't fail
- **Circular dependencies**: Handled automatically via DFS visited set

```typescript
const result = transformCode(code, importMap, ['@mui/material'], {
  logger: {
    warn: (msg) => console.warn(`[Warning] ${msg}`),
    debug: (msg) => console.debug(`[Debug] ${msg}`),
  },
});
```

---

## Bail-out Cases

The transformer **skips** certain patterns for safety:

| Pattern | Behavior | Reason |
|---------|----------|--------|
| `import * as UI from '@lib'` | Skip + Warning | Can't determine used exports |
| `import '@lib'` | Skip | Side-effect only import |
| `import '@lib/subpath'` | Skip | Already a direct import |
| Dynamic imports | Skip | Runtime resolution |

```typescript
const result = transformCode(
  `import * as MUI from '@mui/material';`,
  importMap,
  ['@mui/material']
);

console.log(result.transformed); // false
console.log(result.skipped);
// [{ source: '@mui/material', reason: 'Namespace import cannot be optimized' }]
```

---

## See Also

- [Architecture](./ARCHITECTURE.md) - Technical deep-dive into the two-phase pipeline
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
- [README](../README.md) - CLI usage and installation

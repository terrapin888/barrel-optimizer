# Barrel Optimizer - Technical Documentation

## Overview

Barrel Optimizer는 JavaScript/TypeScript 모노레포에서 barrel file로 인한 tree-shaking 실패 문제를 해결하는 Zero-Configuration CLI 도구입니다.

## Problem Statement

### Barrel File이란?

```typescript
// @toss/ui/index.js (Barrel File)
export { Button } from './dist/Button.js';
export { Input } from './dist/Input.js';
export { Modal } from './dist/Modal.js';
export * from './dist/hooks/index.js';
// ... 500+ more exports
```

### 문제점

```typescript
// 사용자 코드
import { Button } from '@toss/ui';  // Button만 사용

// 실제 번들러 동작
// 1. @toss/ui/index.js 전체 로드
// 2. 모든 re-export 파일 파싱
// 3. Tree-shaking 시도하지만 side-effect 판단 어려움
// 4. 결과: 불필요한 코드 포함 (200KB+ → 5KB만 필요)
```

## Architecture

### Two-Phase Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                      Phase 1: Analyzer                       │
│  ┌─────────┐    ┌──────────┐    ┌─────────────────────────┐ │
│  │ Entry   │───▶│   DFS    │───▶│      ImportMap          │ │
│  │ Point   │    │ Traverse │    │ { Button: "dist/..." }  │ │
│  └─────────┘    └──────────┘    └─────────────────────────┘ │
│                      │                                       │
│                      ▼                                       │
│              ┌──────────────┐                               │
│              │   Visited    │  (Circular Dependency 방지)    │
│              │     Set      │                               │
│              └──────────────┘                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Phase 2: Transformer                     │
│  ┌─────────┐    ┌──────────┐    ┌─────────────────────────┐ │
│  │ Source  │───▶│   SWC    │───▶│   Transformed Code      │ │
│  │  Code   │    │   AST    │    │  (Direct Imports)       │ │
│  └─────────┘    └──────────┘    └─────────────────────────┘ │
│                      │                                       │
│                      ▼                                       │
│              ┌──────────────┐                               │
│              │  Bail-out    │  (Namespace Import 감지)       │
│              │   Check      │                               │
│              └──────────────┘                               │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Analyzer (`src/core/analyzer.ts`)

**역할**: 라이브러리의 barrel file을 DFS로 탐색하여 ImportMap 생성

**핵심 알고리즘**:
```typescript
async function dfsAnalyze(filePath: string, ctx: DFSContext): Promise<void> {
  // 1. Cycle Detection
  if (ctx.visited.has(normalizedPath)) return;
  ctx.visited.add(normalizedPath);

  // 2. Parse exports with es-module-lexer (fast, non-AST)
  const parsedExports = await parseModuleExports(normalizedPath);

  // 3. Process re-exports: export { Foo } from './foo'
  for (const reExport of parsedExports.reExports) {
    const resolvedSource = await resolveModulePath(currentDir, reExport.source);
    for (const name of reExport.names) {
      ctx.importMap.set(name, resolvedSource);
    }
    await dfsAnalyze(resolvedSource, ctx);  // Recurse
  }

  // 4. Process star re-exports: export * from './bar'
  for (const starSource of parsedExports.starReExports) {
    await dfsAnalyze(resolvedSource, tempCtx);  // Recurse & merge
  }
}
```

**Entry Point Resolution**:
```typescript
// package.json 필드 우선순위 (ESM-first)
1. exports["."].import
2. exports["."].module
3. exports["."].default
4. module
5. main
6. index.js (fallback)
```

**File Extension Resolution**:
```typescript
const SUPPORTED_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];
const INDEX_FILES = ["index.js", "index.mjs", "index.ts", "index.tsx"];
```

### 2. Transformer (`src/core/transformer.ts`)

**역할**: 사용자 코드의 import문을 직접 파일 경로로 변환

**핵심 로직**:
```typescript
function transformImportDeclaration(node, config, logger, result) {
  // 1. Target library 확인
  if (!isTargetLibrary(source)) return null;

  // 2. BAIL-OUT: Namespace import
  if (hasNamespaceSpecifier(node)) {
    logger.warn(`Skipping: import * as ...`);
    return null;
  }

  // 3. BAIL-OUT: Side-effect import
  if (node.specifiers.length === 0) return null;

  // 4. Transform named imports
  for (const { imported, local } of namedSpecifiers) {
    const resolvedPath = config.importMap.get(imported);
    newImports.push(createDefaultImport(local, resolvedPath));
  }

  return newImports;
}
```

**AST Node 생성**:
```typescript
function createDefaultImport(localName: string, source: string): ImportDeclaration {
  return {
    type: "ImportDeclaration",
    span: { start: 0, end: 0, ctxt: 0 },
    specifiers: [{
      type: "ImportDefaultSpecifier",
      local: {
        type: "Identifier",
        value: localName,
        ctxt: 0,  // SWC 필수 필드
      },
    }],
    source: { type: "StringLiteral", value: source },
    typeOnly: false,
  };
}
```

### 3. CLI (`src/cli/index.ts`)

**Commands**:
```bash
barrel-optimizer analyze <library>     # ImportMap 출력
barrel-optimizer optimize <target>     # 변환 (dry-run)
barrel-optimizer build <target>        # 변환 + 파일 쓰기
```

**Options**:
```
-l, --library <names...>   타겟 라이브러리 (default: @toss/ui)
-w, --write                파일에 변경사항 적용
-v, --verbose              상세 출력
--cwd <path>               작업 디렉토리
```

## Technology Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| Export Parser | `es-module-lexer` | AST 없이 빠른 export 파싱 (10x faster) |
| AST Transform | `@swc/core` | Rust 기반, Babel 대비 20x faster |
| CLI Framework | `commander` | 표준 Node.js CLI 라이브러리 |
| Console Styling | `chalk` | Cross-platform 컬러 출력 |
| Type System | TypeScript (strict) | `noImplicitAny: true` |

## Data Flow

```
1. User runs: barrel-optimizer optimize src/ -l @toss/ui

2. Analyzer:
   node_modules/@toss/ui/package.json
   → exports["."] = "./index.js"
   → index.js: export { Button } from './dist/Button.js'
   → DFS traverse all re-exports
   → ImportMap: { "Button": "/abs/path/to/Button.js" }

3. Transformer:
   src/App.tsx: import { Button } from '@toss/ui'
   → Parse AST with SWC
   → Find ImportDeclaration for '@toss/ui'
   → Check: Named import? (not namespace, not side-effect)
   → Lookup ImportMap: Button → /abs/path/to/Button.js
   → Replace AST node
   → Print back to code

4. Output:
   import Button from "/abs/path/to/Button.js";
```

## Safety Mechanisms

### 1. Bail-out Strategy

| Pattern | Action | Reason |
|---------|--------|--------|
| `import * as X` | Skip | 어떤 export가 사용되는지 알 수 없음 |
| `import 'lib'` | Skip | Side-effect only |
| Export not in map | Keep original | 안전한 fallback |

### 2. Circular Dependency Handling

```typescript
const visited = new Set<string>();

function dfsAnalyze(filePath) {
  if (visited.has(filePath)) return;  // 무한 루프 방지
  visited.add(filePath);
  // ... process
}
```

### 3. Error Recovery

```typescript
try {
  parsedExports = await parseModuleExports(filePath);
} catch (error) {
  console.warn(`[Analyzer] Failed to parse ${filePath}`);
  return;  // Continue with other files
}
```

## Performance Characteristics

| Operation | Complexity | Typical Time |
|-----------|------------|--------------|
| Analyze (500 exports) | O(n) DFS | ~50ms |
| Transform (1 file) | O(m) imports | ~5ms |
| Transform (100 files) | O(n*m) | ~500ms |

## Limitations

1. **Absolute Paths**: 현재 절대 경로로 출력됨 (상대 경로 변환 필요)
2. **Type Imports**: `import type { Props }` 별도 처리 필요
3. **Dynamic Imports**: `import()` 표현식 미지원
4. **CSS Imports**: `import './style.css'` 미처리

## Future Improvements

1. **Relative Path Conversion**: 번들러 호환성 향상
2. **Watch Mode**: 파일 변경 감지 및 자동 변환
3. **Vite/Webpack Plugin**: 빌드 파이프라인 통합
4. **Type-only Import Handling**: TypeScript 완벽 지원
5. **Caching**: 분석 결과 캐싱으로 재빌드 속도 향상

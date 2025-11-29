# Barrel Optimizer - Troubleshooting Log

이 문서는 개발 과정에서 발생한 문제들과 해결 과정을 기록합니다.

---

## Issue #1: TypeScript ESM Import Extension

### 문제
```
error TS2835: Relative import paths need explicit file extensions
in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'.
```

### 원인
`tsconfig.json`에서 `moduleResolution: "NodeNext"`를 사용할 때, ESM 모듈 시스템에서는 상대 경로 import에 명시적 확장자가 필요합니다.

### 해결
```typescript
// Before
import { analyzeLibrary } from "../core/analyzer";

// After
import { analyzeLibrary } from "../core/analyzer.js";
```

**참고**: `.ts` 파일이지만 `.js` 확장자를 사용해야 함 (컴파일 후 경로)

---

## Issue #2: SWC AST Node Missing `ctxt` Field

### 문제
```
Error: missing field `ctxt`
```

Transformer에서 생성한 AST 노드를 `printSync()`로 출력할 때 발생

### 원인
SWC의 `Identifier` 노드에는 `ctxt` (context) 필드가 필수입니다. 이 필드는 scope 정보를 담고 있으며, 생략하면 직렬화 시 에러 발생.

### 해결
```typescript
// Before
local: {
  type: "Identifier",
  span: { start: 0, end: 0, ctxt: 0 },
  value: localName,
  optional: false,
}

// After
local: {
  type: "Identifier",
  span: { start: 0, end: 0, ctxt: 0 },
  value: localName,
  optional: false,
  ctxt: 0,  // 추가!
}
```

---

## Issue #3: Spinner `clearLine` Not a Function

### 문제
```
TypeError: process.stdout.clearLine is not a function
```

CLI의 Spinner가 non-TTY 환경(예: 파이프, 리다이렉트)에서 실행될 때 발생

### 원인
`process.stdout.clearLine()`과 `cursorTo()`는 TTY 전용 메서드입니다. non-TTY 환경에서는 존재하지 않습니다.

### 해결
```typescript
class Spinner {
  private isTTY: boolean;

  constructor(message: string) {
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  start(): void {
    if (this.isTTY) {
      // TTY: 애니메이션 스피너
      process.stdout.clearLine?.(0);
      process.stdout.cursorTo?.(0);
    } else {
      // Non-TTY: 단순 로그
      console.log(`... ${this.message}`);
    }
  }
}
```

**추가**: Optional chaining (`?.`)으로 안전하게 호출

---

## Issue #4: ts-node ESM Compatibility

### 문제
```
TypeError: Unknown file extension ".ts" for .../setup-mock.ts
```

`npx ts-node scripts/setup-mock.ts` 실행 시 발생

### 원인
프로젝트가 `"type": "module"` (ESM)으로 설정되어 있을 때, ts-node가 기본적으로 ESM 모드를 지원하지 않음.

### 해결 방법 1: ts-node ESM loader 사용
```bash
node --loader ts-node/esm scripts/setup-mock.ts
```

### 해결 방법 2: 순수 JavaScript (.mjs) 사용 ✅
```javascript
// scripts/setup-mock.mjs
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**선택 이유**: 의존성 없이 바로 실행 가능

---

## Issue #5: Regex Capture Group Undefined

### 문제
```
error TS18048: 'namesStr' is possibly 'undefined'.
error TS2345: Argument of type 'string | undefined' is not assignable...
```

### 원인
`RegExp.exec()`의 캡처 그룹은 매치되지 않으면 `undefined`를 반환할 수 있음.

```typescript
const match = reExportRegex.exec(content);
const namesStr = match[1];  // possibly undefined
const source = match[2];    // possibly undefined
```

### 해결
```typescript
while ((match = reExportRegex.exec(content)) !== null) {
  const namesStr = match[1];
  const source = match[2];

  // Guard clause 추가
  if (!namesStr || !source) continue;

  // 안전하게 사용
  const names = namesStr.split(",")
    .map(name => name.trim())
    .filter((n): n is string => Boolean(n));  // Type guard
}
```

---

## Issue #6: Unused Variables in Strict Mode

### 문제
```
error TS6133: 'formatBytes' is declared but its value is never read.
error TS6133: 'language' is declared but its value is never read.
```

### 원인
`tsconfig.json`에서 `noUnusedLocals: true`와 `noUnusedParameters: true`가 설정되어 있음.

### 해결 방법 1: 변수 사용하기
```typescript
// Before
function code(code: string, language = "typescript") { ... }

// After
function code(code: string) { ... }  // 미사용 파라미터 제거
```

### 해결 방법 2: void 연산자 사용
```typescript
function formatBytes(bytes: number): string { ... }

// 나중에 사용할 함수임을 명시
void formatBytes;
```

---

## Issue #7: exactOptionalPropertyTypes Error

### 문제
```
error TS2379: Argument of type '{ filename: string | undefined; }' is not
assignable to parameter of type '{ filename?: string; }' with
'exactOptionalPropertyTypes: true'.
```

### 원인
`exactOptionalPropertyTypes: true`일 때, optional property에 명시적으로 `undefined`를 할당할 수 없음.

```typescript
// 허용되지 않음
function foo(opts?: { filename?: string }) { }
foo({ filename: undefined });  // Error!

// 허용됨
foo({});  // OK
foo({ filename: "test.ts" });  // OK
```

### 해결
```typescript
// Before
return (code: string, filename?: string) =>
  transformCode(code, importMap, targetLibraries, { filename });

// After
return (code: string, filename?: string) => {
  const options = filename ? { filename } : undefined;
  return transformCode(code, importMap, targetLibraries, options);
};
```

---

## Issue #8: SWC ImportSpecifier Type Mismatch

### 문제
```
error TS2339: Property 'imported' does not exist on type 'ImportSpecifier'.
Property 'imported' does not exist on type 'ImportDefaultSpecifier'.
```

### 원인
SWC의 specifier 타입이 union type으로 정의되어 있어 타입 가드 없이 접근 불가:
```typescript
type ImportSpecifier =
  | ImportDefaultSpecifier
  | ImportNamespaceSpecifier
  | ImportNamedSpecifier;
```

### 해결
```typescript
function getNamedSpecifiers(node: ImportDeclaration) {
  const result = [];

  for (const specifier of node.specifiers) {
    // Type guard
    if (specifier.type === "ImportSpecifier") {
      // Type assertion for known structure
      const spec = specifier as {
        type: "ImportSpecifier";
        local: { value: string };
        imported?: { value: string } | null;
      };

      result.push({
        imported: spec.imported?.value ?? spec.local.value,
        local: spec.local.value,
      });
    }
  }

  return result;
}
```

---

## Issue #9: SWC ImportDeclaration Unknown Properties

### 문제
```
error TS2353: Object literal may only specify known properties,
and 'with' does not exist in type 'ImportDeclaration'.
```

### 원인
SWC 버전에 따라 `ImportDeclaration` 타입에 `with`, `phase` 같은 새로운 필드가 있거나 없을 수 있음.

### 해결
```typescript
function createDefaultImport(localName: string, source: string): ImportDeclaration {
  return {
    type: "ImportDeclaration",
    span: { start: 0, end: 0, ctxt: 0 },
    specifiers: [...],
    source: {...},
    typeOnly: false,
    // 타입 에러 우회
  } as any;
}
```

**참고**: `as any`는 이상적이지 않지만, SWC 타입 정의의 불완전함 때문에 필요

---

## Summary

| Issue | Category | Time to Fix |
|-------|----------|-------------|
| #1 ESM Extensions | TypeScript Config | 5 min |
| #2 SWC `ctxt` Field | SWC API | 10 min |
| #3 Spinner TTY | Environment | 5 min |
| #4 ts-node ESM | Tooling | 10 min |
| #5 Regex Undefined | Type Safety | 5 min |
| #6 Unused Variables | Strict Mode | 2 min |
| #7 Optional Properties | Strict Mode | 5 min |
| #8 SWC Type Union | Type Safety | 10 min |
| #9 SWC Unknown Props | SWC API | 5 min |

**총 트러블슈팅 시간**: ~57분

**주요 교훈**:
1. SWC 타입 정의는 실제 런타임과 다를 수 있음 → 테스트 필수
2. TypeScript strict mode는 많은 잠재적 버그를 발견하지만 설정 시간 필요
3. ESM + TypeScript 조합은 여전히 rough edges가 있음

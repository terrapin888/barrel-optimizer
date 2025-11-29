<div align="center">

# 🛢️ Barrel Optimizer

**Zero-Overhead Barrel File Optimizer for Better Tree-Shaking**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

[Features](#-features) • [Benchmark](#-benchmark) • [Installation](#-installation) • [Usage](#-usage) • [Documentation](#-documentation)

</div>

---

## 🤔 The Problem

**Barrel files** are convenient for organizing exports, but they **kill tree-shaking** in bundlers:

```typescript
// 📦 @toss/ui/index.js (Barrel File)
export { Button } from './dist/Button.js';
export { Input } from './dist/Input.js';
export { Modal } from './dist/Modal.js';
// ... 500+ more components
```

```typescript
// 🚨 Your code - you only need Button!
import { Button } from '@toss/ui';

// What the bundler does:
// 1. Loads @toss/ui/index.js
// 2. Parses ALL 500+ re-exports
// 3. Tries tree-shaking but often fails
// 4. Result: 200KB+ bundle instead of 5KB
```

### Why Tree-Shaking Fails

- Bundlers can't determine **side-effects** in barrel files
- **Dynamic re-exports** (`export *`) are hard to analyze statically
- **Circular dependencies** between modules confuse dead-code elimination

---

## ✨ The Solution

**Barrel Optimizer** transforms barrel imports into **direct file imports** at build time.

![Demo Screenshot](./assets/demo-screenshot.png)

<details>
<summary>📝 Text Version (Before vs After)</summary>

<table>
<tr>
<td width="50%">

### ❌ Before

```typescript
import { Button, Input } from '@toss/ui';
import { Modal as Dialog } from '@toss/ui';
import { useToggle } from '@toss/ui';
```

</td>
<td width="50%">

### ✅ After

```typescript
import Button from '@toss/ui/dist/Button.js';
import Input from '@toss/ui/dist/Input.js';
import Dialog from '@toss/ui/dist/Modal.js';
import useToggle from '@toss/ui/dist/hooks/useToggle.js';
```

</td>
</tr>
</table>

</details>

**Result**: Bundler loads **only what you use**. Guaranteed tree-shaking. 🌳

---

## 📉 Impact Analysis: Why You Need This

We simulated a bundler process to compare the cost of **Barrel Files vs. Direct Imports**.

![Impact Report](./assets/impact-report.png)

### 📊 The Numbers Don't Lie

| Metric | Without Tool (❌) | With Tool (✅) | Improvement |
|:-------|:------------------|:---------------|:------------|
| **Files Processed** | 501 files | 1 file | 📉 **-99.8%** |
| **Virtual Bundle** | ~1,005 KB | ~2 KB | 📉 **-99.8%** |
| **Parse Time** | ~150 ms | ~0.3 ms | 🚀 **501x Faster** |

<details>
<summary>📐 How We Measured This</summary>

- Created a mock `@heavy/ui` library with **500 components** (~2KB each)
- Simulated bundler resolution for `import { Comp1 } from '@heavy/ui'`
- **Without Tool**: Bundler loads `index.js` → must parse ALL 500 exports
- **With Tool**: Import transformed to direct path → loads only 1 file

</details>

> **💡 Key Insight:** Even with Tree-shaking, bundlers must parse **ALL** exported files in a barrel file to check for side effects.
>
> **Barrel Optimizer** bypasses this entirely, resulting in **instant savings**.

### 🏢 Real-World Impact

| Scenario | Potential Savings |
|:---------|:------------------|
| App with 10 barrel imports | **~10 MB** parse overhead eliminated |
| CI/CD build time | **~1.5 seconds** faster per build |
| Developer hot-reload | **Noticeably snappier** experience |

---

## 🎯 Features

| Feature | Description |
|---------|-------------|
| 🔧 **Zero-Configuration** | Auto-discovers file paths from `node_modules`. No regex config needed. |
| 🎯 **Named Import Optimization** | Transforms `{ Button }` imports to direct file paths |
| 🛡️ **Safety-First Bail-out** | Skips `import * as` and dynamic imports with warnings |
| ⚡ **Blazing Fast** | Uses `es-module-lexer` + `@swc/core` for maximum speed |
| 📦 **Nested Barrel Support** | Handles `export * from './hooks'` recursively |
| 🔄 **Circular Dependency Safe** | DFS with visited set prevents infinite loops |

---

## 📊 Benchmark

### Stress Test Results

![Benchmark Results](./assets/benchmark-result.png)

Simulates a **massive monorepo** to prove production readiness:

| Environment | Value |
|-------------|-------|
| 📦 Target Library | `@heavy/ui` |
| 🧩 Library Exports | 500 components |
| 📄 Source Files | 1,000 files |
| 🔗 Total Imports | ~10,000 imports |

### Performance Metrics

| Metric | Result | Evaluation |
|--------|--------|------------|
| 🔍 Analysis Time | 442.45 ms | ✅ Fast |
| ⚡ Transform Time | 471.84 ms | ✅ Fast |
| ⏱️ **Total Time** | **0.91 s** | 🚀 Sub-second |
| 💾 Memory (Heap) | 8.59 MB | ✅ Lightweight |
| 📈 Throughput | **21,194 imports/sec** | 🔥 High |

> **✅ EXCELLENT: Sub-second performance for 1,000 files!**
>
> Production-ready for large-scale monorepos.

---

## 🌍 Universal Verification (Legacy & Modern)

Tested against **Toss's entire ecosystem history** to ensure seamless migration support.
The tool supports both the legacy `slash` packages and the modern `es-toolkit` stack.

![Universal Verification Result](./assets/universal-result.png)

### 📋 Result Breakdown

| Category | Libraries | Exports | Status |
|:---------|:----------|:--------|:-------|
| **Legacy (@toss)** | `@toss/utils`, `@toss/react`, `@toss/react-query` | 124+ | ✅ **PASS** |
| **Modern (New)** | `es-toolkit`, `es-hangul`, `@suspensive/react` | 224+ | ✅ **PASS** |
| **Benchmark** | `@mui/material` | 505+ | ✅ **PASS** |

### 📊 Verification Summary

| Metric | Value |
|:-------|:------|
| 📦 Libraries Tested | 7 |
| 🧩 Total Exports Discovered | **853** |
| ⏱️ Total Analysis Time | **~0.9s** |
| ✅ Pass Rate | **100%** (7/7) |

> **🏆 Verdict:** Fully compatible with Toss's Legacy and Modern tech stack.
>
> Seamless support for migration from `@toss/*` → `es-toolkit` ecosystem.

---

## 🔒 Safety: Bail-out Cases

The optimizer **skips** potentially unsafe patterns:

| Pattern | Action | Reason |
|---------|--------|--------|
| `import * as UI from '@toss/ui'` | ⚠️ Skip + Warn | Can't determine which exports are used |
| `import '@toss/ui'` | ⏭️ Skip | Side-effect only import |
| `const UI = await import('@toss/ui')` | ⏭️ Skip | Dynamic import |

---

## 📦 Installation

```bash
# npm
npm install -D barrel-optimizer

# yarn
yarn add -D barrel-optimizer

# pnpm
pnpm add -D barrel-optimizer
```

---

## 🚀 Usage

### Analyze a Library

Discover all exports from a barrel file:

```bash
npx barrel-optimizer analyze @toss/ui
```

**Output:**
```
✓ Found 500 exports in 45ms

Export Map:
  dist/Button.js     → Button
  dist/Input.js      → Input
  dist/Modal.js      → Modal
  dist/hooks/useToggle.js → useToggle
  ...
```

### Optimize Imports (Dry Run)

Preview transformations without modifying files:

```bash
npx barrel-optimizer optimize src/ --library @toss/ui --verbose
```

### Apply Optimizations

Write changes to files:

```bash
npx barrel-optimizer build src/ --library @toss/ui
```

### CLI Options

```
Options:
  -l, --library <names...>   Libraries to optimize (default: ["@toss/ui"])
  -w, --write                Write changes to files
  -v, --verbose              Show detailed output
  --cwd <path>               Working directory
  -h, --help                 Display help
```

---

## 🏗️ How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Phase 1: Analyzer                        │
│                                                              │
│  package.json → Entry Point → DFS Traverse → ImportMap      │
│                                    ↓                         │
│                              Visited Set                     │
│                        (Circular Dep Prevention)             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Phase 2: Transformer                      │
│                                                              │
│  Source Code → SWC Parse → Match ImportMap → Rewrite AST    │
│                     ↓                                        │
│              Bail-out Check                                  │
│         (Namespace/Dynamic Import)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📐 Architecture](./docs/ARCHITECTURE.md) | Technical deep-dive into the two-phase pipeline |
| [🗺️ Roadmap](./docs/ROADMAP.md) | Project plan, milestones, and future features |
| [🔧 Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and solutions |

---

## 🛠️ Tech Stack

- **[es-module-lexer](https://github.com/guybedford/es-module-lexer)** - Fast export parsing without AST
- **[@swc/core](https://swc.rs/)** - Rust-based AST transformation (20x faster than Babel)
- **[commander](https://github.com/tj/commander.js)** - CLI framework
- **[chalk](https://github.com/chalk/chalk)** - Terminal styling
- **TypeScript** - Strict mode enabled

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 📄 License

MIT © 2024

---

<div align="center">

**Made with ❤️ for better bundle sizes**

[⬆ Back to top](#-barrel-optimizer)

</div>

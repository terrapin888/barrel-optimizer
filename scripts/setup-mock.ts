#!/usr/bin/env npx ts-node
/**
 * Mock Environment Generator for barrel-optimizer testing
 *
 * This script creates a simulated node_modules structure to test
 * the barrel file optimizer without installing real heavy libraries.
 *
 * Generated Structure:
 * root/
 * ├── node_modules/
 * │   └── @test/ui/
 * │       ├── package.json
 * │       ├── index.js          (Barrel File - Entry)
 * │       └── dist/
 * │           ├── Button.js     (Actual Component)
 * │           ├── Input.js      (Actual Component)
 * │           ├── Modal.js      (Actual Component)
 * │           ├── hooks/
 * │           │   ├── index.js  (Nested Barrel)
 * │           │   ├── useToggle.js
 * │           │   └── useDebounce.js
 * │           └── utils/
 * │               ├── index.js  (Nested Barrel)
 * │               ├── cn.js     (className utility)
 * │               └── format.js (format utility)
 * └── playground/
 *     └── source.ts             (Test Input File)
 *
 * Usage:
 *   npx ts-node scripts/setup-mock.ts
 *   npx ts-node scripts/setup-mock.ts --clean  (remove mock files)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Configuration
const ROOT_DIR = path.resolve(__dirname, "../test-env");
const NODE_MODULES = path.join(ROOT_DIR, "node_modules");
const LIBRARY_PATH = path.join(NODE_MODULES, "@test/ui");
const PLAYGROUND_PATH = path.join(ROOT_DIR, "playground");

/**
 * File definitions for the mock library
 */
const MOCK_FILES: Record<string, string> = {
  // Package.json for @test/ui
  "@test/ui/package.json": JSON.stringify(
    {
      name: "@test/ui",
      version: "1.0.0",
      main: "index.js",
      module: "index.js",
      exports: {
        ".": {
          import: "./index.js",
          require: "./index.js",
        },
      },
    },
    null,
    2
  ),

  // Main Barrel File (Entry Point)
  "@test/ui/index.js": `/**
 * @test/ui - Main Entry Point (Barrel File)
 * This re-exports all components from their actual locations.
 */

// Components
export { Button } from './dist/Button.js';
export { Input } from './dist/Input.js';
export { Modal } from './dist/Modal.js';

// Hooks (nested barrel)
export * from './dist/hooks/index.js';

// Utils (nested barrel)
export * from './dist/utils/index.js';

// Default export for namespace usage
export default {
  Button: () => {},
  Input: () => {},
  Modal: () => {},
};
`,

  // Component: Button
  "@test/ui/dist/Button.js": `/**
 * Button Component
 * Simulates a real UI component with some weight
 */

const BUTTON_STYLES = {
  primary: { bg: 'blue', color: 'white' },
  secondary: { bg: 'gray', color: 'black' },
  danger: { bg: 'red', color: 'white' },
};

export function Button(props) {
  const { variant = 'primary', children, onClick } = props;
  const style = BUTTON_STYLES[variant];
  return { type: 'button', props: { style, onClick }, children };
}

Button.displayName = 'Button';

// Add some dead code that should be tree-shaken
export const INTERNAL_BUTTON_CONFIG = {
  animations: ['fade', 'slide', 'bounce'],
  sizes: ['sm', 'md', 'lg', 'xl'],
};
`,

  // Component: Input
  "@test/ui/dist/Input.js": `/**
 * Input Component
 */

const INPUT_TYPES = ['text', 'password', 'email', 'number', 'tel'];

export function Input(props) {
  const { type = 'text', placeholder, value, onChange } = props;
  return { type: 'input', props: { type, placeholder, value, onChange } };
}

Input.displayName = 'Input';

// Validation helpers (should be tree-shaken if Input not used)
export const validators = {
  email: (v) => /^[^@]+@[^@]+$/.test(v),
  phone: (v) => /^\\d{10,}$/.test(v),
};
`,

  // Component: Modal
  "@test/ui/dist/Modal.js": `/**
 * Modal Component
 */

export function Modal(props) {
  const { isOpen, onClose, title, children } = props;
  if (!isOpen) return null;
  return {
    type: 'div',
    props: { className: 'modal-overlay', onClick: onClose },
    children: [
      { type: 'div', props: { className: 'modal-content' }, children: [
        { type: 'h2', children: title },
        children,
      ]},
    ],
  };
}

Modal.displayName = 'Modal';

// Portal utilities (dead code if Modal not used)
export const portalRoot = typeof document !== 'undefined'
  ? document.getElementById('portal-root')
  : null;
`,

  // Nested Barrel: Hooks
  "@test/ui/dist/hooks/index.js": `/**
 * Hooks Barrel File
 */
export { useToggle } from './useToggle.js';
export { useDebounce } from './useDebounce.js';
`,

  // Hook: useToggle
  "@test/ui/dist/hooks/useToggle.js": `/**
 * useToggle Hook
 */
export function useToggle(initialValue = false) {
  let value = initialValue;
  const toggle = () => { value = !value; };
  const setTrue = () => { value = true; };
  const setFalse = () => { value = false; };
  return [value, { toggle, setTrue, setFalse }];
}
`,

  // Hook: useDebounce
  "@test/ui/dist/hooks/useDebounce.js": `/**
 * useDebounce Hook
 */
export function useDebounce(value, delay = 300) {
  let timeoutId = null;
  let debouncedValue = value;

  const update = (newValue) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      debouncedValue = newValue;
    }, delay);
  };

  return [debouncedValue, update];
}
`,

  // Nested Barrel: Utils
  "@test/ui/dist/utils/index.js": `/**
 * Utils Barrel File
 */
export { cn } from './cn.js';
export { formatNumber, formatDate } from './format.js';
`,

  // Util: cn (className utility)
  "@test/ui/dist/utils/cn.js": `/**
 * ClassName utility (like clsx/classnames)
 */
export function cn(...args) {
  return args
    .filter(Boolean)
    .map(arg => {
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'object') {
        return Object.entries(arg)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(' ');
      }
      return '';
    })
    .join(' ')
    .trim();
}
`,

  // Util: format
  "@test/ui/dist/utils/format.js": `/**
 * Format utilities
 */
export function formatNumber(num, locale = 'en-US') {
  return new Intl.NumberFormat(locale).format(num);
}

export function formatDate(date, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale).format(date);
}

// Currency formatter (dead code if not imported)
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}
`,

  // Playground: Test source file
  "playground/source.ts": `/**
 * Test Source File
 * This file imports from the @test/ui barrel file.
 * The optimizer should transform these to direct imports.
 */

// Case 1: Named imports from barrel (should be optimized)
import { Button, Input } from '@test/ui';

// Case 2: Named import with alias (should be optimized)
import { Modal as TossModal } from '@test/ui';

// Case 3: Hook imports (should be optimized through nested barrel)
import { useToggle } from '@test/ui';

// Case 4: Util imports (should be optimized)
import { cn, formatNumber } from '@test/ui';

// Usage
export function App() {
  const [isOpen, { toggle }] = useToggle(false);

  return {
    type: 'div',
    props: { className: cn('app', { 'dark-mode': true }) },
    children: [
      Button({ variant: 'primary', children: 'Click me', onClick: toggle }),
      Input({ placeholder: 'Enter text...' }),
      TossModal({ isOpen, onClose: toggle, title: 'Hello', children: 'Content' }),
      { type: 'span', children: formatNumber(1234567) },
    ],
  };
}
`,

  // Additional test file: namespace import (should bail out)
  "playground/namespace-test.ts": `/**
 * Namespace Import Test
 * This should trigger the bail-out mechanism.
 */

// Case: Namespace import (should NOT be optimized)
import * as UI from '@test/ui';

export function Page() {
  return UI.Button({ children: 'Namespace Button' });
}
`,

  // Additional test file: mixed imports
  "playground/mixed-test.ts": `/**
 * Mixed Import Test
 * Tests various import patterns in one file.
 */

// Named imports (should be optimized)
import { Button, useDebounce } from '@test/ui';

// Side effect import (should be skipped)
import '@test/ui';

// Type-only import simulation
import { formatDate } from '@test/ui';

export function SearchForm() {
  const [query, setQuery] = useDebounce('', 500);

  return {
    form: true,
    children: [
      Button({ children: 'Search' }),
      { text: formatDate(new Date()) },
    ],
  };
}
`,
};

/**
 * Creates all directories and files for the mock environment
 */
function setupMockEnvironment(): void {
  console.log("🔧 Setting up mock environment...\n");

  // Create root directories
  const directories = [
    ROOT_DIR,
    NODE_MODULES,
    path.join(LIBRARY_PATH, "dist"),
    path.join(LIBRARY_PATH, "dist/hooks"),
    path.join(LIBRARY_PATH, "dist/utils"),
    PLAYGROUND_PATH,
  ];

  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  📁 Created: ${path.relative(ROOT_DIR, dir) || "root"}`);
    }
  }

  console.log("");

  // Create all mock files
  for (const [relativePath, content] of Object.entries(MOCK_FILES)) {
    const fullPath = relativePath.startsWith("@test/ui")
      ? path.join(NODE_MODULES, relativePath)
      : path.join(ROOT_DIR, relativePath);

    fs.writeFileSync(fullPath, content, "utf-8");
    console.log(`  📄 Created: ${relativePath}`);
  }

  console.log("\n✅ Mock environment ready!");
  console.log(`   Location: ${ROOT_DIR}`);
  console.log("\n📋 Test commands:");
  console.log(`   cd ${path.relative(process.cwd(), ROOT_DIR)}`);
  console.log("   npx barrel-optimizer analyze @test/ui");
  console.log("   npx barrel-optimizer optimize playground/source.ts -l @test/ui -v");
}

/**
 * Removes the mock environment
 */
function cleanMockEnvironment(): void {
  console.log("🧹 Cleaning mock environment...\n");

  if (fs.existsSync(ROOT_DIR)) {
    fs.rmSync(ROOT_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed: ${ROOT_DIR}`);
  } else {
    console.log("  ℹ Mock environment not found, nothing to clean.");
  }

  console.log("\n✅ Cleanup complete!");
}

/**
 * Prints summary of what will be created
 */
function printSummary(): void {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        Barrel Optimizer - Mock Environment Setup         ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log("📦 Mock Library: @test/ui");
  console.log("   ├── Components: Button, Input, Modal");
  console.log("   ├── Hooks: useToggle, useDebounce");
  console.log("   └── Utils: cn, formatNumber, formatDate\n");

  console.log("🧪 Test Files:");
  console.log("   ├── source.ts      (named imports)");
  console.log("   ├── namespace-test.ts (bail-out test)");
  console.log("   └── mixed-test.ts  (mixed patterns)\n");
}

// Main execution
const args = process.argv.slice(2);

if (args.includes("--clean") || args.includes("-c")) {
  cleanMockEnvironment();
} else if (args.includes("--help") || args.includes("-h")) {
  printSummary();
  console.log("Usage:");
  console.log("  npx ts-node scripts/setup-mock.ts          # Create mock environment");
  console.log("  npx ts-node scripts/setup-mock.ts --clean  # Remove mock environment");
  console.log("  npx ts-node scripts/setup-mock.ts --help   # Show this help");
} else {
  printSummary();
  setupMockEnvironment();
}

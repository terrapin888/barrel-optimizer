#!/usr/bin/env node
/**
 * Mock Environment Generator for barrel-optimizer testing
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ROOT_DIR = path.resolve(__dirname, "../test-env");
const NODE_MODULES = path.join(ROOT_DIR, "node_modules");
const LIBRARY_PATH = path.join(NODE_MODULES, "@test/ui");
const PLAYGROUND_PATH = path.join(ROOT_DIR, "playground");

/**
 * File definitions for the mock library
 */
const MOCK_FILES = {
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
 */
export { Button } from './dist/Button.js';
export { Input } from './dist/Input.js';
export { Modal } from './dist/Modal.js';
export * from './dist/hooks/index.js';
export * from './dist/utils/index.js';
`,

  // Component: Button
  "@test/ui/dist/Button.js": `export function Button(props) {
  const { variant = 'primary', children, onClick } = props;
  return { type: 'button', props: { variant, onClick }, children };
}
Button.displayName = 'Button';
`,

  // Component: Input
  "@test/ui/dist/Input.js": `export function Input(props) {
  const { type = 'text', placeholder, value, onChange } = props;
  return { type: 'input', props: { type, placeholder, value, onChange } };
}
Input.displayName = 'Input';
`,

  // Component: Modal
  "@test/ui/dist/Modal.js": `export function Modal(props) {
  const { isOpen, onClose, title, children } = props;
  if (!isOpen) return null;
  return { type: 'div', props: { className: 'modal' }, children };
}
Modal.displayName = 'Modal';
`,

  // Nested Barrel: Hooks
  "@test/ui/dist/hooks/index.js": `export { useToggle } from './useToggle.js';
export { useDebounce } from './useDebounce.js';
`,

  // Hook: useToggle
  "@test/ui/dist/hooks/useToggle.js": `export function useToggle(initialValue = false) {
  let value = initialValue;
  const toggle = () => { value = !value; };
  return [value, { toggle }];
}
`,

  // Hook: useDebounce
  "@test/ui/dist/hooks/useDebounce.js": `export function useDebounce(value, delay = 300) {
  return [value, () => {}];
}
`,

  // Nested Barrel: Utils
  "@test/ui/dist/utils/index.js": `export { cn } from './cn.js';
export { formatNumber, formatDate } from './format.js';
`,

  // Util: cn
  "@test/ui/dist/utils/cn.js": `export function cn(...args) {
  return args.filter(Boolean).join(' ');
}
`,

  // Util: format
  "@test/ui/dist/utils/format.js": `export function formatNumber(num) {
  return new Intl.NumberFormat().format(num);
}
export function formatDate(date) {
  return new Intl.DateTimeFormat().format(date);
}
`,

  // Playground: Test source file
  "playground/source.ts": `/**
 * Test Source File - Named imports from barrel
 */
import { Button, Input } from '@test/ui';
import { Modal as TossModal } from '@test/ui';
import { useToggle } from '@test/ui';
import { cn, formatNumber } from '@test/ui';

export function App() {
  const [isOpen, { toggle }] = useToggle(false);
  return {
    type: 'div',
    props: { className: cn('app', 'container') },
    children: [
      Button({ variant: 'primary', children: 'Click', onClick: toggle }),
      Input({ placeholder: 'Enter...' }),
      TossModal({ isOpen, onClose: toggle, title: 'Hello' }),
      formatNumber(1234567),
    ],
  };
}
`,

  // Namespace import test (should bail out)
  "playground/namespace-test.ts": `/**
 * Namespace Import Test - Should bail out
 */
import * as UI from '@test/ui';

export function Page() {
  return UI.Button({ children: 'Namespace Button' });
}
`,
};

/**
 * Creates all directories and files for the mock environment
 */
function setupMockEnvironment() {
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
  console.log(`   Location: ${ROOT_DIR}\n`);
}

/**
 * Removes the mock environment
 */
function cleanMockEnvironment() {
  console.log("🧹 Cleaning mock environment...\n");

  if (fs.existsSync(ROOT_DIR)) {
    fs.rmSync(ROOT_DIR, { recursive: true, force: true });
    console.log(`  ✓ Removed: ${ROOT_DIR}`);
  } else {
    console.log("  ℹ Mock environment not found.");
  }

  console.log("\n✅ Cleanup complete!");
}

// Main execution
const args = process.argv.slice(2);

if (args.includes("--clean") || args.includes("-c")) {
  cleanMockEnvironment();
} else {
  setupMockEnvironment();
}

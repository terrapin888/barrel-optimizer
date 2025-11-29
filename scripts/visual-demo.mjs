#!/usr/bin/env node
/**
 * Visual Demo Script
 *
 * Generates a beautiful terminal output for README screenshot.
 * Uses hardcoded strings for perfect visual appearance.
 *
 * Usage: node scripts/visual-demo.mjs
 */

import chalk from "chalk";

// ═══════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════

const BEFORE_CODE = `// App.tsx
import { Button, Input, Modal } from '@toss/ui';
import { useToggle as useSwitch } from '@toss/ui';
import { cn, formatNumber } from '@toss/ui';
import * as Icons from '@toss/ui';  // ⚠️ Namespace import`;

const AFTER_CODE = `// App.tsx (Optimized)
import Button from '@toss/ui/dist/Button';
import Input from '@toss/ui/dist/Input';
import Modal from '@toss/ui/dist/Modal';
import useSwitch from '@toss/ui/dist/hooks/useToggle';
import cn from '@toss/ui/dist/utils/cn';
import formatNumber from '@toss/ui/dist/utils/format';
import * as Icons from '@toss/ui';  // ⚠️ Skipped (Bail-out)`;

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function printBox(title, content, color) {
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length), title.length + 4);
  const width = maxLen + 4;

  const top = color('╭' + '─'.repeat(width) + '╮');
  const bottom = color('╰' + '─'.repeat(width) + '╯');
  const titleLine = color('│ ') + chalk.bold(title) + ' '.repeat(width - title.length - 1) + color('│');

  console.log(top);
  console.log(titleLine);
  console.log(color('├' + '─'.repeat(width) + '┤'));

  for (const line of lines) {
    const padding = ' '.repeat(width - line.length - 1);
    console.log(color('│ ') + highlightCode(line) + padding + color('│'));
  }

  console.log(bottom);
}

function highlightCode(line) {
  // Comments
  if (line.includes('//')) {
    const [code, ...commentParts] = line.split('//');
    const comment = '//' + commentParts.join('//');
    if (comment.includes('⚠️')) {
      return highlightImport(code) + chalk.yellow(comment);
    }
    return highlightImport(code) + chalk.gray(comment);
  }
  return highlightImport(line);
}

function highlightImport(line) {
  // import keyword
  line = line.replace(/^(import)/, chalk.magenta('$1'));
  // from keyword
  line = line.replace(/( from )/, chalk.magenta('$1'));
  // as keyword
  line = line.replace(/( as )/, chalk.magenta('$1'));
  // * as pattern
  line = line.replace(/(\* as)/, chalk.red('$1'));
  // Curly braces content (named imports)
  line = line.replace(/\{([^}]+)\}/g, (match, p1) => {
    return chalk.cyan('{') + chalk.green(p1) + chalk.cyan('}');
  });
  // String literals
  line = line.replace(/'([^']+)'/g, chalk.yellow("'$1'"));
  // Default import name
  line = line.replace(/^(import )([A-Z][a-zA-Z]+)( from)/, (m, p1, p2, p3) => {
    return p1 + chalk.green(p2) + p3;
  });
  return line;
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

console.clear();
console.log();
console.log(chalk.bgCyan.black.bold('                                                                  '));
console.log(chalk.bgCyan.black.bold('   🛢️  BARREL OPTIMIZER                                            '));
console.log(chalk.bgCyan.black.bold('   Transform barrel imports → direct file imports                 '));
console.log(chalk.bgCyan.black.bold('                                                                  '));
console.log();

// Before section
console.log(chalk.red.bold('  ❌ BEFORE OPTIMIZATION'));
console.log(chalk.red('  ─────────────────────────────────────────────────────────'));
console.log();
printBox('Barrel Imports (Tree-shaking fails)', BEFORE_CODE, chalk.red);
console.log();

// Arrow
console.log(chalk.gray('                           ↓'));
console.log(chalk.cyan.bold('               barrel-optimizer build src/'));
console.log(chalk.gray('                           ↓'));
console.log();

// After section
console.log(chalk.green.bold('  ✅ AFTER OPTIMIZATION'));
console.log(chalk.green('  ─────────────────────────────────────────────────────────'));
console.log();
printBox('Direct Imports (Guaranteed tree-shaking)', AFTER_CODE, chalk.green);
console.log();

// Stats
console.log(chalk.gray('  ─────────────────────────────────────────────────────────'));
console.log();
console.log(chalk.white('  📊 ') + chalk.bold('Results:'));
console.log(chalk.gray('     ├─ ') + chalk.green('✓') + ' 6 imports optimized');
console.log(chalk.gray('     ├─ ') + chalk.yellow('⚠') + ' 1 import skipped (namespace bail-out)');
console.log(chalk.gray('     └─ ') + chalk.cyan('⚡') + ' Transform time: 3ms');
console.log();

// Impact
console.log(chalk.white('  📦 ') + chalk.bold('Bundle Impact:'));
console.log(chalk.gray('     ├─ ') + chalk.red('Before: ~200KB') + chalk.gray(' (entire @toss/ui loaded)'));
console.log(chalk.gray('     └─ ') + chalk.green('After:  ~15KB') + chalk.gray('  (only used files)'));
console.log();

console.log(chalk.bgGreen.black.bold('  🎉 90% bundle size reduction!  '));
console.log();

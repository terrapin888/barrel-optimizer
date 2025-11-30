# Scripts

Essential utility scripts for testing and validating the barrel-optimizer.

## Scripts Overview

| Script | Purpose |
|--------|---------|
| `setup-mock.mjs` | Creates mock `@test/ui` library in node_modules for isolated testing |
| `stress-benchmark.mjs` | Stress test with 500+ components across 1000 files (performance validation) |
| `verify-real-world.mjs` | Validates against real npm packages: `@toss/*`, `es-toolkit`, `@mui/material` |
| `verify-bundle-impact.mjs` | Simulates bundler resolution to demonstrate tree-shaking optimization impact |
| `benchmark-real-app.mjs` | End-to-end test against Material Kit React (real Next.js project) |

## Usage

```bash
# Build the project first
npm run build

# 1. Setup mock library (required for unit tests)
node scripts/setup-mock.mjs

# 2. Run stress test (validates performance at scale)
node scripts/stress-benchmark.mjs

# 3. Validate against real npm packages
node scripts/verify-real-world.mjs

# 4. Show bundle optimization impact
node scripts/verify-bundle-impact.mjs

# 5. Test against real-world Next.js app
node scripts/benchmark-real-app.mjs
```

## Requirements

- Node.js 18+
- Project must be built first (`npm run build`)
- Some scripts require internet access to clone external repositories

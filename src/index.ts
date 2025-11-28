/**
 * Barrel Optimizer
 *
 * Zero-Overhead Barrel File Optimizer for better tree-shaking.
 *
 * @packageDocumentation
 */

// Core exports
export { analyzeLibrary, analyzeLibraries, type ImportMap } from "./core/analyzer.js";
export {
  transformCode,
  transformFiles,
  createTransformer,
  type TransformConfig,
  type TransformResult,
} from "./core/transformer.js";

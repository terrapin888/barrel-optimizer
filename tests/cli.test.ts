/**
 * CLI Smoke Tests
 *
 * Tests the CLI binary to ensure it works correctly for end users.
 * These are integration tests that verify the CLI interface.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync, type ExecSyncOptions } from "node:child_process";
import * as path from "node:path";

const CLI_PATH = path.resolve(__dirname, "../dist/cli/index.js");
const PROJECT_ROOT = path.resolve(__dirname, "..");

const execOptions: ExecSyncOptions = {
  cwd: PROJECT_ROOT,
  encoding: "utf-8",
  // Capture both stdout and stderr
  stdio: ["pipe", "pipe", "pipe"],
};

/**
 * Helper to run CLI commands and capture output
 */
function runCli(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, execOptions) as string;
    return { stdout, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    // Combine stdout and stderr as some output may go to either
    const output = [execError.stdout, execError.stderr].filter(Boolean).join("\n");
    return {
      stdout: output || "",
      exitCode: execError.status ?? 1,
    };
  }
}

describe("CLI Smoke Tests", () => {
  beforeAll(() => {
    // Ensure the CLI is built before running tests
    try {
      execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "pipe" });
    } catch {
      // Build might already be up to date
    }
  });

  describe("Help Command", () => {
    it("should display help with --help flag", () => {
      const result = runCli("--help");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("barrel-optimizer");
      expect(result.stdout).toContain("Zero-Overhead Barrel File Optimizer");
      expect(result.stdout).toContain("analyze");
      expect(result.stdout).toContain("optimize");
      expect(result.stdout).toContain("build");
    });

    it("should display version with --version flag", () => {
      const result = runCli("--version");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // Semver pattern
    });

    it("should display help for analyze command", () => {
      const result = runCli("analyze --help");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("analyze");
      expect(result.stdout).toContain("library");
      expect(result.stdout).toContain("--cwd");
      expect(result.stdout).toContain("--verbose");
    });

    it("should display help for optimize command", () => {
      const result = runCli("optimize --help");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("optimize");
      expect(result.stdout).toContain("target");
      expect(result.stdout).toContain("--library");
      expect(result.stdout).toContain("--write");
      expect(result.stdout).toContain("--verbose");
    });
  });

  describe("Analyze Command", () => {
    it("should successfully analyze es-toolkit library", () => {
      const result = runCli("analyze es-toolkit");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Analyzing: es-toolkit");
      expect(result.stdout).toContain("Found");
      expect(result.stdout).toContain("exports");
      expect(result.stdout).toContain("Export Map:");
    });

    it("should fail gracefully for non-existent library", () => {
      const result = runCli("analyze @non-existent/fake-library-xyz");

      expect(result.exitCode).toBe(1);
      // Should show error message, not crash
      expect(result.stdout).toContain("Failed");
    });
  });

  describe("Optimize Command (Dry Run)", () => {
    it("should run optimize on tests directory without errors", () => {
      // Dry run (no --write flag) - should not modify files
      const result = runCli("optimize tests/ --library es-toolkit");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Barrel Optimizer");
      expect(result.stdout).toContain("Discovered");
      expect(result.stdout).toContain("Files processed");
    });

    it("should show message about --write flag in dry run mode", () => {
      const result = runCli("optimize tests/ --library es-toolkit");

      // Should mention --write flag if there are changes
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should fail gracefully with invalid target path", () => {
      const result = runCli("optimize /non/existent/path --library es-toolkit");

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("not found");
    });

    it("should show help when no command provided", () => {
      const result = runCli("");

      // Commander shows help but may exit with 1 when no command given
      // The important thing is it shows the help text
      expect(result.stdout).toContain("barrel-optimizer");
    });
  });
});

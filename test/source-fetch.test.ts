import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  fetchSource,
  type CommandRunner,
  type CommandRunnerResult,
} from "../src/core/source/fetch.js";
import type { SourceDescriptor } from "../src/core/source/types.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("fetchSource", () => {
  it("resolves local source without running shell commands", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-local-"));
    cleanupDirs.push(base);

    const cwd = join(base, "workspace");
    const localDir = join(cwd, "skills", "alpha");

    await mkdir(localDir, { recursive: true });

    const calls: string[] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "local",
      raw: "skills/alpha",
      path: resolve(localDir),
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(result.sourceDir).toBe(resolve(localDir));
    expect(calls).toHaveLength(0);
  });

  it("runs git clone for git sources", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-"));
    cleanupDirs.push(base);

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      calls.push({ command, args });

      if (command === "git" && args[0] === "clone") {
        const targetDir = args[args.length - 1];
        if (targetDir) {
          await mkdir(targetDir, { recursive: true });
          await writeFile(join(targetDir, "SKILL.md"), "# git skill\n");
        }
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "acme/skills#main",
      url: "https://github.com/acme/skills.git",
      ref: "main",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(result.sourceDir).toContain(join(base, "tmp"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("git");
    expect(calls[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
      "https://github.com/acme/skills.git",
      result.sourceDir,
    ]);
  });

  it("checks out commit SHA refs after cloning", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-git-sha-"));
    cleanupDirs.push(base);

    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = async (command, args, options): Promise<CommandRunnerResult> => {
      calls.push({ command, args, cwd: options?.cwd });

      if (command === "git" && args[0] === "clone") {
        const targetDir = args[args.length - 1];
        if (targetDir) {
          await mkdir(targetDir, { recursive: true });
          await writeFile(join(targetDir, "SKILL.md"), "# git skill\n");
        }
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "git",
      raw: "acme/skills#0123456789abcdef0123456789abcdef01234567",
      url: "https://github.com/acme/skills.git",
      ref: "0123456789abcdef0123456789abcdef01234567",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      command: "git",
      args: ["clone", "https://github.com/acme/skills.git", result.sourceDir],
      cwd: undefined,
    });
    expect(calls[1]).toEqual({
      command: "git",
      args: ["checkout", "0123456789abcdef0123456789abcdef01234567"],
      cwd: result.sourceDir,
    });
  });

  it("packs and extracts npm source via npm pack and tar", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-npm-"));
    cleanupDirs.push(base);

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      calls.push({ command, args });

      if (command === "npm" && args[0] === "pack") {
        return {
          stdout: JSON.stringify([{ filename: "acme-skills-kit-1.2.3.tgz" }]),
          stderr: "",
          exitCode: 0,
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "npm",
      raw: "@acme/skills-kit@1.2.3",
      spec: "@acme/skills-kit@1.2.3",
      packageName: "@acme/skills-kit",
      version: "1.2.3",
    };

    const result = await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(result.sourceDir).toContain(join(base, "tmp"));
    expect(calls).toHaveLength(2);

    expect(calls[0]?.command).toBe("npm");
    expect(calls[0]?.args).toContain("pack");
    expect(calls[0]?.args).toContain("--pack-destination");
    expect(calls[0]?.args).toContain("--json");

    expect(calls[1]?.command).toBe("tar");
    expect(calls[1]?.args).toContain("-xzf");
    expect(calls[1]?.args).toContain("--strip-components=1");
    expect(calls[1]?.args).toContain(result.sourceDir);
  });

  it("uses absolute tarball path from pnpm pack output", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-fetch-npm-absolute-"));
    cleanupDirs.push(base);

    const absoluteTarballPath = join(base, "tmp", "pack-dir", "skill-cli-0.1.0.tgz");

    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = async (command, args): Promise<CommandRunnerResult> => {
      calls.push({ command, args });

      if (command === "npm" && args[0] === "pack") {
        return {
          stdout: JSON.stringify([{ filename: absoluteTarballPath }]),
          stderr: "",
          exitCode: 0,
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const descriptor: SourceDescriptor = {
      kind: "npm",
      raw: "skill-cli@0.1.0",
      spec: "skill-cli@0.1.0",
      packageName: "skill-cli",
      version: "0.1.0",
    };

    await fetchSource(descriptor, {
      tempDir: join(base, "tmp"),
      runCommand: runner,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.command).toBe("tar");
    expect(calls[1]?.args[1]).toBe(absoluteTarballPath);
  });
});

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runListCommand } from "../src/commands/list.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function captureOutput() {
  const logs: string[] = [];
  return {
    output: {
      info: (message: string) => logs.push(`INFO:${message}`),
      warn: (message: string) => logs.push(`WARN:${message}`),
      error: (message: string) => logs.push(`ERROR:${message}`),
    },
    logs,
  };
}

describe("runListCommand", () => {
  const fakeCacheKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("prints installed entries from registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-list-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            codex: {
              globalDir: targetDir,
            },
          },
        },
        null,
        2,
      ),
    );

    await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    await runListCommand(
      { tool: "all", expand: true },
      { cwd, homeDir, output: capture.output },
    );

    expect(capture.logs.some((line) => line.includes("Managed Bundles"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("codex/"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("skills-source"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("members=1"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("alpha-skill ->"))).toBe(true);
  });

  it("shows discovered status for installed symlink not in registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-list-discovered-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const projectRoot = join(base, "workspace", "repo");
    const targetDir = join(projectRoot, ".opencode", "skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");

    await symlink(sourceSkillDir, join(targetDir, "using-superpowers"), "dir");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              projectDir: ".opencode/skills",
            },
          },
        },
        null,
        2,
      ),
    );

    const capture = captureOutput();
    await runListCommand(
      { tool: "opencode" },
      { cwd, homeDir, output: capture.output },
    );

    expect(capture.logs.some((line) => line.includes("Discovered Bundles"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("using-superpowers"))).toBe(true);
  });

  it("supports status filter", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-list-status-filter-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const projectRoot = join(base, "workspace", "repo");
    const targetDir = join(projectRoot, ".opencode", "skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetDir, "using-superpowers"), "dir");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: {
            opencode: {
              projectDir: ".opencode/skills",
            },
          },
        },
        null,
        2,
      ),
    );

    const capture = captureOutput();
    await runListCommand(
      { tool: "opencode", status: "managed" },
      { cwd, homeDir, output: capture.output },
    );

    expect(capture.logs.some((line) => line.includes("No bundles found for selected filters"))).toBe(true);
  });

  it("shows discovered status for custom dir targets", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-list-custom-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const targetDir = join(base, "custom-skills");
    const storeDir = join(base, "store");
    const sourceSkillDir = join(storeDir, "store", fakeCacheKey, "skills", "using-superpowers");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(sourceSkillDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# using-superpowers\n");
    await symlink(sourceSkillDir, join(targetDir, "using-superpowers"), "dir");

    const capture = captureOutput();
    await runListCommand(
      { tool: "opencode", dir: targetDir },
      { cwd, homeDir, output: capture.output },
    );

    expect(capture.logs.some((line) => line.includes("Discovered Bundles"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("using-superpowers"))).toBe(true);
    expect(capture.logs.some((line) => line.includes("[dir]"))).toBe(true);
  });
});

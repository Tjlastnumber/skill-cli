import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runRemoveCommand } from "../src/commands/remove.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function quietOutput() {
  return {
    info: (_message: string) => {},
    warn: (_message: string) => {},
    error: (_message: string) => {},
  };
}

describe("runRemoveCommand", () => {
  it("removes symlink and updates registry", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-remove-"));
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
      { cwd, homeDir, output: quietOutput() },
    );

    const linkPath = join(targetDir, "alpha-skill");
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    await runRemoveCommand(
      {
        bundleName: "skills-source",
        tool: "codex",
        target: { type: "global" },
      },
      { cwd, homeDir, output: quietOutput() },
    );

    await expect(lstat(linkPath)).rejects.toThrow();

    const registryRaw = await readFile(join(storeDir, "registry.json"), "utf8");
    const registry = JSON.parse(registryRaw) as { bundles: Array<{ bundleName: string }> };
    expect(registry.bundles).toHaveLength(0);
  });
});

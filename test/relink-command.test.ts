import { lstat, mkdtemp, mkdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runRelinkCommand } from "../src/commands/relink.js";

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

describe("runRelinkCommand", () => {
  it("recreates missing symlink from registry bundle members", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-relink-"));
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
    await rm(linkPath, { recursive: true, force: true });
    await expect(lstat(linkPath)).rejects.toThrow();

    const result = await runRelinkCommand(
      { tool: "codex" },
      { cwd, homeDir, output: quietOutput() },
    );

    expect(result.relinkedMembers).toBe(1);
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);

    const linkedTarget = await readlink(linkPath);
    expect(linkedTarget).toBe(resolve(storeDir, "store", result.cacheKeys[0] ?? "", "alpha-skill"));
  });
});

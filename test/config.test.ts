import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/core/config/load.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("returns built-in defaults when no config files exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-config-defaults-"));
    cleanupDirs.push(base);

    const cwd = join(base, "repo");
    await mkdir(cwd, { recursive: true });

    const config = await loadConfig({ cwd, homeDir: base, env: {} });

    expect(config.storeDir).toBe("~/.skills");
    expect(config.tools["claude-code"]?.globalDir).toBe("~/.claude/skills");
    expect(config.tools.codex?.projectDir).toBe(".codex/skills");
    expect(config.tools.opencode?.projectDir).toBe(".opencode/skills");
  });

  it("merges config with priority flags > env > project > global > defaults", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-config-merge-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo", "pkg", "app");
    const gitRoot = join(base, "workspace", "repo");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(gitRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir: "/global-store",
          tools: {
            codex: {
              globalDir: "/global-codex",
            },
          },
        },
        null,
        2,
      ),
    );

    await writeFile(
      join(gitRoot, "skill-cli.config.json"),
      JSON.stringify(
        {
          storeDir: "/project-store",
          tools: {
            codex: {
              globalDir: "/project-codex",
            },
          },
        },
        null,
        2,
      ),
    );

    const config = await loadConfig({
      cwd,
      homeDir,
      env: {
        SKILL_CLI_STORE_DIR: "/env-store",
      },
      flags: {
        storeDir: "/flag-store",
        tools: {
          codex: {
            globalDir: "/flag-codex",
          },
        },
      },
    });

    expect(config.storeDir).toBe("/flag-store");
    expect(config.tools.codex.globalDir).toBe("/flag-codex");
    expect(config.tools.codex.projectDir).toBe(".codex/skills");
    expect(config.tools["claude-code"].globalDir).toBe("~/.claude/skills");
  });

  it("throws when config schema is invalid", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-config-invalid-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          tools: {
            codex: {
              projectDir: 1,
            },
          },
        },
        null,
        2,
      ),
    );

    await expect(loadConfig({ cwd, homeDir, env: {} })).rejects.toThrow(
      /Invalid config/,
    );
  });
});

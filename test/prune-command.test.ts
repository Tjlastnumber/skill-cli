import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runPruneCommand } from "../src/commands/prune.js";

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

async function readSourceManifestPath(storedSkillDir: string): Promise<string> {
  const raw = await readFile(join(storedSkillDir, ".skill-cli-source.json"), "utf8");
  const parsed = JSON.parse(raw) as { sourceManifestPath?: string };

  if (!parsed.sourceManifestPath) {
    throw new Error(`Missing sourceManifestPath for ${storedSkillDir}`);
  }

  return parsed.sourceManifestPath;
}

describe("runPruneCommand", () => {
  it("removes unreferenced store directories and keeps referenced ones", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-"));
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

    const installResult = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const usedStoreDir = await readlink(join(targetDir, "alpha-skill"));
    const liveManifestPath = await readSourceManifestPath(usedStoreDir);
    const orphanStoreDir = join(storeDir, "store", "a".repeat(64));
    const orphanManifestPath = join(storeDir, "manifests", `${"b".repeat(64)}.json`);
    await mkdir(orphanStoreDir, { recursive: true });
    await writeFile(join(orphanStoreDir, "ORPHAN.txt"), "unused\n");
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect(result.reclaimedBytes).toBeGreaterThan(0);

    await expect(lstat(orphanStoreDir)).rejects.toThrow();
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
    expect((await lstat(usedStoreDir)).isDirectory()).toBe(true);
    expect((await lstat(liveManifestPath)).isFile()).toBe(true);
  });

  it("keeps store entries referenced by explicit custom directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-custom-dir-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const customDir = join(base, "custom-skills");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");

    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
        },
        null,
        2,
      ),
    );

    const installResult = await runInstallCommand(
      {
        source: "skills-source",
        tool: "codex",
        target: { type: "dir", dir: customDir },
        force: false,
      },
      { cwd, homeDir, output: quietOutput() },
    );

    const usedStoreDir = await readlink(join(customDir, "alpha-skill"));
    const liveManifestPath = await readSourceManifestPath(usedStoreDir);
    const orphanStoreDir = join(storeDir, "store", "c".repeat(64));
    const orphanManifestPath = join(storeDir, "manifests", `${"d".repeat(64)}.json`);
    await mkdir(orphanStoreDir, { recursive: true });
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({ dirs: [customDir] }, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
    expect((await lstat(usedStoreDir)).isDirectory()).toBe(true);
    expect((await lstat(liveManifestPath)).isFile()).toBe(true);
  });

  it("keeps shared manifests while any live managed skill still references them", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-shared-manifest-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n");

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

    const alphaLinkPath = join(targetDir, "alpha-skill");
    const betaLinkPath = join(targetDir, "beta-skill");
    const alphaStoreDir = await readlink(alphaLinkPath);
    const sharedManifestPath = await readSourceManifestPath(alphaStoreDir);

    await rm(betaLinkPath, { force: true });

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(1);
    expect((await lstat(alphaLinkPath)).isSymbolicLink()).toBe(true);
    expect((await lstat(sharedManifestPath)).isFile()).toBe(true);
  });

  it("prunes orphan manifests when the store has no store entry directory left", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-manifests-only-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const storeDir = join(base, "store");
    const orphanManifestPath = join(storeDir, "manifests", `${"e".repeat(64)}.json`);

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
        },
        null,
        2,
      ),
    );
    await mkdir(join(storeDir, "manifests"), { recursive: true });
    await writeFile(orphanManifestPath, "{}\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedStoreEntries).toBe(0);
    await expect(lstat(orphanManifestPath)).rejects.toThrow();
  });

  it("removes orphaned legacy source-state directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-legacy-sources-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace");
    const sourceRoot = join(cwd, "skills-source");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");
    const orphanSourceStateDir = join(storeDir, "sources", `${"f".repeat(64)}`);

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

    await mkdir(orphanSourceStateDir, { recursive: true });
    await writeFile(join(orphanSourceStateDir, ".skill-cli-source.json"), "{}\n");

    await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    await expect(lstat(orphanSourceStateDir)).rejects.toThrow();
  });

  it("removes orphan bare git repos while keeping ones still referenced by live skills", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-repos-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const targetDir = join(base, "target", "codex-global");
    const storeDir = join(base, "store");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify(
        {
          storeDir,
          tools: { codex: { globalDir: targetDir } },
        },
        null,
        2,
      ),
    );

    const runner = async (
      command: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      if (command === "git" && args[0] === "ls-remote") {
        return { stdout: `ref: refs/heads/main\tHEAD\n${resolvedCommitSha}\tHEAD\n`, stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) await mkdir(barePath, { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        if (args[2] === "archive") {
          const idx = args.indexOf("--output");
          const tarPath = idx >= 0 ? args[idx + 1] : undefined;
          if (tarPath) await writeFile(tarPath, "FAKE");
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }
      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "SKILL.md"), "# alpha\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    await runInstallCommand(
      { source: "git@github.com:acme/skills.git", tool: "codex", target: { type: "global" }, force: false },
      { cwd, homeDir, output: quietOutput(), runCommand: runner },
    );

    const liveRepoEntry = (await readdir(join(storeDir, "repos"), { withFileTypes: false }))[0];
    const orphanRepoDir = join(storeDir, "repos", "0".repeat(64));
    await mkdir(orphanRepoDir, { recursive: true });
    await writeFile(join(orphanRepoDir, "objects"), "unused\n");

    const result = await runPruneCommand({}, { cwd, homeDir, output: quietOutput() });

    expect(result.removedRepos).toBe(1);
    await expect(lstat(orphanRepoDir)).rejects.toThrow();
    expect((await lstat(join(storeDir, "repos", liveRepoEntry))).isDirectory()).toBe(true);
  });

  it("--rebuild wipes project-scoped store entries and reinstalls lean, auto-healing symlinks", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-rebuild-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const storeDir = join(base, "store");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await writeFile(
      join(homeDir, ".config", "skill-cli", "config.json"),
      JSON.stringify({ storeDir }, null, 2),
    );

    const runner = async (
      command: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      if (command === "git" && args[0] === "ls-remote") {
        return { stdout: `ref: refs/heads/main\tHEAD\n${resolvedCommitSha}\tHEAD\n`, stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) await mkdir(barePath, { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        if (args[2] === "archive") {
          const idx = args.indexOf("--output");
          const tarPath = idx >= 0 ? args[idx + 1] : undefined;
          if (tarPath) await writeFile(tarPath, "FAKE");
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }
      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(join(dest, "alpha-skill"), { recursive: true });
          await writeFile(join(dest, "alpha-skill", "SKILL.md"), "# alpha\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    await runInstallCommand(
      { source: "git@github.com:acme/skills.git", tool: "codex", target: { type: "project" }, force: false },
      { cwd, homeDir, output: quietOutput(), runCommand: runner },
    );

    await writeFile(
      join(cwd, "skills-lock.yaml"),
      `version: 2\nskills:\n  - source: git@github.com:acme/skills.git#${resolvedCommitSha}\n    name: "*"\n`,
    );

    const linkPath = join(cwd, ".codex", "skills", "alpha-skill");
    const storeEntryDir = await readlink(linkPath);
    const junkPath = join(storeEntryDir, "JUNK.txt");
    await writeFile(junkPath, "fat leftover\n");

    const result = await runPruneCommand(
      { rebuild: true },
      { cwd, homeDir, output: quietOutput(), runCommand: runner },
    );

    expect(result.rebuiltStoreEntries).toBeGreaterThanOrEqual(1);
    await expect(lstat(junkPath)).rejects.toThrow();
    expect((await lstat(join(storeEntryDir, "SKILL.md"))).isFile()).toBe(true);
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect((await readFile(join(cwd, "skills-lock.yaml"), "utf8")).length).toBeGreaterThan(0);
  });

  it("--rebuild recovers from a legacy cacheKey-pinned lockfile and regenerates resolvable SHAs", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-rebuild-cachekey-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const storeDir = join(base, "store");
    const resolvedCommitSha = "abcdef0123456789abcdef0123456789abcdef01";
    const legacyCacheKeyPin = "c".repeat(64);

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));

    const runner = async (
      command: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      if (command === "git" && args[0] === "ls-remote") {
        return { stdout: `ref: refs/heads/main\tHEAD\n${resolvedCommitSha}\tHEAD\n`, stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "clone" && args[1] === "--bare") {
        const barePath = args[args.length - 1];
        if (barePath) await mkdir(barePath, { recursive: true });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && (args[0] === "remote" || args[0] === "fetch")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git" && args[0] === "--git-dir") {
        if (args[2] === "rev-parse") return { stdout: `${resolvedCommitSha}\n`, stderr: "", exitCode: 0 };
        if (args[2] === "archive") {
          const idx = args.indexOf("--output");
          const tarPath = idx >= 0 ? args[idx + 1] : undefined;
          if (tarPath) await writeFile(tarPath, "FAKE");
          return { stdout: "", stderr: "", exitCode: 0 };
        }
      }
      if (command === "tar") {
        const cIndex = args.indexOf("-C");
        const dest = cIndex >= 0 ? args[cIndex + 1] : undefined;
        if (dest) {
          await mkdir(join(dest, "alpha-skill"), { recursive: true });
          await writeFile(join(dest, "alpha-skill", "SKILL.md"), "# alpha\n");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    };

    await runInstallCommand(
      { source: "git@github.com:acme/skills.git", tool: "codex", target: { type: "project" }, force: false },
      { cwd, homeDir, output: quietOutput(), runCommand: runner },
    );

    await writeFile(
      join(cwd, "skills-lock.yaml"),
      `version: 2\nskills:\n  - source: git@github.com:acme/skills.git#${legacyCacheKeyPin}\n    name: "*"\n`,
    );

    const result = await runPruneCommand(
      { rebuild: true },
      { cwd, homeDir, output: quietOutput(), runCommand: runner },
    );

    expect(result.rebuiltStoreEntries).toBeGreaterThanOrEqual(1);

    const regenerated = await readFile(join(cwd, "skills-lock.yaml"), "utf8");
    expect(regenerated).toContain(resolvedCommitSha);
    expect(regenerated).not.toContain(legacyCacheKeyPin);

    expect((await lstat(join(cwd, ".codex", "skills", "alpha-skill"))).isSymbolicLink()).toBe(true);
  });

  it("--rebuild keeps store entries from the same source that are not linked by this project", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-rebuild-shared-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const storeDir = join(base, "store");
    const sourceRoot = join(cwd, "skills-source");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));

    await runInstallCommand(
      { source: sourceRoot, tool: "codex", target: { type: "project" }, force: false },
      { cwd, homeDir, output: quietOutput() },
    );
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha changed elsewhere\n");
    await runInstallCommand(
      { source: sourceRoot, tool: "codex", target: { type: "global" }, force: false },
      { cwd, homeDir, output: quietOutput() },
    );
    await writeFile(
      join(cwd, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: \"*\"\n",
    );

    const unrelatedEntry = await readlink(join(homeDir, ".codex", "skills", "alpha-skill"));
    await writeFile(join(unrelatedEntry, "KEEP.txt"), "used elsewhere\n");

    await runPruneCommand({ rebuild: true }, { cwd, homeDir, output: quietOutput() });

    expect((await lstat(join(unrelatedEntry, "KEEP.txt"))).isFile()).toBe(true);
  });

  it("--rebuild resolves relative lockfile sources from the project root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-rebuild-relative-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "workspace", "repo");
    const cwd = join(projectRoot, "packages", "app");
    const storeDir = join(base, "store");
    const sourceRoot = join(projectRoot, "skills-source");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));

    await runInstallCommand(
      { source: sourceRoot, tool: "codex", target: { type: "project" }, force: false },
      { cwd: projectRoot, homeDir, output: quietOutput() },
    );
    await writeFile(
      join(projectRoot, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./skills-source\n    name: \"*\"\n",
    );

    await expect(
      runPruneCommand({ rebuild: true }, { cwd, homeDir, output: quietOutput() }),
    ).resolves.toMatchObject({ rebuiltStoreEntries: 1 });
    expect((await lstat(join(projectRoot, ".codex", "skills", "alpha-skill"))).isSymbolicLink()).toBe(true);
  });

  it("--rebuild does not treat an external project symlink as a managed tool install", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-prune-rebuild-external-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const cwd = join(base, "workspace", "repo");
    const storeDir = join(base, "store");
    const externalSkill = join(base, "external", "alpha-skill");

    await mkdir(join(homeDir, ".config", "skill-cli"), { recursive: true });
    await mkdir(join(cwd, ".git"), { recursive: true });
    await mkdir(join(cwd, ".codex", "skills"), { recursive: true });
    await mkdir(externalSkill, { recursive: true });
    await writeFile(join(externalSkill, "SKILL.md"), "# external\n");
    await symlink(externalSkill, join(cwd, ".codex", "skills", "alpha-skill"), "dir");
    await writeFile(join(homeDir, ".config", "skill-cli", "config.json"), JSON.stringify({ storeDir }, null, 2));
    await writeFile(
      join(cwd, "skills-lock.yaml"),
      "version: 2\nskills:\n  - source: ./missing-source\n    name: \"*\"\n",
    );

    await expect(
      runPruneCommand({ rebuild: true }, { cwd, homeDir, output: quietOutput() }),
    ).rejects.toThrow("No managed project installs found to rebuild");
  });
});

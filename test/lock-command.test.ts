import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runLockCommand } from "../src/commands/lock.js";
import { ExitCode } from "../src/core/errors.js";

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

async function writeConfig(options: { homeDir: string; storeDir: string; projectDir: string; globalDir: string }) {
  await mkdir(join(options.homeDir, ".config", "skill-cli"), { recursive: true });
  await writeFile(
    join(options.homeDir, ".config", "skill-cli", "config.json"),
    JSON.stringify(
      {
        storeDir: options.storeDir,
        tools: {
          opencode: {
            globalDir: options.globalDir,
            projectDir: options.projectDir,
            entryPattern: "**/SKILL.md",
            nameStrategy: "parentDir",
          },
        },
      },
      null,
      2,
    ),
  );
}

describe("runLockCommand", () => {
  it("creates skills-lock.yaml from managed project bundles", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-project-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    const capture = captureOutput();
    await runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: capture.output });

    await expect(readFile(join(projectRoot, "skills-lock.yaml"), "utf8")).resolves.toBe(
      "version: 1\n" + "bundles:\n" + "  - source: ./skills-source\n",
    );
    expect(capture.logs.some((line) => line.includes("skills-lock.yaml"))).toBe(true);
  });

  it("errors when destination lockfile already exists as a regular file", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-existing-file-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const outputPath = join(projectRoot, "skills-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeConfig({
      homeDir,
      storeDir: join(base, "store"),
      projectDir: ".opencode/skills",
      globalDir: join(base, "global-skills"),
    });
    await writeFile(outputPath, "version: 1\n", "utf8");

    await expect(
      runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Lockfile already exists/),
      suggestion: expect.stringMatching(/--force/),
    });
  });

  it("treats a broken destination symlink as an existing lockfile", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-existing-broken-link-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const outputPath = join(projectRoot, "skills-lock.yaml");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await writeConfig({
      homeDir,
      storeDir: join(base, "store"),
      projectDir: ".opencode/skills",
      globalDir: join(base, "global-skills"),
    });
    await symlink(join(projectRoot, "missing-lockfile.yaml"), outputPath);

    await expect(
      runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Lockfile already exists/),
      suggestion: expect.stringMatching(/--force/),
    });
  });

  it("skips stale registry-only bundles that are not actually installed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-stale-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    const registryPath = join(storeDir, "registry.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      version: number;
      bundles: Array<Record<string, unknown>>;
    };

    registry.bundles.push({
      ...registry.bundles[0],
      bundleId: "stale-bundle-id",
      bundleName: "stale-bundle",
      sourceRaw: "./stale-source",
      sourceCanonical: join(projectRoot, "stale-source"),
      storedSourceDir: join(storeDir, "store", "stale-bundle"),
      members: [
        {
          skillName: "stale-skill",
          linkPath: join(projectRoot, ".opencode", "skills", "stale-skill"),
        },
      ],
    });
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

    await runLockCommand({ tool: "all", force: true }, { cwd, homeDir, output: captureOutput().output });

    await expect(readFile(join(projectRoot, "skills-lock.yaml"), "utf8")).resolves.toBe(
      "version: 1\n" + "bundles:\n" + "  - source: ./skills-source\n",
    );
  });

  it("errors when no eligible bundles exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-empty-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "global" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/No eligible managed project bundles/),
    });
  });

  it("excludes partially broken managed project bundles when registered members are missing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-partial-bundle-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const projectTargetDir = join(projectRoot, ".opencode", "skills");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await writeFile(join(sourceRoot, "alpha-skill", "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceRoot, "beta-skill", "SKILL.md"), "# beta\n");
    await writeConfig({ homeDir, storeDir, projectDir: ".opencode/skills", globalDir });

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await rm(join(projectTargetDir, "beta-skill"), { recursive: true, force: true });

    await expect(
      runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/No eligible managed project bundles/),
    });
  });
});

import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runInstallCommand } from "../src/commands/install.js";
import { runLockCommand } from "../src/commands/lock.js";
import { ExitCode } from "../src/core/errors.js";
import { loadSkillsLockfile } from "../src/core/lockfile/load.js";

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
  it("creates a version 2 skills-lock.yaml from managed project installs", async () => {
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

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
    expect(capture.logs.some((line) => line.includes("skills-lock.yaml"))).toBe(true);
  });

  it("errors when destination lockfile already exists as a regular file", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-existing-file-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "skills-lock.yaml");

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
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");
    const outputPath = join(projectRoot, "skills-lock.yaml");

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

  it("writes explicit skill names when a managed install only includes part of a source", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-partial-selection-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

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
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output });

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "alpha-skill" }],
    });
  });

  it("collapses repeated installs from the same source to '*' once all skills are installed", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-merged-selection-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");
    const globalDir = join(base, "global-skills");

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
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["beta-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output });

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
  });

  it("rejects lockfile generation when the same source has conflicting skill selections across tools", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-conflicting-tools-"));
    cleanupDirs.push(base);

    const homeDir = join(base, "home");
    const projectRoot = join(base, "repo");
    const cwd = projectRoot;
    const sourceRoot = join(projectRoot, "skills-source");
    const storeDir = join(base, "store");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
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
              projectDir: ".codex/skills",
              globalDir: join(base, "codex-global"),
              entryPattern: "**/SKILL.md",
              nameStrategy: "parentDir",
            },
            opencode: {
              projectDir: ".opencode/skills",
              globalDir: join(base, "opencode-global"),
              entryPattern: "**/SKILL.md",
              nameStrategy: "parentDir",
            },
          },
        },
        null,
        2,
      ),
    );

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "codex",
        target: { type: "project" },
        force: false,
        skills: ["alpha-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await runInstallCommand(
      {
        source: "./skills-source",
        tool: "opencode",
        target: { type: "project" },
        force: false,
        skills: ["beta-skill"],
      },
      { cwd, homeDir, output: captureOutput().output },
    );

    await expect(
      runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/conflicting skill selections/i),
    });
  });

  it("creates skills-lock.yaml from live managed project bundles without registry.json", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lock-command-live-"));
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

    await rm(join(storeDir, "registry.json"), { force: true });
    await expect(lstat(join(storeDir, "registry.json"))).rejects.toThrow();

    await runLockCommand({ tool: "all", force: true }, { cwd, homeDir, output: captureOutput().output });

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "*" }],
    });
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

  it("writes explicit skill names when a managed project bundle is only partially present live", async () => {
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

    await runLockCommand({ tool: "all", force: false }, { cwd, homeDir, output: captureOutput().output });

    await expect(loadSkillsLockfile(join(projectRoot, "skills-lock.yaml"))).resolves.toEqual({
      version: 2,
      skills: [{ source: "./skills-source", name: "alpha-skill" }],
    });
  });
});

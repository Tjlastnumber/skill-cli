import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { ExitCode, SkillCliError } from "../src/core/errors.js";
import { resolveLockedSourceForBundle } from "../src/core/lockfile/resolve-locked-source.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveLockedSourceForBundle", () => {
  it("returns the exact installed npm package name and version", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-npm-"));
    cleanupDirs.push(base);

    const storedSourceDir = join(base, "store", "bundle");
    await mkdir(storedSourceDir, { recursive: true });
    await writeFile(
      join(storedSourceDir, "package.json"),
      JSON.stringify({ name: "@scope/skills-bundle", version: "1.2.3" }, null, 2),
      "utf8",
    );

    await expect(
      resolveLockedSourceForBundle({
        cwd: base,
        bundle: {
          sourceKind: "npm",
          sourceRaw: "npm:@scope/skills-bundle",
          sourceCanonical: "@scope/skills-bundle",
          storedSourceDir,
        },
      }),
    ).resolves.toBe("@scope/skills-bundle@1.2.3");
  });

  it("returns the git source pinned to the stored HEAD commit", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-git-"));
    cleanupDirs.push(base);

    const storedSourceDir = join(base, "store", "bundle");
    await mkdir(storedSourceDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: storedSourceDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: storedSourceDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: storedSourceDir,
      stdio: "ignore",
    });
    await writeFile(join(storedSourceDir, "README.md"), "hello\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: storedSourceDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: storedSourceDir, stdio: "ignore" });

    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: storedSourceDir, encoding: "utf8" }).trim();

    await expect(
      resolveLockedSourceForBundle({
        cwd: base,
        bundle: {
          sourceKind: "git",
          sourceRaw: "https://github.com/acme/skills.git#main",
          sourceCanonical: "github.com/acme/skills",
          storedSourceDir,
        },
      }),
    ).resolves.toBe(`https://github.com/acme/skills.git#${sha}`);
  });

  it("returns a project-relative local source path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-"));
    cleanupDirs.push(base);

    const projectRoot = join(base, "repo");
    const cwd = join(projectRoot, "packages", "app");
    const localSourceDir = join(projectRoot, "skills", "bundle");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(localSourceDir, { recursive: true });

    await expect(
      resolveLockedSourceForBundle({
        cwd,
        bundle: {
          sourceKind: "local",
          sourceRaw: localSourceDir,
          sourceCanonical: localSourceDir,
          storedSourceDir: "unknown",
        },
      }),
    ).resolves.toBe("./skills/bundle");
  });

  it("allows a local source path equal to the project root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-root-"));
    cleanupDirs.push(base);

    const projectRoot = join(base, "repo");
    const cwd = join(projectRoot, "packages", "app");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    await expect(
      resolveLockedSourceForBundle({
        cwd,
        bundle: {
          sourceKind: "local",
          sourceRaw: projectRoot,
          sourceCanonical: projectRoot,
          storedSourceDir: "unknown",
        },
      }),
    ).resolves.toBe("./");
  });

  it("allows an in-project local path whose first relative segment starts with '..'", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-dotdot-prefix-"));
    cleanupDirs.push(base);

    const projectRoot = join(base, "repo");
    const cwd = join(projectRoot, "packages", "app");
    const localSourceDir = join(projectRoot, "..bundle");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(localSourceDir, { recursive: true });

    await expect(
      resolveLockedSourceForBundle({
        cwd,
        bundle: {
          sourceKind: "local",
          sourceRaw: localSourceDir,
          sourceCanonical: localSourceDir,
          storedSourceDir: "unknown",
        },
      }),
    ).resolves.toBe("./..bundle");
  });

  it("rejects local sources outside the project root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-outside-"));
    cleanupDirs.push(base);

    const projectRoot = join(base, "repo");
    const cwd = join(projectRoot, "packages", "app");
    const externalSourceDir = join(base, "external", "bundle");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(externalSourceDir, { recursive: true });

    await expect(
      resolveLockedSourceForBundle({
        cwd,
        bundle: {
          sourceKind: "local",
          sourceRaw: externalSourceDir,
          sourceCanonical: externalSourceDir,
          storedSourceDir: "unknown",
        },
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/inside the project root/),
    });
  });

  it("rejects project-local symlinks that resolve outside the project root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-symlink-"));
    cleanupDirs.push(base);

    const projectRoot = join(base, "repo");
    const cwd = join(projectRoot, "packages", "app");
    const symlinkPath = join(projectRoot, "skills", "external-bundle");
    const externalSourceDir = join(base, "external", "bundle");

    await mkdir(join(projectRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(join(projectRoot, "skills"), { recursive: true });
    await mkdir(externalSourceDir, { recursive: true });
    await symlink(externalSourceDir, symlinkPath);

    await expect(
      resolveLockedSourceForBundle({
        cwd,
        bundle: {
          sourceKind: "local",
          sourceRaw: symlinkPath,
          sourceCanonical: symlinkPath,
          storedSourceDir: "unknown",
        },
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/inside the project root/),
    });
  });

  it("rejects non-absolute local bundle paths with a stable SkillCliError", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-local-relative-"));
    cleanupDirs.push(base);

    await expect(
      resolveLockedSourceForBundle({
        cwd: base,
        bundle: {
          sourceKind: "local",
          sourceRaw: "./bundle",
          sourceCanonical: "./bundle",
          storedSourceDir: "unknown",
        },
      }),
    ).rejects.toMatchObject({
      name: "SkillCliError",
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/expected absolute path/),
    });
  });

  it("rejects unsupported bundle kinds with a stable SkillCliError", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-resolve-unknown-"));
    cleanupDirs.push(base);

    let error: unknown;

    try {
      await resolveLockedSourceForBundle({
        cwd: base,
        bundle: {
          sourceKind: "unknown",
          sourceRaw: "mystery",
          sourceCanonical: "mystery",
          storedSourceDir: "unknown",
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SkillCliError);
    expect(error).toMatchObject({
      exitCode: ExitCode.USER_INPUT,
      message: expect.stringMatching(/Unsupported bundle source kind/),
    });
  });
});

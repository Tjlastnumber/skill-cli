import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { ExitCode } from "../src/core/errors.js";
import { loadSkillsLockfile } from "../src/core/lockfile/load.js";
import { writeSkillsLockfile } from "../src/core/lockfile/write.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("lockfile load/write", () => {
  it("writes stable YAML and loads it back", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-"));
    cleanupDirs.push(base);

    const filePath = join(base, "skills-lock.yaml");
    const lockfile = {
      version: 1 as const,
      bundles: [{ source: "npm:@scope/skills" }, { source: "./skills/local-bundle" }],
    };

    await writeSkillsLockfile(filePath, lockfile);

    const raw = await readFile(filePath, "utf8");
    expect(raw).toBe(
      "version: 1\n" +
        "bundles:\n" +
        "  - source: npm:@scope/skills\n" +
        "  - source: ./skills/local-bundle\n",
    );

    await expect(loadSkillsLockfile(filePath)).resolves.toEqual(lockfile);
  });

  it("throws a user-facing error for invalid YAML", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-invalid-yaml-"));
    cleanupDirs.push(base);

    const filePath = join(base, "skills-lock.yaml");
    await writeFile(filePath, "version: [\n", "utf8");

    await expect(loadSkillsLockfile(filePath)).rejects.toThrow(/Failed to parse lockfile YAML/);
  });

  it("throws a user-facing error for invalid lockfile data", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-invalid-data-"));
    cleanupDirs.push(base);

    const dir = join(base, "project");
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "skills-lock.yaml");
    await writeFile(filePath, "version: 2\nbundles:\n  - source: \"\"\n", "utf8");

    await expect(loadSkillsLockfile(filePath)).rejects.toThrow(/Invalid skills lockfile/);
  });

  it("throws a stable CLI error for invalid lockfile data when writing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-write-invalid-data-"));
    cleanupDirs.push(base);

    const filePath = join(base, "skills-lock.yaml");

    await expect(
      writeSkillsLockfile(filePath, {
        version: 2,
        bundles: [{ source: "" }],
      } as never),
    ).rejects.toMatchObject({
      name: "ConfigError",
      exitCode: ExitCode.CONFIG,
      message: expect.stringMatching(/Invalid skills lockfile/),
    });
  });
});

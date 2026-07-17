import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { persistSkillInStore } from "../src/core/store/persist-skill.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("persistSkillInStore", () => {
  it("excludes .git directory from the stored copy", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-persist-git-"));
    cleanupDirs.push(base);

    const sourceSkillDir = join(base, "source", "alpha-skill");
    const storeRootDir = join(base, "store");
    await mkdir(join(sourceSkillDir, ".git"), { recursive: true });
    await writeFile(join(sourceSkillDir, "SKILL.md"), "# alpha\n");
    await writeFile(join(sourceSkillDir, ".git", "config"), "[remote]\n");
    await writeFile(join(sourceSkillDir, "README.md"), "docs\n");

    const { storedSkillDir } = await persistSkillInStore({
      sourceSkillDir,
      storeRootDir,
      storeEntryKey: "a".repeat(64),
    });

    const entries = await readdir(storedSkillDir, { withFileTypes: true });
    const names = entries.map((entry) => entry.name);
    expect(names).toContain("SKILL.md");
    expect(names).toContain("README.md");
    expect(names).not.toContain(".git");
  });
});

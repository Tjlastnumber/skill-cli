import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SourceError } from "../src/core/errors.js";
import { discoverLocalSearchSkills } from "../src/core/search/discover-local-skills.js";
import { selectSearchSkillCandidatePaths } from "../src/core/search/discovery-policy.js";
import { parseSearchSkillMarkdown } from "../src/core/search/parse-skill-markdown.js";

describe("selectSearchSkillCandidatePaths", () => {
  it("uses only priority-root matches when any are present", () => {
    expect(
      selectSearchSkillCandidatePaths([
        "SKILL.md",
        "nested/reviewer/SKILL.md",
        "skills/reviewer/SKILL.md",
        "skills/team/reviewer/SKILL.md",
        ".claude/skills/linter/SKILL.md",
      ]),
    ).toEqual(["SKILL.md", "skills/reviewer/SKILL.md", ".claude/skills/linter/SKILL.md"]);
  });

  it("falls back to bounded recursive discovery when priority roots are empty", () => {
    expect(
      selectSearchSkillCandidatePaths([
        "nested/reviewer/SKILL.md",
        "deep/team/reviewer/SKILL.md",
        "very/deep/path/to/reviewer/SKILL.md",
      ], 3),
    ).toEqual(["deep/team/reviewer/SKILL.md", "nested/reviewer/SKILL.md"]);
  });
});

describe("parseSearchSkillMarkdown", () => {
  it("reads strict frontmatter fields and hides internal skills", () => {
    expect(parseSearchSkillMarkdown("---\nname: \"  Reviewer  \"\ndescription: \"  Reviews changes  \"\n---\n")).toEqual({
      skillName: "Reviewer",
      description: "Reviews changes",
    });

    expect(
      parseSearchSkillMarkdown("---\nname: Reviewer\nmetadata:\n  internal: true\ndescription: Hidden\n---\n"),
    ).toBeUndefined();
    expect(parseSearchSkillMarkdown("---\ndescription: Missing name\n---\n")).toBeUndefined();
    expect(parseSearchSkillMarkdown("---\nname: Reviewer\ndescription: 42\n---\n")).toBeUndefined();
    expect(parseSearchSkillMarkdown("# Missing frontmatter\n")).toBeUndefined();
  });
});

describe("discoverLocalSearchSkills", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns install-compatible skill names from parent directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-search-policy-"));
    cleanupDirs.push(root);

    await mkdir(join(root, "skills", "reviewer"), { recursive: true });
    await mkdir(join(root, "nested", "linter"), { recursive: true });

    await writeFile(
      join(root, "skills", "reviewer", "SKILL.md"),
      "---\nname: Different frontmatter name\ndescription: Reviews changes\n---\n",
    );
    await writeFile(
      join(root, "nested", "linter", "SKILL.md"),
      "---\nname: linter\ndescription: Should be ignored because priority roots matched\n---\n",
    );

    await expect(discoverLocalSearchSkills(root)).resolves.toEqual([
      {
        skillName: "reviewer",
        description: "Reviews changes",
        path: "skills/reviewer/SKILL.md",
      },
    ]);
  });

  it("falls back to recursive discovery when priority roots are empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-search-policy-"));
    cleanupDirs.push(root);

    await mkdir(join(root, "nested", "reviewer"), { recursive: true });
    await writeFile(
      join(root, "nested", "reviewer", "SKILL.md"),
      "---\nname: Different frontmatter name\ndescription: Reviews changes\n---\n",
    );

    await expect(discoverLocalSearchSkills(root)).resolves.toEqual([
      {
        skillName: "reviewer",
        description: "Reviews changes",
        path: "nested/reviewer/SKILL.md",
      },
    ]);
  });

  it("uses the provided root skill name for a repository-root SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-search-policy-"));
    cleanupDirs.push(root);

    await writeFile(
      join(root, "SKILL.md"),
      "---\nname: Different frontmatter name\ndescription: Root skill\n---\n",
    );

    await expect(discoverLocalSearchSkills(root, { rootSkillName: "bundle-skill" })).resolves.toEqual([
      {
        skillName: "bundle-skill",
        description: "Root skill",
        path: "SKILL.md",
      },
    ]);
  });

  it("fails when final install-compatible skill names collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-cli-search-policy-"));
    cleanupDirs.push(root);

    await mkdir(join(root, "nested", "reviewer"), { recursive: true });
    await mkdir(join(root, "deep", "team", "reviewer"), { recursive: true });

    await writeFile(
      join(root, "nested", "reviewer", "SKILL.md"),
      "---\nname: First frontmatter name\ndescription: Preferred shorter path\n---\n",
    );
    await writeFile(
      join(root, "deep", "team", "reviewer", "SKILL.md"),
      "---\nname: Second frontmatter name\ndescription: Should lose dedupe\n---\n",
    );

    await expect(discoverLocalSearchSkills(root)).rejects.toMatchObject({
      name: SourceError.name,
      message: "Duplicate skill names discovered for tool 'search': reviewer",
      suggestion: "Use unique parent directory names for SKILL.md files",
    });
  });
});

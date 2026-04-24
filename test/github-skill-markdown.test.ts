import { describe, expect, it } from "vitest";

import { extractSkillDescription } from "../src/core/github/skill-markdown.js";

describe("extractSkillDescription", () => {
  it("prefers the description from frontmatter", () => {
    const markdown = `---
description: Frontmatter summary
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe("Frontmatter summary");
  });

  it("parses a folded multiline frontmatter description", () => {
    const markdown = `---
description: >
  Folded descriptions
  span multiple lines.
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "Folded descriptions span multiple lines.",
    );
  });

  it("collapses folded paragraph breaks to a single newline", () => {
    const markdown = `---
description: >
  First folded paragraph.

  Second folded paragraph.
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "First folded paragraph.\nSecond folded paragraph.",
    );
  });

  it("preserves consecutive blank lines in folded descriptions", () => {
    const markdown = `---
description: >
  First folded paragraph.


  Third folded paragraph.
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "First folded paragraph.\n\nThird folded paragraph.",
    );
  });

  it("preserves line breaks for more-indented folded lines", () => {
    const markdown = `---
description: >
  Summary line
    Example detail
  Closing line
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "Summary line\n  Example detail\nClosing line",
    );
  });

  it("parses a literal multiline frontmatter description", () => {
    const markdown = `---
description: |
  Literal descriptions
  preserve line breaks.
---

Body paragraph that should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "Literal descriptions\npreserve line breaks.",
    );
  });

  it("falls back to the first body paragraph when frontmatter description is missing", () => {
    const markdown = `---
title: Example Skill
---

First paragraph becomes the description.

Second paragraph should be ignored.`;

    expect(extractSkillDescription(markdown)).toBe(
      "First paragraph becomes the description.",
    );
  });

  it("skips a heading before the first body paragraph", () => {
    const markdown = `# Example Skill

First paragraph becomes the description.

- Supporting detail`; 

    expect(extractSkillDescription(markdown)).toBe(
      "First paragraph becomes the description.",
    );
  });

  it("skips a code fence before the first body paragraph", () => {
    const markdown = "```md\nexample\n```\n\nFirst paragraph becomes the description.";

    expect(extractSkillDescription(markdown)).toBe(
      "First paragraph becomes the description.",
    );
  });

  it("returns an empty string when neither frontmatter nor body paragraph has a description", () => {
    const markdown = `---
title: Example Skill
---`;

    expect(extractSkillDescription(markdown)).toBe("");
  });
});

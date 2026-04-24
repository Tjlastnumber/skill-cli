function foldBlockScalar(
  blockLines: Array<{ text: string; isBlank: boolean; isMoreIndented: boolean }>,
): string {
  let description = "";

  for (let index = 0; index < blockLines.length; index += 1) {
    const line = blockLines[index];
    if (line.isBlank) {
      continue;
    }

    if (!description) {
      description = line.text;
      continue;
    }

    const previousLine = blockLines[index - 1];
    let blankLineCount = 0;

    for (let blankIndex = index - 1; blankIndex >= 0; blankIndex -= 1) {
      if (!blockLines[blankIndex]?.isBlank) {
        break;
      }

      blankLineCount += 1;
    }

    const nextSeparator =
      blankLineCount > 0
        ? "\n".repeat(blankLineCount)
        : line.isMoreIndented || previousLine?.isMoreIndented
          ? "\n"
        : " ";

    description += nextSeparator + line.text;
  }

  return description;
}

function extractBlockScalar(
  lines: string[],
  startIndex: number,
  style: ">" | "|",
): { description?: string } {
  const blockLines: Array<{ text: string; isBlank: boolean; isMoreIndented: boolean }> = [];
  let blockIndent: number | undefined;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      blockLines.push({ text: "", isBlank: true, isMoreIndented: false });
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (blockIndent === undefined) {
      if (indent === 0) {
        break;
      }

      blockIndent = indent;
    }

    if (indent < blockIndent) {
      break;
    }

    blockLines.push({
      text: line.slice(blockIndent),
      isBlank: false,
      isMoreIndented: indent > blockIndent,
    });
  }

  const rawDescription = blockLines.map((line) => line.text).join("\n").trimEnd();
  if (!rawDescription) {
    return {};
  }

  if (style === "|") {
    return { description: rawDescription };
  }

  return {
    description: foldBlockScalar(blockLines),
  };
}

function parseFrontmatter(markdown: string): { body: string; description?: string } {
  if (!markdown.startsWith("---")) {
    return { body: markdown };
  }

  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    return { body: markdown };
  }

  const frontmatter = frontmatterMatch[1];
  const body = markdown.slice(frontmatterMatch[0].length);
  const lines = frontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^description:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const descriptionValue = match[1].trim();
    if (descriptionValue === ">" || descriptionValue === "|") {
      return { body, ...extractBlockScalar(lines, index + 1, descriptionValue) };
    }

    const description = descriptionValue.replace(/^['"]|['"]$/g, "");
    return { body, description: description || undefined };
  }

  return { body };
}

function extractFirstParagraph(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  const paragraph = normalized
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean)
    .find((section) => {
      const firstLine = section.split("\n", 1)[0]?.trim() ?? "";

      return !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~)/.test(firstLine);
    });

  return paragraph ?? "";
}

export function extractSkillDescription(markdown: string): string {
  const { body, description } = parseFrontmatter(markdown);

  if (description) {
    return description;
  }

  return extractFirstParagraph(body);
}

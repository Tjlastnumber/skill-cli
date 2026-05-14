import { createOutput, type Output } from "../core/output.js";
import { searchSourceSkills } from "../core/search/search-source-skills.js";
import type { SearchProviderResult, SearchSkillRecord } from "../core/search/types.js";

export interface SearchCommandArgs {
  repositoryUrl: string;
  filter?: string;
}

export interface SearchRuntimeOptions {
  output?: Output;
  searcher?: (source: string, onNotice: (message: string) => void) => Promise<SearchProviderResult>;
}

function matchesFilter(skill: SearchSkillRecord, filter: string): boolean {
  const normalizedFilter = filter.toLowerCase();
  return [skill.skillName, skill.description, skill.path].some((value) =>
    value.toLowerCase().includes(normalizedFilter),
  );
}

export async function runSearchCommand(
  args: SearchCommandArgs,
  runtime: SearchRuntimeOptions = {},
): Promise<SearchProviderResult> {
  const output = runtime.output ?? createOutput();
  const searcher =
    runtime.searcher ??
    ((repositoryUrl: string, onNotice: (message: string) => void) =>
      searchSourceSkills(repositoryUrl, { onFallback: onNotice }));
  const result = await searcher(args.repositoryUrl, (message) => output.info(message));
  const filter = args.filter?.trim();
  const skills = filter ? result.skills.filter((skill) => matchesFilter(skill, filter)) : result.skills;

  output.info(`Repository: ${result.repository.displayName}`);
  if (result.repository.defaultBranch) {
    output.info(`Default branch: ${result.repository.defaultBranch}`);
  }
  output.info(`Skills: ${skills.length}`);
  output.info("");

  if (result.skills.length === 0) {
    output.info("No skills found in repository");
    return {
      repository: result.repository,
      skills,
    };
  }

  if (filter && skills.length === 0) {
    output.info(`No skills matched filter: ${filter}`);
    return {
      repository: result.repository,
      skills,
    };
  }

  for (const [index, skill] of skills.entries()) {
    if (index > 0) {
      output.info("");
    }

    output.info(`  ${skill.skillName}`);
    output.info(`    description: ${skill.description}`);
    output.info(`    path: ${skill.path}`);
  }

  return {
    repository: result.repository,
    skills,
  };
}

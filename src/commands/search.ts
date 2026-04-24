import { browseRepositorySkills, type BrowseRepositorySkillsResult } from "../core/github/browse-repository-skills.js";
import { createOutput, type Output } from "../core/output.js";

export interface SearchCommandArgs {
  repositoryUrl: string;
  filter?: string;
}

export interface SearchRuntimeOptions {
  output?: Output;
  browser?: (repositoryUrl: string) => Promise<BrowseRepositorySkillsResult>;
}

function matchesFilter(skill: BrowseRepositorySkillsResult["skills"][number], filter: string): boolean {
  const normalizedFilter = filter.toLowerCase();
  return [skill.skillName, skill.description, skill.path].some((value) =>
    value.toLowerCase().includes(normalizedFilter),
  );
}

export async function runSearchCommand(
  args: SearchCommandArgs,
  runtime: SearchRuntimeOptions = {},
): Promise<BrowseRepositorySkillsResult> {
  const output = runtime.output ?? createOutput();
  const browser = runtime.browser ?? ((repositoryUrl: string) => browseRepositorySkills(repositoryUrl));
  const result = await browser(args.repositoryUrl);
  const filter = args.filter?.trim();
  const skills = filter ? result.skills.filter((skill) => matchesFilter(skill, filter)) : result.skills;

  output.info(`Repository: ${result.repository.displayName}`);
  output.info(`Default branch: ${result.repository.defaultBranch}`);
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

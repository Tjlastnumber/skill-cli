import { z } from "zod";

export const skillsLockfileSkillSchema = z
  .object({
    source: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const skillsLockfileSchema = z
  .object({
    version: z.literal(2),
    skills: z.array(skillsLockfileSkillSchema),
  })
  .strict();

export type SkillsLockfile = z.infer<typeof skillsLockfileSchema>;

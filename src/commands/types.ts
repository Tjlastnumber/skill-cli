export type InstallTargetType = "global" | "project" | "dir";

export interface InstallTarget {
  type: InstallTargetType;
  dir?: string;
}

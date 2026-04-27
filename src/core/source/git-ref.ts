export function isCommitSha(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{7,40}$/i.test(value));
}

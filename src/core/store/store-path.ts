export interface StorePathInfo {
  cacheKey: string;
  storedSourceDir: string;
}

export function parseStoredSourceFromPath(pathValue: string): StorePathInfo | undefined {
  const normalized = pathValue.replace(/\\/g, "/");
  const marker = "/store/";
  const index = normalized.lastIndexOf(marker);

  if (index === -1) {
    return undefined;
  }

  const start = index + marker.length;
  const remainder = normalized.slice(start);
  const cacheKey = remainder.split("/")[0];

  if (!cacheKey || !/^[0-9a-f]{64}$/i.test(cacheKey)) {
    return undefined;
  }

  const storedSourceDir = normalized.slice(0, start + cacheKey.length);

  return {
    cacheKey,
    storedSourceDir,
  };
}

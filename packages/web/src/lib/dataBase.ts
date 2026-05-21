const normalizeBaseUrl = (value: string) =>
  value?.endsWith("/") ? value.slice(0, -1) : value ?? "";

const getBaseUrl = (override?: string) => {
  const envBase = normalizeBaseUrl(override ?? (import.meta.env.PUBLIC_DATA_BASE_URL ?? ""));
  if (envBase) return envBase;
  return import.meta.env.DEV ? "" : "";
};

const getReleasePath = () =>
  normalizeBaseUrl(import.meta.env.PUBLIC_DATA_RELEASE_PATH ?? "");

export const withDataBase = (path: string, overrideBase?: string): string => {
  const baseUrl = getBaseUrl(overrideBase);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  // Only strip the leading /data/ segment when a CDN base URL is configured —
  // locally the static files are served at /data/dist/... as-is.
  const strippedPath =
    baseUrl && normalizedPath.startsWith("/data/")
      ? normalizedPath.slice("/data".length)
      : normalizedPath;
  return `${baseUrl}${getReleasePath()}${strippedPath}`;
};

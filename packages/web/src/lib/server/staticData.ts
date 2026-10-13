// Server-side access to the /data/dist JSON, bundled into the server build
// rather than fetched. svelte-kit-sst gives SvelteKit no file reader, so a load's
// fetch("/data/dist/…") was an HTTPS round trip through CloudFront on every
// request (agency_index.json alone is 4.4 MB), and SST can bring up new function
// code before it uploads that deploy's files, so a fetch could read the previous
// deploy's data (#292). Bundled, code and data ship together. Each file is its
// own lazily loaded module: parsed once per process, reloaded by vite dev when
// the pipeline rewrites it.
const files = import.meta.glob("/static/data/dist/**/*.json", { import: "default" });

// One parse is shared by every request, so an in-place sort or write would leak
// into the next page; frozen, it throws instead.
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

// Parsed /data/dist/<file>, or null when this build doesn't have it.
export async function readStaticData<T>(file: string): Promise<T | null> {
  const load = files[`/static/data/dist/${file}`];
  return load ? deepFreeze((await load()) as T) : null;
}

# Agents

How AI coding agents (Claude, Copilot, etc.) should behave in this repo. Originally written by a human; later sections were drafted by an agent at the maintainer's direction and reviewed by him.

---

## What this is

A data journalism tool. The audience is readers, not engineers. Code quality matters, but what matters most is whether the journalism is accurate, fast, and accessible. A working map with current data beats a beautifully architected app with stale numbers.

---

## Stack

TypeScript throughout. SvelteKit for the frontend. Node.js for the pipeline. Do not introduce Python, Rust, Go, or other runtimes unless there is an explicit and compelling reason discussed first. Do not introduce new frameworks.

---

## Hard rules

**Commit often, in small atomic units — but never to `main`.** Branch first, then commit each coherent piece of work as you finish it rather than piling everything into one change. Granular history is the point: it reviews better, reverts cleanly, and shows the reasoning. You do not need to ask before each commit on a branch.

**Do not commit to `main`, ever.** Not a fixup, not a one-line doc tweak. If you are on `main` with something to commit, branch first.

**Do not push unless explicitly asked.** A commit approval is not a push approval, and neither is a merge approval.

**Do not add dependencies without asking first.** Every new package is a liability. If the standard library can do it in 30 lines, use the standard library.

**Do not write README-style comments.** If code needs explanation beyond its name, restructure it. One-line comments are acceptable only for non-obvious constraints or workarounds. Never explain what the code does — only why, and only when it's surprising.

**Do not add speculative error handling.** The pipeline fetches from two known URLs and parses known formats. Do not add retries, circuit breakers, or null guards for internal invariants that cannot fail. Validate at system boundaries (external HTTP, user input, third-party API payloads) only — a field arriving from an outside service *is* a boundary, and a guard there is not speculative. When a boundary value is absent, fail loudly; never coerce it into a plausible-looking default. `Number(null)` is `0`, and a silent `0` shipped "the 0th such total in the country" to readers.

**Never `--force` a PromptQL run.** The program caches server-side; a plain run rides that cache. `--force` triggers a recompute and bills real money for prose that already exists. This is absolute — not "avoid by default." If a recompute genuinely seems necessary, ask; do not reach for the flag. Freshness is the upstream program's responsibility, so do not add client-side cache-busting, staleness heuristics, or retry-with-force fallbacks either. Before any multi-state pull, confirm the cache is warm by running ONE state and checking `run_meta.cache_generated_at` against `served_at` — if the former predates the latter, you read the cache and paid nothing.

**The maintainer runs the deploys.** "We'll deploy" and "let's ship it" mean *get everything ready*, not *run it*. Do all the prep — merge, refresh data, verify — then hand over the exact command (`pnpm run deploy --stage prod [--bake-og] [--bake-video]`; note `pnpm run`, since bare `pnpm deploy` collides with pnpm's builtin). Deploying from `main` goes straight to production; there is no staging gate.

**Never use the word "surge" in reader-facing copy.** Not in titles, deks, chart labels, headings, slugs, or output filenames. Frame it as the network expanding, coverage growing, or the pace picking up. Internal identifiers that never render are fine.

**Do not touch slug generation without flagging it loudly.** Slugs (`/agency/[slug]`) may be linked externally. A change to slug logic is a breaking change and requires a migration plan or a deliberate decision to accept broken links.

**Every user-facing string goes through the translation layer.** This is a bilingual EN/ES site (Paraglide / `@inlang/paraglide-js`). Any text a reader can see must be a Paraglide message — `m.key()` from `$lib/paraglide/messages.js`, with the key added to both `messages/en.json` and `messages/es.json`. No hardcoded English literals in components, and that includes the easy-to-miss ones: `aria-label`s, SVG chart axis/legend/tooltip copy, dropdown options, units ("agreements"/"agencies"), and empty states. Format numbers and dates against the active locale — derive `getLocale() === "es" ? "es-MX" : "en-US"` and pass it to `Intl.NumberFormat`/`Intl.DateTimeFormat`; never a bare `Intl` default or a hardcoded month-name array (see `MapTimelineScrubber.svelte`). Source material — agency names, MOA text, official records — stays in English by design (see the `source_material_notice` key). One further exception: **verbatim technical constants** — the actual English strings a system consumes, such as API prompt text or literal search queries — stay untranslated, because translating them would misrepresent what the pipeline sends. Only the connective prose around them is keyed. Precedent: the methodology page shows the Perplexity angle prompts and Google query variants verbatim, with an HTML comment explaining why.

---

## Workflow expectations

### Tickets and branches

Work is tracked in tickets. When a discrete bug surfaces — including one found while doing something else — **file the issue, then branch from `origin/main`** (`<issue#>-<kebab-slug>`), fix only that bug, and open a PR that closes it. Do not bundle it into whatever branch is already checked out.

Finding a bug is not authorization to start fixing it. Surface it, propose the fix, and wait — especially before touching source that the current task didn't ask you to touch. One heads-up beats a finished side-quest that has to be unwound.

### Changes only a human can judge

For anything whose correctness is a matter of feel — mobile tap targets, scroll behavior, animation timing — push the PR and stop. Say what to test and hand it over. Automated checks can confirm the logic and cannot confirm that it feels right on a real phone.

### Explaining failures

When something breaks, report what you measured, not a story that fits the timestamps. If the mechanism is inferred rather than measured, say so or go measure it — usually one command. A confident wrong explanation is worse than "I don't know yet," because it gets acted on.

### Pipeline changes

After any change to `packages/pipeline/ingest.ts`, run `pnpm pipeline` and verify the output makes sense:

- Active agency count should be in the range of 2,100–2,400 (2,231 as of the 2026-10-01 snapshot). `agency_index.json` is **active-only**; departures live in `terminated_agencies.json` (112)
- All or nearly all agencies should have a `signed_date` (currently 100%)
- Geocoded percentage should be above 90% (95.4% as of 2026-10-01; most of the rest are statewide agencies kept off-map by design)
- Model breakdown should show Task Force as the plurality (1,855 TFM / 566 WSO / 184 JEM)

Update these figures when they drift rather than working around them — a sanity range that lags reality trains everyone to ignore it.

If those numbers move in an unexpected direction, investigate before declaring the work done. The pipeline output is the product.

The live pipeline is the TypeScript one (`ingest.ts`). Any Python files you find under `packages/pipeline/` are unrelated in-progress work owned by someone else — not the live stack, and not something to build on or clean up.

**An enrichment that reads a gitignored input will silently degrade in CI.** The file isn't in the repo, so CI has nothing to read; ingest logs one line, emits nulls, every `{#if}`-guarded block disappears without error, and the change gate cheerfully deploys the field-less data. This wiped the MOA signer and contact fields from production for six days before anyone noticed. When adding any enrichment with a gitignored input, wire up its CI production in the same PR, and hard-fail the job if the input can't be produced — no deploy beats a field-less deploy.

### Web changes

After any change to `packages/web`, run `pnpm dev:web`, open the browser, and exercise the feature. Search for an agency. Click through to its page. Resize the window. Make sure the map still renders. Type checking and lint do not verify that the map loads.

---

## Data source

The authoritative roster is the `sheets/` directory in [appelson/Tracking_287g](https://github.com/appelson/Tracking_287g) (daily snapshots). That repo also published a hand-vetted `agreements.csv` (the roster joined to ICPSR study 38771 for ORIs, population, and budgets) that runs as a correction layer *ahead* of the FBI name heuristic. Upstream deleted it on 2026-06-08, so the pipeline now reads a vendored last-good copy at `packages/pipeline/data/agreements.csv` (pinned to commit `0afaab4f`); it is committed, not fetched. See `AGREEMENTS_CSV` in `ingest.ts`. Refresh it by re-running that repo's `analysis/adding_address.R` against a newer roster.

When the upstream schema changes (it has before), the pipeline will fail noisily at the column mapping step in `ingest.ts`. Fix it there. Do not patch around it deeper in the logic.

---

## Known gaps — do not invent solutions for these without direction

- **MOA links** — the `moa_url` field exists throughout but the sheets source currently only has placeholder "link" text. When real URLs arrive, the agency pages will show them automatically. No action needed now.
- **Population data** — `population_policed` and `operating_budget` are attached for ~526 agencies from the vendored `agreements.csv` crosswalk (see Data source). They are frozen at upstream's last publication (2026-06-08), so agencies that signed after that date won't carry them until the crosswalk is refreshed. FBI LEE `population` (a different figure) covers the rest.
- **City-level geocoding** — we currently place agencies at the county centroid. More precise geocoding (by address or agency name) is possible but not needed yet.
- **Historical tracking** — the pipeline always takes the latest snapshot. Trend data over time is a future concern.
- **Editorial content** — the About, Methodology, and Glossary pages are stubs. The placeholder text in the model description cards on the homepage ("Fill in: ...") also needs real copy. These are editorial tasks, not engineering.

---

## Future pipeline

The plan, when we get there: a proper Dagster pipeline in Python. Until then, the Node.js script is the right call — it keeps the runtime footprint small and the whole stack in one language.

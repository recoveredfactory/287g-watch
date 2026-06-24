# Agents

How AI coding agents (Claude, Copilot, etc.) should behave in this repo. Written by a human.

---

## What this is

A data journalism tool. The audience is readers, not engineers. Code quality matters, but what matters most is whether the journalism is accurate, fast, and accessible. A working map with current data beats a beautifully architected app with stale numbers.

---

## Stack

TypeScript throughout. SvelteKit for the frontend. Node.js for the pipeline. Do not introduce Python, Rust, Go, or other runtimes unless there is an explicit and compelling reason discussed first. Do not introduce new frameworks.

---

## Hard rules

**Do not commit unless explicitly asked.** Present the diff, explain what changed and why, then wait.

**Do not push unless explicitly asked.** A commit approval is not a push approval.

**Do not add dependencies without asking first.** Every new package is a liability. If the standard library can do it in 30 lines, use the standard library.

**Do not write README-style comments.** If code needs explanation beyond its name, restructure it. One-line comments are acceptable only for non-obvious constraints or workarounds. Never explain what the code does — only why, and only when it's surprising.

**Do not add speculative error handling.** The pipeline fetches from two known URLs and parses known formats. Do not add retries, circuit breakers, or null guards for internal invariants that cannot fail. Validate at system boundaries (external HTTP, user input) only.

**Do not touch slug generation without flagging it loudly.** Slugs (`/agency/[slug]`) may be linked externally. A change to slug logic is a breaking change and requires a migration plan or a deliberate decision to accept broken links.

**Every user-facing string goes through the translation layer.** This is a bilingual EN/ES site (Paraglide / `@inlang/paraglide-js`). Any text a reader can see must be a Paraglide message — `m.key()` from `$lib/paraglide/messages.js`, with the key added to both `messages/en.json` and `messages/es.json`. No hardcoded English literals in components, and that includes the easy-to-miss ones: `aria-label`s, SVG chart axis/legend/tooltip copy, dropdown options, units ("agreements"/"agencies"), and empty states. Format numbers and dates against the active locale — derive `getLocale() === "es" ? "es-MX" : "en-US"` and pass it to `Intl.NumberFormat`/`Intl.DateTimeFormat`; never a bare `Intl` default or a hardcoded month-name array (see `MapTimelineScrubber.svelte`). Source material — agency names, MOA text, official records — stays in English by design (see the `source_material_notice` key).

---

## Workflow expectations

### Pipeline changes

After any change to `packages/pipeline/ingest.ts`, run `pnpm pipeline` and verify the output makes sense:

- Agency count should be in the range of 1,400–1,700 (as of mid-2026)
- All or nearly all agencies should have a `signed_date`
- Geocoded percentage should be around 80–85%
- Model breakdown should show Task Force as the plurality

If those numbers move in an unexpected direction, investigate before declaring the work done. The pipeline output is the product.

### Web changes

After any change to `packages/web`, run `pnpm dev:web`, open the browser, and exercise the feature. Search for an agency. Click through to its page. Resize the window. Make sure the map still renders. Type checking and lint do not verify that the map loads.

---

## Data source

The authoritative source is the `sheets/` directory in [appelson/Tracking_287g](https://github.com/appelson/Tracking_287g). Daily snapshots. The `agreements.csv` at that repo's root is stale (last updated July 2025) — do not use it.

When the upstream schema changes (it has before), the pipeline will fail noisily at the column mapping step in `ingest.ts`. Fix it there. Do not patch around it deeper in the logic.

---

## Known gaps — do not invent solutions for these without direction

- **MOA links** — the `moa_url` field exists throughout but the sheets source currently only has placeholder "link" text. When real URLs arrive, the agency pages will show them automatically. No action needed now.
- **Population data** — dropped when we moved off `agreements.csv`. Could be restored via a crosswalk to CSLLEA or another source. Not a current priority.
- **City-level geocoding** — we currently place agencies at the county centroid. More precise geocoding (by address or agency name) is possible but not needed yet.
- **Historical tracking** — the pipeline always takes the latest snapshot. Trend data over time is a future concern.
- **Editorial content** — the About, Methodology, and Glossary pages are stubs. The placeholder text in the model description cards on the homepage ("Fill in: ...") also needs real copy. These are editorial tasks, not engineering.

---

## Future pipeline

The plan, when we get there: a proper Dagster pipeline in Python. Until then, the Node.js script is the right call — it keeps the runtime footprint small and the whole stack in one language.

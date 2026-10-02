# Add Deportation Data Project data: ICE detainers and arrests, tied to 287(g) agencies

## Summary

This adds **ICE Detainers** and **ICE Arrests** sections to every agency
page and state page. The data comes from the
[Deportation Data Project](https://deportationdata.org) (UC Berkeley Law +
UCLA): ICE's own individual-level enforcement records, obtained through FOIA
litigation and released as public domain (CC-0).

It also builds a third piece, **287(g) "success stories"** (ICE's own
published arrest narratives), and ships it **switched off** pending an
editorial decision.

This description is written as a plan: what's solid, what's weak, what we
got wrong along the way, and what's deliberately left out.

| Feature | Status | Coverage |
|---|---|---|
| ICE Detainers | **Live**, agency + state pages | 15,492 of 22,622 records matched to 181 agencies (68%) |
| ICE Arrests | **Live**, agency + state pages | 980 of 53,219 matched to 114 agencies (1.8%); hidden below 5 matches |
| Success stories | **Built, flag off** | 411 of 486 matched to agencies; Tory's sample check found no wrong matches |
| Removals, book-ins, encounters | **Not built** | Ruled out; see "What we didn't build" |

---

## Decisions needed

1. **Success stories: publish at all?** This is an editorial call, not a code
   review. These are ICE's self-selected accounts of cases that make its own
   program look effective, about people who can't respond. Recommendation:
   don't flip `SHOW_SUCCESS_STORIES` as part of this PR; decide it
   separately. Tory spot-checked a sample of the matched stories and found
   no wrong matches, so the bigger open question is editorial, not data.
2. **Is the detainer outcome bucketing fair?** `classifyOutcome()` collapses
   ICE's 16 administrative "lift reason" codes into 5 reader-facing buckets
   (booked / released / declined by agency / pending / other). That's an
   editorial simplification of ICE's language and deserves a second read.

## Where to look hardest

1. **Arrests matching.** It's the weakest signal shipped live (1.8% match
   rate). One false positive was caught and fixed (see "Bugs found and
   fixed"); there's no proof it was the only one. Spot-check a few agencies
   against source records.
2. **The "didn't build" calls**, especially book-ins: we judged that table to
   be federal ICE facilities rather than local jails. That's the call most
   likely to be second-guessed.
3. Normal code review of the matchers, the `data-refresh.yml` step, and the
   UI (stacked bars, disclaimers, the 5-match minimum on arrests).

---

## How this was verified

- **Every changed match assignment read by hand.** When the matcher rules
  changed, we listed every source facility string whose assigned agency
  changed (26 for detainers, 30 for arrests) and checked each one. Details
  under "Bugs found and fixed."
- **Typecheck:** `pnpm check`, 0 errors.
- **Translations:** EN/ES message files at parity (375 keys each).
- **Full pipeline run**, as AGENTS.md requires after touching `ingest.ts`,
  against the 2026-10-01 snapshot: 2,231 active agencies, 100% with
  `signed_date`, 95.4% geocoded. The `ingest.ts` change only moves
  `editDistance()` into `lib/`, and the moved function is logically identical.
- **Clean install:** `pnpm install --frozen-lockfile` passes on the merged
  lockfile.
- **In the browser:** agency and state pages checked in English (desktop)
  and Spanish (390px phone width) with no page errors. Checked that pages
  hide the section when there's no data (Vermont) and that arrests stay
  hidden below 5 matches (Broward).

---

## The data and how it's matched

We pull two tables:

- `detainers-latest.parquet`: every ICE detainer request, anonymized.
  Filtered to rows whose program field marks a 287(g) agreement: **22,622
  rows**.
- `arrests-latest.parquet`: every ICE arrest. Filtered on
  `apprehension_method == "287(g) Program"`: **53,219 rows**.

Neither table names a roster agency directly. They name a facility or a
location string, and we match that text to our roster. **That matching is
where this PR most needs scrutiny.**

Both build scripts (`build-detainer-stats.ts`, `build-arrest-stats.ts`) use
the same conservative design:

1. Reduce the source text and each agency name to their distinctive words.
   Drop words like "sheriff," "office," and "jail"; keep "county," "police,"
   and "city," which tell agencies apart.
2. Only consider agencies in the same state.
3. Compare by edit distance.
4. **Accept a match only if it's close and has no near-tie.** Borderline
   cases are dropped, not guessed.

Nothing borderline reaches a page. The cost is an undercount, covered below.

State totals are **the sum of the matched agency numbers** a reader sees by
clicking into each agency, not a separate count. That excludes unmatched
records, but it means a state's number and its agencies' numbers can never
disagree.

---

## ICE Detainers

**What ships:** a total, a year-by-year bar chart stacked by outcome, top
countries of origin, and (on state pages) a "most detainers, by agency" list
with the date the state's first agreement was signed.

**Known limitations:**

- **32% of 287(g) detainer records (7,130 of 22,622) aren't counted.**
  Either the facility field was missing or no agency matched confidently.
  The page says so.
- **10 roster agencies can't be matched by name, by design.** Some counties'
  jail and sheriff are listed as two separate 287(g) agencies (Bullitt and
  Oldham, KY; Jackson, FL; Franklin, PA). A facility string can't say which
  one it means, so the matcher drops it. Waukesha, WI also appears twice
  ("Sheriff's Department" and "Sheriff's Office"), which looks like an
  upstream roster duplicate.
- **Outcome bucketing** is an editorial simplification (Decision 2 above).

## ICE Arrests

**What ships:** the same layout, stacked by convicted / pending charges /
other. **Hidden unless an agency or state has 5+ matches**, so a page never
shows a lone "1 arrest."

**Known limitations:**

- **Only 1.8% of records match.** The field we match against
  (`event_landmark`) is messy. About two-thirds of non-null values are vague
  ICE area codes ("DALLAS COUNTY GENERAL AREA," "DO NOT USE"), and about 16%
  of rows have no landmark at all. Only about 13% name anything that looks
  like an agency.
- The page copy says the figures "undercount real activity and should be
  read as a floor, not a total."

---

## Bugs found and fixed

These are worth reading. Each is a way this approach can be **quietly,
confidently wrong**, which is the strongest argument for spot-checking the
output and not just the match rate.

- **Name collisions (fixed in this PR).** The matcher used to treat
  "county," "police," and "city" as filler, so "Benton County Sheriff's
  Office" and "Benton Police Department" looked identical. Ties are
  rejected, so both got nothing. This got worse each time a city PD joined
  287(g): on unchanged source data, detainer coverage slid from 63% to 58%,
  and 64 agencies were zeroed out. After the fix (68%), every changed
  assignment was reviewed:
  - **Correct matches recovered:** Benton County Detention Center (1,157
    detainers), Montgomery County Jail, TX (973), Tarrant County Jail (339),
    Knox County Jail, TN (94 arrests), among others.
  - **Wrong matches removed, about 170 rows.** "Horry County *Police*
    Department" had been credited to Horry County *Sheriff* (90 rows).
    "Clayton County Jail" had been credited to *Claxton* Police Department, a
    different town. Stewart Detention Center, a federal ICE facility, had
    been credited to Stewart County Sheriff. Bledsoe and Hardeman
    "Correctional Facility," both state prisons, had been credited to county
    sheriffs. **The earlier numbers contained misattributions, not just
    undercounts.**
  - One arguable loss: a single misspelled "HILSBOROUGH CORRECTIONAL" row.
- **Apostrophes.** "Sheriff's" was being split into "Sheriff" plus a stray
  "s," inflating every distance. Fixing it took detainer coverage from **7%
  to 63%**. The first version would have shown about a ninth of the data,
  with no error anywhere.
- **Title-casing.** "NEW JERSEY" became "New jersey," silently breaking
  state lookups for multi-word states. The same bug hit country names ("El
  salvador").
- **"STUART."** A bare Florida ICE sub-office code was fuzzy-matching
  "Stuart Police Department" by coincidence, which would have credited 770
  arrests to the wrong agency. Arrests now only match if the text contains an
  institutional word (sheriff, police, jail, correctional…). We checked for
  other bare codes above 20 occurrences and found none. That's a heuristic,
  not a proof.
- **Repeated words.** "YOUNG COUNTY SHERIFFS COUNTY" lost its correct match
  once "county" started counting. Duplicate words are now ignored, which
  also recovered "Nacogdoches County Jail, Nacogdoches, TX."
- **A CI design that would have damaged prod.** An earlier version refreshed
  the stats in a separate weekly workflow that deployed from a bare checkout,
  with no news summaries or `state_meta.json`. It would have wiped both from
  the live site. It was replaced before merge (see "How this stays current").

---

## Success stories: built, switched off

`SHOW_SUCCESS_STORIES = false` in `packages/web/src/lib/features.ts`.
Nothing is visible on the site.

**What it is:** ICE publishes "287(g) Encounter Report" PDFs, short
narratives each describing an arrest and attributing it to a local 287(g)
agency. We extracted 486 from 31 PDFs and machine-matched them to agencies;
411 matched at exact/high confidence. **Tory spot-checked a sample and
found no wrong matches**, which is why the correction file
(`success_stories_overrides.yaml`) is empty.

**Why it's switched off:** this isn't a record ICE was forced to disclose.
It's ICE's own selection and framing of cases, about people who can't
respond and whose cases may not be final. Two separate questions:

1. **Data quality:** are the agency matches right? Tory's sample check found no errors;
   a sample isn't a full audit.
   Only exact/high-confidence or human-corrected stories would ship.
2. **Editorial judgment:** should the site publish an interested party's
   prosecution narratives, attributed to named local agencies, at all? Is
   the disclaimer honest enough? That's a publishing decision, and it should
   be made explicitly, not by default when someone flips the flag.

The disclaimer (written, not yet shown) says these are allegations and case
characterizations published by the enforcing agency, not court records, not
independently verified, and not necessarily final.

**Before the flag can go on:** the source PDFs aren't committed, so CI can't
build `success_stories.json`, and it isn't in `copy-static-data.mjs`. Its
production has to be wired into CI first, or the section ships empty.

---

## What we didn't build

The Deportation Data Project's `ice` repo has 11 datasets. We shipped two,
ruled out the ones below, and **did not open five**: `detention-stints`,
`joined-arrests-detention-stays`, and the historical 2012–2023
`ice-arrests`, `ice-detentions`, and `ice-rcas` files. Those are worth a
follow-up, especially the joined arrests/detention table.

- **Removals** (`ice-removals-2012-2023`): only covers 2012–2023 and ships as
  a 478MB–2GB file with no parquet version. **We didn't open it**, so whether
  it has a usable facility or agency field is unverified. It was ruled out on
  date range and format. Most agreements this site tracks were signed
  2024–2026, and claiming "this detainer led to this removal" would need a
  link we haven't shown exists.
- **Book-ins / detention stays** (`detention-stays-latest`): we inspected
  this one. Its facility field is almost entirely federal ICE detention
  centers (Krome, Stewart, Port Isabel, Moshannon Valley), where people go
  *after* leaving local custody, not the 287(g) agency's own jail. The real
  local "booked" signal is already in the detainer outcome breakdown.
- **Encounters:** no dataset by this name. Arrests is the closest match; a
  separate section would likely have shown the same records twice.
- **`facilities-state` / `msc-charge-codes`:** small (13–35KB) files that, by
  name and size, look like lookup tables. We checked their size, not their
  contents.

---

## How this stays current

Both stats files are produced inside the existing `data-refresh.yml` job,
right after ingest (the matchers need the fresh roster):

- **Sunday's 21:00 UTC run** (or a `build_ice_stats` dispatch) re-downloads
  the source data and rebuilds both files. The upstream data moves on the
  order of weeks, so downloading ~60MB twice a day would buy nothing.
- **Every other run carries the live site's copies forward**, the same way
  news summaries already work. A first deploy with nothing live builds fresh.
- **The step fails the job if either file is missing**, per AGENTS.md's rule
  for gitignored inputs: no deploy beats a deploy that silently drops a
  section. `copy-static-data.mjs` also fails on a missing file.
- **The change gate compares both files to the live site.** A stats-only
  change gets a plain site deploy (no video bake, no social post), like a
  news-only change.

The output JSON is gitignored, like `agency_index.json`.

---

## Files changed

- **Pipeline:** `build-detainer-stats.ts`, `build-arrest-stats.ts`,
  `extract-success-stories.ts`, `match-success-stories.ts`,
  `build-success-stories.ts`, `lib/editDistance.ts` (moved out of
  `ingest.ts`).
- **Web:** detainer and arrest sections in
  `routes/agency/[slug]/+page.{server.ts,svelte}` and
  `routes/state/[abbr]/+page.{server.ts,svelte}`; `$lib/arrestStats.ts`,
  `$lib/deportationDataColors.ts`; success-stories plumbing behind
  `SHOW_SUCCESS_STORIES` in `$lib/features.ts`.
- **CI:** `data-refresh.yml` gets an ICE stats step, a `build_ice_stats`
  dispatch input, and stats in the change gate and site-only deploy.
- **Dependencies:** `hyparquet`, `hyparquet-compressors` (pipeline only, for
  reading compressed parquet in Node). Approved by Tory per AGENTS.md.
- **Translations:** EN/ES keys for both sections, at parity.
- **Tracked data:** `success_stories_overrides.yaml` (human corrections, same
  role as `agency_notes.yaml`).

The "Pipeline changes" sanity ranges in AGENTS.md had drifted out of date,
so a normal `pnpm pipeline` run now lands outside them. AGENTS.md says to
update these when they drift, so a stale range doesn't train everyone to
ignore it.

Updated to the 2026-10-01 snapshot, matching what the live site serves today:

| Figure | Was (2026-07-21) | Now (2026-10-01) |
|---|---|---|
| Active agencies | 1,846 (range 1,750–1,900) | 2,231 (range 2,100–2,400) |
| Terminated | 86 | 112 |
| Geocoded | 95.6% | 95.4% |
| Models | 1,465 TFM / 533 WSO / 179 JEM | 1,855 TFM / 566 WSO / 184 JEM |

`signed_date` coverage is unchanged at 100%. Docs only, no code changes.

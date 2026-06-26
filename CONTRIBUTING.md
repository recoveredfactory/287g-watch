# Contributing

287(g) Explorer is a public-interest journalism tool, and we welcome help —
**send us a pull request!**

## Ways to contribute

- **Found a bug or a data error?** [Open an issue](https://github.com/recoveredfactory/287g-explorer/issues).
  For data corrections, a link to the source (an agency page, an MOA, a news
  report) helps us verify and fix it fast.
- **Want to fix something?** Fork, branch, and open a PR against `main`. Small,
  focused PRs are easiest to review.

## Getting set up

See the [README](README.md) for the quick start — `pnpm install`, `pnpm pipeline`,
`pnpm dev:web`. You don't need an AWS account to run the site locally.

## A couple of house rules

- **The app is bilingual (English/Spanish).** Every user-facing string goes
  through the translation layer — no hardcoded copy, aria-labels, or units.
- **Slugs are permanent.** `/agency/[slug]` URLs may be linked externally, so
  changing slug generation is a breaking change (see [ARCHITECTURE.md](ARCHITECTURE.md)).

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).

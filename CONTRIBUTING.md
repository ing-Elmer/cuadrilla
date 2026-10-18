# Contributing

Issues and PRs are welcome.

- Run `node scripts/check.mjs` and `node --test plugins/cuadrilla/hooks/tests/hooks.test.mjs` before opening a PR.
- New stack packs: follow [docs/PACK-SPEC.md](docs/PACK-SPEC.md).
- Changes to the `guard` hook need tests in `hooks.test.mjs`.
- Keep prompts in English; user-facing language is set by the `response_language` option.

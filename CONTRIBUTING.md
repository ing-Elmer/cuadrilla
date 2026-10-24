# Contributing

Issues and PRs are welcome.

- Run `node scripts/check.mjs` before opening a PR. It runs the hook tests and the eval runner
  tests, and validates every eval case.
- New stack packs: follow [docs/PACK-SPEC.md](docs/PACK-SPEC.md).
- Changes to the `guard` hook need tests in `hooks.test.mjs`.
- Changes to agents, commands, standard skills or hooks that can change how the team works:
  measure them with the [evals](evals/README.md) against `main`
  (`node evals/run.mjs --base main --runs 3 --yes`) and paste the summary in the PR. They cost
  real money, so CI doesn't run them; the free `--dry-run` runs on every push.
- New behaviour worth protecting deserves an eval case, with a reference solution.
- Curator PRs (`curator/*` branches) are proposals: review the evidence, the explanation and the
  eval summary like any other PR, then merge or close. Commit `curator/history.json` after a run.
- Keep prompts in English; user-facing language is set by the `response_language` option.

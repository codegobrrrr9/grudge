---
name: grudge
description: Turns what keeps being corrected into agent rules with evidence. Mines pull-request review comments, Claude Code session transcripts (repeated corrections, commands that keep failing), fix-up commits ("fix lint", "address review") and CI red streaks on the default branch, clusters what recurs, and proposes one rule per finding for AGENTS.md or CLAUDE.md, each tied to the PRs or sessions behind it; also finds stale paths and duplicated rules in the instruction files you already have. Use when the user asks for a retro, asks why they keep repeating themselves, wants AGENTS.md or CLAUDE.md improved from real history, when a correction comes up for the second time, or says /retro.
license: MIT
metadata:
  author: codegobrrrr9
  version: "0.1.0"
  homepage: https://github.com/codegobrrrr9/grudge
---

# grudge

Reviewers say "use describe, avoid await t.test" in four pull requests. You tell the agent "least
amount of usage" in three sessions. `python` fails in every session because it is not installed.
None of that is in AGENTS.md, so it keeps happening. grudge reads the history and hands you the
rules, each with the evidence that earned it.

## Rules

1. **Run it, do not guess.** `node <path-to-this-skill>/scripts/grudge.js --json` from the project
   root. It reads PR review comments (needs a GitHub remote; `GITHUB_TOKEN` optional), Claude Code
   transcripts for this project, `git log`, GitHub Actions runs, and the existing instruction files.
   `--days 90` narrows the window; `--source sessions,git` limits the sources.
2. **One finding, one rule.** For each entry in `findings`, write a single imperative line in the
   project's voice. Then the evidence, in parentheses: how many times, where. `Reviewers said it 4
   times in 4 PRs (#6486, #6577, #6810)` or `you said it in 3 sessions (b332d40c, e20cfdfa, 0fa0f0ac)`.
   The `quote` field is the representative comment; rewrite it, never paste it as a rule.
3. **Evidence or nothing.** A finding needs `count` ≥ 3 across ≥ 2 PRs or sessions before it is a
   rule. When `findings` is empty, say "nothing repeated often enough to become a rule". Do not pad
   the list with things you believe but the history does not show.
4. **Propose, then write.** Show the rules grouped by source, most frequent first, and ask which to
   keep. Only after a yes, add them to AGENTS.md (or CLAUDE.md, whichever the project uses), outside
   any `<!-- grudge:start -->` block, and apply the `stale` and `duplicate` fixes in the same edit.
5. **Failing commands become environment rules.** A `failure` finding (`python -m` failed 3 times
   in 2 sessions: not recognized) becomes "Do not run `python`; it is not installed here, use X",
   where X is what eventually worked in those sessions, if the transcript shows it.
6. **CI red streaks become process rules.** `test: red for 31h across 11 pushes` becomes "After
   pushing to main, check the test workflow result before the next push".
7. **Second time is the trigger.** If the user corrects you and you recall the same correction from
   earlier in the session or from memory, say so and offer a retro, instead of only fixing the
   instance.

## Commands

```
grudge.js             report: what keeps coming back, grouped by source, with evidence
grudge.js --json      the same as data: findings[] with kind, count, quote, evidence[]
grudge.js --draft     a markdown section of candidate rules (quotes, not rewritten)
grudge.js --apply     write that section into AGENTS.md between grudge markers (replaces on rerun)
--days 180  --min 3  --source reviews,sessions,git,ci,rules  --repo owner/name  --max 2000
--include-bots  --include-replies  --no-cache  --project <dir>  --root <dir>
```

Sources, the signal each one carries, and the thresholds are in
[`references/sources.md`](references/sources.md).

## Report shape

```
Retro for acme/widgets, last 180 days: 412 review comments in 96 PRs, 23 sessions, 310 commits, 88 CI runs.

Reviews
- Use `describe` and never `await t.test`; setTimeout in tests is flaky. (4 PRs: #6486, #6577, #6810, #6925)
- Every bug fix PR shows the failing test output before the fix. (6 PRs, one reviewer)
Sessions
- Benchmarks run on Sonnet, one run per condition. (you said it in 3 sessions)
- `python` is not installed on this machine; use Node for scripts. (failed 5 times in 3 sessions)
Git
- Run the linter before committing. (14 of 310 commits only fix lint)
CI
- Check the test workflow after pushing to main. (red for 31h across 11 pushes in September)
Rules file
- AGENTS.md points at `scripts/deploy.sh` and `npm run typecheck`, neither exists.

Keep which?
```

<div align="center">

# 😾 grudge

**Reviewers said it in four PRs. You said it in three sessions. It is still not in AGENTS.md.**

A retro for coding agents. grudge reads pull-request review comments, your Claude Code sessions, your
commit history and your CI runs, finds what keeps being corrected, and proposes the rules with the
evidence behind each one. One zero-dependency file and an agent skill.

[![test](https://github.com/codegobrrrr9/grudge/actions/workflows/test.yml/badge.svg)](https://github.com/codegobrrrr9/grudge/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)

</div>

## For your coding agent

Paste this into Claude Code, Codex, Cursor or Gemini CLI:

```
Install the grudge skill from https://github.com/codegobrrrr9/grudge, refer to the repo's AGENTS.md.
```

Then say **retro**. The agent runs grudge, rewrites each finding as one rule, shows the evidence, and
asks which to keep before writing anything into AGENTS.md or CLAUDE.md. Claude Code also gets `/retro`.

No install at all:

```bash
npx --yes --allow-git=all github:codegobrrrr9/grudge
```

## What it finds

A real run on [fastify](https://github.com/fastify/fastify), a year of review comments, no configuration:

```
grudge  fastify/fastify  ·  last 365 days  ·  reviews 266 comments / 125 PRs

REVIEWS  2 things reviewers keep saying  (266 human top-level comments; 123 bot, 316 replies ignored)
  1. ×6 in 6 PRs, 2 reviewers  advice  [add test planning]
       "can you add tests per route?"
       #6926 2026-09-02 metcoder95  can you add tests per route?
       #6526 2026-07-26 Eomm        We need to add few more tests: ...
       #6483 2026-03-27 metcoder95  Can you add test with `null`
```

The agent turns that into `Every change ships with its tests (reviewers asked 6 times in 6 PRs: #6483,
#6526, #6926, …)`. On [vitest](https://github.com/vitest-dev/vitest) the same run finds the convention
that every bug-fix PR shows the failure without the fix (7 PRs), a maintainer telling PR authors to
"ask your agent to read AGENTS.md" (3 PRs) and "Your AI is a bit too verbose" (3 PRs).

And on a real Claude Code project folder, 48 sessions:

```
SESSIONS  17 things you keep telling the agent  (19 corrections in 437 messages)
  1. ×2 in 2 sessions  correction
       "your way of finding viral does not work … only show lanes that show high engagement"
  2. ×6 in 5 sessions  (same request again)
       "i have signed in, continue"
  6. ×5 in 2 sessions  (same request again)
       "repo created, proceed to push"
 18. `ffmpeg` failed 4 times in 2 sessions
```

Finding 1 became a hand-written rule a week after the second time it was said. grudge would have
proposed it that day.

## Why

Every team has rules that live only in review comments and chat. Humans learn them after the second
time; agents start every session from the instruction file. Teams are now writing CODING_STANDARDS.md
from their PR comments, running retros on a week of sessions, and auditing CLAUDE.md for dead paths,
by hand. grudge is that loop, with the counting done for you and the evidence attached.

## Sources

| Source | Where | What becomes a finding |
|---|---|---|
| **reviews** | GitHub PR review comments (`GITHUB_TOKEN` optional, cached locally) | the same comment theme in 3+ comments across 2+ PRs; bots, AI-review bodies and replies dropped |
| **sessions** | `~/.claude/projects/<this project>/*.jsonl`, read locally | corrections and requests you keep repeating across sessions; a program that keeps failing |
| **git** | `git log` | runs of fix-up commits: fix lint, fix types, fix tests, address review, revert |
| **ci** | GitHub Actions on the default branch | red streaks: hours red, pushes while red, still red |
| **rules** | AGENTS.md, CLAUDE.md, .cursor/rules, copilot-instructions | `npm run x` and paths that no longer exist; the same rule in two files |

```bash
grudge                 # report, grouped by source, evidence under each finding
grudge --json          # findings[] for the agent to write rules from
grudge --draft         # candidate rules as markdown, quotes with evidence
grudge --apply         # write that section into AGENTS.md between markers (rerun replaces it)
grudge --days 90 --source sessions,git --min 3
```

How each source is read, filtered and thresholded is in
[`references/sources.md`](skills/grudge/references/sources.md).

## Does it work

**Reviews, on a year of real history.** Human top-level comments only; bots, AI-review bodies and
replies dropped first.

| Repo | Comments | Of which bot or AI | Human, top-level | PRs | Themes found | Worth a rule, judged by hand |
|---|---|---|---|---|---|---|
| vitest-dev/vitest | 2,572 | 184 | 1,093 | 404 | 8 | 4 (failure-without-fix proof, test must fail without the fix, read AGENTS.md, too verbose) |
| fastify/fastify | 830 | 123 | 266 | 125 | 2 | 1 (every change adds tests) |

**Do the themes hold up over time?** Mine the first 70% of the year, then look at the last 30%:

| Repo | Themes mined from the first 70% | Still recurring in the last 30% | Later comments that land in a theme | Same, with dates shuffled |
|---|---|---|---|---|
| vitest | 4 | 3 of 4 | 2.7% | 5.2% |
| fastify | 1 | 1 of 1 | 4.8% | 3.6% |

Read that honestly: most review comments are one-offs about the code in front of the reviewer, and
no theme will ever cover them. The themes that do exist keep coming back, which is the point. grudge
is for the handful of rules nobody wrote down, not for summarising review.

**Known miss.** fastify's maintainer wrote "please use describe and avoid `await t.test`" in three
PRs. grudge links two of the three (the third is a long comment that shares one word pair) and stays
silent below three. Lower `--min` and it appears, with more noise beside it.

**Sessions.** The run above is a real project folder on the author's machine: 48 sessions, 437
human messages, 19 phrased as corrections, 17 things repeated across sessions, one failing program.
Read [`benchmarks/results.md`](benchmarks/results.md) for the full rows, and
`node benchmarks/holdout.js owner/repo` to add your own.

12 unit tests build temp git repos, fake transcripts and a fake GitHub API for every source, the
clustering, the correction and command detectors, and `--apply` idempotence.

## Honest limits

- It counts; it does not understand. A theme is comments that share rare word pairs. The agent (or
  you) writes the rule from the quotes. Expect a few coherent-but-not-a-rule themes per repo.
- Three is the floor. A convention said twice is invisible to it, by design. `--min 2` if you want to
  see more and sort the noise yourself.
- Reviews need a GitHub remote and the API; CI needs GitHub Actions. Other hosts are skipped with a
  reason. Unauthenticated GitHub allows 60 requests an hour (100 comments each); set `GITHUB_TOKEN`.
- Sessions are Claude Code transcripts only, read from this machine. Nothing is uploaded.
- The rules audit flags a path like `scripts/foo.js` that AGENTS.md tells *another* project to
  create. In a tool repo that is a false alarm; in an app repo it is a dead link.

## Install by agent

| Agent | How |
|---|---|
| **Claude Code** | `/plugin marketplace add codegobrrrr9/grudge` then `/plugin install grudge@grudge`. Adds `/retro`. |
| **Codex** | Copy `skills/grudge/` to `~/.codex/skills/grudge/` and append the Rules from [`AGENTS.md`](AGENTS.md). |
| **Cursor** | Copy [`.cursor/rules/grudge.mdc`](.cursor/rules/grudge.mdc) and `grudge.js` into the project. |
| **Gemini CLI** | `gemini extensions install https://github.com/codegobrrrr9/grudge` |
| **GitHub Copilot** | Copy [`.github/copilot-instructions.md`](.github/copilot-instructions.md). |
| **Anything else** | The Rules from [`AGENTS.md`](AGENTS.md) plus `grudge.js` in the project. |

## Credits

The loop is older than agents: retros, "address review comments", and every CONTRIBUTING.md that
grew out of the same comment being left ten times. Claude Code's `/doctor prompt-audit` checks an
instruction file for dead paths; grudge checks the history for the rules the file is missing. Same
family as [seatbelt](https://github.com/codegobrrrr9/seatbelt),
[cheapskate](https://github.com/codegobrrrr9/cheapskate), [alibi](https://github.com/codegobrrrr9/alibi)
and [shortlist](https://github.com/codegobrrrr9/shortlist).

## License

MIT. Star ⭐ if it found a rule you had been typing by hand.

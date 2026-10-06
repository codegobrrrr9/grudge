# Where grudge looks, and what counts

Everything is a count over a window (`--days`, default 180). Nothing becomes a finding on one
occurrence. The thresholds are deliberate: a rule that is not backed by repetition is an opinion.

## reviews — pull-request review comments

- Source: `GET /repos/{owner}/{repo}/pulls/comments`, newest first, cached under `.grudge/cache/`
  (gitignored). Incremental: a rerun only fetches comments newer than the cache. Unauthenticated
  GitHub allows 60 requests an hour (100 comments each); `GITHUB_TOKEN` or `GH_TOKEN` allows 5000.
- Dropped by default: bot accounts (`type: Bot`, logins ending in `[bot]`), comments whose body is
  an AI review (starts with `<!--`, `[AI:`, `### Bug:` and similar), and replies
  (`in_reply_to_id`), because replies are discussion, not corrections. `--include-bots`,
  `--include-replies` keep them.
- Clustering: a comment is reduced to its rare words (present in at most 3% of the corpus, floor
  3). Comments are walked by date; each joins the cluster whose core (words shared by at least half
  its members) it matches on 2+ words covering 40% of the smaller side, or starts a new one. A core
  cannot drift the way transitive linking does, so one blob of unrelated comments cannot form.
- Finding: `--min` comments (default 3) across at least 2 pull requests. Reported with the number
  of distinct reviewers, the representative comment, the directories involved and up to six
  evidence rows (PR, reviewer, date, quote, link).

## sessions — Claude Code transcripts

- Source: `~/.claude/projects/<project-slug>/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`). Only
  the sessions for this project directory (`--project` to point elsewhere), modified inside the
  window. Nothing is uploaded; the files are read locally.
- Human messages only: tool results, system reminders, slash commands and `[Request interrupted]`
  are skipped.
- A **correction** is a message that pushes back or restates: starts with no / wrong / stop /
  don't / I said / you forgot / again / always / never / instead, or (if under 60 words) contains
  "fix this", "didn't work", "instead of", "same error again" and similar. Corrections cluster
  loosely (2 shared rare words). Any other short message (3 to 60 words) clusters only on a tight
  match (3 shared rare words, half the smaller side) and is reported as "same request again".
- A **failure** is a Bash tool call whose result was an error. The command is reduced to the
  program it was about: `cd x && npm run build` is `npm run build`; `ls`, `cat`, `grep`, `sed`,
  `for` loops, `VAR=x` prefixes and inline `node -e` scripts never count. Finding: the same
  program failing `--min` times across 2+ sessions, with the error text as evidence.

## git — fix-up commits

- Source: `git log --since=<days> --no-merges`, subjects only.
- Categories: lint/format, types, tests, ci/build, review feedback, typos/oops/revert. A commit
  counts when its subject is about fixing that thing ("fix lint", "address review comments",
  "fix failing tests"), not when it merely contains the word.
- Finding: `--min` commits in a category. The share of all commits is reported too.

## ci — GitHub Actions on the default branch

- Source: `GET /repos/{owner}/{repo}/actions/runs?branch=<default>&event=push`, up to 300 runs,
  cached for 6 hours. Default branch from `origin/HEAD`, then main, then master.
- Per workflow, runs are ordered by time; a **red streak** is 2+ consecutive failures. Reported as
  hours from the first failure to the next success (or "still red") and the number of pushes
  that happened while red. Cancelled and skipped runs are ignored.

## rules — the instruction files you already have

- Files: AGENTS.md, CLAUDE.md, .claude/CLAUDE.md, GEMINI.md, .cursorrules, .windsurfrules,
  .github/copilot-instructions.md, .cursor/rules/*.mdc.
- **Stale**: a backticked `npm run <x>` / `pnpm <x>` / `make <x>` whose script or target does not
  exist, or a backticked path that does not exist in the repo. Globs, placeholders and URLs are
  skipped.
- **Duplicate**: the same line (30+ characters, normalised) in two or more files. Rules that live in
  two places drift.

## What grudge does not do

- It does not phrase the rule for you. The representative comment is a quote; the agent (or you)
  writes the rule. `--draft` and `--apply` produce a section of quotes with evidence, marked so a
  rerun replaces it.
- It does not read other people's sessions, only the transcripts on this machine for this project.
- It cannot see review comments on a repo with no GitHub remote, or CI that is not GitHub Actions.
  Those sources are skipped with a reason in the report.

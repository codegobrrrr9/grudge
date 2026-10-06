# grudge benchmark results

Two questions: does grudge find real conventions in review history, and do the themes it finds hold
up over time? Plus one real sessions run. Raw rows: `holdout.jsonl` (appended by `holdout.js`).

Run on 2026-10-06, grudge 0.1.0, defaults (`--min 3`, word-pair matching, rare words at 10% of the
corpus). Review comments fetched with the GitHub API over the previous 365 days.

## Reviews: what it found, judged by hand

Every theme grudge reported on the full year, with a verdict: **rule** (a convention a maintainer
would put in CONTRIBUTING or AGENTS.md), **topic** (coherent, about one area of the code, not a
rule), **noise** (shares words, not meaning).

### vitest-dev/vitest · 2,572 comments, 1,093 human top-level, 404 PRs · 8 themes

| # | Count | PRs | Reviewers | Theme (representative quote) | Verdict |
|---|---|---|---|---|---|
| 1 | 7 | 7 | 2 | "Failure without the fix:" + screenshot, on bug-fix PRs | **rule**: show the failing test output before the fix |
| 2 | 5 | 5 | 3 | "Why would either of the tests here fail without the fix?" | **rule**: a new test must fail without the fix |
| 3 | 5 | 3 | 1 | "ask your agent to read AGENTS.md and react to this comment accordingly" | **rule**: PR authors using agents must point them at AGENTS.md |
| 4 | 4 | 4 | 4 | "This should not be needed. These tests don't run parallel." / "worth mentioning" | topic |
| 5 | 3 | 3 | 2 | istanbul coverage provider, "these will be fixed in #9204" | topic |
| 6 | 3 | 3 | 2 | scoped fixtures can only use fixtures with a higher scope | topic (a real design rule, but of one feature) |
| 7 | 3 | 3 | 3 | "Your AI is a bit too verbose" / "This section might be a bit too verbose" | **rule**: keep docs and comments short |
| 8 | 3 | 2 | 1 | explicit `{ concurrent: false }` not overriding the global | topic |

4 rules, 4 topics, 0 noise.

### fastify/fastify · 830 comments, 266 human top-level, 125 PRs · 2 themes

| # | Count | PRs | Reviewers | Theme | Verdict |
|---|---|---|---|---|---|
| 1 | 6 | 6 | 2 | "can you add tests per route?" / "Can you add test with `null`" / "We need to add few more tests" | **rule**: every change adds tests |
| 2 | 3 | 2 | 2 | schema validation being bypassed | topic |

1 rule, 1 topic. **Known miss:** mcollina's "please use describe and avoid `await t.test`" (#6486,
#6577) plus a contributor's long comment on the same thing (#6083). grudge links the two short ones;
the long one shares only one word pair, so the cluster has 2 members and stays under `--min 3`.

123 of fastify's 389 top-level comments were bots or AI-review bodies (`paragon-review`, Copilot,
`[AI: …]` prefixes), dropped before counting. On TanStack/query and zod the newest 100 review
comments were 88% and 89% bot, which is why bots are off by default.

## Reviews: do themes persist? (holdout)

`node benchmarks/holdout.js <repo> --days 365`: sort human top-level comments by date, mine themes
from the first 70%, then check the last 30%. "Lands in a theme" means a later comment shares 2+ of a
theme's label words, or 3+ words with its members. The shuffled control runs the same split with
dates scrambled.

| Repo | Train | Test | Themes mined | Still recurring in test | Test comments landing in a theme | Shuffled control |
|---|---|---|---|---|---|---|
| vitest-dev/vitest | 765 | 328 | 4 | 3 of 4 (failure-without-fix 3, scoped fixtures 3, concurrent 2) | 9 (2.7%) | 5.2% |
| fastify/fastify | 191 | 83 | 1 | 1 of 1 (add tests, 4 later) | 4 (4.8%) | 3.6% |

Reading: review comments are overwhelmingly one-offs about the code at hand; no small set of themes
will cover them, and the shuffled control shows date order is not what produces the few that match.
The conventions grudge does find keep recurring after the cutoff. That is the claim: a handful of real
rules per repo per year, not a summary of review.

## Sessions: a real project folder

`grudge --source sessions --days 60` on the author's `cowork` folder: 48 Claude Code sessions, 437
human messages, 19 phrased as corrections, 17 findings. Selected:

| Count | Sessions | Kind | Quote |
|---|---|---|---|
| 2 | 2 | correction | "your way of finding viral does not work, finding new open lanes lead to dead post, only show lanes that show high engagement only" |
| 6 | 5 | same request again | "i have signed in, continue" |
| 6 | 3 | same request again | "launch surge on the local host" |
| 5 | 2 | same request again | "repo created, proceed to push" |
| 4 | 2 | failure | `ffmpeg` failed 4 times in 2 sessions |

The first row became a written memory rule by hand on 2026-09-26, the day of its second occurrence.
Earlier passes of the detector also showed the noise that was cut: `cat`, `mkdir`, `sed` and `for`
counted as "failing programs" until shell plumbing, `VAR=` prefixes and inline `node -e` scripts were
excluded; and one 67-message blob formed until clustering moved from transitive linking to a
core-based pass.

## Rules audit on the author's own tool repos

`grudge --source rules` on seatbelt, cheapskate, alibi and shortlist flagged `scripts/<tool>.js` as a
stale path in each AGENTS.md (true: those files are instructions for another project, not this one)
and 4 to 12 rules duplicated between the Cursor and Copilot adapters (true, by design). Both are
listed under honest limits in the README.

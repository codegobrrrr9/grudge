---
description: Retro. What keeps being corrected in this repo (PR reviews, your sessions, fix-up commits, CI red streaks), proposed as AGENTS.md rules with the evidence behind each one.
allowed-tools: Bash(node:*), Read, Edit, Write
---

1. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/grudge/scripts/grudge.js --json $ARGUMENTS` from the project root (if that path does not exist, find `grudge.js` under the installed grudge skill). Add `--days 90` for a shorter window, `--source sessions` for sessions only.
2. Read `findings`. For each one, write a single imperative rule in the project's voice, then the evidence in parentheses: counts, and the PR numbers or session ids from `evidence[].ref`.
3. Show the proposed rules grouped by source (reviews, sessions, git, ci, rules), most frequent first, and say how many comments, sessions and commits were read. Show the `stale` and `duplicate` findings as fixes to existing rules.
4. Ask which to keep. On yes, add the kept rules to AGENTS.md (or CLAUDE.md if that is the file the project uses) outside any grudge-marked section, and apply the stale/duplicate fixes. Do not write before the user answers.
5. If `findings` is empty, say "nothing repeated often enough to become a rule" and list `sources.sessions.loose` as recent one-off corrections, if any.

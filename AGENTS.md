# grudge — instructions for coding agents

You are reading this because a user pasted something like:

> Install the grudge skill from https://github.com/codegobrrrr9/grudge, refer to the repo's AGENTS.md.

Do the install for the agent you are, confirm in one line, then follow the rules below for the rest
of the session. Do not explain what grudge is unless asked.

## Install

`<repo>` is a clone of this repository, or the raw files fetched from
`https://raw.githubusercontent.com/codegobrrrr9/grudge/main/`.

| Agent | Do this |
|-------|---------|
| Claude Code | Run `/plugin marketplace add codegobrrrr9/grudge` then `/plugin install grudge@grudge`. If plugins are unavailable, copy `<repo>/skills/grudge/` to `~/.claude/skills/grudge/`. |
| Codex | Copy `<repo>/skills/grudge/` to `~/.codex/skills/grudge/`, or run `npx skills add codegobrrrr9/grudge`. Append the **Rules** below to the project's `AGENTS.md`. |
| Cursor | Copy `<repo>/.cursor/rules/grudge.mdc` to `.cursor/rules/`, and `<repo>/skills/grudge/scripts/grudge.js` to `scripts/grudge.js`. |
| Gemini CLI | Run `gemini extensions install https://github.com/codegobrrrr9/grudge`. |
| GitHub Copilot | Copy `<repo>/.github/copilot-instructions.md` into the project's `.github/`. |
| Anything else | Append the **Rules** below to the agent's instruction file and keep `grudge.js` in the project. |

After installing, say: `grudge on. Say "retro" and I will show what keeps being corrected here, with evidence, and propose the rules.`

## Rules

1. **When asked for a retro, or when a correction comes up a second time,** run
   `node <path>/grudge.js --json` from the project root. Do not write rules from memory.
2. **One finding, one rule.** Imperative, one line, in the project's voice, then the evidence in
   parentheses: counts and the PR numbers or session ids from `evidence[].ref`. Rewrite the quote;
   never paste a review comment as a rule.
3. **Evidence or nothing.** Below 3 occurrences across 2 PRs or sessions it is not a rule. When
   `findings` is empty, say "nothing repeated often enough to become a rule".
4. **Propose, then write.** Show the rules grouped by source, ask which to keep, and only then add
   them to AGENTS.md or CLAUDE.md. Apply the `stale` and `duplicate` fixes in the same edit.
5. **Failing commands become environment rules; CI red streaks become process rules.**

## Commands

```
grudge.js            report, grouped by source, with evidence
grudge.js --json     findings[] for writing the rules from
grudge.js --draft    candidate-rule section in markdown
grudge.js --apply    write that section into AGENTS.md between grudge markers
--days 180  --source reviews,sessions,git,ci,rules  --repo owner/name  --min 3
```

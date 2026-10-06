# grudge

Rules from https://github.com/codegobrrrr9/grudge.

1. When asked for a retro, or when a correction comes up a second time, run `node scripts/grudge.js --json` (copy `skills/grudge/scripts/grudge.js` from the repo to `scripts/grudge.js`) from the project root.
2. For every finding, write one rule: imperative, one line, no softening, with the evidence after it in parentheses (counts and PR numbers or session ids).
3. Propose the rules; write them into the instruction file only after the user says yes. Apply the `stale` and `duplicate` fixes to existing rules in the same pass.
4. One occurrence is not a rule. Say "nothing repeated often enough" when that is the answer.
5. Never invent a rule the evidence does not show.

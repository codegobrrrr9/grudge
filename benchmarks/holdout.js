#!/usr/bin/env node
// Holdout benchmark: do the themes grudge mines from past review comments predict the next ones?
//
//   node benchmarks/holdout.js <owner/repo> [--days 365] [--split 0.7] [--min 3]
//
// Fetches (or reuses the cache of) a year of pull-request review comments, splits them by date, mines
// clusters from the first part, then checks what share of the LATER comments fall into a cluster that
// already existed. A theme that keeps recurring is exactly the thing worth writing down once.
// Also reports a shuffled control: the same split with dates scrambled, to show the ordering matters.
// Appends a JSON row per repo to benchmarks/holdout.jsonl.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchReviewComments, cluster, tokens } from '../skills/grudge/scripts/grudge.js';

const here = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const repo = a.find(x => !x.startsWith('--') && a[a.indexOf(x) - 1]?.startsWith('--') !== true);
const flag = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const days = Number(flag('--days', 365)), split = Number(flag('--split', 0.7)), min = Number(flag('--min', 3));
const work = join(here, 'work', repo.split('/')[1]); mkdirSync(work, { recursive: true });

const all = await fetchReviewComments(work, repo, { since: new Date(Date.now() - days * 86400e3).toISOString(), max: 6000 });
const human = all.filter(c => !c.bot && !c.reply && tokens(c.body).length >= 2).sort((x, y) => x.created_at.localeCompare(y.created_at));
const items = human.map(c => ({ text: c.body, key: c.pr, author: c.user, date: c.created_at }));

function evaluate(items, label) {
  const cut = Math.floor(items.length * split);
  const train = items.slice(0, cut), test = items.slice(cut);
  const clusters = cluster(train, { minItems: min, minKeys: 2 });
  // a later comment "lands" in a cluster when it shares 2+ of that cluster's label words, or 2+ rare words with any member
  const vocab = clusters.map(c => new Set(c.members.flatMap(m => tokens(m.text))));
  const labels = clusters.map(c => new Set(c.label));
  let hit = 0; const perCluster = clusters.map(() => 0);
  for (const t of test) {
    const ts = new Set(tokens(t.text));
    let best = -1, bestScore = 0;
    clusters.forEach((c, i) => {
      const l = [...labels[i]].filter(w => ts.has(w)).length;
      const v = [...ts].filter(w => vocab[i].has(w)).length;
      const score = l >= 2 ? 2 + l : (v >= 3 && v >= 0.5 * ts.size ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) { hit++; perCluster[best]++; }
  }
  return { label, train: train.length, test: test.length, clusters: clusters.length, covered: hit, coveredPct: test.length ? Math.round(1000 * hit / test.length) / 10 : 0,
    top: clusters.slice(0, 8).map((c, i) => ({ label: c.label.join(' '), n: c.count, prs: c.keys.length, later: perCluster[i], quote: c.representative.text.replace(/\s+/g, ' ').slice(0, 100) })) };
}
const real = evaluate(items, 'by date');
const shuffled = items.slice(); for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const control = evaluate(shuffled.map(x => ({ ...x })), 'shuffled');
// coverage if clusters were random: expected hits from the same scorer against clusters mined from unrelated text would be ~0; the shuffled control
// instead checks that time order is not doing the work (themes that only exist in one burst would score high on shuffle, low by date).
const row = { repo, at: new Date().toISOString(), days, split, comments: all.length, human: human.length, bots: all.filter(c => c.bot).length, replies: all.filter(c => c.reply).length, real, control };
appendFileSync(join(here, 'holdout.jsonl'), JSON.stringify(row) + '\n');
console.log(`${repo}: ${all.length} comments over ${days}d, ${human.length} human top-level (${row.bots} bot, ${row.replies} replies dropped)`);
console.log(`train ${real.train} → ${real.clusters} themes; of the ${real.test} later comments, ${real.covered} (${real.coveredPct}%) land in a theme mined earlier; shuffled control ${control.coveredPct}%`);
for (const t of real.top) console.log(`  ${String(t.n).padStart(3)}× in ${String(t.prs).padStart(2)} PRs, ${String(t.later).padStart(3)} later  [${t.label}]  "${t.quote}"`);

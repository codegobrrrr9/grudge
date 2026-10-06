import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tokens, cluster, isCorrection, commandHead, analyzeSessions, analyzeReviews, analyzeGit, analyzeRuns, analyzeRules, projectSlug, findTranscripts, draft, apply, run, format } from '../skills/grudge/scripts/grudge.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'grudge-'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function gitRepo(dir) {
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't'); git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}
const commit = (dir, msg, i = 0) => { writeFileSync(join(dir, `f${i}.txt`), String(Math.random())); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

// ---------- text ----------
test('tokens: drops stopwords, code fences, urls, html, paths; light stemming', () => {
  const t = tokens('Please use `describe` instead of the awaited tests, see https://x.y/z ```js\nignored()\n``` <img src="a.png"> in src/foo/bar.ts; tests are flaky');
  assert.ok(t.includes('describe') && t.includes('awaited') && t.includes('flaky'));
  assert.ok(!t.includes('ignored') && !t.includes('img') && !t.some(w => w.includes('/')) && !t.includes('the'));
  assert.deepEqual(tokens('tests test testing'), ['test', 'test', 'testing']);
  assert.ok(tokens('opus status').includes('opus'));
});

test('cluster: groups comments that share rare words, needs 2 keys, does not chain unrelated items', () => {
  const mk = (text, key, date) => ({ text, key, author: 'r', date });
  const items = [
    mk('please use describe and avoid await t.test', 1, '2026-01-01'), mk('can you avoid await t.test and use describe here', 2, '2026-01-02'), mk('use describe, avoid await on t.test', 3, '2026-01-03'),
    mk('this needs a changelog entry', 4, '2026-01-04'), mk('add a changelog entry for this', 5, '2026-01-05'), mk('changelog entry missing', 6, '2026-01-06'),
    mk('the schema cache is racy under concurrent requests', 7, '2026-01-07'), mk('rename variable', 8, '2026-01-08'), mk('typo in docs', 9, '2026-01-09'),
    mk('what about the other branch', 1, '2026-01-10'), mk('lgtm', 2, '2026-01-11'), mk('bump version', 3, '2026-01-12'),
  ];
  const cs = cluster(items, { minItems: 3, minKeys: 2 });
  assert.equal(cs.length, 2);
  assert.ok(cs.some(c => c.label.includes('describe') && c.count === 3 && c.keys.length === 3));
  assert.ok(cs.some(c => c.label.includes('changelog') && c.count === 3));
});

test('cluster: same key twice does not count as recurring', () => {
  const items = [1, 2, 3].map(i => ({ text: 'add a changelog entry please', key: 'same', author: 'a', date: '2026-01-0' + i }));
  assert.equal(cluster(items, { minItems: 3, minKeys: 2 }).length, 0);
});

// ---------- sessions ----------
test('isCorrection: pushback phrasing is strong, weak needs a short message, plain requests are not', () => {
  assert.equal(isCorrection("no, I said use the least amount of usage"), 'strong');
  assert.equal(isCorrection("you forgot the license badge again"), 'strong');
  assert.equal(isCorrection("the player is holding the axe the wrong way, fix this"), 'weak');
  assert.equal(isCorrection("build me a dashboard for the sales data"), false);
  assert.equal(isCorrection('/compact'), false);
  assert.equal(isCorrection('this is fine but ' + 'word '.repeat(100) + ' you forgot it'), false);
});

test('commandHead: the program a command is about, not the shell plumbing around it', () => {
  assert.equal(commandHead('cd /x/y && npm run build'), 'npm run build');
  assert.equal(commandHead('cd "/a b" && ls | head -3'), null);
  assert.equal(commandHead('S="/tmp/x"; node -e "const a=1; const b=2;"'), null);
  assert.equal(commandHead('export PATH=$PATH:/x; ffmpeg -i a.mp4 b.mp4'), 'ffmpeg');
  assert.equal(commandHead('for n in a b; do printf "%s" $n; done'), null);
  assert.equal(commandHead('python -m pytest tests/'), 'python -m pytest');
  assert.equal(commandHead('cat > f.txt <<\'EOF\'\nnpm test\nEOF'), null);
  assert.equal(commandHead('sleep 100; curl -s x'), null);
});

function transcript(dir, id, turns) {
  // turns: [{user: text}] | [{bash: cmd, error: text}]
  const lines = [];
  let n = 0;
  for (const t of turns) {
    const ts = new Date(2026, 0, 1 + n++).toISOString();
    if (t.user !== undefined) lines.push({ type: 'user', timestamp: ts, message: { role: 'user', content: t.user } });
    if (t.bash) {
      const tid = 'toolu_' + n;
      lines.push({ type: 'assistant', timestamp: ts, message: { role: 'assistant', content: [{ type: 'tool_use', id: tid, name: 'Bash', input: { command: t.bash } }] } });
      lines.push({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, is_error: !!t.error, content: t.error || 'ok' }] } });
    }
  }
  writeFileSync(join(dir, id + '.jsonl'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

test('sessions: repeated corrections cluster across sessions, repeated failing tools are reported, plumbing is not', () => {
  const home = tmp(); const project = join(home, 'proj'); mkdirSync(project);
  process.env.CLAUDE_CONFIG_DIR = home;
  const dir = join(home, 'projects', projectSlug(project)); mkdirSync(dir, { recursive: true });
  transcript(dir, 'aaaa1111-s1', [
    { user: 'build the thing' }, { user: 'no, use the least amount of usage, sonnet one run' },
    { bash: 'cd /p && python -m pytest', error: "'python' is not recognized as an internal or external command" },
    { bash: 'ls nope', error: 'No such file or directory' },
    { user: '<system-reminder>ignored</system-reminder>' }, { user: '[Request interrupted by user]' },
  ]);
  transcript(dir, 'bbbb2222-s2', [
    { user: 'I said use the least amount of usage for the benchmark' },
    { bash: 'python -m pytest -q', error: "'python' is not recognized" },
    { bash: 'cd x && python -m pytest -x', error: 'python: command not found' },
  ]);
  transcript(dir, 'cccc3333-s3', [{ user: 'please always use the least amount of usage' }, { user: 'push it' }]);
  const files = findTranscripts(project);
  assert.equal(files.length, 3);
  const r = analyzeSessions(files, { min: 3 });
  assert.equal(r.sessions, 3);
  assert.equal(r.humanMessages, 5);
  const corr = r.findings.find(f => f.kind === 'correction');
  assert.ok(corr, 'correction cluster');
  assert.equal(corr.sessions, 3);
  assert.ok(corr.label.includes('usage'));
  const fail = r.findings.filter(f => f.kind === 'failure');
  assert.equal(fail.length, 1);
  assert.equal(fail[0].head, 'python -m pytest');
  assert.equal(fail[0].count, 3);
  assert.equal(fail[0].sessions, 2);
  assert.ok(fail[0].evidence[0].quote.includes('not recognized'));
  delete process.env.CLAUDE_CONFIG_DIR;
});

// ---------- reviews ----------
const rc = (pr, user, body, extra = {}) => ({ id: Math.random(), pr, path: 'src/a.ts', body, user, bot: /\[bot\]$/.test(user), reply: false, created_at: '2026-03-0' + ((pr % 9) + 1) + 'T00:00:00Z', url: 'u', ...extra });
test('reviews: themes need 3 comments across 2+ PRs; bots and replies are ignored by default', () => {
  const comments = [
    rc(1, 'alice', 'please use describe and avoid await t.test'), rc(2, 'bob', 'avoid await t.test, use describe'), rc(3, 'alice', 'use describe here instead of await t.test'),
    rc(4, 'copilot[bot]', 'use describe and avoid await t.test'), rc(5, 'alice', 'use describe and avoid await t.test', { reply: true }),
    rc(6, 'bob', 'rename this variable please'), rc(7, 'bob', 'typo in the docs here'),
  ];
  const r = analyzeReviews(comments);
  assert.equal(r.bots, 1); assert.equal(r.replies, 1); assert.equal(r.considered, 5);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].count, 3); assert.equal(r.findings[0].prs, 3); assert.equal(r.findings[0].reviewers, 2);
  const withBots = analyzeReviews(comments, { includeBots: true, includeReplies: true });
  assert.equal(withBots.findings[0].count, 5);
});

// ---------- git ----------
test('git: fix-up commit categories are counted, below the minimum they are not reported', () => {
  const d = gitRepo(tmp());
  ['feat: thing', 'fix lint', 'fix eslint errors', 'chore: fix formatting', 'fix: real bug', 'fix tests', 'address review comments', 'fix failing tests', 'tests fix'].forEach((m, i) => commit(d, m, i));
  const r = analyzeGit(d, { days: 30, min: 3 });
  assert.equal(r.commits, 9);
  const lint = r.findings.find(f => f.category === 'lint/format');
  assert.equal(lint.count, 3);
  assert.equal(r.findings.find(f => f.category === 'tests').count, 3);
  assert.ok(!r.findings.find(f => f.category === 'review feedback'));
});

// ---------- ci ----------
test('ci: a red streak on the default branch becomes a finding with hours and pushes; a single failure does not', () => {
  const run = (i, conclusion, name = 'test') => ({ id: i, name, sha: 'sha' + i, status: 'completed', conclusion, created_at: new Date(Date.UTC(2026, 0, 1, i * 6)).toISOString(), url: 'u' });
  const runs = [run(1, 'success'), run(2, 'failure'), run(3, 'failure'), run(4, 'failure'), run(5, 'success'), run(6, 'failure'), run(7, 'success'), run(8, 'failure', 'lint'), run(9, 'failure', 'lint')];
  const r = analyzeRuns(runs, { min: 2 });
  assert.equal(r.runs, 9); assert.equal(r.failed, 6);
  const t = r.findings.find(f => f.workflow === 'test');
  assert.equal(t.pushes, 3); assert.equal(t.hours, 18); assert.equal(t.open, false);
  const l = r.findings.find(f => f.workflow === 'lint');
  assert.equal(l.pushes, 2); assert.equal(l.open, true);
});

// ---------- rules ----------
test('rules: stale script and path references, duplicated lines across instruction files', () => {
  const d = tmp();
  writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'x', lint: 'y' } }));
  mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src', 'index.ts'), '');
  writeFileSync(join(d, 'AGENTS.md'), '# Rules\n- Run `npm run lint` and `npm run typecheck` before committing.\n- Entry point is `src/index.ts`, helpers in `src/utils/helpers.ts`.\n- Never commit secrets to the repository, use the env file instead.\n');
  writeFileSync(join(d, 'CLAUDE.md'), '- Never commit secrets to the repository, use the env file instead.\n- Keep PRs small.\n');
  const r = analyzeRules(d);
  assert.deepEqual(r.files, ['AGENTS.md', 'CLAUDE.md']);
  const stale = r.findings.find(f => f.kind === 'stale');
  assert.equal(stale.count, 2);
  assert.ok(stale.evidence.some(e => e.quote.includes('npm run typecheck')) && stale.evidence.some(e => e.quote.includes('src/utils/helpers.ts')));
  assert.ok(!stale.evidence.some(e => e.quote.includes('src/index.ts')));
  const dup = r.findings.find(f => f.kind === 'duplicate');
  assert.equal(dup.count, 1);
});

// ---------- draft / apply ----------
test('draft + apply: writes a marked section, replaces it on the next run, keeps the rest of the file', () => {
  const d = tmp();
  writeFileSync(join(d, 'AGENTS.md'), '# My rules\n- keep this\n');
  const r = { at: '2026-10-06T00:00:00Z', days: 90, findings: [
    { source: 'reviews', kind: 'review', count: 3, prs: 3, quote: 'use describe, avoid await t.test', evidence: [{ ref: '#1' }, { ref: '#2' }] },
    { source: 'sessions', kind: 'failure', count: 3, sessions: 2, head: 'python -m', evidence: [{ ref: 'abc', quote: 'python is not recognized' }] },
  ] };
  const section = draft(r);
  assert.ok(section.startsWith('<!-- grudge:start -->') && section.endsWith('<!-- grudge:end -->'));
  assert.ok(section.includes('Reviewers said 3 times in 3 PRs') && section.includes('evidence: #1, #2') && section.includes('Do not run `python -m`'));
  apply(d, 'AGENTS.md', section);
  apply(d, 'AGENTS.md', section.replaceAll('3 times', '4 times'));
  const text = readFileSync(join(d, 'AGENTS.md'), 'utf8');
  assert.ok(text.startsWith('# My rules\n- keep this\n'));
  assert.equal((text.match(/grudge:start/g) || []).length, 1);
  assert.ok(text.includes('4 times') && !text.includes('3 times'));
});

// ---------- end to end with a fake GitHub ----------
test('run: all sources against a fake GitHub API, skips cleanly without a remote', async () => {
  const d = gitRepo(tmp());
  commit(d, 'init'); commit(d, 'fix lint', 1); commit(d, 'fix lint again', 2); commit(d, 'lint fix', 3);
  git(d, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git');
  const comments = [1, 2, 3].map(pr => ({ id: pr, pull_request_url: 'https://api.github.com/repos/acme/widgets/pulls/' + pr, path: 'a', body: 'add a changelog entry for this change', user: { login: 'rev', type: 'User' }, created_at: new Date().toISOString(), html_url: 'u' }));
  const runs = { workflow_runs: [2, 3, 4].map(i => ({ id: i, name: 'test', head_sha: 'abc' + i, status: 'completed', conclusion: 'failure', created_at: new Date(Date.now() - i * 3600e3).toISOString(), html_url: 'u' })) };
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('/pulls/comments')) res.end(JSON.stringify(req.url.includes('page=1') ? comments : []));
    else if (req.url.includes('/actions/runs')) res.end(JSON.stringify(runs));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(r => server.listen(0, r));
  const api = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = await run({ root: d, api, days: 30, cache: false, source: 'reviews,git,ci,rules' });
    assert.equal(r.repo, 'acme/widgets');
    assert.equal(r.sources.reviews.findings[0].count, 3);
    assert.equal(r.sources.git.findings[0].category, 'lint/format');
    assert.equal(r.sources.ci.findings[0].pushes, 3);
    assert.ok(r.findings.length >= 3);
    const text = format(r);
    assert.ok(text.includes('REVIEWS') && text.includes('changelog') && text.includes('GIT') && text.includes('CI') && text.includes('RULES'));
    assert.ok(!existsSync(join(d, '.grudge')), 'no cache written with cache:false');
  } finally { server.close(); }
  const bare = gitRepo(tmp()); commit(bare, 'only');
  const r2 = await run({ root: bare, days: 30, source: 'reviews,ci,git,rules', cache: false });
  assert.ok(r2.skipped.some(s => s.startsWith('reviews: no GitHub remote')) && r2.skipped.some(s => s.startsWith('ci:')));
  assert.equal(r2.findings.length, 0);
  assert.ok(format(r2).includes('NOTHING REPEATED'));
});

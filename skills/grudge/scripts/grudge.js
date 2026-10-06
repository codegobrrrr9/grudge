#!/usr/bin/env node
// grudge: what you keep correcting, turned into agent rules with evidence.
//
// Mines four places where the same correction shows up again and again, and one place where rules go stale:
//   reviews   GitHub pull-request review comments (what reviewers keep saying)
//   sessions  Claude Code transcripts for this project (what you keep telling the agent, which commands keep failing)
//   git       commit history (fix-up commits: "fix lint", "fix tests", "address review", reverts)
//   ci        GitHub Actions on the default branch (red streaks nobody noticed)
//   rules     the instruction files you already have (paths and scripts that no longer exist, duplicated lines)
//
//   grudge                      report
//   grudge --json               everything, for an agent to write the rules from
//   grudge --draft              a markdown section with one candidate rule per finding, evidence attached
//   grudge --apply [--file AGENTS.md]   write that section into the instructions file between grudge markers
//   --days 180  --source reviews,sessions,git,ci,rules  --repo owner/name  --max 2000  --min 3
//   --include-bots  --include-replies  --no-cache  --project <dir>  --root <dir>
//
// Zero dependencies. Node 18+. GITHUB_TOKEN (or GH_TOKEN) raises the API limit from 60 to 5000 requests an hour.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ---------- helpers ----------
const git = (args, cwd) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return ''; } };
export function repoRoot(dir = process.cwd()) { return git(['rev-parse', '--show-toplevel'], dir) || resolve(dir); }
export function githubRepo(root, override) {
  if (override) return override;
  const url = git(['remote', 'get-url', 'origin'], root);
  const m = url.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
export function defaultBranch(root) {
  const ref = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], root);
  if (ref) return ref.replace('refs/remotes/origin/', '');
  for (const b of ['main', 'master']) if (git(['rev-parse', '--verify', '--quiet', b], root)) return b;
  return 'main';
}
const short = (s, n = 110) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /(s|sh|ch|x)$/.test(w) ? 'es' : 's'}`;
const daysAgo = (d) => new Date(Date.now() - d * 86400e3);
const uniq = (a) => [...new Set(a)];

// ---------- text → tokens ----------
const STOP = new Set(('a an the and or but if then else of to in on at for from by with without as is are was were be been being it its this that these those there here ' +
  'i you we they he she me my your our their them us his her him do does did done doing have has had having can could should would will shall may might must ' +
  'not no yes also just so than too very more most much many some any all each every both few other same such only own into over under again further once ' +
  'about above below between through during before after up down out off why how what which who whom when where because while until since though although ' +
  'get got gets make makes made let lets like want need think know see look use using used one two first last new old still well okay ok thanks thank please ' +
  'nit nitpick suggestion suggest maybe probably perhaps actually really sure fine good great nice lgtm wdyt imo imho btw fyi hmm yeah yep nope ' +
  'code line lines file files change changes changed pr commit function method value case thing things way version ' +
  'doesn isn don won wouldn shouldn couldn didn aren wasn weren hasn haven ain img src alt width height http https www com href div span').split(/\s+/));
export function tokens(text) {
  const t = String(text).toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')         // code blocks
    .replace(/<!--[\s\S]*?-->|<[^>\n]{1,200}>/g, ' ')   // html comments and tags
    .replace(/https?:\/\/\S+/g, ' ')          // urls
    .replace(/@"[^"]*"|[a-z]:\\[^\s"']*|(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]*/g, ' ')   // attached files and paths
    .replace(/@[\w-]+/g, ' ')                 // mentions
    .replace(/`([^`]*)`/g, ' $1 ')            // keep inline code words
    .replace(/[^a-z0-9_\-./]+/g, ' ');
  const out = [];
  for (let w of t.split(/\s+/)) {
    w = w.replace(/^[-./]+|[-./]+$/g, '');
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || /[/\\:]/.test(w)) continue; // paths and urls are not themes
    if (w.length > 5 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.length > 4 && w.endsWith('es') && !/[sxz]es$|[iu]es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is|os)$/.test(w)) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

// ---------- clustering: items that share rare words belong together ----------
// Each item: {text, key (pr number / session id), author, date, ...}. Two items link when they share
// at least `minShared` words that are rare in the corpus (df <= rareFrac). Union-find gives clusters.
export function cluster(items, { minShared = 2, rareFrac = 0.1, minItems = 3, minKeys = 2, overlap = 0.4 } = {}) {
  // features: rare words, plus adjacent word pairs ("await t.test", "without fix"); pairs carry most of the signal
  const toks = items.map(it => { const t = tokens(it.text); const bi = []; for (let i = 0; i + 1 < t.length; i++) bi.push(t[i] + ' ' + t[i + 1]); return uniq([...t, ...bi]); });
  const df = new Map();
  for (const ts of toks) for (const w of ts) df.set(w, (df.get(w) || 0) + 1);
  // "rare" is relative: in a thousand comments a theme word is in a few dozen; in ten comments it may be in half
  const n = items.length, limit = n < 60 ? n : Math.max(3, Math.floor(n * rareFrac));
  const rare = toks.map(ts => ts.filter(w => df.get(w) <= limit));
  const order = items.map((_, i) => i).sort((a, b) => String(items[a].date).localeCompare(String(items[b].date)));
  const cls = []; // {ids, wc: Map word->count}
  const coreOf = c => { const need = Math.max(1, Math.ceil(c.ids.length * 0.5)); return [...c.wc.entries()].filter(([, k]) => k >= need).map(([w]) => w); };
  for (const i of order) {
    const R = rare[i];
    if (R.length < minShared) continue;
    let best = null, bestScore = 0;
    for (const c of cls) {
      const core = c.core;
      const sharedAll = R.filter(w => core.includes(w));
      const pairs = sharedAll.filter(w => w.includes(' ')).length;
      const shared = sharedAll.length + pairs; // a shared pair counts double: it is two words in order
      const words = sharedAll.length - pairs;
      const linked = pairs >= 1 ? shared >= minShared : (words >= 3 && words >= 0.5 * Math.min(R.filter(w => !w.includes(' ')).length, core.filter(w => !w.includes(' ')).length));
      if (linked && shared >= overlap * Math.min(R.length, core.length) && shared > bestScore) { best = c; bestScore = shared; }
    }
    if (best) { best.ids.push(i); for (const w of R) best.wc.set(w, (best.wc.get(w) || 0) + 1); best.core = coreOf(best); }
    else { const c = { ids: [i], wc: new Map(R.map(w => [w, 1])) }; c.core = R.slice(); cls.push(c); }
  }
  const out = [];
  for (const { ids } of cls) {
    const keys = uniq(ids.map(i => items[i].key));
    if (ids.length < minItems || keys.length < minKeys) continue;
    // label: the words the cluster shares most; representative: the item that shares the most rare words with the rest
    const wc = new Map();
    for (const i of ids) for (const w of rare[i]) wc.set(w, (wc.get(w) || 0) + 1);
    const label = uniq([...wc.entries()].filter(([, c]) => c >= 2).sort((a, b) => (b[0].includes(' ') - a[0].includes(' ')) || b[1] - a[1]).slice(0, 4).flatMap(([w]) => w.split(' '))).slice(0, 5);
    const score = i => rare[i].reduce((s, w) => s + (wc.get(w) || 0), 0) / (1 + rare[i].length * 0.05);
    const rep = ids.slice().sort((a, b) => score(b) - score(a))[0];
    const members = ids.map(i => items[i]).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    out.push({ count: ids.length, keys, authors: uniq(ids.map(i => items[i].author).filter(Boolean)), label, representative: items[rep], members });
  }
  return out.sort((a, b) => b.count - a.count || b.keys.length - a.keys.length);
}

// ---------- GitHub API with a disk cache ----------
export async function gh(path, { token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, api = process.env.GITHUB_API_URL || 'https://api.github.com' } = {}) {
  const headers = { 'User-Agent': 'grudge', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(api + path, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    throw new Error(`GitHub rate limit hit${reset ? `, resets ${new Date(reset * 1000).toLocaleTimeString()}` : ''}. Set GITHUB_TOKEN for 5000 requests an hour.`);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return { data: await res.json(), link: res.headers.get('link') || '' };
}
function cacheFile(root, name) { const dir = join(root, '.grudge', 'cache'); mkdirSync(dir, { recursive: true }); return join(dir, name); }
function readCache(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } }

export async function fetchReviewComments(root, repo, { since, max = 2000, cache = true, api } = {}) {
  const file = cache ? cacheFile(root, `reviews-${repo.replace('/', '__')}.json`) : null;
  const cached = cache ? readCache(file) : null;
  let items = cached?.items || [];
  const newest = items[0]?.created_at;
  // newest-first pages; stop when we reach what the cache already has, the window, or max
  let page = 1, fresh = [];
  for (;;) {
    let data;
    try { ({ data } = await gh(`/repos/${repo}/pulls/comments?per_page=100&sort=created&direction=desc&page=${page}`, { api })); }
    catch (e) { if (!items.length && !fresh.length) throw e; fetchReviewComments.warning = `reviews: ${e.message} Using the cached ${items.length + fresh.length} comments (fetched ${(cached?.fetched_at || '').slice(0, 10)}).`; break; }
    if (!Array.isArray(data) || !data.length) break;
    let stop = false;
    for (const c of data) {
      if ((newest && c.created_at <= newest) || (since && c.created_at < since)) { stop = true; break; }
      fresh.push({ id: c.id, pr: Number(String(c.pull_request_url).split('/').pop()), path: c.path, body: c.body || '', user: c.user?.login || '', bot: c.user?.type === 'Bot' || /\[bot\]$/.test(c.user?.login || '') || /^\s*(<!--|\*\*\[AI[:\]]|\[AI[:\]])/.test(c.body || ''), reply: !!c.in_reply_to_id, created_at: c.created_at, url: c.html_url });
    }
    if (stop || data.length < 100 || fresh.length >= max) break;
    page++;
  }
  items = [...fresh, ...items];
  if (cache) writeFileSync(file, JSON.stringify({ repo, fetched_at: new Date().toISOString(), items }));
  return items.filter(c => !since || c.created_at >= since).slice(0, max);
}

export async function fetchRuns(root, repo, branch, { cache = true, api } = {}) {
  const file = cache ? cacheFile(root, `runs-${repo.replace('/', '__')}-${branch}.json`) : null;
  const cached = cache ? readCache(file) : null;
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 6 * 3600e3) return cached.runs;
  const runs = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await gh(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=100&page=${page}`, { api });
    const rs = data?.workflow_runs || [];
    for (const r of rs) runs.push({ id: r.id, name: r.name, sha: (r.head_sha || '').slice(0, 7), status: r.status, conclusion: r.conclusion, created_at: r.created_at, updated_at: r.updated_at, url: r.html_url });
    if (rs.length < 100) break;
  }
  if (cache) writeFileSync(file, JSON.stringify({ fetched_at: new Date().toISOString(), runs }));
  return runs;
}

// ---------- source: reviews ----------
// Comments phrased as advice are the ones that turn into rules; questions and discussion rarely do.
const ADVICE = /\b(please|shouldn'?t|should not|avoid|prefer|never|always|don'?t|do not|instead of|must|use `|add (a |an |some |more )?(test|tests|changelog|comment|docs?)|is missing|remove (this|the|these)|rename (this|the)|let'?s not|no need|unnecessary|redundant|nit:|nit\b)/i;
export const isAdvice = t => ADVICE.test(String(t));
const AI_BODY = /^\s*(<!--|\*\*\[AI[:\]]|\[AI[:\]]|### (Bug|Security|Issue|Suggestion):)/;
export function analyzeReviews(comments, { includeBots = false, includeReplies = false, min = 3 } = {}) {
  comments = comments.map(c => ({ ...c, bot: c.bot || AI_BODY.test(c.body || '') }));
  const kept = comments.filter(c => (includeBots || !c.bot) && (includeReplies || !c.reply) && tokens(c.body).length >= 2);
  const items = kept.map(c => ({ text: c.body, key: c.pr, author: c.user, date: c.created_at, path: c.path, url: c.url }));
  const clusters = cluster(items, { minItems: min, minKeys: 2 })
    .map(c => ({ ...c, advice: c.members.filter(m => isAdvice(m.text)).length }))
    .sort((a, b) => (b.advice / b.count >= 0.5) - (a.advice / a.count >= 0.5) || b.count - a.count);
  return {
    comments: comments.length, considered: kept.length, prs: uniq(kept.map(c => c.pr)).length, reviewers: uniq(kept.map(c => c.user)).length,
    bots: comments.filter(c => c.bot).length, replies: comments.filter(c => c.reply).length,
    findings: clusters.map(c => ({
      kind: 'review', count: c.count, prs: c.keys.length, reviewers: c.authors.length, advice: c.advice, label: c.label,
      quote: short((c.members.filter(m => isAdvice(m.text)).sort((x, y) => x.text.length - y.text.length)[0] || c.representative).text, 140), paths: uniq(c.members.map(m => dirname(m.path || '')).filter(Boolean)).slice(0, 3),
      evidence: c.members.slice(0, 6).map(m => ({ ref: `#${m.key}`, by: m.author, date: String(m.date).slice(0, 10), quote: short(m.text, 120), url: m.url })),
    })),
  };
}

// ---------- source: sessions (Claude Code transcripts) ----------
export function projectSlug(dir) { const abs = /^(?:[A-Za-z]:[\\/]|\/)/.test(dir) ? dir : resolve(dir); return abs.replace(/[^A-Za-z0-9]/g, '-'); }
export function projectsRoot() { return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects'); }
export function findTranscripts(project, { since } = {}) {
  const dir = join(projectsRoot(), projectSlug(project));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f))
    .filter(f => { const s = statSync(f); return s.size > 0 && (!since || s.mtime >= since); })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}
function contentText(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
}
function isHuman(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return false;
  const c = o.message?.content;
  if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) return false;
  const t = contentText(c).trim();
  return t.length > 0 && !/^<(system-reminder|task-notification|local-command|command-name|command-message|ide_|pasted_content)/.test(t) && !/^\[Request interrupted/.test(t);
}
// A correction: the user pushing back on what the agent just did, or restating something they already said.
const CORRECT_START = /^(no\b|nope\b|wrong\b|stop\b|don'?t\b|do not\b|not that\b|not like that|again\b|i said\b|i told you\b|as i said\b|i asked\b|i already\b|you (forgot|didn'?t|did not|missed|ignored|should|shouldn'?t|need to|were supposed|keep|always|never)\b|why (did|didn'?t|are|do) you\b|that'?s not\b|this is not\b|that is not\b|instead\b|never\b|always\b|please (don'?t|stop|use|never|always|just)\b|remember\b|use .{1,40} instead|only\b)/i;
const CORRECT_ANY = /\b(i (already |just )?(said|told you|asked( you)?)|instead of|not what i (asked|said|wanted|meant)|didn'?t ask (for|you)|you (forgot|missed|ignored|broke|removed|deleted|changed)|do(n'?t| not) (ever |do that|change|touch|add|remove|delete|run|use)|stop (doing|using|adding|changing|running)|never (do|use|add|run|touch|change)|always (run|use|check|ask|keep|do)|wrong (file|place|branch|folder|directory|command)|read (the|my) (instructions|rules|claude\.md|agents\.md)|follow (the|my) (instructions|rules)|fix (this|it|that)|that'?s wrong|the wrong (way|one|file)|(is|still) not working|(doesn'?t|didn'?t|does not|did not) work|still (broken|wrong|failing|the same)|same (error|issue|problem|thing) again|try again|once more)\b/i;
const wordCount = t => t.trim().split(/\s+/).length;
export function isCorrection(text) {
  const t = text.trim();
  const words = wordCount(t);
  if (words > 200 || t.startsWith('/')) return false;
  if (CORRECT_START.test(t)) return 'strong';
  if (words <= 60 && CORRECT_ANY.test(t)) return 'weak';
  return false;
}
const FAIL_RE = /\b(command not found|is not recognized as|No such file or directory|ENOENT|ModuleNotFoundError|ImportError|npm ERR!|error TS\d+|SyntaxError|Permission denied|EACCES|fatal:|Traceback \(most recent call last\))\b|[Ee]xit code [1-9]\d*/;
const PLUMBING = new Set(('cd ls cat echo printf grep egrep rg sed awk head tail mkdir rm cp mv find wc sort uniq cut tr od xargs test true false export set unset source time sleep timeout which type command pwd touch chmod date env tee diff tar zip unzip curl wget ' +
  'for do done if then else elif fi while until case esac function return exit local read shift eval exec trap wait kill jobs bg fg').split(' '));
// The program a shell command is really about: skip cd/ls/cat plumbing, VAR=x prefixes and inline node -e scripts.
export function commandHead(cmd) {
  const segments = String(cmd).replace(/<<['"]?\w+['"]?[\s\S]*$/, '').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""').split(/\s*(?:&&|\|\||;|\||\n)\s*/);
  const bare = p => basename(p.replace(/["'()]/g, ''));
  for (let seg of segments) {
    seg = seg.trim().replace(/^\(\s*/, '').replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const parts = seg.split(/\s+/);
    const head = bare(parts[0] || '');
    if (!head || PLUMBING.has(head) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0])) continue;
    if (/^(node|python3?|py)$/.test(head) && /^(-e|-|-c|-p|"")$/.test(parts[1] || '')) continue;
    let out = head;
    if (/^(python3?|py)$/.test(head) && parts[1] === '-m' && parts[2]) out += ' -m ' + parts[2];
    else if (/^(npm|pnpm|yarn|bun|npx|node|python3?|py|pip3?|uv|poetry|cargo|go|make|docker|git|gh|dotnet|mvn|gradle|soffice)$/.test(head) && parts[1] && !parts[1].startsWith('-')) out += ' ' + bare(parts[1]);
    if (/^(npm|pnpm|yarn|bun) run$/.test(out) && parts[2]) out += ' ' + parts[2];
    return out.slice(0, 40);
  }
  return null;
}
export function analyzeSessions(files, { min = 3 } = {}) {
  const corrections = [], failures = [], repeats = [];
  let humans = 0;
  for (const file of files) {
    const session = basename(file, '.jsonl');
    let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    const toolById = new Map();
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'assistant') {
        for (const b of o.message?.content || []) if (b.type === 'tool_use' && b.name === 'Bash') toolById.set(b.id, b.input?.command || '');
      } else if (o.type === 'user') {
        const c = o.message?.content;
        if (Array.isArray(c)) for (const b of c) {
          if (b.type !== 'tool_result' || !toolById.has(b.tool_use_id)) continue;
          const text = contentText(b.content) || (typeof b.content === 'string' ? b.content : '');
          const head = b.is_error ? commandHead(toolById.get(b.tool_use_id)) : null;
          if (head) { const at = text.search(FAIL_RE); failures.push({ cmd: toolById.get(b.tool_use_id), head, session, date: o.timestamp, snippet: short(at >= 0 ? text.slice(Math.max(0, at - 20), at + 70) : (text.split('\n').filter(Boolean).at(-1) || ''), 90) }); }
        }
        if (isHuman(o)) {
          humans++;
          const text = contentText(c).trim();
          const kind = isCorrection(text);
          if (kind) corrections.push({ text, key: session, author: 'you', date: o.timestamp, strength: kind });
          else if (wordCount(text) <= 60 && wordCount(text) >= 3) repeats.push({ text, key: session, author: 'you', date: o.timestamp, strength: null });
        }
      }
    }
  }
  // two pools: corrections cluster loosely (2 shared rare words); anything else you keep asking for needs a tighter match
  const clusters = [
    ...cluster(corrections, { minShared: 2, minItems: Math.max(2, min - 1), minKeys: 2 }).map(c => ({ ...c, kind: 'correction' })),
    ...cluster([...repeats, ...corrections], { minShared: 3, minItems: min, minKeys: 2, overlap: 0.5 }).map(c => ({ ...c, kind: 'repeat' })),
  ];
  const seen = new Set(clusters.filter(c => c.kind === 'correction').flatMap(c => c.members.map(m => m.text)));
  const merged = clusters.filter(c => c.kind === 'correction' || c.members.filter(m => !seen.has(m.text)).length >= min);
  const byHead = new Map();
  for (const f of failures) { if (!byHead.has(f.head)) byHead.set(f.head, []); byHead.get(f.head).push(f); }
  const failFindings = [...byHead.entries()].map(([head, fs]) => ({ head, count: fs.length, sessions: uniq(fs.map(f => f.session)).length, fs }))
    .filter(x => x.count >= min && x.sessions >= 2).sort((a, b) => b.count - a.count);
  return {
    sessions: files.length, humanMessages: humans, corrections: corrections.length, strong: corrections.filter(c => c.strength === 'strong').length, failures: failures.length,
    findings: [
      ...merged.map(c => ({ kind: c.kind, count: c.count, sessions: c.keys.length, corrections: c.members.filter(m => m.strength).length, label: c.label, quote: short(c.representative.text, 140),
        evidence: c.members.slice(0, 6).map(m => ({ ref: m.key.slice(0, 8), date: String(m.date).slice(0, 10), quote: short(m.text, 120) })) })),
      ...failFindings.map(x => ({ kind: 'failure', count: x.count, sessions: x.sessions, head: x.head, quote: `\`${x.head}\` failed ${x.count} times in ${plural(x.sessions, 'session')}`,
        evidence: x.fs.slice(0, 4).map(f => ({ ref: f.session.slice(0, 8), date: String(f.date).slice(0, 10), quote: short(`${f.snippet}  ←  ${f.cmd}`, 120) })) })),
    ],
    loose: corrections.filter(c => c.strength === 'strong').slice(-12).map(c => ({ ref: c.key.slice(0, 8), date: String(c.date).slice(0, 10), quote: short(c.text, 120) })),
  };
}

// ---------- source: git ----------
const FIXUP = [
  ['lint/format', /\b(fix|run|apply)\s*(the\s*)?(lint|linter|linting|eslint|prettier|format(ting)?|fmt|style|biome|ruff|black)\b|\blint(ing)?\s*(fix|error)/i],
  ['types', /\b(fix|resolve)\s*(the\s*)?(type|types|typing|tsc|typescript|mypy|pyright)\b|\btype\s*(error|fix)/i],
  ['tests', /\b(fix|repair|unbreak)\s*(the\s*)?(failing\s*)?(test|tests|spec|specs|snapshot|snapshots)\b|\btests?\s*(fix|fail)/i],
  ['ci/build', /\b(fix|repair|unbreak)\s*(the\s*)?(ci|build|pipeline|workflow|action|actions|deploy)\b|\bci\s*(fix|fail)/i],
  ['review feedback', /\b(address|apply|incorporate|resolve)\s*(the\s*)?(review|pr|feedback|comments?|suggestions?|nits?)\b|\bpr\s*(feedback|comments?)|\breview\s*(feedback|comments?|fixes?)\b/i],
  ['typos/oops', /\b(typo|oops|whoops|wip|forgot|forgotten|missing file|leftover|cleanup after|revert)\b/i],
];
export function analyzeGit(root, { days = 180, min = 3 } = {}) {
  const raw = git(['log', `--since=${days} days ago`, '--no-merges', '--format=%h%x1f%ad%x1f%s', '--date=short'], root);
  const commits = raw ? raw.split('\n').map(l => { const [sha, date, subject] = l.split('\x1f'); return { sha, date, subject: subject || '' }; }) : [];
  const findings = [];
  for (const [name, re] of FIXUP) {
    const hits = commits.filter(c => re.test(c.subject));
    if (hits.length >= min) findings.push({ kind: 'fixup', category: name, count: hits.length, share: commits.length ? Math.round(100 * hits.length / commits.length) : 0,
      quote: `${plural(hits.length, 'commit')} that only fix ${name} (${Math.round(100 * hits.length / commits.length)}% of ${commits.length})`,
      evidence: hits.slice(0, 5).map(c => ({ ref: c.sha, date: c.date, quote: short(c.subject, 100) })) });
  }
  return { commits: commits.length, days, findings: findings.sort((a, b) => b.count - a.count) };
}

// ---------- source: ci ----------
export function analyzeRuns(runs, { min = 2 } = {}) {
  const byName = new Map();
  for (const r of runs) { if (!r.conclusion || r.conclusion === 'cancelled' || r.conclusion === 'skipped') continue; if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }
  const findings = []; let total = 0, failed = 0;
  for (const [name, rs] of byName) {
    rs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    total += rs.length; failed += rs.filter(r => r.conclusion === 'failure').length;
    let streak = [];
    const flush = (next) => {
      if (streak.length >= min) {
        const start = Date.parse(streak[0].created_at), end = next ? Date.parse(next.created_at) : Date.now();
        findings.push({ kind: 'ci', workflow: name, pushes: streak.length, hours: Math.round((end - start) / 3600e3), open: !next, from: streak[0].created_at.slice(0, 10),
          quote: `${name}: red for ${Math.round((end - start) / 3600e3)}h across ${plural(streak.length, 'push')}${next ? '' : ' (still red)'}`,
          evidence: streak.slice(0, 5).map(r => ({ ref: r.sha, date: r.created_at.slice(0, 10), quote: `${r.conclusion}`, url: r.url })) });
      }
      streak = [];
    };
    for (const r of rs) { if (r.conclusion === 'failure') streak.push(r); else flush(r); }
    flush(null);
  }
  return { runs: total, failed, redRate: total ? Math.round(100 * failed / total) : 0, findings: findings.sort((a, b) => b.hours - a.hours) };
}

// ---------- source: rules (instruction files) ----------
export const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md', '.windsurfrules'];
export function ruleFiles(root) {
  const out = RULE_FILES.filter(f => existsSync(join(root, f)));
  const dir = join(root, '.cursor', 'rules');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/\.mdc?$/.test(f)) out.push(join('.cursor', 'rules', f));
  return out;
}
export function analyzeRules(root) {
  const files = ruleFiles(root);
  let scripts = {}; try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {}; } catch { }
  let makeTargets = null; try { makeTargets = new Set([...readFileSync(join(root, 'Makefile'), 'utf8').matchAll(/^([A-Za-z0-9_.-]+):/gm)].map(m => m[1])); } catch { }
  const findings = [], lines = new Map();
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    const stale = [];
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const code = m[1].trim();
      const s = code.match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_-]+)/);
      if (s && !['install', 'ci', 'test', 'start', 'init', 'create', 'exec', 'dlx', 'x', 'add', 'remove', 'update', 'publish', 'link', 'i'].includes(s[1]) && !(s[1] in scripts)) { stale.push({ what: code, why: `no "${s[1]}" script in package.json` }); continue; }
      const mk = code.match(/^make\s+([A-Za-z0-9_.-]+)/);
      if (mk && makeTargets && !makeTargets.has(mk[1])) { stale.push({ what: code, why: `no "${mk[1]}" target in Makefile` }); continue; }
      if (/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+\/?$/.test(code) && !/^(https?:|\.\.?\/?$)/.test(code) && !/[*<>{}$]/.test(code) && /[./]/.test(code) && !/^(a|an|the|and|or)\//.test(code)) {
        const p = code.replace(/\/$/, '');
        if (!/^[a-z]+\/[a-z]+$/.test(p) || /\./.test(p)) if (!existsSync(join(root, p))) stale.push({ what: code, why: 'path does not exist' });
      }
    }
    if (stale.length) findings.push({ kind: 'stale', file: f, count: stale.length, quote: `${f}: ${plural(stale.length, 'reference')} to things that do not exist`, evidence: stale.slice(0, 6).map(s => ({ ref: f, quote: `${s.what} — ${s.why}` })) });
    for (const line of text.split('\n')) {
      const norm = line.replace(/^[\s>*\-\d.]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (norm.length < 30 || /^[#`|]/.test(norm)) continue;
      if (!lines.has(norm)) lines.set(norm, new Set());
      lines.get(norm).add(f);
    }
  }
  const dups = [...lines.entries()].filter(([, fs]) => fs.size >= 2);
  if (dups.length) findings.push({ kind: 'duplicate', count: dups.length, quote: `${plural(dups.length, 'rule')} written in more than one instruction file`, evidence: dups.slice(0, 6).map(([l, fs]) => ({ ref: [...fs].join(', '), quote: short(l, 110) })) });
  return { files, findings };
}

// ---------- run everything ----------
export async function run(opts = {}) {
  const root = repoRoot(opts.root);
  const days = opts.days ?? 180, min = opts.min ?? 3, since = daysAgo(days);
  const sources = (opts.source || 'reviews,sessions,git,ci,rules').split(',').map(s => s.trim());
  const repo = githubRepo(root, opts.repo);
  const out = { root, repo, days, at: new Date().toISOString(), sources: {}, skipped: [] };
  if (sources.includes('reviews')) {
    if (!repo) out.skipped.push('reviews: no GitHub remote (pass --repo owner/name)');
    else try {
      const comments = await fetchReviewComments(root, repo, { since: since.toISOString(), max: opts.max ?? 2000, cache: opts.cache !== false, api: opts.api });
      out.sources.reviews = analyzeReviews(comments, { includeBots: opts.includeBots, includeReplies: opts.includeReplies, min });
      if (fetchReviewComments.warning) { out.skipped.push(fetchReviewComments.warning); fetchReviewComments.warning = null; }
    } catch (e) { out.skipped.push(`reviews: ${e.message}`); }
  }
  if (sources.includes('sessions')) {
    const files = findTranscripts(opts.project || root, { since });
    if (!files.length) out.skipped.push(`sessions: no Claude Code transcripts for ${opts.project || root}`);
    else out.sources.sessions = analyzeSessions(files, { min });
  }
  if (sources.includes('git')) out.sources.git = analyzeGit(root, { days, min });
  if (sources.includes('ci')) {
    if (!repo) out.skipped.push('ci: no GitHub remote');
    else try { out.sources.ci = analyzeRuns(await fetchRuns(root, repo, defaultBranch(root), { cache: opts.cache !== false, api: opts.api }), { min: 2 }); }
    catch (e) { out.skipped.push(`ci: ${e.message}`); }
  }
  if (sources.includes('rules')) out.sources.rules = analyzeRules(root);
  out.findings = Object.entries(out.sources).flatMap(([src, s]) => (s.findings || []).map(f => ({ source: src, ...f })));
  return out;
}

// ---------- output ----------
export function format(r) {
  const L = [];
  const head = [`grudge  ${r.repo || basename(r.root)}  ·  last ${r.days} days`];
  const s = r.sources;
  if (s.reviews) head.push(`reviews ${s.reviews.considered} comments / ${plural(s.reviews.prs, 'PR')}`);
  if (s.sessions) head.push(`sessions ${s.sessions.sessions}`);
  if (s.git) head.push(`commits ${s.git.commits}`);
  if (s.ci) head.push(`ci runs ${s.ci.runs}`);
  L.push(head.join('  ·  '));
  if (!r.findings.length) L.push('\nNOTHING REPEATED  no correction showed up often enough to become a rule.');
  const section = (title, fs, line, empty) => {
    L.push(`\n${title}`);
    if (!fs?.length) { L.push(`     ${empty || 'nothing repeated'}`); return; }
    fs.slice(0, 12).forEach((f, i) => { L.push(`${String(i + 1).padStart(3)}. ${line(f)}`); for (const e of f.evidence.slice(0, 3)) L.push(`       ${e.ref}${e.date ? ' ' + e.date : ''}${e.by ? ' ' + e.by : ''}  ${e.quote}`); });
    if (fs.length > 12) L.push(`     … ${fs.length - 12} more (--json)`);
  };
  if (s.reviews) section(`REVIEWS  ${plural(s.reviews.findings.length, 'thing')} reviewers keep saying  (${s.reviews.considered} human top-level comments; ${s.reviews.bots} bot, ${s.reviews.replies} replies ignored)`, s.reviews.findings,
    f => `×${f.count} in ${plural(f.prs, 'PR')}, ${plural(f.reviewers, 'reviewer')}${f.advice / f.count >= 0.5 ? '  advice' : '  discussion'}  [${f.label.join(' ')}]\n       "${f.quote}"`, 'no comment theme repeated across PRs');
  if (s.sessions) {
    section(`SESSIONS  ${plural(s.sessions.findings.length, 'thing')} you keep telling the agent  (${s.sessions.corrections} corrections in ${s.sessions.humanMessages} messages)`, s.sessions.findings,
      f => f.kind === 'failure' ? `${f.quote}` : `×${f.count} in ${plural(f.sessions, 'session')}${f.kind === 'repeat' ? ' (same request again)' : ''}  [${f.label.join(' ')}]\n       "${f.quote}"`, 'nothing you said often enough across sessions');
    if (!s.sessions.findings.length && s.sessions.loose.length) { L.push(`\nSESSIONS  nothing repeated across sessions yet; recent corrections:`); for (const e of s.sessions.loose.slice(-5)) L.push(`       ${e.ref} ${e.date}  ${e.quote}`); }
  }
  if (s.git) section(`GIT  ${s.git.commits} commits`, s.git.findings, f => f.quote, 'no run of fix-up commits');
  if (s.ci) section(`CI  ${s.ci.redRate}% of ${s.ci.runs} default-branch runs failed`, s.ci.findings, f => f.quote, 'no red streak');
  if (s.rules) section(`RULES  ${s.rules.files.join(', ') || 'no instruction file found'}`, s.rules.findings, f => f.quote, s.rules.files.length ? 'every referenced path and script exists; no duplicated rules' : 'write one: grudge --apply creates AGENTS.md');
  if (r.skipped.length) L.push('\nskipped: ' + r.skipped.join('; '));
  return L.join('\n');
}
export function draft(r) {
  const L = [`<!-- grudge:start -->`, `## Rules from grudge (${r.at.slice(0, 10)}, last ${r.days} days)`, '', 'Each rule is a thing that kept being corrected. Rewrite the wording; keep the evidence.', ''];
  for (const f of r.findings) {
    let rule;
    if (f.kind === 'review') rule = `Reviewers said ${f.count} times in ${plural(f.prs, 'PR')}: "${f.quote}"`;
    else if (f.kind === 'correction' || f.kind === 'repeat') rule = `You said ${f.count} times in ${plural(f.sessions, 'session')}: "${f.quote}"`;
    else if (f.kind === 'failure') rule = `Do not run \`${f.head}\` here: it failed ${f.count} times in ${plural(f.sessions, 'session')} (${f.evidence[0]?.quote})`;
    else if (f.kind === 'fixup') rule = `Run the ${f.category} check before committing: ${f.quote}`;
    else if (f.kind === 'ci') rule = `Check CI after pushing to the default branch: ${f.quote}`;
    else if (f.kind === 'stale') rule = `Fix ${f.file}: ${f.evidence.map(e => e.quote).join('; ')}`;
    else if (f.kind === 'duplicate') rule = `Keep each rule in one file: ${f.quote}`;
    else rule = f.quote;
    L.push(`- ${rule}`);
    const refs = f.evidence.map(e => e.ref).filter(Boolean).slice(0, 4);
    if (refs.length && f.kind !== 'stale' && f.kind !== 'duplicate') L.push(`  - evidence: ${uniq(refs).join(', ')}`);
  }
  if (!r.findings.length) L.push('- (nothing repeated often enough to become a rule)');
  L.push('<!-- grudge:end -->');
  return L.join('\n');
}
export function apply(root, file, section) {
  const path = join(root, file);
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const re = /<!-- grudge:start -->[\s\S]*?<!-- grudge:end -->/;
  const next = re.test(prev) ? prev.replace(re, section) : (prev.replace(/\s*$/, '') + (prev ? '\n\n' : '') + section + '\n');
  writeFileSync(path, next);
  return path;
}

// ---------- cli ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const flag = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const has = k => a.includes(k);
  if (has('--help') || has('-h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  const opts = { root: flag('--root'), repo: flag('--repo'), project: flag('--project'), days: Number(flag('--days', 180)), min: Number(flag('--min', 3)), max: Number(flag('--max', 2000)),
    source: flag('--source'), includeBots: has('--include-bots'), includeReplies: has('--include-replies'), cache: !has('--no-cache'), api: flag('--api') };
  run(opts).then(r => {
    if (has('--json')) console.log(JSON.stringify(r, null, 2));
    else if (has('--draft')) console.log(draft(r));
    else if (has('--apply')) { const p = apply(r.root, flag('--file', existsSync(join(r.root, 'CLAUDE.md')) && !existsSync(join(r.root, 'AGENTS.md')) ? 'CLAUDE.md' : 'AGENTS.md'), draft(r)); console.log(`grudge: wrote ${r.findings.length} candidate rules to ${p}`); }
    else console.log(format(r));
  }).catch(e => { console.error(`grudge: ${e.message}`); process.exit(1); });
}

// =====================================================================
// Step 2 : 수집 로봇 1호 — Reddit 공개 JSON + 기술매체 RSS
// 실행: node collector/collect.mjs
//
// 지키는 규칙 (spec v2 §37, kickoff §2 Step 2):
//  - 요청 간격 2초, User-Agent 명시, 429(과다요청) 시 백오프 후 1회 재시도
//  - 원문 전문 저장 금지: 발췌 500자 한도
//  - 사용자명(작성자) 저장 금지
//  - URL unique 로 중복 입고 방지 (이미 있으면 건너뜀)
//  - 수집 결과를 collection_runs(출근 기록부)에 기록
// =====================================================================
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// --- .env 로드 (GitHub Actions에서는 환경변수로 직접 주입됨) ---
const env = { ...process.env };
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
} catch { /* .env 없으면 환경변수만 사용 (Actions 환경) */ }

const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE;
if (!URL_ || !KEY) { console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE 필요'); process.exit(1); }

const UA = '9100-radar-collector/1.0 (public data research; github.com/siren911/9100-radar)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
// 검색 설정 (spec v2 §6 키워드 사전)
// ─────────────────────────────────────────────
// 제품 식별: 이 단어들 중 하나가 본문/제목에 있어야만 입고
const PRODUCT_RE = /9100\s*pro|9100pro/i;

// Reddit 검색 쿼리: 제품명 하나로 통합 (rate limit 회피 — 세부 필터링은 로컬에서)
// ※ JSON API는 403으로 차단되어 공개 RSS(search.rss)를 사용 (2026-07 검증)
// ※ 쿼리를 여러 개 연속 요청하면 429가 뜨므로 1개만 사용
const REDDIT_QUERIES = [
  '"9100 pro"',
];

// 기술매체 RSS (robots/약관상 공개 피드, 2026-07 접근 검증 완료)
const RSS_FEEDS = [
  { name: 'TechPowerUp',  url: 'https://www.techpowerup.com/rss/news' },
  { name: 'TomsHardware', url: 'https://www.tomshardware.com/feeds/all' },
  { name: 'TechSpot',     url: 'https://www.techspot.com/backend.xml' },
  { name: 'ServeTheHome', url: 'https://www.servethehome.com/feed/' },
  { name: 'Overclock3D',  url: 'https://overclock3d.net/feed/' },
  { name: 'Neowin',       url: 'https://www.neowin.net/news/rss/' },
];

// ─────────────────────────────────────────────
// 공용 도우미
// ─────────────────────────────────────────────
function detectLang(text) {
  if (/[가-힣]/.test(text)) return 'ko';
  if (/[ぁ-んァ-ン]/.test(text)) return 'ja';
  if (/[一-鿿]/.test(text)) return 'zh';
  return 'en';
}
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }
function excerptOf(s) { return stripHtml(s).slice(0, 500); }               // 발췌 500자 한도
function hashOf(title, body) {
  const norm = (title + ' ' + body).toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

// 예의 바른 fetch: UA 명시 + 429/503/403 시 백오프 재시도 (60초 → 120초)
// ※ Reddit은 무인증 요청을 분당 1회 수준으로 제한하므로 넉넉히 기다린다
async function politeFetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status === 503 || res.status === 403) {
      if (attempt === 2) return res;                 // 마지막 시도면 그대로 반환
      const wait = 60_000 * (attempt + 1);
      console.log(`  ⏳ ${res.status} 응답 — ${wait / 1000}초 물러났다 재시도`);
      await sleep(wait);
      continue;
    }
    return res;
  }
}

// curl 경유 fetch: Reddit은 Node fetch의 TLS 지문을 차단하므로 curl 사용 (2026-07 검증)
// curl은 Windows 10+ / GitHub Actions 러너에 기본 탑재
async function curlFetch(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP('curl', [
        '-s', '--compressed', '--max-time', '30',
        '-w', '\n__HTTP_STATUS__%{http_code}',
        '-H', `User-Agent: ${UA}`,
        url,
      ], { maxBuffer: 10 * 1024 * 1024 });
      const idx = stdout.lastIndexOf('\n__HTTP_STATUS__');
      const status = Number(stdout.slice(idx + 16).trim());
      const body = stdout.slice(0, idx);
      if (status === 429 || status === 503 || status === 403) {
        if (attempt === 2) return { ok: false, status, text: async () => body };
        const wait = 60_000 * (attempt + 1);
        console.log(`  ⏳ ${status} 응답 — ${wait / 1000}초 물러났다 재시도`);
        await sleep(wait);
        continue;
      }
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(10_000);                            // 네트워크 일시 오류 — 10초 후 재시도
    }
  }
}

// Supabase REST 도우미
async function sb(path, opts = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path} 실패 (${res.status}): ${await res.text()}`);
  return res;
}

// posts 입고: url 중복이면 조용히 건너뜀, 실제 신규 건수를 반환
async function insertPosts(rows) {
  if (!rows.length) return 0;
  const res = await sb('posts?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  return (await res.json()).length;
}

// 출근 기록부
async function recordRun(source, { fetched, added, errors, note }) {
  await sb('collection_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ source, finished: new Date().toISOString(), fetched, new: added, errors, note: note || null }),
  });
}

// ─────────────────────────────────────────────
// 수집기 1 : Reddit 공개 검색 RSS (Atom 형식)
// ─────────────────────────────────────────────
function parseAtom(xml) {
  const items = [];
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const block = m[0];
    const pick = tag => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return mm ? mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    };
    const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    const cat  = block.match(/<category[^>]*label="([^"]+)"/i)?.[1] || '';
    items.push({ title: pick('title'), link, pubDate: pick('updated') || pick('published'), desc: pick('content'), cat });
  }
  return items;
}

async function collectReddit() {
  console.log('🤖 [Reddit] 수집 시작 (공개 RSS)');
  let fetched = 0, errors = 0;
  const rows = [];
  for (const q of REDDIT_QUERIES) {
    try {
      const url = `https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}&sort=new&t=month&limit=100`;
      const res = await curlFetch(url);              // Reddit은 curl 경유 (Node fetch 차단)
      if (!res.ok) { console.log(`  ⚠️ "${q}" → HTTP ${res.status}`); errors++; await sleep(2000); continue; }
      const entries = parseAtom(await res.text());
      fetched += entries.length;
      for (const e of entries) {
        const body = stripHtml(e.desc);
        const text = `${stripHtml(e.title)} ${body}`;
        if (!PRODUCT_RE.test(text)) continue;                    // 제품 무관 글 제외
        rows.push({
          url: e.link.split('?')[0],
          source: 'reddit',
          lang: detectLang(text),
          title: stripHtml(e.title).slice(0, 300),
          excerpt: excerptOf(body || e.title),
          posted_at: e.pubDate ? new Date(e.pubDate).toISOString() : null,
          raw_hash: hashOf(e.title, body),
          meta: { subreddit: e.cat || null },                     // 작성자명 저장 안 함
        });
      }
      console.log(`  🔍 "${q}" → ${entries.length}건 중 제품 관련 후보 누적 ${rows.length}건`);
    } catch (e) { console.log(`  ⚠️ "${q}" 실패: ${e.message}`); errors++; }
    await sleep(2000);                                           // 요청 간격 2초
  }
  // URL 기준 중복 제거 후 입고
  const uniq = [...new Map(rows.map(r => [r.url, r])).values()];
  const added = await insertPosts(uniq);
  await recordRun('reddit', { fetched, added, errors });
  console.log(`✅ [Reddit] 조회 ${fetched}건 → 관련 ${uniq.length}건 → 신규 입고 ${added}건 (중복 ${uniq.length - added}건 건너뜀)\n`);
  return { fetched, added, errors };
}

// ─────────────────────────────────────────────
// 수집기 2 : 기술매체 RSS
// ─────────────────────────────────────────────
function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const pick = tag => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return mm ? mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    };
    items.push({ title: pick('title'), link: pick('link'), pubDate: pick('pubDate'), desc: pick('description') });
  }
  return items;
}

async function collectRss() {
  console.log('🤖 [RSS] 수집 시작');
  let fetched = 0, errors = 0;
  const rows = [];
  for (const feed of RSS_FEEDS) {
    try {
      const res = await politeFetch(feed.url);
      if (!res.ok) { console.log(`  ⚠️ ${feed.name} → HTTP ${res.status}`); errors++; await sleep(2000); continue; }
      const items = parseRss(await res.text());
      fetched += items.length;
      const hit = items.filter(it => PRODUCT_RE.test(`${it.title} ${it.desc}`));
      for (const it of hit) {
        const text = `${it.title} ${it.desc}`;
        rows.push({
          url: it.link,
          source: `rss:${feed.name}`,
          lang: detectLang(text),
          title: stripHtml(it.title).slice(0, 300),
          excerpt: excerptOf(it.desc || it.title),
          posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
          raw_hash: hashOf(it.title, it.desc),
          meta: { feed: feed.name },
        });
      }
      console.log(`  📰 ${feed.name} → ${items.length}건 중 제품 관련 ${hit.length}건`);
    } catch (e) { console.log(`  ⚠️ ${feed.name} 실패: ${e.message}`); errors++; }
    await sleep(2000);                                           // 요청 간격 2초
  }
  const uniq = [...new Map(rows.map(r => [r.url, r])).values()];
  const added = await insertPosts(uniq);
  await recordRun('rss', { fetched, added, errors });
  console.log(`✅ [RSS] 조회 ${fetched}건 → 관련 ${uniq.length}건 → 신규 입고 ${added}건\n`);
  return { fetched, added, errors };
}

// ─────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────
const t0 = Date.now();
console.log(`\n══════ 9100-radar 수집 로봇 출근 (${new Date().toISOString()}) ══════\n`);
const r1 = await collectReddit();
const r2 = await collectRss();
console.log('══════ 수집 요약 ══════');
console.log(`Reddit : 조회 ${r1.fetched} / 신규 ${r1.added} / 오류 ${r1.errors}`);
console.log(`RSS    : 조회 ${r2.fetched} / 신규 ${r2.added} / 오류 ${r2.errors}`);
console.log(`⏱ 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초 — 퇴근!`);

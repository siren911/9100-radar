// =====================================================================
// Step 1-B : index.html 의 CLUSTERS/CASES 20건을 Supabase(cases/clusters)에 입고
// 실행: node collector/seed.mjs
// service_role(마스터 열쇠)로 REST upsert. 여러 번 실행해도 중복 없이 갱신(upsert)됨.
// =====================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// --- .env 로드 (외부 라이브러리 없이 직접 파싱) ---
const env = {};
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE;
if (!URL || !KEY) { console.error('❌ .env 에 SUPABASE_URL / SUPABASE_SERVICE_ROLE 필요'); process.exit(1); }

// --- index.html 에서 CATS/CASES/CLUSTERS 블록만 추출해서 평가 ---
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
function grab(name, open, close) {
  const start = html.indexOf(`const ${name} = ${open}`);
  if (start < 0) throw new Error(`${name} 못 찾음`);
  // 괄호 균형을 세어 정확한 끝을 찾음
  let i = html.indexOf(open, start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === open) depth++;
    else if (html[i] === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(html.indexOf(open, start), i);
}
const catsSrc     = grab('CATS', '{', '}');
const casesSrc    = grab('CASES', '[', ']');
const clustersSrc = grab('CLUSTERS', '[', ']');
const { CASES, CLUSTERS } = new Function(
  `const CATS=${catsSrc}; const CASES=${casesSrc}; const CLUSTERS=${clustersSrc}; return {CASES,CLUSTERS};`
)();

console.log(`📄 index.html 에서 추출: 클러스터 ${CLUSTERS.length}개, 사례 ${CASES.length}개`);

// --- DB 컬럼으로 매핑 ---
const clusterRows = CLUSTERS.map(c => ({
  id: c.id, name: c.name, summary: c.code || null,
}));
const caseRows = CASES.map(c => ({
  id: c.id,
  cluster: c.cluster || null,
  cat: c.cat || null,
  sev: c.sev ?? null,
  evidence: c.evidence || null,
  region: c.region || null,
  cap: c.cap || null,
  fw: c.fw || null,
  plat: c.plat || null,
  title: c.title || null,
  claims: c.claims || [],
  hyps: c.hyps || [],
  counter: c.counter || null,
  q: c.q || null,
  qsite: c.qsite || null,
  src: c.src || null,
  fw1b: !!c.fw1b,
  plat_wide: !!c.platWide,
  posts_count: c.posts ?? 0,
  last_seen: c.date || null,
  demo: true,   // 시드 데이터 표식
}));

// --- Supabase REST upsert 헬퍼 ---
async function upsert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table} 입고 실패 (${res.status}): ${await res.text()}`);
}

async function count(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?select=id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
  });
  return res.headers.get('content-range')?.split('/')[1] ?? '?';
}

// --- 실행 (clusters 먼저 → cases 순서, 외래키 때문) ---
await upsert('clusters', clusterRows);
console.log(`✅ clusters 입고 완료 → 현재 총 ${await count('clusters')}건`);
await upsert('cases', caseRows);
console.log(`✅ cases 입고 완료 → 현재 총 ${await count('cases')}건`);
console.log('🎉 Step 1-B 완료');

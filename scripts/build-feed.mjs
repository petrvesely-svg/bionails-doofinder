// Projde články na https://www.bio-nehty.cz (blog a Nehtová poradna)
// a vytvoří XML feed pro DooFinder v public/xml-doofinder.xml.
// Spouští se z GitHub Actions; nic se nepřihlašuje, čte jen veřejné stránky.
import { parse } from 'node-html-parser';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://www.bio-nehty.cz';
export const START_PATHS = ['/blog/', '/nehtova-poradna/'];
const EXCLUDED_PREFIXES = ['/bio-fotogalerie/'];
const MIN_BODY_CHARS = 50;
const CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'bionails-doofinder-feed/1.0 (+https://github.com/petrvesely-svg/bionails-doofinder)';

const decode = value => parse(`<i>${value ?? ''}</i>`).text;

export function internalPath(href) {
  if (!href) return null;
  try {
    const url = new URL(href, ORIGIN);
    if (url.hostname.replace(/^www\./, '') !== 'bio-nehty.cz') return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function cleanBody(text) {
  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(line => line && !/^[.\s·•-]+$/.test(line))
    .join('\n');
}

// Vrátí článek, nebo null, pokud stránka není detail článku.
export function parseArticle(html, path) {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const detail = root.querySelector('.news-item-detail');
  if (!detail) return null;
  const meta = selector => decode(root.querySelector(selector)?.getAttribute('content') ?? '');
  const text = detail.querySelector('.text');
  text?.querySelectorAll('script, style, noscript').forEach(node => node.remove());
  const crumbs = root.querySelectorAll('.breadcrumbs [itemprop="name"]')
    .map(node => (node.tagName === 'META' ? decode(node.getAttribute('content')) : node.text).trim())
    .filter(Boolean);
  return {
    url: ORIGIN + path,
    path,
    title: detail.querySelector('h1')?.text.trim() ?? '',
    description: meta('meta[name="description"]'),
    published: detail.querySelector('[itemprop="datePublished"]')?.getAttribute('content') ?? '',
    modified: detail.querySelector('[itemprop="dateModified"]')?.getAttribute('content') ?? '',
    image: detail.querySelector('[itemprop="image"] [itemprop="url"]')?.getAttribute('content') || meta('meta[property="og:image"]'),
    crumbs,
    body: cleanBody(text?.structuredText ?? ''),
  };
}

// Odkazy na podrubriky, články a další strany výpisu.
export function parseListing(html) {
  const root = parse(html);
  const content = root.querySelector('#content');
  if (!content) return [];
  return content.querySelectorAll('.subcategories a, .news-item a, .pagination a')
    .map(anchor => internalPath(anchor.getAttribute('href')))
    .filter(Boolean);
}

export function isIncluded(article) {
  return !EXCLUDED_PREFIXES.some(prefix => article.path.startsWith(prefix)) && article.body.length >= MIN_BODY_CHARS;
}

const xmlEscape = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildXml(articles, generatedAt = new Date()) {
  const items = [...articles]
    .sort((a, b) => b.published.localeCompare(a.published) || a.path.localeCompare(b.path))
    .map(article => `  <item>
    <id>${xmlEscape(article.path.replace(/^\/|\/$/g, ''))}</id>
    <title>${xmlEscape(article.title)}</title>
    <link>${xmlEscape(article.url)}</link>
    <description>${xmlEscape(article.description || article.body.slice(0, 300))}</description>
    <content>${xmlEscape(article.body)}</content>
    <image_link>${xmlEscape(article.image)}</image_link>
    <categories>${xmlEscape(article.crumbs.slice(1, -1).join(' > '))}</categories>
    <section>${xmlEscape(article.crumbs[1] ?? '')}</section>
    <type>clanek</type>
    <date_published>${xmlEscape(article.published)}</date_published>
    <date_modified>${xmlEscape(article.modified)}</date_modified>
  </item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>BIO NAILS – články (blog a Nehtová poradna)</title>
  <link>${ORIGIN}/</link>
  <description>Feed článků pro DooFinder, vygenerováno ${generatedAt.toISOString()}</description>
${items.join('\n')}
</channel>
</rss>
`;
}

async function fetchText(path, attempt = 1) {
  try {
    const response = await fetch(ORIGIN + path, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'cs' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return { status: 404 };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { status: response.status, html: await response.text() };
  } catch (error) {
    if (attempt >= 3) return { error: `${path}: ${error.message}` };
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    return fetchText(path, attempt + 1);
  }
}

export async function crawl(log = console.log) {
  const seen = new Set(START_PATHS);
  const queue = [...START_PATHS];
  const articles = [];
  const errors = [];
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(async path => {
      const result = await fetchText(path);
      if (result.error) { errors.push(result.error); return; }
      if (!result.html) return;
      const article = parseArticle(result.html, path);
      if (article) { articles.push(article); return; }
      for (const link of parseListing(result.html)) {
        if (!seen.has(link)) { seen.add(link); queue.push(link); }
      }
    }));
  }
  log(`Prošlo ${seen.size} stránek, nalezeno ${articles.length} článků, chyb ${errors.length}.`);
  return { pages: seen.size, articles, errors };
}

// Pojistka: neúplné procházení nesmí přepsat dobrý feed menším.
export function checkResult({ pages, errors, included, previousCount }) {
  const problems = [];
  if (included < 100) problems.push(`Příliš málo článků (${included}).`);
  if (errors.length > Math.max(3, pages * 0.02)) problems.push(`Příliš mnoho chyb při stahování (${errors.length}).`);
  if (previousCount && included < previousCount * 0.85) {
    problems.push(`Počet článků klesl z ${previousCount} na ${included} (víc než o 15 %).`);
  }
  return problems;
}

async function main() {
  const outFile = new URL('../public/xml-doofinder.xml', import.meta.url);
  let previousCount = 0;
  try { previousCount = ((await readFile(outFile, 'utf8')).match(/<item>/g) || []).length; } catch {}
  const { pages, articles, errors } = await crawl();
  const included = articles.filter(isIncluded);
  for (const error of errors) console.log(`Chyba: ${error}`);
  const problems = checkResult({ pages, errors, included: included.length, previousCount });
  if (problems.length) {
    for (const problem of problems) console.error(`STOP: ${problem}`);
    console.error('Feed nebyl přepsán, zůstává poslední dobrá verze.');
    process.exit(1);
  }
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(outFile, buildXml(included));
  const summary = `Feed: ${included.length} článků (předtím ${previousCount}), vynecháno ${articles.length - included.length}.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

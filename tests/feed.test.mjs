import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { parseArticle, parseListing, buildXml, isIncluded, checkResult, internalPath } from '../scripts/build-feed.mjs';

const articleHtml = `<!doctype html><html><head>
<meta property="og:image" content="https://www.bio-nehty.cz/user/articles/images/og.jpg">
<meta name="description" content="Jak aplikovat změkčovač &amp; co dělat se ztvrdlou kůží?">
</head><body>
<div class="breadcrumbs" itemscope itemtype="https://schema.org/BreadcrumbList">
 <span itemprop="itemListElement"><a href="/"><span class="sr-only" itemprop="name">Domů</span></a></span>
 <span itemprop="itemListElement"><a href="/nehtova-poradna/"><span itemprop="name">NEHTOVÁ PORADNA</span></a></span>
 <span itemprop="itemListElement"><a href="/dotazy/"><span itemprop="name">ČASTO KLADANÉ OTÁZKY</span></a></span>
 <span itemprop="itemListElement"><span itemprop="name">Jak aplikovat změkčovač kůžičky?</span></span>
</div>
<main id="content"><div class="news-item-detail" itemscope itemtype="https://schema.org/NewsArticle">
 <meta itemprop="datePublished" content="2021-01-10T21:16:14+0100">
 <meta itemprop="dateModified" content="2026-11-23T10:49:12+0100">
 <span itemprop="image"><meta itemprop="url" content="https://www.bio-nehty.cz/user/articles/images/logo.jpg"></span>
 <h1 itemprop="headline">Jak aplikovat změkčovač kůžičky?</h1>
 <div class="text"><p>Dotaz Tereza</p><p>Dobrý&nbsp;den, chtěla bych se poradit, jak aplikovat gel na změkčení kůžičky.</p>
 <style>.x{color:red}</style><script>alert(1)</script><p>.</p><p>Odpověď Eva <b>tučně</b> &lt;tag&gt;</p></div>
</div></main></body></html>`;

const listingHtml = `<html><body><nav><a href="/kosik/">košík</a></nav><main id="content">
<div class="subcategories"><a href="/plisen-nehtu/">Plíseň</a></div>
<div class="news-item"><a href="/plisen-nehtu/jak-poznat-plisen-nehtu/">x</a></div>
<div class="pagination"><a href="/plisen-nehtu/strana-2/">2</a><a href="https://example.com/x/">ext</a></div>
</main></body></html>`;

test('parseArticle reads title, meta, dates, image, breadcrumbs and clean body', () => {
  const article = parseArticle(articleHtml, '/nehtova-kuzicka/zmekcovac-kuzicky/');
  assert.equal(article.title, 'Jak aplikovat změkčovač kůžičky?');
  assert.equal(article.description, 'Jak aplikovat změkčovač & co dělat se ztvrdlou kůží?');
  assert.equal(article.published, '2021-01-10T21:16:14+0100');
  assert.equal(article.image, 'https://www.bio-nehty.cz/user/articles/images/logo.jpg');
  assert.deepEqual(article.crumbs, ['Domů', 'NEHTOVÁ PORADNA', 'ČASTO KLADANÉ OTÁZKY', 'Jak aplikovat změkčovač kůžičky?']);
  assert.match(article.body, /^Dotaz Tereza\nDobrý den, chtěla/);
  assert.doesNotMatch(article.body, /alert|color:red|^\.$/m);
  assert.match(article.body, /Odpověď Eva tučně <tag>/);
  assert.equal(article.url, 'https://www.bio-nehty.cz/nehtova-kuzicka/zmekcovac-kuzicky/');
});

test('parseArticle returns null for listing pages', () => {
  assert.equal(parseArticle(listingHtml, '/plisen-nehtu/'), null);
});

test('parseListing follows only internal links inside #content', () => {
  assert.deepEqual(parseListing(listingHtml), ['/plisen-nehtu/', '/plisen-nehtu/jak-poznat-plisen-nehtu/', '/plisen-nehtu/strana-2/']);
  assert.equal(internalPath('https://bio-nehty.cz/blog/'), '/blog/');
  assert.equal(internalPath('https://example.com/blog/'), null);
});

test('buildXml produces valid, escaped feed in DooFinder shape', () => {
  const article = parseArticle(articleHtml, '/nehtova-kuzicka/zmekcovac-kuzicky/');
  const xml = buildXml([article], new Date('2026-11-23T12:00:00Z'));
  const doc = parse(xml, { lowerCaseTagName: false });
  const items = doc.querySelectorAll('item');
  assert.equal(items.length, 1);
  assert.equal(items[0].querySelector('id').text, 'nehtova-kuzicka/zmekcovac-kuzicky');
  assert.equal(items[0].querySelector('categories').text, 'NEHTOVÁ PORADNA > ČASTO KLADANÉ OTÁZKY');
  assert.match(xml, /<categories>NEHTOVÁ PORADNA &gt; ČASTO KLADANÉ OTÁZKY<\/categories>/);
  assert.equal(items[0].querySelector('section').text, 'NEHTOVÁ PORADNA');
  assert.match(xml, /<description>Jak aplikovat změkčovač &amp; co dělat/);
  assert.match(xml, /&lt;tag&gt;/);
  assert.doesNotMatch(xml, /<tag>/);
  assert.match(xml, /vygenerováno 2026-11-23T12:00:00.000Z/);
});

test('isIncluded drops photo galleries and pages without text', () => {
  const base = parseArticle(articleHtml, '/x/y/');
  assert.equal(isIncluded(base), true);
  assert.equal(isIncluded({ ...base, path: '/bio-fotogalerie/akce/' }), false);
  assert.equal(isIncluded({ ...base, body: 'krátké' }), false);
});

test('checkResult blocks a partial crawl from overwriting a good feed', () => {
  assert.deepEqual(checkResult({ pages: 588, errors: [], included: 454, previousCount: 454 }), []);
  assert.equal(checkResult({ pages: 588, errors: [], included: 300, previousCount: 454 }).length, 1);
  assert.equal(checkResult({ pages: 588, errors: Array(20).fill('x'), included: 454, previousCount: 454 }).length, 1);
  assert.equal(checkResult({ pages: 2, errors: [], included: 0, previousCount: 0 }).length, 1);
});

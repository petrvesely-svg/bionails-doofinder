# BIO NAILS – automatický feed článků pro DooFinder

Každou noc projde veřejné články na https://www.bio-nehty.cz (blog a Nehtová poradna) a vystaví XML feed pro interní vyhledávání DooFinder.

**Adresa feedu pro DooFinder:** https://petrvesely-svg.github.io/bionails-doofinder/xml-doofinder.xml

## Jak to funguje

- GitHub Actions (`.github/workflows/feed.yml`) běží každý den v 01:17 UTC. V zimě je to 02:17 a v létě 03:17 pražského času.
- Ručně ho spustíte v záložce **Actions → Aktualizace feedu pro DooFinder → Run workflow**.
- Skript `scripts/build-feed.mjs` začne na `/blog/` a `/nehtova-poradna/` a prochází podrubriky, výpisy i stránkování.
  - Z každého článku vezme název, meta popis, plný text, obrázek, rubriky a data.
  - Vynechá Bio fotogalerii a stránky bez textu.
- Nic se nepřihlašuje do Shoptetu a žádná hesla ani tokeny nejsou potřeba. Čtou se jen veřejné stránky.
- Feed se uloží do `public/xml-doofinder.xml`, commitne se a vystaví přes GitHub Pages. Díky dennímu commitu GitHub plánované spouštění nevypne.

## Pojistky

Když se procházení nepovede, workflow skončí chybou a feed se **nepřepíše**. Zůstane poslední dobrá verze a GitHub pošle e-mail o selhání. Chybou workflow skončí, když:

- najde méně než 100 článků,
- selže víc než 2 % stažení stránek,
- počet článků klesne o víc než 15 % proti předchozímu feedu.

Pokud článků ubylo záměrně (smazání rubriky), spusťte workflow znovu po kontrole. Případně dočasně smažte `public/xml-doofinder.xml`.

## Nastavení v DooFinderu

- Pro články použijte samostatný index, ne produktový.
- Zdroj dat: XML feed z adresy výše, se zpracováním jednou denně, ideálně po 04:00.
- Pole `content` (plný text článku) nastavte jako prohledávané. Ve výsledcích zobrazujte `title`, `description` a `image_link`, odkaz je v `link`.

## Struktura položky

`id`, `title`, `link`, `description` (meta popis), `content`, `image_link`, `categories` (cesta rubrikami oddělená ` > `), `section`, `type` (`clanek`), `date_published`, `date_modified`.

## Vývoj

```
npm ci
npm test
npm run build   # vyžaduje přístup na www.bio-nehty.cz
```

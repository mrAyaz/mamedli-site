// Static build: node build.mjs  →  dist/ (production) and preview/ (single-origin preview)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const read = (p) => readFileSync(join(SRC, p), 'utf8');
const profile = JSON.parse(read('profile.json'));
const LANGS = profile.languages.map((l) => l.code);
const i18n = Object.fromEntries(LANGS.map((c) => [c, JSON.parse(read(`i18n/${c}.json`))]));
const CSS = read('styles.css');
const APP = read('app.js');
const YEAR = new Date().getFullYear();
const SITE = profile.siteUrl.replace(/\/$/, '');

// ---------- consistency check: every language has the same keys ----------
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, p + k + '.') : [p + k]));
const base = keys(i18n.en).sort().join('|');
for (const c of LANGS) if (keys(i18n[c]).sort().join('|') !== base) throw new Error(`i18n/${c}.json keys differ from en.json`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- icons (one stroke style, 24px grid) ----------
const I = {
  sun: '<path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="M12 20V6M6 11l6-6 6 6"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  uav: '<circle cx="5.5" cy="5.5" r="3"/><circle cx="18.5" cy="5.5" r="3"/><circle cx="5.5" cy="18.5" r="3"/><circle cx="18.5" cy="18.5" r="3"/><path d="M7.8 7.8l2.4 2.4M16.2 7.8l-2.4 2.4M7.8 16.2l2.4-2.4M16.2 16.2l-2.4-2.4"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v3M12 2.5v3M15 2.5v3M9 18.5v3M12 18.5v3M15 18.5v3M2.5 9h3M2.5 12h3M2.5 15h3M18.5 9h3M18.5 12h3M18.5 15h3"/>',
  cube: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>',
  lead: '<circle cx="12" cy="7" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17.5 4.5l2 2M19.5 4.5l-2 2" />',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  swarm: '<circle cx="12" cy="4" r="1.6"/><circle cx="5" cy="9" r="1.6"/><circle cx="19" cy="9" r="1.6"/><circle cx="7.5" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/><circle cx="12" cy="11.5" r="1.6"/><path d="M12 5.6v4.3M6.5 9.6l4 1.4M17.5 9.6l-4 1.4M8.6 15.8l2.4-3M15.4 15.8l-2.4-3" opacity=".5"/>'
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name]}</svg>`;

// ---------- hero drawing: flight-controller board (36 mm, 30.5 mm mounting) with traces and a quad outline ----------
const traces = [
  'M262 240 V214 L242 194 V122 L214 94 H58',
  'M300 240 V206 L322 184 V58',
  'M281 240 V120 L262 101 V40',
  'M320 262 H352 L382 232 H468 L500 200',
  'M320 298 H402 L432 328 H522',
  'M270 320 V382 L242 410 V512',
  'M300 320 V362 L330 392 H420 L458 430',
  'M240 280 H160 L130 250 H44',
  'M240 302 H202 L172 332 V470 L140 502'
];
const ends = [[58, 94], [322, 58], [262, 40], [500, 200], [522, 328], [242, 512], [458, 430], [44, 250], [140, 502]];
function heroSvg() {
  const holes = [[204, 204], [356, 204], [204, 356], [356, 356]];
  const pins = [];
  for (let k = 0; k < 6; k++) {
    const o = 250 + k * 12;
    pins.push(`M${o} 240 v-6`, `M${o} 320 v6`, `M240 ${o} h-6`, `M320 ${o} h6`);
  }
  return `<svg viewBox="0 0 560 560" aria-hidden="true" focusable="false">
  <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="hv-grid" fill="currentColor" style="color:var(--line-strong)"/></pattern></defs>
  <rect width="560" height="560" fill="url(#dots)" opacity=".7"/>
  <g class="hv-uav" stroke-width="1.5">
    <path d="M150 132 L268 250 M132 150 L250 268 M410 132 L292 250 M428 150 L310 268 M150 428 L268 310 M132 410 L250 292 M410 428 L292 310 M428 410 L310 292"/>
    <circle cx="120" cy="120" r="84" stroke-dasharray="3 7"/><circle cx="440" cy="120" r="84" stroke-dasharray="3 7"/>
    <circle cx="120" cy="440" r="84" stroke-dasharray="3 7"/><circle cx="440" cy="440" r="84" stroke-dasharray="3 7"/>
    <circle cx="120" cy="120" r="18"/><circle cx="440" cy="120" r="18"/><circle cx="120" cy="440" r="18"/><circle cx="440" cy="440" r="18"/>
  </g>
  <rect class="hv-board" x="190" y="190" width="180" height="180" rx="18" stroke-width="1.5"/>
  ${holes.map(([x, y]) => `<circle class="hv-hole" cx="${x}" cy="${y}" r="8" stroke-width="1.5"/>`).join('')}
  <g stroke-width="2">${traces.map((d) => `<path class="hv-trace" pathLength="1" d="${d}"/>`).join('')}</g>
  ${ends.map(([x, y]) => `<circle class="hv-pad" cx="${x}" cy="${y}" r="4.5"/>`).join('')}
  <path class="hv-pin" stroke-width="2" d="${pins.join(' ')}"/>
  <rect class="hv-chip" x="240" y="240" width="80" height="80" rx="8"/>
  <text class="hv-chip-label" x="280" y="284" text-anchor="middle">MCU</text>
  <text class="hv-label" x="376" y="224">UART</text>
  <text class="hv-label" x="376" y="318">CAN</text>
  <text class="hv-label" x="150" y="272">I²C</text>
  <text class="hv-label" x="206" y="392">PWM 1–8</text>
</svg>`;
}
// pathLength="1" lets the draw-in animation use a dash of 1 for every trace
const traceCss = '.js .hv-trace{stroke-dasharray:1;stroke-dashoffset:1}';

// ---------- page ----------
function page(lang, mode) {
  const d = i18n[lang];
  const L = profile.languages.find((l) => l.code === lang);
  const href = (c) => (mode === 'prod' ? `/${c}/` : c === 'en' ? 'index.html' : `${c}.html`);
  const url = (c) => `${SITE}/${c}/`;
  const navIds = ['about', 'skills', 'experience', 'directions', 'education', 'contact'];
  const navLinks = navIds.map((id) => `<li><a href="#${id}">${esc(d.nav[id])}</a></li>`).join('');
  const period = (a, b) => `${a} — ${b == null ? esc(d.experience.present) : b}`;

  const ui = {
    toDark: d.ui.toDark, toLight: d.ui.toLight, openMenu: d.ui.openMenu, closeMenu: d.ui.closeMenu,
    copied: d.contact.copied, copyFail: d.contact.copyFail
  };

  const person = {
    '@context': 'https://schema.org', '@type': 'Person',
    name: profile.name, jobTitle: d.hero.role, email: `mailto:${profile.email}`, url: url(lang),
    address: { '@type': 'PostalAddress', addressLocality: 'Baku', addressCountry: 'AZ' },
    alumniOf: [{ '@type': 'CollegeOrUniversity', name: 'Moscow State Technical University' }, { '@type': 'CollegeOrUniversity', name: 'National Academy of Aviation' }],
    knowsAbout: ['Unmanned aerial vehicles', 'ArduPilot', 'Flight controllers', 'C++', 'Python', 'Qt', 'Altium Designer', 'SolidWorks']
  };

  const headProd = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(d.meta.title)}</title>
<meta name="description" content="${esc(d.meta.description)}">
<link rel="canonical" href="${url(lang)}">
${LANGS.map((c) => `<link rel="alternate" hreflang="${c}" href="${url(c)}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${esc(profile.name)}">
<meta property="og:title" content="${esc(d.meta.title)}">
<meta property="og:description" content="${esc(d.meta.description)}">
<meta property="og:url" content="${url(lang)}">
<meta property="og:locale" content="${L.ogLocale}">
${profile.languages.filter((l) => l.code !== lang).map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`).join('\n')}
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F5F5F7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0B0F">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON.stringify(person)}</script>`;

  const bootScript = `<script>(function(){var d=document.documentElement;d.classList.add('js');${mode === 'preview-fragment' ? `d.lang='${lang}';` : ''}try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t)}catch(e){}})();</script>`;
  const style = `<style>${CSS}\n${traceCss}</style>`;

  const cvBtn = profile.cv
    ? `<a class="btn btn-ghost intro d4" href="/${esc(profile.cv)}" download>${icon('down')}${esc(d.hero.cv)} <small>${esc(d.hero.cvNote)}</small></a>`
    : '';

  const body = `<a class="skip" href="#main">${esc(d.ui.skip)}</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="#top" aria-label="${esc(d.ui.home)}"><span class="mono" aria-hidden="true">${esc(profile.monogram)}</span><span class="brand-name">${esc(profile.name)}</span></a>
    <nav class="nav-desktop" aria-label="${esc(d.ui.menu)}"><ul>${navLinks}</ul></nav>
    <div class="controls">
      <div class="lang">
        <button id="lang-btn" class="icon-btn" type="button" aria-expanded="false" aria-controls="lang-menu" aria-label="${esc(d.ui.language)}: ${esc(L.name)}">${icon('globe')}<span aria-hidden="true">${lang.toUpperCase()}</span></button>
        <ul id="lang-menu" class="popover" hidden>
          ${profile.languages.map((l) => `<li><a href="${href(l.code)}" data-lang="${l.code}" hreflang="${l.code}" lang="${l.code}"${l.code === lang ? ' aria-current="true"' : ''}><span>${esc(l.name)}</span><span class="code" aria-hidden="true">${l.code.toUpperCase()}</span></a></li>`).join('')}
        </ul>
      </div>
      <button id="theme-toggle" class="icon-btn theme-btn" type="button" aria-pressed="false" aria-label="${esc(d.ui.toDark)}">${icon('sun', 'i-sun')}${icon('moon', 'i-moon')}</button>
      <button id="menu-btn" class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="mobile-nav" aria-label="${esc(d.ui.openMenu)}">${icon('menu')}</button>
    </div>
  </div>
</header>
<nav id="mobile-nav" class="mobile-nav" aria-label="${esc(d.ui.menu)}" hidden><div class="wrap"><ul>${navLinks}</ul></div></nav>

<main id="main" tabindex="-1">
  <section class="hero" id="top" aria-labelledby="hero-title">
    <div class="wrap hero-grid">
      <div class="hero-text">
        <p class="role intro">${esc(d.hero.role)}</p>
        <h1 id="hero-title" class="intro d1">${esc(profile.name)}</h1>
        <p class="lead intro d2">${esc(d.hero.lead)}</p>
        <p class="loc intro d2">${icon('pin')}${esc(d.hero.location)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary intro d3" href="#contact">${esc(d.hero.cta)}</a>
          ${cvBtn}
        </div>
      </div>
      <div class="hero-visual">${heroSvg()}</div>
    </div>
  </section>

  <section class="section band" id="about" aria-labelledby="about-title">
    <div class="wrap">
      <p class="kicker">${esc(d.about.kicker)}</p>
      <h2 id="about-title" class="reveal">${esc(d.about.title)}</h2>
      <div class="about-grid">
        <div class="about-text reveal">${d.about.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        <ul class="facts" role="list" style="list-style:none;margin:0;padding:0">
          ${d.about.facts.map((f) => `<li class="card fact reveal"><span class="v">${esc(f.value)}</span><span class="l">${esc(f.label)}</span></li>`).join('')}
        </ul>
      </div>
    </div>
  </section>

  <section class="section" id="skills" aria-labelledby="skills-title">
    <div class="wrap">
      <p class="kicker">${esc(d.skills.kicker)}</p>
      <h2 id="skills-title" class="reveal">${esc(d.skills.title)}</h2>
      <div class="skills-grid">
        ${d.skills.groups.map((g) => `<article class="card skill reveal">${icon(g.icon, 'ico')}<h3>${esc(g.title)}</h3><p class="note">${esc(g.note)}</p><ul class="chips">${g.items.map((it) => `<li>${esc(it)}</li>`).join('')}</ul></article>`).join('')}
      </div>
    </div>
  </section>

  <section class="section band" id="experience" aria-labelledby="exp-title">
    <div class="wrap">
      <p class="kicker">${esc(d.experience.kicker)}</p>
      <h2 id="exp-title" class="reveal">${esc(d.experience.title)}</h2>
      <ol class="timeline">
        ${profile.experience.map((x) => `<li class="tl-item reveal${x.to == null ? ' current' : ''}"><div class="tl-card"><div><h3>${esc(d.experience.roles[x.role])}</h3><p class="tl-org">${esc(x.org || d.experience.orgs[x.orgKey])}</p></div><p class="tl-period">${period(x.from, x.to)}</p></div></li>`).join('')}
      </ol>
    </div>
  </section>

  <section class="section" id="directions" aria-labelledby="dir-title">
    <div class="wrap">
      <p class="kicker">${esc(d.directions.kicker)}</p>
      <h2 id="dir-title" class="reveal">${esc(d.directions.title)}</h2>
      <p class="lead-2 reveal">${esc(d.directions.lead)}</p>
      <div class="dir-grid">
        ${d.directions.cards.map((c) => `<article class="card dir reveal"><div class="art">${icon(c.icon)}</div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><ul class="tags">${c.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></article>`).join('')}
      </div>
    </div>
  </section>

  <section class="section band" id="education" aria-labelledby="edu-title">
    <div class="wrap">
      <p class="kicker">${esc(d.education.kicker)}</p>
      <h2 id="edu-title" class="reveal">${esc(d.education.title)}</h2>
      <div class="edu-list">
        ${profile.education.map((e) => `<article class="card edu reveal"><p class="yr">${e.from} — ${e.to}</p><h3>${esc(d.education.items[e.key].degree)}</h3><p>${esc(d.education.items[e.key].school)}</p></article>`).join('')}
      </div>
    </div>
  </section>

  <section class="section contact" id="contact" aria-labelledby="contact-title">
    <div class="wrap">
      <p class="kicker">${esc(d.contact.kicker)}</p>
      <h2 id="contact-title" class="reveal">${esc(d.contact.title)}</h2>
      <p class="lead-2 reveal">${esc(d.contact.lead)}</p>
      <a class="mail reveal" id="email" href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>
      <div class="contact-actions reveal">
        <a class="btn btn-primary" href="mailto:${esc(profile.email)}">${icon('mail')}${esc(d.contact.write)}</a>
        <button class="btn btn-ghost" id="copy-email" type="button" hidden>${icon('copy')}${esc(d.contact.copy)}</button>
      </div>
      <p class="status" id="copy-status" role="status" aria-live="polite"></p>
      <p class="contact-meta">${icon('pin')}<span><span class="visually-hidden">${esc(d.contact.locationLabel)}: </span>${esc(d.contact.location)}</span></p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap footer-row">
    <span>© ${YEAR} ${esc(profile.name)}. ${esc(d.ui.rights)}</span>
    <a class="to-top" href="#top">${icon('up')}${esc(d.ui.backToTop)}</a>
  </div>
</footer>
<script>window.__UI__=${JSON.stringify(ui)};</script>
<script>${APP}</script>`;

  if (mode === 'prod') {
    return `<!doctype html>\n<html lang="${lang}">\n<head>\n${headProd}\n${bootScript}\n${style}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  }
  const headPreview = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${esc(profile.name)}</title>\n<meta name="description" content="${esc(d.meta.description)}">`;
  if (mode === 'preview-fragment') {
    return `<title>${esc(profile.name)}</title>\n<meta name="description" content="${esc(d.meta.description)}">\n${bootScript}\n${style}\n${body}\n`;
  }
  return `<!doctype html>\n<html lang="${lang}">\n<head>\n${headPreview}\n${bootScript}\n${style}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// ---------- root redirect (/): always the default language (English) ----------
function rootPage() {
  const names = profile.languages.map((l) => `<li><a href="/${l.code}/" hreflang="${l.code}" lang="${l.code}">${esc(l.name)}</a></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(profile.name)}</title>
<meta name="description" content="${esc(i18n.en.meta.description)}">
<link rel="canonical" href="${SITE}/">
${LANGS.map((c) => `<link rel="alternate" hreflang="${c}" href="${SITE}/${c}/">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>location.replace('/${profile.defaultLanguage}/'+location.hash)</script>
<noscript><meta http-equiv="refresh" content="0; url=/${profile.defaultLanguage}/"></noscript>
<style>body{margin:0;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;min-height:100vh;padding:16px}@media(prefers-color-scheme:dark){body{background:#0B0B0F;color:#F5F5F7}a{color:#5AA9FF}}a{color:#0066CC}ul{list-style:none;padding:0;display:flex;gap:16px;flex-wrap:wrap;justify-content:center}</style>
</head>
<body><main><h1 style="font-size:28px;text-align:center">${esc(profile.name)}</h1><ul>${names}</ul></main></body>
</html>
`;
}

function sitemap() {
  const alt = LANGS.map((c) => `    <xhtml:link rel="alternate" hreflang="${c}" href="${SITE}/${c}/"/>`).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LANGS.map((c) => `  <url>\n    <loc>${SITE}/${c}/</loc>\n${alt}\n  </url>`).join('\n')}
</urlset>
`;
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>rect{fill:#1D1D1F}text{fill:#F5F5F7}@media(prefers-color-scheme:dark){rect{fill:#F5F5F7}text{fill:#0B0B0F}}</style><rect width="64" height="64" rx="16"/><text x="32" y="41" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="-.5">AM</text></svg>`;

// ---------- write ----------
const DIST = join(ROOT, 'dist');
const PREV = join(ROOT, 'preview');
for (const dir of [DIST, PREV]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
for (const c of LANGS) {
  mkdirSync(join(DIST, c), { recursive: true });
  writeFileSync(join(DIST, c, 'index.html'), page(c, 'prod'));
  writeFileSync(join(PREV, c === 'en' ? 'index.html' : `${c}.html`), page(c, c === 'en' ? 'preview-fragment' : 'preview'));
}
writeFileSync(join(DIST, 'index.html'), rootPage());
writeFileSync(join(DIST, 'sitemap.xml'), sitemap());
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'favicon.svg'), favicon);
writeFileSync(join(DIST, 'CNAME'), new URL(SITE).hostname + '\n');
writeFileSync(join(DIST, '.nojekyll'), '');
for (const f of ['og.png', 'apple-touch-icon.png']) if (existsSync(join(SRC, 'assets', f))) copyFileSync(join(SRC, 'assets', f), join(DIST, f));
if (profile.cv) {
  const src = join(SRC, 'assets', profile.cv);
  if (!existsSync(src)) throw new Error(`CV file not found: src/assets/${profile.cv}`);
  mkdirSync(dirname(join(DIST, profile.cv)), { recursive: true });
  copyFileSync(src, join(DIST, profile.cv));
}
console.log(`Built ${LANGS.length} languages → dist/ and preview/`);

# mamedli.com — personal landing page

A static site in four languages (`/en/`, `/ru/`, `/az/`, `/tr/`) with light and dark themes. Every page is fully rendered in HTML, so the text is indexed without JavaScript. The site has no dependencies — all you need is Node.js 18+.

## Structure

```
src/profile.json      facts that don't depend on language: name, email, jobs, education, CV file
src/i18n/*.json       texts in 4 languages (same keys; the build stops if they differ)
src/styles.css        design tokens and styles
src/app.js            theme, menus, entry animations, copy email
src/assets/           og.png, apple-touch-icon.png, PDF resume (when added)
build.mjs             build script
dist/                 ready-to-publish site (the GitHub Pages / any hosting root)
```

## Build

```
node build.mjs
```

## How to update content

- **Text** — edit `src/i18n/<language>.json` and rebuild.
- **Job / education entry** — add it to `src/profile.json` (`experience` / `education`). For a new role, add its title to `experience.roles` in all four translation files.
- **"Download CV" button** — place the PDF in `src/assets/cv/`, then set `"cv": "cv/Ayaz_Mammadli_CV.pdf"` in `profile.json` and specify the file's language in `cvLanguage` / `hero.cvNote`. While `cv` is `null`, the button is not shown.
- **Phone** — not published (see section 14.7 of the spec).

## Publishing on mamedli.com (GitHub Pages)

1. Create a repository and upload the **contents** of `dist/` to it (`CNAME` and `.nojekyll` are already included).
2. Go to Settings → Pages → Deploy from branch → `main` / root. In Custom domain, enter `mamedli.com`.
3. In Squarespace → Domains → mamedli.com → DNS, add:
   - `A @ 185.199.108.153`, `A @ 185.199.109.153`, `A @ 185.199.110.153`, `A @ 185.199.111.153`
   - `CNAME www <login>.github.io`
4. Once the certificate is issued, enable Enforce HTTPS.

## What's implemented from the spec

- Sections: header → first screen → about → competencies → experience → development areas → education → contacts → footer. There is no certificates section, since it isn't in the CV.
- Theme:
  - follows the system on first visit;
  - a manual choice is saved in `localStorage` and applied in `<head>` before the page renders, so there's no flash;
  - changes to the system theme are picked up until you choose manually;
  - the transition takes 250 ms.
- Languages:
  - separate URLs, with `hreflang` and `x-default`;
  - the root `/` always opens English (`/en/`); other languages are chosen from the menu;
  - switching languages keeps both the current section and the theme;
  - language names are shown as text.
- Mobile menu: closes after you pick an item, on Escape, or on a click outside it; focus returns to the menu button.
- Anchors account for the fixed header.
- Animations:
  - the first screen appears in sequence in ≤ 900 ms, and the board's traces are "drawn in";
  - sections appear once as you scroll to them;
  - light parallax, desktop only;
  - with `prefers-reduced-motion` all movement is off;
  - without JS all content stays visible.
- SEO:
  - `title`, `description`, canonical and Open Graph for each language;
  - Person structured data;
  - `sitemap.xml` with language alternates;
  - `robots.txt`, favicon, apple-touch-icon.

## Checks run

A headless Chromium build was checked in all four languages × both themes × widths of 320 / 390 / 768 / 1024 / 1440 px:

- no horizontal scrolling;
- no JavaScript errors;
- the mobile menu opens, closes on Escape and returns focus;
- the chosen theme persists after a reload;
- `/` redirects to the right language.

Still to do after publishing: Lighthouse on the live domain and manual testing in Safari on iOS and Chrome on Android.

## To confirm before release (spec section 14.8)

- **Experience figures.** CV1 says 8 years of experience, CV2 says 14+. The site shows no experience count.
- **UAV experience.** CV1 says 5 years, CV2 says 10. The site doesn't state a number of years.
- **Jobs.** The site uses CV2: SS Smart and RD Smart. CV1 lists IntelPro LLC for 2019–current.
- **Current role.** "SS Smart — present" needs confirming.
- **Employer name spelling.** CV1 has "Idrak Teknoloji Transfer", CV2 has "Idrak Teknology Transfer". The site uses the CV2 spelling.
- **University name.** CV1 has "Moscow Technology University", CV2 has "Moscow State Technical University". The site uses the CV2 name.
- **PX4 and Lua.** These appear only in CV1, so they're not on the site.
- **Drone shows.** Taken from CV1; this area still needs confirming.
- **Defense projects.** Not published; how much to disclose is the owner's call.
- **Portrait, project images, PDF resume, profile links.** Not yet provided.

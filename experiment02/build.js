#!/usr/bin/env node
/*
 * Builds the Richmond Family Medicine site into dist/.
 *
 *   npm install       once
 *   npm run build     build the site
 *   npm run watch     build, then rebuild every time a file in content/ or theme/ is saved
 *
 * Everything to edit is in content/ (see README.md):
 *   content/practice.yml        phone, hours, address, menus: shown on every page
 *   content/home/home.md        the home page
 *   content/<folder>/<page>.md  every other page; the file name is its web address
 *   content/clinicians/*.md     one doctor or nurse practitioner each
 *
 * Links and photos in a page are written relative to that page's file, so a page in
 * content/who-we-are/ shows images/staff.jpg from content/who-we-are/images/. Files keep
 * their place in the built site (dist/who-we-are/images/staff.jpg). The look is in theme/.
 *
 * Needs Node 18 or newer.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { Marked } = require("marked");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");
const THEME = path.join(ROOT, "theme");
const DIST = path.join(ROOT, "dist");

// Folders in content/ that aren't lists of pages.
const SPECIAL = ["home", "clinicians", "site-images"];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isExternal = (u) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const rel = (file) => path.relative(ROOT, file);

function build() {
  let warnings = 0;
  const warn = (msg) => {
    warnings++;
    console.warn(`  ! ${msg}`);
  };

  // ---------- Reading content ----------

  function readYaml(file) {
    try {
      return YAML.parse(fs.readFileSync(file, "utf8")) || {};
    } catch (err) {
      throw new Error(`${rel(file)}: can't read it. ${err.message}`);
    }
  }

  function readPage(file) {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const m = text.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
    if (!m) throw new Error(`${rel(file)}: the top of the file needs a --- header (copy one from another page)`);
    let meta;
    try {
      meta = YAML.parse(m[1]) || {};
    } catch (err) {
      throw new Error(`${rel(file)}: can't read the header at the top. ${err.message}`);
    }
    return { ...meta, slug: path.basename(file, ".md"), dir: path.dirname(file), file, body: m[2].trim() };
  }

  // Hours and menus can be written either way: `- days: Saturday` + `time: …`, or `- Saturday: …`.
  const pairs = (list, a, b) => (list || []).map((item) => (a in item ? [item[a], item[b]] : Object.entries(item)[0]));
  const practice = readYaml(path.join(CONTENT, "practice.yml"));
  const hours = pairs(practice.hours, "days", "time").map(([days, time]) => ({ days, time: String(time) }));
  const menus = pairs(practice.menus, "label", "folder").map(([label, folder]) => ({ label, folder }));
  const home = readPage(path.join(CONTENT, "home", "home.md"));

  const folders = fs
    .readdirSync(CONTENT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SPECIAL.includes(d.name))
    .map((d) => d.name);
  const pages = folders.flatMap((folder) =>
    fs
      .readdirSync(path.join(CONTENT, folder))
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ ...readPage(path.join(CONTENT, folder, f)), folder }))
  );
  for (const p of pages) if (!p.title) throw new Error(`${rel(p.file)}: needs a title: line at the top`);

  const TYPES = { physician: "Physicians", "nurse practitioner": "Nurse Practitioners", consultant: "Consultants" };
  const clinicians = fs
    .readdirSync(path.join(CONTENT, "clinicians"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const c = { ...readPage(path.join(CONTENT, "clinicians", f)), folder: "clinicians" };
      if (!c.name) throw new Error(`${rel(c.file)}: needs a name: line at the top`);
      if (!TYPES[c.type]) throw new Error(`${rel(c.file)}: type: must be ${Object.keys(TYPES).join(", or ")}`);
      c.title = c.credentials ? `${c.name}, ${c.credentials}` : c.name;
      c.summary = c.summary || `${c.title}, ${c.role || c.type} at ${practice.name}.`;
      return c;
    });

  const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.title).localeCompare(b.title);
  pages.sort(byOrder);
  clinicians.sort(byOrder);

  const routes = new Map();
  for (const p of [...pages, ...clinicians]) {
    if (routes.has(p.slug)) throw new Error(`${rel(p.file)}: ${rel(routes.get(p.slug).file)} already uses the address ${p.slug}/. Rename one of them.`);
    if (fs.existsSync(path.join(CONTENT, p.slug)) || p.slug === "theme") throw new Error(`${rel(p.file)}: a page can't share its name with a folder`);
    routes.set(p.slug, p);
  }
  const inFolder = (folder) => pages.filter((p) => p.folder === folder);
  const menuOf = (p) => menus.find((m) => m.folder === p.folder);
  const label = (p) => p["menu-title"] || p.title;

  // ---------- Links ----------
  // Site paths have no leading slash ("forms-online/", "who-we-are/images/staff.jpg");
  // each page's links are made relative at the end, so the site works from any folder.

  // A link written in a page: another page's file name, or a file relative to the page.
  function resolve(href, dir, from) {
    href = String(href || "").trim();
    if (!href || isExternal(href) || href.startsWith("#")) return href;
    let [p, hash] = href.split("#");
    hash = hash ? `#${hash}` : "";
    try {
      p = decodeURI(p);
    } catch {}
    const bare = p.replace(/^\/+|\/+$/g, "").replace(/\.md$/, "");
    const slug = path.basename(bare);
    if (!path.extname(bare) && (routes.has(slug) || slug === "home" || bare === "")) return (slug === "home" || bare === "" ? "" : `${slug}/`) + hash;
    const file = path.resolve(p.startsWith("/") ? CONTENT : dir, p.replace(/^\/+/, ""));
    if (!file.startsWith(CONTENT + path.sep) || !fs.existsSync(file)) {
      warn(`${rel(from)}: "${href}" isn't a page or a file${path.extname(bare) ? ` (looked for ${rel(file)})` : ""}`);
      return href;
    }
    return path.relative(CONTENT, file).split(path.sep).map(encodeURIComponent).join("/") + hash;
  }

  function finishLinks(html, prefix) {
    return html.replace(/\b(href|src)="([^"]*)"/g, (m, attr, u) => {
      if (isExternal(u) || u.startsWith("#") || u.startsWith("data:")) return m;
      return `${attr}="${u === "" ? prefix || "./" : prefix + u}"`;
    });
  }

  // ---------- Images ----------

  function imageSize(sitePath) {
    try {
      const b = fs.readFileSync(path.join(CONTENT, decodeURIComponent(sitePath)));
      if (b.toString("ascii", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
      let i = 2;
      while (b[0] === 0xff && b[1] === 0xd8 && i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    } catch {}
    return null;
  }

  function img(src, alt, cls = "", eager = false) {
    const size = imageSize(src);
    return `<img src="${esc(src)}" alt="${esc(alt)}"${size ? ` width="${size.w}" height="${size.h}"` : ""}${cls ? ` class="${cls}"` : ""}${eager ? "" : ' loading="lazy"'}>`;
  }

  // A photo in a white snapshot frame, the way it'd be pinned to a corkboard.
  const snapshot = (src, alt, caption = "", cls = "") =>
    `<figure class="snapshot ${cls}">${img(src, alt)}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;

  // ---------- Icons ----------

  const ICONS = {
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    apple: '<path d="M12 20.9c1.5 0 2.8 1.1 4 1.1 3 0 6-8 6-12.2A4.9 4.9 0 0 0 17 5c-2.2 0-4 1.4-5 2-1-.6-2.8-2-5-2a4.9 4.9 0 0 0-5 4.8C2 14 5 22 8 22c1.3 0 2.5-1.1 4-1.1z"/><path d="M10 2c1 .5 2 2 2 5"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2z"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    thermometer: '<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
    bug: '<path d="m8 2 1.9 1.9M14.1 3.9 16 2M9 7.1v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M21 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  };
  const MAPLE = '<path d="M12 2l1.6 3.4 2.2-1-.6 3.6 3.3-1.6-1 2.6 2.5.6-3.3 3.2.7 1.6-4.4-.8.3 3.4h-.7v4h-1.2v-4h-.7l.3-3.4-4.4.8.7-1.6L4 9.6l2.5-.6-1-2.6 3.3 1.6-.6-3.6 2.2 1z"/>';
  function icon(name, cls = "icon") {
    if (name === "maple") return `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${MAPLE}</svg>`;
    if (!ICONS[name]) {
      if (name) warn(`there's no icon called "${name}". Choose from: maple, ${Object.keys(ICONS).join(", ")}`);
      name = "info";
    }
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  // Rolling Green Mountain ridgelines along the bottom edge of a band.
  const ridges = (cls = "") => `<svg class="ridges ${cls}" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
      <path class="ridge-back" d="M0 60C90 20 170 18 250 40S390 6 490 10S640 52 740 44S880 0 980 6S1120 50 1220 42S1370 14 1440 26V120H0Z"/>
      <path class="ridge-front" d="M0 92C90 62 170 56 270 72S430 40 540 46S700 90 800 84S950 46 1060 50S1210 88 1310 80S1410 66 1440 70V120H0Z"/>
    </svg>`;

  // ---------- Markdown ----------

  let context = { dir: CONTENT, file: CONTENT };
  const md = new Marked({
    gfm: true,
    renderer: {
      // `## Heading {#some-id}` sets the anchor; otherwise it comes from the text.
      heading({ tokens, depth, text }) {
        let inner = this.parser.parseInline(tokens);
        let id = slugify(text);
        const m = inner.match(/\s*\{#([\w-]+)\}\s*$/);
        if (m) {
          id = m[1];
          inner = inner.slice(0, m.index);
        }
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const url = resolve(href, context.dir, context.file);
        const text = this.parser.parseInline(tokens);
        const t = title ? ` title="${esc(title)}"` : "";
        if (/\.pdf(#|$)/i.test(url)) return `<a class="file-link" href="${esc(url)}"${t} target="_blank" rel="noopener">${icon("file")}<span>${text}</span></a>`;
        if (/^https?:/i.test(url)) return `<a href="${esc(url)}"${t} target="_blank" rel="noopener">${text}</a>`;
        return `<a href="${esc(url)}"${t}>${text}</a>`;
      },
      image({ href, title, text }) {
        return snapshot(resolve(href, context.dir, context.file), text, title || "");
      },
    },
  });

  // `{{ name }}` on a line of its own drops in one of these.
  const SHORTCODES = {
    clinicians: () =>
      ["physician", "nurse practitioner"].map((t) => `<h2>${TYPES[t]}</h2>${clinicianCards(clinicians.filter((c) => c.type === t))}`).join("") +
      `<p>We also have <a href="specialists/">psychiatric nurse practitioner consultants</a> right here in the office.</p>`,
    consultants: () => clinicianCards(clinicians.filter((c) => c.type === "consultant")),
    "health-topics": () => pageCards(inFolder("health-topics"), "card-grid card-grid-3"),
    services: () => pageCards(inFolder("medical-services")),
    hours: () => `${hoursList("hours hours-wide")}<p>${esc(practice["after-hours"])}</p>`,
    "portal-button": () => `<p><a class="button" href="${esc(practice["patient-portal"])}">${icon("lock")}Open the Patient Portal</a></p>`,
    "directions-button": () => `<p><a class="button" href="${esc(practice.map)}">${icon("pin")}Get directions</a></p>`,
    "call-button": () => `<p><a class="button" href="${tel}">${icon("phone")}Call ${esc(practice.phone)}</a></p>`,
  };

  function markdown(page) {
    context = page;
    let html;
    if (page.style === "cards") {
      // Each ### section becomes a card; cards in a row share a grid.
      const tokens = md.lexer(page.body);
      const chunks = [];
      for (const t of tokens) {
        const startsCard = t.type === "heading" && t.depth === 3;
        const endsCard = t.type === "heading" && t.depth < 3;
        const last = chunks[chunks.length - 1];
        if (startsCard) chunks.push({ card: true, tokens: [t] });
        else if (last && (last.card ? !endsCard : true)) last.tokens.push(t);
        else chunks.push({ card: false, tokens: [t] });
      }
      const parse = (list) => md.parser(Object.assign(list, { links: tokens.links }));
      html = "";
      for (let i = 0; i < chunks.length; i++) {
        if (!chunks[i].card) {
          html += parse(chunks[i].tokens);
          continue;
        }
        let grid = "";
        while (i < chunks.length && chunks[i].card) grid += `<section class="card">${parse(chunks[i++].tokens)}</section>`;
        i--;
        html += `<div class="card-grid">${grid}</div>`;
      }
    } else {
      html = md.parse(page.body || "");
    }
    // Photos on their own lines sit side by side instead of inside a paragraph.
    html = html.replace(/<p>((?:\s*<figure class="snapshot[\s\S]*?<\/figure>\s*)+)<\/p>/g, '<div class="snapshots">$1</div>');
    return html.replace(/<p>\{\{\s*([\w-]+)\s*\}\}<\/p>/g, (m, name) => {
      if (SHORTCODES[name]) return SHORTCODES[name]();
      warn(`${rel(page.file)}: there's no {{ ${name} }}. Choose from: ${Object.keys(SHORTCODES).join(", ")}`);
      return "";
    });
  }

  // ---------- Shared pieces ----------

  const tel = `tel:+1${String(practice.phone).replace(/\D/g, "")}`;
  const year = new Date().getFullYear();
  const photoOf = (page, field = "photo") => (page[field] ? resolve(page[field], page.dir, page.file) : "");

  function hoursList(cls = "hours") {
    return `<dl class="${cls}">${hours.map((h) => `<div><dt>${esc(h.days)}</dt><dd>${esc(h.time)}</dd></div>`).join("")}</dl>`;
  }

  function initials(name) {
    const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !/\.$/.test(w));
    return words.length > 1 ? words[0][0] + words[words.length - 1][0] : words.map((w) => w[0]).join("");
  }

  const portrait = (c, cls) => {
    const src = photoOf(c);
    return src ? img(src, c.name, cls) : `<div class="${cls} initials" aria-hidden="true">${esc(initials(c.name))}</div>`;
  };

  function clinicianCards(list) {
    return `<ul class="clinician-grid">${list
      .map(
        (c) => `<li class="clinician-card"><a href="${c.slug}/">
          <div class="clinician-photo">${portrait(c, "clinician-img")}</div>
          <div class="clinician-text">
            <h3>${esc(c.name)}${c.credentials ? `<span>, ${esc(c.credentials)}</span>` : ""}</h3>
            <p>${esc(c.role || c.type)}</p>
            <span class="more">Meet ${esc(c.name.split(" ")[0])}${icon("arrow")}</span>
          </div>
        </a></li>`
      )
      .join("")}</ul>`;
  }

  function pageCards(list, cls = "card-grid card-grid-4") {
    return `<ul class="${cls} link-cards">${list
      .map(
        (p) => `<li><a class="card link-card" href="${p.slug}/">
          <span class="card-icon">${icon(p.icon)}</span>
          <h3>${esc(label(p))}</h3>
          <p>${esc(p.summary || "")}</p>
          <span class="more">Learn more${icon("arrow")}</span>
        </a></li>`
      )
      .join("")}</ul>`;
  }

  function header(current) {
    const currentMenu = current && (menuOf(current) || (current.folder === "clinicians" ? menuOf(routes.get("doctors") || {}) : null));
    const nav = menus
      .map((menu, n) => {
        const items = inFolder(menu.folder)
          .map((p) => `<li><a href="${p.slug}/"${current === p ? ' aria-current="page"' : ""}>${esc(label(p))}</a></li>`)
          .join("");
        return `<li class="nav-item${currentMenu === menu ? " is-active" : ""}">
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu-${n}">${esc(menu.label)}${icon("chevron", "icon chevron")}</button>
          <ul class="dropdown" id="menu-${n}">${items}</ul>
        </li>`;
      })
      .join("");
    const banner = practice.announcement ? `<div class="announcement">${icon("maple")}<span>${md.parseInline(String(practice.announcement))}</span></div>` : "";
    return `${banner}
  <div class="topbar">
    <div class="container topbar-inner">
      <a href="${esc(practice.map)}">${icon("pin")}${esc(practice.street)}, ${esc(practice.town)}</a>
      <span class="topbar-right">
        <a href="${tel}">${icon("phone")}${esc(practice.phone)}</a>
        <a class="topbar-portal" href="${esc(practice["patient-portal"])}">${icon("lock")}Patient Portal</a>
      </span>
    </div>
  </div>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="">${img("site-images/logo.png", practice.name, "", true)}</a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav">${icon("menu", "icon icon-open")}${icon("close", "icon icon-close")}<span>Menu</span></button>
      <nav class="site-nav" id="site-nav" aria-label="Main">
        <ul class="nav-list">${nav}</ul>
        <a class="button button-small nav-call" href="${tel}">${icon("phone")}${esc(practice.phone)}</a>
      </nav>
    </div>
  </header>`;
  }

  function footer() {
    const links = menus
      .map((m) => `<div><h2>${esc(m.label)}</h2><ul>${inFolder(m.folder).map((p) => `<li><a href="${p.slug}/">${esc(label(p))}</a></li>`).join("")}</ul></div>`)
      .join("");
    return `<footer class="site-footer">
    ${ridges("ridges-footer")}
    <div class="footer-main">
      <div class="container footer-grid">
        <div class="footer-about">
          <p class="footer-name">${icon("maple", "icon maple")}${esc(practice.name)}</p>
          <p>${esc(practice.tagline)}.</p>
          <address><a href="${esc(practice.map)}">${esc(practice.street)}<br>${esc(practice.town)}</a></address>
          <p>Phone <a href="${tel}">${esc(practice.phone)}</a><br>Fax ${esc(practice.fax)}</p>
          ${hoursList("hours hours-footer")}
          ${practice.facebook ? `<a class="footer-social" href="${esc(practice.facebook)}">${icon("facebook")}Follow us on Facebook</a>` : ""}
        </div>
        ${links}
      </div>
      <div class="container footer-bottom">
        <p>© ${year} ${esc(practice.name)} · Proudly independent in Richmond, Vermont</p>
        <a href="${esc(practice["patient-portal"])}">${icon("lock")}Patient Portal</a>
      </div>
    </div>
  </footer>`;
  }

  function callCard() {
    return `<div class="card call-card">
      <p class="call-card-title">${icon("maple", "icon maple")}Call us</p>
      <a class="call-number" href="${tel}">${esc(practice.phone)}</a>
      <p class="small muted">Fax ${esc(practice.fax)}</p>
      <h3>Office hours</h3>
      ${hoursList()}
      <p class="small">${esc(practice["after-hours"])}</p>
      <h3>Find us</h3>
      <p><a href="${esc(practice.map)}">${esc(practice.street)}<br>${esc(practice.town)}</a></p>
      <a class="button button-block" href="${esc(practice["patient-portal"])}">${icon("lock")}Patient Portal</a>
    </div>`;
  }

  // ---------- Page templates ----------

  function layout({ page, title, description, body, prefix, head = "" }) {
    const base = String(practice.website).replace(/\/?$/, "/");
    const url = base + (page ? `${page.slug}/` : "");
    const desc = description || practice.description;
    const share = home.data.welcome && home.data.welcome.photo ? resolve(home.data.welcome.photo, home.dir, home.file) : "";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title ? `${title} | ${practice.name}` : `${practice.name} | ${practice.tagline}`)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(practice.name)}">
  <meta property="og:title" content="${esc(title || practice.name)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  ${share ? `<meta property="og:image" content="${esc(base + share)}">` : ""}
  <meta name="theme-color" content="#1f3d2b">
  <link rel="icon" href="theme/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="theme/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="theme/fonts/nunito-sans.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="theme/styles.css">
  ${head}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header(page)}
  <main id="main">
${body}
  </main>
  ${footer()}
  <script src="theme/site.js" defer></script>
</body>
</html>
`;
    return finishLinks(html, prefix);
  }

  function breadcrumb(page) {
    let trail = "";
    if (page.folder === "clinicians") {
      const parent = routes.get(page.type === "consultant" ? "specialists" : "doctors");
      if (parent) trail = `<li><a href="${parent.slug}/">${esc(label(parent))}</a></li>`;
    } else if (page.folder === "health-topics") {
      const parent = routes.get("patient-resource-information");
      if (parent) trail = `<li><a href="${parent.slug}/">${esc(label(parent))}</a></li>`;
    } else if (menuOf(page)) trail = `<li>${esc(menuOf(page).label)}</li>`;
    return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="">Home</a></li>${trail}</ol></nav>`;
  }

  function sectionNav(page) {
    const menu = menuOf(page);
    const title = menu ? menu.label : page.folder === "health-topics" ? "Common questions" : "";
    if (!title) return "";
    return `<nav class="card section-nav" aria-label="${esc(title)}"><h2>${esc(title)}</h2><ul>${inFolder(page.folder)
      .map((p) => `<li><a href="${p.slug}/"${p === page ? ' aria-current="page"' : ""}>${esc(label(p))}</a></li>`)
      .join("")}</ul></nav>`;
  }

  const pageHero = (page, lead) => `<section class="page-hero">
      <div class="container">
        ${breadcrumb(page)}
        <h1>${esc(page.title)}</h1>
        ${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
      </div>
      ${ridges()}
    </section>`;

  function renderPage(page) {
    const photo = photoOf(page);
    const body = `${pageHero(page, page.summary)}
    <div class="container page-layout">
      <article class="prose">
        ${photo ? snapshot(photo, page["photo-description"] || "", "", "page-photo") : ""}
        ${markdown(page)}
      </article>
      <aside class="sidebar">
        ${sectionNav(page)}
        ${callCard()}
      </aside>
    </div>`;
    return layout({ page, title: label(page), description: page.summary, body, prefix: "../" });
  }

  function renderClinician(c) {
    const education = (c.education || [])
      .map((e) => {
        const [what, where] = String(e).split(/\s+—\s+/);
        return `<li><strong>${esc(what)}</strong>${where ? `<span>${esc(where)}</span>` : ""}</li>`;
      })
      .join("");
    const others = clinicians.filter((o) => o !== c && (o.type === "consultant") === (c.type === "consultant"));
    const body = `${pageHero(c, c.role)}
    <div class="container clinician-layout">
      <aside class="clinician-aside">
        <figure class="snapshot clinician-portrait">${portrait(c, "clinician-img")}<figcaption>${esc(c.name)}</figcaption></figure>
        ${education ? `<div class="card education"><h2>Education &amp; training</h2><ul>${education}</ul></div>` : ""}
      </aside>
      <article class="prose">
        ${markdown(c)}
        <p><a class="button" href="${tel}">${icon("phone")}Call ${esc(practice.phone)} to make an appointment</a></p>
      </article>
    </div>
    ${others.length ? `<section class="band band-sage"><div class="container"><h2 class="band-title">${c.type === "consultant" ? "Our other consultants" : "Meet the rest of our clinicians"}</h2>${clinicianCards(others)}</div></section>` : ""}`;
    return layout({ page: c, title: c.title, description: c.summary, body, prefix: "../" });
  }

  const bandHead = (s, cls = "") => `<div class="band-head ${cls}">
      ${s["small-heading"] ? `<p class="eyebrow">${icon("maple", "icon maple")}${esc(s["small-heading"])}</p>` : ""}
      <h2 class="band-title">${esc(s.heading)}</h2>
      ${s.text ? `<p class="band-text">${esc(s.text)}</p>` : ""}
    </div>`;

  function renderHome() {
    context = home;
    const d = home.data;
    const w = d.welcome;
    const s = d.story;
    const shortcuts = (d.shortcuts || [])
      .map((x) => `<li><a class="shortcut" href="${esc(resolve(x.link, home.dir, home.file))}">${icon(x.icon)}<span><strong>${esc(x.title)}</strong><span>${esc(x.text)}</span></span></a></li>`)
      .join("");
    const gallery = (d.gallery.photos || [])
      .map((g) => `<li>${snapshot(resolve(g.photo, home.dir, home.file), g.caption, g.caption)}</li>`)
      .join("");
    const v = d.visit;
    const body = `<section class="hero">
      <div class="container hero-inner">
        <div class="hero-text">
          <p class="eyebrow">${icon("maple", "icon maple")}${esc(w["small-heading"])}</p>
          <h1>${esc(w.heading)}</h1>
          <p class="lead">${esc(w.text)}</p>
          <div class="hero-actions">
            <a class="button button-large" href="${tel}">${icon("phone")}Call ${esc(practice.phone)}</a>
            <a class="button button-large button-ghost" href="${esc(practice["patient-portal"])}">${icon("lock")}Patient Portal</a>
          </div>
        </div>
        <div class="hero-media">
          ${snapshot(resolve(w.photo, home.dir, home.file), w["photo-description"], "", "hero-photo")}
          <div class="hero-hours">
            ${icon("clock")}
            <div><strong>Open six days a week</strong>${hours
              .filter((h) => !/closed/i.test(h.time))
              .map((h) => `<span>${esc(h.days)} · ${esc(h.time)}</span>`)
              .join("")}</div>
          </div>
        </div>
      </div>
      ${ridges("ridges-hero")}
    </section>

    <section class="shortcuts-band" aria-label="Quick links">
      <ul class="container shortcuts">${shortcuts}</ul>
    </section>

    <section class="band">
      <div class="container">
        ${bandHead(d.services)}
        ${pageCards(inFolder("medical-services"))}
      </div>
    </section>

    <section class="band band-paper">
      <div class="container story">
        <div class="story-media">${snapshot(resolve(s.photo, home.dir, home.file), s["photo-description"], "", "tilt-left")}</div>
        <div class="story-text">
          ${bandHead({ "small-heading": s["small-heading"], heading: s.heading }, "band-head-left")}
          <p>${esc(s.text)}</p>
          <blockquote class="pull-quote"><p>“${esc(s.quote)}”</p><footer>${esc(s["quote-by"])}</footer></blockquote>
          <div class="badge">${icon("award")}<div><strong>${esc(s.badge)}</strong><span>${esc(s["badge-text"])}</span></div></div>
          <a class="button" href="our-story/">Read our story${icon("arrow")}</a>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="container">
        ${bandHead(d.clinicians)}
        ${clinicianCards(clinicians.filter((c) => c.type !== "consultant"))}
        <p class="band-foot"><a href="doctors/">All doctors &amp; nurse practitioners${icon("arrow")}</a><a href="specialists/">Our psychiatric consultants${icon("arrow")}</a></p>
      </div>
    </section>

    <section class="band band-topo">
      <div class="container">
        ${bandHead(d.gallery)}
        <ul class="gallery">${gallery}</ul>
      </div>
    </section>

    <section class="band">
      <div class="container">
        ${bandHead(d.topics)}
        ${pageCards(inFolder("health-topics"), "card-grid card-grid-3")}
      </div>
    </section>

    <section class="band band-paper">
      <div class="container visit">
        <div class="visit-text">
          ${bandHead(v, "band-head-left")}
          <ul class="visit-list">
            <li>${icon("phone")}<div><strong>Phone</strong><a href="${tel}">${esc(practice.phone)}</a></div></li>
            <li>${icon("printer")}<div><strong>Fax</strong><span>${esc(practice.fax)}</span></div></li>
            <li>${icon("pin")}<div><strong>Address</strong><a href="${esc(practice.map)}">${esc(practice.street)}, ${esc(practice.town)}</a></div></li>
            <li>${icon("lock")}<div><strong>Patient Portal</strong><a href="${esc(practice["patient-portal"])}">Message us any time</a></div></li>
          </ul>
          <a class="button" href="contact-us/">More ways to reach us${icon("arrow")}</a>
        </div>
        <div class="card hours-card">
          <h3>${icon("clock")}Office hours</h3>
          ${hoursList("hours hours-wide")}
          <p class="small muted">${esc(practice["after-hours"])}</p>
          ${v.photo ? snapshot(resolve(v.photo, home.dir, home.file), v["photo-description"] || "", "", "tilt-right") : ""}
        </div>
      </div>
    </section>`;

    // Lets search engines show the address, phone and hours.
    const DAYS = { monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su" };
    const to24 = (t) => {
      const m = String(t).trim().toLowerCase().match(/^(noon|(\d{1,2})(?::(\d\d))?\s*(am|pm))$/);
      if (!m) return null;
      if (m[1] === "noon") return "12:00";
      return `${String((Number(m[2]) % 12) + (m[4] === "pm" ? 12 : 0)).padStart(2, "0")}:${m[3] || "00"}`;
    };
    const openingHours = hours
      .map((h) => {
        const days = String(h.days).toLowerCase().split(/\s*[–-]\s*/).map((x) => DAYS[x.trim()]);
        const [from, to] = h.time.split(/\s+[–-]\s+/).map(to24);
        return days.every(Boolean) && from && to ? `${days.join("-")} ${from}-${to}` : null;
      })
      .filter(Boolean);
    const [town, rest = ""] = String(practice.town).split(/,\s*/);
    const [state, zip] = rest.split(/\s+/);
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "MedicalClinic",
      name: practice.name,
      description: practice.description,
      url: practice.website,
      telephone: practice.phone,
      faxNumber: practice.fax,
      address: { "@type": "PostalAddress", streetAddress: practice.street, addressLocality: town, addressRegion: state, postalCode: zip, addressCountry: "US" },
      openingHours,
      sameAs: [practice.facebook].filter(Boolean),
    };
    return layout({
      page: null,
      title: "",
      body,
      prefix: "",
      head: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
    });
  }

  function render404() {
    const body = `<section class="page-hero"><div class="container">
        <h1>We couldn't find that page</h1>
        <p class="lead">It may have moved when our website was updated. Try the menu above, or give us a call.</p>
        <p><a class="button" href="">${icon("home")}Go to the home page</a> <a class="button button-ghost" href="${tel}">${icon("phone")}${esc(practice.phone)}</a></p>
      </div>${ridges()}</section>`;
    // Shown for missing pages at any depth, so its links start from the site root.
    return layout({ page: null, title: "Page not found", body, prefix: "/" });
  }

  // ---------- Write dist/ ----------

  // home.md keeps its settings in the header.
  home.data = YAML.parse(fs.readFileSync(home.file, "utf8").match(/^---\n([\s\S]*?)\n?---/)[1]);

  const out = {};
  out["index.html"] = renderHome();
  for (const p of pages) out[`${p.slug}/index.html`] = renderPage(p);
  for (const c of clinicians) out[`${c.slug}/index.html`] = renderClinician(c);
  out["404.html"] = render404();
  const base = String(practice.website).replace(/\/?$/, "/");
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", ...routes.keys()]
    .map((s) => `  <url><loc>${base}${s ? `${s}/` : ""}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  out["robots.txt"] = `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`;

  // Everything rendered without errors, so replace the old site.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(CONTENT, DIST, { recursive: true, filter: (src) => !src.endsWith(".md") && !src.endsWith(".yml") });
  fs.cpSync(THEME, path.join(DIST, "theme"), { recursive: true });
  for (const [file, text] of Object.entries(out)) {
    fs.mkdirSync(path.dirname(path.join(DIST, file)), { recursive: true });
    fs.writeFileSync(path.join(DIST, file), text);
  }
  return { count: routes.size + 1, warnings };
}

function run() {
  const time = new Date().toLocaleTimeString();
  try {
    const { count, warnings } = build();
    console.log(`${time}  Built ${count} pages into dist/${warnings ? `, with ${warnings} thing${warnings === 1 ? "" : "s"} to fix (above)` : ""}.`);
    return true;
  } catch (err) {
    console.error(`${time}  Couldn't build the site: ${err.message}`);
    return false;
  }
}

if (process.argv.includes("--watch")) {
  run();
  console.log("Watching content/ and theme/. Save a file to rebuild; press Ctrl+C to stop.");
  let timer;
  for (const dir of [CONTENT, THEME])
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    });
} else if (!run()) {
  process.exit(1);
}

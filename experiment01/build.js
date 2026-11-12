#!/usr/bin/env node
/*
 * Builds the Richmond Family Medicine site into dist/ from content/ and static/.
 *
 *   npm install   (once)
 *   npm run build          the real site, for the root of richmondfamilymedicine.org
 *   npm run build:review   the review copy, for richmondfamilymedicine.org/reviews/experiment01-review/
 *
 * The review build (`--base=/reviews/experiment01-review/`) is hidden from search
 * engines, its "Page not found" page and .htaccess point into that folder,
 * and it has no sitemap.xml or robots.txt.
 *
 * Reads:
 *   content/site.yml         practice details, hours, menus (every page)
 *   content/home.yml         the home page
 *   content/forms.yml        the Forms page
 *   content/pages/*.md       one page each, at <file-name>/
 *   content/providers/*.md   one clinician each, at <file-name>/
 *   static/                  styles, script, images and PDFs, copied as they are
 *
 * Writes dist/, ready to upload: index.html, <page>/index.html, 404.html,
 * sitemap.xml, robots.txt and admin/defaults.json (for the editor), plus
 * everything in static/. Review builds also get cms/, a demo of the editor
 * that saves nothing.
 *
 * Content links are written from the site root (e.g. `urgent-care`,
 * `documents/RFM-Release-Form.pdf`) and made relative here, so the built
 * site works from any folder. The build warns about links to pages or files
 * that don't exist. Needs Node 18 or newer.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { Marked } = require("marked");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");
const STATIC = path.join(ROOT, "static");
const DIST = path.join(ROOT, "dist");

// The folder the site is served from: "/" for the real site, or e.g. "/reviews/experiment01-review/".
const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = `/${baseArg ? baseArg.slice("--base=".length) : ""}/`.replace(/\/+/g, "/");
const REVIEW = BASE !== "/";

let warnings = 0;
const warn = (msg) => {
  warnings++;
  console.warn(`warning: ${msg}`);
};

// ---------- Reading content ----------

function readYaml(name) {
  const file = path.join(CONTENT, name);
  try {
    return YAML.parse(fs.readFileSync(file, "utf8")) || {};
  } catch (err) {
    throw new Error(`content/${name}: can't read it: ${err.message}`);
  }
}

// A Markdown file with a YAML header between --- lines. The file name is the web address.
function readMarkdownDir(dir) {
  const full = path.join(CONTENT, dir);
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = fs.readFileSync(path.join(full, f), "utf8").replace(/\r\n/g, "\n");
      const m = text.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
      if (!m) throw new Error(`content/${dir}/${f}: missing the --- header`);
      let meta;
      try {
        meta = YAML.parse(m[1]) || {};
      } catch (err) {
        throw new Error(`content/${dir}/${f}: can't read the header: ${err.message}`);
      }
      return { ...meta, slug: path.basename(f, ".md"), body: m[2].trim(), source: `content/${dir}/${f}` };
    });
}

const site = readYaml("site.yml");
const home = readYaml("home.yml");
const forms = readYaml("forms.yml");
// Pages are listed in menu order (site.yml); `order:` in a page's header overrides that.
const menuSlugs = (site.menus || []).flatMap((m) => m.items.map((i) => String(i.page).split("#")[0]));
const position = (p) => p.order ?? (menuSlugs.includes(p.slug) ? menuSlugs.indexOf(p.slug) : 999);
const byOrder = (a, b) => position(a) - position(b) || String(a.title || a.name).localeCompare(b.title || b.name);

const pages = readMarkdownDir("pages");
for (const p of pages) if (!p.title) throw new Error(`${p.source}: needs a title`);

const GROUPS = {
  physician: "Physicians",
  "nurse-practitioner": "Nurse Practitioners",
  consultant: "Consultants",
};
const providers = readMarkdownDir("providers")
  .map((p) => {
    if (!p.name) throw new Error(`${p.source}: needs a name`);
    if (!GROUPS[p.group]) throw new Error(`${p.source}: group must be one of ${Object.keys(GROUPS).join(", ")}`);
    const title = p.credentials ? `${p.name}, ${p.credentials}` : p.name;
    return { ...p, title, summary: p.summary || `${title}, ${p.role || GROUPS[p.group]} at ${site.name}.` };
  })
  .sort(byOrder);

const routes = new Map();
for (const p of [...pages, ...providers]) {
  if (routes.has(p.slug)) throw new Error(`${p.source}: another page already uses the address ${p.slug}/`);
  routes.set(p.slug, p);
}
const pagesIn = (section) => pages.filter((p) => p.section === section).sort(byOrder);

// ---------- Links and images ----------

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isExternal = (u) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Menu and link labels: a page's short title, or the given label.
function linkLabel(item) {
  if (item.label) return item.label;
  const page = routes.get(String(item.page).split("#")[0]);
  return page ? page.menuTitle || page.title : item.page;
}

// Rewrites a site-root link ("urgent-care", "/images/x.jpg") for a page `prefix` levels down.
function resolveUrl(url, prefix, from) {
  if (isExternal(url)) return url;
  let [p, hash] = url.split("#");
  try {
    p = decodeURI(p);
  } catch {}
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  hash = hash ? `#${hash}` : "";
  if (p === "" || p === "index.html") return (prefix || "./") + hash;
  if (routes.has(p)) return `${prefix}${p}/${hash}`;
  if (!fs.existsSync(path.join(STATIC, p))) warn(`${from}: links to "${p}", which isn't a page or a file in static/`);
  return prefix + encodeURI(p) + hash;
}

// Makes every href/src in a finished page relative, and opens PDFs and other sites in a new tab.
function finishLinks(html, prefix, from) {
  html = html.replace(/\b(href|src)="([^"]*)"/g, (_, attr, u) => `${attr}="${resolveUrl(u.replace(/&amp;/g, "&"), prefix, from).replace(/&/g, "&amp;")}"`);
  return html.replace(/<a ([^>]*?)href="([^"]+)"([^>]*)>/g, (tag, before, href, after) => {
    if (/\btarget=/.test(tag) || !(/^https?:/i.test(href) || /\.pdf(#|$)/i.test(href))) return tag;
    return `<a ${before}href="${href}"${after} target="_blank" rel="noopener">`;
  });
}

// Width and height of a JPEG or PNG in static/, so pages don't jump while images load.
function imageSize(src) {
  try {
    const b = fs.readFileSync(path.join(STATIC, src));
    if (b.toString("ascii", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}

function img(src, alt, { cls = "", eager = false } = {}) {
  const size = imageSize(src);
  const dims = size ? ` width="${size.w}" height="${size.h}"` : "";
  return `<img src="${esc(src)}" alt="${esc(alt)}"${dims}${cls ? ` class="${cls}"` : ""}${eager ? "" : ' loading="lazy"'}>`;
}

// ---------- Markdown ----------

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
  },
});
const markdown = (text) => md.parse(text || "");

// ---------- Icons (24×24 line icons, drawn with stroke) ----------

const ICONS = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
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
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
};
function icon(name, cls = "icon") {
  if (!ICONS[name]) {
    if (name) warn(`there's no icon called "${name}"; the choices are ${Object.keys(ICONS).join(", ")}`);
    name = "info";
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// ---------- Shared pieces ----------

const telHref = (n) => `tel:+1${String(n).replace(/\D/g, "")}`;
const a = site.address;
const addressLine = `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
const year = new Date().getFullYear();

// ---------- Sections edited at admin/ ----------
//
// The announcement, the office hours and the after-hours note can be changed on
// GoDaddy with the editor in static/admin/. It saves each changed section as a
// small HTML file in edits/, which the pages pull in with Apache's server-side
// includes. Each page also carries the built-in version from site.yml, which
// shows until a section is changed in the editor, and on hosts without includes
// such as GitHub Pages. static/admin/render.php writes the same HTML as the
// functions below for the same values, so change the two together.

function editable(name, html) {
  const file = `${BASE}edits/${name}.html`;
  return `<!--#if expr="-F '%{DOCUMENT_ROOT}${file}'" --><!--#include virtual="${file}" --><!--#else -->${html}<!--#endif -->`;
}

const announcementHtml = () => (site.announcement ? `<div class="announcement">${md.parseInline(site.announcement)}</div>` : "");

const hoursRows = () => site.hours.map((h) => `<div><dt>${esc(h.days)}</dt><dd>${esc(h.time)}</dd></div>`).join("");

function hoursList(cls = "hours") {
  return `<dl class="${cls}">${editable("hours", hoursRows())}</dl>`;
}

const afterHours = () => editable("after-hours", esc(site.afterHours));

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const COUNTS = ["", "one day", "two days", "three days", "four days", "five days", "six days", "seven days"];

// "Open six days a week", counted from the lines that aren't "Closed". Days can
// be single ("Saturday"), ranges ("Monday – Friday") or lists ("Monday, Wednesday").
// Anything else gives "Office hours".
function openDaysHeading(hours) {
  const open = new Set();
  for (const h of hours) {
    if (/closed/i.test(h.time)) continue;
    for (const part of String(h.days).toLowerCase().split(/\s*(?:,|&|\band\b)\s*/)) {
      const ends = part.split(/\s*[–-]\s*/).map((d) => DAYS.indexOf(d.trim()));
      if (ends.length > 2 || ends.includes(-1)) return "Office hours";
      const [from, to = from] = ends;
      for (let d = from; ; d = (d + 1) % 7) {
        open.add(d);
        if (d === to) break;
      }
    }
  }
  return open.size ? `Open ${COUNTS[open.size]} a week` : "Office hours";
}

// The home page card: "Open six days a week" and the days that are open.
const hoursSummary = () =>
  `<strong>${openDaysHeading(site.hours)}</strong>${site.hours
    .filter((x) => !/closed/i.test(x.time))
    .map((x) => `<span>${esc(x.days)} · ${esc(x.time)}</span>`)
    .join("")}`;

// The hours for search engines, e.g. "Mo-Fr 08:00-17:00". Lines in another
// form are left out.
function openingHours(hours) {
  const days = { monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su" };
  const to24 = (t) => {
    const m = String(t).trim().toLowerCase().match(/^(noon|(\d{1,2})(?::(\d\d))?\s*(am|pm))$/);
    if (!m) return null;
    if (m[1] === "noon") return "12:00";
    let hr = Number(m[2]) % 12;
    if (m[4] === "pm") hr += 12;
    return `${String(hr).padStart(2, "0")}:${m[3] || "00"}`;
  };
  return hours
    .map((x) => {
      const d = String(x.days).toLowerCase().split(/\s*[–-]\s*/).map((s) => days[s.trim()]);
      const [from, to] = String(x.time).split(/\s+[–-]\s+/).map(to24);
      return d.every(Boolean) && from && to ? `${d.join("-")} ${from}-${to}` : null;
    })
    .filter(Boolean);
}

// The practice's identifier in search engine data, so the hours (a separate
// block, because they can be edited) attach to the rest of its details.
const practiceId = () => `${site.url.replace(/\/?$/, "/")}#practice`;

const jsonLdScript = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

function hoursData() {
  const hours = openingHours(site.hours);
  return hours.length ? jsonLdScript({ "@context": "https://schema.org", "@id": practiceId(), openingHours: hours }) : "";
}

// Which menu (Who We Are, Medical Services…) a page belongs to, for the breadcrumb.
function menuFor(slug) {
  return site.menus.find((m) => m.items.some((i) => String(i.page).split("#")[0] === slug));
}

function header(current) {
  const currentMenu = current && (menuFor(current.slug) || (current.group ? menuFor(current.group === "consultant" ? "specialists" : "doctors") : null));
  const menus = site.menus
    .map((menu, n) => {
      const items = menu.items
        .map((item) => {
          const isCurrent = current && String(item.page).split("#")[0] === current.slug;
          return `<li><a href="${esc(item.page)}"${isCurrent ? ' aria-current="page"' : ""}>${esc(linkLabel(item))}</a></li>`;
        })
        .join("");
      const active = currentMenu === menu ? " is-active" : "";
      return `<li class="nav-item${active}">
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu-${n}">${esc(menu.label)}${icon("chevron", "icon chevron")}</button>
          <ul class="dropdown" id="menu-${n}">${items}</ul>
        </li>`;
    })
    .join("");
  return `${editable("announcement", announcementHtml())}
  <div class="topbar">
    <div class="container topbar-inner">
      <a href="${esc(a.mapUrl)}">${icon("pin")}${esc(addressLine)}</a>
      <span class="topbar-right">
        <a href="${telHref(site.phone)}">${icon("phone")}${esc(site.phone)}</a>
        <a class="topbar-portal" href="${esc(site.portal.url)}">${icon("lock")}${esc(site.portal.label)}</a>
      </span>
    </div>
  </div>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="./">${img("images/logo.png", site.name, { eager: true })}</a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav">${icon("menu", "icon icon-open")}${icon("close", "icon icon-close")}<span>Menu</span></button>
      <nav class="site-nav" id="site-nav" aria-label="Main">
        <ul class="nav-list">${menus}</ul>
        <a class="button button-small nav-call" href="${telHref(site.phone)}">${icon("phone")}Call ${esc(site.phone)}</a>
      </nav>
    </div>
  </header>`;
}

function footer() {
  const links = (site.footerLinks || []).map((item) => `<li><a href="${esc(item.page)}">${esc(linkLabel(item))}</a></li>`).join("");
  return `<footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-about">
        <p class="footer-name">${esc(site.name)}</p>
        <p>${esc(site.description)}</p>
        ${site.facebook ? `<a class="footer-social" href="${esc(site.facebook)}">${icon("facebook")}Follow us on Facebook</a>` : ""}
      </div>
      <div>
        <h2>Visit</h2>
        <address>${esc(a.street)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</address>
        <a class="footer-link" href="${esc(a.mapUrl)}">Get directions${icon("arrow")}</a>
      </div>
      <div>
        <h2>Hours</h2>
        ${hoursList("hours hours-footer")}
      </div>
      <div>
        <h2>Contact</h2>
        <p>Phone <a href="${telHref(site.phone)}">${esc(site.phone)}</a><br>Fax ${esc(site.fax)}</p>
        <a class="footer-link" href="${esc(site.portal.url)}">${esc(site.portal.label)}${icon("arrow")}</a>
      </div>
    </div>
    <div class="container footer-bottom">
      <ul class="footer-links">${links}</ul>
      <p>© ${year} ${esc(site.name)} · All rights reserved</p>
    </div>
  </footer>`;
}

// The box beside every inner page: phone, hours, address and portal.
function contactCard() {
  return `<div class="card contact-card">
      <h2>Call us</h2>
      <a class="contact-phone" href="${telHref(site.phone)}">${icon("phone")}${esc(site.phone)}</a>
      <p class="muted small">Fax ${esc(site.fax)}</p>
      <h3>Office hours</h3>
      ${hoursList()}
      <p class="small">${afterHours()}</p>
      <h3>Location</h3>
      <p><a href="${esc(a.mapUrl)}">${esc(a.street)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</a></p>
      <a class="button button-block" href="${esc(site.portal.url)}">${icon("lock")}${esc(site.portal.label)}</a>
    </div>`;
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !/\.$/.test(w))
    .map((w) => w[0])
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join("");
}

function providerPhoto(p, cls) {
  return p.photo ? img(p.photo, p.name, { cls }) : `<div class="${cls} avatar" aria-hidden="true">${esc(initials(p.name))}</div>`;
}

function providerCards(list) {
  return `<ul class="provider-grid">${list
    .map(
      (p) => `<li class="provider-card">
        <a href="${p.slug}">
          <div class="provider-photo">${providerPhoto(p, "provider-img")}</div>
          <div class="provider-text">
            <h3>${esc(p.name)}<span>, ${esc(p.credentials)}</span></h3>
            <p>${esc(p.role || GROUPS[p.group])}</p>
            <span class="more">Meet ${esc(p.name.split(" ")[0])}${icon("arrow")}</span>
          </div>
        </a>
      </li>`
    )
    .join("")}</ul>`;
}

function pageCards(list, cls = "service-grid") {
  return `<ul class="${cls}">${list
    .map(
      (p) => `<li><a class="card link-card" href="${p.slug}">
        <span class="card-icon">${icon(p.icon)}</span>
        <h3>${esc(p.menuTitle || p.title)}</h3>
        <p>${esc(p.summary || "")}</p>
        <span class="more">Learn more${icon("arrow")}</span>
      </a></li>`
    )
    .join("")}</ul>`;
}

const fileLink = (f) => `<a class="file-link" href="${esc(f.file)}">${icon("file")}<span>${esc(f.label)}</span></a>`;

// ---------- Page bodies added by `include:` ----------

const INCLUDES = {
  clinicians() {
    return ["physician", "nurse-practitioner"]
      .map((g) => `<h2>${GROUPS[g]}</h2>${providerCards(providers.filter((p) => p.group === g))}`)
      .join("") + `<p>We also have <a href="specialists">psychiatric nurse practitioner consultants</a> in the office.</p>`;
  },
  consultants() {
    return providerCards(providers.filter((p) => p.group === "consultant"));
  },
  topics() {
    return pageCards(pagesIn("topics"), "service-grid service-grid-3");
  },
  contact() {
    return `<h2>Office hours</h2>${hoursList("hours hours-wide")}
      <p>${afterHours()}</p>
      <figure class="wide-figure">${img(home.hero.image, home.hero.imageAlt)}</figure>
      <p><a class="button" href="${esc(a.mapUrl)}">${icon("pin")}Get directions</a></p>`;
  },
  forms() {
    const groups = (forms.groups || [])
      .map((g) => `<section class="card form-group"><h3>${esc(g.title)}</h3><ul>${(g.files || []).map((f) => `<li>${fileLink(f)}</li>`).join("")}</ul></section>`)
      .join("");
    const ped = forms.pediatric;
    const list = (files) => (files || []).map(fileLink).join("") || '<span class="muted">—</span>';
    const stages = (ped.stages || [])
      .map(
        (s) => `<h4>${esc(s.name)}</h4>
        <table class="visit-table">
          <thead><tr><th scope="col">Well-child visit</th><th scope="col">Questionnaire</th><th scope="col">Educational handouts</th></tr></thead>
          <tbody>${s.visits
            .map((v) => `<tr><th scope="row">${esc(v.age)}</th><td data-label="Questionnaire">${list(v.questionnaires)}</td><td data-label="Handouts">${list(v.handouts)}</td></tr>`)
            .join("")}</tbody>
        </table>`
      )
      .join("");
    return `<div class="form-groups">${groups}</div>
      <h2 id="${slugify(ped.title)}">${esc(ped.title)}</h2>
      <div class="callout"><p><strong>${esc(ped.firstVisitNote)}</strong></p><div class="file-row">${list(ped.firstVisit)}</div></div>
      <h3>Age-based questionnaires &amp; educational materials</h3>
      ${stages}`;
  },
};

// ---------- Page templates ----------

function layout({ page, title, description, body, prefix, extraHead = "" }) {
  const fullTitle = title ? `${title} | ${site.name}` : site.name;
  const canonical = site.url.replace(/\/?$/, "/") + (page ? `${page.slug}/` : "");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <!--#config errmsg="" -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description || site.description)}">${REVIEW ? `\n  <meta name="robots" content="noindex, nofollow">` : ""}
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(title || site.name)}">
  <meta property="og:description" content="${esc(description || site.description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(site.url.replace(/\/?$/, "/") + home.hero.image)}">
  <meta name="theme-color" content="#2f5d36">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preload" href="fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="styles.css">
  ${extraHead}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${header(page)}
  <main id="main">
${body}
  </main>
  ${footer()}
  <script src="site.js" defer></script>
</body>
</html>
`;
  return finishLinks(html, prefix, page ? page.source : "the home page");
}

function breadcrumb(page) {
  let trail = "";
  if (page.group) {
    const parent = routes.get(page.group === "consultant" ? "specialists" : "doctors");
    trail = `<li><a href="${parent.slug}">${esc(parent.menuTitle || parent.title)}</a></li>`;
  } else if (page.section === "topics") {
    const parent = routes.get("patient-resource-information");
    if (parent) trail = `<li><a href="${parent.slug}">${esc(parent.title)}</a></li>`;
  } else {
    const menu = menuFor(page.slug);
    if (menu) trail = `<li>${esc(menu.label)}</li>`;
  }
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="./">Home</a></li>${trail}</ol></nav>`;
}

// Other pages in the same menu, listed beside the page.
function sectionNav(page) {
  const menu = menuFor(page.slug);
  let items, label;
  if (page.section === "topics") {
    items = pagesIn("topics").map((p) => ({ page: p.slug }));
    label = "Common questions";
  } else if (menu) {
    items = menu.items;
    label = menu.label;
  } else return "";
  return `<nav class="card section-nav" aria-label="${esc(label)}"><h2>${esc(label)}</h2><ul>${items
    .map((i) => `<li><a href="${esc(i.page)}"${String(i.page).split("#")[0] === page.slug ? ' aria-current="page"' : ""}>${esc(linkLabel(i))}</a></li>`)
    .join("")}</ul></nav>`;
}

function pageHero(page, lead) {
  return `<section class="page-hero">
      <div class="container">
        ${breadcrumb(page)}
        <h1>${esc(page.title)}</h1>
        ${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
      </div>
    </section>`;
}

function renderPage(page) {
  let figure = "";
  if (page.image) {
    const size = imageSize(page.image);
    // Large landscape photos span the column; small or portrait ones sit beside the text.
    const wide = size && size.w >= 600 && size.w / size.h > 1.2;
    figure = `<figure class="${wide ? "wide-figure" : "side-figure"}">${img(page.image, page.imageAlt || "", { eager: true })}</figure>`;
  }
  let include = "";
  if (page.include) {
    if (!INCLUDES[page.include]) throw new Error(`${page.source}: include must be one of ${Object.keys(INCLUDES).join(", ")}`);
    include = INCLUDES[page.include]();
  }
  const body = `${pageHero(page, page.summary)}
    <div class="container page-layout">
      <article class="prose">
        ${figure}
        ${markdown(page.body)}
        ${include}
      </article>
      <aside class="sidebar">
        ${sectionNav(page)}
        ${contactCard()}
      </aside>
    </div>`;
  return layout({ page, title: page.menuTitle || page.title, description: page.summary, body, prefix: "../" });
}

function renderProvider(p) {
  const education = (p.education || [])
    .map((e) => `<li><strong>${esc(e.title)}</strong>${e.place ? `<span>${esc(e.place)}</span>` : ""}</li>`)
    .join("");
  const others = providers.filter((o) => o !== p && (o.group === "consultant") === (p.group === "consultant"));
  const body = `${pageHero(p, p.role)}
    <div class="container provider-layout">
      <aside class="provider-aside">
        <div class="provider-portrait">${providerPhoto(p, "provider-img")}</div>
        ${education ? `<div class="card education"><h2>Education &amp; training</h2><ul>${education}</ul></div>` : ""}
      </aside>
      <article class="prose">
        ${markdown(p.body)}
        <p><a class="button" href="${telHref(site.phone)}">${icon("phone")}Call ${esc(site.phone)} to schedule</a></p>
      </article>
    </div>
    ${others.length ? `<section class="section section-tint"><div class="container"><h2 class="section-title">${p.group === "consultant" ? "Our other consultants" : "Our other clinicians"}</h2>${providerCards(others)}</div></section>` : ""}`;
  return layout({ page: p, title: p.title, description: p.summary, body, prefix: "../" });
}

function sectionHead(s, cls = "") {
  return `<div class="section-head ${cls}">
      ${s.eyebrow ? `<p class="eyebrow">${esc(s.eyebrow)}</p>` : ""}
      <h2 class="section-title">${esc(s.heading)}</h2>
      ${s.text ? `<p class="section-text">${esc(s.text)}</p>` : ""}
    </div>`;
}

function renderHome() {
  const h = home.hero;
  const shortcuts = (home.shortcuts || [])
    .map((s) => `<li><a class="shortcut" href="${esc(s.page)}">${icon(s.icon)}<span><strong>${esc(s.label)}</strong><span>${esc(s.text)}</span></span></a></li>`)
    .join("");
  const ab = home.about;
  const today = hoursList("hours hours-wide");
  const body = `<section class="hero">
      <div class="container hero-inner">
        <div class="hero-text">
          <p class="eyebrow">${esc(h.eyebrow)}</p>
          <h1>${esc(h.heading)}</h1>
          <p class="lead">${esc(h.text)}</p>
          <div class="hero-actions">
            <a class="button button-large" href="${telHref(site.phone)}">${icon("phone")}Call ${esc(site.phone)}</a>
            <a class="button button-large button-ghost" href="${esc(site.portal.url)}">${icon("lock")}${esc(site.portal.label)}</a>
          </div>
        </div>
        <div class="hero-media">
          ${img(h.image, h.imageAlt, { eager: true, cls: "hero-img" })}
          <div class="hero-card">
            ${icon("clock")}
            <div>${editable("hours-summary", hoursSummary())}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="shortcuts-band" aria-label="Quick links">
      <ul class="container shortcuts">${shortcuts}</ul>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHead(home.services)}
        ${pageCards(pagesIn("services"))}
      </div>
    </section>

    <section class="section section-tint">
      <div class="container about">
        <div class="about-media">${img(ab.image, ab.imageAlt, { cls: "rounded-img" })}</div>
        <div class="about-text">
          ${sectionHead({ eyebrow: ab.eyebrow, heading: ab.heading }, "section-head-left")}
          <p>${esc(ab.text)}</p>
          <blockquote class="pull-quote"><p>“${esc(ab.quote)}”</p><footer>${esc(ab.quoteBy)}</footer></blockquote>
          <div class="badge">${icon("award")}<div><strong>${esc(ab.badge)}</strong><span>${esc(ab.badgeText)}</span></div></div>
          <a class="button" href="${esc(ab.link)}">${esc(ab.linkLabel)}${icon("arrow")}</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        ${sectionHead(home.clinicians)}
        ${providerCards(providers.filter((p) => p.group !== "consultant"))}
        <p class="section-foot"><a href="doctors">All doctors &amp; nurse practitioners${icon("arrow")}</a> <a href="specialists">Our psychiatric consultants${icon("arrow")}</a></p>
      </div>
    </section>

    <section class="section section-tint">
      <div class="container">
        ${sectionHead(home.topics)}
        ${pageCards(pagesIn("topics"), "service-grid service-grid-3")}
      </div>
    </section>

    <section class="section">
      <div class="container visit">
        <div class="visit-text">
          ${sectionHead(home.visit, "section-head-left")}
          <ul class="visit-list">
            <li>${icon("phone")}<div><strong>Phone</strong><a href="${telHref(site.phone)}">${esc(site.phone)}</a></div></li>
            <li>${icon("printer")}<div><strong>Fax</strong><span>${esc(site.fax)}</span></div></li>
            <li>${icon("pin")}<div><strong>Address</strong><a href="${esc(a.mapUrl)}">${esc(addressLine)}</a></div></li>
            <li>${icon("lock")}<div><strong>${esc(site.portal.label)}</strong><a href="${esc(site.portal.url)}">Message your clinician any time</a></div></li>
          </ul>
          <h3>Office hours</h3>
          ${today}
          <p class="muted">${afterHours()}</p>
          <a class="button" href="contact-us">More ways to reach us${icon("arrow")}</a>
        </div>
        <div class="visit-media">${img(home.visit.image, home.visit.imageAlt, { cls: "rounded-img" })}</div>
      </div>
    </section>`;

  // Lets search engines show the address, phone and hours. The hours are a
  // separate block with the same "@id", because they can be edited.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    "@id": practiceId(),
    name: site.name,
    description: site.description,
    url: site.url,
    telephone: site.phone,
    faxNumber: site.fax,
    address: { "@type": "PostalAddress", streetAddress: a.street, addressLocality: a.city, addressRegion: a.state, postalCode: String(a.zip), addressCountry: "US" },
    sameAs: [site.facebook].filter(Boolean),
  };
  return layout({
    page: null,
    title: "",
    description: site.description,
    body,
    prefix: "",
    extraHead: `${jsonLdScript(jsonLd)}\n  ${editable("hours-data", hoursData())}`,
  });
}

function render404() {
  const body = `<section class="page-hero"><div class="container">
      <h1>Page not found</h1>
      <p class="lead">Sorry, we couldn't find that page. It may have moved when our website was updated.</p>
      <p><a class="button" href="./">Go to the home page</a> <a class="button button-ghost" href="contact-us">Contact us</a></p>
    </div></section>`;
  // Served for missing pages at any depth, so its links start from the site's folder.
  return layout({ page: null, title: "Page not found", body, prefix: BASE });
}

// A look at the website editor (static/admin/index.php) for people without a
// login: the same page, filled with the built-in values, but nothing on it is
// saved. There's no form, and "Save changes" only explains that. Review copies
// only, at cms/. Keep its markup in step with the editor's.
function renderEditorDemo() {
  const hours = Array.from({ length: 7 }, (_, i) => site.hours[i] || { days: "", time: "" });
  const hourLines = hours
    .map(
      (h, i) => `<div class="hours-line">
          <input type="text" value="${esc(h.days)}" maxlength="40" aria-label="Line ${i + 1}: days" placeholder="Days, e.g. Saturday">
          <input type="text" value="${esc(h.time)}" maxlength="40" aria-label="Line ${i + 1}: hours" placeholder="Hours, e.g. 9:00 am – noon">
        </div>`
    )
    .join("\n        ");
  const builtIn = '<p class="editor-status">The website shows the built-in version.</p>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Banner and hours (demo) | Website editor</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="stylesheet" href="editor.css">
</head>
<body class="editor-page">
  <header class="editor-bar">
    <div class="container editor-bar-inner">
      <p><strong>Website editor</strong> · ${esc(site.name)}</p>
      <p>Demo · <a href="../">View the website</a></p>
    </div>
  </header>
  <main class="container editor">
    <h1>Banner and hours</h1>
    <p class="editor-message is-demo"><strong>This is a demo of the website editor.</strong> Try typing in it: nothing is saved and the website doesn't change. The real editor is at <code>admin/</code> and needs a password.</p>
    <div class="editor-form">
      <section class="card editor-section">
        <h2><label for="announcement">Announcement banner</label></h2>
        <p class="muted">Shown across the top of every page, e.g. "The office is closed Monday, January 1 for the holiday." Leave it empty for no banner. Web addresses starting with https:// become links.</p>
        ${builtIn}
        <textarea id="announcement" rows="3" maxlength="300">${esc(site.announcement || "")}</textarea>
      </section>

      <section class="card editor-section">
        <h2>Office hours</h2>
        <p class="muted">Shown in the footer of every page, beside each page, and on the home and Contact Us pages. One line for each group of days, written like the examples, e.g. "Monday – Friday" and "8:00 am – 5:00 pm", or "Closed". Search engines read hours written that way. Leave unused lines empty.</p>
        ${builtIn}
        <div class="hours-line hours-head" aria-hidden="true"><span>Days</span><span>Hours</span></div>
        ${hourLines}
      </section>

      <section class="card editor-section">
        <h2><label for="afterHours">After-hours note</label></h2>
        <p class="muted">Shown under the office hours beside each page, and on the home and Contact Us pages.</p>
        ${builtIn}
        <textarea id="afterHours" rows="3" maxlength="300">${esc(site.afterHours || "")}</textarea>
      </section>

      <p class="editor-actions"><button class="button" type="button" popovertarget="demo-saved">Save changes</button> <a class="button button-ghost" href="./">Undo unsaved changes</a></p>
    </div>

    <div class="demo-note" id="demo-saved" popover>
      <p><strong>Nothing was saved: this is the demo.</strong></p>
      <p>In the real editor, saving updates every page straight away, and the change is listed under Recent changes with who made it and when.</p>
      <button class="button button-small" type="button" popovertarget="demo-saved" popovertargetaction="hide">OK</button>
    </div>

    <section class="editor-history">
      <h2>Recent changes</h2>
      <p class="muted">Nothing has been changed here yet. Built-in hours: ${esc(site.hours.map((h) => `${h.days}: ${h.time}`).join("; "))}.</p>
    </section>
  </main>
</body>
</html>
`;
}

// ---------- Write dist/ ----------

const write = (rel, text) => {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(STATIC, DIST, { recursive: true });

if (REVIEW) {
  // Point the "Page not found" page and 404.php into the review folder, and
  // keep the review copy (pages and PDFs) out of search results.
  const htaccess = path.join(DIST, ".htaccess");
  let text = fs.readFileSync(htaccess, "utf8");
  for (const file of ["404.html", "404.php", "admin/index.php"]) {
    const fromRoot = ` /${file}`; // "ErrorDocument 404 /404.html", "RewriteRule ^ /404.php [L,NS]"
    if (!text.includes(fromRoot)) warn(`static/.htaccess: nothing points at /${file} to change to ${BASE}${file}`);
    text = text.replaceAll(fromRoot, ` ${BASE}${file}`);
  }
  fs.writeFileSync(
    htaccess,
    text +
      `\n# Review copy (npm run build:review): keep it out of search results.\n<IfModule mod_headers.c>\n  Header always set X-Robots-Tag "noindex, nofollow"\n</IfModule>\n`
  );
}

write("index.html", renderHome());
for (const p of pages) write(`${p.slug}/index.html`, renderPage(p));
for (const p of providers) write(`${p.slug}/index.html`, renderProvider(p));
write("404.html", render404());

// The built-in versions of the sections the editor changes (see "Sections edited
// at admin/" above), for admin/index.php.
if (site.hours.length > 7) warn(`content/site.yml: ${site.hours.length} lines of hours; the editor only has room for 7`);
write(
  "admin/defaults.json",
  JSON.stringify(
    {
      base: BASE,
      practiceId: practiceId(),
      announcement: String(site.announcement || ""),
      hours: site.hours.map((h) => ({ days: String(h.days), time: String(h.time) })),
      afterHours: String(site.afterHours || ""),
    },
    null,
    2
  ) + "\n"
);

// The editor demo, for review copies only. It has its own copy of the editor's
// styles, because admin/ is behind a password on GoDaddy.
if (REVIEW) {
  write("cms/index.html", renderEditorDemo());
  fs.copyFileSync(path.join(STATIC, "admin/admin.css"), path.join(DIST, "cms/editor.css"));
}

if (!REVIEW) {
  const base = site.url.replace(/\/?$/, "/");
  write(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", ...routes.keys()].map((s) => `  <url><loc>${base}${s ? `${s}/` : ""}</loc></url>`).join("\n")}\n</urlset>\n`
  );
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
}

const builtFor = REVIEW ? ` (review copy for ${BASE}, hidden from search engines)` : "";
console.log(`Built ${routes.size + 1} pages into dist/${builtFor}${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`);

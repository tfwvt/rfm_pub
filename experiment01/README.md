# experiment01

A new website for [Richmond Family Medicine](https://richmondfamilymedicine.org), built to replace the current one.

Every page, clinician biography, form and handout from richmondfamilymedicine.org is here. The words live in plain text files in `content/`, separate from the design, so updating the site never means editing HTML.

## Files

| Path | What it is |
| --- | --- |
| `content/site.yml` | **Practice details**: phone, fax, address, hours, after-hours note, patient portal link, the header menus, footer links, and an optional announcement banner |
| `content/home.yml` | The home page's headings and text |
| `content/pages/*.md` | **Every page**, one Markdown file each. The file name is the web address: `urgent-care.md` is `/urgent-care/` |
| `content/providers/*.md` | **Every doctor and nurse practitioner**: name, credentials, photo, education and biography |
| `content/forms.yml` | Everything on the Forms page, including the well-child questionnaire table |
| `static/` | Copied into the site as it is: `styles.css` (the design), `site.js` (the menus), `images/`, `fonts/`, the PDFs in `documents/` and `forms/`, and `.htaccess` (web server settings, see [Hosting](#hosting)) |
| `static/admin/` | The online editor for the banner, hours and after-hours note (see [Editing the banner and hours](#editing-the-banner-and-hours)) |
| `build.js` | Builds the finished site into `dist/` |
| `dist/` | The built site, ready to upload. Generated; not in git |
| `../.pages.yml` | Settings for the Pages CMS editor, at the repository root |
| `../.github/workflows/pages.yml` | Publishes the GitHub Pages test copy on every push (see [Hosting](#hosting)) |

The web addresses and PDF paths match the old site's (`/urgent-care`, `/documents/RFM-Release-Form.pdf`, …), so bookmarks and links elsewhere keep working once the domain points here.

## Common updates

| To… | Edit |
| --- | --- |
| Post a closure or other notice on every page | the [online editor](#editing-the-banner-and-hours), or `announcement:` in `content/site.yml` (empty it to remove the banner) |
| Change the hours or the after-hours note | the [online editor](#editing-the-banner-and-hours), or `content/site.yml` |
| Change the phone number or the portal link | `content/site.yml` (every page picks it up) |
| Edit a page | its file in `content/pages/` |
| Add a clinician | copy a file in `content/providers/`, rename it (e.g. `jane-smith-md.md`), edit it, and put a photo in `static/images/providers/` |
| Remove a clinician | delete their file in `content/providers/` and remove their name from `content/pages/our-story.md` |
| Add a form | put the PDF in `static/documents/` and add a line to `content/forms.yml` |
| Add a page | create `content/pages/new-page.md` and add `- page: new-page` to a menu in `content/site.yml` |

## Editing the banner and hours

The announcement banner, the office hours and the after-hours note can be changed straight on the website, without building or uploading. The editor is at `admin/` in each copy of the site:

- review copy: <https://richmondfamilymedicine.org/reviews/experiment01-review/admin/>
- real site, once it's live: <https://richmondfamilymedicine.org/admin/>

Changes show on every page as soon as they're saved. The editor keeps a list of recent changes (who and when), and any of them can be brought back. Each section also has **Go back to the built-in version**, which returns it to what's in `content/site.yml`.

**First time, for each copy:** upload the site, then in cPanel open **Directory Privacy**, go to the `admin` folder (`public_html/reviews/experiment01-review/admin` for the review copy, `public_html/admin` for the real site), choose **Password protect this directory**, save, and add a user for each person who edits, with a long password. Until that's done, the editor shows "The editor is locked" and changes nothing.

**Keep in mind:**

- Changes made in the editor live only on that copy of the site, not in `content/site.yml` or GitHub. The GitHub Pages copy, and a new copy of the site, show the built-in versions.
- Once a section has been changed in the editor, changing it in `content/site.yml` has no effect on that copy until someone chooses **Go back to the built-in version**.
- Uploading never touches the editor's changes. They're in `edits/` and `admin/data/` on the server, which aren't part of `dist/`. Don't delete those folders.
- Never upload an `.htaccess` file into `admin/`. cPanel keeps the password settings there, and replacing it switches the editor off.

**How it works:** the editor (`static/admin/index.php`) saves each changed section as a small HTML file in `edits/`, and every page pulls those in with Apache's server-side includes. Each page also carries its built-in version, which shows for any section that hasn't been changed, and everywhere if includes are switched off. `build.js` and `static/admin/render.php` write the same HTML for these sections, so a change to how they look goes in both.

**How it's kept safe:**

- cPanel's password is the lock, with one login per person. The editor won't work in a folder without one.
- It can change only these three sections, as plain text with length limits. Everything typed is escaped, so it can't add HTML, scripts or server-side includes. Web addresses starting with `https://` become links in the banner.
- Every form carries a secret token, so another website can't submit changes on someone's behalf, and no other site can show the editor in a frame.
- Its saved values and history are in `admin/data/`, which the web can't reach, even with the password.

## Editing with Pages CMS

[Pages CMS](https://pagescms.org) is a web editor for the files in `content/`. Saving in it commits the change to GitHub. Its settings are in `.pages.yml` at the repository root, with sections for Pages, Doctors & NPs, Practice details, Home page and Forms, and uploads for images and PDFs.

**First time:** go to [app.pagescms.org](https://app.pagescms.org), sign in with GitHub, install the Pages CMS GitHub app on `tfwvt` with access to `rfm_pub`, and open `rfm_pub`. To let someone at the practice edit, add them as a collaborator in Pages CMS or on the repository.

Saving Practice details, Home page or Forms in the editor rewrites that file and drops the explanatory comments in it. The settings themselves are kept.

## Editing by hand

Pages and clinicians start with a header in YAML, then the text in Markdown:

```markdown
---
title: Urgent Care
section: services
summary: Same-day appointments for established patients, Saturday morning hours and after-hours phone advice.
icon: plus
---

We set aside same-day appointments each day for our established patients…
```

Page header fields:

- `title` (required) and `menuTitle` (optional, a shorter name for menus and cards).
- `section`: `about`, `services`, `resources` or `topics`. Services appear as cards on the home page; topics (colds, COVID, tick bites) appear under "Before you call" and on Patient Resource Information.
- `summary`: one sentence, shown under the title, on cards and in search results.
- `icon`: the card's icon. The choices are listed in `ICONS` in `build.js` (e.g. `heart`, `plus`, `apple`, `file`).
- `image` and `imageAlt` (optional): photos at least 600 pixels wide span the page; smaller ones sit beside the text.
- `order` (optional): pages are listed in menu order; a number overrides that.
- `include` (optional): adds a generated section after the text: `clinicians`, `consultants`, `forms`, `topics` or `contact`.

Clinician fields: `name`, `credentials`, `role`, `group` (`physician`, `nurse-practitioner` or `consultant`), `order`, `photo` (leave empty to show initials) and `education` (a list of `title` and optional `place`).

Put a value in double quotes if it contains `: ` or starts with `*`, `"`, `[` or `>`.

**Markdown basics:**

- A blank line starts a new paragraph. End a line with `\` for a line break.
- `## ` at the start of a line makes a subheading. `## Billing policy {#billing-policy}` sets its link anchor.
- `- ` at the start of each line makes a list. `**bold**`, `*italics*`.
- Links: `[text](urgent-care)` to another page, `[text](documents/file.pdf)` to a PDF, `[text](https://…)` to another site. PDFs and other sites open in a new tab.
- `> ` at the start of a line makes a quotation.
- To highlight a passage, wrap it in `<div class="callout">` and `</div>`, with blank lines inside.

## Building and previewing

Run `npm install` once, then `npm run build` (Node 18 or newer). The finished site is in `dist/`. For the review copy at `/reviews/experiment01-review/`, run `npm run build:review` instead (see [Hosting](#hosting)).

The build stops and names the file if a header can't be read, and prints a warning for any link to a page or file that doesn't exist.

To preview, serve the folder that contains `rfm_pub` (e.g. `python3 -m http.server 8000 --directory ~/code`) and open `http://localhost:8000/rfm_pub/experiment01/dist/`. Pages link to `folder/` addresses, so open them through a web server rather than as files.

## Hosting

The site is hosted on GoDaddy Web Hosting Plus (2-year plan): cPanel, an Apache web server and a free AutoSSL certificate. GoDaddy serves files as they are (apart from `404.php` and the [editor](#editing-the-banner-and-hours)) and doesn't run the build, so the site is built here and `dist/` is uploaded.

**Review copy:** while the site is being developed, it's at <https://richmondfamilymedicine.org/reviews/experiment01-review/>, alongside the old site. Build it with `npm run build:review` and upload the contents of `dist/` to `public_html/reviews/experiment01-review/`. That build:

- tells search engines to leave it out (a `noindex` tag on every page, and a `noindex` header on every page and PDF), so it doesn't show up in Google next to the real site;
- points the "Page not found" page, its links and `404.php` into `/reviews/experiment01-review/`;
- leaves out `sitemap.xml` and `robots.txt`, which only belong at the domain root.

`npm run build` is the real site, for the root of the domain. Check which one you ran before uploading: the build's last line says "review copy" for the review build.

**Publishing the real site:**

1. `npm run build`.
2. Upload everything *inside* `dist/` (not the folder itself) to `public_html`, with cPanel's File Manager or by SFTP. The simplest way is to zip the contents of `dist/`, upload the zip in File Manager and choose Extract.
3. Make sure `.htaccess` went up too. It's a hidden file: Finder shows hidden files with Cmd+Shift+. and File Manager shows them under Settings → Show Hidden Files.
4. Uploading never deletes anything. If a page, photo or PDF was removed or renamed, delete the old one from `public_html` as well. Leave `edits/` and `admin/data/` alone: they hold the editor's changes.
5. The first time only: password-protect `admin/` in cPanel (see [Editing the banner and hours](#editing-the-banner-and-hours)).

The first time, replacing the old site: move the old site's files out of `public_html` (into a backup folder beside it) before uploading. Leave `.well-known/` and `reviews/` where they are. The new `.htaccess` replaces the old one.

**What `.htaccess` does** (it's `static/.htaccess`, copied into `dist/` by the build):

- Shows the site's "Page not found" page for any missing address, with the "not found" status. That page's links start from the site root, so it works at any depth. GoDaddy replaces Apache's own error pages with a bare "404 Not Found" line, whatever `.htaccess` says, so missing addresses go to `404.php` (in `static/`), a short script that sends `404.html` with the 404 status, with any sections changed in the editor filled in.
- Serves each folder's `index.html` and nothing else, so an old `index.php` left behind can't show instead (cPanel normally tries `index.php` first).
- Makes `https://richmondfamilymedicine.org/` the one address: `http://` and `www.` are redirected there (301). Other host names, such as a temporary address before the domain points here, aren't redirected.
- Leaves `/.well-known/` alone so AutoSSL can keep renewing the certificate.
- Turns on server-side includes for pages, so they show the sections changed in the editor, and sends `admin/` to the editor.
- Blocks file listings for folders like `/forms/`, and answers "not found" for hidden files such as `.DS_Store`.
- Lets browsers keep the fonts for a year and compresses pages. Pages, styles, photos and PDFs are checked for changes on every visit, so edits show up straight away.

Old addresses keep working: `/urgent-care` redirects to `/urgent-care/`, and PDF paths are unchanged, spaces included.

**The domain:** the old site and the review copy are both on this hosting account, so going live needs no DNS change, and the certificate already covers `richmondfamilymedicine.org` and `www.`. Leave the DNS as it is. In particular, keep the `MX` records (`aspmx.l.google.com` and the `alt` ones) and the `TXT` records: they carry the practice's Google Workspace email.

**GitHub Pages test copy:** every push to `main` also publishes the site at <https://tfwvt.github.io/rfm_pub/experiment01/>, built by `.github/workflows/pages.yml` at the repository root (Settings → Pages → Source must be "GitHub Actions"). It's for quick checks. Like the review copy, it's hidden from search engines. `.htaccess`, `404.php` and the editor do nothing on GitHub Pages, so a missing page shows GitHub's own "not found" page there, and pages show the built-in banner and hours. The workflow publishes the rest of the repository the way GitHub Pages always has.

**Pages CMS edits:** saving in Pages CMS commits to GitHub; it doesn't update GoDaddy. Each edit goes live only when someone builds and uploads again. A GitHub Actions workflow could do that on every commit (build, then upload by SFTP with the login stored as a GitHub secret).

## Sources

The content was copied from richmondfamilymedicine.org on 2026-10-30: all 32 pages, 9 clinician biographies, 22 images and 79 PDFs. Changes from the old site:

- Fixed typos: "Vemont", "Janynes", "Practioner", "Questionaire" (in labels; the PDF file names are unchanged), "each patients challenges".
- The 2–5 day well-child row linked to the 2½ year questionnaire and handout. It now links to `Newborn Questionnaire.pdf` and `Newborn Handout.pdf`, which were on the old server but not linked (the questionnaire is titled "2 to 5 Day (First Week) Visit").
- Two PDFs the old site linked to don't exist on its server: the 4 month questionnaire and the 2 year Bright Futures handout. Those slots are empty in `content/forms.yml` until the PDFs are added.
- Susan Jaynes's "coming soon" placeholder photo is replaced by her initials.
- A few cross-links were added (e.g. Pediatrics → the well-child forms, Chronic Disease Care → the diabetes handouts).

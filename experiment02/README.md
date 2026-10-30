# experiment02

A new website for [Richmond Family Medicine](https://richmondfamilymedicine.org), with a Vermont look (Green Mountain ridgelines, maple and forest colors, photos shown as framed snapshots) and built to be easy to edit.

Every page, biography, photo, form and handout from richmondfamilymedicine.org is here. The folders in `content/` mirror the site's menus, and each folder keeps its pages and photos together.

## Where everything is

```
content/
  practice.yml              Phone, fax, address, hours, portal link, announcement banner
  home/
    home.md                 The home page's headings and text
    images/                 Home page photos (building, Round Church, checkups, waiting room…)
  who-we-are/               The "Who We Are" menu: one .md file per page
    images/                 Staff photos, the front-door sign
  medical-services/         The "Medical Services" menu
    images/
  patient-resources/        The "Patient Resources" menu
    files/forms/            Forms patients fill out (PDF)
    files/handouts/         Education handouts (PDF)
    files/well-child/       Well-child questionnaires and handouts (PDF)
  health-topics/            Colds, COVID, tick bites: linked from the home page
  clinicians/               One .md file per doctor or nurse practitioner
    images/                 Their portraits
  site-images/              The logo, and the old site's buttons and icons (old-site/, not used)
theme/                      The design: styles.css, fonts, menu script. No need to touch it to edit content.
build.js                    Turns content/ into the finished site in dist/
```

A page's web address is its file name: `content/medical-services/urgent-care.md` is `/urgent-care/`, the same address as on the old site.

## Editing

1. Run `npm run watch` in this folder and leave it running. (Run `npm install` once first.)
2. Edit any file in `content/` and save. The site rebuilds within a second.
3. Refresh http://localhost:8000/rfm_pub/experiment02/dist/ to see the change.

If something's wrong in a file, the watch window says which file and what's wrong, and the site stays as it was until it's fixed.

In VS Code, the Markdown preview (`Ctrl+Shift+V`) shows a page with its photos while you edit.

### Common changes

| To… | Do this |
| --- | --- |
| Post a closure or other news on every page | Fill in `announcement:` in `content/practice.yml`. Empty it to remove the banner. |
| Change hours, phone or the portal link | Edit `content/practice.yml`. Every page picks it up. |
| Edit a page | Open its `.md` file and change the text. |
| Add a page | Copy a page in the same folder, rename it (the name becomes its address), and edit it. It appears in that folder's menu. |
| Reorder a menu | Change `order:` at the top of the pages. |
| Change a page's photo | Put the photo in the folder's `images/` and change `photo:` at the top of the page. |
| Add a clinician | Copy a file in `content/clinicians/`, rename it (e.g. `jane-smith-md.md`), edit it, and put their portrait in `content/clinicians/images/`. They appear on the home page, Doctors & NPs, and get their own page. |
| Remove a clinician | Delete their file, and their name from `who-we-are/our-story.md`. |
| Add a form | Put the PDF in `patient-resources/files/forms/`, then add a line to `patient-resources/forms-online.md`: `- [Form name](files/forms/the-file.pdf)` |

### Inside a page

Each page starts with a few settings between `---` lines, then the text:

```markdown
---
title: Urgent Care
summary: Same-day appointments for established patients, Saturday morning hours and after-hours phone advice.
icon: plus
photo: images/urgent-care.jpg
photo-description: A clinician wrapping a sprained wrist
order: 5
---

We set aside same-day appointments each day for our established patients…
```

- `title`: the page's heading. `menu-title` (optional) is a shorter name for menus and cards.
- `summary`: one sentence, shown under the title, on cards and in search results.
- `icon`: the picture on the page's card: clipboard, smile, heart, message, plus, activity, apple, mountain, file, book, info, link, lock, shield, thermometer, bug, users, award, briefcase, home, phone, pin, clock or maple.
- `photo` and `photo-description` (optional): shown as a framed snapshot beside the text.
- `order`: position in the menu (1 comes first).
- `style: cards` (optional): each `###` heading becomes a card, as on the Forms page.

Clinicians have `name`, `credentials`, `role`, `type` (`physician`, `nurse practitioner` or `consultant`), `order`, `photo` (leave it empty to show initials) and `education`, one line each, with ` — ` between the degree and the school.

If a setting contains `: ` or starts with a symbol, put it in double quotes.

**Writing the text (Markdown):**

- A blank line starts a new paragraph. End a line with `\` for a line break.
- `## Heading` and `### Smaller heading`. `## Billing policy {#billing-policy}` sets the link anchor.
- `- ` starts each line of a list. `**bold**`, `*italics*`.
- `> ` at the start of lines makes a highlighted note box.
- Links: `[Forms](forms-online)` to another page (its file name), `[Release form](files/forms/release-of-information.pdf)` to a file next to the page, `[CDC](https://www.cdc.gov)` to another site. PDFs and other sites open in a new tab.
- Photos: `![What it shows](images/photo.jpg "Optional caption")`. Photos on lines right after each other sit side by side.
- Ready-made sections, each on a line of its own: `{{ hours }}`, `{{ clinicians }}`, `{{ consultants }}`, `{{ services }}`, `{{ health-topics }}`, `{{ call-button }}`, `{{ portal-button }}`, `{{ directions-button }}`.

## Editing in a web browser (Pages CMS)

[Pages CMS](https://pagescms.org) edits the same files from a web page, so someone at the practice can make changes without any of the above. Its settings are in `.pages.yml` at the repository root and cover the practice details, every page, the clinicians, and photo and PDF uploads. The home page is edited by hand.

**First time:** go to [app.pagescms.org](https://app.pagescms.org), sign in with GitHub, install the Pages CMS app on `tfwvt` with access to `rfm_pub`, and open `rfm_pub`. Add people from the practice as collaborators. Saving commits to GitHub. If the host builds from GitHub (below), the live site updates a few minutes later.

Saving `practice.yml` in the editor drops the explanatory comments in it. The settings themselves are kept.

## Building and hosting

`npm run build` builds once (Node 18 or newer). The finished site is in `dist/`, a plain static site for any host. To build on the host the way `rmh_pub` does on DigitalOcean App Platform: source directory `experiment02`, build command `npm run build`, output directory `dist`, error document `404.html`.

## Sources

Copied from richmondfamilymedicine.org on 2026-10-30: all 32 pages, 9 clinician biographies, 31 images and 79 PDFs. The PDFs have new, readable names (e.g. `well-child/month-1-handout.pdf` instead of `Parent Paperwork/Month 1 Handout.pdf`). Changes from the old site:

- Fixed typos ("Vemont", "Janynes", "Practioner", "Questionaire", "each patients challenges").
- The 2–5 day well-child visit linked to the 2½ year forms. It now links to the newborn questionnaire and handout, which were on the old server but not linked.
- The old site linked to a 4 month questionnaire and a 2 year Bright Futures handout that don't exist on its server, so they're left out of the Forms page.
- Susan Jaynes's "photo coming soon" picture (kept in `clinicians/images/`) is replaced by her initials until there's a portrait.
- Added a few links between related pages, and captions on the photos.

// print.js — le document à lire ailleurs : /pdf (la page imprimable, un diaporama, ou le livre de toutes les pages, avec
// sa couverture, son sommaire aux numéros de page justes et ses liens), /copier (Markdown, ou mis en forme), et la
// forme Markdown du document avec ses résultats.
//
// Ce dont il a besoin de l'application lui est passé par setupPrint(app) (getDeck : le diaporama ouvert, qui change).

import { LANGS } from "./languages.js";
import { renderOutput, outputText, renderMarkdown, renderMermaid, highlight } from "./render.js";
import { phrasesIn } from "./gramalectica/index.js";
import { article } from "../examples/welcome.js";
import { frontMatter, isScience, analyze, titleBlock, references, resolveLine } from "./science.js";
import { isDeck, printDeck, fit as fitSlide } from "./deck.js";
import { checkMath } from "./preuve/index.js";

export function setupPrint(app) {
    const { S, WIKI, applyTheme, blockSource, cm, getDeck, deckEnv, dirOf, docParts, ensurePaths, esc, fileName, headings, katexHtml,
        linkTarget, linkTargetPath, pageName, phraseSpans, renderInline, renderPages, sciValues, showCells, snapPage, term, toast, when, mathActions } = app;

    /** Une sortie, en texte ou en Markdown (un tableau devient un tableau Markdown, un graphique ses données). */
    function outputMarkdown(o) {
        const fence = (t, lang = "text") => "```" + lang + "\n" + t.replace(/\n+$/, "") + "\n```";
        const table = (cols, rows) => [`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((v) => (v == null ? "" : String(v).replace(/\|/g, "\\|"))).join(" | ")} |`)].join("\n");
        if (o.output_type === "stream") return fence(outputText(o.text).replace(/\x1b\[[0-9;]*m/g, ""));
        if (o.output_type === "error") return fence(`${o.ename}: ${o.evalue}`);
        const d = o.data || {};
        const t = d["application/vnd.lumen.table+json"];
        if (t) return table(t.columns || [], t.rows || []);
        const c = d["application/vnd.lumen.chart+json"];
        if (c) return c.csv != null ? fence(String(c.csv), "csv") : table(c.columns || [], c.rows || []);
        if (d["text/markdown"]) return outputText(d["text/markdown"]);
        if (d["text/latex"]) return "$$\n" + outputText(d["text/latex"]).trim().replace(/^\$\$?|\$\$?$/g, "") + "\n$$";
        if (d["text/plain"] && !d["image/png"] && !d["image/svg+xml"]) return fence(outputText(d["text/plain"]));
        if (d["image/png"] || d["image/jpeg"] || d["image/svg+xml"]) return "*[figure]*";
        if (d["text/html"]) return "*[contenu HTML]*";
        return "";
    }

    /** Le document en Markdown, chaque résultat à sa place : sous la phrase (« → 970 »), sous le bloc. */
    function documentMarkdown(parts = docParts()) {
        const out = [];
        for (const p of parts) {
            if (p.kind === "text") {
                for (const l of p.lines) out.push(l.text, ...(l.results ? l.results.split("\n").map((r) => `→ ${r}`) : []));
                continue;
            }
            out.push("```" + (p.info || ""), p.code, "```");
            if (p.page) continue;   // HTML, LaTeX, Mermaid, CSV : le source est le contenu
            for (const o of p.outputs) { const md = outputMarkdown(o); if (md) out.push("", md); }
            if (p.outputs.length) out.push("");
        }
        return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    }

    /** Les énoncés vérifiés (preuve/) : sous la dernière ligne de chacun, son verdict ; leurs en-têtes, nommés. */
    function mathLines(lines) {
        const after = new Map(), heads = new Map();
        if (!lines.some((l) => l.includes("[!"))) return { after, heads };
        const ICON = { proved: "✓", false: "✗", unknown: "?", incomplete: "?", error: "✗" };
        for (const r of checkMath(lines, null, { actions: mathActions?.() })) {
            heads.set(r.head, `> **${r.name}**${r.title ? ` — ${esc(r.title)}` : ""}`);
            if (r.status === "skip") continue;   // (des mathématiques que la machine ne lit pas : rien à imprimer)
            after.set(r.end, `\n\n<div class="pf-print pf-${r.status}">${ICON[r.status]} ${esc(r.badge.charAt(0).toUpperCase() + r.badge.slice(1))}${r.status === "false" && r.detail ? ` — ${esc(r.detail.replace(/^Contre-exemple : /, ""))}` : ""}</div>\n`);
            heads.set(r.head, `> **${r.name}**${r.title ? ` — ${esc(r.title)}` : ""}`);
            if (r.proof) heads.set(r.proof.head, `> **${r.proof.name}.**`);
        }
        return { after, heads };
    }

    /**
     * L'article imprimé du mode scientifique : bloc de titre, sections numérotées, équations numérotées, figures et
     * tableaux légendés (les sorties du code aussi), renvois et citations résolus, valeurs calculées, références.
     */
    async function sciPrintView(parts) {
        const lines = cm.getValue().split("\n");
        const info = analyze(lines, S.blocks.map((b) => ({ start: b.start, end: b.end, lang: b.lang, info: b.info, code: blockSource(b) })));
        const values = sciValues();
        const root = document.createElement("article");
        root.id = "print-view";
        root.className = "md sci";
        const titleLine = lines.findIndex((l, i) => i > (info.fm?.end ?? -1) && /^#\s/.test(l));
        const title = titleLine >= 0 ? lines[titleLine].replace(/^#\s+/, "") : S.title;
        root.insertAdjacentHTML("beforeend", titleBlock(info.fm, title, (x) => renderInline(x, info, values)));
        const flush = (md) => { if (md.trim()) root.insertAdjacentHTML("beforeend", renderMarkdown(md)); };
        const math = mathLines(lines);
        for (const p of parts) {
            if (p.kind === "text") {
                let md = [];
                for (let i = 0; i < p.lines.length; i++) {
                    const l = p.lines[i];
                    if (info.fm && l.n <= info.fm.end) continue;
                    if (l.n === titleLine) continue;
                    const eq = info.equations.get(l.n);
                    if (eq) {
                        flush(md.join("\n")); md = [];
                        root.insertAdjacentHTML("beforeend", `<div class="sci-eq"><div class="sci-eq-tex">${katexHtml(eq.tex, true)}</div><div class="sci-eq-num">(${eq.num})</div></div>`);
                        while (i + 1 < p.lines.length && p.lines[i + 1].n <= eq.end) i++;
                        continue;
                    }
                    const f = info.figures.get(l.n);
                    if (f?.img) {
                        flush(md.join("\n")); md = [];
                        const m = /!\[[^\]]*\]\(\s*<?([^\s)>]+)/.exec(l.text);
                        root.insertAdjacentHTML("beforeend", `<figure><img src="${esc(m?.[1] || "")}" alt="${esc(f.cap)}"><figcaption>Figure ${f.num}${f.cap ? " – " + renderInline(f.cap, info, values) : ""}</figcaption></figure>`);
                        continue;
                    }
                    const tb = info.tables.get(l.n);
                    if (tb?.line) { flush(md.join("\n")); md = []; root.insertAdjacentHTML("beforeend", `<p class="sci-tabcap">Tableau ${tb.num} – ${renderInline(tb.cap, info, values)}</p>`); continue; }
                    const h = info.headings.get(l.n);
                    if (h) {
                        const text = l.text.replace(/^#+\s*/, "").replace(/\s*\{#[\w:.-]+\}\s*$/, "");
                        md.push(`${"#".repeat(h.level)} <span class="sci-num">${h.num}</span>${resolveLine(text, info, values)}`);
                        continue;
                    }
                    const th = info.theorems.get(l.n);
                    if (th) { md.push(`> <span class="sci-thm">${th.name}${th.num ? " " + th.num : ""}${th.title ? ` (${esc(th.title)})` : ""}.</span>`); if (math.after.has(l.n)) md.push(math.after.get(l.n)); continue; }
                    // (une phrase exécutable reste sur sa ligne : un retour à la ligne forcé)
                    const line = resolveLine(phraseSpans(l.text), info, values) + (phrasesIn(l.text).length ? "  " : "");
                    md.push(l.results ? `${line}\n\n<div class="pr-res">${esc(l.results)}</div>\n` : line);
                    if (math.after.has(l.n)) md.push(math.after.get(l.n));
                }
                flush(md.join("\n"));
                continue;
            }
            if (/^(bib|bibtex)$/i.test(p.info || "")) continue;   // la bibliographie : à la fin, en références
            const fig = info.figures.get(p.start), tab = info.tables.get(p.start);
            const cap = fig?.num ? ["Figure", fig] : tab?.num ? ["Tableau", tab] : null;
            const echo = !(fig || tab) || (fig || tab).echo;
            const box = document.createElement(cap ? "figure" : "section");
            box.className = "pr-block";
            const code = p.code.split("\n").filter((l) => !/^\s*(?:#|\/\/|--|%%|;)\|/.test(l)).join("\n");
            if (cap?.[0] === "Tableau") box.insertAdjacentHTML("beforeend", `<p class="sci-tabcap">Tableau ${cap[1].num}${cap[1].cap ? " – " + renderInline(cap[1].cap, info, values) : ""}</p>`);
            if (echo && (!p.page || !p.outputs.length)) box.insertAdjacentHTML("beforeend", `<pre class="pr-code cm-s-default"><code>${highlight(code, p.lang || p.info)}</code></pre>`);
            for (const o of p.outputs) {
                // un tableau interactif devient un tableau d'article (filets, nombres écrits à la française)
                const t = o.data?.["application/vnd.lumen.table+json"];
                if (t) {
                    const cell = (v) => esc(typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 6 }) : v ?? "");
                    box.insertAdjacentHTML("beforeend", `<table><thead><tr>${(t.columns || []).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${(t.rows || []).map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
                } else box.append(renderOutput(o, { dark: false }));
            }
            if (cap?.[0] === "Figure") box.insertAdjacentHTML("beforeend", `<figcaption>Figure ${cap[1].num}${cap[1].cap ? " – " + renderInline(cap[1].cap, info, values) : ""}</figcaption>`);
            root.append(box);
        }
        root.insertAdjacentHTML("beforeend", references(info));
        await renderMermaid(root, false);
        return root;
    }

    /** La page imprimable : le texte rendu, les phrases et leurs résultats, le code coloré, les sorties. */
    async function printView(parts = docParts(), { deck: asDeck = S.deckMode, notes = false } = {}) {
        if (asDeck) return printDeck(deckEnv(), { notes });
        if (S.sci.on) return sciPrintView(parts);
        const root = document.createElement("article");
        root.id = "print-view";
        root.className = "md";
        const math = mathLines(cm.getValue().split("\n"));
        for (const p of parts) {
            if (p.kind === "text") {
                const md = p.lines.map((l) => {
                    if (math.heads.has(l.n)) return math.heads.get(l.n) + (math.after.get(l.n) || "");
                    // Une phrase _…_ n'est pas de l'italique : elle garde son allure de phrase exécutable
                    let line = l.text, shift = 0;
                    for (const ph of phrasesIn(l.text)) {
                        const span = `<span class="pr-phrase">${esc(ph.text)}</span>`;
                        line = line.slice(0, ph.from + shift) + span + line.slice(ph.to + shift);
                        shift += span.length - (ph.to - ph.from);
                    }
                    return (l.results ? `${line}\n\n<div class="pr-res">${esc(l.results)}</div>\n` : line) + (math.after.get(l.n) || "");
                }).join("\n");
                if (md.trim()) root.insertAdjacentHTML("beforeend", renderMarkdown(md));
                continue;
            }
            const box = document.createElement("section");
            box.className = "pr-block";
            if (!p.page || !p.outputs.length) {
                const label = p.lang ? LANGS[p.lang]?.label || p.lang : p.info;
                box.insertAdjacentHTML("beforeend", `${label ? `<div class="pr-lang">${esc(label)}</div>` : ""}<pre class="pr-code cm-s-default"><code>${highlight(p.code, p.lang || p.info)}</code></pre>`);
            }
            for (const o of p.outputs) box.append(renderOutput(o, { dark: false }));
            root.append(box);
        }
        await renderMermaid(root, false);
        return root;
    }

    /**
     * Le livre : toutes les pages du document, dans l'ordre de l'arborescence (les pages d'un dossier, puis ses
     * sous-dossiers), avec une couverture et un sommaire aux liens cliquables. Chaque page se rend comme /pdf la rendrait
     * seule (texte, article du mode scientifique, diaporama — ses diapositives à la largeur de la page, deux par page).
     */
    async function bookView() {
        snapPage();
        ensurePaths();
        const cur = S.page, back = S.pages[cur];
        // l'ordre, comme un livre : celui des pages du document (les onglets) ; un dossier vient à sa première page, avec
        // toutes les siennes, puis ses sous-dossiers
        const dirs = [...term.dirs()];
        const cmp = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
        const first = (dir) => Math.min(...S.pages.map((p, k) => (p.path === dir || p.path.startsWith(dir + "/") ? k : Infinity)));
        const order = [];
        const walkDir = (dir, depth) => {
            const here = S.pages.map((p, k) => k).filter((k) => dirOf(S.pages[k].path) === dir);
            if (dir && (here.length || dirs.some((d) => d.startsWith(dir + "/")))) order.push({ dir, depth });
            for (const k of here) order.push({ k, depth: dir ? depth + 1 : 0 });
            for (const d of dirs.filter((x) => dirOf(x) === dir).sort((a, b) => first(a) - first(b) || cmp(a, b))) walkDir(d, depth + (dir ? 1 : 0));
        };
        walkDir("", 0);
        const root = document.createElement("article");
        root.id = "print-view";
        // « md » (la mise en forme du texte) va aux pages de texte, pas aux diapositives (le diaporama a la sienne)
        root.className = "book";
        const when = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        const title = pageName(0);
        root.insertAdjacentHTML("beforeend", `<section class="md book-cover"><div class="book-kicker">OmniNote</div><h1>${esc(title)}</h1><p>${S.pages.length} pages${dirs.length ? ` · ${dirs.length} dossier${dirs.length > 1 ? "s" : ""}` : ""} · ${esc(when)}</p></section>`);
        const toc = document.createElement("section");
        toc.className = "md book-toc";
        toc.id = "sommaire";
        toc.innerHTML = "<h1>Table des matières</h1>";
        const list = document.createElement("ol");
        toc.append(list);
        root.append(toc);
        const ready = [];
        // comme dans un livre : les dossiers sont des parties (I, II…), les pages des chapitres (1, 2…), leurs titres des
        // sections ; chaque ligne mène à sa page, et finit par son numéro de page (bookPageNumbers, à l'impression)
        const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
        const row = (href, title, num = "") => `<a class="toc-row" href="${href}">${num ? `<span class="toc-n">${esc(num)}</span>` : ""}<span class="toc-t">${esc(title)}</span><span class="toc-dots"></span><span class="toc-p" data-target="${esc(href.slice(1))}"></span></a>`;
        const prettyDir = (d) => { const t = d.split("/").pop().replace(/[-_]+/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
        let parts = 0, chapters = 0, allSci = true;
        const opening = S.opening;
        S.opening = true;   // (un document reçu par lien le reste)
        try {
            for (const item of order) {
                if (item.dir != null) {
                    // une partie mène à sa première page (le lien est posé quand elle arrive)
                    list.insertAdjacentHTML("beforeend", `<li class="toc-part" style="--d:${item.depth}"><a class="toc-row"><span class="toc-n">${ROMAN[parts] || parts + 1}</span><span class="toc-t">${esc(prettyDir(item.dir))}</span></a></li>`);
                    parts++;
                    continue;
                }
                const k = item.k, p = S.pages[k];
                S.page = k;
                showCells(p.cells || []);
                const name = pageName(k);
                const fm = frontMatter(cm.getValue().split("\n", 61));
                const slides = isDeck(fm);
                if (slides || !isScience(fm)) allSci = false;
                const view = slides ? printDeck(deckEnv({ dark: false }), { notes: false }) : await printView(docParts(), { deck: false });
                if (view.ready) ready.push(view.ready);
                const sec = document.createElement("section");
                sec.id = `page-${k}`;
                sec.className = `book-page ${slides ? view.className.replace(/\bmd\b/, "").trim() : view.className.includes("md") ? view.className : `md ${view.className}`}`;
                for (const a of list.querySelectorAll(".toc-part a:not([href])")) a.href = `#page-${k}`;
                const sub = [];
                if (slides) {
                    // les diapositives, réduites à la largeur de la page (deck.js : 1280 × 720), deux par feuille, centrées
                    let sheet = null;
                    [...view.querySelectorAll(".dk-page-print")].forEach((slide, i) => {
                        if (i % 2 === 0) { sheet = document.createElement("div"); sheet.className = "book-sheet"; sec.append(sheet); }
                        const box = document.createElement("div");
                        box.className = "book-slide";
                        box.append(slide);
                        sheet.append(box);
                        slide.id = `p${k}-diapo-${i + 1}`;
                        const t = slide.querySelector("h1, h2")?.textContent.trim();
                        if (t) sub.push([slide.id, t]);
                    });
                    for (const a of sec.querySelectorAll('a[href^="#diapo-"]')) a.setAttribute("href", `#p${k}-${a.getAttribute("href").slice(1)}`);
                    if (!sec.querySelector(".book-slide")) sec.insertAdjacentHTML("beforeend", "<p>(aucune diapositive)</p>");
                } else {
                    sec.append(...view.childNodes);
                    [...sec.querySelectorAll("h1, h2")].forEach((h, i) => { h.id = `p${k}-t${i}`; if (i && h.tagName === "H2") sub.push([h.id, h.textContent.trim().replace(/^(\d+(?:\.\d+)*)(?=\p{L})/u, "$1 ")]); });
                }
                bookLinks(sec, k);
                root.append(sec);
                const li = document.createElement("li");
                li.className = "toc-page";
                li.style.setProperty("--d", item.depth);
                li.innerHTML = row(`#page-${k}`, name, String(++chapters));
                if (sub.length) {
                    const ul = document.createElement("ul");
                    ul.innerHTML = sub.filter(([, t]) => t !== name).slice(0, 30).map(([id, t]) => `<li>${row(`#${id}`, t)}</li>`).join("");
                    li.append(ul);
                }
                list.append(li);
            }
        } finally {
            // la page qu'on lisait revient, avec son annulation et sa position
            S.page = cur;
            showCells(back.cells || []);
            if (back.hist) cm.setHistory(back.hist);
            if (back.cur) cm.setCursor(back.cur);
            if (back.top != null) cm.scrollTo(null, back.top);
            S.opening = opening;
            renderPages();
        }
        // moderne ; à la manière d'un article (romain, LaTeX) quand toutes les pages sont en mode scientifique
        if (allSci && S.pages.length) root.classList.add("book-sci");
        await renderMermaid(root, false);
        root.ready = Promise.all(ready).catch(() => {});
        return root;
    }

    /**
     * Les numéros de page du sommaire : le livre mis en pages comme à l'impression (A4 ; un article, ses marges à lui),
     * chaque page du document commençant une nouvelle feuille. Ce qui ne se coupe pas (code, tableau, figure, équation,
     * diapositive) passe à la feuille suivante s'il n'y tient plus ; le texte, lui, continue.
     */
    function bookPageNumbers(view) {
        const MM = 96 / 25.4, at = new Map();
        const AVOID = "pre, table, figure, img, svg, .pr-block, .pr-code, .out-rich, .math-block, .pr-res, .sci-eq, .book-slide";
        let page = 0, y = 0, H = 0;
        const mark = (e, dy) => { if (e.id && !at.has(e.id)) at.set(e.id, page + Math.floor((y + dy) / H)); };
        // les enfants d'un élément, l'un après l'autre ; un bloc plus haut qu'une feuille est parcouru à son tour
        const flow = (box) => {
            const kids = [...box.children];
            const top0 = box.getBoundingClientRect().top, end = box.getBoundingClientRect().height;
            kids.forEach((c, i) => {
                // une feuille de diapositives : une page à elle
                if (c.classList.contains("book-sheet")) {
                    if (y > 0) { page++; y = 0; }
                    for (const e of c.querySelectorAll("[id]")) mark(e, 0);
                    if (i + 1 < kids.length) page++;
                    else y = H;
                    return;
                }
                const top = c.getBoundingClientRect().top - top0;
                const h = Math.max(0, (i + 1 < kids.length ? kids[i + 1].getBoundingClientRect().top - top0 : end) - top);
                if (h > H && c.children.length > 1 && !c.matches("pre, table, .book-slide")) {
                    if (c.matches(AVOID) && y > 0) { page++; y = 0; }   // (« ne pas couper » : il commence une feuille, puis se coupe)
                    mark(c, 0);
                    flow(c);
                    return;
                }
                const whole = c.matches(AVOID) || (h < H && c.querySelector(AVOID));
                if (whole && y > 0 && y + h > H) { page++; y = 0; }
                // un titre ne reste pas seul en bas de feuille : il part avec le début de ce qui le suit
                else if (/^H[1-4]$/.test(c.tagName) && y > 0 && i + 1 < kids.length) {
                    const n = kids[i + 1], nh = n.getBoundingClientRect().height, keep = n.matches(AVOID) || n.querySelector(AVOID) ? Math.min(nh, H) : Math.min(nh, 48);
                    if (y + h + keep > H) { page++; y = 0; }
                }
                const ct = c.getBoundingClientRect().top;
                for (const e of [c, ...c.querySelectorAll("[id]")]) mark(e, e.getBoundingClientRect().top - ct);
                y += h;
                // une feuille coupée ne se remplit pas au pixel près (des lignes entières, veuves et orphelines)
                while (y > H + 1) { page++; y -= H - 10; }
            });
        };
        for (const sec of view.children) {
            page++;
            y = 0;
            const sci = sec.classList.contains("sci");
            H = (sci ? 297 - 25 - 27 : 297 - 16 - 20) * MM;
            if (sec.id) at.set(sec.id, page);
            const old = sec.style.width;
            if (sci) sec.style.width = `${210 - 48}mm`;
            flow(sec);
            sec.style.width = old;
        }
        for (const span of view.querySelectorAll(".toc-p")) span.textContent = at.get(span.dataset.target) ?? "";
    }

    /** Dans le livre, les liens entre les pages ([[Calculs]], [texte](projet/calculs.md)) mènent à leur page du livre */
    function bookLinks(sec, k) {
        const here = dirOf(S.pages[k].path);
        for (const a of sec.querySelectorAll("a[href]")) {
            const href = a.getAttribute("href");
            if (/^(https?:|mailto:|#)/i.test(href)) continue;
            const path = linkTargetPath(href, here);
            const j = S.pages.findIndex((p) => p.path === path || p.path === path + ".md");
            if (j >= 0) a.setAttribute("href", `#page-${j}`);
        }
        const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT), nodes = [];
        while (walker.nextNode()) if (walker.currentNode.nodeValue.includes("[[") && !walker.currentNode.parentElement.closest("pre, code")) nodes.push(walker.currentNode);
        for (const t of nodes) {
            const v = t.nodeValue, frag = document.createDocumentFragment();
            let last = 0;
            for (const m of v.matchAll(WIKI)) {
                frag.append(v.slice(last, m.index));
                const j = linkTarget(m[1], true);   // (depuis le dossier de la page k : c'est la page en cours)
                const a = document.createElement(j >= 0 ? "a" : "span");
                if (j >= 0) a.href = `#page-${j}`;
                a.className = "book-link";
                a.textContent = m[2] || m[1];
                frag.append(a);
                last = m.index + m[0].length;
            }
            frag.append(v.slice(last));
            t.replaceWith(frag);
        }
    }

    /**
     * /pdf : la page imprimable, que le navigateur enregistre en PDF (texte sélectionnable, figures vectorielles).
     * Un diaporama (en mode présentation, ou depuis sa barre) : une diapositive par page au format de l'écran, sans
     * marges ni en-têtes du navigateur ; { notes } : une page A4 par diapositive avec ses notes.
     */
    async function exportPdf({ notes = false, deck: asDeck = S.deckMode || !!getDeck(), book = S.pages.length > 1 && !getDeck() && !notes } = {}) {
        toast(book ? `Préparation du livre : ${S.pages.length} pages…` : "Préparation du PDF…");
        document.querySelector("#print-view")?.remove();
        if (book) asDeck = false;
        // Le document : toujours en clair sur papier. Un diaporama : le style que l'on voit à l'écran (deck.js)
        const view = book ? await bookView() : await printView(undefined, { deck: asDeck, notes });
        if (!asDeck) document.documentElement.dataset.theme = "light";
        document.body.append(view);
        document.body.classList.add("printing");
        const slides = view.classList.contains("deck-print");
        // le livre : ses pages numérotées en bas (pas la couverture), comme un livre ; mêmes marges que bookPageNumbers
        const folio = view.classList.contains("book-sci") ? '@bottom-right { content: counter(page); font: 9.5pt "CMU Serif", Georgia, serif; color: #444; }'
            : '@bottom-right { content: counter(page); font: 600 8.5pt Inter, system-ui, sans-serif; color: #71717a; }';
        const css = slides ? (notes ? "@page { size: A4; margin: 14mm 15mm; }" : "@page { size: 1280px 720px; margin: 0; }")
            : book ? `@page { size: A4; margin: 16mm 15mm 20mm; ${folio} } @page couverture { margin: 16mm 15mm 20mm; @bottom-right { content: none; } }` : "";
        const page = css ? Object.assign(document.createElement("style"), { textContent: css }) : null;
        if (page) document.head.append(page);
        const title = document.title;
        document.title = S.title || fileName();   // le nom proposé pour le fichier
        const done = () => {
            window.removeEventListener("afterprint", done);
            document.body.classList.remove("printing");
            view.remove();
            page?.remove();
            document.title = title;
            applyTheme();
        };
        window.addEventListener("afterprint", done);
        // Les polices d'abord (la mise à l'échelle des diapositives en dépend), les schémas, puis les images et cadres
        await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 3000))]);
        await view.ready;
        if (slides || book) {
            // dans le livre, une diapositive occupe toute sa page : son texte grandit tant qu'il tient
            view.querySelectorAll(".dk-slide").forEach((s) => fitSlide(s, { grow: book ? 1.7 : 1 }));
            // avec les notes (et dans le livre), la diapositive est réduite à la largeur de la page : par zoom, pas par
            // transform, pour que l'impression la découpe à sa vraie taille (sinon le bas d'une diapositive passe à la feuille suivante)
            for (const box of view.querySelectorAll(".dk-hslide, .book-slide")) box.firstElementChild.style.zoom = box.clientWidth / 1280;
        }
        if (book) bookPageNumbers(view);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 400)));
        window.print();
    }

    async function copyDocument() {
        const parts = docParts();
        const md = documentMarkdown(parts);
        try {
            const view = await printView(parts, { deck: false });
            const html = `<meta charset="utf-8">${view.innerHTML}`;
            await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([md], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
            toast("Document et résultats copiés : Markdown, ou mis en forme selon où on colle");
        } catch {
            try { await navigator.clipboard.writeText(md); toast("Document et résultats copiés en Markdown"); }
            catch { toast("Le presse-papiers est refusé par le navigateur"); }
        }
    }

    return { exportPdf, copyDocument, printView, documentMarkdown, outputMarkdown };
}

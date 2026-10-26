// deck.js — le mode présentation : le document devient un diaporama, sans rien choisir, et son code s'exécute.
//
// Il s'active par l'en-tête du document (« mode: présentation »), ou à tout moment par /présenter (F5). Le texte
// reste notre Markdown : les blocs ```python, ```java… s'exécutent sur la diapositive (on peut aussi y modifier le
// code), les phrases _…_ affichent leur résultat. Les conventions viennent de Slidev, pour qui les connaît :
//
//   ---                          entre deux diapositives (sans aucun « --- », chaque titre # ou ## en commence une)
//   ---                          un en-tête de diapositive juste après le séparateur, refermé par « --- »
//   layout: image-droite           (disposition, transition, fond, clics : voir KEYS)
//   ---
//   <!-- clic -->                 la suite apparaît au clic suivant (comme une animation de PowerPoint)
//   <!-- clics -->                la liste qui suit apparaît point par point (aussi <v-clicks> … </v-clicks>)
//   <v-click> … </v-click>        ce morceau apparaît à son tour ; at="3" à l'étape 3, at="+2" deux clics plus loin,
//                                 at="[2, 4]" visible de 2 à 3 ; <v-click hide>, <v-click-hide> : disparaît au clic ;
//                                 <v-after> : en même temps que le clic précédent
//   ```python {2|3-4|all}         les lignes surlignées, étape par étape (comme Slidev) ; {*} ou {all} : tout
//   ````md magic-move             plusieurs blocs ``` à la suite dans un seul : le code se transforme à chaque clic
//   <span v-mark.circle.red="2">  souligner, entourer, encadrer… un mot au clic (underline, circle, box, highlight,
//                                 strike-through, crossed-off, bracket ; red, orange, yellow, green, blue…)
//   ::droite::                    la suite va dans la colonne de droite (aussi ::right::)
//   ![Légende](photo.jpg)         une image : à côté du texte, dessous, seule sous le titre (figure) ou à plusieurs
//                                 (galerie), toujours entière, à la plus grande taille où elle tient ;
//                                 layout: image-droite + image: photo.jpg : la moitié de la diapositive, bord à bord
//   <!-- n'importe quoi d'autre --> notes de l'orateur (vue présentateur : P ; sous la diapositive : N)
//   #| exécuter: clic             dans un bloc : il s'exécute au clic (auto : en arrivant sur la diapositive) ;
//   #| clic: oui   #| echo: false   il apparaît au clic ; seul son résultat se montre
//   [Démo](#4)  [Suite](#suivant)  [▶](#executer)  des boutons : aller à une diapositive (numéro ou titre),
//                                                  exécuter le code de la diapositive
//
// La disposition se devine (couverture, section, citation, chiffre, image à côté du texte, code et résultat
// côte à côte…), le texte se réduit s'il déborde, et d'une diapositive à l'autre ce qui se retrouve glisse à sa
// nouvelle place (un titre, une image, les lignes d'un code qui change : comme le « Magic Move » de Keynote).

import { renderMarkdown, renderMermaid, highlightLines, renderOutput } from "./render.js";

const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yes = (v) => /^(oui|yes|true|vrai|1|on)$/.test(fold(v ?? "").trim());
const W = 1280, H = 720;

export const isDeck = (fm) => !!fm && /^(presentation|diapo|slides?|diaporama)/.test(fold(fm.fields.mode || ""));

// Les champs d'un en-tête de diapositive (ou d'un commentaire <!-- disposition: … -->)
const KEYS = { layout: "layout", disposition: "layout", mise: "layout", class: "class", classe: "class", transition: "transition",
    fond: "background", background: "background", clics: "clicks", clicks: "clicks", image: "image",
    apparition: "enter", apparitions: "enter", animation: "enter", entree: "enter" };

// Les styles : chacun sa palette, ses polices, son fond. Sans « thème: » dans l'en-tête, le document choisit (pickTheme).
export const THEMES = {
    classique: { label: "Classique", light: null },    // null : clair ou sombre comme l'éditeur
    minuit: { label: "Minuit", light: false },
    latex: { label: "LaTeX", light: true },      // à la manière de Beamer : Computer Modern, bleu de structure
    terminal: { label: "Terminal", light: false },
    pop: { label: "Pop", light: true },
};
const THEME_ALIAS = { aurore: "classique", sobre: "classique", neon: "terminal", console: "terminal", papier: "latex", beamer: "latex", tex: "latex" };
// Les apparitions : comment les éléments arrivent sur la diapositive (et à chaque clic)
export const ENTERS = ["cascade", "mots", "douce", "zoom", "glisse", "machine", "aucune"];
const ENTER_ALIAS = { cascade: "cascade", douce: "douce", fondu: "douce", fade: "douce", zoom: "zoom", glisse: "glisse", slide: "glisse",
    mots: "mots", "mot-a-mot": "mots", words: "mots", machine: "machine", "machine-a-ecrire": "machine", typewriter: "machine", aucune: "aucune", none: "aucune", auto: null, smart: null };

/**
 * Le style du diaporama : celui de l'en-tête (« thème: terminal », « thème: classique sombre »), sinon d'après le contenu —
 * beaucoup de code : terminal ; des formules : latex ; sinon classique. → { name, light (true, false, null) }
 */
export function pickTheme(slides, fm) {
    const asked = fold(fm?.fields.theme || fm?.fields.style || "").trim();
    const light = /\b(clair|light)\b/.test(asked) ? true : /\b(sombre|dark)\b/.test(asked) ? false : undefined;
    const word = asked.split(/\s+/)[0] || "";
    const name = THEMES[word] ? word : THEME_ALIAS[word];
    if (name) return { name, light: light ?? THEMES[name].light };
    const withCode = slides.filter((s) => s.items.some((it) => it.t === "block" && it.lang && !it.page)).length;
    const math = slides.filter((s) => s.items.some((it) => it.t === "line" && /\$\$|\\\[|\$[^$\s][^$]*\$/.test(it.text))).length;
    if (slides.length && withCode / slides.length >= .5) return { name: "terminal", light: light ?? false };
    if (slides.length && math / slides.length >= .3) return { name: "latex", light: light ?? true };
    return { name: "classique", light: light ?? null };
}
const enterOf = (v) => ENTER_ALIAS[fold(v || "").trim().replace(/\s+/g, "-")];
const LAYOUTS = {
    cover: "couverture", couverture: "couverture", titre: "couverture", intro: "couverture",
    section: "section", end: "fin", fin: "fin", center: "centre", centre: "centre",
    "two-cols": "colonnes", "deux-colonnes": "colonnes", colonnes: "colonnes",
    "image-right": "image-droite", "image-droite": "image-droite", "image-left": "image-gauche", "image-gauche": "image-gauche",
    image: "image", "image-pleine": "image", figure: "figure", "image-centre": "figure", "image-centree": "figure",
    galerie: "galerie", gallery: "galerie", images: "galerie", quote: "citation", citation: "citation",
    statement: "annonce", fact: "annonce", annonce: "annonce", chiffre: "annonce",
    default: "standard", standard: "standard", code: "code",
};
const META = /^\s*([\p{L}_-]+)\s*:\s*(.*)$/u;
const SEP = (it) => it.t === "line" && /^-{3,}\s*$/.test(it.text);
const GUI = /\b(tkinter|Tkinter|javax\.swing|java\.awt|JFrame|QApplication|pygame|turtle)\b/;

// ---------------------------------------------------------------- le découpage

/**
 * Les diapositives d'un document (les morceaux de docParts : texte ligne à ligne, blocs de code) :
 * [{ line, meta, items }] ; items : { t: "line", n, text, results } ou { t: "block", … }.
 */
export function parseDeck(parts, fm = null) {
    const items = [];
    for (const p of parts) {
        if (p.kind === "text") { for (const l of p.lines) if (!(fm && l.n <= fm.end)) items.push({ t: "line", ...l }); }
        else items.push({ t: "block", ...p });
    }
    const bySep = items.some(SEP);
    const slides = [];
    let cur = null;
    const lineOf = (it) => it?.n ?? it?.start ?? 0;
    const begin = (n) => { cur = { line: n, meta: {}, items: [] }; slides.push(cur); };
    const filled = (s) => s.items.some((it) => it.t === "block" || (it.text.trim() && !/^\s*<!--[\s\S]*-->\s*$/.test(it.text)));
    begin(lineOf(items[0]));
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (bySep && SEP(it)) {
            // un en-tête « clé: valeur » refermé par « --- » (comme Slidev) ; sinon, du texte ordinaire
            const meta = {};
            let j = i + 1, m;
            while (j < items.length && items[j].t === "line" && (m = META.exec(items[j].text)) && KEYS[fold(m[1])]) { meta[KEYS[fold(m[1])]] = m[2].trim(); j++; }
            const header = j > i + 1 && j < items.length && SEP(items[j]);
            if (header) i = j;
            begin(lineOf(items[i + 1]) || lineOf(it));
            if (header) cur.meta = meta;
            continue;
        }
        if (!bySep && it.t === "line" && /^#{1,2}\s/.test(it.text) && filled(cur)) begin(it.n);
        cur.items.push(it);
    }
    return slides.filter((s) => filled(s) || Object.keys(s.meta).length);
}

/** Le titre d'une diapositive : son premier titre, sinon sa première ligne de texte (sans la mise en forme). */
export function slideTitle(slide, max = 42) {
    const lines = slide.items.filter((it) => it.t === "line").map((it) => it.text.trim());
    const t = (lines.find((l) => /^#{1,6}\s/.test(l)) || lines.find((l) => l && !/^(<|::|\||>|!\[|-{3,}$)/.test(l)) || "")
        .replace(/^#+\s*/, "").replace(/\s*\{#[\w:.-]+\}\s*$/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").replace(/^[-+]\s+/, "").trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * Où mène un lien interne « #… » depuis la diapositive i : { k } (une diapositive), { run } (exécuter son code),
 * ou null. #4 · #suivant · #precedent · #debut · #fin · #executer · #un-titre (comme les ancres des titres).
 */
export function targetOf(slides, i, raw) {
    const t = fold(decodeURIComponent(raw)).trim();
    const slug = (x) => fold(x).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
    if (/^(executer|run|lancer)$/.test(t)) return { run: true };
    const k = /^\d+$/.test(t) ? +t - 1 : /^(suivant|suivante|next)$/.test(t) ? i + 1 : /^(precedent|precedente|prev|previous)$/.test(t) ? i - 1
        : /^(debut|start|first)$/.test(t) ? 0 : /^(fin|end|last)$/.test(t) ? slides.length - 1
        : slides.findIndex((s) => s.items.some((it) => it.t === "line" && /^#{1,6}\s/.test(it.text) && slug(it.text.replace(/^#+\s*/, "").replace(/\s*\{#[\w:.-]+\}\s*$/, "")) === slug(t)));
    return k >= 0 && k < slides.length ? { k, step: /^(suivant|suivante|next|precedent|precedente|prev|previous)$/.test(t) ? t : null } : null;
}

// ---------------------------------------------------------------- une diapositive

/**
 * Le rendu d'une diapositive : { el, steps, actions, cells, notes, layout }.
 * env : ce que l'éditeur prête (phraseLine, outputs, run, setCode, langLabel, fm, title).
 */
export function renderSlide(slide, env, { index = 0, total = 1, thumb = false } = {}) {
    const meta = { ...slide.meta };
    const el = document.createElement("section");
    el.className = "dk-slide";
    el.innerHTML = '<div class="dk-frame"><header class="dk-head"></header><div class="dk-body"><div class="dk-main"></div><div class="dk-side"></div></div></div>';
    const main = el.querySelector(".dk-main"), side = el.querySelector(".dk-side");
    let slot = main, md = [], cur = 0, until = 0, count = 0, saved = [], prog = null;
    const notes = [], actions = [], cells = [], effects = [];
    const progressAll = yes(meta.clicks);

    const flush = () => {
        const text = md.join("\n");
        md = [];
        if (!text.trim()) return;
        const box = document.createElement("div");
        box.className = "dk-chunk";
        box.innerHTML = renderMarkdown(text);
        theoremBlocks(box);
        if (cur) box.dataset.step = cur;
        if (until) box.dataset.until = until;
        marks(box);
        if (prog || progressAll) {
            const lis = box.querySelectorAll("li");
            for (const li of lis) li.dataset.step = ++count;
            if (lis.length && prog === "once") prog = null;
        }
        slot.append(box);
    };
    const directive = (body) => {
        const f = fold(body).trim();
        if (/^(clic|click|pause|suite)$/.test(f)) { flush(); cur = ++count; return; }
        if (/^(clics|clicks|liste au clic)$/.test(f)) { flush(); prog = "once"; return; }
        const m = META.exec(body);
        if (m && KEYS[fold(m[1])]) { meta[KEYS[fold(m[1])]] = m[2].trim(); return; }
        notes.push(body.trim().replace(/^notes?\s*:\s*/i, ""));
    };
    let comment = null;
    for (const it of slide.items) {
        if (it.t === "block") { flush(); cells.push(cell(it)); continue; }
        const t = it.text.trim();
        if (comment != null) {
            comment += "\n" + it.text;
            if (t.includes("-->")) { const [body, rest] = comment.split("-->"); comment = null; directive(body); if (rest.trim()) md.push(rest); }
            continue;
        }
        const one = /^<!--([\s\S]*?)-->\s*$/.exec(t);
        if (one) { directive(one[1]); continue; }
        if (t.startsWith("<!--")) { comment = t.slice(4); continue; }
        if (/^::\s*(droite|right)\s*::$/i.test(t)) { flush(); slot = side; continue; }
        if (/^::\s*(gauche|left|default)\s*::$/i.test(t)) { flush(); slot = main; continue; }
        if (/^<v-clicks\b[^>]*>$/i.test(t)) { flush(); prog = "block"; continue; }
        if (/^<\/v-clicks>$/i.test(t)) { flush(); prog = null; continue; }
        const vc = /^<(v-click|v-after|v-click-hide)\b([^>]*)>$/i.exec(t);
        if (vc) { flush(); saved.push([cur, until]); [cur, until] = clickRange(vc[1].toLowerCase(), vc[2]); continue; }
        if (/^<\/(v-click|v-after|v-click-hide)>$/i.test(t)) { flush(); [cur, until] = saved.pop() ?? [0, 0]; continue; }
        md.push(env.phraseLine(it));
    }
    flush();

    /** <v-click>, at="3", at="+2", at="[2, 4]", hide, <v-after>, <v-click-hide> → [apparaît à, disparaît à] */
    function clickRange(tag, attrs) {
        const at = /:?at\s*=\s*"([^"]*)"|:?at\s*=\s*'([^']*)'/.exec(attrs);
        const v = at ? (at[1] ?? at[2]).trim() : "";
        const hide = tag === "v-click-hide" || /\bhide\b/.test(attrs);
        let from;
        const range = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/.exec(v);
        if (range) { count = Math.max(count, +range[2]); return [+range[1], +range[2]]; }
        if (tag === "v-after") from = count;
        else if (/^\d+$/.test(v)) { from = +v; count = Math.max(count, from); }
        else if (/^\+\d+$/.test(v)) { from = count + +v.slice(1); count = from; }
        else from = ++count;
        return hide ? [0, Math.max(from, 1)] : [from, 0];
    }
    /** <span v-mark.circle.red="2"> : la marque se trace à l'étape dite (ou au clic suivant) */
    function marks(box) {
        for (const e of box.querySelectorAll("*")) {
            const a = [...e.attributes].find((x) => /^v-mark\b/i.test(x.name));
            if (!a) continue;
            const mods = a.name.toLowerCase().split(".").slice(1);
            const v = a.value.trim();
            const at = /^\d+$/.test(v) ? (count = Math.max(count, +v), +v) : /^\+\d+$/.test(v) ? (count += +v.slice(1)) : ++count;
            const type = mods.find((m) => MARKS[m]) || "underline";
            const color = mods.map((m) => MARK_COLORS[m]).find(Boolean) || "var(--dk-a)";
            e.removeAttribute(a.name);
            e.classList.add("dk-vmark", `dk-vmark-${type}`);
            e.style.setProperty("--mk", color);
            effects.push({ from: at, apply: (on, animate) => drawMark(e, type, on, animate) });
        }
    }

    /** Un bloc de code : le code coloré (modifiable), son langage, ▶, et ses résultats à côté ou dessous. */
    function cell(b) {
        if (fold(b.info || "") === "md" && /\bmagic-move\b/.test(b.extra || "")) return magicMove(b);
        const opts = cellOptions(b.code);
        const all = b.code.split("\n"), isOpt = (l) => /^\s*(?:#|\/\/|--|%%|;|\*>)\|/.test(l);
        const code = all.filter((l) => !isOpt(l)).join("\n");
        const head = all.filter(isOpt).map((l) => l + "\n").join("");   // les options restent dans le document
        const lang = b.lang || "";
        const fig = document.createElement("figure");
        fig.className = "dk-cell";
        const show = !b.page && !/^(false|non|no)$/.test(fold(opts.echo || ""));
        if (show) {
            fig.innerHTML = `<div class="dk-cell-code"><div class="dk-cell-bar"><span class="dk-lang">${esc(env.langLabel(lang, b.info))}</span><span class="dk-status"></span>` +
                (lang ? '<button type="button" class="dk-run" title="Exécuter (Maj Entrée)"><svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>Exécuter</button>' : "") +
                `</div><pre class="dk-code cm-s-lumen"><code spellcheck="false"></code></pre></div>`;
            paint(fig.querySelector("code"), code, lang || b.info);
        }
        fig.insertAdjacentHTML("beforeend", '<div class="dk-out"></div>');
        if (b.page) fig.classList.add("dk-page");
        if (!show) fig.classList.add("dk-noecho");
        const c = { open: b.open, lang, fig, code, head, gui: GUI.test(b.code), runnable: !!lang };
        let step = cur;
        if (yes(opts.clic || opts.click)) step = ++count;
        if (step) fig.dataset.step = step;
        if (until) fig.dataset.until = until;
        const run = fold(opts.executer || opts.run || opts.exec || "");
        if (/^(clic|click)/.test(run)) actions.push({ step: step > cur ? step : ++count, cell: c });
        else if (/^(auto|oui|yes|true)/.test(run) || b.page) actions.push({ step: step, cell: c, auto: true });
        // ```python {2|3-4|all} : les lignes surlignées, étape par étape
        const hl = highlightSteps(b.meta);
        if (hl && show) {
            const pre = fig.querySelector(".dk-code");
            pre.classList.add("dk-hl");
            const froms = hl.map((_, k) => (k === 0 ? step : ++count));
            hl.forEach((set, k) => effects.push({ from: froms[k], to: froms[k + 1] ?? Infinity, apply: (on) => {
                if (!on) return;
                pre.querySelectorAll(".dk-l").forEach((l, i) => { l.classList.toggle("dim", !!set && !set.has(i + 1)); l.classList.toggle("lit", !!set && set.has(i + 1)); });
            } }));
        }
        slot.append(fig);
        return c;
    }

    /** ````md magic-move : plusieurs versions d'un code ; à chaque clic, il se transforme en la suivante */
    function magicMove(b) {
        const frames = [];
        let f = null;
        for (const l of b.code.split("\n")) {
            const o = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(l);
            if (!f && o) { f = { lang: o[2], fence: o[1], lines: [] }; continue; }
            if (f && new RegExp(`^\\s*${f.fence[0] === "`" ? "`" : "~"}{${f.fence.length},}\\s*$`).test(l)) { frames.push(f); f = null; continue; }
            if (f) f.lines.push(l);
        }
        if (f) frames.push(f);
        if (!frames.length) frames.push({ lang: "", lines: [""] });
        const fig = document.createElement("figure");
        fig.className = "dk-cell dk-magic";
        const lang = fenceLabel(frames[0].lang);
        fig.innerHTML = `<div class="dk-cell-code"><div class="dk-cell-bar"><span class="dk-lang">${esc(env.langLabel(lang, frames[0].lang))}</span><span class="dk-status"></span></div><pre class="dk-code cm-s-lumen"><code spellcheck="false"></code></pre></div><div class="dk-out"></div>`;
        const codeEl = fig.querySelector("code");
        paint(codeEl, frames[0].lines.join("\n"), frames[0].lang);
        if (cur) fig.dataset.step = cur;
        if (until) fig.dataset.until = until;
        let shown = 0;
        const froms = frames.map((_, k) => (k === 0 ? cur : ++count));
        frames.forEach((fr, k) => effects.push({ from: froms[k], to: froms[k + 1] ?? Infinity, apply: (on, animate, scale) => {
            if (!on || shown === k) return;
            shown = k;
            if (animate) morphInPlace(codeEl, fr.lines.join("\n"), fr.lang); else paint(codeEl, fr.lines.join("\n"), fr.lang);
        } }));
        slot.append(fig);
        return { open: null, lang: "", fig, code: frames[0].lines.join("\n"), head: "", gui: false, runnable: false, magic: true };
    }

    // ---- la disposition
    const pics = standalone(main);
    let layout = LAYOUTS[fold(meta.layout || "")] || (meta.image ? "image-droite" : guess());
    function guess() {
        if (side.childElementCount) return "colonnes";
        if (cells.length) return "code";
        const kids = [...main.querySelectorAll(":scope > .dk-chunk > *")];
        const heads = kids.filter((k) => /^H[1-3]$/.test(k.tagName));
        const body = kids.filter((k) => !/^H[1-6]$/.test(k.tagName));
        const words = body.map((k) => k.textContent).join(" ").trim().length;
        const lists = main.querySelectorAll(".dk-chunk ul, .dk-chunk ol, .dk-chunk table").length;
        if (pics.length > 1) return "galerie";
        if (pics.length === 1) return words >= 4 ? "image-droite" : heads.length ? "figure" : "image";
        if (body.length === 1 && body[0].tagName === "BLOCKQUOTE" && heads.length <= 1) return "citation";
        if (heads[0]?.tagName === "H1" && !lists && words < 220) return index === 0 ? "couverture" : "section";
        if (heads.length === 1 && heads[0].tagName === "H2" && !lists && words < 110) return index === total - 1 ? "fin" : "section";
        if (!heads.length && !lists && body.length <= 2 && words < 90) return "annonce";
        return "standard";
    }
    el.classList.add(`l-${layout}`);
    if (meta.class) el.classList.add(...meta.class.split(/\s+/).filter(Boolean).map((c) => `u-${c}`));
    if (meta.background) setBackground(el, meta.background);

    // le titre en tête de diapositive passe au-dessus du corps (colonnes, image et code se rangent dessous)
    const first = main.querySelector(":scope > .dk-chunk")?.firstElementChild;
    if (first && /^H[1-3]$/.test(first.tagName) && !["couverture", "section", "fin", "annonce", "citation"].includes(layout) && !first.closest("[data-step]")) {
        el.querySelector(".dk-head").append(first);
    }
    // les images (arrange() leur donne leur taille, une fois connues leurs proportions)
    if (layout === "image-gauche") el.classList.add("dk-flip");
    if (meta.image && (layout === "image-droite" || layout === "image-gauche")) {
        // comme Slidev : l'image de l'en-tête occupe sa moitié de diapositive, bord à bord
        el.classList.add("dk-half");
        const half = document.createElement("div");
        half.className = "dk-halfimg";
        half.style.backgroundImage = `url("${meta.image.trim().replace(/"/g, "%22")}")`;
        el.prepend(half);
    } else if (layout === "image") {
        const src = meta.image?.trim() || pics[0]?.img.getAttribute("src");
        if (src) {
            const img = Object.assign(document.createElement("img"), { className: "dk-full", alt: "" });
            img.src = src;
            el.prepend(img);
            setBackground(el, src);
            if (!meta.image) unwrap(pics[0]).remove();
        }
    } else if (pics.length && ["image-droite", "image-gauche", "figure", "galerie"].includes(layout)) {
        side.classList.add("dk-media");
        for (const p of layout === "galerie" || layout === "figure" ? pics : pics.slice(0, 1)) side.append(figureOf(p));
    }
    for (const c of main.querySelectorAll(":scope > .dk-chunk")) if (!c.childElementCount && !c.textContent.trim()) c.remove();
    if (layout === "couverture" && index === 0 && env.fm) {
        const f = env.fm.fields;
        const parts = [[f.auteurs || f.auteur || f.author, "who"], [f.affiliation || f.institut || f.institute, "inst"], [f.date, "when"]].filter(([v]) => v);
        if (parts.length) main.insertAdjacentHTML("beforeend", `<div class="dk-chunk dk-byline">${parts.map(([v, c]) => `<span class="dk-${c}">${esc(v)}</span>`).join("")}</div>`);
    }
    if (layout === "code") {
        for (const c of cells) if (c.runnable && !c.fig.classList.contains("dk-page") && !c.fig.classList.contains("dk-noecho") && c.code.split("\n").length <= 22) c.fig.classList.add("dk-side-out");
    }
    // pied : titre du document, numéro
    if (!thumb && !["couverture"].includes(layout)) {
        // (auteur et date : seul le style latex les montre, en pied de page à trois segments comme Beamer)
        const f = env.fm?.fields || {};
        el.insertAdjacentHTML("beforeend", `<footer class="dk-foot"><span class="dk-foot-who">${esc(f.auteurs || f.auteur || f.author || "")}</span>` +
            `<span class="dk-foot-title">${esc(env.title || "")}</span><span class="dk-foot-n"><i class="dk-foot-date">${esc(f.date || "")}</i>${index + 1} / ${total}</span></footer>`);
        // des repères, un rond par diapositive (comme les « miniframes » de Beamer) : seul le style latex les montre
        if (total > 1 && total <= 40) el.insertAdjacentHTML("beforeend", `<nav class="dk-mini" aria-hidden="true">${Array.from({ length: total }, (_, k) => `<i${k === index ? ' class="on"' : k < index ? ' class="seen"' : ""}></i>`).join("")}</nav>`);
    }
    // liens internes : des boutons
    // … qui disent où ils mènent : « Voir le code → 7 · Le code qui change »
    for (const a of el.querySelectorAll('a[href^="#"]')) {
        a.classList.add("dk-btn");
        a.removeAttribute("target");
        const to = env.slides ? targetOf(env.slides, index, a.getAttribute("href").slice(1)) : null;
        if (!to) continue;
        const label = to.run ? "exécute le code" : `${to.k + 1}${slideTitle(env.slides[to.k]) ? " · " + slideTitle(env.slides[to.k]) : ""}`;
        a.title = to.run ? "Exécuter le code de cette diapositive" : `Aller à la diapositive ${label.replace(" · ", " : ")}`;
        if (to.k != null) a.dataset.to = to.k;
        // « Voir le code → » : la flèche est déjà dans l'étiquette
        const last = a.lastChild;
        if (last?.nodeType === 3) last.nodeValue = last.nodeValue.replace(/\s*(→|->|»|›)\s*$/, "");
        a.insertAdjacentHTML("beforeend", `<span class="dk-btn-to">${to.run ? "▶ " : "→ "}${esc(label)}</span>`);
    }
    // une image arrivée plus tard : la diapositive se remet en page ; ready attend les images comme les schémas
    const imgs = [...el.querySelectorAll("img")];
    for (const img of imgs) if (!img.complete) img.addEventListener("load", () => (env.onSized ? env.onSized(el) : fit(el)), { once: true });
    const ready = Promise.all([renderMermaid(el, env.dark), ...imgs.map((i) => i.decode?.().catch(() => {}))]).then(() => env.onSized?.(el));
    const enter = enterOf(meta.enter) ?? enterOf(env.fm?.fields.apparition || env.fm?.fields.animation) ?? null;
    if (enter) el.dataset.enter = enter;
    return { el, ready, steps: count, actions, cells, notes, effects, layout, enter, line: slide.line, model: slide };
}

// > [!DÉFINITION] Titre, [!THÉORÈME], [!EXEMPLE], [!ALERTE]… (comme le mode scientifique) : des blocs, à la manière
// de Beamer — bleus (block), verts (exampleblock), rouges (alertblock)
const THEOREMS = { definition: ["Définition", "note"], theoreme: ["Théorème", "note"], lemme: ["Lemme", "note"], proposition: ["Proposition", "note"],
    corollaire: ["Corollaire", "note"], propriete: ["Propriété", "note"], remarque: ["Remarque", "note"], preuve: ["Preuve", "note"],
    demonstration: ["Démonstration", "note"], exemple: ["Exemple", "tip"], exercice: ["Exercice", "tip"], alerte: ["Attention", "warning"], attention: ["Attention", "warning"] };
function theoremBlocks(box) {
    for (const q of box.querySelectorAll("blockquote")) {
        const p = q.querySelector(":scope > p");
        const m = p && /^\[!([\p{L}]+)\][ \t]*([^\n]*)\n?/u.exec(p.innerHTML);
        const kind = m && THEOREMS[fold(m[1])];
        if (!kind) continue;
        p.innerHTML = p.innerHTML.slice(m[0].length);
        if (!p.textContent.trim()) p.remove();
        const div = document.createElement("div");
        div.className = `callout callout-${kind[1]} callout-thm`;
        div.innerHTML = `<p class="callout-title">${kind[0]}${m[2].trim() ? ` <span class="callout-name">(${m[2].trim().replace(/\s*\{#[\w:.-]+\}$/, "")})</span>` : ""}</p>`;
        div.append(...q.childNodes);
        q.replaceWith(div);
    }
}

/** Les options « #| clé: valeur » en tête d'un bloc (comme en Quarto), clés sans accents : exécuter → executer. */
function cellOptions(code) {
    const opts = {};
    for (const l of code.split("\n")) {
        const m = /^\s*(?:#|\/\/|--|%%|;|\*>)\|\s*([\p{L}\w-]+)\s*:\s*(.*?)\s*$/u.exec(l);
        if (!m) break;
        opts[fold(m[1])] = m[2].replace(/^["']|["']$/g, "");
    }
    return opts;
}

/** « {2|3-4|all} » → [Set(2), Set(3, 4), null] (null : tout le code) ; rien → null */
function highlightSteps(meta) {
    const m = /^\{\s*(.*?)\s*\}$/.exec(String(meta || "").trim());
    if (!m || !m[1]) return null;
    const steps = m[1].split("|").map((part) => {
        part = part.trim();
        if (!part || /^(all|\*|tout)$/i.test(part)) return null;
        if (/^(none|aucune)$/i.test(part)) return new Set();
        const set = new Set();
        for (const r of part.split(",")) {
            const [a, z] = r.trim().split("-").map((x) => parseInt(x, 10));
            if (!isFinite(a)) continue;
            for (let i = a; i <= (isFinite(z) ? z : a); i++) set.add(i);
        }
        return set;
    });
    return steps.every((x) => x === null) && steps.length === 1 ? null : steps;
}

const fenceLabel = (info) => ({ py: "python", js: "javascript", ts: "javascript", sh: "sh", bash: "sh", rs: "rust", golang: "go", "c++": "cpp" }[fold(info || "")] || fold(info || ""));

// Les marques (comme rough-notation, dont se sert Slidev) : un trait tracé à la main, en coordonnées 0-100
const MARKS = {
    underline: "M2 92 C 28 97, 60 89, 98 94",
    circle: "M52 6 C 84 4, 99 26, 97 52 C 95 82, 70 97, 45 95 C 16 93, 2 74, 4 47 C 6 20, 28 5, 60 9",
    box: "M2 5 L98 3 L97 96 L3 97 Z",
    "strike-through": "M1 54 L99 48",
    "crossed-off": "M3 8 L97 92 M97 9 L4 93",
    bracket: "M14 3 L3 3 L3 97 L14 97 M86 3 L97 3 L97 97 L86 97",
    highlight: null,
};
const MARK_COLORS = { red: "#E5484D", rouge: "#E5484D", orange: "#F76B15", yellow: "#FFC53D", jaune: "#FFC53D", green: "#30A46C", vert: "#30A46C",
    blue: "#3E63DD", bleu: "#3E63DD", purple: "#8E4EC6", violet: "#8E4EC6", pink: "#D6409F", rose: "#D6409F", gray: "#8B8D98", gris: "#8B8D98", black: "#111", noir: "#111" };

// la marge autour du mot, en hauteurs de ligne : [horizontale, verticale]
const MARK_PAD = { underline: [0, .14], circle: [.38, .32], box: [.2, .12], "strike-through": [.04, 0], "crossed-off": [.06, .04], bracket: [.28, .1] };
/** Trace (ou efface) une marque à la taille réelle du mot : le trait garde son épaisseur, quelle que soit la forme. */
function drawMark(e, type, on, animate, tries = 0) {
    e.classList.toggle("on", on);
    const old = e.querySelector(":scope > .dk-mk");
    if (!on) { old?.remove(); return; }
    if (!MARKS[type] || old) return;
    const w = e.offsetWidth, h = e.offsetHeight;
    if (!w || !h) { if (tries < 30) requestAnimationFrame(() => drawMark(e, type, e.classList.contains("on"), animate, tries + 1)); return; }
    const [px, py] = (MARK_PAD[type] || [0, 0]).map((k) => k * h);
    const W = w + 2 * px, H = h + 2 * py;
    const d = MARKS[type].replace(/(-?[\d.]+)[ ,]\s*(-?[\d.]+)/g, (_, x, y) => `${(x / 100 * W).toFixed(1)} ${(y / 100 * H).toFixed(1)}`);
    e.insertAdjacentHTML("beforeend", `<svg class="dk-mk" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="left:${-px}px;top:${-py}px" aria-hidden="true"><path d="${d}" pathLength="1"/></svg>`);
    const path = e.lastElementChild.firstElementChild;
    if (animate && !reduce()) path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 800, easing: EASE, fill: "backwards" });
}

/** Le code se transforme en place (magic-move) : les lignes gardées glissent, les retirées s'effacent, les nouvelles arrivent. */
function morphInPlace(codeEl, code, lang) {
    const pre = codeEl.closest("pre");
    const old = [...codeEl.querySelectorAll(".dk-l")].map((l) => ({ text: norm(l.textContent), html: l.innerHTML, x: l.offsetLeft, y: l.offsetTop }));
    const h0 = pre.offsetHeight;
    paint(codeEl, code, lang);
    if (reduce()) return;
    const now = [...codeEl.querySelectorAll(".dk-l")];
    const same = lcs(old.map((o) => o.text), now.map((l) => norm(l.textContent)));
    const kept = new Set(same.map(([, j]) => j)), gone = new Set(old.map((_, i) => i));
    const D = 750;
    for (const [i, j] of same) {
        gone.delete(i);
        const dx = old[i].x - now[j].offsetLeft, dy = old[i].y - now[j].offsetTop;
        if (Math.abs(dx) + Math.abs(dy) > .5) now[j].animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: D, easing: EASE });
    }
    now.forEach((l, j) => { if (!kept.has(j)) l.animate([{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: D * .6, easing: EASE, delay: D * .4, fill: "backwards" }); });
    for (const i of gone) {
        const g = document.createElement("span");
        g.className = "dk-l dk-ghost";
        g.innerHTML = old[i].html;
        Object.assign(g.style, { position: "absolute", left: `${old[i].x}px`, top: `${old[i].y}px` });
        pre.append(g);
        g.animate([{ opacity: 1 }, { opacity: 0, transform: "translateX(10px)" }], { duration: D * .45, easing: "ease-out", fill: "forwards" }).finished.then(() => g.remove(), () => g.remove());
    }
    const h1 = pre.offsetHeight;
    if (Math.abs(h1 - h0) > 1) pre.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: D, easing: EASE });
}

/** Le code d'un bloc, ligne par ligne (chaque ligne se déplace seule d'une diapositive à l'autre). */
function paint(codeEl, code, lang) {
    codeEl.innerHTML = highlightLines(code, lang).map((l) => `<span class="dk-l">${l || "\u200b"}</span>`).join("\n");
}

/** Les images seules sur leur ligne (pas celles au milieu d'une phrase) : { img, node, holder, chunk } */
function standalone(main) {
    const out = [];
    for (const img of main.querySelectorAll(":scope > .dk-chunk img")) {
        const node = img.parentElement.tagName === "A" && img.parentElement.childElementCount === 1 ? img.parentElement : img;
        const holder = node.parentElement.closest("p") ?? (node.parentElement.classList.contains("dk-chunk") ? node : null);
        if (!holder || (holder !== node && holder.textContent.trim())) continue;
        out.push({ img, node, holder, chunk: node.closest(".dk-chunk") });
    }
    return out;
}
/** Retire l'image de son paragraphe (le paragraphe vide part avec elle) */
function unwrap(p) {
    if (p.holder !== p.node) { p.node.remove(); if (!p.holder.querySelector("img")) p.holder.remove(); }
    return p.node;
}
/** L'image dans sa figure, avec sa légende : le titre ![…](x.png "Légende"), ou le texte de remplacement s'il fait une phrase */
function figureOf(p) {
    const fig = document.createElement("figure");
    fig.className = "dk-fig";
    for (const k of ["step", "until"]) if (p.chunk?.dataset[k]) fig.dataset[k] = p.chunk.dataset[k];
    fig.append(unwrap(p));
    const alt = (p.img.getAttribute("alt") || "").trim(), cap = p.img.getAttribute("title") || (/\s/.test(alt) ? alt : "");
    if (cap) { const c = document.createElement("figcaption"); c.textContent = cap; c.title = cap; fig.append(c); }
    return fig;
}

const ratioOf = (img) => (img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4 / 3);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Des images en rangées (au plus k), de proportions voisines, dans l'ordre : [[indices], …] */
function rowsOf(rs, k) {
    const total = rs.reduce((a, b) => a + b, 0), rows = [[]];
    let acc = 0;
    rs.forEach((r, i) => {
        const cur = rows[rows.length - 1];
        if (cur.length && rows.length < k && (acc + r / 2 > (total * rows.length) / k || rs.length - i <= k - rows.length)) rows.push([]);
        rows[rows.length - 1].push(i);
        acc += r;
    });
    return rows;
}

/**
 * La place des images d'une diapositive. Une image à côté du texte prend la largeur qui lui va (étroite si elle est
 * haute, plus large si elle est panoramique), ou passe sous le texte si elle y gagne nettement ; plusieurs images
 * se rangent en rangées de même hauteur (comme une galerie de photos), le nombre de rangées étant celui qui les
 * montre le plus grand. Jamais rognées, jamais déformées. measure : la phase où fit() mesure le texte ; les
 * images s'effacent alors, en gardant leur place.
 */
export function arrange(el, measure = false) {
    const full = el.querySelector(":scope > .dk-full");
    // une image en fond : bord à bord si elle a à peu près le format de l'écran, sinon entière sur un fond d'elle-même flouté
    if (full) el.classList.toggle("dk-contain", Math.abs(Math.log(ratioOf(full) / (W / H))) > .2);
    const media = el.querySelector(".dk-media");
    const figs = media ? [...media.querySelectorAll(".dk-fig")] : [];
    if (!figs.length) return;
    const body = el.querySelector(".dk-body"), main = el.querySelector(".dk-main");
    const imgs = figs.map((f) => f.querySelector("img")), rs = imgs.map(ratioOf);
    el.classList.add("dk-measure");
    media.style.minHeight = "";
    const BW = body.clientWidth, BH = body.clientHeight;
    if (el.matches(".l-image-droite, .l-image-gauche")) {
        const colW = clamp(BH * rs[0], BW * .34, BW * .56);
        if (el.dataset.stack == null) {
            // à côté ou dessous : là où l'image est la plus grande, le texte tenant toujours
            el.classList.remove("dk-stack");
            body.style.setProperty("--media-w", `${colW}px`);
            const beside = Math.min(colW, BH * rs[0]) ** 2 / rs[0];
            el.classList.add("dk-stack");
            const room = BH - main.offsetHeight - 28, w = Math.min(BW, room * rs[0]);
            el.dataset.stack = room > BH * .4 && w * w / rs[0] > beside * 1.2 ? "1" : "";
        }
        el.classList.toggle("dk-stack", !!el.dataset.stack);
        body.style.setProperty("--media-w", `${colW}px`);
    }
    const stacked = !el.matches(".l-image-droite, .l-image-gauche") || el.classList.contains("dk-stack");
    if (measure) {
        // le texte ne prend pas toute la place : la moitié au moins reste aux images
        if (stacked && main.childElementCount) media.style.minHeight = `${Math.round(BH * .5)}px`;
        return;
    }
    const MW = media.clientWidth, MH = media.clientHeight, gap = Math.round(BW * .018);
    const cap = figs.some((f) => f.querySelector("figcaption")) ? parseFloat(getComputedStyle(figs[0]).fontSize) * .62 * 1.35 + 10 : 0;
    let best = null;
    for (let k = 1; k <= Math.min(figs.length, 3); k++) {
        const rows = rowsOf(rs, k);
        let hs = rows.map((row) => (MW - gap * (row.length - 1)) / row.reduce((a, i) => a + rs[i], 0));
        const fixed = rows.length * cap + gap * (rows.length - 1), sum = hs.reduce((a, b) => a + b, 0);
        if (sum + fixed > MH) hs = hs.map((h) => (h * Math.max(0, MH - fixed)) / sum);
        const area = rows.reduce((a, row, j) => a + row.reduce((b, i) => b + hs[j] * hs[j] * rs[i], 0), 0);
        if (!best || area > best.area * 1.03) best = { rows, hs, area };
    }
    media.replaceChildren(...best.rows.map((row, j) => {
        const line = document.createElement("div");
        line.className = "dk-row";
        line.style.gap = `${gap}px`;
        for (const i of row) {
            const w = Math.floor(best.hs[j] * rs[i]), h = Math.floor(best.hs[j]);
            Object.assign(imgs[i].style, { width: `${w}px`, height: `${h}px` });
            figs[i].style.width = `${w}px`;
            line.append(figs[i]);
        }
        return line;
    }));
    media.style.gap = `${gap}px`;
    el.classList.remove("dk-measure");
}

function setBackground(el, value) {
    const v = String(value).trim();
    if (/^(https?:|data:|\.{0,2}\/|[\w-]+\.(png|jpe?g|gif|webp|svg)$)/i.test(v)) el.style.setProperty("--dk-bg-img", `url("${v.replace(/"/g, "%22")}")`), el.classList.add("dk-has-bg");
    else el.style.setProperty("--dk-slide-bg", v);
}

/** Le texte trop long se réduit jusqu'à tenir sur la diapositive (au plus de moitié). */
export function fit(el, { grow = 1 } = {}) {
    const frame = el.querySelector(".dk-frame");
    if (!frame) return;
    arrange(el, true);
    size(el, frame, grow);
    arrange(el);
}
function size(el, frame, grow) {
    const fits = (k) => { el.style.setProperty("--fit", k.toFixed(3)); return frame.scrollHeight <= frame.clientHeight + 2 && frame.scrollWidth <= frame.clientWidth + 2; };
    // grow > 1 (le livre, à l'impression) : la plus grande taille où tout tient encore, jusqu'à grow
    if (grow > 1 && fits(1)) {
        let lo = 1, hi = grow;
        if (fits(hi)) return;
        for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
        fits(lo);
        return;
    }
    let k = 1;
    el.style.setProperty("--fit", 1);
    for (let i = 0; i < 12 && frame.scrollHeight > frame.clientHeight + 2 && k > .5; i++) {
        k *= .92;
        el.style.setProperty("--fit", k.toFixed(3));
    }
}

// ---------------------------------------------------------------- les animations

// une courbe « expo » : départ franc, arrivée très douce (celle de Keynote, d'iOS)
const EASE = "cubic-bezier(.16,1,.3,1)";
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const CANDIDATES = "h1,h2,h3,h4,p,li,blockquote,img,table,.dk-glres,.math-block,.mermaid-src,.dk-cell,.dk-byline";
const norm = (s) => s.replace(/\s+/g, " ").trim();

function keyOf(e, ords) {
    if (e.matches(".dk-cell")) {
        const lang = e.querySelector(".dk-lang")?.textContent || "";
        const k = (ords[lang] = (ords[lang] || 0) + 1);
        return `cell:${lang}:${k}`;
    }
    if (e.tagName === "IMG") return `img:${e.getAttribute("src")}`;
    const t = norm(e.textContent);
    if (!t) return null;
    return `${/^H\d$/.test(e.tagName) ? "h" : e.tagName}:${t.slice(0, 300)}`;
}

/** Les éléments qu'on retrouve d'une diapositive à l'autre : [ancien, nouveau]. */
function matches(a, b) {
    const index = new Map();
    const ords = {};
    for (const e of a.querySelectorAll(CANDIDATES)) {
        if (e.closest(".dk-cell") && !e.matches(".dk-cell")) continue;
        const k = keyOf(e, ords);
        if (!k) continue;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(e);
    }
    const out = [], taken = new Set();
    const ords2 = {};
    for (const e of b.querySelectorAll(CANDIDATES)) {
        if (e.closest(".dk-cell") && !e.matches(".dk-cell")) continue;
        const k = keyOf(e, ords2);
        if (!k || !index.get(k)?.length) continue;
        // un parent déjà apparié emporte ses enfants
        if ([...taken].some((t) => t.contains(e))) continue;
        const old = index.get(k).shift();
        out.push([old, e]);
        taken.add(e);
    }
    return out;
}

/** La plus longue suite commune de lignes (pour le code qui change) : [i, j]. */
function lcs(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 250000) return [];
    const d = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = a[i] === b[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
    const out = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
        else if (d[i + 1][j] >= d[i][j + 1]) i++; else j++;
    }
    return out;
}

// ---------------------------------------------------------------- le diaporama

const ICONS = {
    prev: '<path d="M10 3 5 8l5 5"/>', next: '<path d="m6 3 5 5-5 5"/>',
    grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
    pen: '<path d="m10.5 2.5 3 3-8 8H2.5v-3z"/>', laser: '<circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5.5" opacity=".45"/>',
    notes: '<path d="M3 4h10M3 8h10M3 12h6"/>', screen: '<rect x="1.5" y="3" width="13" height="8.5" rx="1.5"/><path d="M5.5 14h5"/>',
    full: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    pdf: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>', close: '<path d="m4 4 8 8M12 4l-8 8"/>',
};
const icon = (k) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[k]}</svg>`;

const ENTER_FX = {
    cascade: () => ({ frames: [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], duration: 800 }),
    douce: () => ({ frames: [{ opacity: 0 }, { opacity: 1 }], duration: 700 }),
    zoom: () => ({ frames: [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], duration: 900 }),
    glisse: () => ({ frames: [{ opacity: 0, transform: "translateX(-24px)" }, { opacity: 1, transform: "none" }], duration: 800 }),
    monte: () => ({ frames: [{ opacity: 0, transform: "translateY(32px)" }, { opacity: 1, transform: "none" }], duration: 900 }),
    devoile: () => ({ frames: [{ clipPath: "inset(100% 0 0 0)", transform: "scale(1.08)" }, { clipPath: "inset(0 0 0 0)", transform: "none" }], duration: 1100 }),
    machine: (e) => ({ frames: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], duration: Math.max(300, Math.min(1400, norm(e.textContent).length * 32)) }),
};

/** Les mots d'un titre, chacun dans un masque : ils montent l'un après l'autre (une fois découpés, ils le restent). */
function splitWords(el) {
    if (el.dataset.words) return [...el.querySelectorAll(":scope .dk-w > span")];
    el.dataset.words = "1";
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim() && !walk.currentNode.parentNode.closest("code, .katex")) texts.push(walk.currentNode);
    for (const t of texts) {
        const frag = document.createDocumentFragment();
        for (const part of t.nodeValue.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(part); continue; }
            const w = document.createElement("span");
            w.className = "dk-w";
            const inner = document.createElement("span");
            inner.textContent = part;
            w.append(inner);
            frag.append(w);
        }
        t.replaceWith(frag);
    }
    return [...el.querySelectorAll(":scope .dk-w > span")];
}

/** « 42 % », « 3,5 M€ », « 1 200 » : le nombre défile jusqu'à sa valeur. → la fonction qui l'arrête (valeur finale). */
function countUp(el, delay) {
    const text = el.textContent;
    const m = /^(\D{0,3}?)(\d[\d\s\u202f.,]*\d|\d)(.{0,6})$/.exec(text.trim());
    if (!m) return null;
    const raw = m[2].replace(/[\s\u202f]/g, ""), dec = /,\d+$/.test(raw) ? raw.split(",")[1].length : /\.\d{1,2}$/.test(raw) ? raw.split(".")[1].length : 0;
    const target = parseFloat(dec ? raw.replace(/[.,](?=\d+$)/, "#").replace(/[.,]/g, "").replace("#", ".") : raw.replace(/[.,]/g, ""));
    if (!isFinite(target) || target === 0) return null;
    const fmt = (v) => m[1] + v.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
    let raf = 0, stopped = false;
    const t0 = performance.now() + delay, D = 1300;
    el.textContent = fmt(0);
    const tick = (now) => {
        if (stopped) return;
        const k = Math.min(1, Math.max(0, (now - t0) / D));
        const e = 1 - Math.pow(1 - k, 4);
        el.textContent = k >= 1 ? text : fmt(target * e);
        if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); el.textContent = text; };
}

/** Les effets d'une étape (lignes surlignées, magic-move, marques) : actifs de « from » à « to » (exclu). */
export function applyEffects(r, step, animate = false) {
    for (const fx of r.effects || []) fx.apply(step >= fx.from && step < (fx.to ?? Infinity), animate);
}
/** L'état final d'une diapositive (vue d'ensemble, PDF, présentateur) : toutes ses étapes franchies. */
export function finalState(r) {
    applyEffects(r, r.steps, false);
    // ce qui disparaît avant la fin (<v-click hide>, at="[2, 4]") n'y est plus
    for (const e of r.el.querySelectorAll("[data-until]")) if (r.steps >= +e.dataset.until) e.classList.add("dk-hide", "dk-still");
}

export class Deck {
    /** env : { parts(), fm(), title, dark, phraseLine, outputs(open), phraseResult(n), run(open), setCode(open, code), langLabel, onExit(line) } */
    constructor(env) {
        this.env = env;
        this.i = 0;
        this.step = 0;
        this.cur = null;
        this.ink = new Map();      // diapositive -> traits du crayon
        this.tool = null;          // "pen" | "laser" | null
        this.root = document.createElement("div");
        this.root.className = "deck";
        this.root.tabIndex = -1;
        this.root.innerHTML = `<div class="dk-backdrop" aria-hidden="true"></div>
            <div class="dk-viewport"><div class="dk-stage"></div></div>
            <canvas class="dk-ink"></canvas><div class="dk-laser" hidden></div>
            <div class="dk-progress"><i></i></div>
            <nav class="dk-bar" aria-label="Diaporama">
              <button type="button" data-a="prev" title="Précédent (←)">${icon("prev")}</button>
              <span class="dk-count"></span>
              <button type="button" data-a="next" title="Suivant (→, espace, clic)">${icon("next")}</button>
              <i class="dk-sep"></i>
              <button type="button" data-a="grid" title="Vue d'ensemble (O)">${icon("grid")}</button>
              <button type="button" data-a="pen" title="Crayon (D) — E efface">${icon("pen")}</button>
              <button type="button" data-a="laser" title="Pointeur laser (L)">${icon("laser")}</button>
              <button type="button" data-a="notes" title="Notes (N)">${icon("notes")}</button>
              <button type="button" data-a="presenter" title="Vue présentateur, dans une autre fenêtre (P)">${icon("screen")}</button>
              <button type="button" data-a="pdf" title="Exporter en PDF">${icon("pdf")}</button>
              <button type="button" data-a="full" title="Plein écran (F)">${icon("full")}</button>
              <button type="button" data-a="exit" title="Revenir au document (Échap)">${icon("close")}</button>
            </nav>
            <aside class="dk-notes" hidden></aside>
            <div class="dk-over" hidden></div>
            <div class="dk-blank" hidden></div>
            <div class="dk-end" hidden><p>Fin du diaporama</p><small>→ pour revenir au document · ← pour revoir</small></div>
            <div class="dk-goto" hidden></div>
            <div class="dk-menu" hidden>
              <button type="button" data-a="pdf-slides">Diapositives<small>une par page, au format de l'écran, liens cliquables</small></button>
              <button type="button" data-a="pdf-notes">Avec les notes<small>A4 : la diapositive, ses notes, de la place pour écrire</small></button>
            </div>`;
        this.stage = this.root.querySelector(".dk-stage");
        this.canvas = this.root.querySelector(".dk-ink");
        this.typed = "";
        this.anims = [];
        this.counters = [];        // les nombres qui défilent (countUp) : à arrêter si l'on change de diapositive
        this.refreshQueued = false;
        this.onKey = (e) => this.key(e);
        this.onResize = () => this.layout();
        this.wire();
    }

    // ---- ouverture, fermeture
    open(start = 0, { fullscreen = false } = {}) {
        this.load();
        document.body.append(this.root);
        document.body.classList.add("presenting");
        this.theme = pickTheme(this.slides, this.env.fm());
        this.root.classList.add(`th-${this.theme.name}`);
        this.root.classList.toggle("dk-light", this.theme.light ?? !this.env.dark);
        addEventListener("keydown", this.onKey, true);
        addEventListener("resize", this.onResize);
        this.layout();
        this.show(Math.max(0, Math.min(start, this.slides.length - 1)), { step: 0, instant: true });
        this.root.focus({ preventScroll: true });
        if (fullscreen) this.root.requestFullscreen?.().catch(() => {});
        this.started = Date.now();
        this.idle();
        return this;
    }
    close() {
        removeEventListener("keydown", this.onKey, true);
        removeEventListener("resize", this.onResize);
        if (document.fullscreenElement === this.root) document.exitFullscreen?.().catch(() => {});
        this.pres?.close();
        this.root.remove();
        document.body.classList.remove("presenting");
        this.closed = true;
        this.env.onExit?.(this.cur?.line ?? 0);
    }
    load() {
        this.slides = parseDeck(this.env.parts(), this.env.fm());
        if (!this.slides.length) this.slides = [{ line: 0, meta: {}, items: [{ t: "line", n: 0, text: "## Document vide", results: "" }] }];
    }
    /** La diapositive où se trouve une ligne du document. */
    slideAt(line) {
        let k = 0;
        this.slides ??= parseDeck(this.env.parts(), this.env.fm());
        this.slides.forEach((s, i) => { if (s.line <= line) k = i; });
        return k;
    }

    // ---- disposition à l'écran
    layout() {
        const vw = this.root.clientWidth || innerWidth, vh = this.root.clientHeight || innerHeight;
        this.k = Math.min(vw / W, vh / H);
        this.stage.style.transform = `translate(-50%, -50%) scale(${this.k})`;
        const dpr = devicePixelRatio || 1;
        this.canvas.width = vw * dpr; this.canvas.height = vh * dpr;
        this.drawInk();
    }

    // ---- navigation
    render(i) {
        const r = renderSlide(this.slides[i], { ...this.env, fm: this.env.fm(), slides: this.slides, onSized: (el) => fit(el) }, { index: i, total: this.slides.length });
        r.el.addEventListener("click", (e) => this.slideClick(e, r));
        r.el.addEventListener("input", (e) => this.codeInput(e, r));
        r.el.addEventListener("focusout", (e) => this.codeBlur(e, r));
        r.el.addEventListener("keydown", (e) => this.codeKey(e, r));
        for (const c of r.cells) {
            const code = c.fig.querySelector("code");
            if (code && !c.magic) { try { code.contentEditable = "plaintext-only"; } catch { code.contentEditable = "true"; } }
        }
        return r;
    }
    show(i, { step = 0, instant = false, dir = 1 } = {}) {
        this.finish();
        this.hideEnd();
        const old = this.cur;
        const r = this.render(i);
        this.i = i;
        this.cur = r;
        this.stage.append(r.el);
        fit(r.el);
        this.refreshCells(r);
        this.step = step === "last" ? r.steps : Math.min(step, r.steps);
        this.applySteps(r, { animate: false });
        this.runActions(r, 0, this.step, { entering: true });
        if (!old || instant || reduce()) old?.el.remove();
        else this.transition(old, r, dir);
        this.updateChrome();
    }
    next() {
        if (this.endShown) { this.close(); return; }
        if (this.step < this.cur.steps) { const from = this.step; this.step++; this.applySteps(this.cur); this.runActions(this.cur, from, this.step); this.updateChrome(); return; }
        if (this.i < this.slides.length - 1) this.show(this.i + 1, { dir: 1 });
        else this.showEnd();
    }
    prev() {
        if (this.endShown) { this.hideEnd(); return; }
        if (this.step > 0) { this.step--; this.applySteps(this.cur); this.updateChrome(); return; }
        if (this.i > 0) this.show(this.i - 1, { step: "last", dir: -1 });
    }
    go(i) { if (i >= 0 && i < this.slides.length && (i !== this.i || this.endShown)) this.show(i, { dir: i >= this.i ? 1 : -1 }); }
    showEnd() { this.endShown = true; this.root.querySelector(".dk-end").hidden = false; }
    hideEnd() { this.endShown = false; this.root.querySelector(".dk-end").hidden = true; }

    applySteps(r, { animate = true } = {}) {
        applyEffects(r, this.step, animate);
        for (const e of r.el.querySelectorAll("[data-step], [data-until]")) {
            const hide = +(e.dataset.step || 0) > this.step || (+e.dataset.until > 0 && this.step >= +e.dataset.until);
            if (!animate) e.classList.add("dk-still");
            e.classList.toggle("dk-hide", hide);
            if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => e.classList.remove("dk-still")));
        }
    }
    /** Les actions des étapes franchies : du code qui s'exécute au clic, ou en arrivant. */
    runActions(r, from, to, { entering = false } = {}) {
        for (const a of r.actions) {
            const due = entering ? a.step <= to : a.step > from && a.step <= to;
            if (!due) continue;
            if (a.auto && this.env.outputs(a.cell.open)?.outputs?.length && !a.cell.fig.classList.contains("dk-page")) continue;
            if (a.auto && a.cell.fig.classList.contains("dk-page") && this.env.outputs(a.cell.open)?.outputs?.length) continue;
            if (!a.auto && entering && a.step === 0) continue;
            this.env.run(a.cell.open, { auto: true });
        }
    }

    /** D'une diapositive à l'autre : ce qui se retrouve glisse, le reste apparaît ; sinon un glissement. */
    transition(old, r, dir) {
        const D = 800;
        const meta = r.model.meta.transition || old.model.meta.transition || this.env.fm()?.fields.transition || "";
        const kind = fold(meta);
        old.el.classList.add("dk-leaving");
        const pairs = /^(aucune|none)$/.test(kind) ? [] : matches(old.el, r.el);
        const done = () => old.el.remove();
        if (/^(aucune|none)$/.test(kind)) { done(); return; }
        if (pairs.length && !/^(fondu|fade|glisse|slide|zoom|rideau|wipe)$/.test(kind)) {
            const k = this.k;
            const moved = new Set();
            for (const [a, b] of pairs) {
                const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                if (!rb.width || !rb.height) continue;
                a.style.visibility = "hidden";
                moved.add(b);
                const dx = (ra.left - rb.left) / k, dy = (ra.top - rb.top) / k;
                if (b.matches(".dk-cell")) { this.morphCode(a, b, dx, dy, D); continue; }
                let sx, sy;
                if (b.tagName === "IMG" || b.matches(".mermaid-src,table,.math-block")) { sx = ra.width / rb.width; sy = ra.height / rb.height; }
                else { sx = sy = parseFloat(getComputedStyle(a).fontSize) / parseFloat(getComputedStyle(b).fontSize) || 1; }
                this.anims.push(b.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }], { duration: D, easing: EASE }));
            }
            this.anims.push(old.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * .45, easing: "ease-out", fill: "forwards" }));
            this.enter(r.el, moved, D * .35);
            this.anims.at(-1)?.finished.then(done, done);
            setTimeout(done, D + 400);
            return;
        }
        // sans choix : en profondeur (l'ancienne recule, la nouvelle arrive) ; « fondu », « glisse », « zoom », « rideau »
        const T = 760;
        if (/^(rideau|wipe)/.test(kind)) {
            this.anims.push(r.el.animate([{ clipPath: dir > 0 ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 700, easing: EASE }));
            this.anims.push(old.el.animate([{ opacity: 1 }, { opacity: .3 }], { duration: 700, fill: "forwards" }));
            this.enter(r.el, new Set(), 250);
            this.anims.at(-1).finished.then(done, done);
            return;
        }
        const zoom = /^zoom/.test(kind), slide = /^(glisse|slide)/.test(kind), fade = /^(fondu|fade)/.test(kind);
        const out = zoom ? "scale(1.08)" : slide ? `translateX(${-dir * 120}px)` : fade ? "none" : `scale(${dir > 0 ? .94 : 1.04})`;
        const inn = zoom ? "scale(.92)" : slide ? `translateX(${dir * 120}px)` : fade ? "none" : `scale(${dir > 0 ? 1.04 : .94})`;
        this.anims.push(old.el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: out }], { duration: T * .6, easing: EASE, fill: "forwards" }));
        this.anims.push(r.el.animate([{ opacity: 0, transform: inn }, { opacity: 1, transform: "none" }], { duration: T, easing: EASE, delay: T * .08, fill: "backwards" }));
        this.enter(r.el, new Set(), T * .22);
        this.anims[0].finished.then(done, done);
    }
    /**
     * Les éléments nouveaux arrivent l'un après l'autre, selon l'apparition choisie (« apparition: zoom » dans
     * l'en-tête du document ou de la diapositive) ; sans choix, chacun à sa manière : le grand titre d'une couverture
     * ou d'une section se pose en zoomant, une image se dévoile, le code monte, une liste arrive en cascade.
     */
    enter(el, skip, delay) {
        const mode = el.dataset.enter || null;
        if (mode === "aucune") return;
        const items = [...el.querySelectorAll(".dk-head > *, .dk-chunk > *, .dk-chunk li, .dk-cell, .dk-side > *, .dk-glres")]
            .filter((e) => ![...skip].some((s) => s.contains(e) || e.contains(s)) && !e.closest(".dk-hide") && !e.matches(".dk-hide"));
        const top = items.filter((e) => !items.some((p) => p !== e && p.contains(e)));
        const big = el.matches(".l-couverture, .l-section, .l-fin, .l-annonce, .l-citation");
        let t = delay;
        top.slice(0, 16).forEach((e) => {
            const heading = /^H[1-3]$/.test(e.tagName) || (big && /^(P|BLOCKQUOTE)$/.test(e.tagName) && !e.querySelector(".dk-btn") && e === top.find((x) => /^(P|BLOCKQUOTE)$/.test(x.tagName)));
            const kind = mode || (heading ? "mots"
                : e.matches(".dk-media, .dk-media *, img") || e.querySelector?.(":scope > img") ? "devoile"
                : e.matches(".dk-cell") ? "monte" : /^(UL|OL|LI)$/.test(e.tagName) ? "glisse" : "cascade");
            if (kind === "mots") {
                const words = splitWords(e);
                words.slice(0, 40).forEach((w, n) => this.anims.push(w.animate([{ transform: "translateY(110%)", opacity: 0 }, { transform: "none", opacity: 1 }],
                    { duration: 1000, easing: EASE, delay: t + n * 45, fill: "backwards" })));
                for (const s of e.querySelectorAll("strong")) { const stop = countUp(s, t + 200); if (stop) this.counters.push(stop); }
                t += Math.min(words.length, 12) * 45 + 120;
                return;
            }
            const { frames, duration } = ENTER_FX[kind] ? ENTER_FX[kind](e) : ENTER_FX.cascade(e);
            this.anims.push(e.animate(frames, { duration, easing: kind === "machine" ? "steps(" + Math.max(4, Math.min(48, norm(e.textContent).length)) + ", end)" : EASE, delay: t, fill: "backwards" }));
            // le code : ses lignes arrivent en cascade rapide, derrière leur cadre
            if (e.matches(".dk-cell") && !mode) {
                [...e.querySelectorAll(".dk-l")].slice(0, 40).forEach((l, n) => this.anims.push(l.animate([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }],
                    { duration: 600, easing: EASE, delay: t + 180 + n * 22, fill: "backwards" })));
            }
            if (big) for (const s of e.querySelectorAll?.("strong") || []) { const stop = countUp(s, t + 200); if (stop) this.counters.push(stop); }
            t += kind === "machine" ? 120 : 70;
        });
    }
    /** Le code qui change : les lignes gardées glissent, les retirées s'effacent sur place, les nouvelles apparaissent. */
    morphCode(a, b, dx, dy, D) {
        const k = this.k;
        this.anims.push(b.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: D, easing: EASE }));
        const preA = a.querySelector("pre"), preB = b.querySelector("pre");
        if (!preA || !preB) return;
        const la = [...preA.querySelectorAll(".dk-l")], lb = [...preB.querySelectorAll(".dk-l")];
        const pa = preA.getBoundingClientRect(), pb = preB.getBoundingClientRect();
        const ha = pa.height / k, hb = pb.height / k;
        if (Math.abs(ha - hb) > 1) this.anims.push(preB.animate([{ height: `${ha}px`, overflow: "hidden" }, { height: `${hb}px`, overflow: "hidden" }], { duration: D, easing: EASE }));
        const same = lcs(la.map((l) => norm(l.textContent)), lb.map((l) => norm(l.textContent)));
        const kept = new Set(same.map(([, j]) => j)), gone = new Set(la.map((_, i) => i));
        for (const [i, j] of same) {
            gone.delete(i);
            const ra = la[i].getBoundingClientRect(), rb = lb[j].getBoundingClientRect();
            const ddx = (ra.left - pa.left - (rb.left - pb.left)) / k, ddy = (ra.top - pa.top - (rb.top - pb.top)) / k;
            if (Math.abs(ddx) + Math.abs(ddy) > .5) this.anims.push(lb[j].animate([{ transform: `translate(${ddx}px, ${ddy}px)` }, { transform: "none" }], { duration: D, easing: EASE }));
        }
        // les lignes retirées restent visibles dans l'ancienne diapositive, qui s'efface
        for (const i of gone) la[i].style.visibility = "visible";
        lb.forEach((l, j) => {
            if (kept.has(j)) return;
            this.anims.push(l.animate([{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: D * .6, easing: EASE, delay: D * .45, fill: "backwards" }));
        });
        // l'ancien cadre du code disparaît : seules ses lignes retirées se voient
        a.style.visibility = "hidden";
        a.querySelector(".dk-out")?.style.setProperty("visibility", "hidden");
    }
    finish() {
        for (const a of this.anims) { try { a.finish(); } catch { /* déjà fini */ } }
        this.anims = [];
        for (const stop of this.counters) stop();
        this.counters = [];
        for (const e of [...this.stage.children]) if (e !== this.cur?.el) e.remove();
    }

    // ---- résultats en direct
    refresh() {
        if (this.refreshQueued || this.closed) return;
        this.refreshQueued = true;
        requestAnimationFrame(() => { this.refreshQueued = false; if (this.cur) this.refreshCells(this.cur); this.renderPresenter(); });
    }
    refreshCells(r) {
        for (const c of r.cells) {
            const st = this.env.outputs(c.open) || { outputs: [] };
            const out = c.fig.querySelector(".dk-out");
            const status = c.fig.querySelector(".dk-status");
            if (status) { status.textContent = st.running ? (st.status?.text || "…") : st.status?.text || ""; status.className = `dk-status ${st.running ? "live" : st.status?.kind || ""}`; }
            c.fig.classList.toggle("dk-running", !!st.running);
            const sig = JSON.stringify(st.outputs.map((o) => [o.output_type, o.text?.length, o.data && Object.keys(o.data), o.display_id]));
            const ask = st.node?.querySelector(".input-ask") || out.querySelector(".input-ask");
            if (sig === c.sig && (!ask || ask.parentNode === out)) continue;
            const grew = st.outputs.length > (c.n || 0);
            c.sig = sig;
            c.n = st.outputs.length;
            for (const e of [...out.children]) if (!e.matches(".input-ask")) e.remove();
            for (const o of st.outputs) out.insertBefore(renderOutput(o, { dark: this.env.dark, live: this.env.live?.(o), offline: this.env.offline?.() }), out.querySelector(".input-ask"));
            if (!st.outputs.length && c.runnable && !c.fig.classList.contains("dk-page")) out.insertAdjacentHTML("afterbegin", '<div class="dk-out-empty">▶ Exécuter pour voir le résultat</div>');
            if (ask && ask.parentNode !== out) { out.append(ask); ask.querySelector("input")?.focus(); }
            if (grew && out.lastElementChild && !reduce()) out.lastElementChild.animate([{ opacity: 0, transform: "translateY(8px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: EASE });
            renderMermaid(out, this.env.dark);
        }
        for (const g of r.el.querySelectorAll(".dk-glres")) {
            const t = this.env.phraseResult(+g.dataset.line);
            if (g.textContent !== t) g.textContent = t;
            g.hidden = !t;
        }
    }

    // ---- le code modifiable sur la diapositive
    cellOf(r, node) { return r.cells.find((c) => c.fig.contains(node)); }
    codeInput(e, r) {
        const c = this.cellOf(r, e.target);
        if (!c || !e.target.closest("code")) return;
        clearTimeout(c.timer);
        c.timer = setTimeout(() => { c.code = e.target.closest("code").innerText.replace(/\u200b/g, "").replace(/\n$/, ""); this.env.setCode(c.open, c.head + c.code); }, 250);
    }
    codeBlur(e, r) {
        const c = this.cellOf(r, e.target);
        const code = e.target.closest?.("code");
        if (!c || !code) return;
        clearTimeout(c.timer);
        const text = code.innerText.replace(/\u200b/g, "").replace(/\n$/, "");
        if (text !== c.code) { c.code = text; this.env.setCode(c.open, c.head + text); }
        paint(code, c.code, c.lang);
    }
    codeKey(e, r) {
        if (!e.target.closest?.("code")) return;
        if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "    "); }
        if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); const c = this.cellOf(r, e.target); if (c) { this.codeBlur(e, r); this.env.run(c.open); } }
        if (e.key === "Escape") { e.preventDefault(); e.target.closest("code").blur(); this.root.focus({ preventScroll: true }); }
    }

    // ---- souris, clavier, doigt
    slideClick(e, r) {
        const a = e.target.closest("a[href]");
        if (a) {
            const href = a.getAttribute("href");
            if (!href.startsWith("#")) return;   // un lien vers l'extérieur s'ouvre normalement
            e.preventDefault();
            this.link(decodeURIComponent(href.slice(1)), r);
            return;
        }
        const run = e.target.closest(".dk-run");
        if (run) { const c = this.cellOf(r, run); if (c) this.env.run(c.open); return; }
        if (e.target.closest("code, .dk-out, button, input, select, textarea, iframe, .lx-win, .out-table, .ch-bar, details")) return;
        if (this.tool) return;
        if (getSelection()?.toString()) return;
        this.next();
    }
    /** #4 · #suivant · #precedent · #executer · #fin · #un-titre (voir targetOf) */
    link(target, r = this.cur) {
        const to = targetOf(this.slides, this.i, target);
        if (!to) return;
        if (to.run) { for (const c of r.cells) if (c.runnable) this.env.run(c.open); return; }
        if (/^(suivant|suivante|next)$/.test(to.step || "")) return this.next();
        if (/^(prec|prev)/.test(to.step || "")) return this.prev();
        this.go(to.k);
    }
    key(e) {
        if (this.closed) return;
        const inPres = e.view && e.view !== window;
        const t = e.target;
        if (!inPres && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && e.key !== "F5") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        const over = !this.root.querySelector(".dk-over").hidden;
        let done = true;
        if (/^\d$/.test(k)) { this.typed += k; this.showGoto(); }
        else if (k === "Enter" && this.typed) { const n = +this.typed; this.typed = ""; this.showGoto(); this.go(n - 1); }
        else if (k === "Escape") {
            if (this.typed) { this.typed = ""; this.showGoto(); }
            else if (!this.root.querySelector(".dk-menu").hidden) this.pdfMenu(false);
            else if (over) this.overview(false);
            else if (this.tool) this.setTool(null);
            else if (!this.root.querySelector(".dk-blank").hidden) this.blank(null);
            else this.close();
        }
        else if (over && /^Arrow/.test(k)) this.overMove(k);
        else if (over && k === "Enter") { const s = this.root.querySelector(".dk-thumb.sel"); if (s) { this.overview(false); this.go(+s.dataset.i); } }
        else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) this.next();
        else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) this.prev();
        else if (k === "Home") this.go(0);
        else if (k === "End") this.go(this.slides.length - 1);
        else if (/^[og]$/i.test(k)) this.overview();
        else if (/^f$/i.test(k)) this.fullscreen();
        else if (/^n$/i.test(k)) this.toggleNotes();
        else if (/^p$/i.test(k)) this.presenter();
        else if (/^d$/i.test(k)) this.setTool(this.tool === "pen" ? null : "pen");
        else if (/^l$/i.test(k)) this.setTool(this.tool === "laser" ? null : "laser");
        else if (/^e$/i.test(k)) { this.ink.delete(this.i); this.drawInk(); }
        else if (/^r$/i.test(k)) this.link("executer");
        else if (k === "b" || k === "B" || k === ".") this.blank("black");
        else if (k === "w" || k === "W" || k === ",") this.blank("white");
        else if (k === "F5") this.go(0);
        else done = false;
        if (done) { e.preventDefault(); e.stopPropagation(); }
    }
    showGoto() {
        const g = this.root.querySelector(".dk-goto");
        g.hidden = !this.typed;
        g.textContent = this.typed ? `Aller à la diapositive ${this.typed} ↵` : "";
    }
    wire() {
        this.root.querySelector(".dk-bar").addEventListener("click", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            ({ prev: () => this.prev(), next: () => this.next(), grid: () => this.overview(), pen: () => this.setTool(this.tool === "pen" ? null : "pen"),
                laser: () => this.setTool(this.tool === "laser" ? null : "laser"), notes: () => this.toggleNotes(), presenter: () => this.presenter(),
                full: () => this.fullscreen(), exit: () => this.close(), pdf: () => this.pdfMenu(),
            })[a]?.();
        });
        this.root.querySelector(".dk-menu").addEventListener("click", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            this.pdfMenu(false);
            this.env.exportPdf?.({ notes: a === "pdf-notes" });
        });
        this.root.querySelector(".dk-end").addEventListener("click", () => this.close());
        this.root.querySelector(".dk-blank").addEventListener("click", () => this.blank(null));
        this.root.addEventListener("pointermove", (e) => {
            this.idle();
            if (this.tool === "laser") Object.assign(this.root.querySelector(".dk-laser").style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
        });
        // le doigt : glisser à gauche ou à droite
        let touch = null;
        this.root.addEventListener("touchstart", (e) => { if (e.touches.length === 1) touch = [e.touches[0].clientX, e.touches[0].clientY, Date.now()]; }, { passive: true });
        this.root.addEventListener("touchend", (e) => {
            if (!touch || this.tool) return;
            const t = e.changedTouches[0], dx = t.clientX - touch[0], dy = t.clientY - touch[1];
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - touch[2] < 800) (dx < 0 ? this.next() : this.prev());
            touch = null;
        });
        // le crayon
        let stroke = null;
        this.canvas.addEventListener("pointerdown", (e) => {
            if (this.tool !== "pen") return;
            e.preventDefault();
            this.canvas.setPointerCapture(e.pointerId);
            stroke = [this.toStage(e)];
            if (!this.ink.has(this.i)) this.ink.set(this.i, []);
            this.ink.get(this.i).push(stroke);
        });
        this.canvas.addEventListener("pointermove", (e) => { if (stroke) { stroke.push(this.toStage(e)); this.drawInk(); } });
        this.canvas.addEventListener("pointerup", () => { stroke = null; });
        document.addEventListener("fullscreenchange", () => setTimeout(() => this.layout(), 50));
    }
    pdfMenu(on = this.root.querySelector(".dk-menu").hidden) { this.root.querySelector(".dk-menu").hidden = !on; }
    idle() {
        this.root.classList.remove("dk-idle");
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.root.classList.add("dk-idle"), 2600);
    }
    toStage(e) {
        const r = this.stage.getBoundingClientRect();
        return [(e.clientX - r.left) / this.k, (e.clientY - r.top) / this.k];
    }
    drawInk() {
        const ctx = this.canvas.getContext("2d");
        const dpr = devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const strokes = this.ink.get(this.i);
        if (!strokes) return;
        const r = this.stage.getBoundingClientRect();
        ctx.setTransform(dpr * this.k, 0, 0, dpr * this.k, dpr * r.left, dpr * r.top);
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.lineWidth = 5;
        ctx.strokeStyle = getComputedStyle(this.root).getPropertyValue("--dk-ink").trim() || "#ff3d71";
        for (const s of strokes) {
            ctx.beginPath();
            s.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
        }
    }
    setTool(t) {
        this.tool = t;
        this.root.dataset.tool = t || "";
        this.root.querySelector(".dk-laser").hidden = t !== "laser";
        for (const b of this.root.querySelectorAll(".dk-bar [data-a]")) b.classList.toggle("on", b.dataset.a === t);
    }
    blank(color) {
        const b = this.root.querySelector(".dk-blank");
        b.hidden = !color;
        b.dataset.color = color || "";
    }
    fullscreen() {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else this.root.requestFullscreen?.().catch(() => {});
    }
    toggleNotes() {
        const n = this.root.querySelector(".dk-notes");
        n.hidden = !n.hidden;
        this.root.querySelector('[data-a="notes"]').classList.toggle("on", !n.hidden);
        this.updateChrome();
    }
    updateChrome() {
        const total = this.slides.length;
        this.root.querySelector(".dk-count").textContent = `${this.i + 1} / ${total}`;
        this.root.querySelector(".dk-progress i").style.transform = `scaleX(${total > 1 ? (this.i + (this.cur.steps ? this.step / (this.cur.steps + 1) : 0)) / (total - 1) : 1})`;
        const n = this.root.querySelector(".dk-notes");
        if (!n.hidden) n.innerHTML = this.cur.notes.length ? renderMarkdown(this.cur.notes.join("\n\n")) : "<p class='dk-faint'>Pas de notes pour cette diapositive : <code>&lt;!-- … --&gt;</code> dans son texte.</p>";
        this.drawInk();
        this.renderPresenter();
    }

    // ---- vue d'ensemble
    overview(on = this.root.querySelector(".dk-over").hidden) {
        const box = this.root.querySelector(".dk-over");
        box.hidden = !on;
        if (!on) { box.innerHTML = ""; return; }
        box.innerHTML = "";
        this.slides.forEach((s, i) => {
            const th = document.createElement("button");
            th.type = "button";
            th.className = `dk-thumb${i === this.i ? " sel" : ""}`;
            th.dataset.i = i;
            const r = renderSlide(s, { ...this.env, fm: this.env.fm(), slides: this.slides }, { index: i, total: this.slides.length, thumb: true });
            const holder = document.createElement("div");
            holder.className = "dk-thumb-stage";
            holder.append(r.el);
            th.append(holder);
            th.insertAdjacentHTML("beforeend", `<span>${i + 1}</span>`);
            th.addEventListener("click", () => { this.overview(false); this.go(i); });
            box.append(th);
            finalState(r);
            this.refreshCells(r);
            requestAnimationFrame(() => { holder.style.transform = `scale(${th.clientWidth / W})`; fit(r.el); });
        });
        if (!reduce()) [...box.children].forEach((t, n) => t.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE, delay: Math.min(n, 20) * 18, fill: "backwards" }));
        box.querySelector(".sel")?.scrollIntoView({ block: "center" });
    }
    overMove(k) {
        const all = [...this.root.querySelectorAll(".dk-thumb")];
        let i = all.findIndex((t) => t.classList.contains("sel"));
        const cols = Math.max(1, Math.round(this.root.querySelector(".dk-over").clientWidth / (all[0]?.offsetWidth + 24 || 300)));
        i += { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[k];
        i = Math.max(0, Math.min(all.length - 1, i));
        all.forEach((t, n) => t.classList.toggle("sel", n === i));
        all[i].scrollIntoView({ block: "nearest" });
    }

    // ---- vue présentateur : une autre fenêtre, diapositive en cours, suivante, notes, chronomètre
    presenter() {
        if (this.pres && !this.pres.closed) { this.pres.focus(); return; }
        const w = open("", "textedit-presenter", "popup,width=1180,height=720");
        if (!w) { this.env.toast?.("La fenêtre du présentateur est bloquée par le navigateur"); return; }
        this.pres = w;
        const d = w.document;
        d.open();
        d.write(`<!doctype html><html lang="fr" data-theme="${document.documentElement.dataset.theme || "dark"}"><head><meta charset="utf-8"><title>Présentateur — ${esc(this.env.title || "")}</title>` +
            [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${esc(l.href)}">`).join("") +
            `</head><body class="dk-presenter th-${this.theme.name}${this.root.classList.contains("dk-light") ? " dk-light" : ""}"><header><b class="pv-time">00:00</b><span class="pv-clock"></span><span class="pv-count"></span><span class="spacer"></span><button type="button" data-a="restart" title="Remettre le chronomètre à zéro">⟲</button><button type="button" data-a="prev">←</button><button type="button" data-a="next">→</button></header>` +
            `<main><section class="pv-cur"><div class="pv-box"></div></section><aside><div class="pv-label">Ensuite</div><section class="pv-next"><div class="pv-box"></div></section><div class="pv-label">Notes</div><div class="pv-notes"></div></aside></main></body></html>`);
        d.close();
        d.addEventListener("keydown", (e) => this.key(e));
        d.addEventListener("click", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (a === "next") this.next(); else if (a === "prev") this.prev(); else if (a === "restart") this.started = Date.now();
        });
        clearInterval(this.presTimer);
        this.presTimer = setInterval(() => {
            if (w.closed) { clearInterval(this.presTimer); return; }
            const s = Math.floor((Date.now() - this.started) / 1000);
            d.querySelector(".pv-time").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
            d.querySelector(".pv-clock").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        }, 500);
        w.addEventListener("resize", () => this.renderPresenter());
        setTimeout(() => this.renderPresenter(), 60);
    }
    renderPresenter() {
        const w = this.pres;
        if (!w || w.closed || !this.cur) return;
        const d = w.document;
        const put = (sel, el) => {
            const box = d.querySelector(`${sel} .pv-box`);
            if (!box) return;
            box.innerHTML = "";
            const stage = d.createElement("div");
            stage.className = "pv-stage";
            stage.append(el);
            box.append(stage);
            const k = Math.min(box.clientWidth / W, box.clientHeight / H) || .3;
            stage.style.transform = `scale(${k})`;
        };
        const cur = this.cur.el.cloneNode(true);
        cur.querySelectorAll(".dk-leaving").forEach((e) => e.remove());
        put(".pv-cur", cur);
        let next = null;
        if (this.step < this.cur.steps) {
            next = this.cur.el.cloneNode(true);
            for (const e of next.querySelectorAll("[data-step]")) e.classList.toggle("dk-hide", +e.dataset.step > this.step + 1);
        } else if (this.i < this.slides.length - 1) {
            const r = renderSlide(this.slides[this.i + 1], { ...this.env, fm: this.env.fm(), slides: this.slides }, { index: this.i + 1, total: this.slides.length });
            for (const e of r.el.querySelectorAll("[data-step]")) e.classList.add("dk-hide");
            next = r.el;
        }
        if (next) put(".pv-next", next); else d.querySelector(".pv-next .pv-box").innerHTML = '<p class="pv-end">Fin du diaporama</p>';
        d.querySelector(".pv-count").textContent = `Diapositive ${this.i + 1} / ${this.slides.length}${this.cur.steps ? ` · étape ${this.step} / ${this.cur.steps}` : ""}`;
        d.querySelector(".pv-notes").innerHTML = this.cur.notes.length ? renderMarkdown(this.cur.notes.join("\n\n")) : '<p class="dk-faint">Pas de notes.</p>';
    }
}

/**
 * Le PDF : toutes les diapositives, toutes étapes montrées, une par page au format de l'écran ; avec { notes },
 * une page A4 par diapositive (la diapositive, ses notes, des lignes pour écrire). Les boutons [→](#4) deviennent
 * des liens vers la page ; root.ready : les schémas Mermaid sont dessinés.
 */
export function printDeck(env, { notes = false } = {}) {
    const slides = parseDeck(env.parts(), env.fm());
    const root = document.createElement("div");
    root.id = "print-view";
    const theme = pickTheme(slides, env.fm());
    // le style que voit l'utilisateur : clair ou sombre comme le diaporama (classique suit l'éditeur)
    root.className = `deck-print th-${theme.name}${theme.light ?? !env.dark ? " dk-light" : ""}${notes ? " dk-handouts" : ""}`;
    const ready = [];
    const rendered = slides.map((s, i) => {
        const r = renderSlide(s, { ...env, fm: env.fm(), slides }, { index: i, total: slides.length });
        ready.push(r.ready);
        finalState(r);
        const page = document.createElement("div");
        page.className = "dk-page-print";
        page.id = `diapo-${i + 1}`;
        page.append(r.el);
        for (const c of r.cells) {
            const st = env.outputs(c.open) || { outputs: [] };
            const out = c.fig.querySelector(".dk-out");
            for (const o of st.outputs) out.append(renderOutput(o, { dark: env.dark, live: env.live?.(o), offline: env.offline?.() }));
            if (!st.outputs.length) c.fig.classList.remove("dk-side-out");
        }
        for (const g of r.el.querySelectorAll(".dk-glres")) { g.textContent = env.phraseResult(+g.dataset.line); g.hidden = !g.textContent; }
        return { r, page };
    });
    // les liens internes : vers la page de la diapositive
    rendered.forEach(({ r }) => {
        for (const a of r.el.querySelectorAll("a[data-to]")) a.setAttribute("href", `#diapo-${+a.dataset.to + 1}`);
    });
    rendered.forEach(({ r, page }, i) => {
        if (!notes) { root.append(page); return; }
        const sheet = document.createElement("section");
        sheet.className = "dk-handout";
        sheet.innerHTML = `<header><span>${esc(env.title || "")}</span><span>Diapositive ${i + 1} / ${slides.length}</span></header><div class="dk-hslide"></div><div class="dk-hnotes"></div>${r.notes.length ? "" : '<div class="dk-hlines"></div>'}`;
        sheet.querySelector(".dk-hslide").append(page);
        if (r.notes.length) sheet.querySelector(".dk-hnotes").innerHTML = renderMarkdown(r.notes.join("\n\n"));
        root.append(sheet);
    });
    root.ready = Promise.all(ready).catch(() => {});
    return root;
}

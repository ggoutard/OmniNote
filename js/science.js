// science.js — le mode scientifique : un document écrit comme un article (à la manière de LaTeX), qui calcule.
//
// Il s'active dans le document lui-même, par un en-tête (comme en Pandoc ou en Quarto) :
//
//     ---
//     mode: scientifique
//     auteurs: Xxxxx Xxxxx, Yyyyy Yyyyy
//     date: 16 octobre 2026
//     résumé: Une ou plusieurs lignes (les suivantes en retrait).
//     ---
//
// Le reste s'écrit en Markdown, avec les conventions de Pandoc :
//   ## Méthode {#sec:methode}                 sections numérotées (« # » est le titre de l'article)
//   $$ E = mc^2 $$ {#eq:energie}             équations numérotées (sur une ligne, ou entre deux lignes « $$ »)
//   ![Légende](image.png){#fig:schema}        figures numérotées et légendées
//   #| fig-cap: Légende   #| label: fig:ondes  la sortie d'un bloc de code devient une figure (comme en Quarto) ;
//                                              #| echo: false la montre sans son code dans le PDF
//   Table : Légende {#tbl:mesures}            sous ou sur un tableau Markdown : tableau numéroté
//   > [!DÉFINITION] Titre {#def:x}            définitions, théorèmes, lemmes… numérotés ; [!PREUVE] sans numéro
//   @fig:schema, @eq:energie, @tbl:x, @sec:x  renvois (« figure 2 », « (1) », « tableau 1 », « section 3.1 »)
//   [@einstein1905] ou [@a; @b]               citations, d'après un bloc ```bib (BibTeX) : [1], [1, 2]
//   {{moyenne}}                                une valeur calculée, prise à la jonction (Python, C++, une phrase…)
//
// Ce module ne fait qu'analyser et mettre en forme : l'éditeur (app.js) et le PDF s'en servent tous deux.

const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- en-tête

/** L'en-tête « --- … --- » en première ligne : { start, end, fields } ou null. */
export function frontMatter(lines) {
    if (lines[0]?.trim() !== "---") return null;
    let end = 1;
    while (end < lines.length && lines[end].trim() !== "---") end++;
    if (end >= lines.length || end > 60) return null;
    const fields = {};
    let key = null;
    for (let i = 1; i < end; i++) {
        const m = /^([\p{L}_-]+)\s*:\s*(.*)$/u.exec(lines[i]);
        if (m && !/^\s/.test(lines[i])) { key = fold(m[1]); fields[key] = m[2].trim(); }
        else if (key && lines[i].trim()) fields[key] += (fields[key] ? " " : "") + lines[i].trim();
    }
    return { start: 0, end, fields };
}

export const isScience = (fm) => !!fm && /^scien/.test(fold(fm.fields.mode || ""));

/** Le bloc de titre, en HTML : titre (le premier « # »), auteurs, date, résumé. */
export function titleBlock(fm, title, inline = (s) => escape(s)) {
    const f = fm.fields;
    const authors = (f.auteurs || f.auteur || f.author || f.authors || "").split(/\s*(?:,|;| et )\s*/).filter(Boolean);
    const abstract = f.resume || f.abstract || "";
    return `<header class="sci-title">${title ? `<h1>${inline(title)}</h1>` : ""}` +
        (authors.length ? `<div class="sci-authors">${authors.map((a) => `<span>${inline(a)}</span>`).join("")}</div>` : "") +
        (f.affiliation ? `<div class="sci-affil">${inline(f.affiliation)}</div>` : "") +
        (f.date ? `<div class="sci-date">${inline(f.date)}</div>` : "") +
        (abstract ? `<div class="sci-abstract"><b>Résumé</b>${inline(abstract)}</div>` : "") +
        (f["mots-cles"] || f["mots_cles"] ? `<div class="sci-keywords"><b>Mots-clés :</b> ${inline(f["mots-cles"] || f["mots_cles"])}</div>` : "") +
        "</header>";
}

// ---------------------------------------------------------------- analyse du document

const LABEL = /\s*\{#([\w:.-]+)\}\s*$/;
const THEOREMS = { definition: "Définition", theoreme: "Théorème", proposition: "Proposition", lemme: "Lemme", corollaire: "Corollaire",
    exemple: "Exemple", remarque: "Remarque", hypothese: "Hypothèse", propriete: "Propriété", preuve: "Preuve", demonstration: "Démonstration" };
const UNNUMBERED = new Set(["preuve", "demonstration"]);
const OPTION = /^\s*(?:#|\/\/|--|%%|;)\|\s*([\w-]+)\s*:\s*(.*?)\s*$/;

/** Les options « #| clé: valeur » en tête d'un bloc de code (comme en Quarto). */
export function blockOptions(code) {
    const opts = {};
    for (const l of code.split("\n")) {
        const m = OPTION.exec(l);
        if (!m) break;
        opts[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, "");
    }
    return opts;
}

/**
 * Tout ce que numérote le document. lines : ses lignes ; blocks : ses blocs de code (app.js, scan) — { start, end,
 * lang, info, code }. Rend { fm, headings, equations, figures, tables, theorems, labels, cites, bib }.
 */
export function analyze(lines, blocks) {
    const fm = frontMatter(lines);
    const inBlock = new Map();
    for (const b of blocks) for (let n = b.start; n <= b.end; n++) inBlock.set(n, b);
    const headings = new Map(), equations = new Map(), figures = new Map(), tables = new Map(), theorems = new Map();
    const labels = new Map(), cites = new Map(), bib = new Map();
    const sec = [0, 0, 0];
    let eq = 0, fig = 0, tbl = 0;
    const thm = {};
    const skipTo = fm ? fm.end + 1 : 0;
    for (const b of blocks) {
        if (/^(bib|bibtex)$/i.test(b.info || b.lang || "")) for (const e of parseBib(b.code)) bib.set(e.key, e);
    }
    for (let n = skipTo; n < lines.length; n++) {
        const b = inBlock.get(n);
        if (b) {
            // Un bloc dont la sortie est une figure (#| fig-cap) ou un tableau (#| tbl-cap)
            if (n === b.start && b.lang) {
                const o = blockOptions(b.code);
                const label = (o.label || "").replace(/^(fig|tbl)-/, "$1:");
                if (o["fig-cap"] != null || /^fig:/.test(label)) {
                    figures.set(n, { num: ++fig, cap: o["fig-cap"] || "", label, block: b, echo: !/^(false|non|no)$/i.test(o.echo || "") });
                    if (label) labels.set(label, { kind: "figure", num: String(fig) });
                } else if (o["tbl-cap"] != null || /^tbl:/.test(label)) {
                    tables.set(n, { num: ++tbl, cap: o["tbl-cap"] || "", label, block: b, echo: !/^(false|non|no)$/i.test(o.echo || "") });
                    if (label) labels.set(label, { kind: "tableau", num: String(tbl) });
                } else if (/^(false|non|no)$/i.test(o.echo || "")) figures.set(n, { num: 0, cap: "", label: "", block: b, echo: false, plain: true });
            }
            n = b.end;
            continue;
        }
        const t = lines[n];
        const h = /^(#{2,4})\s+(.*)$/.exec(t);
        if (h) {
            const level = h[1].length - 2;
            sec[level]++;
            for (let k = level + 1; k < 3; k++) sec[k] = 0;
            const num = sec.slice(0, level + 1).join(".");
            const lm = LABEL.exec(h[2]);
            headings.set(n, { num, level: level + 2, label: lm?.[1] || "" });
            if (lm) labels.set(lm[1], { kind: "section", num });
            continue;
        }
        // $$ … $$ sur une ligne, ou un bloc entre deux lignes « $$ »
        const one = /^\s*\$\$(.+)\$\$(\s*\{#[\w:.-]+\})?\s*$/.exec(t);
        if (one) {
            const label = LABEL.exec(one[2] || "")?.[1] || "";
            equations.set(n, { num: ++eq, tex: one[1].trim(), start: n, end: n, label });
            if (label) labels.set(label, { kind: "équation", num: String(eq) });
            continue;
        }
        if (/^\s*\$\$\s*$/.test(t)) {
            let e = n + 1;
            while (e < lines.length && !/^\s*\$\$/.test(lines[e])) e++;
            if (e < lines.length) {
                const label = LABEL.exec(lines[e])?.[1] || "";
                equations.set(n, { num: ++eq, tex: lines.slice(n + 1, e).join("\n").trim(), start: n, end: e, label });
                if (label) labels.set(label, { kind: "équation", num: String(eq) });
                n = e;
                continue;
            }
        }
        const img = /^\s*!\[([^\]]*)\]\(([^)]+)\)(\s*\{#[\w:.-]+\})?\s*$/.exec(t);
        if (img) {
            const label = LABEL.exec(img[3] || "")?.[1] || "";
            figures.set(n, { num: ++fig, cap: img[1].replace(/\s*\|\s*\d+(x\d+)?$/, ""), label, img: true });
            if (label) labels.set(label, { kind: "figure", num: String(fig) });
            continue;
        }
        const cap = /^\s*(?:Table|Tableau)\s*:\s*(.*?)(\s*\{#[\w:.-]+\})?\s*$/i.exec(t);
        if (cap && (/^\s*\|/.test(lines[n - 1] || "") || /^\s*\|/.test(lines[n + 1] || ""))) {
            const label = LABEL.exec(cap[2] || "")?.[1] || "";
            tables.set(n, { num: ++tbl, cap: cap[1], label, line: true });
            if (label) labels.set(label, { kind: "tableau", num: String(tbl) });
            continue;
        }
        const th = /^\s*>\s*\[!([\p{L}]+)\]\s*(.*?)(\s*\{#[\w:.-]+\})?\s*$/u.exec(t);
        if (th && THEOREMS[fold(th[1])]) {
            const kind = fold(th[1]);
            const num = UNNUMBERED.has(kind) ? "" : String((thm[kind] = (thm[kind] || 0) + 1));
            const label = LABEL.exec(th[3] || "")?.[1] || "";
            theorems.set(n, { kind, name: THEOREMS[kind], num, title: th[2], label });
            if (label) labels.set(label, { kind: THEOREMS[kind].toLowerCase(), num });
        }
    }
    // Les citations, numérotées dans l'ordre où elles apparaissent
    for (let n = skipTo; n < lines.length; n++) {
        if (inBlock.has(n)) continue;
        for (const m of lines[n].matchAll(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g)) {
            for (const k of m[1].split(";").map((x) => x.trim().slice(1))) if (!cites.has(k)) cites.set(k, cites.size + 1);
        }
    }
    return { fm, headings, equations, figures, tables, theorems, labels, cites, bib };
}

// ---------------------------------------------------------------- dans le texte : renvois, citations, valeurs

/** Une valeur de la jonction, écrite en français (1 234,5 ; listes « 12 ; 7 ; 15 »). */
export function formatValue(v) {
    if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("fr-FR") : v.toLocaleString("fr-FR", { maximumFractionDigits: 4 });
    if (typeof v === "boolean") return v ? "vrai" : "faux";
    if (Array.isArray(v)) return v.map(formatValue).join(" ; ");
    if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k} : ${formatValue(x)}`).join(", ");
    return v == null ? "" : String(v);
}

/**
 * Les morceaux d'une ligne de texte que le mode remplace : [{ from, to, kind, text, title, bad }]. values : nom ->
 * valeur (la jonction) ; info : analyze().
 */
export function inlineParts(line, info, values) {
    const out = [];
    for (const m of line.matchAll(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g)) {
        const keys = m[1].split(";").map((x) => x.trim().slice(1));
        const nums = keys.map((k) => info.cites.get(k));
        const missing = keys.filter((k) => !info.bib.has(k));
        out.push({ from: m.index, to: m.index + m[0].length, kind: "cite", text: `[${nums.join(", ")}]`,
            title: missing.length ? `référence absente du bloc bib : ${missing.join(", ")}` : keys.map((k) => plainRef(info.bib.get(k))).join("\n"), bad: missing.length > 0 });
    }
    for (const m of line.matchAll(/(^|[^\w@[])@((?:fig|eq|tbl|sec|def|thm|lem|prop|cor|ex|rem|hyp)[:][\w.-]+)/g)) {
        const at = m.index + m[1].length, l = info.labels.get(m[2]);
        if (out.some((x) => at >= x.from && at < x.to)) continue;
        // « la figure @fig:x » : le mot est déjà écrit, le renvoi ne donne que le numéro (comme \ref ; sinon \cref)
        const before = fold(line.slice(0, at)).match(/([a-z]+)\.?\s*$/)?.[1] || "";
        const named = l && (fold(l.kind).startsWith(before) && before.length >= 3 || (before === "fig" && l.kind === "figure") || (before === "tab" && l.kind === "tableau") || (before === "eq" && l.kind === "équation"));
        const text = !l ? `?${m[2]}` : l.kind === "équation" ? `(${l.num})` : named ? l.num : `${l.kind} ${l.num}`.trim();
        out.push({ from: at, to: at + m[2].length + 1, kind: "ref", text, title: l ? `renvoi : ${m[2]}` : `aucun élément ne porte l'étiquette ${m[2]}`, bad: !l });
    }
    // {{ f(10, 16) }} : une formule du document, calculée dans la page (formulas.js, values.eval)
    for (const m of line.matchAll(/\{\{\s*([^{}]*\([^{}]*\)[^{}]*?)\s*\}\}/g)) {
        let v, err = null;
        try { v = values.eval ? values.eval(m[1]) : undefined; if (typeof v !== "number" || !isFinite(v)) throw new Error("pas un nombre"); } catch (e) { err = e.message; }
        out.push({ from: m.index, to: m.index + m[0].length, kind: "value", text: err ? `?${m[1]}` : formatValue(v),
            title: err ? `« ${m[1]} » ne se calcule pas : ${err}` : `${m[1]} : calculé d'après les formules du document`, bad: !!err });
    }
    for (const m of line.matchAll(/\{\{\s*([\p{L}_][\p{L}\p{N}_ ]*?)\s*\}\}/gu)) {
        const name = m[1].trim().replace(/\s+/g, "_");
        const have = values.has(name) || values.has(fold(name));
        const v = values.get(name) ?? values.get(fold(name));
        out.push({ from: m.index, to: m.index + m[0].length, kind: "value", text: have ? formatValue(v) : `?${m[1]}`,
            title: have ? `${m[1]} : valeur calculée (la jonction des langages)` : `« ${m[1]} » n'a pas (encore) de valeur : exécutez le bloc qui la calcule`, bad: !have });
    }
    return out.sort((a, b) => a.from - b.from);
}

/** La ligne avec ses renvois, citations et valeurs écrits (pour le PDF : avant le rendu Markdown). */
export function resolveLine(line, info, values) {
    let out = "", last = 0;
    for (const p of inlineParts(line, info, values)) {
        out += line.slice(last, p.from) + `<span class="sci-${p.kind}${p.bad ? " bad" : ""}">${escape(p.text)}</span>`;
        last = p.to;
    }
    return (out + line.slice(last)).replace(LABEL, "");
}

// ---------------------------------------------------------------- bibliographie (BibTeX)

/** Les entrées d'un bloc BibTeX : [{ key, type, author, title, journal, year, … }]. */
export function parseBib(src) {
    const out = [];
    const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
    let m;
    while ((m = re.exec(src))) {
        let depth = 1, i = re.lastIndex;
        while (i < src.length && depth) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
        const body = src.slice(re.lastIndex, i - 1);
        const e = { key: m[2], type: m[1].toLowerCase() };
        const fre = /(\w+)\s*=\s*(\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
        let f;
        while ((f = fre.exec(body))) e[f[1].toLowerCase()] = (f[3] ?? f[4] ?? f[5] ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
        out.push(e);
        re.lastIndex = i;
    }
    return out;
}

function authorsOf(s = "") {
    const names = s.split(/\s+and\s+/i).map((a) => {
        const [last, first] = a.includes(",") ? a.split(/\s*,\s*/) : [a.split(" ").pop(), a.split(" ").slice(0, -1).join(" ")];
        const initials = (first || "").split(/[\s-]+/).filter(Boolean).map((p) => p[0] + ".").join(" ");
        return `${initials} ${last}`.trim();
    });
    return names.length > 3 ? `${names[0]} et al.` : names.join(names.length === 2 ? " et " : ", ");
}

/** Une entrée mise en forme, en HTML : A. Auteur, « Titre », Revue, vol. 17, p. 891, 1905. */
export function formatRef(e) {
    if (!e) return "";
    const parts = [authorsOf(e.author)];
    const book = /^(book|phdthesis|mastersthesis|manual)$/.test(e.type);
    if (e.title) parts.push(book ? `<i>${escape(e.title)}</i>` : `« ${escape(e.title)} »`);
    if (e.journal || e.booktitle) parts.push(`<i>${escape(e.journal || e.booktitle)}</i>`);
    if (e.volume) parts.push(`vol. ${escape(e.volume)}${e.number ? `, n° ${escape(e.number)}` : ""}`);
    if (e.pages) parts.push(`p. ${escape(e.pages.replace(/--?/, "–"))}`);
    if (e.publisher || e.school) parts.push(escape(e.publisher || e.school));
    if (e.year) parts.push(escape(e.year));
    let s = parts.filter(Boolean).join(", ") + ".";
    if (e.doi) s += ` doi:${escape(e.doi)}`;
    else if (e.url) s += ` <span class="sci-url">${escape(e.url)}</span>`;
    return s;
}

const plainRef = (e) => (e ? formatRef(e).replace(/<[^>]+>/g, "") : "");

/** La liste des références citées, dans l'ordre des citations (puis les autres entrées du bloc). */
export function references(info) {
    const keys = [...info.cites.keys(), ...[...info.bib.keys()].filter((k) => !info.cites.has(k))];
    const items = keys.filter((k) => info.bib.has(k)).map((k, i) => `<li><span class="sci-refnum">[${info.cites.get(k) ?? i + 1}]</span><span class="sci-reftext">${formatRef(info.bib.get(k))}</span></li>`);
    return items.length ? `<section class="sci-refs"><h2>Références</h2><ol>${items.join("")}</ol></section>` : "";
}

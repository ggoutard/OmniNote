// learn.js — ce que le document apprend de son auteur, sans rien deviner : des lectures confirmées et des tournures
// enseignées, généralisées par anti-unification (Plotkin) — ce que deux exemples ont en commun devient la règle, ce qui
// les distingue devient un emplacement.
//
// Une lecture confirmée : la forme de la phrase, ses données remplacées par {} (les nombres par {n}, les textes par {t}),
// avec les parenthèses de la lecture choisie — « affiche (la moyenne des {}) qui sont au moins {n} ». Une autre phrase de
// même forme se lit pareil (« affiche la moyenne des loyers qui sont au moins 700 »).
// Une tournure enseignée : une phrase en français libre et ce qu'elle veut dire — « montre-moi le loyer stp » veut dire
// « Affiche le loyer. » ; ce qu'elles ont en commun devient l'emplacement : « montre moi {X} stp » → « Affiche {X}. »
//
// Tout s'écrit dans le document, en clair (un commentaire « lexique » à la fin) : on lit, corrige ou efface ce qu'il a appris.

import { tokens } from "./translate.js";
import { fromTag, join, sub, tag } from "../modele/sortes.js";

// ---------------------------------------------------------------- les lectures

/** La forme d'une phrase lue : [{ w, at, end }] — w : le mot replié, ou {} (une donnée), {n}, {t} ; une donnée dont la
 *  sorte est sûre porte son étiquette (role.sort, sens.js) : {liste:nombre}, {nombre:€}, {fiche:élève}. */
export function shapeOf(text, roles = []) {
    const out = [];
    const toks = tokens(text);
    while (toks.length && toks[toks.length - 1].kind === "punct" && /[.!]/.test(toks[toks.length - 1].f)) toks.pop();
    for (const t of toks) {
        const ro = roles.find((r) => r.at <= t.at && t.end <= r.end), role = ro?.role;
        const w = t.kind === "num" ? "{n}" : t.kind === "str" ? "{t}" : role === "data" || role === "type" ? `{${ro.sort || ""}}` : t.f;
        const last = out[out.length - 1];
        // une donnée de plusieurs mots (« prix de vente ») est une seule donnée
        if (isData(w) && last?.w === w && last.role === ro && /^\s*$/.test(text.slice(last.end, t.at))) { last.end = t.end; continue; }
        if (isData(w)) { out.push({ w, at: t.at, end: t.end, role: ro }); continue; }
        out.push({ w, at: t.at, end: t.end });
    }
    return out;
}

/** Une règle de lecture, depuis son texte : « affiche (la moyenne des {}) qui sont au moins {n} ». */
export function parseReading(line) {
    const items = [], groups = [];
    let open = [];
    for (const raw of line.trim().split(/\s+/)) {
        let w = raw;
        let opens = 0, closes = 0;
        while (w.startsWith("(")) { opens++; w = w.slice(1); }
        while (w.endsWith(")")) { closes++; w = w.slice(0, -1); }
        if (!w) continue;
        for (let k = 0; k < opens; k++) open.push(items.length);
        items.push(w);
        for (let k = 0; k < closes; k++) if (open.length) groups.push([open.pop(), items.length - 1]);
    }
    return { items, groups };
}
/** Son texte. */
export function readingText(rule) {
    return rule.items.map((w, k) => `${"(".repeat(rule.groups.filter((g) => g[0] === k).length)}${w}${")".repeat(rule.groups.filter((g) => g[1] === k).length)}`).join(" ");
}

/** La règle d'une lecture : la forme de la phrase, et ses parenthèses (en positions de la forme). */
export function readingRule(text, roles, edits = []) {
    const shape = shapeOf(text, roles);
    const groups = [];
    for (const d of edits) {
        if (d.op !== "group") return null;   // (un pronom lu comme un nom ne se généralise pas : il dépend du document)
        const a = shape.findIndex((s) => s.at === d.at || (s.at < d.at && d.at < s.end));
        const b = shape.findLastIndex((s) => s.end <= (d.close ?? d.end));
        if (a < 0 || b < a) return null;
        groups.push([a, b]);
    }
    return { items: shape.map((s) => s.w), groups };
}

// une donnée : {} ou {étiquette} (pas {n}, {t} : les nombres et textes écrits)
const isData = (w) => /^\{(?!n\}|t\})[^}]*\}$/.test(w);
const tagOf = (w) => w.slice(1, -1);
/** Un mot de la règle et un mot de la phrase : le même, ou une donnée dont la sorte est une sorte de celle de la règle
 *  ({} : toute donnée ; {nombre:€} : un nombre en €, pas une surface). */
const fits = (r, w) => r === "*" || r === w || (isData(r) && isData(w) && (!tagOf(r) || (!!tagOf(w) && sub(fromTag(tagOf(w)), fromTag(tagOf(r))))));
const match = (rule, shape) => rule.items.length === shape.length && rule.items.every((w, k) => fits(w, shape[k].w));

/** La règle apprise qui s'applique à cette phrase : { rule, groups (en positions du texte) } ou null. */
export function learnedReading(rules, text, roles) {
    if (!rules?.length) return null;
    const shape = shapeOf(text, roles);
    for (const rule of rules) if (match(rule, shape)) return { rule, groups: rule.groups.map(([a, b]) => [shape[a].at, shape[b].end]) };
    return null;
}

/** Ces modifications sont-elles celles de la règle ? (la même lecture : les mêmes groupes) */
export function sameGroups(edits, groups) {
    const gs = edits.filter((d) => d.op === "group");
    if (gs.length !== groups.length || edits.length !== gs.length) return false;
    return groups.every(([a, b]) => gs.some((d) => d.at === a && (d.close ?? d.end) === b));
}

/**
 * Ajouter une lecture confirmée aux règles, en généralisant : avec une règle de même longueur et mêmes groupes, les
 * mots qui diffèrent deviennent « * » (l'anti-unification des deux formes) — sauf si plus rien de précis ne resterait.
 */
export function addReading(rules, rule) {
    const out = [...rules];
    for (let i = 0; i < out.length; i++) {
        const r = out[i];
        if (r.items.length !== rule.items.length || JSON.stringify(r.groups) !== JSON.stringify(rule.groups)) continue;
        // deux données de sortes différentes : la sorte qui contient les deux (sortes.js) — deux sommes en € restent {nombre:€}
        const items = r.items.map((w, k) => (w === rule.items[k] ? w : isData(w) && isData(rule.items[k]) ? `{${joinTags(tagOf(w), tagOf(rule.items[k]))}}` : "*"));
        const kept = items.filter((w) => w !== "*" && !/^\{/.test(w)).length;
        if (kept < Math.ceil(items.filter((w) => !/^\{/.test(w)).length / 2)) continue;
        out[i] = { items, groups: r.groups };
        return dedupe(out);
    }
    // une règle contraire (même forme, autre lecture) : la nouvelle la remplace
    return dedupe([...out.filter((r) => !(r.items.join(" ") === rule.items.join(" "))), rule]);
}
const joinTags = (a, b) => (a && b ? tag(join(fromTag(a), fromTag(b))) : "");
const dedupe = (rules) => [...new Map(rules.map((r) => [readingText(r), r])).values()];

// ---------------------------------------------------------------- les tournures

const SMALL = new Set("le la les l un une des de du d a au aux et ou en dans par pour sur".split(" "));

/**
 * Une tournure, d'après un exemple : la phrase libre et ce qu'elle veut dire. Ce qu'elles ont en commun (les plus
 * longues suites de mots communes, pas seulement des petits mots) devient un emplacement {X}, {Y}…
 * → { motif, forme } ou null (rien de commun : la tournure ne se généralise pas)
 */
export function tournureFrom(free, meant) {
    const a = tokens(free).filter((t) => t.kind !== "punct"), b = tokens(meant).filter((t) => t.kind !== "punct");
    const slots = [];   // [ia, ja, ib, jb]
    const usedA = new Set(), usedB = new Set();
    for (;;) {
        let best = null;
        for (let i = 0; i < a.length; i++) for (let k = 0; k < b.length; k++) {
            let n = 0;
            while (i + n < a.length && k + n < b.length && !usedA.has(i + n) && !usedB.has(k + n) && a[i + n].f === b[k + n].f) n++;
            if (!n || a.slice(i, i + n).every((t) => SMALL.has(t.f))) continue;
            if (!best || n > best[2]) best = [i, k, n];
        }
        if (!best) break;
        const [i, k, n] = best;
        for (let q = 0; q < n; q++) { usedA.add(i + q); usedB.add(k + q); }
        slots.push([i, i + n, k, k + n]);
    }
    if (!slots.length) return null;
    const names = "XYZUVW";
    slots.sort((x, y) => x[2] - y[2]);
    const name = new Map(slots.map((s, q) => [s, names[q]]));
    const motif = [], forme = [];
    for (let i = 0; i < a.length;) {
        const s = slots.find((x) => x[0] === i);
        if (s) { motif.push(`{${name.get(s)}}`); i = s[1]; } else { motif.push(a[i].f); i++; }
    }
    // la forme garde le texte d'origine (accents, majuscules) hors des emplacements
    let out = "", last = 0;
    for (const s of [...slots].sort((x, y) => x[2] - y[2])) {
        out += meant.slice(last, b[s[2]].at) + `{${name.get(s)}}`;
        last = b[s[3] - 1].end;
    }
    out += meant.slice(last);
    void forme;
    return { motif: motif.join(" "), forme: out.trim() };
}

/** Ajouter une tournure, en généralisant avec une autre de même forme : les mots qui diffèrent deviennent un choix. */
export function addTournure(list, t) {
    const out = [...list];
    for (let i = 0; i < out.length; i++) {
        const r = out[i];
        if (r.forme !== t.forme) continue;
        const x = r.motif.split(" "), y = t.motif.split(" ");
        if (x.length !== y.length) continue;
        const merged = x.map((w, k) => {
            if (w === y[k]) return w;
            if (/^\{/.test(w) || /^\{/.test(y[k])) return null;
            const alts = new Set([...w.replace(/^\(|\)$/g, "").split("|"), y[k]]);
            return `(${[...alts].join("|")})`;
        });
        if (merged.includes(null)) continue;
        out[i] = { motif: merged.join(" "), forme: r.forme };
        return out;
    }
    return [...out.filter((r) => r.motif !== t.motif), t];
}

// ---------------------------------------------------------------- le lexique dans le document

const BLOCK = /<!--\s*lexique\b([\s\S]*?)-->/i;

/** Le lexique d'un document : { readings: [règle], tournures: [{ motif, forme }] }. */
export function lexiconOf(text) {
    const m = BLOCK.exec(text);
    const lex = { readings: [], tournures: [] };
    if (!m) return lex;
    for (const line of m[1].split("\n")) {
        const l = line.trim();
        let x;
        if ((x = /^lecture\s*:\s*(.+)$/i.exec(l))) lex.readings.push(parseReading(x[1]));
        else if ((x = /^tournure\s*:\s*(.+?)\s*(?:=>|→)\s*(.+)$/i.exec(l))) lex.tournures.push({ motif: x[1], forme: x[2] });
    }
    return lex;
}
/** Le texte du document, avec ce lexique (le bloc remplacé, ajouté à la fin, ou retiré s'il est vide). */
export function withLexicon(text, lex) {
    const lines = [...lex.readings.map((r) => `lecture : ${readingText(r)}`), ...lex.tournures.map((t) => `tournure : ${t.motif} → ${t.forme}`)];
    const block = lines.length ? `<!-- lexique — ce que ce document a appris (OmniNote) :\n${lines.join("\n")}\n-->` : "";
    if (BLOCK.test(text)) return text.replace(BLOCK, block).replace(/\n{3,}$/, "\n");
    return block ? `${text.replace(/\s*$/, "")}\n\n${block}\n` : text;
}

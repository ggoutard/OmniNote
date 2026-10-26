// Grama Lectica — la couche haute, dans le texte : une phrase entre _…_ parle à la machine.
//
//   phrasesIn(ligne)      les phrases _…_ d'une ligne de texte (un curseur {650, de 400 à 1500} y est lu comme sa valeur)
//   slidersIn(texte)      les curseurs d'un texte : { from, to, value, min, max, step }
//   tablesIn(lignes)      les tableaux Markdown du document, nommés par le titre au-dessus
//   readDocument(textes, tableaux)  lit toutes les phrases d'un document (les actions définies valent partout)
//   runDocument(lues)     les exécute de haut en bas ; rend, pour chacune, ce qu'elle affiche ou son erreur
//
// Voir lexicon.js (le thésaurus), parse.js (la lecture), run.js (l'exécution).

import { parse, definitions, namesOf, expected, Unclear, suggest, readings } from "./parse.js";
import { learnedReading, sameGroups } from "./learn.js";
import { Machine, Fault, toPython, toShare, show, seedValue } from "./run.js";
import { toCpp, readOutput } from "./cpp.js";
import { LEXICON, ROLE, verbKey } from "./lexicon.js";
import { translate, tokens as wordsOf, STRONG, ACCEPT, SUGGEST } from "./translate.js";
import { unitOf } from "../modele/sortes.js";
import { typeDocument, conflictsOf, typingKey, sortsIn } from "./sens.js";
import { tag, text as sortText } from "../modele/sortes.js";
import { discourse, dependencies, namesIn, dependsOn } from "./discours.js";
import { sayExpr } from "./paraphrase.js";

export { Unclear, Fault, toPython, toShare, show, suggest, toCpp, readOutput, expected, readings };
export { paraphrase } from "./paraphrase.js";
export { lexiconOf, withLexicon, readingRule, addReading, tournureFrom, addTournure, readingText, parseReading } from "./learn.js";

// Un curseur dans une phrase : {650, de 400 à 1500}, {650, 400..1500}, {0,5, de 0 à 1, pas 0,05}. La phrase le lit
// comme sa valeur (« Le loyer vaut 650. ») ; l'éditeur le dessine comme un curseur, qu'on fait glisser.
const NUM = "-?\\d+(?:[.,]\\d+)?";
const SLIDER = new RegExp(`\\{\\s*(${NUM})\\s*[,;]\\s*(?:de\\s+|entre\\s+)?(${NUM})\\s*(?:à|a|et|\\.\\.|–|—)\\s*(${NUM})(?:\\s*[,;]\\s*(?:pas|par)\\s+(${NUM}))?\\s*\\}`, "gu");
const num = (t) => Number(String(t).replace(",", "."));
// un pas « rond » (1, 2, 5, 10, 20, 50…) d'environ un centième de l'étendue, entier au moins
const niceStep = (raw) => { if (raw <= 1) return 1; const k = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((m) => m * k).find((x) => x >= raw * .75) ?? 10 * k; };

/** Les curseurs d'un texte : [{ from, to, value, min, max, step, text }] (text : la valeur telle qu'elle est écrite). */
export function slidersIn(text) {
    const out = [];
    for (const m of text.matchAll(SLIDER)) {
        const [min, max] = [num(m[2]), num(m[3])].sort((a, b) => a - b);
        const decimals = Math.max(...[m[1], m[2], m[3], m[4] || ""].map((x) => (/[.,](\d+)$/.exec(x)?.[1].length) || 0));
        const written = [m[1], m[2], m[3], m[4] || ""].join(" ");
        // dot : les décimales s'écrivent avec un point (le document l'a fait) ; sinon avec la virgule française
        out.push({ from: m.index, to: m.index + m[0].length, value: num(m[1]), min, max, text: m[1], dot: /\./.test(written) && !/\d,\d/.test(written),
            step: m[4] ? num(m[4]) : decimals ? 10 ** -decimals : niceStep((max - min) / 100), decimals });
    }
    return out;
}

/** Les phrases machine d'une ligne : _…_ hors des mots (ma_variable reste du texte). Une phrase avec des curseurs :
 *  text est ce que lit le moteur (chaque curseur remplacé par sa valeur), raw le texte écrit, sliders ses curseurs (dans
 *  raw), et at(i) la place dans raw d'une position de text (pour colorer et souligner au bon endroit). */
export function phrasesIn(line) {
    const out = [];
    const re = /(^|[^\p{L}\p{N}_`])_(?!\s)([^_\n`]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu;
    let m;
    while ((m = re.exec(line))) {
        const from = m.index + m[1].length;
        const raw = m[2], sliders = raw.includes("{") ? slidersIn(raw) : [];
        if (!sliders.length) { out.push({ from, to: from + raw.length + 2, text: raw }); continue; }
        let text = "", last = 0;
        const spans = [];   // [début dans text, fin dans text, début dans raw, longueur dans raw]
        for (const sl of sliders) {
            text += raw.slice(last, sl.from);
            spans.push([text.length, text.length + sl.text.length, sl.from, sl.to - sl.from]);
            text += sl.text;
            last = sl.to;
        }
        text += raw.slice(last);
        const at = (i) => {
            let shift = 0;
            for (const [a, b, r, len] of spans) {
                if (i < a) break;
                if (i < b) return r + 1 + (i - a);           // dans la valeur : dans les accolades
                shift = r + len - b;                          // après ce curseur
            }
            return i + shift;
        };
        out.push({ from, to: from + raw.length + 2, text, raw, sliders, at });
    }
    return out;
}

const EMPTY = { values: new Map(), tables: new Map(), fields: [] };

/**
 * Les phrases de la prose d'un document : [{ n (ligne), from (colonne), text }] — hors du code, des titres, des tableaux,
 * des encadrés (> …), des commentaires et de l'en-tête ; une phrase qui contient une phrase machine (_…_) n'en est pas.
 * Le balisage (**gras**, `code`, [lien](…)) devient des espaces : les positions restent celles de la ligne.
 */
export function proseIn(lines) {
    const out = [];
    let fence = false, comment = false, front = lines[0]?.trim() === "---";
    lines.forEach((l, n) => {
        if (front) { if (n > 0 && l.trim() === "---") front = false; return; }
        if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
        if (fence) return;
        if (comment || /<!--/.test(l)) { comment = !/-->/.test(l); return; }
        if (/^\s*(#|\||>|<|Table\s*:|\$\$)/.test(l) || !l.trim()) return;
        const clean = l.replace(/\[([^\]]*)\]\([^)]*\)/g, (m, t) => ` ${t}${" ".repeat(m.length - t.length - 1)}`).replace(/[*`]/g, " ").replace(/\{\{[^}]*\}\}/g, (m) => " ".repeat(m.length))
            .replace(/^(\s*)([-+]|\d+\.)\s/, (m) => " ".repeat(m.length));
        for (const m of clean.matchAll(/[^.!?]+(?:[.!?]+|$)/g)) {
            const raw = m[0], lead = raw.length - raw.trimStart().length, text = raw.trim();
            if (text.split(/\s+/).length < 3 || /(^|[^\p{L}\p{N}])_\S/u.test(l.slice(m.index, m.index + raw.length))) continue;
            out.push({ n, from: m.index + lead, text });
        }
    });
    return out;
}

/**
 * Les données que les phrases « boivent » : les variables de Python (nombres, textes, listes, dictionnaires
 * devenus fiches, tableaux numpy) et les tables SQLite, sous les noms de la langue (« prix_vente » -> prix de vente).
 * skip : les noms que le document envoie lui-même à Python (ils ne reviennent pas).
 */
export function externalData(values = {}, tables = {}, skip = new Set()) {
    const fields = new Set();
    const norm = (v) => {
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === "object" && v.$fiche) {
            const o = {};
            for (const [k, x] of Object.entries(v.$fiche)) { const n = nameOfText(k); if (n) { fields.add(n); o[n] = norm(x); } }
            return v.$class ? { $fiche: o, $class: v.$class } : { $fiche: o };
        }
        return v;
    };
    const out = new Map();
    for (const [k, v] of Object.entries(values)) {
        const n = nameOfText(k);
        if (n && !skip.has(k) && !out.has(n)) out.set(n, norm(v));
    }
    const tbs = new Map();
    for (const [k, t] of Object.entries(tables)) {
        const n = nameOfText(k);
        if (n && t.columns?.length) tbs.set(n, { columns: t.columns.map(nameOfText), rows: t.rows.map((r) => r.map((x) => x ?? "")) });
    }
    return { values: out, tables: tbs, fields: [...fields] };
}

/** Un titre ou un en-tête de colonne devenu nom : « Les loyers (€) » -> loyers */
export function nameOfText(t) {
    const ws = t.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[*_`~]/g, " ").replace(/'/g, "' ").split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    while (ws.length > 1 && /^(le|la|les|l'|un|une|des|the|a|an)$/.test(ws[0])) ws.shift();
    return ws.map((w) => w.replace(/'$/, "")).filter(Boolean).join("_");
}

const cellValue = (c) => {
    const t = c.trim().replace(/^\*\*(.*)\*\*$/, "$1").replace(/^`(.*)`$/, "$1").trim();
    const n = t.replace(/[\s\u00a0\u202f]/g, "").replace(/[€$%]$/, "");
    if (/^-?\d+(?:[.,]\d+)?$/.test(n)) return Number(n.replace(",", "."));
    return t;
};

/**
 * Les tableaux Markdown d'un document, nommés par le titre qui les précède : nom -> { columns, rows }.
 * Une cellule vide n'a pas de valeur ; « 1 450 € » vaut 1450.
 */
export function tablesIn(lines) {
    const tables = new Map();
    let heading = "", fence = false;
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
        if (fence) continue;
        const h = /^#{1,6}\s+(.*)$/.exec(l);
        if (h) { heading = nameOfText(h[1].replace(/\{#[^}]*\}/g, " ")); continue; }   // (sans son ancre {#sec:…})
        if (!/^\s*\|/.test(l) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) continue;
        const heads = cells(l), columns = heads.map(nameOfText);
        const rows = [], raw = [];
        let k = i + 2;
        for (; k < lines.length && /^\s*\|/.test(lines[k]); k++) { const cs = cells(lines[k]).slice(0, columns.length); raw.push(cs); rows.push(cs.map(cellValue)); }
        // l'unité d'une colonne : celle de son en-tête (« Loyer (€) »), sinon le symbole de ses cellules (« 650 € »)
        const units = heads.map((h, j) => unitOf(h) || raw.map((r) => /[\d\s]([€$%])\s*$/.exec(r[j] || "")?.[1]).find(Boolean) || null);
        if (heading && !tables.has(heading) && columns.every(Boolean)) tables.set(heading, { columns, rows, units, line: i });
        i = k - 1;
    }
    return tables;
}

/**
 * Lit les phrases d'un document. Deux passes : la première trouve les actions (« pour doubler un nombre, … »)
 * et les classes (« un appartement a un loyer… »), la seconde lit tout en les connaissant — on peut donc
 * appeler une action ou nommer une classe définie plus bas.
 */
export function readDocument(texts, tables = new Map(), external = EMPTY, { prose = new Set() } = {}) {
    // (la prose — opts.prose : les indices des phrases ordinaires du texte — ne définit rien : elle affirme, au plus)
    const ctx = contextOf(texts.filter((_, k) => !prose.has(k)), tables, external);
    let focus = null;
    // les données nommées jusqu'ici, la plus récente à la fin : ce à quoi un pronom peut renvoyer (lire large)
    const before = [];
    // le genre et le nombre des données, d'après leurs déterminants dans les phrases d'avant (parse.js : l'accord)
    const genders = new Map();
    return texts.map((text, k) => {
        const c = focus && genders.has(focus) ? { ...ctx, genders: new Map([[focus, genders.get(focus)]]) } : ctx;
        if (prose.has(k)) return readProse(text, c, focus);
        const r = readPhrase(text, c, focus);
        for (const [n, g] of r.genders || []) if (!genders.has(n)) genders.set(n, g);
        // (pour lire large à l'exécution, runDocument : le contexte de la lecture — hors du JSON de la phrase)
        Object.defineProperty(r, "$ctx", { value: { ...c, focus, before: [...before] }, enumerable: false, writable: true });
        if (r.ast) for (const n of namesOf(r.ast)) { const i = before.indexOf(n); if (i >= 0) before.splice(i, 1); before.push(n); }
        focus = focusOf(r.ast) ?? focus;
        return r;
    });
}

function literal(text, ctx, focus) {
    try { return { text, ...parse(text, { ...ctx, focus }) }; }
    catch (e) {
        if (!(e instanceof Unclear)) throw e;
        return { text, error: { msg: e.message, at: e.at, end: e.end }, roles: e.roles || [], doubts: [] };
    }
}

/**
 * Une phrase, lue telle quelle ou traduite du français libre (translate.js) :
 *   · une tournure reconnue avec certitude (« Quelle est la moyenne des notes ? ») est traduite, même si la lecture
 *     littérale tient : celle-ci se trompe alors (elle crée une donnée « quelle ») ;
 *   · sinon la lecture littérale, si elle est sûre ;
 *   · sinon la traduction la plus ressemblante qui se lit sans doute ;
 *   · sinon la lecture littérale, avec son erreur, et la traduction la plus proche en proposition.
 * Une phrase traduite garde son texte ; translated dit en quoi, d'après quel modèle, avec quelle ressemblance.
 */
function readPhrase(text, ctx, focus) {
    // « Donc … », « Q, car P » : les propositions se lisent chacune, le lien entre elles est noté (discours.js)
    const d = discourse(text);
    if (d) { const r = readDiscourse(text, d, ctx, focus); if (r) return r; }
    return readPlain(text, ctx, focus);
}

/**
 * Une phrase de la prose : retenue seulement si c'est une affirmation lue sans aucun doute, sur des données qui existent
 * (« Le loyer moyen dépasse donc 600 € ») ; sinon rien — la prose est libre, la machine n'y signale que ce qu'elle sait.
 * Elle ne s'exécute pas : seules ses affirmations sont jugées (runDocument).
 */
function readProse(text, ctx, focus) {
    const none = { text, ast: null, roles: [], doubts: [], prose: true };
    let r;
    try { r = readPhrase(text, ctx, focus); } catch (e) { if (e instanceof Unclear) return none; throw e; }
    if (r.error || r.translated || r.doubts.length || !sound(r, ctx)) return none;
    const parts = r.discourse?.parts ?? [{ at: 0, end: text.length, claim: claimOf(r) }];
    if (!parts.some((p) => p.claim) || !parts.every((p) => p.claim && prosaic(p.claim, ctx))) return none;
    return { text, ast: null, roles: [], doubts: [], prose: true, discourse: r.discourse ?? { lead: null, inner: null, parts } };
}
/** Une affirmation de la prose qu'on peut juger : elle nomme une donnée du document, et aucune classe inconnue. */
function prosaic(c, ctx) {
    let data = false, ok = true;
    walkAst(c, (n) => {
        if (n.type === "name" && ctx.names.has(n.name)) data = true;
        if (n.type === "field" || n.type === "table") data = true;
        if (n.type === "isa" && !ctx.classes.has(n.cls)) ok = false;
    });
    return data && ok;
}

/** Une phrase et ses liens logiques : chaque proposition lue seule, ses positions remises dans la phrase entière. */
function readDiscourse(text, d, ctx, focus) {
    // les découpages possibles, du plus explicite au plus discret : « Q, car P » ; le connecteur de tête ; celui du milieu
    const tries = [];
    if (d.lead || d.inner) tries.push({ parts: d.parts, lead: d.lead, inner: d.inner });
    if (d.adverb) tries.push({ parts: [d.blanked], lead: d.adverb, inner: null, adverb: true });
    for (const t of tries) { const r = readParts(text, t, ctx, focus); if (r) return r; }
    return null;
}
function readParts(text, d, ctx, focus) {
    const subs = d.parts.map((p) => ({ p, r: readPlain(p.text, ctx, focus) }));
    // une proposition qui ne se lit pas : la phrase se lit comme avant (le connecteur était peut-être un nom)
    if (subs.some(({ r }) => r.error || !sound(r, ctx))) return null;
    const asts = [], roles = [], doubts = [];
    const span = (x, off) => ({ ...x, at: x.at + off, end: x.end + off });
    for (const { p, r } of subs) {
        asts.push(shift(r.ast, p.at));
        roles.push(...r.roles.map((x) => span(x, p.at)));
        doubts.push(...r.doubts.map((x) => ({ ...span(x, p.at), ...(x.fix ? { fix: span(x.fix, p.at) } : {}) })));
    }
    for (const c of [d.lead, d.inner]) if (c) roles.push({ at: c.at, end: c.end, role: "link" });
    roles.sort((a, b) => a.at - b.at);
    const ast = asts.length === 1 ? asts[0] : { type: "seq", list: asts };
    const parts = subs.map(({ p, r }) => ({ at: p.at, end: p.at + p.text.length, claim: claimOf(r) && shift(claimOf(r), p.at) }));
    // (un adverbe, « donc » au milieu, ne fait que relier : il n'a pas de proposition à lui)
    return { text, ast, roles, doubts, far: subs[0].r.far, discourse: { lead: d.lead, inner: d.inner, parts } };
}

/** Les positions d'un arbre, décalées (une proposition lue seule, remise à sa place dans la phrase). */
function shift(n, off) {
    if (!off || !n || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map((x) => shift(x, off));
    const out = {};
    for (const [k, v] of Object.entries(n)) out[k] = (k === "at" || k === "end") && typeof v === "number" ? v + off : v && typeof v === "object" ? shift(v, off) : v;
    return out;
}

const CONDITIONS = new Set(["and", "or", "eq", "ne", "gt", "lt", "ge", "le", "contains"]);
const isCondition = (e) => ["bool", "test", "not", "isa"].includes(e?.type) || (e?.type === "bin" && CONDITIONS.has(e.op));
/** Ce qu'affirme une phrase lue, si c'en est une (« Le total est plus grand que 700. ») : l'expression, ou null.
 *  Une affirmation n'est pas une demande d'affichage : aucun verbe qui veut dire « afficher » n'y est écrit (le lexique
 *  et la morphologie le disent : « affiche », « montrer », « écris »…). */
function claimOf(r) {
    if (!r?.ast || r.roles.some((x) => x.role === "action" && r.text.slice(x.at, x.end).split(/[\s'-]+/).some((w) => verbKey(w) === "show" || (LEXICON.show || []).includes(w.toLowerCase())))) return null;
    const a = r.ast;
    if (a.type === "show" && a.exprs.length === 1 && isCondition(a.exprs[0])) return a.exprs[0];
    // « Si P, alors Q. » affirmé : une implication
    if (a.type === "if" && !a.else && a.then?.type === "show" && a.then.exprs.length === 1 && isCondition(a.then.exprs[0])) return { type: "implies", p: a.cond, q: a.then.exprs[0] };
    return null;
}

function readPlain(text, ctx, focus) {
    const lit = literal(text, ctx, focus);
    const cands = translate(text, ctx);
    if (!cands.length) return lit;
    const reads = new Map();
    const read = (c) => {
        if (!reads.has(c.text)) { const r = literal(c.text, ctx, focus); reads.set(c.text, sound(r, ctx) ? r : null); }
        return reads.get(c.text);
    };
    const litSound = sound(lit, ctx);
    for (const c of cands) {
        if (c.score < STRONG) continue;
        const r = read(c);
        if (!r) continue;
        if (!lit.error && bare(lit.ast) === bare(r.ast)) return lit;   // la même lecture : rien à traduire
        return translated(text, c, r);
    }
    if (litSound) return lit;
    for (const c of cands) {
        if (c.score < ACCEPT) break;
        const r = read(c);
        if (r) return translated(text, c, r);
    }
    const near = cands.find((c) => c.score >= SUGGEST && read(c));
    if (near) {
        lit.proposal = near.text;
        if (lit.error) lit.error = { ...lit.error, msg: `${lit.error.msg} — vouliez-vous dire « ${near.text} » ? (/corriger)` };
    }
    return lit;
}

const bare = (ast) => JSON.stringify(ast, (k, v) => (k === "at" || k === "end" ? undefined : v));

/** Une lecture sûre : sans erreur, sans symbole ajouté pour la faire tenir, sans donnée lue qui n'existe nulle part. */
function sound(r, ctx) {
    if (!r || r.error) return false;
    if (r.doubts.some((d) => d.fix && d.fix.at === d.fix.end && /[:=]/.test(d.fix.text))) return false;
    let unknown = false;
    const walk = (n, target) => {
        if (unknown || !n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach((x) => walk(x)); return; }
        if (n.type === "define") return;   // ses paramètres ne valent que dans son corps
        if (n.type === "name" && !target && !ctx.names.has(n.name) && !ctx.fns.has(n.name)) { unknown = true; return; }
        for (const [k, v] of Object.entries(n)) if (v && typeof v === "object") walk(v, n.type === "assign" && k === "target");
    };
    walk(r.ast);
    return !unknown;
}

/** La phrase d'origine, lue d'après sa traduction : les mots communs gardent leur couleur. */
function translated(text, c, r) {
    // Mot à mot : chaque mot de la traduction qui se retrouve, dans l'ordre, dans la phrase d'origine lui donne son rôle
    // (un mot déplacé par la traduction — « Il y a 30 élèves » -> « Les élèves valent 30 » — se cherche aussi ailleurs)
    const orig = wordsOf(text);
    const got = new Array(orig.length).fill(null);
    let k = 0;
    for (const w of wordsOf(c.text)) {
        const ro = r.roles.find((x) => x.at <= w.at && w.end <= x.end);
        if (!ro || ro.role === "filler") continue;
        let s = orig.findIndex((o, q) => q >= k && !got[q] && o.f === w.f);
        if (s < 0) s = orig.findIndex((o, q) => !got[q] && o.f === w.f);
        if (s < 0) continue;
        got[s] = ro.role;
        if (s >= k) k = s + 1;
    }
    const roles = [];
    orig.forEach((o, q) => {
        if (!got[q]) return;
        const last = roles[roles.length - 1];
        if (last && last.role === got[q] && /^\s*$/.test(text.slice(last.end, o.at))) last.end = o.end;
        else roles.push({ at: o.at, end: o.end, role: got[q] });
    });
    return { text, ast: r.ast, roles, doubts: [], far: r.far, translated: { text: c.text, score: c.score, rule: c.rule } };
}

/**
 * /corriger : la phrase k du document, réécrite comme le moteur l'a lue — chaque mot relu (« affichr » → « affiche »),
 * ajouté ou ignoré par la résolution remplacé dans le texte. Rend { text, fixes: [msg], error } : error si la phrase
 * reste incomprise (le texte est alors celui de départ, corrigé de ce qui pouvait l'être).
 */
export function correctPhrase(texts, k, tables = new Map(), external = EMPTY) {
    // Une phrase en français libre devient la forme que le moteur exécute (ou celle qu'il propose)
    const rd = readDocument(texts, tables, external)[k];
    if (rd.translated) return { text: rd.translated.text, fixes: [`traduite d'après la tournure ${rd.translated.rule}`], error: null };
    if (rd.proposal) return { text: rd.proposal, fixes: ["remplacée par la forme proposée"], error: null };
    const ctx = contextOf(texts, tables, external);
    const text = texts[k];
    let r;
    try { r = parse(text, ctx); }
    catch (e) { if (!(e instanceof Unclear)) throw e; return { text, fixes: [], error: e.message }; }
    const fixes = r.doubts.filter((d) => d.fix).sort((a, b) => b.fix.at - a.fix.at);
    // Un symbole ajouté (« afichr := … ») : la lecture tient, mais ce n'est pas ce que la phrase voulait dire
    if (fixes.some((d) => /^ ?[:=]/.test(d.fix.text) && d.fix.at === d.fix.end)) return { text, fixes: [], error: "lecture incertaine" };
    let out = text;
    // « Afiche » → « Affiche » : la majuscule du mot d'origine reste
    const cap = (said, t) => (/^\p{Lu}/u.test(said) && t ? t[0].toUpperCase() + t.slice(1) : t);
    for (const d of fixes) out = out.slice(0, d.fix.at) + cap(out.slice(d.fix.at, d.fix.end), d.fix.text) + out.slice(d.fix.end);
    out = out.replace(/ {2,}/g, " ").replace(/ ([,.])/g, "$1").trim();
    const msgs = fixes.reverse().map((d) => d.msg);
    // À l'exécution, un nom inconnu proche d'un nom connu (« le loyre » : « loyer » ?) est remplacé
    const all = texts.map((t, i) => (i === k ? out : t));
    const res = runDocument(readDocument(all, tables, external), external).results[k];
    const near = res?.fault && /— « (.+) » \?$/.exec(res.fault.msg);
    if (near && res.fault.at != null) {
        const said = out.slice(res.fault.at, res.fault.end);
        out = out.slice(0, res.fault.at) + near[1] + out.slice(res.fault.end);
        msgs.push(`« ${said} » remplacé par « ${near[1]} »`);
    }
    return { text: out, fixes: msgs, error: !near && res?.fault ? res.fault.msg : null };
}

/**
 * Ce que les phrases d'un document définissent, et dont dépend la lecture de chacune : actions (fns, procs),
 * classes, tableaux, champs venus d'ailleurs, noms des données (names, pour la résolution), et sa signature (sig).
 */
export function contextOf(texts, tables = new Map(), external = EMPTY) {
    const fns = new Map(), classes = new Map(), procs = new Set(), extraFields = external.fields;
    const names = new Set(external.values.keys());
    const size = () => fns.size + classes.size + procs.size + names.size;
    // Jusqu'à ce que rien de nouveau n'apparaisse : une action qui en appelle une autre (définie plus bas, ou dont la
    // définition ne se lisait pas encore) se lit au tour suivant
    let asts = [];
    for (let round = 0, before = -1; round < 4 && size() !== before; round++) {
        before = size();
        asts = [];
        const sig = signature(fns, classes, procs, tables, extraFields, names);
        let focus = null;
        for (const t of texts) {
            const c = { fns, classes, procs, tables, extraFields, names, sig, focus };
            // Une phrase écrite en français libre (« Il y a 30 élèves ») définit ce que définit sa traduction
            // (« Q, car P » : chaque proposition, le connecteur n'étant pas une donnée ; sinon la phrase entière)
            const readOne = (pt) => {
                try { return parse(pt, c).ast; }
                catch {
                    for (const x of translate(pt, c)) {
                        if (x.score < ACCEPT) break;
                        try { return parse(x.text, c).ast; } catch { /* lue pour de bon ensuite */ }
                    }
                }
                return null;
            };
            const d = discourse(t);
            let got = d ? d.parts.map((p) => readOne(p.text)) : [readOne(t)];
            if (d && got.some((a) => !a)) got = [readOne(t)];
            const ast = got.length > 1 ? { type: "seq", list: got } : got[0];
            asts.push(ast);
            if (ast) { definitions(ast, fns, classes, procs); namesOf(ast, names); focus = focusOf(ast) ?? focus; }
        }
    }
    const lexicon = external.lexicon || NO_LEXICON;
    // les sortes du document (sens.js) : une réparation de faute qui n'a pas de sens (« la moyenne du nom ») coûte plus
    const typing = typeDocument(asts, tables, external.values);
    const judge = (ast) => conflictsOf(ast, typing).length > 0;
    return { fns, classes, procs, tables, extraFields, names, lexicon, typing, judge,
        sig: signature(fns, classes, procs, tables, extraFields, names) + JSON.stringify(lexicon.tournures) + typingKey(typing) };
}
const NO_LEXICON = { readings: [], tournures: [] };

/**
 * L'autocomplétion d'une phrase en cours d'écriture : ce qui peut venir après prefix (le texte depuis le « _ »),
 * d'après la lecture elle-même — les formes attendues à cet endroit (« est plus » -> « est plus grand que »), et,
 * si une valeur peut venir, les données, actions et champs du document.
 * Rend { items: [{ label, kind, from }] } (from : où commence, dans prefix, le texte que l'élément remplace) ou null.
 */
// Les formes anglaises du thésaurus (elles restent comprises, mais l'éditeur propose le français)
const ENGLISH = new Set(("the of is are by to than then else and or not times show print display return give gives back set add remove repeat " +
    "each for while if has have kind sort type whose where true false list numbers integers from followed sorted reversed squared cubed at " +
    "least most even odd empty positive negative contains contain sum total average mean maximum minimum largest smallest highest lowest length size number square root " +
    "absolute value rounded first last rows table into in be becomes equals equal greater less more bigger smaller with a an let after that " +
    "please just so well now also here finally minus multiplied divided modulo along together").split(" "));
const english = (f) => f.split(/[\s']+/).filter(Boolean).every((w) => ENGLISH.has(w));
const RANK = { condition: 0, action: 1, calcul: 2, liaison: 3, donnée: 4, champ: 5 };

export function completions(prefix, ctx) {
    const fold = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const items = [], seen = new Set();
    // Les débuts de mots en partant de la fin : « …le loyer est plus gr » -> « gr », « plus gr », « est plus gr »
    const starts = [prefix.length - /[\p{L}'’]*$/u.exec(prefix)[0].length];
    for (let k = starts[0]; starts.length < 4;) {
        const m = /(?:^|\s)([^\s]+)\s*$/u.exec(prefix.slice(0, k));
        if (!m) break;
        k = m.index + m[0].length - m[0].trimStart().length;
        starts.push(k);
    }
    starts.forEach((from, j) => {
        const typed = prefix.slice(from), want = fold(typed);
        if (j && !want.trim()) return;
        const exp = expected(prefix.slice(0, from), ctx);
        if (!exp) return;
        const add = (label, kind) => {
            const f = fold(label);
            if (seen.has(label) || !f.startsWith(want) || f === want.trim()) return;
            seen.add(label);
            items.push({ label, kind, from });
        };
        if (exp.value && !j) {
            for (const n of [...ctx.names].sort()) if (!ctx.fns.has(n)) add(n.replace(/_/g, " "), "donnée");
            for (const f of [...ctx.fns.keys()].sort()) add(f.replace(/_/g, " "), "action");
            const fields = new Set([...[...ctx.classes.values()].flatMap((c) => c.fields), ...[...ctx.tables.values()].flatMap((t) => t.columns), ...(ctx.extraFields || [])]);
            for (const f of [...fields].sort()) add(f.replace(/_/g, " "), "champ");
        }
        // Les mots de la langue : sans rien de tapé, la première forme de chaque sens ; sinon toutes celles qui commencent ainsi
        for (const key of exp.keys) {
            const forms = (LEXICON[key] || []).filter((f) => /^[\p{L}' ]+$/u.test(f) && !english(f));
            for (const f of want ? forms : forms.slice(0, 1)) add(f, ROLE[key] === "action" ? "action" : ROLE[key] === "cond" ? "condition" : ROLE[key] === "op" ? "calcul" : "liaison");
        }
    });
    // Rien de tapé : les mots de la langue d'abord (une condition après « si le loyer », une action en début de phrase)
    if (!fold(prefix.slice(starts[0]))) items.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
    return items.length ? { items: items.slice(0, 12) } : null;
}

/**
 * Le sujet d'une phrase, auquel un pronom de la phrase suivante peut renvoyer (« Le résultat vaut 1. On le multiplie… ») :
 * la dernière donnée affectée.
 */
function focusOf(ast) {
    let f = null;
    const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.type === "define") return;   // ce qui se passe dans une action y reste
        if (n.type === "assign" && n.target?.type === "name") f = n.target.name;
        for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    };
    walk(ast);
    return f;
}

/** Tout ce dont dépend la lecture d'une phrase : deux contextes de même signature la lisent de la même façon. */
function signature(fns, classes, procs, tables, extraFields, names) {
    return JSON.stringify([[...fns], [...classes].map(([k, c]) => [k, c.fields]), [...procs], [...tables].map(([k, t]) => [k, t.columns]), extraFields, [...names].sort()]);
}

/** Exécute un document lu : [{ lines } | { fault: { msg, at, end } } | null], et la machine (ses données).
 * external : les données venues de Python et de SQL (externalData), présentes dès la première phrase ; et son lexique.
 * opts.ask : l'indice de la phrase qu'on vient d'écrire — si elle se lit de deux façons qui donnent deux résultats
 * différents, read[ask].ask les propose (au lieu de choisir en silence).
 *
 * Le sens choisit la lecture (voir readings dans parse.js) : une phrase dont la lecture échoue à l'exécution (« les
 * élèves qui sont au moins 10 » : des fiches ne se comparent pas à 10) est relue autrement, et la lecture qui calcule
 * l'emporte — read[k].understood dit laquelle et pourquoi ; une forme que le document a apprise se lit comme il l'a
 * appris. read[k] prend alors l'arbre choisi (le programme C++ le reçoit aussi). */
export function runDocument(read, external = EMPTY, opts = {}) {
    const lexicon = external.lexicon || NO_LEXICON;
    const seed = (m) => { for (const [k, v] of external.values) m.globals.set(k, seedValue(v, k)); };
    let m = new Machine();
    seed(m);
    const chosen = [];
    // une lecture essayée à part : une machine neuve qui rejoue les phrases d'avant (seulement pour les phrases à choisir)
    const trial = (k, ast) => {
        const t = new Machine();
        seed(t);
        for (let j = 0; j < k; j++) if (chosen[j]) { try { t.run(chosen[j]); } catch (e) { if (!(e instanceof Fault)) throw e; } }
        try { const lines = t.run(ast); return { ok: true, lines, ...stateOf(t, ast, lines) }; }
        catch (e) { if (e instanceof Fault) return { ok: false, msg: e.message }; throw e; }
    };
    const take = (r, alt, understood) => {
        r.ast = alt.r.ast; r.roles = withSorts(alt.r.roles, sortsIn(alt.r.ast, typing)); r.doubts = []; r.understood = understood;
    };
    // le premier juge, par les sortes (sens.js) : ce que chaque donnée est, sans rien exécuter ; une lecture qui n'a pas
    // de sens (« la moyenne des élèves ») est écartée avant d'être essayée, et c'est lui qui dit pourquoi
    const tables = read.find((r) => r?.$ctx)?.$ctx.tables ?? new Map();
    const typing = typeDocument(read.map((r) => r?.ast ?? null), tables, external.values);
    const senseless = (ast, k) => conflictsOf(ast, typing, k);
    // Ce qu'affirme chaque phrase, et le lien avec celle d'avant (discours.js) : jugés au moment où elle est lue, sur les
    // valeurs d'alors. r.claims : [{ at, end, ok, msg }] ; r.link : { rel, ok, msg } (ok : true, false, ou null — pas sûr)
    const deps = dependencies(read.map((x) => x?.ast));
    const valueOf = (e) => { try { return m.eval(e, m.globals); } catch (x) { if (x instanceof Fault) return undefined; throw x; } };
    // les valeurs qui justifient le verdict : chaque côté calculé d'une comparaison (« la moyenne de loyer… vaut 815 »),
    // et les données nommées
    const said = (e) => {
        const out = [];
        const side = (x) => { if (x && x.type !== "num" && x.type !== "str" && x.type !== "name") { const v = valueOf(x); if (v !== undefined) out.push(`${sayExpr(x).replace(/\bde le /g, "du ").replace(/\bde les /g, "des ")} vaut ${show(v)}`); } };
        if (e?.type === "bin" && CONDITIONS.has(e.op) && e.op !== "and" && e.op !== "or") { side(e.left); side(e.right); }
        for (const n of namesIn(e)) if (m.globals.has(n) && !(m.globals.get(n)?.params) && out.length < 3) out.push(`${n.replace(/_/g, " ")} vaut ${show(m.globals.get(n))}`);
        return out.join(", ");
    };
    const judgeClaim = (c) => {
        if (c.type === "implies") {
            const p = valueOf(c.p);
            if (p === undefined) return null;
            if (!p) return { ok: true, msg: `vrai, sans rien à vérifier : la condition est fausse ici (${said(c.p)})` };
            const q = valueOf(c.q);
            return q === undefined ? null : { ok: !!q, msg: q ? `vrai : la condition l'est, et la suite aussi (${said(c.q)})` : `faux : la condition est vraie, mais pas la suite (${said(c.q)})` };
        }
        const v = valueOf(c);
        if (v === undefined) return null;
        return { ok: !!v, msg: `${v ? "vrai" : "faux"}${said(c) ? ` : ${said(c)}` : ""}` };
    };
    const why = (q, p) => {
        for (const x of q) { if (p.has(x)) return `toutes deux parlent de ${x.replace(/_/g, " ")}`; for (const y of deps.get(x) || []) if (p.has(y)) return `${x.replace(/_/g, " ")} se calcule à partir de ${y.replace(/_/g, " ")}`; }
        return "";
    };
    const reason = (r, k, res) => {
        const parts = r.discourse?.parts ?? [{ at: 0, end: r.text.length, claim: claimOf(r) }];
        const verdicts = parts.map((p) => (p.claim ? judgeClaim(p.claim) : null));
        const claims = parts.map((p, i) => verdicts[i] && { at: p.at, end: p.end, ...verdicts[i] }).filter(Boolean);
        if (claims.length) r.claims = claims;
        const d = r.discourse;
        if (!d) return;
        const named = (i) => namesIn(parts[i].claim ?? r.ast);
        let link = null;
        if (d.inner) {
            // « Q, car P » (cause) ; « P, donc Q » (conséquence)
            const [qi, pi] = d.inner.rel === "cause" ? [0, 1] : [1, 0];
            const P = verdicts[pi], Q = verdicts[qi], w = why(named(qi), named(pi));
            link = P?.ok === false ? { ok: false, msg: `la ${d.inner.rel === "cause" ? "cause" : "prémisse"} est fausse (${P.msg})` }
                : Q?.ok === false ? { ok: false, msg: `ce qui est ${d.inner.rel === "cause" ? "expliqué" : "conclu"} est faux (${Q.msg})` }
                : !w ? { ok: null, msg: `« ${d.inner.word} » relie deux choses sans rapport : l'une ne se calcule pas à partir de l'autre` }
                : P && Q ? { ok: true, msg: `${d.inner.word} : les deux sont vrais, et ${w}` } : null;
            if (link) link.rel = d.inner.rel;
        } else if (d.lead) {
            // la phrase d'avant : une phrase de la machine, ou une affirmation de la prose
            const prev = read.slice(0, k).reverse().find((x) => x?.ast || x?.discourse);
            const prevNames = prev?.ast ? namesIn(prev.ast) : new Set((prev?.discourse?.parts || []).flatMap((p) => [...namesIn(p.claim)]));
            const C = verdicts[0], w = prev ? why(named(0), prevNames) : "";
            if (d.lead.rel === "conséquence")
                link = C?.ok === false ? { ok: false, msg: `ne découle pas : c'est faux (${C.msg})` }
                    : C && !w ? { ok: null, msg: `vrai, mais « ${d.lead.word} » ne découle pas de la phrase d'avant : elles ne parlent pas des mêmes données` }
                    : C ? { ok: true, msg: `découle de la phrase d'avant : ${w} (${C.msg})` } : null;
            else if (C) link = { ok: C.ok, msg: `${d.lead.word} : ${C.msg}` };
            if (link) link.rel = d.lead.rel;
        }
        if (link) r.link = link;
    };
    const remake = (k) => {
        m = new Machine();
        seed(m);
        for (let j = 0; j < k; j++) if (chosen[j]) { try { m.run(chosen[j]); } catch (e) { if (!(e instanceof Fault)) throw e; } }
    };
    const results = read.map((r, k) => {
        if (r.prose) { chosen[k] = null; if (r.discourse) reason(r, k, null); return null; }
        if (!r.ast) { chosen[k] = null; return null; }
        const lazy = !r.translated && r.$ctx && !r.error;
        if (lazy) r.roles = withSorts(r.roles, typing.nodes[k]);
        // une forme apprise : la lecture que le document a confirmée
        const learned = lazy && learnedReading(lexicon.readings, r.text, r.roles);
        if (learned) {
            if (learned.groups.length) {
                const alt = readings(r.text, r.$ctx).find((a) => sameGroups(a.edits, learned.groups));
                if (alt) take(r, alt, { kind: "appris", shown: alt.shown, rule: learned.rule });
            } else r.understood = { kind: "appris", shown: r.text, rule: learned.rule };
        }
        if (lazy && opts.ask === k && !learned) r.ask = askOptions(r, (ast) => trial(k, ast), (ast) => senseless(ast, k));
        // la lecture n'a pas de sens d'après les sortes : une autre, qui en a et qui s'exécute ?
        const bad = typing.conflicts[k];
        if (bad.length && lazy && !learned) {
            for (const alt of readings(r.text, r.$ctx)) {
                if (senseless(alt.r.ast, k).length) continue;
                if (!trial(k, alt.r.ast).ok) continue;
                take(r, alt, { kind: "sens", shown: alt.shown, why: bad[0].msg, by: "sortes" });
                remake(k);
                break;
            }
        }
        if (!r.understood && bad.length) r.sense = bad;
        const run = () => {
            try { return { lines: m.run(r.ast) }; }
            catch (e) {
                if (!(e instanceof Fault)) throw e;
                return { lines: m.out, fault: r.translated ? { msg: e.message, at: 0, end: r.text.length } : { msg: e.message, at: e.at, end: e.end } };
            }
        };
        let res = run();
        // la lecture échoue : une autre, qui calcule ? (la machine principale est alors refaite sans l'essai raté)
        if (res.fault && lazy && !learned && !r.understood) {
            for (const alt of readings(r.text, r.$ctx)) {
                if (senseless(alt.r.ast, k).length) continue;
                const t = trial(k, alt.r.ast);
                if (!t.ok) continue;
                take(r, alt, { kind: "sens", shown: alt.shown, why: res.fault.msg });
                remake(k);
                res = run();
                break;
            }
        }
        chosen[k] = r.ast;
        if (!res.fault) reason(r, k, res);
        return res;
    });
    // La faute vient peut-être de l'action appelée (« Affiche mesurer 27. » ne s'arrête pas : c'est la définition de
    // « mesurer » qui est mal lue) : on relit la définition, et la lecture qui fait réussir l'appel l'emporte
    if ((opts.blame ?? 0) < 2) {
        const definedAt = new Map();
        read.forEach((r, j) => walkAst(r?.ast, (n) => { if (n.type === "define") definedAt.set(n.name, j); }));
        for (let k = 0; k < read.length; k++) {
            if (!results[k]?.fault || !read[k]?.ast) continue;
            const called = new Set(), todo = [read[k].ast];
            while (todo.length) walkAst(todo.pop(), (n) => {
                if (n.type !== "call" || called.has(n.name)) return;
                called.add(n.name);
                const j = definedAt.get(n.name);
                if (j != null) todo.push(read[j].ast);
            });
            for (const name of called) {
                const j = definedAt.get(name), d = read[j];
                if (j == null || j >= k || !d.$ctx || d.translated || d.error || d.understood) continue;
                for (const alt of readings(d.text, d.$ctx)) {
                    if (senseless(alt.r.ast, j).length) continue;
                    const t = new Machine();
                    seed(t);
                    for (let i = 0; i < k; i++) { const a = i === j ? alt.r.ast : chosen[i]; if (a) { try { t.run(a); } catch (e) { if (!(e instanceof Fault)) throw e; } } }
                    try { t.run(read[k].ast); } catch (e) { if (e instanceof Fault) continue; throw e; }
                    take(d, alt, { kind: "sens", shown: alt.shown, why: `« ${read[k].text} » : ${results[k].fault.msg}` });
                    return runDocument(read, external, { ...opts, blame: (opts.blame ?? 0) + 1 });
                }
            }
        }
    }
    return { results, globals: m.globals, own: m.own, typing };
}

/** Chaque nœud d'un arbre (en profondeur). */
function walkAst(n, f) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x) => walkAst(x, f)); return; }
    if (n.type) f(n);
    for (const v of Object.values(n)) if (v && typeof v === "object") walkAst(v, f);
}

/** Les rôles d'une phrase, chaque donnée avec l'étiquette de sa sorte (role.sort : « liste:nombre ») — de nouveaux
 *  objets : ceux de la lecture sont partagés par le cache. */
function withSorts(roles, nodes = []) {
    return roles.map((ro) => {
        if (ro.role !== "data" && ro.role !== "type") return ro;
        let best = null;
        for (const n of nodes) if (n.at < ro.end && ro.at < n.end && (!best || n.end - n.at < best.end - best.at)) best = n;
        const t = best ? tag(best.sort) : "";
        return t ? { ...ro, sort: t } : ro;
    });
}

/**
 * Les actions du document qui calculent un nombre, pour les énoncés mathématiques (preuve/) : nom → { arity, call,
 * min, max, why, key }. Leurs bornes viennent de leur sorte (sens.js : « un entier entre 0 et 100 ») ; call les exécute
 * dans une machine qui a rejoué le document (pour chercher un contre-exemple).
 */
export function actionsFor(read, typing, external = EMPTY) {
    const out = new Map();
    let m = null;
    const machine = () => {
        if (m) return m;
        m = new Machine();
        for (const [k, v] of external.values) m.globals.set(k, seedValue(v, k));
        for (const r of read) if (r?.ast) { try { m.run(r.ast); } catch (e) { if (!(e instanceof Fault)) throw e; } }
        return m;
    };
    for (const [name, f] of typing?.fns || []) {
        const ok = f.params.length && f.params.every((p) => ["nombre", "⊥", "?"].includes(f.locals.get(p)?.k)) && f.rend?.k === "nombre";
        if (!ok) continue;
        out.set(name.replace(/_/g, " "), {
            arity: f.params.length, formula: formulaOf(read, name), min: f.rend.min ?? null, max: f.rend.max ?? null, why: sortText(f.rend), key: tag(f.rend) + (f.rend.min ?? "") + ":" + (f.rend.max ?? ""),
            call: (vals) => {
                const mm = machine();
                mm.steps = 0;
                mm.depth = 0;
                try { return mm.call({ type: "call", name, args: vals.map((value) => ({ type: "num", value })) }, mm.globals); }
                catch (e) { if (e instanceof Fault) throw new Error(e.message); throw e; }
            },
        });
    }
    return out;
}

/** Une action définie par une formule (« pour doubler un nombre, renvoie le nombre fois 2 ») : sa formule, en arbre de
 *  preuve/ ({ t: "mul", a: { t: "var", name: "#0" }, … } — #k : la k-ième valeur), pour la déplier dans un énoncé. */
function formulaOf(read, name) {
    const def = read.map((r) => r?.ast).find((a) => a?.type === "define" && a.name === name);
    if (!def) return null;
    let body = def.body;
    while (body?.type === "seq" && body.list.length === 1) body = body.list[0];
    if (body?.type !== "return") return null;
    const OPS = { add: "add", sub: "sub", mul: "mul", div: "div" };
    const conv = (e) => {
        if (e.type === "num" && Number.isFinite(e.value)) return { t: "num", v: Number.isInteger(e.value) ? { n: BigInt(e.value), d: 1n } : null, raw: e.value };
        if (e.type === "name" && def.params.includes(e.name)) return { t: "var", name: `#${def.params.indexOf(e.name)}` };
        if (e.type === "neg") { const a = conv(e.expr); return a && { t: "neg", a }; }
        if (e.type === "bin" && OPS[e.op]) { const a = conv(e.left), b = conv(e.right); return a && b && { t: OPS[e.op], a, b }; }
        if (e.type === "bin" && e.op === "pow" && e.right.type === "num" && Number.isInteger(e.right.value) && e.right.value >= 0) { const a = conv(e.left); return a && { t: "pow", a, e: e.right.value }; }
        return null;
    };
    const f = conv(body.expr);
    // (un nombre décimal ne s'écrit pas en rationnel exact ici : pas de formule)
    const exact = (x) => !x || (x.t === "num" ? !!x.v : [x.a, x.b].every(exact));
    return f && exact(f) ? f : null;
}

/** Deux lectures sensées aux résultats différents : { options: [{ shown, lines, edits }] } (la première : telle qu'écrite). */
function askOptions(r, trial, senseless = () => []) {
    const base = trial(r.ast);
    if (!base.ok) return null;
    // une vraie question : un regroupement (pas un pronom relu : il ne sert qu'à sauver une phrase qui échoue), qui
    // calcule la même sorte de chose (des nombres restent des nombres, une liste une liste), mais pas la même valeur
    const diff = readings(r.text, r.$ctx).filter((a) => a.edits.every((d) => d.op === "group") && !senseless(a.r.ast).length)
        .map((a) => ({ a, t: trial(a.r.ast) })).filter((x) => x.t.ok && x.t.sort === base.sort && differ(x.t, base));
    return diff.length ? { options: [{ shown: r.text, lines: base.lines, edits: [] }, ...diff.map((x) => ({ shown: x.a.shown, lines: x.t.lines, edits: x.a.edits }))] } : null;
}

/** La phrase k d'un document déjà exécuté (runDocument) se lit-elle de deux façons aux résultats différents ? */
export function ambiguity(read, k, external = EMPTY) {
    const r = read[k];
    if (!r?.ast || r.translated || !r.$ctx || r.error || r.understood) return null;
    if (learnedReading((external.lexicon || NO_LEXICON).readings, r.text, r.roles)) return null;
    const trial = (ast) => {
        const t = new Machine();
        for (const [n, v] of external.values) t.globals.set(n, seedValue(v, n));
        for (let j = 0; j < k; j++) if (read[j]?.ast) { try { t.run(read[j].ast); } catch (e) { if (!(e instanceof Fault)) throw e; } }
        try { const lines = t.run(ast); return { ok: true, lines, ...stateOf(t, ast, lines) }; }
        catch (e) { if (e instanceof Fault) return { ok: false, msg: e.message }; throw e; }
    };
    const typing = typeDocument(read.map((x) => x?.ast ?? null), r.$ctx.tables ?? new Map(), external.values);
    return askOptions(r, trial, (ast) => conflictsOf(ast, typing, k));
}

/** Ce qu'une phrase a laissé : la valeur qu'elle a écrite (state), et la sorte de ce qu'elle a calculé (sort) :
 *  pour comparer deux lectures. */
function stateOf(m, ast, lines) {
    const names = new Set();
    const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === "assign" && n.target?.type === "name") names.add(n.target.name); for (const v of Object.values(n)) if (v && typeof v === "object") walk(v); };
    walk(ast);
    const vals = [...names].map((n) => m.globals.get(n));
    return { state: [...names].map((n, i) => `${n}=${show(vals[i])}`).join(";"), sort: `${vals.map(sortOf).join(",")}|${lines.map(lineSort).join(",")}` };
}
const sortOf = (v) => (typeof v === "number" ? "n" : typeof v === "string" ? "t" : typeof v === "boolean" ? "b" : Array.isArray(v) ? `L(${[...new Set(v.map(sortOf))].join("")})` : v == null ? "-" : "o");
const lineSort = (l) => (/^-?[\d\s.,]+%?$/.test(l) ? "n" : /^(vrai|faux)$/.test(l) ? "b" : /^\[/.test(l) ? "L" : "t");
const differ = (a, b) => JSON.stringify(a.lines) !== JSON.stringify(b.lines) || a.state !== b.state;

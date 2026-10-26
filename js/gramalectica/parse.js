// Grama Lectica — lecture d'une phrase : du texte à l'arbre de syntaxe.
//
// texte → mots → termes du thésaurus (le plus long d'abord) → mots de liaison ignorés → arbre.
// Chaque nœud garde sa place dans le texte : la coloration et le soulignement d'une erreur tombent au bon endroit.
// Une phrase a une seule lecture ; quand la langue en permettait deux (« a plus b fois c »), la lecture retenue
// est signalée comme un doute, avec la façon d'écrire l'autre.

import { FORMS, ARTICLES, FILLERS, ROLE, LEXICON, SINGLE_WORDS, INDEFINITE, EQUIVALENTS, WORD_KEYS, lemma,
    FILLER_PHRASES, UNITS, NUMBER_WORDS, SUBJECTS, OBJECTS, DATIVES, POSSESSIVES, verbKey, sameVerb } from "./lexicon.js";

export class Unclear extends Error {
    constructor(msg, at, end = at) { super(msg); this.at = at; this.end = end; }
}

/** Une phrase bien construite dont le sens ne tient pas (colonne absente, classe non déclarée) : on ne la répare pas. */
class Meaningless extends Unclear {}

// ---------------------------------------------------------------- mots, termes

function words(text) {
    const out = [];
    text = text.replace(/[’ʼ]/g, "'");   // l'apostrophe typographique (« s’il ») est une apostrophe ; même longueur, mêmes positions
    const re = /«([^»]*)»|"([^"]*)"|(\d+(?:[.,]\d+)?)|([\p{L}_][\p{L}\p{N}_]*'?)|(:=|<=|>=|!=|==|[-+*/%×÷<>=≤≥≠(),;:\[\]])/gu;
    let m;
    while ((m = re.exec(text))) {
        const at = m.index, end = at + m[0].length;
        if (m[1] !== undefined || m[2] !== undefined) {
            const raw = m[1] ?? m[2];
            let v = raw;
            if (m[1] !== undefined && /^\s/.test(v) && /\s$/.test(v) && /[\p{L}\p{N}]/u.test(v)) v = v.trim();   // « texte » : espaces typographiques (« — » garde les siennes)
            out.push({ kind: "str", value: v, at, end, ...(v !== raw ? { raw } : {}) });
        }
        else if (m[3]) {
            // « 650 € », « 9,90 $ » : le symbole monétaire est l'unité du nombre (ailleurs, il n'est pas lu)
            const cur = /^\s*([€$£])/u.exec(text.slice(end));
            out.push({ kind: "num", value: Number(m[3].replace(",", ".")), at, end, ...(cur ? { unit: cur[1] } : {}) });
        }
        else if (m[4]) {
            const ap = /^([ldjnmst]|qu)'(.+)$/iu.exec(m[4]);
            if (ap) {
                const cut = at + ap[1].length + 1;
                out.push({ kind: "word", value: ap[1].toLowerCase() + "'", at, end: cut });
                out.push({ kind: "word", value: ap[2].toLowerCase(), at: cut, end });
            } else {
                const w = m[4].toLowerCase();
                // « dix fois de suite », « un total nul » : un nombre en lettres est un nombre
                out.push(NUMBER_WORDS[w] != null ? { kind: "num", value: NUMBER_WORDS[w], at, end } : { kind: "word", value: w, at, end });
            }
        } else {
            // « affiche-moi », « donne-le » : l'impératif et son pronom, collés par un trait d'union, ne sont pas un « moins »
            const pron = m[5] === "-" && at > 0 && /\p{L}/u.test(text[at - 1]) ? /^-(moi|toi|le|la|les|nous|vous|lui|leur|en|y)(?![\p{L}\p{N}_])/iu.exec(text.slice(at)) : null;
            if (pron) {
                // « affiche-la », « ajoute-lui 2 » : le pronom complément désigne la donnée dont on parle ; « -moi » ne désigne rien
                const p = pron[1].toLowerCase();
                if (["le", "la", "les", "lui", "leur"].includes(p)) out.push({ kind: "pron", value: p, dative: p === "lui" || p === "leur", at: at + 1, end: at + pron[0].length });
                re.lastIndex = at + pron[0].length;
                continue;
            }
            out.push({ kind: "sym", value: m[5], at, end });
        }
    }
    return out;
}

const NO_PLAN = { sub: new Map(), ins: new Map() };
// Les premiers mots des formes : un pronom sujet n'en est un que devant l'une d'elles ou un verbe (« il augmente »)
const FIRST = new Set(FORMS.map((f) => f.words[0]));
// Les premiers mots d'une comparaison ou d'un test (« sont au moins », « est pair ») : après « qui », ils filtrent une liste
const TEST_FIRST = new Set(FORMS.filter((f) => f.keys?.some((k) => ["be", "eq", "ne", "gt", "lt", "ge", "le", "contains", "even", "odd", "empty", "positive", "negative"].includes(k))
    || ["be", "eq", "ne", "gt", "lt", "ge", "le", "contains", "even", "odd", "empty", "positive", "negative"].includes(f.key)).map((f) => f.words[0]));

/**
 * Les mots -> les termes : formes du thésaurus (la plus longue d'abord ; exacte, sinon accordée), noms, valeurs.
 * plan : la lecture corrigée que cherche parse() — sub : position -> { key | word | skip, len } (un mot relu comme une
 * forme, comme un autre nom, ou ignoré) ; ins : position -> [terme] (une forme attendue ajoutée là).
 */
// own : les premiers mots des actions du document — « doubler », s'il en est une, n'est pas « multiplier par 2 »
function terms(ws, plan = NO_PLAN, end = Infinity, own = new Set()) {
    const out = [];
    const fits = (t, w) => t && (t.kind === "word" || t.kind === "sym") && t.value === w;
    const base = ws.map((t) => (t.kind === "word" ? lemma(t.value) : t.value));
    const agrees = (k, w) => ws[k] && (ws[k].kind === "word" || ws[k].kind === "sym") && base[k] === w;
    const insert = (at) => { for (const x of plan.ins.get(at) || []) out.push({ ...x, at, end: at }); };
    for (let i = 0; i < ws.length;) {
        insert(ws[i].at);
        const as = plan.sub.get(ws[i].at);
        if (as) {
            const last = ws[i + as.len - 1].end;
            out.push(as.skip ? { ...ws[i], kind: "filler", end: last } : as.word ? { ...ws[i], kind: "word", value: as.word } : { kind: "key", key: as.key, at: ws[i].at, end: last });
            i += as.len;
            continue;
        }
        const w = ws[i], nx = ws[i + 1], n2 = ws[i + 2], prev = out[out.length - 1];
        // Un pronom complément ne précède le verbe qu'après un sujet (« on le compte », « il la double ») ;
        // sans sujet, « le compte vaut 0 » commence par un article
        const subject = prev?.kind === "pron" || (prev?.kind === "filler" && ["on", "nous", "je", "j'", "vous"].includes(prev.value));
        // Une tournure qui situe sans agir (« au départ », « à la fin ») : lue et ignorée
        const situ = w.kind === "word" ? FILLER_PHRASES.find((p) => p.every((x, k) => ws[i + k]?.kind === "word" && ws[i + k].value === x)) : null;
        if (situ) { out.push({ ...w, kind: "filler", end: ws[i + situ.length - 1].end }); i += situ.length; continue; }
        // « augmente de 3 % » : un pourcentage est une fraction (seul devant autre chose qu'une valeur, sinon c'est modulo)
        if (w.kind === "num" && nx?.kind === "sym" && nx.value === "%" && !(ws[i + 2] && (ws[i + 2].kind === "num" || (ws[i + 2].kind === "sym" && ws[i + 2].value === "(")))) {
            out.push({ kind: "num", value: w.value / 100, pct: true, at: w.at, end: nx.end });
            i += 2;
            continue;
        }
        // « et l'on ajoute 1 » : le « l' » euphonique devant « on » ne désigne rien
        if (w.kind === "word" && w.value === "l'" && nx?.kind === "word" && nx.value === "on") {
            out.push({ ...w, kind: "filler", end: nx.end });
            i += 2;
            continue;
        }
        // « le plus grand », « la plus petite » sans « de » derrière : un adjectif employé comme nom (une donnée)
        if (w.kind === "word" && OBJECTS.has(w.value) && nx?.kind === "word" && (nx.value === "plus" || nx.value === "moins") &&
            n2?.kind === "word" && !FIRST.has(n2.value) && !(ws[i + 3]?.kind === "word" && ["de", "des", "du", "d'"].includes(ws[i + 3].value))) {
            out.push(w, { ...nx }, { ...n2 });
            i += 3;
            continue;
        }
        // L'élision : « s'il est pair » est « si il » (« s'il te plaît » reste une politesse)
        if (w.kind === "word" && w.value === "s'" && nx?.kind === "word" && (nx.value === "il" || nx.value === "ils") && n2?.kind === "word" && (FIRST.has(n2.value) || verbKey(n2.value) || n2.value === "n'")) {
            out.push({ kind: "key", key: "if", at: w.at, end: w.end });
            i++;
            continue;
        }
        // « on la double », « tripler le prix » : un multiplicatif est une multiplication par son nombre
        // Un verbe conjugué ouvre une proposition ou suit son sujet (« on ajoute », « le prix diminue », « …, puis double »),
        // jamais un autre verbe (« affiche tripler 5 » : tripler est le nom d'une action) ; ni le nom d'une action du document
        const clause = !prev || prev.kind === "filler" || prev.kind === "pron" || (prev.kind === "word" && !ARTICLES.has(prev.value)) ||
            (prev.kind === "sym" && ",;:".includes(prev.value)) || (prev.kind === "key" && ["and", "seq", "then", "else", "whenever"].includes(prev.key));
        const verb = (x) => x?.kind === "word" && clause && !own.has(x.value) && !ownVerb(x) && !!verbKey(x.value);
        const verbTerm = (x) => ({ kind: "key", key: verbKey(x.value), at: x.at, end: x.end });
        // Une action du document, conjuguée (« pour doubler… » : « on la double », « doublons le prix »)
        const ownVerb = (x) => x?.kind === "word" && [...own].some((o) => sameVerb(x.value, o));
        // « on ajoute son carré », « sa valeur » : un possessif renvoie à la donnée dont on parle (le carré de…)
        if (w.kind === "word" && POSSESSIVES.has(w.value) && nx?.kind === "word" && !(prev?.kind === "word" && ARTICLES.has(prev.value))) {
            const f = FORMS.find((x) => x.words.length === 3 && x.words[0] === "le" && x.words[1] === nx.value && x.words[2] === "de");
            if (f) { out.push({ kind: "key", key: f.key, at: w.at, end: nx.end }, { kind: "pron", value: w.value, at: w.at, end: w.end }); i += 2; continue; }
            // Le groupe nominal entier : « son prix unitaire », « son taux de taxe » — jusqu'au premier mot-outil ou verbe
            let j = i + 2;
            const noun = (x) => x?.kind === "word" && !FIRST.has(x.value) && !ARTICLES.has(x.value) && !verbKey(x.value) && !POSSESSIVES.has(x.value);
            while (noun(ws[j]) || (["de", "d'"].includes(ws[j]?.value) && noun(ws[j + 1]))) j += ["de", "d'"].includes(ws[j].value) ? 2 : 1;
            out.push(...ws.slice(i + 1, j).map((x) => ({ ...x })), { kind: "key", key: "from", at: w.at, end: w.at }, { kind: "pron", value: w.value, at: w.at, end: w.end });
            i = j;
            continue;
        }
        // Niveau 3, la référence : « on l'ajoute », « on le multiplie » — le pronom complément précède le verbe en
        // français ; on le remet après, comme un nom, et il désignera la donnée dont on parle
        if (w.kind === "word" && OBJECTS.has(w.value) && subject && (verb(nx) || ownVerb(nx))) {
            out.push(ownVerb(nx) ? { ...nx } : verbTerm(nx), { kind: "pron", value: w.value, at: w.at, end: w.end });
            i += 2;
            continue;
        }
        // « on lui ajoute 1 », « on lui retire 2 » : le pronom indirect désigne la donnée qui reçoit
        if (w.kind === "word" && DATIVES.has(w.value) && subject && verb(nx)) {
            out.push(verbTerm(nx), { kind: "pron", value: w.value, dative: true, at: w.at, end: w.end });
            i += 2;
            continue;
        }
        // « il augmente », « elle est plus grande » : un pronom sujet, devant un verbe ou une forme de la langue
        if (w.kind === "word" && SUBJECTS.has(w.value) && nx?.kind === "word" && (FIRST.has(nx.value) || verb(nx) || ownVerb(nx) || nx.value === "n'")) {
            out.push({ kind: "pron", value: w.value, at: w.at, end: w.end });
            i++;
            continue;
        }
        const exact = ws[i].kind === "word" || ws[i].kind === "sym" ? FORMS.find((f) => f.words.every((w, k) => fits(ws[i + k], w))) : null;
        // « les jours sont au plus », « la plus haute des » : une forme de plusieurs mots, accordée
        const agreed = ws[i].kind === "word" ? FORMS.find((f) => f.words.length > 1 && f.lemmas.every((w, k) => agrees(i + k, w))) : null;
        const f = agreed && (!exact || agreed.words.length > exact.words.length) ? agreed : exact;
        if (f) {
            out.push({ kind: "key", key: f.key, at: ws[i].at, end: ws[i + f.words.length - 1].end });
            i += f.words.length;
        } else {
            // « 4 x 2 », « le loyer x 12 » : un x entre deux valeurs multiplie (seul devant un nombre ou une parenthèse)
            if (ws[i].kind === "word" && ws[i].value === "x" && prev && nx && (nx.kind === "num" || (nx.kind === "sym" && nx.value === "(")) &&
                (prev.kind === "num" || (prev.kind === "word" && !ARTICLES.has(prev.value)) || (prev.kind === "sym" && prev.value === ")"))) {
                out.push({ kind: "key", key: "mul", at: ws[i].at, end: ws[i].end });
                i++;
                continue;
            }
            // Un mot de liaison après un article ou « de », « dans », « pour chaque » est un nom : « le bien », « du bien »
            const named = prev && ((prev.kind === "word" && ARTICLES.has(prev.value)) || (prev.kind === "key" && ["from", "in", "foreach"].includes(prev.key)));
            // « 87 euros », « 15 ans » : l'unité après un nombre ne change pas la valeur
            // (elle est l'unité du nombre, pour le juge par les sortes : « 30 m² » et « 650 € » ne s'additionnent pas)
            if (w.kind === "word" && prev?.kind === "num" && UNITS.has(w.value)) { if (UNIT_OF[w.value] && !prev.unit) prev.unit = UNIT_OF[w.value]; out.push({ ...w, kind: "filler" }); i++; continue; }
            // « le total en euros », « la durée en minutes » : l'unité annoncée ne change pas la valeur
            if (w.kind === "word" && w.value === "en" && nx?.kind === "word" && UNITS.has(nx.value)) { out.push({ ...w, kind: "filler", end: nx.end }); i += 2; continue; }
            // Un verbe d'action conjugué autrement que dans le lexique (« ajoutons », « afficher », « multiplie ») :
            // la morphologie le ramène à son verbe-tête — jamais un mot précédé d'un article (« l'affiche » du concert)
            if (w.kind === "word" && !named && !(prev?.kind === "word" && ARTICLES.has(prev.value)) && verb(w)) { out.push(verbTerm(w)); i++; continue; }
            // « les notes qui sont au moins 10 » : « qui » devant un test relie la liste à ce test (ailleurs, il ne dit rien)
            if (w.kind === "word" && w.value === "qui" && nx?.kind === "word" && TEST_FIRST.has(nx.value)) { out.push({ kind: "key", key: "who", at: w.at, end: w.end }); i++; continue; }
            out.push(ws[i].kind === "word" && FILLERS.has(ws[i].value) && !named ? { ...ws[i], kind: "filler" } : ws[i]);
            i++;
        }
    }
    insert(end);
    return out;
}

// l'accord d'un déterminant (m, f, pl) et d'un pronom (sg : singulier, sans genre dit)
const DETERMINER_AGREEMENT = { le: "m", un: "m", ce: "m", cet: "m", mon: "m", ton: "m", son: "m", du: "m", au: "m",
    la: "f", une: "f", cette: "f", ma: "f", ta: "f", sa: "f", les: "pl", des: "pl", ces: "pl", mes: "pl", tes: "pl", ses: "pl", nos: "pl", vos: "pl", leurs: "pl", aux: "pl" };
const PRONOUN_AGREEMENT = { le: "m", il: "m", la: "f", elle: "f", les: "pl", ils: "pl", elles: "pl", leur: "pl", lui: "sg" };

// l'unité que dit un mot après un nombre (les autres mots d'UNITS — « points », « élèves » — comptent sans unité)
const UNIT_OF = { euro: "€", euros: "€", "m²": "m²", m2: "m²", "km²": "km²", "cm²": "cm²", mètre: "m", mètres: "m", km: "km", kg: "kg", g: "g", cm: "cm", mm: "mm",
    litre: "L", litres: "L", heure: "h", heures: "h", minute: "min", minutes: "min", seconde: "s", secondes: "s", jour: "jour", jours: "jour", an: "an", ans: "an", année: "an", années: "an" };

// « les notes valent 12 et 15 », « les opérations valent les opérations et la somme » : après « vaut », un « et » entre deux
// valeurs qui ne sont pas des conditions énumère — une liste, les listes mises bout à bout ([] + A + B, comme « ajoute »)
const COND_OPS = new Set(["and", "or", "eq", "ne", "gt", "lt", "ge", "le", "contains"]);
const isCond = (e) => ["bool", "test", "not", "isa"].includes(e?.type) || (e?.type === "bin" && COND_OPS.has(e.op));
function enumeration(e, plan) {
    if (e?.type !== "bin" || e.op !== "and") return e;
    if (plan?.keepAnd?.has(e.at)) return e;   // (lire large : ce « et » lu comme une condition)
    const parts = [];
    const walk = (x) => { if (x.type === "bin" && x.op === "and") { walk(x.left); walk(x.right); } else parts.push(x); };
    walk(e);
    if (parts.some(isCond)) return e;
    return parts.reduce((acc, x) => ({ type: "bin", op: "add", left: acc, right: x, at: e.at, end: e.end }), { type: "list", items: [] });
}

const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
};

/** Les mots connus les plus proches d'un mot inconnu (fautes de frappe, et fonctions du document). */
export function suggest(word, extra = []) {
    const w = word.toLowerCase();
    return [...SINGLE_WORDS, ...extra].map((f) => [f, dist(w, f)])
        .filter(([, d]) => d <= Math.max(1, Math.floor(w.length / 3))).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([f]) => f);
}

const BUILTIN_KEYS = ["sum", "mean", "max", "min", "len", "sqrt", "abs", "round", "first", "last"];
const nameOf = (parts) => parts.map((p) => p.value.replace(/'$/, "")).join("_");

// ---------------------------------------------------------------- lecture

/** « les loyers » -> loyer : le pluriel d'un champ désigne le même champ (sur toute une liste). */
const singular = (n) => n.split("_").map((w) => (w.length > 3 ? w.replace(/[sx]$/, "") : w)).join("_");

// ---------------------------------------------------------------- résolution
//
// Une phrase qui ne se lit pas est lue comme la phrase correcte la plus proche (correction d'erreurs à coût minimal,
// à la manière d'Aho et Peterson) : à l'endroit où la lecture bloque, on essaie des modifications, par coût croissant,
// jusqu'à une lecture complète.
//   · un équivalent (« avec » -> et, lexicon.js EQUIVALENTS)          coût 1
//   · une faute de frappe vers une forme ou une action connue        coût 1 (2 pour deux lettres)
//   · un mot attendu à cet endroit qui manque (« dans », « alors »)  coût 2
//   · un mot de trop, ignoré                                         coût 2
// Une lecture n'est retenue que si tous ses noms existent dans le document (ctx.names) : sinon elle déplacerait l'erreur.
// Une phrase bien construite au sens impossible (colonne absente, classe non déclarée) n'est pas « réparée » : l'erreur
// dit la vérité. Chaque modification est signalée en pointillé : on voit toujours ce que la machine a compris.
// Une phrase qui se lit déjà n'est jamais modifiée.

const COST = { equivalent: 1, typo: 1, insert: 2, skip: 2, senseless: 2 };
const MAX_COST = 4, MAX_TRIES = 40;
// Ce qu'on peut ajouter : des liaisons, jamais une valeur ni une action (la machine ne devine pas ce qu'il faut faire)
const INSERTABLE = new Set(["then", "in", "from", "and", "be", "with", "else"]);
const CLOSERS = new Set([")", "]"]);

// Les lectures déjà faites, par contexte (ctx.sig, voir readDocument) : la page relit tout le document à chaque frappe
const READ = new Map();

export function parse(text, ctx = {}) {
    text = text.replace(/[’ʼ]/g, "'");   // l'apostrophe typographique (« s’il ») : même longueur, mêmes positions
    if (ctx.sig == null) return resolve(text, ctx);
    const id = `${ctx.sig}\u0001${ctx.focus || ""}\u0001${[...(ctx.genders || [])].join(",")}\u0001${text}`;
    let hit = READ.get(id);
    if (!hit) {
        try { hit = { r: resolve(text, ctx) }; } catch (e) { if (!(e instanceof Unclear)) throw e; hit = { e }; }
        if (READ.size > 2000) READ.clear();
        READ.set(id, hit);
    }
    if (hit.e) throw hit.e;
    return hit.r;
}

function resolve(text, ctx) {
    const ws = words(text);
    const attempt = (edits) => {
        const plan = { sub: new Map(), ins: new Map() };
        for (const d of edits) {
            if (d.op === "ins") plan.ins.set(d.at, [...(plan.ins.get(d.at) || []), d.sym ? { kind: "sym", value: d.sym } : { kind: "key", key: d.key }]);
            else if (d.op === "clause") for (let k = d.from; k <= d.to; k++) plan.sub.set(ws[k].at, { skip: true, len: 1 });
            else plan.sub.set(ws[d.k].at, d.op === "skip" ? { skip: true, len: 1 } : d.word ? { word: d.word, len: 1 } : { key: d.key, len: d.len });
        }
        try { return { r: parseOnce(text, ctx, plan) }; }
        catch (e) { if (!(e instanceof Unclear)) throw e; return { e }; }
    };
    const first = attempt([]);
    // Une lecture complète dont un nom n'existe nulle part dans le document (« calcule et affiche le total », « affiche
    // le loyre ») : on cherche aussi une lecture plus proche du document, sinon on la garde telle quelle
    let start = first.e;
    if (first.r) {
        const lost = ctx.names ? unknownNodes(first.r.ast, ctx.names).filter((n) => n.at != null) : [];
        if (!lost.length) return first.r;
        start = { at: lost[0].at, deep: lost[lost.length - 1].at };
    }
    if (start instanceof Meaningless) throw start;

    const fns = [...(ctx.fns?.keys() || [])].filter((f) => !f.includes("_"));
    const known = [...(ctx.names || [])].filter((n) => !n.includes("_") && !ctx.fns?.has(n));
    const tokenAt = (at) => { const k = ws.findIndex((w) => w.at <= at && at < w.end); return k >= 0 ? k : ws.findIndex((w) => w.at >= at); };
    // Ignorer un mot n'a de sens que devant une liaison ou à la fin : devant une valeur, c'est sans doute une action
    // inconnue (« tripler 5 »), qu'il faut signaler plutôt que taire
    const skippable = (k) => {
        const n = ws[k + 1];
        return !n || (n.kind === "sym" && !"([".includes(n.value)) || (n.kind === "word" && !ARTICLES.has(n.value) && FORMS.some((f) => f.words[0] === n.value));
    };
    const candidates = (st) => {
        const out = [], touched = new Set(st.edits.filter((d) => d.k != null).map((d) => d.k));
        const ks = new Set();
        for (const at of [st.e.at, st.e.deep]) if (at != null) { const k = tokenAt(at); if (k >= 0) ks.add(k).add(k - 1); }
        for (const k of ks) {
            const w = ws[k];
            if (!w || w.kind !== "word" || touched.has(k)) continue;
            for (const eq of EQUIVALENTS) {
                if (!eq.words.every((x, j) => ws[k + j]?.kind === "word" && ws[k + j].value === x)) continue;
                for (const key of eq.keys) out.push({ op: "sub", k, len: eq.words.length, key, cost: COST.equivalent });
            }
            if (w.value.length >= 4 && !ARTICLES.has(w.value) && !WORD_KEYS.has(w.value)) {
                const near = (x) => { const d = dist(w.value, x); return d > 0 && d <= (w.value.length >= 7 ? 2 : 1) ? d : 0; };
                for (const [form, key] of WORD_KEYS) { const d = near(form); if (d) out.push({ op: "sub", k, len: 1, key, as: form, cost: COST.typo + d - 1 }); }
                for (const f of fns) { const d = near(f); if (d) out.push({ op: "sub", k, len: 1, word: f, cost: COST.typo + d - 1 }); }
                for (const n of known) { const d = near(n); if (d) out.push({ op: "sub", k, len: 1, word: n, cost: COST.typo + d - 1 }); }
            }
            if (skippable(k)) out.push({ op: "skip", k, cost: COST.skip });
        }
        // « on part d'un nombre entier strictement positif ; s'il est pair, … » : la proposition qui bloque, entre deux
        // « ; », est écartée si tout le reste se lit — elle est alors grisée et signalée
        const semis = ws.map((w, k) => (w.kind === "sym" && w.value === ";" ? k : -1)).filter((k) => k >= 0);
        if (semis.length && st.e?.at != null && !st.edits.some((d) => d.op === "clause")) {
            for (const at of new Set([st.e.at, st.e.deep].filter((x) => x != null))) {
                const k0 = tokenAt(at), from = Math.max(-1, ...semis.filter((k) => k < k0)) + 1, to = Math.min(ws.length, ...semis.filter((k) => k >= k0));
                if (k0 >= 0 && (from > 0 || to < ws.length)) out.push({ op: "clause", from, to: Math.min(to, ws.length - 1), cost: 3 });
            }
        }
        const far = st.e?.expected;
        if (far && far.at >= 0) {
            for (const key of far.keys) if (INSERTABLE.has(key)) out.push({ op: "ins", at: far.at, key, cost: COST.insert });
            for (const sym of far.syms) if (CLOSERS.has(sym)) out.push({ op: "ins", at: far.at, sym, cost: COST.insert });
        }
        return out;
    };

    const queue = [{ cost: 0, edits: [], e: start }];
    const seen = new Set();
    let best = null, tries = 0;
    while (queue.length && tries < MAX_TRIES) {
        queue.sort((x, y) => x.cost - y.cost);
        const st = queue.shift();
        if (best && st.cost >= best.cost) break;
        for (const d of candidates(st)) {
            const cost = st.cost + d.cost;
            if (cost > MAX_COST || (best && cost > best.cost)) continue;
            const edits = [...st.edits, d];
            const id = edits.map((x) => `${x.op}:${x.k ?? x.at ?? x.from}:${x.key ?? x.word ?? x.sym ?? ""}`).sort().join("|");
            if (seen.has(id)) continue;
            seen.add(id);
            if (++tries > MAX_TRIES) break;
            const res = attempt(edits);
            if (res.r) {
                // Une lecture qui parle de choses que le document ne connaît pas ne fait que déplacer l'erreur :
                // c'est une étape, et la recherche continue à l'endroit de ce nom (« … affiche doublr note »)
                const lost = unknownNodes(res.r.ast, ctx.names).filter((n) => n.at != null);
                // une réparation qui n'a pas de sens d'après les sortes du document (ctx.judge) passe après les autres
                const total = cost + (!lost.length && ctx.judge?.(res.r.ast) ? COST.senseless : 0);
                if (!lost.length) { if (!best || total < best.cost) best = { cost: total, r: res.r, edits }; }
                else queue.push({ cost, edits, e: { at: lost[0].at, deep: lost[lost.length - 1].at } });
            } else if (!(res.e instanceof Meaningless) && res.e.at >= (st.e.at ?? 0)) queue.push({ cost, edits, e: res.e });
        }
    }
    if (!best) { if (first.r) return first.r; throw first.e; }
    for (const d of best.edits) best.r.doubts.push(note(d));
    return best.r;

    function note(d) {
        if (d.op === "ins") {
            const k = ws.findIndex((w) => w.at >= d.at), w = ws[k >= 0 ? k : ws.length - 1];
            const add = d.sym || LEXICON[d.key][0];
            return { at: w.at, end: w.end, msg: `« ${add} » ajouté ${k >= 0 ? "avant" : "après"} « ${text.slice(w.at, w.end)} »`,
                fix: k >= 0 ? { at: w.at, end: w.at, text: `${add} ` } : { at: w.end, end: w.end, text: ` ${add}` } };
        }
        if (d.op === "clause") {
            const a = ws[d.from].at, b = ws[d.to].end;
            return { at: a, end: b, msg: `« ${text.slice(a, b).replace(/[;\s]+$/, "")} » ignoré : la machine ne le comprend pas` };
        }
        const w = ws[d.k], end = ws[d.k + (d.len || 1) - 1].end, said = text.slice(w.at, end);
        // fix : le texte à mettre à la place, pour /corriger (le mot ignoré s'efface, le mot relu est remplacé)
        if (d.op === "skip") return { at: w.at, end, msg: `« ${said} » ignoré`, fix: { at: w.at, end, text: "" } };
        const as = (d.word || d.as || LEXICON[d.key][0]).replace(/_/g, " ");
        return { at: w.at, end, msg: `« ${said} » lu comme « ${as} »`, fix: { at: w.at, end, text: as } };
    }
}

// ---------------------------------------------------------------- lire large
//
// Une phrase qui se lit peut se lire autrement : le français ne dit pas toujours ce qui va avec quoi (« la moyenne des
// notes des élèves qui sont au moins 10 » : les notes, ou les élèves ?), ni de qui parle un pronom. Plutôt qu'une liste
// de constructions ambiguës, une seule recherche, générale : les lectures voisines de la phrase, obtenues par les plus
// petites modifications — grouper des mots entre parenthèses (rattachement, portée, priorité, quelle que soit la
// construction), ou lire un pronom comme un nom du document. Chacune se lit par le même analyseur ; on garde celles
// qui tiennent et disent autre chose. Ce que la phrase veut dire se décide ensuite au sens (index.js : laquelle
// s'exécute, laquelle a appris le document), et la modification elle-même est l'explication : « (les notes des
// élèves) qui sont au moins 10 ».

const READINGS = new Map();
const MAX_SPAN = 9, MAX_READINGS = 4;

/** Les autres lectures d'une phrase qui se lit : [{ r, edits: [{ op, at, text }], shown, cost }]. */
export function readings(text, ctx = {}) {
    text = text.replace(/[’ʼ]/g, "'");
    const id = `${ctx.sig ?? ""}\u0001${ctx.focus || ""}\u0001${(ctx.before || []).slice(-8).join(",")}\u0001${text}`;
    if (READINGS.has(id)) return READINGS.get(id);
    const out = [];
    let base;
    try { base = parse(text, ctx); } catch (e) { if (!(e instanceof Unclear)) throw e; }
    if (base && !base.doubts.some((d) => d.fix)) {
        const ws = words(text);
        const seen = new Set([bareAst(base.ast)]);
        const tryPlan = (edits, cost) => {
            const plan = { sub: new Map(), ins: new Map(), refs: new Map(), keepAnd: new Set() };
            for (const d of edits) {
                if (d.op === "and") { plan.keepAnd.add(d.at); continue; }
                if (d.op === "group") {
                    plan.ins.set(d.at, [...(plan.ins.get(d.at) || []), { kind: "sym", value: "(" }]);
                    plan.ins.set(d.end, [{ kind: "sym", value: ")" }, ...(plan.ins.get(d.end) || [])]);
                } else plan.refs.set(d.at, d.word);
            }
            let r;
            try { r = parseOnce(text, ctx, plan); } catch (e) { if (!(e instanceof Unclear)) throw e; return; }
            if (r.doubts.length || (ctx.names && unknownNodes(r.ast, ctx.names).length)) return;
            // lire autrement ce qu'on calcule, pas ce qu'on fait : la même instruction, sur les mêmes données
            // (un pronom relu change de qui l'on parle, donc la donnée écrite : seule la forme des instructions compte)
            const names = !edits.some((d) => d.op === "name");
            if (skeleton(r.ast, names) !== skeleton(base.ast, names)) return;
            const b = bareAst(r.ast);
            if (seen.has(b)) return;
            seen.add(b);
            out.push({ r, edits, cost, shown: shown(text, edits) });
        };
        // grouper : une paire de parenthèses autour de deux mots ou plus, qui commencent et finissent une valeur
        const value = (w) => w && (w.kind === "word" || w.kind === "num" || w.kind === "str");
        for (let a = 0; a < ws.length; a++) {
            if (!value(ws[a])) continue;
            for (let b = a + 1; b < ws.length && b - a < MAX_SPAN; b++) {
                if (!value(ws[b]) || (a === 0 && b === ws.length - 1)) continue;
                tryPlan([{ op: "group", at: ws[a].at, end: ws[b + 1]?.at ?? text.length, close: ws[b].end }], 1 + (b - a) / 100);
            }
        }
        // un pronom : lu comme l'un des noms nommés juste avant (ctx.before, le plus récent d'abord ; sinon ceux du document)
        const own = new Set([...(ctx.fns?.keys() || [])].map((f) => f.split("_")[0]));
        const pron = terms(ws, NO_PLAN, text.length, own).filter((t) => t.kind === "pron" && !t.dative);
        // (et ce que la phrase elle-même nomme : les paramètres de l'action qu'elle définit, les données qu'elle crée)
        const own_ = new Set();
        const walkOwn = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walkOwn); if (n.type === "define") n.params.forEach((p) => own_.add(p)); if ((n.type === "assign" || n.type === "add") && n.target?.type === "name") own_.add(n.target.name); for (const v of Object.values(n)) if (v && typeof v === "object") walkOwn(v); };
        walkOwn(base.ast);
        const recent = [...new Set([...[...(ctx.before || ctx.names || [])].filter((n) => !ctx.fns?.has(n)).slice(-8).reverse(), ...own_])];
        for (const t of pron) recent.forEach((n, q) => tryPlan([{ op: "name", at: t.at, end: t.end, word: n }], 1.5 + q / 100));
        // un « et » après « vaut » : lu comme une énumération ; l'autre lecture, une condition (« vrai si les deux »)
        for (const w of ws) if (w.kind === "word" && w.value === "et") tryPlan([{ op: "and", at: w.at, end: w.end }], 1.2);
    }
    out.sort((x, y) => x.cost - y.cost);
    const res = out.slice(0, MAX_READINGS);
    if (READINGS.size > 2000) READINGS.clear();
    READINGS.set(id, res);
    return res;
}
/** Ce que fait une phrase, sans ce qu'elle calcule : ses instructions (partout, jusque dans le corps de ses actions)
 *  et les données qu'elles écrivent — les expressions sont effacées. */
const STATEMENTS = new Set(["seq", "show", "assign", "add", "remove", "class", "if", "repeat", "foreach", "while", "define", "return", "expr"]);
function skeleton(ast, names = true) {
    const out = [];
    const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (STATEMENTS.has(n.type)) out.push(n.type === "assign" ? `assign:${n.target?.type === "name" ? (names ? n.target.name : "") : n.target?.type}` : n.type === "foreach" ? `foreach:${n.var}` : n.type === "define" ? `define:${n.name}` : n.type);
        for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    };
    walk(ast);
    return out.join(";");
}
const bareAst = (ast) => JSON.stringify(ast, (k, v) => (k === "at" || k === "end" ? undefined : v));
/** La phrase avec ses modifications visibles : les parenthèses ajoutées, le nom lu à la place du pronom. */
function shown(text, edits) {
    const marks = [];
    for (const d of edits) {
        if (d.op === "group") { marks.push([d.at, 0, "("]); marks.push([d.close ?? d.end, -1, ")"]); }
        else if (d.op === "and") marks.push([d.end, -1, " [condition]"]);
        else marks.push([d.at, 1, null, d]);
    }
    marks.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
    let out = text;
    for (const [at, , s, d] of marks) {
        if (d) out = out.slice(0, d.end) + ` [${d.word.replace(/_/g, " ")}]` + out.slice(d.end);
        else {
            // « (les notes des élèves ) qui » : la parenthèse fermante colle au mot d'avant
            let p = at;
            if (s === ")") while (p > 0 && /\s/.test(out[p - 1])) p--;
            out = out.slice(0, p) + s + out.slice(p);
        }
    }
    return out;
}

/** Les nœuds « nom » d'une phrase qui n'existent ni dans le document (known) ni dans la phrase elle-même. */
function unknownNodes(ast, known = new Set()) {
    const bound = new Set(), used = [];
    const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.type === "assign" && n.target?.type === "name") bound.add(n.target.name);
        if (n.type === "foreach") bound.add(n.var);
        if (n.type === "define") n.params.forEach((p) => bound.add(p));
        if (n.type === "name") used.push(n);
        for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    };
    walk(ast);
    return used.filter((x) => !bound.has(x.name) && !known.has(x.name));
}

/** Les noms qu'un document définit (données, variables de boucle, paramètres) : pour départager deux lectures. */
export function namesOf(ast, out = new Set()) {
    if (!ast || typeof ast !== "object") return out;
    if (Array.isArray(ast)) { ast.forEach((x) => namesOf(x, out)); return out; }
    if (ast.type === "assign" && ast.target?.type === "name") out.add(ast.target.name);
    if (ast.type === "foreach") out.add(ast.var);
    if (ast.type === "define") out.add(ast.name);   // ses paramètres ne valent que dans son corps
    for (const v of Object.values(ast)) if (v && typeof v === "object") namesOf(v, out);
    return out;
}

/**
 * Ce qui peut suivre un début de phrase : les formes attendues à la fin du texte (« alors », « dans »…), et si un nom
 * ou une valeur peut venir. Pour l'autocomplétion de l'éditeur (l'éditeur prédictif d'ACE et de Codeco).
 * Rend { keys, syms, value } ou null.
 */
export function expected(text, ctx = {}) {
    let far;
    try { far = parseOnce(text, ctx, NO_PLAN).far; }
    catch (e) { if (!(e instanceof Unclear)) throw e; far = e.expected; }
    if (!far || far.at < text.replace(/\s+$/, "").length) return null;
    return { keys: [...far.keys], syms: [...far.syms], value: far.value };
}

/**
 * Lit une phrase, telle quelle. ctx.fns : les fonctions définies dans le document (nom -> nombre de paramètres) ;
 * ctx.classes : les classes (nom -> { fields }). Rend { ast, roles, doubts } ou lève Unclear.
 */
function parseOnce(text, ctx = {}, plan = NO_PLAN) {
    const fns = new Map(ctx.fns || []);
    const procs = ctx.procs || new Set();   // les actions qui ne renvoient rien : un appel est une instruction
    const classes = ctx.classes || new Map();
    const tables = ctx.tables || new Map();
    const fields = new Set([...[...classes.values(), ...tables.values()].flatMap((c) => c.fields || c.columns), ...(ctx.extraFields || [])]);
    const fieldOf = (n) => (fields.has(n) ? n : fields.has(singular(n)) ? singular(n) : null);
    const all = terms(words(text), plan, text.length, new Set([...fns.keys()].map((f) => f.split("_")[0])));
    const roles = [];
    for (const t of all) if (t.kind === "filler") roles.push({ at: t.at, end: t.end, role: "filler" });
    const toks = all.filter((t) => t.kind !== "filler");
    const doubts = [];
    let i = 0;
    // Niveau 3, la référence (à la manière de Linguine) : un pronom désigne l'élément de la boucle en cours, sinon la
    // dernière donnée nommée dans la phrase, sinon le sujet de la phrase précédente (ctx.focus). Sans référent : erreur.
    const loopVars = [];
    let lastName = null;
    // les paramètres de l'action qu'on définit : des référents, comme les données du document (« pour mesurer un
    // nombre, … s'il est pair, on le divise » : le nombre, pas le sujet de la phrase d'avant)
    const params_ = new Set();
    // l'accord : le genre et le nombre de chaque nom, d'après son déterminant (« la boîte », « le nombre », « les notes ») ;
    // un pronom ne renvoie qu'à un nom qui s'accorde avec lui (« on la multiplie » : la boîte, pas le nombre)
    const genders = new Map(ctx.genders || []);
    const mentioned = [];
    const agrees = (n, t) => {
        const want = PRONOUN_AGREEMENT[t.value], g = genders.get(n);
        return !want || !g || want === g || (want === "sg" && g !== "pl");
    };
    const refer = (t) => {
        // Un nom de la phrase n'est un référent que s'il existe dans le document : un nom lu par erreur dans une
        // proposition non comprise (« on part d'un nombre entier… ») ne capte pas le « il » qui suit
        const real = (n) => n && (!ctx.names || ctx.names.has(n) || params_.has(n));
        // (lire large : ce pronom lu comme un autre nom du document — plan.refs)
        let ref = plan.refs?.get(t.at) ?? loopVars[loopVars.length - 1] ?? (real(lastName) ? lastName : null) ?? ctx.focus ?? lastName;
        // le choix de la règle ne s'accorde pas avec le pronom : le nom le plus récent qui s'accorde (de la phrase, ou le sujet d'avant)
        if (ref && !plan.refs?.has(t.at) && !agrees(ref, t)) {
            const other = [...mentioned].reverse().find((n) => n !== ref && agrees(n, t) && genders.has(n)) ?? (ctx.focus && agrees(ctx.focus, t) && genders.has(ctx.focus) ? ctx.focus : null);
            if (other) ref = other;
        }
        if (!ref) throw new Unclear(`« ${text.slice(t.at, t.end)} » : de quelle donnée parle-t-on ? Nommez-la d'abord`, t.at, t.end);
        return ref;
    };
    // « … par chaque entier de 2 à 6 » : un « chaque » dans un argument fait une boucle autour de l'instruction
    let pending = [];
    // Dans une condition, « et x vaut 3 » est une comparaison ; ailleurs, c'est une nouvelle affectation
    let inCond = 0;

    const peek = (k = 0) => toks[i + k];
    // Ce que la lecture a cherché à l'endroit le plus avancé (l'« échec le plus lointain » des parseurs PEG) :
    // les formes et symboles attendus là, et si une valeur pouvait y venir — messages, réparations, autocomplétion
    const far = { at: -1, keys: new Set(), syms: new Set(), value: false };
    const expect = (what, v) => {
        const at = peek()?.at ?? text.length;
        if (at > far.at) { far.at = at; far.keys.clear(); far.syms.clear(); far.value = false; }
        if (at === far.at) { if (what === "key") far.keys.add(v); else if (what === "sym") far.syms.add(v); else far.value = true; }
    };
    const is = (key, k = 0) => { if (!k) expect("key", key); return peek(k)?.kind === "key" && peek(k).key === key; };
    const isSym = (v, k = 0) => { if (!k) expect("sym", v); return peek(k)?.kind === "sym" && peek(k).value === v; };
    const mark = (t, role) => roles.push({ at: t.at, end: t.end, role });
    const here = () => peek()?.at ?? text.length;
    const fail = (msg) => { const t = peek(); throw new Unclear(msg, t?.at ?? text.length, t?.end ?? text.length); };
    const take = (key, role = ROLE[key]) => {
        if (!is(key)) fail(`« ${LEXICON[key]?.[0] ?? key} » attendu ici`);
        const t = toks[i++];
        mark(t, role);
        return t;
    };
    const takeIn = () => { if (is("define")) { mark(peek(), "link"); i++; return; } take("in"); };   // « add 3 to x »
    const lone = (k = 0) => peek(k)?.kind === "word" && ARTICLES.has(peek(k).value) && !(peek(k + 1)?.kind === "word" || peek(k + 1)?.kind === "pron");
    const skipArticles = () => { while (peek()?.kind === "word" && ARTICLES.has(peek().value) && !lone()) { mark(peek(), "art"); i++; } };
    // « des opérations » : devant un champ, « des » est l'article pluriel
    const plural = () => {
        if (!(is("from") && text.slice(peek().at, peek().end).toLowerCase() === "des")) return false;
        mark(peek(), "art"); i++;
        return true;
    };
    // Une action peut avoir un nom de plusieurs mots (« prix au mètre ») : le plus long nom connu l'emporte
    const tokWord = (t) => (!t ? null : t.kind === "word" ? t.value : t.kind === "key" ? text.slice(t.at, t.end).toLowerCase().replace(/\s+/g, "_") : null);
    // Une action du document à cet endroit : son nom mot pour mot, le premier mot sous n'importe quelle forme du verbe
    // (« on double » pour « doubler »), et même un mot du noyau qu'elle redéfinit (« afficher de manière riche »)
    const fnAt = (j) => {
        const t0 = toks[j];
        if (!t0 || !(t0.kind === "word" || t0.kind === "key")) return null;
        let found = null;
        for (const name of fns.keys()) {
            const parts = name.split("_");
            if (found && parts.length <= found.parts) continue;
            const got = [];
            let n = 0;
            while (got.length < parts.length) {
                const w = tokWord(toks[j + n]);
                if (w === null) break;
                got.push(...w.split("_"));
                n++;
            }
            if (got.length !== parts.length) continue;
            // Conjugué, le verbe ne suit jamais un article : « le compte » est un nom, pas « compter »
            const noun = toks[j - 1]?.kind === "word" && ARTICLES.has(toks[j - 1].value);
            if (!got.every((w, k) => w === parts[k] || (k === 0 && !noun && sameVerb(w, parts[0])))) continue;
            if (t0.kind === "key" && got[0] !== parts[0] && !sameVerb(got[0], parts[0])) continue;
            found = { name, len: n, parts: parts.length };
        }
        return found;
    };
    const isFn = (k = 0) => !!fnAt(i + k);

    // Un nom : des mots inconnus à la suite ; « de » + mot inconnu y entre (« le prix de vente »),
    // sauf après un champ de classe : « le loyer de Lyon » est le loyer de l'objet Lyon
    // single : un nom sans « de » + nom (« pour chaque note des notes » : la note, prise dans les notes)
    const rawName = (single = false) => {
        skipArticles();
        if (peek()?.kind === "pron") {
            const t = toks[i++];
            return { type: "name", name: refer(t), at: t.at, end: t.end, parts: [t] };
        }
        const parts = [];
        const from = peek()?.at;
        // « le livret A » : un A majuscule dans un nom n'est pas l'article anglais
        const capitalA = () => parts.length && text.slice(peek().at, peek().end) === "A";
        while (peek()?.kind === "word" && (!ARTICLES.has(peek().value) || capitalA() || (!parts.length && lone())) && !isFn()) {
            parts.push(toks[i++]);
            if (!single && is("from") && peek(1)?.kind === "word" && !ARTICLES.has(peek(1).value) && !isFn(1) && !fieldOf(nameOf(parts))) parts.push({ ...toks[i++], value: "de" });
        }
        if (!parts.length) fail(peek() ? `« ${text.slice(peek().at, peek().end)} » : un nom est attendu ici` : "un nom est attendu ici");
        lastName = nameOf(parts);
        const det = DETERMINER_AGREEMENT[/([\p{L}]+'?)\s*$/u.exec(text.slice(0, from).toLowerCase())?.[1]];
        if (det && !genders.has(lastName)) genders.set(lastName, det);
        mentioned.push(lastName);
        return { type: "name", name: lastName, at: from, end: parts[parts.length - 1].end, parts };
    };
    const name = (role = "data", single = false) => {
        const n = rawName(single);
        for (const p of n.parts) mark(p, role);
        delete n.parts;
        return n;
    };
    // « … et ajoute … » : « et » suivi d'une action enchaîne une autre instruction dans le même corps
    const ACTIONS = new Set(["show", "set", "add", "remove", "repeat", "return", "foreach", "while", "if", "multiply", "divide", "increase", "decrease", "whenever"]);
    const startsAction = (k) => (peek(k)?.kind === "key" && ACTIONS.has(peek(k).key)) || procs.has(fnAt(i + k)?.name);
    const indefinite = (k = 0) => peek(k)?.kind === "word" && INDEFINITE.has(peek(k).value);
    // Niveau 2 : « …, le premier prend la valeur du second », « … et les années valent 0 » — une nouvelle affectation
    // (un nom, puis « vaut », « augmente »…) commence ici
    const assignAhead = (k) => {
        let j = k, n = 0;
        while (peek(j)?.kind === "word" && ARTICLES.has(peek(j).value)) j++;
        while (peek(j) && (peek(j).kind === "word" || peek(j).kind === "pron" || (n && is("from", j) && ["word", "pron"].includes(peek(j + 1)?.kind)))) { j++; n++; }
        return n > 0 && (is("be", j) || is("increase", j) || is("decrease", j));
    };
    // « le capital augmente de 3 % » : une proportion multiplie, une quantité s'ajoute ou se retire
    const change = (t, op, e) => (e.type === "num" && e.pct
        ? { type: "assign", target: t, expr: { type: "bin", op: "mul", left: t, right: { type: "num", value: op === "increase" ? 1 + e.value : 1 - e.value } } }
        : { type: "assign", target: t, expr: { type: "bin", op: op === "increase" ? "add" : "sub", left: t, right: e } });
    // « chaque entier de 2 à 6 », « pour chaque entier de 1 à 100 » : la forme « entiers de » donne le nom et l'intervalle
    // « mois de 1 à 12 », « année de 2020 à 2028 » : après un nom, « de A à B » est un intervalle
    const rangeAfter = () => {
        if (!(is("from") && startsValue(1))) return null;
        const save = i, nroles = roles.length;
        take("from", "link");
        try {
            const a = additive();
            if (is("in")) { takeIn(); return { type: "range", from: a, to: additive() }; }
        } catch (e) { if (!(e instanceof Unclear)) throw e; }
        i = save; roles.length = nroles;
        return null;
    };
    const rangeLoop = () => {
        const r = peek();
        take("range", "data");
        const v = singular(text.slice(r.at, r.end).toLowerCase().split(/\s+/)[0]);
        const a = additive();
        takeIn();
        return { var: v, list: { type: "range", from: a, to: additive() } };
    };
    // « des » article pluriel (lu comme « de » + « les » par le thésaurus)
    const isDes = (k) => peek(k)?.kind === "key" && peek(k).key === "from" && text.slice(peek(k).at, peek(k).end).toLowerCase() === "des";
    // Après une virgule, une suite de paramètres : « une température et une ration, » (articles indéfinis, noms, « et »)
    const paramsAhead = (k) => {
        if (!(indefinite(k) || isDes(k))) return false;
        for (let j = k; peek(j); j++) {
            if (isSym(",", j) || isSym(":", j)) return true;
            const t = peek(j);
            if (!(t.kind === "word" || isDes(j) || (t.kind === "key" && t.key === "and"))) return false;
        }
        return false;
    };

    // « le loyer de l'appart », « les loyers des apparts » (le champ, sur chaque élément de la liste)
    const access = (n) => {
        const f = n.type === "name" && fieldOf(n.name);
        // « les prix du tableau Logements » : une colonne que le tableau n'a pas
        if (!f && n.type === "name" && is("from") && is("table", 1)) {
            const w = peek(2)?.kind === "word" ? peek(2).value : "";
            const tb = tables.get(w) || tables.get(`${w}s`) || tables.get(singular(w));
            throw new Meaningless(`« ${n.name.replace(/_/g, " ")} » n'est pas une colonne de ce tableau${tb ? ` (colonnes : ${tb.columns.map((c) => c.replace(/_/g, " ")).join(", ")})` : ""}`, n.at, n.end);
        }
        // « le balcon de la voiture » : un nom suivi de « de » + article désigne un champ, même inconnu ici
        // (l'objet peut venir de Python) ; s'il n'existe pas, l'erreur le dira à l'exécution
        // Sans aucune fiche possible (ni classe, ni données d'objets venues d'ailleurs), « le montant de la TVA » est un
        // nom composé, pas le champ « montant » d'une fiche « TVA »
        const fiches = classes.size > 0 || (ctx.extraFields || []).length > 0;
        if (!f && !fiches && n.type === "name" && is("from") && peek(1)?.kind === "word" && ARTICLES.has(peek(1).value) && peek(2)?.kind === "word") {
            take("from", "data");
            const art = toks[i++];
            mark(art, "data");
            const m = rawName(true);
            for (const p of m.parts) mark(p, "data");
            lastName = `${n.name}_de_${art.value.replace(/'$/, "")}_${m.name}`;
            return access({ type: "name", name: lastName, at: n.at, end: m.end });
        }
        // De même « son taux de taxe », quand ce dont on parle n'a pas ce champ (une ligne de tableau sans cette colonne) :
        // la donnée « taux de taxe », propre à chaque tour de la boucle
        if (!f && !fiches && n.type === "name" && is("from") && peek(1)?.kind === "pron" && !peek(1).dative && peek().at === peek().end) {
            i += 2;
            return n;
        }
        const unknown = !f && n.type === "name" && is("from") && peek(1)?.kind === "word" && ARTICLES.has(peek(1).value);
        if (!(f || unknown) || !is("from")) return n;
        take("from");
        return { type: "field", field: f || n.name, obj: filtered(atom()), at: n.at, end: n.end };   // atom lit lui-même « la ville du propriétaire de … »
    };
    // « … dont le loyer est moins de 700 » : les éléments d'une liste dont un champ passe le test
    const WHERE = { be: "eq", eq: "eq", ne: "ne", gt: "gt", lt: "lt", ge: "ge", le: "le", contains: "contains" };
    const filtered = (e) => {
        // « les notes qui sont au moins 10 » : « qui » suivi d'un test, qui porte sur chaque élément
        if (is("who") && !inList) { take("who", "link"); return elements(e); }
        if (!is("where") || inList) return e;
        take("where");
        const t0 = peek();
        if (t0?.kind === "key" && (WHERE[t0.key] || TEST.has(t0.key))) return elements(e);
        const cond = (list) => {
            const f = name("data");
            const field = fieldOf(f.name);
            if (!field) throw new Meaningless(`« ${f.name.replace(/_/g, " ")} » n'est ni une colonne ni un champ connu`, f.at, f.end);
            const t = peek();
            if (t?.kind === "key" && TEST.has(t.key)) { take(t.key); return { type: "where", list, field, op: `test:${t.key}`, rhs: null, at: f.at, end: f.end }; }
            if (!(t?.kind === "key" && WHERE[t.key])) fail("une comparaison est attendue ici (« dont le loyer est moins de 700 »)");
            take(t.key, "cond");
            // « est moins de 700 » : « de » devant le nombre est une simple liaison
            if (is("from") && (peek(1)?.kind === "num")) take("from");
            return { type: "where", list, field, op: WHERE[t.key], rhs: additive(), at: f.at, end: f.end };
        };
        let node = cond(e);
        // « dont la longueur est plus de 4,8 et la largeur au plus 1,7 » : chaque condition filtre ce que la
        // précédente a gardé (« et dont … » aussi)
        while (is("and")) {
            const back = i;
            take("and", "link");
            if (is("where")) take("where");
            let ok = false;
            try { const save = i; const f = name("data"); ok = !!fieldOf(f.name) && peek()?.kind === "key" && (WHERE[peek().key] || TEST.has(peek().key)); i = save; } catch { ok = false; }
            if (!ok) { i = back; break; }
            node = cond(node);
        }
        return node;
    };

    // Le test d'un élément (« … sont au moins 10 », « … sont pairs ») : { type: "where", field: "" }
    const elements = (list) => {
        const t = peek(), at = t.at;
        if (TEST.has(t.key)) { take(t.key, "cond"); return { type: "where", list, field: "", op: `test:${t.key}`, rhs: null, at, end: t.end }; }
        take(t.key, "cond");
        if (is("from") && (peek(1)?.kind === "num")) take("from");
        return { type: "where", list, field: "", op: WHERE[t.key], rhs: additive(), at, end: t.end };
    };

    // Une cible : une donnée, ou le champ d'un objet
    const target = () => access(name());
    const headName = (nm) => {
        if (!ctx.names || ctx.names.has(nm) || fieldOf(nm) || loopVars.includes(nm) || is("from")) return nm;
        const c = [...ctx.names].filter((x) => x.startsWith(`${nm}_`));
        return c.length === 1 ? c[0] : nm;
    };
    const atomName = () => { const n = name("data"); n.name = headName(n.name); return n; };

    // « un appartement avec un loyer de 650, une surface de 40 et une ville «Lyon» »
    const fieldAhead = (k) => {
        while (peek(k)?.kind === "word" && ARTICLES.has(peek(k).value)) k++;
        return peek(k)?.kind === "word" && [...fields].some((f) => f.split("_")[0] === peek(k).value);
    };
    const creation = (cls) => {
        const own = classes.get(cls.name).fields;
        const node = { type: "new", cls: cls.name, fields: [], at: cls.at, end: cls.end };
        if (!is("with")) return node;
        take("with");
        for (;;) {
            plural();
            const f = name("data");
            if (!own.includes(f.name)) throw new Meaningless(`${cls.art} ${cls.name.replace(/_/g, " ")} n'a pas de « ${f.name.replace(/_/g, " ")} »`, f.at, f.end);
            if (is("from") || is("be")) take(peek().key, "link");
            else if (isSym(":") || isSym("=")) { mark(peek(), "link"); i++; }
            node.fields.push({ name: f.name, expr: additive() });
            if ((isSym(",") || is("and")) && fieldAhead(1)) { mark(peek(), "link"); i++; continue; }
            return node;
        }
    };

    // ---------------- expressions, de la plus liée à la moins liée

    const BUILTIN = new Set(BUILTIN_KEYS);
    const WHOLE = new Set(["round", "sqrt", "abs"]);
    let inList = 0;

    // Ce qui peut commencer une valeur : « , affiche … » termine la liste, « , 3 » la continue
    const VALUE_KEYS = new Set(["list", "range", "minus", "true", "false", "not", ...BUILTIN_KEYS]);
    const startsValue = (k) => {
        const t = peek(k);
        return !!t && (t.kind === "num" || t.kind === "str" || t.kind === "word" || t.kind === "pron" || (t.kind === "sym" && "([".includes(t.value)) || (t.kind === "key" && VALUE_KEYS.has(t.key)));
    };
    const items = (sep = true) => {
        const out = [additive()];
        while ((isSym(",") || (sep && is("and"))) && startsValue(1)) { mark(peek(), "link"); i++; out.push(additive()); }
        return out;
    };

    const atom = () => {
        // Ce qui peut commencer une valeur (pour les messages et l'autocomplétion) : une fonction, une liste, un tableau…
        for (const k of [...BUILTIN, "list", "range", "table", "minus", "true", "false", "each", "remainder", "quotient"]) expect("key", k);
        const art = indefinite() ? peek().value : null;   // « un appartement … » : une création
        skipArticles();
        expect("value");
        const t = peek();
        if (!t) fail("la phrase s'arrête trop tôt");
        if (t.kind === "num") { i++; mark(t, "num"); return t.pct ? { type: "num", value: t.value, pct: true } : t.unit ? { type: "num", value: t.value, unit: t.unit } : { type: "num", value: t.value }; }
        if (t.kind === "str") { i++; mark(t, "str"); return { type: "str", value: t.value, ...(t.raw != null ? { raw: t.raw } : {}) }; }
        if (t.kind === "key" && (t.key === "true" || t.key === "false")) { i++; mark(t, "num"); return { type: "bool", value: t.key === "true" }; }
        if (isSym("(")) {
            mark(t, "op"); i++;
            const e = expression();
            if (!isSym(")")) fail("« ) » attendue");
            mark(peek(), "op"); i++;
            return e;
        }
        if (isSym("[")) {
            mark(t, "op"); i++;
            inList++;
            const xs = isSym("]") ? [] : items(false);
            inList--;
            if (!isSym("]")) fail("« ] » attendu");
            mark(peek(), "op"); i++;
            return { type: "list", items: xs };
        }
        if (t.kind === "key" && t.key === "list") {
            take("list");
            inList++;
            const xs = items();
            inList--;
            return { type: "list", items: xs };
        }
        if (t.kind === "key" && t.key === "table") {
            take("table");
            const n = rawName();
            for (const p of n.parts) mark(p, "type");
            const tname = [n.name, `${n.name}s`, singular(n.name)].find((x) => tables.has(x));
            const tb = tables.get(tname);
            if (!tb) {
                const near = suggest(n.name, [...tables.keys()]).filter((x) => tables.has(x));
                throw new Meaningless(`aucun tableau « ${n.name.replace(/_/g, " ")} » dans le document${near.length ? ` — ${near.join(", ")} ?` : ""} (un tableau porte le nom du titre au-dessus de lui)`, n.at, n.end);
            }
            return { type: "table", name: tname, columns: tb.columns, rows: tb.rows, at: n.at, end: n.end };
        }
        if (t.kind === "key" && t.key === "range") {
            take("range");
            const a = additive();
            takeIn();
            return { type: "range", from: a, to: additive() };
        }
        // « l'arrondi du loyer fois 1,03 » arrondit le produit ; « la somme des notes plus 1 » ajoute 1 à la somme
        // « le total du stock » : quand un champ s'appelle « total » (ou « nombre », « taille »…), c'est le champ
        if (t.kind === "key" && BUILTIN.has(t.key)) {
            const w = text.slice(t.at, t.end).toLowerCase().split(/[\s']+/).find((x) => x && !/^(le|la|les|l|de|des|du|d|the|of)$/.test(x) && fieldOf(x));
            if (w) {
                i++; mark(t, "data");
                return { type: "field", field: fieldOf(w), obj: filtered(atom()), at: t.at, end: t.end };
            }
        }
        if (t.kind === "key" && BUILTIN.has(t.key)) { take(t.key); return { type: "builtin", fn: t.key, arg: WHOLE.has(t.key) ? term() : postfix(), at: t.at, end: t.end }; }
        if (t.kind === "key" && t.key === "minus") { take("minus"); return { type: "neg", expr: postfix() }; }
        // « le carré de 7 », « son carré » : l'opération nommée avant sa valeur
        if (t.kind === "key" && (t.key === "square" || t.key === "cube") && /^le /i.test(text.slice(t.at, t.end)) || (t.kind === "key" && (t.key === "square" || t.key === "cube") && peek(1)?.kind === "pron")) {
            take(t.key);
            return { type: "bin", op: "pow", left: postfix(), right: { type: "num", value: t.key === "square" ? 2 : 3 } };
        }
        // « chaque entier de 2 à 6 », « chaque note des notes » : l'instruction se répète pour chacun
        if (t.kind === "key" && t.key === "each") {
            take("each");
            let q;
            if (is("range")) q = rangeLoop();
            else {
                const v = name("data", true).name;
                const r = rangeAfter();
                if (r) q = { var: v, list: r };
                else {
                    if (is("in") || is("from")) take(peek().key); else fail("« chaque … » : de quelle liste ? (« chaque note des notes », « chaque entier de 1 à 10 »)");
                    q = { var: v, list: additive() };
                }
            }
            pending.push(q);
            return { type: "name", name: q.var, at: t.at, end: t.end };
        }
        // « le reste de la division de 17 par 5 », « le quotient de 87 par 20 »
        if (t.kind === "key" && (t.key === "remainder" || t.key === "quotient")) {
            take(t.key);
            const a = postfix();
            if (is("by") || is("div")) take(peek().key, "link"); else fail("« par » attendu (« le reste de la division de 17 par 5 »)");
            const b = postfix();
            const mod = { type: "bin", op: "mod", left: a, right: b, at: t.at, end: t.end };
            return t.key === "remainder" ? mod : { type: "bin", op: "div", left: { type: "bin", op: "sub", left: a, right: mod }, right: b, at: t.at, end: t.end };
        }
        // « combien de notes sont au moins 10 », « combien sont pairs » (de la liste dont on parle)
        if (t.kind === "key" && t.key === "howmany") {
            take("howmany");
            let list, named = false;
            if (peek()?.kind === "key" && (WHERE[peek().key] || TEST.has(peek().key))) list = { type: "name", name: refer(t), at: t.at, end: t.end };
            else { list = atomName(); named = true; }
            if (is("where")) take("where", "link");
            else if (is("who")) take("who", "link");
            const tested = peek()?.kind === "key" && (WHERE[peek().key] || TEST.has(peek().key));
            // « combien de langages » sans test : tous les éléments, comme « le nombre de langages »
            if (!tested && named) return { type: "builtin", fn: "count", arg: list, at: t.at, end: t.end };
            if (!tested) fail("un test est attendu (« combien sont au moins 10 »)");
            return { type: "builtin", fn: "len", arg: elements(list), at: t.at, end: t.end };
        }
        if (isFn()) return call();
        if (t.kind === "word" || t.kind === "pron") {
            const n = rawName();
            const parts = n.parts;
            delete n.parts;
            if (art && classes.has(n.name)) {
                for (const p of parts) mark(p, "type");
                return creation({ ...n, art });
            }
            // « une voiture avec une marque … » sans classe « voiture » : elle se déclare d'abord
            if (art && is("with")) throw new Meaningless(`« ${n.name.replace(/_/g, " ")} » n'est pas une classe déclarée : décrivez-la d'abord dans une phrase (« ${art} ${n.name.replace(/_/g, " ")} a un nom et un prix »)`, n.at, n.end);
            for (const p of parts) mark(p, "data");
            // « la moyenne des notes » quand le document n'a que « les notes de français » : on ne répète souvent que
            // le nom principal ; s'il désigne un seul nom connu, c'est celui-là
            n.name = headName(n.name);
            // « le loyer le plus bas du tableau Logements », « la note la plus haute des notes » : le superlatif
            // d'un champ porte sur ce champ de chaque élément ; d'un autre nom, sur la liste elle-même
            if ((is("max") || is("min")) && /^(le|la) (plus|moins) /i.test(text.slice(peek().at, peek().end))) {
                const sup = peek(); take(sup.key);
                const obj = filtered(atom());
                const f = fieldOf(n.name);
                return { type: "builtin", fn: sup.key, arg: f ? { type: "field", field: f, obj, at: n.at, end: n.end } : obj, at: sup.at, end: sup.end };
            }
            return access(n);
        }
        fail(`« ${text.slice(t.at, t.end)} » n'a pas sa place ici`);
    };

    // Les valeurs passées à une action s'arrêtent à « suivi de » : « suivi de tarifer le lot suivi de « € » »
    const call = () => {
        const f = fnAt(i);
        const t = { at: toks[i].at, end: toks[i + f.len - 1].end };
        for (let k = 0; k < f.len; k++) mark(toks[i + k], "action");
        i += f.len;
        const n = fns.get(f.name);
        const args = [];
        // « compter les diviseurs de 7 » : le « de » devant la première valeur, comme dans la définition
        if (n && is("from") && startsValue(1)) take("from", "link");
        for (let k = 0; k < n; k++) {
            if (k) { if (is("and") || isSym(",")) { mark(peek(), "link"); i++; } else fail(`${f.name.replace(/_/g, " ")} attend ${n} valeurs`); }
            args.push(additive(true));
        }
        return { type: "call", name: f.name, args, at: t.at, end: t.end };
    };

    const postfix = () => {
        let e = filtered(atom());
        for (;;) {
            if (is("square")) { take("square"); e = { type: "bin", op: "pow", left: e, right: { type: "num", value: 2 } }; }
            else if (is("cube")) { take("cube"); e = { type: "bin", op: "pow", left: e, right: { type: "num", value: 3 } }; }
            else if (is("sorted") && !inList) { take("sorted"); e = { type: "builtin", fn: "sorted", arg: e }; }
            else if (is("reversed") && !inList) { take("reversed"); e = { type: "builtin", fn: "reversed", arg: e }; }
            else if (participle()) e = participle(e);
            else return e;
        }
    };
    // Un participe passé après une valeur lui applique l'action : « le total diminué de 15 % », « le prix augmenté de 2 »,
    // « la somme multipliée par 3 », « le prix doublé » (une action du document à une valeur). Grammaire seulement :
    // le participe (-é, -ée, -és, -ées) n'est jamais le verbe conjugué d'une proposition (« le prix diminue de 2 »).
    const CHANGES = { increase: "from", decrease: "from", multiply: "by", divide: "by" };
    function participle(e) {
        const t = peek();
        if (!t || !(t.kind === "word" || t.kind === "key") || !/é(e?s?)$/u.test(text.slice(t.at, t.end).toLowerCase())) return null;
        const key = t.kind === "key" ? t.key : verbKey(t.value);
        const own = t.kind === "word" && [...fns].find(([n, arity]) => arity === 1 && !n.includes("_") && sameVerb(t.value, n));
        if (!(CHANGES[key] && is(CHANGES[key], 1)) && !own) return null;
        if (!e) return true;
        mark(t, "action");
        i++;
        if (own) return { type: "call", name: own[0], args: [e], at: t.at, end: t.end };
        take(CHANGES[key], "link");
        const by = postfix();
        if (key === "multiply" || key === "divide") return { type: "bin", op: key === "multiply" ? "mul" : "div", left: e, right: by, at: t.at, end: t.end };
        return by.type === "num" && by.pct
            ? { type: "bin", op: "mul", left: e, right: { type: "num", value: key === "increase" ? 1 + by.value : 1 - by.value }, at: t.at, end: t.end }
            : { type: "bin", op: key === "increase" ? "add" : "sub", left: e, right: by, at: t.at, end: t.end };
    }

    const MUL = { times: "mul", mul: "mul", div: "div", mod: "mod" };
    let lastMul = null;
    const term = () => {
        let e = postfix(), op = null;
        for (const k of Object.keys(MUL)) expect("key", k);
        while (peek()?.kind === "key" && MUL[peek().key]) {
            op = peek(); take(op.key, "op");
            e = { type: "bin", op: MUL[op.key], left: e, right: postfix(), at: op.at, end: op.end };
        }
        lastMul = op;
        return e;
    };

    // « le loyer plus les courses fois 12 » : on lit comme en maths, et on le dit
    const additive = (noConcat = false) => {
        const start = peek()?.at;
        let e = term(), before = lastMul;
        while (is("plus") || is("minus") || (is("concat") && !noConcat)) {
            const op = peek(); take(op.key);
            e = { type: "bin", op: op.key === "plus" ? "add" : op.key === "minus" ? "sub" : "concat", left: e, right: term(), at: op.at, end: op.end };
            const mul = lastMul || before;
            if (mul && op.key !== "concat") {
                doubts.push({ at: mul.at, end: mul.end, msg: `Lu avec « ${text.slice(mul.at, mul.end)} » d'abord, comme en maths. Pour l'autre lecture, mettez des parenthèses : « (${text.slice(start, mul.at).trim()}) ${text.slice(mul.at, toks[i - 1].end)} ».` });
            }
            before = null;
        }
        // « reconnaît » suivi de n suivi de « fleurs, soit » : dans une suite de « suivi de », les espaces d'un
        // texte qui touchent une autre valeur la séparent ; seules celles des deux bouts sont typographiques
        if (e.type === "bin" && e.op === "concat") {
            const parts = [];
            for (let x = e; x.type === "bin" && x.op === "concat"; x = x.left) parts.unshift(x);
            const operands = [parts[0].left, ...parts.map((x) => x.right)];
            operands.forEach((o, k) => {
                if (o.type !== "str" || o.raw == null) return;
                let v = o.raw;
                if (k === 0) v = v.trimStart();
                if (k === operands.length - 1) v = v.trimEnd();
                o.value = v;
            });
        }
        return e;
    };

    const CMP = { gt: "gt", lt: "lt", ge: "ge", le: "le", eq: "eq", ne: "ne", contains: "contains" };
    const TEST = new Set(["even", "odd", "empty", "positive", "negative"]);
    // L'adjectif de chaque test (« est vide » : vide), pour « n'est pas vide »
    const TEST_ADJ = new Map([...TEST].flatMap((k) => LEXICON[k].map((f) => f.split(" ")).filter((w) => w.length === 2 && w[0] === "est").map((w) => [lemma(w[1]), k])));
    const comparison = () => {
        const left = additive();
        for (const k of ["be", ...Object.keys(CMP), ...TEST]) expect("key", k);
        const t = peek();
        // « x est un appartement » : un test de classe (sans « avec … », ce n'est pas une création)
        const isa = (r, neg) => (r.type === "new" && !r.fields.length ? { type: "isa", cls: r.cls, expr: left, neg } : null);
        // « 36 est divisible par cet entier » : le reste de la division est nul
        if (is("divisible")) {
            take("divisible", "cond");
            const right = additive();
            return { type: "bin", op: "eq", left: { type: "bin", op: "mod", left, right, at: t.at, end: t.end }, right: { type: "num", value: 0 }, at: t.at, end: t.end };
        }
        if (t?.kind === "key" && t.key === "be") {
            take("be", "cond");
            const right = additive();
            return isa(right, false) || { type: "bin", op: "eq", left, right, at: t.at, end: t.end };
        }
        // « la liste n'est pas vide », « n n'est pas pair » : le test nié
        const adj = t?.kind === "key" && t.key === "ne" && peek(1)?.kind === "word" && TEST_ADJ.get(lemma(peek(1).value));
        if (adj) { take("ne", "cond"); mark(peek(), "cond"); i++; return { type: "not", expr: { type: "test", test: adj, expr: left } }; }
        if (t?.kind === "key" && CMP[t.key]) {
            take(t.key);
            const right = additive();
            return (t.key === "ne" && isa(right, true)) || { type: "bin", op: CMP[t.key], left, right, at: t.at, end: t.end };
        }
        if (t?.kind === "key" && TEST.has(t.key)) { take(t.key); return { type: "test", test: t.key, expr: left }; }
        return left;
    };
    const negation = () => (is("not") ? (take("not"), { type: "not", expr: negation() }) : comparison());
    const conjunction = () => {
        let e = negation();
        while (is("and") && !inList && !startsAction(1) && !(inCond === 0 && assignAhead(1))) { const at = peek().at; take("and"); e = { type: "bin", op: "and", left: e, right: negation(), at }; }
        return e;
    };
    const expression = () => {
        let e = conjunction();
        while (is("or")) { take("or"); e = { type: "bin", op: "or", left: e, right: conjunction() }; }
        return e;
    };

    // ---------------- instructions

    const comma = () => { if (isSym(",") || isSym(":")) { mark(peek(), "link"); i++; } };
    const times = () => {
        const n = toks[i]; mark(n, "num"); i++;
        mark(toks[i], "link"); i++;
        return { type: "num", value: n.value };
    };
    const countFollows = (k = 0) => peek(k)?.kind === "num" && (is("times", k + 1) || is("mul", k + 1));

    // « un appartement a un loyer, une surface de 0 et une ville » — « an apartment has a rent »
    // « un studio est une sorte d'appartement qui a une mezzanine » : il a aussi tout ce qu'a un appartement
    const classDeclaration = () => {
        if (!indefinite()) return null;
        const save = i, nroles = roles.length;
        const art = peek().value;
        mark(peek(), "art"); i++;
        let cls;
        try { cls = rawName(); } catch (e) { if (!(e instanceof Unclear)) throw e; }
        const verbHas = () => is("has") || (peek()?.kind === "word" && peek().value === "a" && (peek(1)?.kind === "word"));
        const kind = cls && is("be") && is("kind", 1);
        if (!cls || !(kind || verbHas())) { i = save; roles.length = nroles; return null; }
        for (const p of cls.parts) mark(p, "type");
        let parent = null;
        if (kind) {
            take("be", "action"); take("kind");
            const pn = rawName();
            for (const p of pn.parts) mark(p, "type");
            parent = { name: pn.name, at: pn.at, end: pn.end };
            if (!verbHas()) return { type: "class", name: cls.name, art, parent, fields: [], at: cls.at, end: cls.end };
        }
        mark(peek(), "action"); i++;
        const list = [];
        for (;;) {
            const many = plural();
            const f = name("data");
            let def = null;
            if (is("from")) { take("from"); def = additive(); }
            else if (isSym(":") || isSym("=")) { mark(peek(), "link"); i++; def = additive(); }
            else if (many) def = { type: "list", items: [] };   // « des opérations » : une liste, vide au départ
            list.push({ name: f.name, default: def, at: f.at, end: f.end });
            if (isSym(",") || is("and")) { mark(peek(), "link"); i++; continue; }
            break;
        }
        return { type: "class", name: cls.name, art, parent, fields: list, at: cls.at, end: cls.end };
    };

    const statement = () => {
        while (is("then") || isSym(",")) { mark(peek(), isSym(",") ? "link" : "filler"); i++; }   // « alors » hors d'un « si », « à la fin, … »
        const outer = pending;
        pending = [];
        for (const k of ["show", "if", "repeat", "foreach", "while", "define", "return", "set", "add", "remove"]) expect("key", k);
        expect("value");
        const t = peek();
        if (!t) fail("la phrase est vide");
        let s;
        const own = peek()?.kind === "key" && isFn();
        if (own) {
            s = { type: "expr", expr: expression() };
        } else if (is("show")) {
            take("show");
            const xs = [comparison()];
            while ((is("and") || isSym(",")) && startsValue(1) && !startsAction(1) && !assignAhead(1)) { mark(peek(), "link"); i++; xs.push(comparison()); }
            s = { type: "show", exprs: xs };
        } else if (is("if")) {
            take("if");
            inCond++;
            const cond = expression();
            inCond--;
            if (is("then")) take("then"); else comma();
            const then = block();
            let other = null;
            // « si …, A ; sinon B » : le « sinon » après un point-virgule appartient encore au « si »
            if ((isSym(",") || (is("seq") && text.slice(peek().at, peek().end) === ";")) && is("else", 1)) { mark(peek(), "link"); i++; }
            if (is("else")) { take("else"); comma(); other = block(); }
            s = { type: "if", cond, then, else: other };
        } else if (is("whenever")) {
            // « chaque fois qu'une note est plus grande…, … » : une condition, dans la boucle qui l'entoure
            take("whenever");
            inCond++;
            const cond = expression();
            inCond--;
            if (is("then")) take("then"); else comma();
            s = { type: "if", cond, then: block(), else: null };
        } else if (peek()?.kind === "num" && is("times", 1)) {
            // « dix fois de suite, … » (« 4 x 2 » reste un calcul)
            const n = times();
            comma();
            s = { type: "repeat", count: n, body: block(true, true) };
        } else if (is("compute")) {
            // « calcule la moyenne des notes » : la donnée « moyenne » reçoit ce calcul (« cette moyenne », « elle » la
            // retrouvent ensuite) ; « compte combien … » : la donnée « nombre » (« affiche ce nombre »)
            const t = peek(); take("compute");
            const from = peek()?.at ?? t.end;
            let e = expression();
            const said = text.slice(from, toks[i - 1]?.end ?? from);
            const head = /^(?:le |la |les |l'|un |une )?([\p{L}]+)/u.exec(said.toLowerCase())?.[1];
            // « compte les notes » : leur nombre, comme « compte combien de notes » (pas les notes elles-mêmes)
            const counting = /^(compt|count)/i.test(text.slice(t.at, t.end));
            if (counting && !(e.type === "builtin" && (e.fn === "len" || e.fn === "count"))) e = { type: "builtin", fn: "count", arg: e, at: t.at, end: t.end };
            const nm = e.type === "builtin" && (e.fn === "len" || e.fn === "count") && (counting || /^combien/i.test(said)) ? "nombre"
                : e.type === "name" ? e.name : e.type === "builtin" && head ? head : "résultat";
            lastName = nm;
            s = { type: "assign", target: { type: "name", name: nm, at: t.at, end: t.end }, expr: e };
        } else if (is("replace")) {
            // « on remplace le plus grand par le reste… » : l'affectation dite autrement
            take("replace");
            const tg = target();
            if (is("by")) take("by", "link"); else fail("« par » attendu (« remplace le prix par 12 »)");
            s = { type: "assign", target: tg, expr: expression() };
        } else if (is("multiply") || is("divide") || is("increase") || is("decrease")) {
            // Le verbe d'abord : « multiplie le résultat par 3 », « augmente le prix de 5 % »
            const op = peek().key;
            take(op);
            const tg = target();
            if (op === "multiply" || op === "divide") {
                if (is("by") || is("mul") || is("div")) take(peek().key, "link"); else fail("« par » attendu (« multiplie le prix par 2 »)");
                s = { type: "assign", target: tg, expr: { type: "bin", op: op === "multiply" ? "mul" : "div", left: tg, right: additive() } };
            } else {
                if (is("from")) take("from", "link");
                s = change(tg, op, additive());
            }
        } else if (is("repeat")) {
            take("repeat");
            if (countFollows()) { const n = times(); comma(); s = { type: "repeat", count: n, body: block(true, true) }; }
            else {
                const body = statement();
                if (!countFollows()) fail("combien de fois ? (« répète 3 fois … »)");
                s = { type: "repeat", count: times(), body };
            }
        } else if (is("foreach")) {
            take("foreach");
            let q;
            if (is("range")) q = rangeLoop();   // « pour chaque entier de 1 à 100 »
            else {
                const v = name("data", true);
                const r = rangeAfter();
                if (r) q = { var: v.name, list: r };
                else {
                    if (is("from")) take("from"); else takeIn();
                    q = { var: v.name, list: expression() };
                }
            }
            comma();
            loopVars.push(q.var);
            const body = block(true, true);
            loopVars.pop();
            s = { type: "foreach", var: q.var, list: q.list, body };
        } else if (is("while")) {
            take("while");
            inCond++;
            const cond = expression();
            inCond--;
            comma();
            s = { type: "while", cond, body: block(true, true) };
        } else if (is("define")) {
            // « pour doubler un nombre, renvoie le nombre fois 2 » — « to double a number, return the number times 2 »
            take("define");
            // Un mot du noyau peut être redéfini (« pour afficher de manière riche un texte, … »)
            if (!(peek()?.kind === "word" || peek()?.kind === "key")) fail("le nom de l'action est attendu (« pour doubler un nombre, … »)");
            // Le nom va jusqu'au premier paramètre, introduit par un article indéfini (« pour bilan de l'étape des
            // kilomètres », « pour prix au mètre un bien ») ; à défaut par un article (« pour doubler le nombre ») ;
            // sans article, c'est le premier mot (« pour milieu x et y »)
            let len = 1, def = 0, param = 0;
            // Le premier paramètre (un, une, des) avant la virgule borne le nom, quels qu'en soient les mots
            // (« pour mettre au carré un nombre », « pour afficher de manière riche un texte »)
            for (let k = 1; peek(k) && !isSym(",", k) && !isSym(":", k); k++) if (indefinite(k) || isDes(k)) { param = k; break; }
            for (let k = 1; !param && peek(k) && !isSym(",", k) && !isSym(":", k); k++) {
                const t = peek(k);
                if (t.kind === "word" && ARTICLES.has(t.value) && !def) def = k;
                if (!(t.kind === "word" || (t.kind === "key" && ["from", "in"].includes(t.key)))) break;
            }
            len = param || def || 1;
            // « pour compter les diviseurs d'un nombre » : le « de » qui introduit le paramètre n'est pas dans le nom
            if (param && len > 1 && is("from", len - 1)) len--;
            const f = { value: toks.slice(i, i + len).map(tokWord).join("_"), at: peek().at, end: peek(len - 1).end };
            for (let k = 0; k < len; k++) mark(toks[i + k], "action");
            i += len;
            if (is("from") && (indefinite(1) || isDes(1))) take("from", "link");   // « … les diviseurs d'un nombre »
            const params = [];
            const more = () => peek() && !isSym(",") && !isSym(":") && (peek().kind !== "key" || isDes(0));
            const series = () => { while (more()) { plural(); params.push(name("data").name); if (is("and")) take("and"); } };
            series();
            // « des kilomètres, une température et une ration, … » : d'autres paramètres après une virgule
            while (isSym(",") && paramsAhead(1)) { mark(peek(), "link"); i++; series(); }
            comma();
            for (const p of params) params_.add(p);
            // L'action se connaît elle-même pendant qu'on lit son corps : « … renvoie le nombre plus cumul (le nombre moins 1) »
            if (!fns.has(f.value)) fns.set(f.value, params.length);
            s = { type: "define", name: f.value, params, body: block(true), at: f.at, end: f.end };   // « … ; … ; on renvoie … »
        } else if (is("return")) {
            take("return");
            s = { type: "return", expr: expression() };
        } else if (is("set")) {
            const verb = text.slice(t.at, t.end).toLowerCase();
            take("set");
            if (verb === "set") {   // « set y to 2 » : la cible d'abord, comme en anglais
                const n = target();
                takeIn();
                s = { type: "assign", target: n, expr: expression() };
            } else {
                const e = expression();
                takeIn();
                s = { type: "assign", target: target(), expr: e };
            }
        } else if ((is("add") || is("remove")) && peek(1)?.dative) {
            // « on lui ajoute 1 » : la cible d'abord (le pronom), puis la quantité
            const op = peek().key; take(op);
            const tg = target();
            s = { type: op, target: tg, expr: additive() };
        } else if (is("add") || is("remove")) {
            const op = peek().key; take(op);
            const e = additive();
            // « on le multiplie par 3 et l'on ajoute 1 » : sans destination, on ajoute à ce dont on parle
            const bare = !peek() || isSym(";") || isSym(",") || is("seq") || is("and") || is("then") || is("else");
            if (bare) { const t0 = toks[i - 1]; return finish({ type: op, target: { type: "name", name: refer(t0), at: t0.at, end: t0.end }, expr: e }); }
            if (op === "add") takeIn(); else if (is("from")) take("from"); else takeIn();
            s = { type: op, target: target(), expr: e };
        } else if ((s = classDeclaration())) {
            // « un appartement a un loyer, une surface et une ville »
        } else {
            // « le prix vaut 12 », « le loyer de l'appart vaut 700 », « let prix be 12 », sinon une expression
            if (t.kind === "word" && (t.value === "let" || t.value === "soit")) { mark(t, "action"); i++; }
            const save = i, nroles = roles.length, named = lastName;
            let dest = null;
            if ((peek()?.kind === "word" || peek()?.kind === "pron") && !isFn()) {
                try { dest = target(); } catch (e) { if (!(e instanceof Unclear)) throw e; }
                if (!(dest && (is("be") || is("eq") || is("increase") || is("decrease")))) { dest = null; i = save; roles.length = nroles; lastName = named; }
            }
            if (dest && (is("increase") || is("decrease"))) {
                // Le sujet d'abord : « le capital augmente de 3 % », « il diminue de 5 »
                const op = peek().key;
                take(op);
                if (is("from")) take("from", "link");
                s = change(dest, op, additive());
            } else if (dest) {
                mark(peek(), "action"); i++;
                if (is("from") && peek(1)?.kind === "num") take("from", "link");   // « le prix est de 6 euros »
                let e = expression();
                // « les notes sont 8, 4, 11 et 4 » : une énumération est une liste
                if (isSym(",") && startsValue(1) && !startsAction(1) && !assignAhead(1)) {
                    const xs = [e];
                    while ((isSym(",") || is("and")) && startsValue(1) && !startsAction(1) && !assignAhead(1)) { mark(peek(), "link"); i++; xs.push(additive()); }
                    e = { type: "list", items: xs };
                }
                e = enumeration(e, plan);
                s = { type: "assign", target: dest, expr: e };
            }
            else s = { type: "expr", expr: expression() };
        }
        // « on double le prix » : une action qui rend une valeur, appliquée à une donnée, la remplace par son résultat —
        // c'est la forme de la phrase (verbe + complément) qui le dit, pas le sens du verbe
        if (s.type === "expr" && s.expr.type === "call" && !procs.has(s.expr.name) && ["name", "field"].includes(s.expr.args[0]?.type)) {
            s = { type: "assign", target: s.expr.args[0], expr: s.expr };
        }
        return finish(s);
        function finish(s) {
            // « affiche «salut» 2 fois »
            if (countFollows()) s = { type: "repeat", count: times(), body: s };
            // « on le multiplie par chaque entier de 2 à 6 » : la boucle implicite entoure l'instruction
            for (const q of pending.reverse()) s = { type: "foreach", var: q.var, list: q.list, body: s };
            pending = outer;
            return s;
        }
    };

    // loose : dans une boucle, « …, puis … » continue la boucle (« pour chaque coupure, on affiche …, puis … »)
    // inLoop : un « renvoie » sans condition ne continue pas une boucle (il l'arrêterait au premier tour) — il la suit
    const block = (loose = false, inLoop = false) => {
        const list = [statement()], semi = [];
        for (;;) {
            // Dans un corps de boucle ou d'action, « , », « ; », « puis » (et leurs suites : « ; puis ») enchaînent
            let k = 0, sc = false;
            if (loose) while (isSym(",", k) || is("seq", k) || is("and", k)) { if (is("seq", k) && text.slice(peek(k).at, peek(k).end) === ";") sc = true; k++; }
            else if (is("and") || isSym(",")) k = 1;
            if (!k || !(startsAction(k) || assignAhead(k)) || (inLoop && is("return", k))) break;
            for (let j = 0; j < k; j++) { mark(peek(), "link"); i++; }
            semi.push(sc);
            list.push(statement());
        }
        // « s'il est pair, … ; s'il est impair, … » : une énumération de cas (le premier qui convient s'applique)
        for (let k = list.length - 1; k > 0; k--) {
            const a = list[k - 1], b = list[k];
            if (semi[k - 1] && a.type === "if" && !a.else && b.type === "if") { list[k - 1] = { ...a, else: b }; list.splice(k, 1); semi.splice(k - 1, 1); }
        }
        return list.length === 1 ? list[0] : { type: "seq", list };
    };

    const program = () => {
        const list = [block()], semi = [];
        // « puis », « ensuite », « ; », et « then » hors d'un « if »
        while (is("seq") || is("then") || (isSym(",") && (is("seq", 1) || is("then", 1)))) {
            if (isSym(",")) { mark(peek(), "link"); i++; }
            semi.push(text.slice(peek().at, peek().end) === ";");
            mark(peek(), "link"); i++;
            list.push(block());
        }
        for (let k = list.length - 1; k > 0; k--) {
            const a = list[k - 1], b = list[k];
            if (semi[k - 1] && a.type === "if" && !a.else && b.type === "if") { list[k - 1] = { ...a, else: b }; list.splice(k, 1); }
        }
        return list.length === 1 ? list[0] : { type: "seq", list };
    };

    // « _4 x 2_ », « _le loyer fois 12_ » : une phrase qui n'est qu'un calcul l'affiche, comme une calculatrice.
    // Un nombre ou un texte seul reste muet (« _2024_ » en italique), et une action appelée seule ne fait que ce qu'elle fait.
    const SHOWN = new Set(["bin", "builtin", "field", "where", "neg", "test", "isa", "name", "range"]);
    const shown = (s) => {
        switch (s?.type) {
            case "expr": return SHOWN.has(s.expr.type) ? { type: "show", exprs: [s.expr] } : s;
            case "seq": return { ...s, list: s.list.map(shown) };
            case "if": return { ...s, then: shown(s.then), else: s.else && shown(s.else) };
            case "repeat": case "foreach": case "while": return { ...s, body: shown(s.body) };
            default: return s;   // le corps d'une action garde sa dernière valeur : c'est ce qu'elle rend
        }
    };

    let ast;
    try {
        ast = shown(program());
        if (i < toks.length) {
            const prev = toks[i - 1];
            if (prev?.kind === "word" && prev !== toks[0] && !ARTICLES.has(prev.value) && startsValue(0)) {
                const near = suggest(prev.value, [...fns.keys()]);
                throw new Unclear(`« ${text.slice(prev.at, prev.end)} » : action inconnue${near.length ? ` — ${near.join(", ")} ?` : ""} (une action se définit avec « pour ${prev.value} …, renvoie … »)`, prev.at, prev.end);
            }
            fail(`« ${text.slice(toks[i].at, toks[i].end)} » : je ne sais pas quoi en faire`);
        }
    } catch (e) {
        if (!(e instanceof Unclear)) throw e;
        e.expected = far;
        // Même illisible, la phrase garde sa coloration : ce que la lecture a compris avant de bloquer, puis les mots
        // de la langue reconnus plus loin ; un mot inconnu est atténué — on voit où s'arrête la compréhension
        const lexical = all.filter((t) => t.kind !== "filler" && !roles.some((r) => r.at <= t.at && t.end <= r.end))
            .map((t) => ({ at: t.at, end: t.end, role: t.kind === "word" ? "unknown" : t.kind === "pron" ? "data" : t.kind === "key" ? ROLE[t.key] || "link" : t.kind === "num" ? "num" : t.kind === "str" ? "str" : t.value === "," ? "link" : "op" }));
        e.roles = segments([...roles, ...lexical], text);
        // « … : je ne sais pas quoi en faire » : on dit ce qui était attendu là
        if (far.at === e.at && /je ne sais pas quoi en faire|n'a pas sa place ici/.test(e.message)) {
            const ws = [...[...far.keys].filter((k) => LEXICON[k]).map((k) => `« ${LEXICON[k][0]} »`), ...[...far.syms].filter((x) => x !== ",").map((x) => `« ${x} »`)].slice(0, 5);
            if (ws.length) e.message += ` (attendu ici : ${ws.join(", ")}${far.value ? ", ou une valeur" : ""})`;
        }
        // Un mot inconnu en tête, suivi d'autre chose : c'est l'action que la machine ne connaît pas
        const first = toks[0];
        if (first?.kind === "word" && !ARTICLES.has(first.value) && !fnAt(0) && toks.length > 1 &&
            !(toks[1].kind === "key" && ["be", "eq"].includes(toks[1].key)) && e.at > first.at) {
            const near = suggest(first.value, [...fns.keys()]);
            const lead = new Unclear(`« ${text.slice(first.at, first.end)} » : je ne connais pas cette action${near.length ? ` — ${near.join(", ")} ?` : ""}`, first.at, first.end);
            lead.expected = far;
            lead.roles = e.roles;
            lead.deep = e.at;   // là où la lecture a vraiment bloqué : la réparation y regarde aussi
            throw lead;
        }
        throw e;
    }
    return { ast, roles: segments(roles, text), doubts, far, genders };
}

/** Un article rejoint le nom qui le suit, et des mots voisins du même rôle forment un segment. */
function segments(roles, text) {
    const rs = roles.slice().sort((a, b) => a.at - b.at).map((r) => ({ ...r }));
    for (let k = 0; k < rs.length - 1; k++) if (rs[k].role === "art" && ["data", "type"].includes(rs[k + 1].role) && !text.slice(rs[k].end, rs[k + 1].at).trim()) rs[k].role = rs[k + 1].role;
    const out = [];
    for (const r of rs) {
        const last = out[out.length - 1];
        if (last && last.role === r.role && !text.slice(last.end, r.at).trim()) last.end = r.end;
        else out.push(r);
    }
    return out;
}

/**
 * Ce qu'une phrase définit : les actions (« pour doubler un nombre, … ») dans fns (nom -> nombre de paramètres),
 * les classes (« un appartement a un loyer… ») dans classes (nom -> { fields }, champs hérités compris).
 */
export function definitions(ast, fns = new Map(), classes = new Map(), procs = new Set()) {
    if (!ast) return fns;
    if (ast.type === "define") {
        fns.set(ast.name, ast.params.length);
        if (gives(ast.body, procs)) procs.delete(ast.name); else procs.add(ast.name);
    }
    if (ast.type === "class") {
        const inherited = (ast.parent && classes.get(ast.parent.name)?.fields) || [];
        classes.set(ast.name, { fields: [...inherited, ...ast.fields.map((f) => f.name).filter((f) => !inherited.includes(f))] });
    }
    if (ast.type === "seq") for (const s of ast.list) definitions(s, fns, classes, procs);
    return fns;
}

/** Une action rend-elle une valeur ? (« renvoie … », ou une valeur seule ; l'appel d'une procédure n'en est pas une) */
function gives(s, procs) {
    if (!s) return false;
    switch (s.type) {
        case "return": return true;
        case "expr": return !(s.expr.type === "call" && procs.has(s.expr.name));
        case "seq": return s.list.some((x) => gives(x, procs));
        case "if": return gives(s.then, procs) || gives(s.else, procs);
        case "repeat": case "foreach": case "while": return gives(s.body, procs);
        default: return false;
    }
}

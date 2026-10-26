// translate.js — le français libre rapproché de Grama Lectica.
//
// Une phrase qu'on écrit sans connaître le langage (« Quelle est la moyenne des notes ? ») devient la forme que le
// moteur exécute (« Affiche la moyenne des notes. »). Deux étages, tous deux explicables :
//
//   1. des réécritures locales, pour les formes figées : « le double du loyer » -> « le loyer fois 2 »,
//      « les notes supérieures à 10 » -> « les notes qui dépassent 10 », « à l'écran » s'efface ;
//   2. une classification de la phrase entière par ressemblance avec des modèles de tournures à emplacements
//      (« quel est {X} ? » -> « Affiche {X}. ») : un alignement mot à mot, qui tolère les mots en plus, les fautes
//      de frappe et les variantes, donne un score de ressemblance entre 0 et 1.
//
// Rien n'est deviné en silence : index.js n'exécute une traduction que si elle se lit sans doute, garde le modèle
// reconnu et son score (le signe « traduite » les montre), et ne fait que la proposer quand la ressemblance est faible.
// Rien non plus ne change le sens : le moteur, et donc le programme C++, reçoivent l'arbre de la forme traduite.

import { IRREGULAR_PLURALS, ADJECTIVES } from "./forms.js";

export const STRONG = 0.9;    // au-dessus : la tournure est reconnue, la traduction passe avant la lecture littérale
export const ACCEPT = 0.72;   // au-dessus : la traduction s'exécute si la lecture littérale ne tient pas
export const SUGGEST = 0.5;   // au-dessus : elle est seulement proposée (« vouliez-vous dire … ? »)

// ---------------------------------------------------------------- mots

/** Sans majuscules ni accents, lettre pour lettre : une position du texte replié est la même dans l'original. */
export function foldSame(s) {
    let out = "";
    for (const c of s) {
        const f = c === "’" ? "'" : c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        out += f.length === c.length ? f : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
    }
    return out;
}

/** Les mots d'une phrase : { f (replié), at, end, kind } ; « l' », « d' » sont des mots, les traits d'union séparent. */
export function tokens(text) {
    const out = [];
    const re = /«[^»]*»|"[^"]*"|\d+(?:[.,]\d+)?|[\p{L}]+['’]?|[?!.,;:%€$]/gu;
    let m;
    while ((m = re.exec(text))) {
        const s = m[0];
        const kind = /^[«"]/.test(s) ? "str" : /^\d/.test(s) ? "num" : /^\p{L}/u.test(s) ? "word" : "punct";
        // « j' », « l' » se comparent sans leur apostrophe (le motif écrit « j », « l »)
        out.push({ f: kind === "str" ? s : foldSame(s).replace(/'$/, ""), at: m.index, end: m.index + s.length, kind });
    }
    return out;
}

// Les mots qui n'ajoutent rien à ce qu'on demande : un modèle les accepte en plus, presque sans coût
const FILLERS = new Set("donc alors bien juste simplement svp stp merci please aussi maintenant ensuite puis encore vite rapidement moi nous".split(" "));

function distance(a, b) {
    // Damerau-Levenshtein restreinte (une inversion de deux lettres compte pour une faute)
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

/** Ce que coûte de lire le mot w à la place du mot attendu want : 0 (le même), une faute de frappe, ou impossible. */
function wordCost(w, want) {
    if (w === want) return 0;
    if (w.length >= 5 && want.length >= 5) {
        const k = distance(w, want);
        if (k === 1) return 0.35;
        if (k === 2 && w.length >= 8) return 0.5;
    }
    return Infinity;
}

// ---------------------------------------------------------------- formes des noms

const fold = (s) => foldSame(s).replace(/œ/g, "oe").replace(/æ/g, "ae").trim();

/**
 * Le nom connu du document que désigne un mot, au singulier ou au pluriel (« note » -> « notes »), ou null.
 * plural : le nom d'une liste — « note » désigne « notes » même si une boucle a déjà nommé « note ».
 */
export function knownName(word, names, plural = false) {
    // (le moteur range « dépenses du mois » sous « dépenses de mois » : « du », « des », « de la », « d' » -> « de »)
    const w = fold(word).replace(/ (?:du|des|de la) /g, " de ").replace(/ (?:de l'|d')/g, " de ");
    const known = new Map([...names].map((n) => [fold(n.replace(/_/g, " ")), n.replace(/_/g, " ")]));
    const forms = [plural && !/[sx]$/.test(w) ? null : w, w + "s", w + "x", w.replace(/al$/, "aux"), w.replace(/ail$/, "aux"), w.replace(/s$/, ""), w.replace(/x$/, ""),
        w.replace(/aux$/, "al"), IRREGULAR_PLURALS[w], ...Object.entries(IRREGULAR_PLURALS).filter(([, v]) => v === w).map(([k]) => k)];
    for (const f of forms) if (f && known.has(f)) return known.get(f);
    // Un nom composé s'accorde sur son premier mot : « note de français » -> « notes de français »
    const m = /^(\S+)( .+)$/.exec(w);
    if (m) for (const head of [m[1] + "s", m[1] + "x", m[1].replace(/al$/, "aux"), m[1].replace(/[sx]$/, "")]) if (known.has(head + m[2])) return known.get(head + m[2]);
    return null;
}

/**
 * Le plus long nom connu au début d'un groupe de mots (« note de français ? » -> « notes de français »), et ce qui
 * reste après : { name, rest } ou null.
 */
function leadingName(said, names, plural) {
    const parts = said.split(/(?= (?:de |du |des |d'))/);
    for (let k = parts.length; k > 0; k--) {
        const n = knownName(parts.slice(0, k).join(""), names, plural);
        if (n) return { name: n, rest: parts.slice(k).join("") };
    }
    return null;
}

/** Le lemme d'un adjectif (« supérieures » -> « superieur ») : la table du Wiktionnaire, puis les accords réguliers. */
export function adjective(word) {
    const w = fold(word);
    if (ADJECTIVES[w]) return ADJECTIVES[w];
    return w.replace(/(e?s|e)$/, "");
}

// ---------------------------------------------------------------- 1. réécritures locales

const ART = { "du ": "le ", "de la ": "la ", "de l'": "l'", "des ": "les ", "de ": "", "d'": "" };
const ARTS = "(du |de la |de l'|des |de |d')";
// Une valeur courte : un nombre, ou un nom de quatre mots au plus, qui s'arrête aux mots de liaison
const STOP = "(?:et|plus|moins|fois|par|puis|sinon|alors|ou|divise|multiplie|qui|dont|sont|est|a|au|aux|dans)";
const OPD = `(\\d+(?:[.,]\\d+)?|(?:l'|le |la |les )?[a-z][a-z'-]*(?: (?!${STOP} )[a-z][a-z'-]*){0,3}?)`;
const END = "(?=\\s*(?:[.,;:?!]|$)| (?:et|plus|moins|fois|puis|sinon|alors|ou|divise|multiplie)\\b)";
const MAX = "(?:grande?|haute?|elevee?|forte?)";
const MIN = "(?:petite?|basse?|faible|minime)";

/**
 * Les réécritures locales : [nom, motif sur le texte replié, (groupes du texte d'origine, contexte) -> texte ou null].
 * Un motif ne voit que le texte replié (sans accents ni majuscules) ; le remplacement reprend les mots d'origine.
 */
const LOCAL = [
    ["« le double de X »", new RegExp(`\\b(le double|la moitie|le triple|le quart|le tiers) ${ARTS}${OPD}${END}`, "dg"),
        (g) => `${ART[foldSame(g[2])] ?? ""}${g[3]} ${{ "le double": "fois 2", "la moitie": "divisé par 2", "le triple": "fois 3", "le quart": "divisé par 4", "le tiers": "divisé par 3" }[foldSame(g[1])]}`],
    ["« son double »", /\b(affiche|montre|donne|ecris|dis)(?:-moi)? (son|sa) (double|moitie|triple|quart)\b/dg,
        (g) => `${g[1]}-la ${{ double: "fois 2", moitie: "divisé par 2", triple: "fois 3", quart: "divisé par 4" }[foldSame(g[3])]}`],
    ["« la somme de A et B »", new RegExp(`\\b(la somme|le total|le produit) ${ARTS}${OPD} et ${ARTS}?${OPD}${END}`, "dg"),
        (g) => `${ART[foldSame(g[2])] ?? ""}${g[3]} ${/produit/.test(foldSame(g[1])) ? "fois" : "plus"} ${ART[foldSame(g[4] || "")] ?? ""}${g[5]}`],
    // « la valeur du loyer » : le loyer lui-même (si « valeur » n'est pas une donnée du document)
    ["« la valeur de X »", new RegExp(`\\bla valeur ${ARTS}${OPD}${END}`, "dg"),
        (g, ctx) => (knownName("valeur", ctx.names) || !knownName(g[2].replace(/^(l'|le |la |les )/, ""), ctx.names) ? null : `${ART[foldSame(g[1])] ?? ""}${g[2]}`)],
    ["« la différence entre A et B »", new RegExp(`\\bla difference entre ${OPD} et ${OPD}${END}`, "dg"),
        (g) => `${g[1]} moins ${g[2]}`],
    // Les superlatifs d'une liste : « la plus grande note », « la note la plus haute », « la note maximale »
    ["« la plus grande note »", new RegExp(`\\b(?:la|le) (?:plus (${MAX}|${MIN})|(meilleure?|pire)) ([a-z]+(?: (?:de la |de l'|de |du |des |d')[a-z]+)*)\\b`, "dg"),
        (g, ctx) => superlative(g[3], /^(petit|bas|faibl|minim)|pire/.test(foldSame(g[1] || g[2])), ctx)],
    ["« la note la plus haute »", new RegExp(`\\b(?:la|le) ([a-z]+(?: (?:de la |de l'|de |du |des |d')[a-z]+)*) (?:la|le) plus (${MAX}|${MIN})\\b`, "dg"),
        (g, ctx) => superlative(g[1], /^(petit|bas|faibl|minim)/.test(foldSame(g[2])), ctx)],
    ["« la note maximale »", new RegExp(`\\b(?:la|le) ([a-z]+(?: (?:de la |de l'|de |du |des |d')[a-z]+)*) (maximale?|minimale?|max|min)\\b`, "dg"),
        (g, ctx) => superlative(g[1], /^min/.test(foldSame(g[2])), ctx)],
    // Les filtres par un adjectif : « les notes supérieures à 10 », « les notes au-dessus de 10 »
    ["« les notes supérieures à 10 »",
        /\b(les|des|de|d') ?([a-z]+(?: (?:de la |de l'|de |du |des |d')[a-z]+)*) (superieure?s? a|plus grande?s? que|plus elevee?s? que|au-dessus de|au dessus de|inferieure?s? a|plus petite?s? que|plus basse?s? que|en dessous de|en-dessous de|au-dessous de|au dessous de)\b ?/dg,
        (g, ctx) => {
            const n = knownName(g[2], ctx.names);
            if (!n) return null;
            const less = /infer|petit|bas|dessous/.test(foldSame(g[3]));
            return `${g[1]}${/'$/.test(g[1]) ? "" : " "}${g[2]} qui ${less ? "sont moins de" : "dépassent"} `;
        }],
    // Ce qui ne change rien à la demande
    ["« à l'écran »", / (?:a|sur) l'ecran\b/dg, () => ""],
    ["« s'il te plaît »", /,? s'il (?:te|vous) plait\b/dg, () => ""],
    ["« par mois »", / (?:par|chaque|tous les|toutes les) (?:mois|an|ans|annee|annees|jour|jours|semaine|semaines|heure|heures)\b(?=\s*(?:[.,;:?!]|$))/dg, () => ""],
    ["« ajoute 18 à la liste des notes »", /\b(ajoute|ajouter|ajoutons|ajoutez)( .+?) (?:a|dans) la liste (?:des|de|d') ?([a-z]+)\b/dg,
        (g, ctx) => (knownName(g[3], ctx.names) ? `${g[1]}${g[2]} aux ${knownName(g[3], ctx.names)}` : null)],
    // « pour chaque note, … » : la liste est celle du même nom
    ["« pour chaque note, »", /\bpour (?:chaque|chacune des|chacun des|tout|toute) ([a-z]+(?: (?:de la |de l'|de |du |des |d')[a-z]+)*)\s*,/dg,
        (g, ctx) => {
            // la boucle nomme son élément par le premier mot : « pour chaque dépense dans les dépenses du mois »
            const n = knownName(g[1], ctx.names, true);
            return n && fold(n) !== fold(g[1]) ? `pour chaque ${g[1].split(" ")[0]} dans les ${n},` : null;
        }],
    // « affiche ce résultat », « affiche cette valeur » : ce que la phrase vient de calculer
    ["« affiche ce résultat »", /\b(affiche|montre|donne|ecris)(?:-moi)? (?:ce|cette|le|la) (resultat|valeur|calcul)\b(?! d[eu']| des)/dg,
        (g, ctx) => (knownName(g[2], ctx.names) ? null : `${g[1]}-le`)],
    // Les verbes de variation : « le loyer baisse de 50 »
    ["« baisse de »", /\b(baisse|baissent|descend|descendent|chute|chutent|recule|reculent) de\b/dg,
        (g) => (/ent$|nt$/.test(foldSame(g[1])) ? "diminuent de" : "diminue de")],
    ["« monte de »", /\b(monte|montent|grimpe|grimpent|progresse|progressent) de\b/dg,
        (g) => (/ent$/.test(foldSame(g[1])) ? "augmentent de" : "augmente de")],
];

function superlative(noun, min, ctx) {
    const n = leadingName(noun, ctx.names, true);
    return n ? `le ${min ? "minimum" : "maximum"} des ${n.name}${n.rest}` : null;
}

/** Applique les réécritures locales. Rend { text, rules } (rules : les noms de celles qui ont servi). */
export function rewrite(text, ctx) {
    const rules = [];
    let out = text;
    for (const [name, re, build] of LOCAL) {
        let f = foldSame(out), changed = "", last = 0, any = false;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(f))) {
            const g = m.indices.map((ix) => (ix ? out.slice(ix[0], ix[1]) : undefined));
            const rep = build(g, ctx);
            if (rep == null) continue;
            changed += out.slice(last, m.index) + rep;
            last = m.index + m[0].length;
            any = true;
        }
        if (any) { out = changed + out.slice(last); rules.push(name); }
    }
    out = out.replace(/ {2,}/g, " ").replace(/ ([,.?!])/g, "$1");
    // La majuscule du début reste (« Pour chaque note » ne devient pas « pour chaque note »)
    if (/^\p{Lu}/u.test(text) && out) out = out[0].toUpperCase() + out.slice(1);
    return { text: out, rules };
}

// ---------------------------------------------------------------- 2. modèles de tournures

/**
 * Les modèles : [motif, forme]. Motif : des mots (repliés), des choix (a|b c), des mots facultatifs [a|b], des
 * emplacements {X}. Forme : la phrase de Grama Lectica, où {X} reprend le texte d'origine de l'emplacement et
 * {X:pl} le nom connu au pluriel (« élève » -> « élèves »).
 */
const PATTERNS = [
    ["(quel|quelle|quels|quelles) (est|sont|etait|etaient) {X} ?", "Affiche {X}."],
    ["(que|combien) (vaut|valent|fait|font|coute|coutent|donne|donnent|represente) {X} ?", "Affiche {X}."],
    ["combien y a t il de {X} ?", "Affiche combien de {X}."],
    ["combien de {X} y a t il ?", "Affiche combien de {X}."],
    ["combien de {X} il y a", "Affiche combien de {X}."],
    ["combien (est|sont) {X} ?", "Affiche combien sont {X}."],
    ["{X} (est|sont) (il|elle|ils|elles|ce) {T} ?", "Affiche {X} est {T}."],
    ["est ce que {X} (est|sont) {T} ?", "Affiche {X} est {T}."],
    ["(c|ca) (est|fait) (quoi|combien) {X} ?", "Affiche {X}."],
    ["{X} (c|ca) (est|fait) (quoi|combien) ?", "Affiche {X}."],
    ["qu est ce que (c|ca) (est|fait) {X} ?", "Affiche {X}."],
    ["(donne|montre|dis|indique|ecris|presente|sors) [moi|nous] {X}", "Affiche {X}."],
    ["(peux|pourrais|pourriez|pouvez|peut) (tu|vous|on) [me|nous] (afficher|montrer|donner|dire|indiquer|calculer|ecrire|trouver) {X} [?]", "Affiche {X}."],
    ["(tu|vous) (peux|pouvez|pourrais|pourriez) [me|nous] (afficher|montrer|donner|dire|indiquer|calculer|ecrire|trouver) {X} [?]", "Affiche {X}."],
    ["(je|j|on|nous) (veux|voudrais|veut|voudrait|souhaite|souhaiterais|aimerais|aimerait|voulons|voudrions|desire|cherche) [a] (voir|connaitre|savoir|afficher|avoir|obtenir|lire|calculer) {X}", "Affiche {X}."],
    ["merci (d|de) (afficher|montrer|donner|indiquer|calculer) {X}", "Affiche {X}."],
    ["il y a {V} {X}", "Les {X:pl} valent {V}."],
    ["{X} (passe|passent) (a|au) {V}", "{X} vaut {V}."],
    ["{X} (devient|deviennent) {V}", "{X} vaut {V}."],
    ["(garde|conserve|retiens) [seulement|uniquement] (les|des) {N} {F}", "Les {N} valent les {N} {F}."],
];

/** Un motif découpé : [{ lit: [[mot…], …], opt } | { slot: "X", mod }] */
function compile(src) {
    const out = [];
    const re = /\(([^)]*)\)|\[([^\]]*)\]|\{(\w+)(?::(\w+))?\}|([^\s()[\]{}]+)/g;
    let m;
    while ((m = re.exec(src))) {
        if (m[3]) { out.push({ slot: m[3], mod: m[4] }); continue; }
        const alts = (m[1] ?? m[2] ?? m[5]).split("|").map((a) => tokens(a).map((t) => t.f));
        out.push({ lit: alts, opt: m[2] != null });
    }
    return out;
}
const COMPILED = PATTERNS.map(([src, form]) => {
    const parts = compile(src);
    // Pour écarter vite un modèle : ses mots obligatoires, et le score qu'il ne peut dépasser s'il en manque
    const required = parts.filter((p) => p.lit && !p.opt).map((p) => p.lit.map((a) => a[0]));
    return { src, form, parts, required };
});

// Les tournures que le document a apprises (learn.js, son lexique) : des modèles comme les autres
const LEARNED = new Map();
function learnedPatterns(ctx) {
    return (ctx.lexicon?.tournures || []).map(({ motif, forme }) => {
        const k = `${motif}\u0001${forme}`;
        if (!LEARNED.has(k)) {
            const parts = compile(motif);
            LEARNED.set(k, { src: motif, form: forme, parts, required: parts.filter((p) => p.lit && !p.opt).map((p) => p.lit.map((a) => a[0])), learned: true });
        }
        return LEARNED.get(k);
    });
}

/** Un mot de la phrase peut-il tenir lieu d'un mot du modèle (le même, ou une faute de frappe) ? */
const near = (words, want) => words.has(want) || (want.length >= 5 && [...words].some((w) => w.length >= 5 && Math.abs(w.length - want.length) <= 2 && w[0] === want[0] && wordCost(w, want) < Infinity));

/**
 * L'alignement d'une phrase sur un modèle, au moindre coût : un mot attendu absent coûte 1, un mot en plus 0,6
 * (0,1 pour un mot qui n'ajoute rien, 0,15 pour une ponctuation), une faute de frappe 0,35 ; un emplacement prend
 * au moins un mot. Rend { score, slots: { X: [début, fin] } } ou null.
 */
function align(toks, parts) {
    const n = toks.length, m = parts.length;
    const INF = Infinity;
    const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
    const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
    cost[0][0] = 0;
    const extra = (t) => (t.kind === "punct" ? 0.15 : FILLERS.has(t.f) ? 0.1 : 0.6);
    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= m; j++) {
            const c = cost[i][j];
            if (c === INF) continue;
            const relax = (a, b, x, how) => { if (x < cost[a][b]) { cost[a][b] = x; from[a][b] = [i, j, how]; } };
            if (i < n) relax(i + 1, j, c + extra(toks[i]), "extra");
            if (j === m) continue;
            const p = parts[j];
            if (p.slot) {
                for (let k = i + 1; k <= n; k++) {
                    if (toks[k - 1].kind === "punct" && toks[k - 1].f === "?") break;
                    relax(k, j + 1, c, "slot");
                }
                continue;
            }
            relax(i, j + 1, c + (p.opt ? 0 : 1), "skip");
            for (const alt of p.lit) {
                if (i + alt.length > n) continue;
                let x = 0;
                for (let q = 0; q < alt.length && x < INF; q++) x += wordCost(toks[i + q].f, alt[q]);
                if (x < INF) relax(i + alt.length, j + 1, c + x, "lit");
            }
        }
    }
    if (cost[n][m] === INF) return null;
    const slots = {};
    for (let i = n, j = m; from[i][j];) {
        const [a, b, how] = from[i][j];
        if (how === "slot") slots[parts[b].slot] = [a, i];
        i = a; j = b;
    }
    const lits = parts.filter((p) => p.lit && !p.opt).length;
    return { score: Math.max(0, 1 - cost[n][m] / (lits + 1)), slots };
}

/** Classe la phrase parmi les modèles : [{ text, score, rule }] du plus ressemblant au moins ressemblant. */
export function classify(text, ctx) {
    // Le point final ne compte pas : le modèle n'en parle pas, la forme met le sien
    const toks = tokens(text);
    while (toks.length && toks[toks.length - 1].kind === "punct" && /[.!]/.test(toks[toks.length - 1].f)) toks.pop();
    if (!toks.length) return [];
    const out = [];
    const words = new Set(toks.map((t) => t.f));
    for (const { src, form, parts, required, learned } of [...COMPILED, ...learnedPatterns(ctx)]) {
        const missing = required.filter((alts) => !alts.some((w) => near(words, w))).length;
        if (1 - missing / (required.length + 1) < SUGGEST) continue;
        const a = align(toks, parts);
        if (!a || a.score < SUGGEST) continue;
        let ok = true;
        const filled = form.replace(/\{(\w+)(?::(\w+))?\}/g, (_, k, mod) => {
            const r = a.slots[k];
            if (!r) { ok = false; return ""; }
            const said = text.slice(toks[r[0]].at, toks[r[1] - 1].end).trim();
            if (mod === "pl") return knownName(said, ctx.names) || (/[sx]$/i.test(said) ? said : said + "s");
            return said;
        });
        if (ok) out.push({ text: filled[0].toUpperCase() + filled.slice(1), score: a.score, rule: learned ? `apprise « ${src} »` : `« ${src.replace(/\[[^\]]*\]\s*/g, "").replace(/\(([^|)]*)[^)]*\)/g, "$1").replace(/ \?$/, " ?")} »` });
    }
    return out.sort((x, y) => y.score - x.score);
}

/**
 * Les traductions possibles d'une phrase, de la plus sûre à la moins sûre : les réécritures locales, puis la
 * classification de la phrase réécrite (une fois réécrite par un modèle, elle peut l'être encore par un autre :
 * « Dis-moi combien de notes il y a » -> « Affiche combien de notes il y a. » -> « Affiche combien de notes. »).
 */
const CACHE = new Map();

export function translate(text, ctx) {
    // Pendant la frappe, une seule phrase change : les autres se retrouvent ici (même texte, mêmes noms connus)
    const key = `${ctx.sig ?? [...(ctx.names || [])].join(",")}\u0001${text}`;
    if (CACHE.has(key)) return CACHE.get(key);
    const res = translateNow(text, ctx);
    if (CACHE.size > 4000) CACHE.clear();
    CACHE.set(key, res);
    return res;
}

function translateNow(text, ctx) {
    const local = rewrite(text, ctx);
    const out = [];
    const seen = new Set([text]);
    const push = (c) => { if (!seen.has(c.text)) { seen.add(c.text); out.push(c); } };
    const deeper = (c, depth) => {
        push(c);
        if (depth > 1) return;
        for (const d of classify(c.text, ctx)) if (d.score >= ACCEPT) deeper({ text: d.text, score: Math.min(c.score, d.score), rule: `${c.rule} puis ${d.rule}`, whole: true }, depth + 1);
    };
    for (const c of classify(local.text, ctx)) deeper({ ...c, rule: [...local.rules, c.rule].join(" + "), whole: true }, 1);
    if (local.rules.length) push({ text: local.text, score: 1, rule: local.rules.join(" + "), whole: false });
    return out.sort((x, y) => y.score - x.score);
}

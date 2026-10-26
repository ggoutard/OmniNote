// discours.js — les liens logiques entre les phrases : « donc », « car », « or », « mais », « si … alors ». Un texte ne
// fait pas que calculer, il raisonne ; la machine vérifie ce raisonnement, avec ce qu'elle sait déjà calculer.
//
// Les connecteurs sont une classe fermée de mots grammaticaux (comme les articles), qui disent peu de relations — celles
// de la théorie de la structure du discours (Mann et Thompson, 1988) :
//   conséquence  « donc », « ainsi », « par conséquent »…   ce qui est conclu est vrai, et dépend de ce qui précède
//   cause        « Q, car P », « parce que », « puisque »…    P est vrai, Q aussi, et Q dépend de P
//   prémisse     « or »                                       c'est vrai
//   contraste    « mais », « pourtant », « cependant »…       c'est vrai (l'opposition elle-même n'est pas jugée)
//   reformulation « autrement dit », « c'est-à-dire »         c'est vrai
// et la condition, déjà dans la langue : « si P, alors Q » affirmé seul est vrai si P est faux ou Q vrai.
// « Dépend de » ne se devine pas : il se lit sur le graphe des données (le total dépend du loyer s'il en est calculé).

const LEADS = [
    ["conséquence", ["par conséquent", "en conséquence", "c'est pourquoi", "de ce fait", "d'où", "donc", "ainsi", "alors"]],
    ["prémisse", ["or"]],
    ["contraste", ["en revanche", "néanmoins", "toutefois", "cependant", "pourtant", "mais"]],
    ["reformulation", ["autrement dit", "en d'autres termes", "c'est-à-dire"]],
    ["ajout", ["de plus", "en outre", "par ailleurs"]],
];
const INNER = [
    ["cause", ["étant donné que", "parce que", "puisque", "vu que", "car"]],
    ["conséquence", ["par conséquent", "donc"]],
];
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’ʼ]/g, "'");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Le discours d'une phrase : son connecteur de tête (lien avec la phrase d'avant) et ses propositions (« Q, car P »).
 * → null (rien de tel) ou { lead: { rel, at, end } | null, parts: [{ text, at }], inner: { rel, at, end } | null }
 *   parts[0] est ce qui est affirmé ; avec inner, parts[1] est sa cause (cause) ou sa conséquence (conséquence).
 */
export function discourse(text) {
    const f = fold(text);
    let lead = null, start = 0;
    for (const [rel, words] of LEADS) {
        for (const w of words) {
            const m = new RegExp(`^\\s*${esc(fold(w))}(?![\\p{L}'])\\s*,?\\s*`, "u").exec(f);
            // (« alors » seul en tête : une conséquence ; « si …, alors … » reste à la langue)
            if (m && f.length > m[0].length + 2) { lead = { rel, word: w, at: 0, end: m[0].length }; start = m[0].length; break; }
        }
        if (lead) break;
    }
    let inner = null;
    for (const [rel, words] of INNER) {
        for (const w of words) {
            const re = new RegExp(`(?:,\\s*|\\s+)${esc(fold(w))}(?![\\p{L}'])\\s*`, "u");
            const m = re.exec(f.slice(start));
            if (m && m.index > 2) { inner = { rel, word: w, at: start + m.index, end: start + m.index + m[0].length }; break; }
        }
        if (inner) break;
    }
    // un connecteur dans la proposition (« le total est donc supérieur à 700 ») : effacé par des espaces de même longueur
    // (les positions ne bougent pas), et noté comme le lien avec la phrase d'avant
    let adverb = null;
    if (!lead) for (const [rel, words] of LEADS) {
        for (const w of words) {
            if (w === "alors" || w === "or") continue;   // (« si …, alors … » ; « or » : aussi un nom)
            const m = new RegExp(`\\s${esc(fold(w))}(?![\\p{L}'])`, "u").exec(f);
            if (m) { adverb = { rel, word: w, at: m.index + 1, end: m.index + m[0].length }; break; }
        }
        if (adverb) break;
    }
    if (!lead && !inner && !adverb) return null;
    const end = text.replace(/\s*[.!]\s*$/, "").length;
    const parts = inner
        ? [{ text: text.slice(start, inner.at).trim() + ".", at: start }, { text: text.slice(inner.end, end).trim() + ".", at: inner.end }]
        : [{ text: text.slice(start), at: start }];
    const blanked = adverb && { text: text.slice(0, adverb.at) + " ".repeat(adverb.end - adverb.at) + text.slice(adverb.end), at: 0 };
    // (la majuscule perdue après le connecteur ne change rien à la lecture)
    return { lead, inner, parts, adverb, blanked };
}

/** Les données dont dépend chacune, d'après les phrases du document : Map nom → Set des noms d'où elle est calculée. */
export function dependencies(asts) {
    const direct = new Map();
    const reads = (e, out = new Set()) => { walk(e, (n) => { if (n.type === "name") out.add(n.name); }); return out; };
    const write = (name, from) => { if (!direct.has(name)) direct.set(name, new Set()); for (const x of from) if (x !== name) direct.get(name).add(x); };
    for (const a of asts) walk(a, (n) => {
        if ((n.type === "assign" || n.type === "add" || n.type === "remove") && n.target) {
            const t = n.target.type === "name" ? n.target.name : n.target.field;
            write(t, reads(n.expr));
            if (n.target.type === "field") write(t, reads(n.target.obj));
        }
        if (n.type === "foreach") write(n.var, reads(n.list));
    });
    // la fermeture : le total dépend des charges, qui dépendent du nombre de mois…
    const closed = new Map();
    const close = (n, seen = new Set()) => {
        if (closed.has(n)) return closed.get(n);
        if (seen.has(n)) return new Set();
        seen.add(n);
        const out = new Set(direct.get(n) || []);
        for (const x of direct.get(n) || []) for (const y of close(x, seen)) out.add(y);
        closed.set(n, out);
        return out;
    };
    for (const n of direct.keys()) close(n);
    return closed;
}

/** Les noms qu'une phrase lit ou écrit. */
export function namesIn(ast) {
    const out = new Set();
    walk(ast, (n) => { if (n.type === "name") out.add(n.name); if (n.target?.type === "name") out.add(n.target.name); });
    return out;
}

/** b dépend-il de a ? (un nom commun, ou un nom de b calculé à partir d'un nom de a) */
export function dependsOn(b, a, deps) {
    for (const x of b) {
        if (a.has(x)) return true;
        for (const y of deps.get(x) || []) if (a.has(y)) return true;
    }
    return false;
}

function walk(n, f) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, f)); return; }
    if (n.type) f(n);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, f);
}

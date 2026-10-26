// sortes.js — ce qu'est une valeur, pour toute la page : un treillis de sortes, petit et fixe, sur lequel le reste
// (le sens des phrases, l'apprentissage, le diagramme, les preuves) se branche. Rien n'y est propre à un domaine :
// les unités, les classes, les bornes viennent du document (en-têtes de tableaux, fiches, littéraux).
//
//   ⊥        rien encore : l'élément d'une liste vide, un paramètre qu'aucun appel n'a nourri (jointure(⊥, s) = s)
//   ?        connue à l'exécution seulement : une variable d'un bloc Python pas encore exécuté (typage graduel, Siek &
//            Taha 2006 : compatible avec tout, elle ne bloque jamais le juge ; elle se précise dès que la valeur arrive)
//   ⊤        plusieurs sortes à la fois (une liste qui mêle nombres et textes) : rien d'impossible n'en est déduit
//   nombre   avec, en option, une unité (« € », « m² » : d'un en-tête « Loyer (€) »), entier, et des bornes [min, max]
//   texte, booléen
//   liste    de : la sorte de ses éléments
//   fiche    cls : sa classe (une fiche du document, une ligne d'un tableau) ; les classes forment un « est une sorte de »
//   action   params, rend
//
// Les sortes structurelles (nombre, liste, fiche) décident de ce qui est possible ; les unités et les bornes affinent :
// additionner des € et des m² n'a pas de sens, additionner un loyer et un nombre sans unité en a.

export const BOT = Object.freeze({ k: "⊥" });
export const DYN = Object.freeze({ k: "?" });
export const TOP = Object.freeze({ k: "⊤" });
export const TEXTE = Object.freeze({ k: "texte" });
export const BOOL = Object.freeze({ k: "booléen" });
export const NOMBRE = Object.freeze({ k: "nombre" });

export const nombre = (o = {}) => clean({ k: "nombre", ...o });
export const liste = (de = BOT) => ({ k: "liste", de });
export const fiche = (cls, table = false) => (table ? { k: "fiche", cls, table } : { k: "fiche", cls });
export const action = (params, rend = BOT) => ({ k: "action", params, rend });

/** Une sorte sans ses champs vides (deux sortes égales s'écrivent pareil). */
function clean(s) {
    for (const key of ["unite", "min", "max", "entier"]) if (s[key] == null || s[key] === false) delete s[key];
    if (s.min === -Infinity) delete s.min;
    if (s.max === Infinity) delete s.max;
    return s;
}

/** Sûre, cette sorte ? (ni ⊥, ni ?, ni ⊤ : on peut en déduire qu'une opération n'a pas de sens) */
export const definite = (s) => s && s.k !== "⊥" && s.k !== "?" && s.k !== "⊤";

/** La même sorte ? (fine : unités et bornes comprises) */
export const same = (a, b) => key(a, true) === key(b, true);

/** Une clé : grossière (sans les bornes, pour la signature du document) ou fine. */
export function key(s, fine = false) {
    if (!s) return "⊥";
    switch (s.k) {
        case "nombre": return `n${s.entier ? "i" : ""}${s.unite ? `[${s.unite}]` : ""}${fine && (s.min != null || s.max != null) ? `<${s.min ?? ""},${s.max ?? ""}>` : ""}`;
        case "liste": return `L(${key(s.de, fine)})`;
        case "fiche": return `F(${s.cls})`;
        case "action": return `A(${s.params.map((p) => key(p, fine)).join(",")}→${key(s.rend, fine)})`;
        default: return s.k;
    }
}

/**
 * La plus petite sorte qui contient a et b. parentOf(cls) : la classe parente (pour deux fiches : leur ancêtre commun).
 * Deux nombres d'unités différentes : un nombre sans unité ; leurs bornes : l'enveloppe.
 */
export function join(a, b, parentOf = () => null) {
    if (!a || a.k === "⊥") return b || BOT;
    if (!b || b.k === "⊥") return a;
    if (a.k === "?" || b.k === "?") return DYN;
    if (a.k !== b.k) return TOP;
    switch (a.k) {
        case "nombre": return nombre({
            unite: a.unite === b.unite ? a.unite : null,
            entier: a.entier && b.entier,
            min: a.min != null && b.min != null ? Math.min(a.min, b.min) : null,
            max: a.max != null && b.max != null ? Math.max(a.max, b.max) : null,
        });
        case "liste": return liste(join(a.de, b.de, parentOf));
        case "fiche": {
            if (a.cls === b.cls) return a;
            const up = new Set();
            for (let c = a.cls; c; c = parentOf(c)) up.add(c);
            for (let c = b.cls; c; c = parentOf(c)) if (up.has(c)) return fiche(c);
            return TOP;
        }
        case "action": return same(a, b) ? a : TOP;
        default: return a;
    }
}

/** a est-elle une sorte de b ? (⊥ est une sorte de tout ; tout est une sorte de ⊤ ; ? s'accorde avec tout) */
export function sub(a, b, parentOf = () => null) {
    if (!a || a.k === "⊥" || b?.k === "⊤" || a.k === "?" || b?.k === "?") return true;
    return same(join(a, b, parentOf), b) || key(join(a, b, parentOf)) === key(b);
}

/** La sorte d'une valeur : de la page (Fiche de run.js), de Python ou de SQL (JSON : { $fiche, $class }). */
export function sortOf(v, name = "fiche") {
    if (typeof v === "number") return Number.isFinite(v) ? nombre({ entier: Number.isInteger(v), min: v, max: v }) : NOMBRE;
    if (typeof v === "string") return TEXTE;
    if (typeof v === "boolean") return BOOL;
    if (Array.isArray(v)) return liste(v.reduce((s, x) => join(s, sortOf(x, name)), BOT));
    if (v && v.cls && v.vals) return fiche(v.cls.name);
    if (v && typeof v === "object" && v.$fiche) return fiche(v.$class ? v.$class.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : name);
    if (v && v.params) return action(v.params.map(() => BOT));
    return DYN;
}

/** L'unité d'un en-tête de colonne : « Loyer (€) » → « € », « Surface (en m²) » → « m² ». */
export function unitOf(header) {
    const m = /\(\s*(?:en\s+)?([^()]{1,12}?)\s*\)/u.exec(header || "");
    return m ? m[1] : null;
}

// ---------------------------------------------------------------- les opérations

const ARITH = new Set(["add", "sub", "mul", "div", "mod", "pow"]);
const ORDER = new Set(["gt", "lt", "ge", "le"]);
const unitText = (s) => (s.unite ? `des ${s.unite}` : "un nombre");

/**
 * La sorte d'une opération sur deux sortes : { sort, err } — err (une phrase) seulement si c'est sûr : deux sortes
 * précises qui ne vont pas ensemble. Une opération sur ⊥, ? ou ⊤ rend sans erreur.
 */
export function apply(op, a, b) {
    const bothNum = a?.k === "nombre" && b?.k === "nombre";
    if (op === "and" || op === "or" || op === "eq" || op === "ne" || op === "contains") return { sort: BOOL };
    if (ORDER.has(op)) {
        if (bothNum && a.unite && b.unite && a.unite !== b.unite) return { sort: BOOL, err: `comparer ${unitText(a)} et ${unitText(b)} n'a pas de sens` };
        if (definite(a) && definite(b) && !(bothNum || (a.k === "texte" && b.k === "texte"))) return { sort: BOOL, err: `comparer ${text(a)} et ${text(b)} n'a pas de sens` };
        return { sort: BOOL };
    }
    if (op === "concat") return { sort: TEXTE };
    if (!ARITH.has(op)) return { sort: DYN };
    if (op === "add") {
        if (a?.k === "liste") return { sort: liste(join(a.de, b?.k === "liste" ? b.de : b)) };
        if (a?.k === "texte" || b?.k === "texte") return { sort: TEXTE };
    }
    const need = (s) => definite(s) && s.k !== "nombre";
    if (need(a) || need(b)) {
        const bad = need(a) ? a : b;
        return { sort: NOMBRE, err: `${WORD[op]} : il faut un nombre, pas ${text(bad)}` };
    }
    // une sorte encore inconnue : moins, fois, divisé par… rendent toujours un nombre (ou échouent) ; « plus » peut aussi
    // rendre un texte ou une liste. Jamais « ? » à partir de ⊥ : ce n'est pas l'exécution qui le dira, c'est un tour de plus
    if (!bothNum) {
        const n = a?.k === "nombre" ? strip(a) : b?.k === "nombre" ? strip(b) : null;
        if (n) return { sort: n };
        if (op !== "add") return { sort: NOMBRE };
        return { sort: a?.k === "?" || b?.k === "?" ? DYN : BOT };
    }
    return { sort: arith(op, a, b), err: unitError(op, a, b) };
}
const WORD = { add: "plus", sub: "moins", mul: "fois", div: "divisé par", mod: "modulo", pow: "puissance" };
const strip = (s) => nombre({ unite: s.unite });

function unitError(op, a, b) {
    if ((op === "add" || op === "sub") && a.unite && b.unite && a.unite !== b.unite)
        return `${op === "add" ? "additionner" : "soustraire"} ${unitText(a)} et ${unitText(b)} n'a pas de sens`;
    return null;
}

/** Les bornes et l'unité d'un calcul sur deux nombres (une arithmétique d'intervalles). */
function arith(op, a, b) {
    const lo = (s) => s.min ?? -Infinity, hi = (s) => s.max ?? Infinity;
    const unite = op === "add" || op === "sub" || op === "mod" ? a.unite || b.unite
        : op === "mul" ? [a.unite, b.unite].filter(Boolean).join("·") || null
        : op === "div" ? (a.unite && a.unite === b.unite ? null : a.unite && b.unite ? `${a.unite}/${b.unite}` : a.unite || (b.unite ? `1/${b.unite}` : null))
        : a.unite;
    const entier = a.entier && b.entier && op !== "div" && op !== "pow";
    let min = null, max = null;
    if (op === "add") { min = lo(a) + lo(b); max = hi(a) + hi(b); }
    else if (op === "sub") { min = lo(a) - hi(b); max = hi(a) - lo(b); }
    else if (op === "mul" && [lo(a), hi(a), lo(b), hi(b)].every(Number.isFinite)) {
        const p = [lo(a) * lo(b), lo(a) * hi(b), hi(a) * lo(b), hi(a) * hi(b)];
        min = Math.min(...p); max = Math.max(...p);
    } else if (op === "mod" && lo(b) > 0 && Number.isFinite(hi(b)) && lo(a) >= 0) { min = 0; max = hi(b) - (entier ? 1 : 0); }
    const fin = (x) => (Number.isFinite(x) ? x : null);
    return nombre({ unite, entier, min: fin(min), max: fin(max) });
}

/** La sorte d'une fonction du français (« la moyenne de », « la racine de »…) : { sort, err }. */
export function builtin(fn, s) {
    const el = s?.k === "liste" ? s.de : s?.k === "texte" ? TEXTE : null;
    const numsErr = () => {
        if (definite(s) && s.k !== "liste") return `${FN[fn]} : il faut une liste, pas ${text(s)}`;
        if (el && definite(el) && el.k !== "nombre") return `${FN[fn]} : il faut des nombres, pas ${text(el, true)}`;
        return null;
    };
    const elNum = el?.k === "nombre" ? el : NOMBRE;
    switch (fn) {
        case "sum": return { sort: nombre({ unite: elNum.unite, entier: elNum.entier }), err: numsErr() };
        case "mean": return { sort: nombre({ unite: elNum.unite, min: elNum.min, max: elNum.max }), err: numsErr() };
        case "max": case "min": return { sort: el?.k === "nombre" ? el : NOMBRE, err: numsErr() };
        case "len": return { sort: nombre({ entier: true, min: 0 }) };
        case "count": return { sort: nombre({ entier: true, min: 0 }) };
        case "sqrt": case "abs": case "round": {
            const err = definite(s) && s.k !== "nombre" ? `${FN[fn]} : il faut un nombre, pas ${text(s)}` : null;
            const n = s?.k === "nombre" ? s : NOMBRE;
            return { sort: fn === "round" ? nombre({ unite: n.unite, entier: true }) : fn === "abs" ? nombre({ unite: n.unite, entier: n.entier, min: 0 }) : nombre({ min: 0 }), err };
        }
        case "first": case "last": return { sort: el ?? (definite(s) ? TOP : DYN), err: definite(s) && !el ? `${FN[fn]} : il faut une liste, pas ${text(s)}` : null };
        case "sorted": case "reversed": return { sort: s?.k === "texte" ? liste(TEXTE) : s || DYN };
    }
    return { sort: DYN };
}
const FN = { sum: "la somme", mean: "la moyenne", max: "le maximum", min: "le minimum", sqrt: "la racine", abs: "la valeur absolue", round: "l'arrondi", first: "le premier", last: "le dernier" };

/** Un test (« pair », « positif », « vide ») : { err } si la sorte ne s'y prête pas. */
export function test(t, s) {
    if (t === "empty" || !definite(s) || s.k === "nombre") return {};
    return { err: `« ${{ even: "pair", odd: "impair", positive: "positif", negative: "négatif" }[t]} » : il faut un nombre, pas ${text(s)}` };
}

// ---------------------------------------------------------------- les étiquettes

/**
 * L'étiquette d'une sorte, dans une règle apprise (learn.js) : sa structure et son unité, sans ses bornes — un seul
 * exemple ne dit rien des bornes. « nombre », « nombre:€ », « liste:nombre », « fiche:compte_bancaire » ; "" si la
 * sorte n'est pas sûre (l'emplacement accepte alors toute donnée).
 */
export function tag(s) {
    if (!definite(s)) return "";
    switch (s.k) {
        case "nombre": return s.unite ? `nombre:${s.unite}` : "nombre";
        case "liste": { const t = tag(s.de); return t ? `liste:${t}` : "liste"; }
        case "fiche": return `fiche:${s.cls}`;
        case "action": return "action";
        default: return s.k;
    }
}
/** La sorte d'une étiquette. */
export function fromTag(t) {
    const parts = String(t || "").split(":");
    const read = (k) => {
        const w = parts[k];
        if (w === "nombre") return nombre({ unite: parts[k + 1] || null });
        if (w === "liste") return liste(k + 1 < parts.length ? read(k + 1) : TOP);
        if (w === "fiche") return fiche(parts[k + 1]);
        if (w === "texte") return TEXTE;
        if (w === "booléen") return BOOL;
        return TOP;
    };
    return t ? read(0) : TOP;
}

// ---------------------------------------------------------------- en français

const label = (n) => String(n).replace(/_/g, " ");

/** Une sorte, comme on la dit : « une liste de nombres (€) », « une fiche élève », « un entier entre 0 et 100 ». */
export function text(s, plural = false) {
    if (!s) return plural ? "rien" : "aucune valeur encore";
    switch (s.k) {
        case "⊥": return plural ? "rien" : "aucune valeur encore";
        case "?": return "connue à l'exécution";
        case "⊤": return plural ? "des valeurs de plusieurs sortes" : "une valeur de plusieurs sortes";
        case "texte": return plural ? "des textes" : "un texte";
        case "booléen": return plural ? "des vrai ou faux" : "vrai ou faux";
        case "nombre": {
            const w = s.entier ? (s.min != null && s.min >= 0 && s.max == null ? "entier naturel" : "entier") : "nombre";
            let out = plural ? `des ${w.replace(/^(\S+)/, "$1s").replace("entiers naturel", "entiers naturels")}` : `un ${w}`;
            if (s.unite) out += ` (${s.unite})`;
            if (s.min != null && s.max != null && s.min < s.max) out += ` entre ${fmt(s.min)} et ${fmt(s.max)}`;
            return out;
        }
        case "liste": {
            if (s.de?.k === "⊥") return plural ? "des listes vides" : "une liste vide";
            const of = text(s.de, true).replace(/^des /, "").replace(/^un /, "");
            return `${plural ? "des listes" : "une liste"} ${/^[aeiouyéèêh]/i.test(of) ? "d'" : "de "}${of}`;
        }
        case "fiche": return s.table ? `${plural ? "des lignes" : "une ligne"} du tableau ${label(s.cls)}` : plural ? `des fiches ${label(s.cls)}` : `une fiche ${label(s.cls)}`;
        case "action": return plural ? "des actions" : "une action";
    }
    return "une valeur";
}
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e4) / 1e4).replace(".", ","));

// paraphrase.js — ce que la machine a compris d'une phrase, redit en français canonique : l'inverse de la lecture.
// Une seule forme par sens, la portée visible ([ … ] autour de ce que commande un « si », un « tant que », une action),
// les calculs en symboles (× ÷ ≠ ≥), les données par leur nom. Lire cette phrase suffit à voir une lecture fausse :
// « s'il est pair, on le divise » devenu « si solde est pair : [ solde ← solde ÷ 2 ] » se voit tout de suite.

const label = (n) => String(n).replace(/_/g, " ");
const OPS = { add: "+", sub: "−", mul: "×", div: "÷", mod: "mod", pow: "^", concat: "&", eq: "=", ne: "≠", gt: ">", lt: "<", ge: "≥", le: "≤", contains: "contient", and: "et", or: "ou" };
const PREC = { or: 1, and: 2, eq: 3, ne: 3, gt: 3, lt: 3, ge: 3, le: 3, contains: 3, add: 4, sub: 4, concat: 4, mul: 5, div: 5, mod: 5, pow: 6 };
const FN = { sum: "la somme de", mean: "la moyenne de", max: "le maximum de", min: "le minimum de", len: "la longueur de", count: "le nombre de", sqrt: "la racine de",
    abs: "la valeur absolue de", round: "l'arrondi de", first: "le premier de", last: "le dernier de", sorted: "trié :", reversed: "à l'envers :" };
const TEST = { even: "est pair", odd: "est impair", empty: "est vide", positive: "est positif", negative: "est négatif" };

function num(e) {
    const v = e.pct ? `${String(Math.round(e.value * 1e6) / 1e4).replace(".", ",")} %` : Number.isInteger(e.value) ? String(e.value) : String(Math.round(e.value * 1e6) / 1e6).replace(".", ",");
    return e.unit ? `${v} ${e.unit}` : v;
}

/** Une expression ; outer : la priorité de ce qui l'entoure (des parenthèses si elle est plus faible). */
export function sayExpr(e, outer = 0) {
    if (!e) return "?";
    const wrap = (s, p) => (p < outer ? `(${s})` : s);
    switch (e.type) {
        case "num": return num(e);
        case "str": return `«${e.value}»`;
        case "bool": return e.value ? "vrai" : "faux";
        case "lit": return String(e.value);
        case "name": return label(e.name);
        case "list": return `[${e.items.map((x) => sayExpr(x)).join(" ; ")}]`;
        case "range": return `les entiers de ${sayExpr(e.from, 7)} à ${sayExpr(e.to, 7)}`;
        case "neg": return `−${sayExpr(e.expr, 7)}`;
        case "not": return `non ${sayExpr(e.expr, 7)}`;
        case "test": return wrap(`${sayExpr(e.expr, 4)} ${TEST[e.test] || e.test}`, 3);
        case "builtin": return `${FN[e.fn] || e.fn} ${sayExpr(e.arg, 7)}`;
        case "call": return `${label(e.name)}(${e.args.map((x) => sayExpr(x)).join(", ")})`;
        case "new": return `un ${label(e.cls)}${e.fields.length ? ` (${e.fields.map((f) => `${label(f.name)} : ${sayExpr(f.expr)}`).join(" ; ")})` : ""}`;
        case "field": return `${label(e.field)} de ${sayExpr(e.obj, 7)}`;
        case "table": return `le tableau ${label(e.name)}`;
        case "where": {
            const cond = e.op.startsWith("test:") ? TEST[e.op.slice(5)] : `${OPS[e.op] || e.op} ${sayExpr(e.rhs, 4)}`;
            return wrap(`${sayExpr(e.list, 7)} ${e.field ? `dont ${label(e.field)}` : "qui"} ${cond}`, 2);
        }
        case "isa": return wrap(`${sayExpr(e.expr, 4)} ${e.neg ? "n'est pas" : "est"} un ${label(e.cls)}`, 3);
        case "bin": {
            // « A et B » après « vaut » : une énumération, [] + A + B (parse.js) — redite comme une liste mise bout à bout
            const parts = [];
            for (let x = e; x?.type === "bin" && x.op === "add"; x = x.left) { parts.unshift(x.right); if (x.left?.type === "list" && !x.left.items.length) return `[${parts.map((p) => sayExpr(p)).join(" ⧺ ")}]`; }
            const p = PREC[e.op] ?? 4;
            return wrap(`${sayExpr(e.left, p)} ${OPS[e.op] || e.op} ${sayExpr(e.right, p + 1)}`, p);
        }
    }
    return e.type;
}

const target = (t) => (t.type === "field" ? `${label(t.field)} de ${sayExpr(t.obj, 7)}` : label(t.name));
const block = (s) => `[ ${say(s)} ]`;

// « de le tableau », « de les entiers » : du, des
const contract = (t) => t.replace(/\bde le /g, "du ").replace(/\bde les /g, "des ").replace(/\bà le /g, "au ").replace(/\bà les /g, "aux ");

/** Une phrase lue : ce qu'elle fait, en français canonique. */
export function paraphrase(ast) { return contract(say(ast)); }

function say(s) {
    if (!s) return "";
    switch (s.type) {
        case "seq": return s.list.map(say).join(" ; ");
        case "show": return `afficher ${s.exprs.map((x) => sayExpr(x)).join(", ")}`;
        case "assign": return `${target(s.target)} ← ${sayExpr(s.expr)}`;
        case "add": return `ajouter ${sayExpr(s.expr, 4)} à ${target(s.target)}`;
        case "remove": return `retirer ${sayExpr(s.expr, 4)} de ${target(s.target)}`;
        case "class": return `${s.art || "un"} ${label(s.name)}${s.parent ? ` (une sorte de ${label(s.parent.name)})` : ""} a : ${s.fields.map((f) => `${label(f.name)}${f.default ? ` = ${sayExpr(f.default)}` : ""}`).join(", ") || "rien de plus"}`;
        case "if": return `si ${sayExpr(s.cond)} : ${block(s.then)}${s.else ? ` sinon : ${block(s.else)}` : ""}`;
        case "while": return `tant que ${sayExpr(s.cond)} : ${block(s.body)}`;
        case "repeat": return `${sayExpr(s.count, 7)} fois : ${block(s.body)}`;
        case "foreach": return `pour chaque ${label(s.var)} de ${sayExpr(s.list, 7)} : ${block(s.body)}`;
        case "define": return `action ${label(s.name)}(${s.params.map(label).join(", ")}) : ${block(s.body)}`;
        case "return": return `renvoyer ${sayExpr(s.expr)}`;
        case "expr": return sayExpr(s.expr);
    }
    return s.type;
}

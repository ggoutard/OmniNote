// nombres.js — l'arithmétique exacte des preuves : rationnels (BigInt) et polynômes à plusieurs variables.
//
// Rien n'est approché : une preuve ne peut pas reposer sur un flottant. Les polynômes servent à « développer et
// réduire » (deux expressions sont égales si leur différence se réduit à 0) ; une somme ∑ ou un produit ∏ dont les
// bornes ne sont pas des nombres y entre comme une variable opaque, un « atome » (voir atom) : la machine ne sait
// d'elle que ce qu'on lui en dit — sauf la formule de Faulhaber (sumClosed), qu'utilise la décision d'un énoncé seul.

// ---------------------------------------------------------------- rationnels

const babs = (a) => (a < 0n ? -a : a);
export function gcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }
export const lcm = (a, b) => (a && b ? babs(a / gcd(a, b) * b) : 0n);

export function Q(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (d === 0n) throw new Undefined("division par zéro");
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    return { n: n / g, d: d / g };
}
export const ZERO = Q(0), ONE = Q(1);
export const qadd = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qsub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
export const qmul = (a, b) => Q(a.n * b.n, a.d * b.d);
export const qdiv = (a, b) => Q(a.n * b.d, a.d * b.n);
export const qneg = (a) => ({ n: -a.n, d: a.d });
export const qsign = (a) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
export const qcmp = (a, b) => qsign(qsub(a, b));
export const qint = (a) => a.d === 1n;
export const qabs = (a) => ({ n: babs(a.n), d: a.d });
export function qpow(a, e) { let r = ONE; for (let i = 0; i < e; i++) r = qmul(r, a); return r; }
/** Le texte d'un rationnel, à la française : 3, −2, 5/2. */
export const qtext = (a) => (a.d === 1n ? String(a.n) : `${a.n}/${a.d}`).replace("-", "−");
/** « 2,5 », « 12 » : le nombre écrit, exact. */
export function qparse(s) {
    const [i, f = ""] = s.replace(",", ".").split(".");
    return Q(BigInt(i + f), 10n ** BigInt(f.length));
}
/** La partie entière inférieure (pour les bornes). */
export const qfloor = (a) => (a.n >= 0n ? a.n / a.d : -((-a.n + a.d - 1n) / a.d));

export class Undefined extends Error {}

// ---------------------------------------------------------------- polynômes
// Un polynôme : Map clé du monôme → { m: [[variable, exposant], …] (trié), c: rationnel }. Le monôme vide : la constante.

const mkey = (m) => m.map(([v, e]) => (e === 1 ? v : `${v}^${e}`)).join("·");
function mmul(a, b) {
    const out = new Map(a);
    for (const [v, e] of b) out.set(v, (out.get(v) || 0) + e);
    return [...out].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}
function put(p, m, c) {
    if (!c.n) return;
    const k = mkey(m), old = p.get(k);
    if (!old) { p.set(k, { m, c }); return; }
    const s = qadd(old.c, c);
    if (s.n) p.set(k, { m, c: s }); else p.delete(k);
}

export const pconst = (r) => { const p = new Map(); put(p, [], typeof r === "object" ? r : Q(r)); return p; };
export const pvar = (v) => new Map([[v, { m: [[v, 1]], c: ONE }]]);
export function padd(a, b) { const p = new Map(a); for (const t of b.values()) put(p, t.m, t.c); return p; }
export function pneg(a) { const p = new Map(); for (const t of a.values()) put(p, t.m, qneg(t.c)); return p; }
export const psub = (a, b) => padd(a, pneg(b));
export function pscale(a, r) { const p = new Map(); for (const t of a.values()) put(p, t.m, qmul(t.c, r)); return p; }
export function pmul(a, b) {
    const p = new Map();
    for (const x of a.values()) for (const y of b.values()) put(p, mmul(x.m, y.m), qmul(x.c, y.c));
    return p;
}
export function ppow(a, e) { let r = pconst(1); for (let i = 0; i < e; i++) r = pmul(r, a); return r; }
export const pzero = (a) => a.size === 0;
/** La constante d'un polynôme constant, sinon null. */
export function pconstOf(a) { if (!a.size) return ZERO; if (a.size === 1 && a.has("")) return a.get("").c; return null; }
export function pvars(a) { const s = new Set(); for (const t of a.values()) for (const [v] of t.m) s.add(v); return s; }
export function pdeg(a, v) { let d = 0; for (const t of a.values()) for (const [w, e] of t.m) if (w === v) d = Math.max(d, e); return d; }
/** Les coefficients selon v : un tableau de polynômes (en les autres variables), indicé par le degré. */
export function pcoeffs(a, v) {
    const out = [];
    for (const t of a.values()) {
        const e = t.m.find(([w]) => w === v)?.[1] || 0;
        (out[e] ??= new Map());
        put(out[e], t.m.filter(([w]) => w !== v), t.c);
    }
    for (let i = 0; i < out.length; i++) out[i] ??= new Map();
    return out;
}
/** Remplacer la variable v par le polynôme q. */
export function psubst(a, v, q) {
    if (!pvars(a).has(v)) return a;
    let p = new Map();
    const pows = [pconst(1)];
    for (const t of a.values()) {
        const e = t.m.find(([w]) => w === v)?.[1] || 0;
        while (pows.length <= e) pows.push(pmul(pows.at(-1), q));
        const rest = new Map(); put(rest, t.m.filter(([w]) => w !== v), t.c);
        p = padd(p, pmul(rest, pows[e]));
    }
    return p;
}
/** La valeur, toutes les variables connues (env : Map nom → rationnel ; atomValue pour les atomes ∑, ∏). */
export function peval(a, env, atomValue) {
    let s = ZERO;
    for (const t of a.values()) {
        let x = t.c;
        for (const [v, e] of t.m) {
            let val = env.get(v);
            if (val === undefined && isAtom(v)) val = atomValue(v, env);
            if (val === undefined) throw new Undefined(`« ${v} » n'a pas de valeur`);
            x = qmul(x, qpow(val, e));
        }
        s = qadd(s, x);
    }
    return s;
}
/** Le plus petit commun multiple des dénominateurs des coefficients. */
export function pdenom(a) { let d = 1n; for (const t of a.values()) d = lcm(d, t.c.d); return d; }
/** Une clé canonique (deux polynômes égaux ont la même). */
export const pkey = (a) => [...a.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([k, t]) => `${qtext(t.c)}*${k}`).join("+");

/** Pour un polynôme en une variable v : une borne au-delà de laquelle il ne s'annule plus et garde son signe
 *  (borne de Cauchy : 1 + max |aᵢ / aₙ|). null si ce n'est pas un polynôme en v seul. */
export function cauchy(a, v) {
    const vs = pvars(a);
    if ([...vs].some((w) => w !== v)) return null;
    const cs = pcoeffs(a, v).map((c) => pconstOf(c) ?? ZERO);
    const lead = cs.at(-1);
    if (!cs.length || !lead.n) return 0n;
    let m = ZERO;
    for (const c of cs.slice(0, -1)) { const r = qabs(qdiv(c, lead)); if (qcmp(r, m) > 0) m = r; }
    return 1n + qfloor(m) + 1n;
}
/** Le signe d'un polynôme en v pour v → +∞ (side 1) ou −∞ (side −1). */
export function tailSign(a, v, side) {
    const cs = pcoeffs(a, v);
    const d = cs.length - 1;
    if (d < 0) return 0;
    const lead = pconstOf(cs[d]);
    if (!lead) return null;
    return qsign(lead) * (side < 0 && d % 2 ? -1 : 1);
}

// ---------------------------------------------------------------- texte

const SUP = { 2: "²", 3: "³" };
const vtext = (v) => (isAtom(v) ? atomText(v) : v);
/** Le polynôme écrit lisiblement : n² + 3 × n − 1/2. */
export function ptext(a) {
    if (!a.size) return "0";
    const terms = [...a.values()].sort((x, y) => degOf(y.m) - degOf(x.m) || (mkey(x.m) < mkey(y.m) ? -1 : 1));
    return terms.map((t, i) => {
        const neg = t.c.n < 0n, c = qabs(t.c);
        const mono = t.m.map(([v, e]) => vtext(v) + (e === 1 ? "" : SUP[e] || `^${e}`)).join(" × ");
        const coef = !mono ? qtext(c) : c.n === 1n && c.d === 1n ? "" : `${qtext(c)} × `;
        return `${i ? (neg ? " − " : " + ") : neg ? "−" : ""}${coef}${mono}`;
    }).join("");
}
const degOf = (m) => m.reduce((s, [, e]) => s + e, 0);

// ---------------------------------------------------------------- atomes : ∑ et ∏ à bornes non numériques
// Un atome est une variable « §3 » : ATOMS la relie à { kind: "sum" | "prod", f (polynôme en « _k »), a, b }.

const ATOMS = new Map(), BY_KEY = new Map();
export const isAtom = (v) => v.startsWith("§");
export function atom(kind, f, a, b) {
    const key = `${kind}|${pkey(f)}|${pkey(a)}|${pkey(b)}`;
    let name = BY_KEY.get(key);
    if (!name) { name = `§${ATOMS.size + 1}`; ATOMS.set(name, { kind, f, a, b, key }); BY_KEY.set(key, name); }
    return name;
}
export const atomInfo = (v) => ATOMS.get(v);
export function atomText(v) {
    const x = ATOMS.get(v);
    if (!x) return v;
    if (x.kind.startsWith("call:")) { const [, name, n] = x.kind.split(":"); return `${name.replace(/_/g, " ")}(${[x.f, x.a, x.b].slice(0, +n).map(ptext).join(", ")})`; }
    const f = ptext(psubst(x.f, "_k", pvar("k")));
    return `${x.kind === "sum" ? "∑" : "∏"}(k = ${ptext(x.a)} … ${ptext(x.b)}) ${/[ +−]/.test(f) ? `(${f})` : f}`;
}

// ---------------------------------------------------------------- formule de Faulhaber

const POWERS = [];
/** Sⱼ(x) = 0ʲ + 1ʲ + … + xʲ, un polynôme en « _x » de degré j + 1 (par interpolation de Lagrange, exacte). */
function powerSum(j) {
    if (POWERS[j]) return POWERS[j];
    const pts = [];
    let acc = ZERO;
    for (let x = 0; x <= j + 1; x++) { acc = qadd(acc, qpow(Q(x), j)); pts.push(acc); }
    let p = new Map();
    for (let i = 0; i < pts.length; i++) {
        let term = pconst(pts[i]);
        for (let m = 0; m < pts.length; m++) if (m !== i) term = pscale(pmul(term, psub(pvar("_x"), pconst(m))), Q(1, i - m));
        p = padd(p, term);
    }
    return (POWERS[j] = p);
}
/** ∑ f(k) pour k de a à b, en polynôme — exact dès que b ≥ a − 1 (f : polynôme en « _k »). */
export function sumClosed(f, a, b) {
    let F = new Map();
    pcoeffs(f, "_k").forEach((c, j) => { if (c.size) F = padd(F, pmul(c, powerSum(j))); });
    return psub(psubst(F, "_x", b), psubst(F, "_x", psub(a, pconst(1))));
}

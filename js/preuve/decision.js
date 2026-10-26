// decision.js — décider si un énoncé est vrai : le démontrer, ou trouver un contre-exemple.
//
// Les arbres de lecture.js :
//   expressions  { t: "num", v } { t: "var", name } { t: "add" | "sub" | "mul" | "div", a, b } { t: "neg", a } { t: "pow", a, e }
//                { t: "big", kind: "sum" | "prod", k: "_k", f, a, b }      (∑ / ∏ de f pour _k de a à b)
//   énoncés      { t: "cmp", op, a, b } { t: "dvd", m, a } (m divise a) { t: "prime", a } { t: "square", a }
//                { t: "not", p } { t: "and" | "or", ps } { t: "imp" | "iff", p, q } { t: "bool", v }
//                { t: "all" | "ex", vars: [{ name, dom }], lo, hi, cond, body }      (dom : "Z", "N", "R")
//
// Ce qui est démontré, et comment (aucun flottant, aucun hasard dans une preuve) :
//   · un calcul, une identité : la différence des deux côtés se développe et se réduit à 0 (polynômes exacts) ;
//   · un domaine fini : tous les cas, un par un ;
//   · une seule variable entière : au-delà d'une borne B (de Cauchy), chaque comparaison de polynômes garde la même
//     valeur et chaque divisibilité ne dépend que du reste modulo L ; vérifier exactement tous les entiers jusqu'à
//     B + L (des deux côtés) suffit donc — c'est une démonstration complète, que la machine dit en clair ;
//   · des divisibilités à plusieurs variables : un polynôme à coefficients entiers modulo m ne dépend que des restes
//     des variables : tous les restes sont vérifiés ;
//   · une inégalité dont tous les coefficients sont positifs, les variables étant positives.
// Sinon : la recherche d'un contre-exemple (exacte), et à défaut « non tranché » — jamais « vrai » sans preuve.

import { Q, ZERO, ONE, qadd, qsub, qmul, qdiv, qneg, qsign, qint, qcmp, qpow, qtext, lcm, Undefined,
    pconst, pvar, padd, psub, pmul, pneg, pscale, ppow, pzero, pconstOf, pvars, pdeg, pcoeffs, psubst, peval, pdenom, pkey,
    cauchy, tailSign, ptext, atom, atomInfo, isAtom, sumClosed } from "./nombres.js";
import { etext, ftext, fold } from "./lecture.js";

class NonPoly extends Error {}
export class Unknown extends Error {}

const LIMIT = 40000;          // au plus tant d'évaluations exactes pour une démonstration
const LOOP = 20000;           // au plus tant de termes calculés un par un dans une somme

// ---------------------------------------------------------------- les actions du document
// « compter les diviseurs de n » : une action définie par une phrase (Grama Lectica). Dans un énoncé, c'est un atome,
// opaque pour le calcul littéral ; on sait l'exécuter (pour chercher un contre-exemple) et l'on connaît ses bornes,
// déduites de sa définition par le juge des sortes (gramalectica/sens.js) : « un entier entre 0 et 100 ».
let ACTIONS = new Map();   // nom → { arity, call(nombres) → nombre, min, max, entier, why }
export function setActions(m) { ACTIONS = new Map([...(m || [])].map(([n, a]) => [fold(n), { ...a, label: n }])); }
const isCall = (w) => isAtom(w) && atomInfo(w).kind.startsWith("call:");
const NOARG = new Map();
/** Une action définie par une formule : son corps, chaque valeur #k remplacée par l'argument k (une définition se déplie). */
function unfold(a, args) {
    const sub = (x) => (x.t === "var" && /^#\d+$/.test(x.name) ? args[+x.name.slice(1)] : x.t === "num" ? { t: "num", v: Q(x.v.n, x.v.d) } : { ...x, ...(x.a ? { a: sub(x.a) } : {}), ...(x.b ? { b: sub(x.b) } : {}) });
    return sub(a.formula);
}
function callPoly(name, args) {
    const a = ACTIONS.get(name);
    if (a?.formula) return toPoly(unfold(a, args));
    const ps = args.map(toPoly);
    return pvar(atom(`call:${name}:${ps.length}`, ps[0] ?? NOARG, ps[1] ?? NOARG, ps[2] ?? NOARG));
}
function runAction(name, vals) {
    const a = ACTIONS.get(name);
    if (!a) throw new Unknown(`« ${name} » n'est pas une action du document`);
    let v;
    try { v = a.call(vals.map((q) => Number(q.n) / Number(q.d))); } catch (e) { throw new Unknown(`${name} : ${e?.message || e}`); }
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Undefined(`${name} ne rend pas un nombre`);
    return Number.isInteger(v) ? Q(v) : Q(Math.round(v * 1e6), 1e6);
}

// ---------------------------------------------------------------- expressions → polynômes

/** Le polynôme d'une expression (les ∑ et ∏ à bornes non numériques : des atomes). NonPoly : une division par
 *  une expression qui dépend d'une variable, un exposant non entier. */
export function toPoly(e) {
    switch (e.t) {
        case "num": return pconst(e.v);
        case "var": return pvar(e.name);
        case "add": return padd(toPoly(e.a), toPoly(e.b));
        case "sub": return psub(toPoly(e.a), toPoly(e.b));
        case "mul": return pmul(toPoly(e.a), toPoly(e.b));
        case "neg": return pneg(toPoly(e.a));
        case "div": {
            const b = pconstOf(toPoly(e.b));
            if (!b) throw new NonPoly("division par une expression variable");
            if (!b.n) throw new Undefined("division par zéro");
            return pscale(toPoly(e.a), qdiv(ONE, b));
        }
        case "pow": return ppow(toPoly(e.a), e.e);
        case "big": return bigPoly(e.kind, toPoly(e.f), toPoly(e.a), toPoly(e.b));
        case "call": return callPoly(e.name, e.args);
        default: throw new NonPoly(e.t);
    }
}
/** ∑ ou ∏ : calculé si les bornes sont des nombres, un atome sinon. */
function bigPoly(kind, f, a, b) {
    const ca = pconstOf(a), cb = pconstOf(b);
    if (ca && cb) {
        if (!qint(ca) || !qint(cb)) throw new Undefined("les bornes d'une somme sont des entiers");
        if (kind === "sum") return cb.n < ca.n ? new Map() : sumClosed(f, a, b);
        if (cb.n - ca.n > 2000n) throw new NonPoly("produit trop long");
        let p = pconst(1);
        for (let i = ca.n; i <= cb.n; i++) p = pmul(p, psubst(f, "_k", pconst(Q(i))));
        return p;
    }
    if (kind === "prod" || [...pvars(f)].some(isAtom)) return pvar(atom(kind, f, a, b));
    // une somme est linéaire : ∑ (2k − 1) = 2 ∑ k − ∑ 1 ; les coefficients (sans k) sortent, il reste des ∑ kʲ
    let out = new Map();
    pcoeffs(f, "_k").forEach((c, j) => { if (c.size) out = padd(out, pmul(c, pvar(atom("sum", j ? ppow(pvar("_k"), j) : pconst(1), a, b)))); });
    return out;
}
/** Remplacer v par q, aussi dans les bornes et le terme des atomes (une somme jusqu'à n, avec n = 0, est calculée). */
export function subst(p, v, q) {
    let out = psubst(p, v, q);
    for (const w of pvars(out)) {
        if (!isAtom(w)) continue;
        const x = atomInfo(w);
        if (![x.f, x.a, x.b].some((y) => pvars(y).has(v))) continue;
        if (x.kind.startsWith("call:")) { out = psubst(out, w, pvar(atom(x.kind, subst(x.f, v, q), subst(x.a, v, q), subst(x.b, v, q)))); continue; }
        const z = bigPoly(x.kind, subst(x.f, v, q), subst(x.a, v, q), subst(x.b, v, q));
        out = psubst(out, w, z);
    }
    return out;
}

// ---------------------------------------------------------------- valeurs exactes

export function atomValue(w, env) {
    const x = atomInfo(w);
    if (x.kind.startsWith("call:")) {
        const [, name, n] = x.kind.split(":");
        return runAction(name, [x.f, x.a, x.b].slice(0, +n).map((p) => peval(p, env, atomValue)));
    }
    const a = peval(x.a, env, atomValue), b = peval(x.b, env, atomValue);
    if (!qint(a) || !qint(b)) throw new Undefined("les bornes d'une somme sont des entiers");
    if (x.kind === "sum") {
        if (b.n < a.n) return ZERO;
        if (b.n - a.n > BigInt(LOOP)) return peval(sumClosed(x.f, pconst(a), pconst(b)), env, atomValue);
        let s = ZERO;
        const e = new Map(env);
        for (let i = a.n; i <= b.n; i++) { e.set("_k", Q(i)); s = qadd(s, peval(x.f, e, atomValue)); }
        return s;
    }
    if (b.n - a.n > 3000n) throw new Unknown("produit trop long à calculer");
    let s = ONE;
    const e = new Map(env);
    for (let i = a.n; i <= b.n; i++) { e.set("_k", Q(i)); s = qmul(s, peval(x.f, e, atomValue)); }
    return s;
}
/** La valeur exacte d'une expression (aussi quand ce n'est pas un polynôme : 1/n, la somme des inverses). */
export function evalExpr(e, env) {
    switch (e.t) {
        case "num": return e.v;
        case "var": { const v = env.get(e.name); if (v === undefined) throw new Undefined(`« ${e.name} » n'a pas de valeur`); return v; }
        case "add": return qadd(evalExpr(e.a, env), evalExpr(e.b, env));
        case "sub": return qsub(evalExpr(e.a, env), evalExpr(e.b, env));
        case "mul": return qmul(evalExpr(e.a, env), evalExpr(e.b, env));
        case "div": { const b = evalExpr(e.b, env); if (!b.n) throw new Undefined("division par zéro"); return qdiv(evalExpr(e.a, env), b); }
        case "neg": return qneg(evalExpr(e.a, env));
        case "pow": return qpow(evalExpr(e.a, env), e.e);
        case "call": { const a = ACTIONS.get(e.name); return a?.formula ? evalExpr(unfold(a, e.args), env) : runAction(e.name, e.args.map((x) => evalExpr(x, env))); }
        case "big": {
            const a = evalExpr(e.a, env), b = evalExpr(e.b, env);
            if (!qint(a) || !qint(b)) throw new Undefined("les bornes d'une somme sont des entiers");
            if (b.n - a.n > BigInt(LOOP)) {
                try { return peval(toPoly(e), env, atomValue); } catch { throw new Unknown("somme trop longue à calculer"); }
            }
            let s = e.kind === "sum" ? ZERO : ONE;
            const en = new Map(env);
            for (let i = a.n; i <= b.n; i++) { en.set("_k", Q(i)); const f = evalExpr(e.f, en); s = e.kind === "sum" ? qadd(s, f) : qmul(s, f); }
            return s;
        }
        default: throw new Undefined(e.t);
    }
}

// ---------------------------------------------------------------- énoncés → formes polynomiales (pf)
// Chaque comparaison garde ses deux côtés (pour calculer, et pour dire un contre-exemple) et, quand c'en est un,
// le polynôme d = gauche − droite ; chaque divisibilité, ses polynômes m et q.

const poly = (e) => { try { return toPoly(e); } catch (x) { if (x instanceof NonPoly) return null; throw x; } };
export function toPF(f) {
    switch (f.t) {
        case "cmp": { const a = poly(f.a), b = poly(f.b); return { t: "cmp", op: f.op, src: f, d: a && b ? psub(a, b) : null }; }
        case "dvd": return { t: "dvd", src: f, m: poly(f.m), q: poly(f.a) };
        case "prime": case "square": return { t: f.t, src: f, q: poly(f.a) };
        case "not": return { t: "not", p: toPF(f.p) };
        case "and": case "or": return { t: f.t, ps: f.ps.map(toPF) };
        case "imp": case "iff": return { t: f.t, p: toPF(f.p), q: toPF(f.q) };
        case "bool": return f;
        case "all": case "ex": return { t: f.t, vars: f.vars, lo: f.lo && poly(f.lo), hi: f.hi && poly(f.hi), cond: f.cond && toPF(f.cond), body: toPF(f.body), src: f };
        default: throw new Undefined(f.t);
    }
}
/** Le même énoncé, chaque polynôme transformé par fn (une substitution). */
function mapPF(p, fn) {
    switch (p.t) {
        case "cmp": return { ...p, d: p.d && fn(p.d), src: p.src };
        case "dvd": return { ...p, m: p.m && fn(p.m), q: p.q && fn(p.q) };
        case "prime": case "square": return { ...p, q: p.q && fn(p.q) };
        case "not": return { t: "not", p: mapPF(p.p, fn) };
        case "and": case "or": return { t: p.t, ps: p.ps.map((x) => mapPF(x, fn)) };
        case "imp": case "iff": return { t: p.t, p: mapPF(p.p, fn), q: mapPF(p.q, fn) };
        default: return p;   // bool ; les quantificateurs (bornés) se calculent tels quels
    }
}
function atomsOf(p, out = []) {
    switch (p.t) {
        case "cmp": case "dvd": case "prime": case "square": out.push(p); break;
        case "not": atomsOf(p.p, out); break;
        case "and": case "or": p.ps.forEach((x) => atomsOf(x, out)); break;
        case "imp": case "iff": atomsOf(p.p, out); atomsOf(p.q, out); break;
        case "all": case "ex": out.push(p); break;
    }
    return out;
}
const polysOf = (p) => atomsOf(p).flatMap((a) => [a.d, a.m, a.q]).filter(Boolean);
function varsOf(p) { const s = new Set(); for (const q of polysOf(p)) for (const v of pvars(q)) if (!isAtom(v)) s.add(v); else atomVars(v, s); return s; }
function atomVars(w, s) { const x = atomInfo(w); for (const q of [x.a, x.b, x.f]) for (const v of pvars(q)) if (v !== "_k") (isAtom(v) ? atomVars(v, s) : s.add(v)); }

// ---------------------------------------------------------------- évaluer exactement

function val(p, env) { return peval(p, env, atomValue); }
function isPrime(n) {
    if (n < 2n) return { prime: false };
    for (const p of [2n, 3n, 5n, 7n, 11n, 13n]) if (n % p === 0n) return n === p ? { prime: true } : { prime: false, factor: p };
    for (let d = 17n; d * d <= n && d < 1000000n; d += 2n) if (n % d === 0n) return { prime: false, factor: d };
    if (n < 1000000n * 1000000n) return { prime: true };
    // Miller-Rabin, déterministe pour n < 3,3·10²⁴
    const pw = (b, e, m) => { let r = 1n; b %= m; while (e) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
    let d = n - 1n, s = 0;
    while (!(d & 1n)) { d >>= 1n; s++; }
    for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n]) {
        let x = pw(a, d, n);
        if (x === 1n || x === n - 1n) continue;
        let ok = false;
        for (let r = 1; r < s; r++) { x = x * x % n; if (x === n - 1n) { ok = true; break; } }
        if (!ok) return { prime: false };
    }
    return { prime: true };
}
function isqrt(n) { if (n < 2n) return n; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x; }

/** Vrai ou faux, exactement, pour ces valeurs des variables. */
export function evalPF(p, env) {
    switch (p.t) {
        case "cmp": {
            const s = p.d ? qsign(val(p.d, env)) : qcmp(evalExpr(p.src.a, env), evalExpr(p.src.b, env));
            return { "=": s === 0, "!=": s !== 0, "<": s < 0, "<=": s <= 0, ">": s > 0, ">=": s >= 0 }[p.op];
        }
        case "dvd": {
            const m = p.m ? val(p.m, env) : evalExpr(p.src.m, env), q = p.q ? val(p.q, env) : evalExpr(p.src.a, env);
            if (!qint(q) || !qint(m)) return false;
            if (!m.n) return !q.n;
            return q.n % m.n === 0n;
        }
        case "prime": { const q = p.q ? val(p.q, env) : evalExpr(p.src.a, env); return qint(q) && isPrime(q.n).prime; }
        case "square": { const q = p.q ? val(p.q, env) : evalExpr(p.src.a, env); if (!qint(q) || q.n < 0n) return false; const r = isqrt(q.n); return r * r === q.n; }
        case "not": return !evalPF(p.p, env);
        case "and": return p.ps.every((x) => evalPF(x, env));
        case "or": return p.ps.some((x) => evalPF(x, env));
        case "imp": return !evalPF(p.p, env) || evalPF(p.q, env);
        case "iff": return evalPF(p.p, env) === evalPF(p.q, env);
        case "bool": return p.v;
        case "all": case "ex": {
            const ranges = p.vars.map((v) => range(p, v, env));
            if (ranges.some((r) => !r)) throw new Unknown("un « pour tout » sans borne ne se calcule pas");
            let count = 0;
            const e = new Map(env);
            const walk = (i) => {
                if (i === p.vars.length) {
                    if (++count > LIMIT) throw new Unknown("trop de cas");
                    if (p.cond && !evalPF(p.cond, e)) return p.t === "all";
                    return evalPF(p.body, e);
                }
                for (let n = ranges[i][0]; n <= ranges[i][1]; n++) {
                    e.set(p.vars[i].name, Q(n));
                    const r = walk(i + 1);
                    if (p.t === "all" && !r) return false;
                    if (p.t === "ex" && r) return true;
                }
                return p.t === "all";
            };
            return walk(0);
        }
    }
    throw new Undefined(p.t);
}
function range(p, v, env) {
    if (!p.lo || !p.hi) return null;
    const lo = val(p.lo, env), hi = val(p.hi, env);
    let a = lo.n / lo.d + (qcmp(lo, Q(lo.n / lo.d)) > 0 ? 1n : 0n), b = hi.n / hi.d;
    if (hi.n < 0n && !qint(hi)) b -= 1n;
    if (v.dom === "N" && a < 0n) a = 0n;
    return [a, b];
}
const safeEval = (p, env) => { try { return evalPF(p, env); } catch (e) { if (e instanceof Undefined) return null; throw e; } };

// ---------------------------------------------------------------- une variable entière : démonstration complète

/** Pour tout entier v du domaine (lo, hi : bornes entières ou null), p ? → { ok, how | counter } ou null (non tranché). */
export function decideOne(p, v, lo = null, hi = null) {
    const atoms = atomsOf(p);
    if (atoms.some((a) => a.t === "all" || a.t === "ex" || a.t === "prime" || a.t === "square")) return null;
    let C = 0n, L = 1n;
    const sides = [hi == null ? 1 : 0, lo == null ? -1 : 0].filter(Boolean);
    for (const side of sides) {
        for (const a of atoms) {
            const ps = a.t === "cmp" ? [a.d] : [a.m, a.q];
            if (ps.some((x) => !x)) return null;
            const tails = [];
            for (const q of ps) {
                const t = tail(q, v, side);
                if (!t) return null;
                C = C > t.T ? C : t.T;
                tails.push(t.p);
            }
            if (a.t === "cmp") { const b = cauchy(tails[0], v); if (b == null) return null; if (b > C) C = b; }
            else {
                const m = pconstOf(tails[0]);
                if (!m || !qint(m)) return null;
                if (!m.n) { const b = cauchy(tails[1], v); if (b == null) return null; if (b > C) C = b; continue; }
                L = lcm(L, (m.n < 0n ? -m.n : m.n) * pdenom(tails[1]));
                if (L > 5000n) return null;
            }
        }
    }
    // les entiers à vérifier : |v| ≤ C, puis une période de L de chaque côté (dans les bornes)
    const LO = lo != null ? BigInt(lo) : null, HI = hi != null ? BigInt(hi) : null;
    const clip = ([x, y]) => [LO != null && LO > x ? LO : x, HI != null && HI < y ? HI : y];
    const segs = [clip([-C, C])];
    const up = LO != null && LO > C + 1n ? LO : C + 1n, down = HI != null && HI < -C - 1n ? HI : -C - 1n;
    segs.push(clip([up, up + L - 1n]), clip([down - L + 1n, down]));
    const ranges = segs.filter(([x, y]) => x <= y).sort((p, q) => (p[0] < q[0] ? -1 : 1));
    const merged = [];
    for (const r of ranges) { const m = merged.at(-1); if (m && r[0] <= m[1] + 1n) { if (r[1] > m[1]) m[1] = r[1]; } else merged.push([...r]); }
    const total = merged.reduce((s, [x, y]) => s + (y - x + 1n), 0n);
    if (total > BigInt(LIMIT)) return null;
    const env = new Map();
    for (const [x, y] of merged) for (let n = x; n <= y; n++) {
        env.set(v, Q(n));
        const r = safeEval(p, env);
        if (r === false) return { ok: false, counter: new Map([[v, Q(n)]]) };
        if (r === null) return null;
    }
    const a = merged[0]?.[0] ?? 0n, b = merged.at(-1)?.[1] ?? 0n;
    const cases = Number(total);
    let how;
    const z = (x) => String(x).replace("-", "−");
    if (lo != null && hi != null && merged.length === 1 && a === LO && b === HI) how = `les ${cases} cas, de ${v} = ${z(a)} à ${z(b)}, un par un`;
    else if (merged.length > 1) how = `au-delà de |${v}| = ${C}, tout ne dépend que du reste de ${v} modulo ${L} : ${cases} entiers bien choisis suffisent, vérifiés un par un`;
    else if (L === 1n) how = `au-delà de |${v}| = ${C}, plus rien ne change de signe : les ${cases} entiers de ${z(a)} à ${z(b)} suffisent, vérifiés un par un`;
    else how = `au-delà de |${v}| = ${C}, tout ne dépend que du reste de ${v} modulo ${L} : les ${cases} entiers de ${z(a)} à ${z(b)} suffisent, vérifiés un par un`;
    return { ok: true, how, cases };
}
/** Le polynôme pour v → ±∞ : chaque ∑ remplacé par sa forme close (Faulhaber) — T : à partir d'où c'est exact. */
function tail(q, v, side) {
    let p = q, T = 0n;
    for (let guard = 0; guard < 8; guard++) {
        const w = [...pvars(p)].find(isAtom);
        if (!w) break;
        const x = atomInfo(w);
        if (x.kind !== "sum" || [...pvars(x.f)].some(isAtom) || [...pvars(x.a), ...pvars(x.b)].some(isAtom)) return null;
        const len = padd(psub(x.b, x.a), pconst(1));
        const c = pconstOf(len);
        let sign;
        if (c) sign = qsign(c) >= 0 ? 1 : -1;
        else {
            sign = tailSign(len, v, side);
            const b = cauchy(len, v);
            if (sign == null || b == null) return null;
            if (b > T) T = b;
        }
        p = psubst(p, w, sign >= 0 ? sumClosed(x.f, x.a, x.b) : new Map());
    }
    if ([...pvars(p)].some((w) => w !== v)) return null;
    return { p, T };
}

// ---------------------------------------------------------------- plusieurs variables

/** Des divisibilités (et des égalités qui se réduisent) : tous les restes modulo L. */
function decidePeriodic(p, vars) {
    let L = 1n;
    for (const a of atomsOf(p)) {
        if (a.t === "cmp") { if (!a.d || pconstOf(a.d) == null) return null; continue; }
        if (a.t !== "dvd" || !a.m || !a.q || [...pvars(a.q)].some(isAtom)) return null;
        const m = pconstOf(a.m);
        if (!m || !qint(m) || !m.n) return null;
        L = lcm(L, (m.n < 0n ? -m.n : m.n) * pdenom(a.q));
    }
    const total = Number(L) ** vars.length;
    if (!vars.length || total > LIMIT) return null;
    const env = new Map(), idx = vars.map(() => 0n);
    for (let c = 0; c < total; c++) {
        vars.forEach((v, i) => env.set(v, Q(idx[i])));
        const r = safeEval(p, env);
        if (r === false) return { ok: false, counter: new Map(env) };
        if (r === null) return null;
        for (let i = 0; i < idx.length; i++) { if (++idx[i] < L) break; idx[i] = 0n; }
    }
    return { ok: true, how: `${vars.length > 1 ? `tous les restes de ${vars.join(", ")}` : `tous les restes de ${vars[0]}`} modulo ${L} (${total} cas)` };
}
/** d ≥ 0 (ou > 0) quand chaque variable x a une borne basse c : en posant x = c + y, tous les coefficients sont positifs. */
function positive(d, lows, strict) {
    let q = d;
    for (const v of pvars(d)) {
        const c = lows.get(v);
        if (c == null) return false;
        q = psubst(q, v, padd(pvar(v), pconst(c)));
    }
    for (const t of q.values()) if (qsign(t.c) < 0) return false;
    if (strict) { const c = q.get("")?.c; return !!c && qsign(c) > 0; }
    return true;
}

// ---------------------------------------------------------------- un énoncé seul

/**
 * Décider un énoncé fermé (ses lettres libres : « pour tout entier », via free).
 * → { status: "proved" | "false" | "unknown", how, counter: { env, text } }
 */
export function decide(f, free = new Map()) {
    try { return decideInner(f, free); }
    catch (e) {
        if (e instanceof Undefined) return { status: "false", how: `calcul impossible : ${e.message}` };
        if (e instanceof Unknown || e instanceof RangeError) return { status: "unknown", how: e.message };
        throw e;
    }
}
function decideInner(f, free) {
    // les « pour tout » en tête : des variables libres, leurs conditions en hypothèses
    const vars = [...free].map(([name, dom]) => ({ name, dom }));
    const hyps = [], bounds = new Map();
    while (f.t === "all") {
        for (const v of f.vars) vars.push(v);
        if (f.lo && f.hi && f.vars.length === 1) bounds.set(f.vars[0].name, [f.lo, f.hi]);
        else if (f.lo && f.hi) for (const v of f.vars) bounds.set(v.name, [f.lo, f.hi]);
        if (f.cond) hyps.push(f.cond);
        f = f.body;
    }
    if (f.t === "imp") { hyps.push(f.p); f = f.q; }
    const body = hyps.length ? { t: "imp", p: hyps.length > 1 ? { t: "and", ps: hyps } : hyps[0], q: f } : f;
    const pf = toPF(body);
    const names = vars.map((v) => v.name);
    const lohi = (v) => {
        const b = bounds.get(v.name);
        let lo = v.dom === "N" ? 0n : null, hi = null;
        if (b) {
            const a = pconstOf(poly(b[0]) || new Map([["?", 0]])), c = pconstOf(poly(b[1]) || new Map([["?", 0]]));
            if (a && c) { lo = a.n / a.d; hi = c.n / c.d; if (v.dom === "N" && lo < 0n) lo = 0n; }
        }
        return [lo, hi];
    };
    // aucune variable : un calcul
    if (!vars.length) {
        if (f.t === "ex") return existential(f, new Map());
        const r = evalPF(pf, new Map());
        return r ? { status: "proved", how: "calcul" } : { status: "false", how: "calcul", counter: { env: new Map(), text: explain(body, new Map()) } };
    }
    if (f.t === "ex" && !hyps.length) {
        // pour tout n, il existe m… : vérifié sur quelques n, non démontré
        return checkSome(pf, vars, body, "non démontré : un « il existe » sous un « pour tout »");
    }
    // une action du document dans l'énoncé : ses bornes (sa sorte) démontrent ; sinon on l'exécute pour chercher un
    // contre-exemple — les procédures sur les polynômes (Cauchy, périodes, identités) ne s'appliquent pas à elle
    if (polysOf(pf).some((p) => [...pvars(p)].some(isCall))) {
        const r = byBounds(pf);
        if (r) return r;
        if (vars.every((v) => lohi(v)[1] != null)) {
            const x = exhaustive(pf, vars, lohi);
            if (x) return x.ok ? { status: "proved", how: x.how } : { status: "false", how: "cas par cas", counter: { env: x.counter, text: explain(body, x.counter) } };
        }
        return checkSome(pf, vars, body, "non démontré : l'action est exécutée, pas démontrée", lohi);
    }
    // un domaine fini
    if (vars.every((v) => lohi(v)[1] != null)) {
        const r = exhaustive(pf, vars, lohi);
        if (r) return r.ok ? { status: "proved", how: r.how } : { status: "false", how: "cas par cas", counter: { env: r.counter, text: explain(body, r.counter) } };
        if (vars.length > 1) return checkSome(pf, vars, body, "trop de cas pour les vérifier tous", lohi);
    }
    // une variable entière : la démonstration complète
    if (vars.length === 1 && vars[0].dom !== "R") {
        const [lo, hi] = lohi(vars[0]);
        const r = decideOne(pf, vars[0].name, lo, hi);
        if (r) return r.ok ? { status: "proved", how: r.how } : { status: "false", how: "contre-exemple", counter: { env: r.counter, text: explain(body, r.counter) } };
    }
    // une identité : les deux côtés se développent pareil (vraie pour tous les nombres, entiers ou réels)
    if (pf.t === "cmp" && pf.op === "=" && pf.d && pzero(pf.d) && ![...pvars(pf.d)].some(isAtom)) return { status: "proved", how: "identité : les deux côtés se développent et se réduisent pareil" };
    if (vars.every((v) => v.dom !== "R")) {
        const r = decidePeriodic(pf, names);
        if (r) return r.ok ? { status: "proved", how: r.how } : { status: "false", how: "contre-exemple", counter: { env: r.counter, text: explain(body, r.counter) } };
    }
    if (pf.t === "cmp" && pf.d && /[<>]/.test(pf.op)) {
        const lows = new Map(vars.filter((v) => v.dom === "N").map((v) => [v.name, Q(0)]));
        const d = pf.op[0] === ">" ? pf.d : pneg(pf.d);
        if (positive(d, lows, pf.op.length === 1)) return { status: "proved", how: "tous les coefficients sont positifs, les variables aussi" };
    }
    return checkSome(pf, vars, body, "non démontré", lohi);
}
/**
 * Démontrer par les bornes des actions : une comparaison c₀ + Σ cᵢ·actionᵢ(…) ⋚ 0 où chaque action est bornée (sa sorte)
 * et n'apparaît qu'au premier degré ; vraie sur tout l'intervalle, elle est vraie pour toutes les valeurs des variables.
 */
function byBounds(pf) {
    if (pf.t !== "cmp" || !pf.d || pf.op === "=" || pf.op === "≠") return null;
    let lo = ZERO, hi = ZERO, loInf = false, hiInf = false;
    const used = [];
    for (const t of pf.d.values()) {
        if (!t.m.length) { lo = qadd(lo, t.c); hi = qadd(hi, t.c); continue; }
        if (t.m.length !== 1 || t.m[0][1] !== 1 || !isCall(t.m[0][0])) return null;
        const name = atomInfo(t.m[0][0]).kind.split(":")[1], a = ACTIONS.get(name);
        if (!a) return null;
        used.push(a);
        const [mn, mx] = qsign(t.c) > 0 ? [a.min, a.max] : [a.max, a.min];
        if (mn == null) loInf = true; else lo = qadd(lo, qmul(t.c, Q(Math.round(mn * 1e6), 1e6)));
        if (mx == null) hiInf = true; else hi = qadd(hi, qmul(t.c, Q(Math.round(mx * 1e6), 1e6)));
    }
    const ok = { ">": !loInf && qsign(lo) > 0, "≥": !loInf && qsign(lo) >= 0, ">=": !loInf && qsign(lo) >= 0, "<": !hiInf && qsign(hi) < 0, "≤": !hiInf && qsign(hi) <= 0, "<=": !hiInf && qsign(hi) <= 0 }[pf.op];
    if (!ok) return null;
    return { status: "proved", how: `par la sorte de ${[...new Set(used.map((a) => `« ${a.label} » : ${a.why}`))].join(" ; ")}, déduite de sa définition` };
}
function exhaustive(pf, vars, lohi) {
    const rs = vars.map(lohi);
    const total = rs.reduce((s, [a, b]) => s * Number(b - a + 1n), 1);
    if (total > LIMIT) return null;
    const env = new Map(), idx = rs.map(([a]) => a);
    for (let c = 0; c < total; c++) {
        vars.forEach((v, i) => env.set(v.name, Q(idx[i])));
        const r = safeEval(pf, env);
        if (r === false) return { ok: false, counter: new Map(env) };
        if (r === null) return null;
        for (let i = 0; i < idx.length; i++) { if (++idx[i] <= rs[i][1]) break; idx[i] = rs[i][0]; }
    }
    return { ok: true, how: total === 1 ? "calcul" : `les ${total} cas, un par un` };
}
function existential(f, env) {
    const ex = toPF(f);
    const v = f.vars[0];
    const lo = f.lo ? evalExpr(f.lo, env) : null, hi = f.hi ? evalExpr(f.hi, env) : null;
    const e = new Map(env);
    const tryN = (n) => { e.set(v.name, Q(n)); for (const w of f.vars.slice(1)) e.set(w.name, Q(0)); return (!ex.cond || safeEval(ex.cond, e)) && safeEval(ex.body, e); };
    if (f.vars.length > 1) {
        // plusieurs témoins : une recherche dans un carré
        const r = searchBox(ex.body, f.vars, 30, true);
        return r ? { status: "proved", how: `témoin : ${envText(r)}` } : { status: "unknown", how: "aucun témoin trouvé dans [−30, 30]" };
    }
    if (lo && hi) {
        for (let n = lo.n / lo.d; n <= hi.n / hi.d; n++) if (tryN(n)) return { status: "proved", how: `témoin : ${v.name} = ${n}` };
        return { status: "false", how: `aucun ${v.name} de ${qtext(lo)} à ${qtext(hi)} ne convient (tous essayés)` };
    }
    for (let k = 0n; k <= 5000n; k++) {
        if (tryN(k)) return { status: "proved", how: `témoin : ${v.name} = ${k}` };
        if (k && v.dom !== "N" && tryN(-k)) return { status: "proved", how: `témoin : ${v.name} = ${-k}` };
    }
    // aucun dans [−5000, 5000] : peut-être aucun du tout (la négation, démontrée)
    const neg = decideOne({ t: "not", p: ex.cond ? { t: "and", ps: [ex.cond, ex.body] } : ex.body }, v.name, v.dom === "N" ? 0n : null, null);
    if (neg?.ok) return { status: "false", how: `aucun entier ne convient (${neg.how})` };
    return { status: "unknown", how: "aucun témoin trouvé de −5000 à 5000" };
}
/** Non démontré : chercher un contre-exemple ; à défaut, dire sur quoi c'est vérifié. */
function checkSome(pf, vars, body, why, lohi) {
    // (une somme qui n'est pas un polynôme, 1/k : chaque cas coûte une boucle — moins de cas)
    const slow = atomsOf(pf).some((a) => (a.t === "cmp" && !a.d) || ((a.t === "dvd" || a.t === "prime") && !a.q));
    const span = (vars.length === 1 ? 300 : vars.length === 2 ? 40 : 12) / (slow ? 5 : 1);
    const r = searchBox(pf, vars, span, false, lohi);
    if (r) return { status: "false", how: "contre-exemple", counter: { env: r, text: explain(body, r) } };
    const real = vars.some((v) => v.dom === "R");
    const lo = lohi ? lohi(vars[0])[0] : null;
    const from = lo != null ? lo : vars.every((v) => v.dom === "N") ? 0 : -span;
    return { status: "unknown", how: `${why} — vrai pour ${real ? "les entiers " : ""}${vars.map((v) => v.name).join(", ")} de ${String(from).replace("-", "−")} à ${lohi && lohi(vars[0])[1] != null && lohi(vars[0])[1] < BigInt(span) ? lohi(vars[0])[1] : span}${real ? " (les réels : non démontré)" : ""}` };
}
/** Une recherche exacte dans un pavé : want = true cherche un cas vrai, false un cas faux. */
function searchBox(pf, vars, span, want, lohi) {
    const env = new Map();
    const lo = (v) => { const b = lohi?.(v)[0]; return b != null ? Number(b) : v.dom === "N" ? 0 : -span; };
    const hi = (v) => { const b = lohi?.(v)[1]; return b != null ? Number(b) : Infinity; };
    const order = (v) => {
        const out = [], a = lo(v), z = hi(v);
        if (a > 0) { for (let k = a; k <= Math.min(z, a + 2 * span); k++) out.push(k); return out; }
        for (let k = 0; k <= span; k++) { if (k >= a && k <= z) out.push(k); if (k && -k >= a && -k <= z) out.push(-k); }
        return out;
    };
    const lists = vars.map(order);
    let count = 0;
    const walk = (i) => {
        if (i === vars.length) {
            if (++count > LIMIT) throw new RangeError("stop");
            const r = safeEval(pf, env);
            return r === want;
        }
        for (const n of lists[i]) { env.set(vars[i].name, Q(n)); if (walk(i + 1)) return true; }
        return false;
    };
    try { return walk(0) ? new Map(env) : null; } catch (e) { if (e instanceof RangeError || e instanceof Unknown) return null; throw e; }
}
export const envText = (env) => [...env].filter(([k]) => k !== "_k").map(([k, v]) => `${k} = ${qtext(v)}`).join(", ");

/** Pourquoi c'est faux, pour ces valeurs : « n = 40 : n² + n + 41 = 1681 = 41 × 41 ». */
export function explain(f, env) {
    const head = envText(env);
    const show = (e) => { try { return qtext(evalExpr(e, env)); } catch { return "?"; } };
    const leaf = (g) => {
        if (g.t === "imp") return safeEval(toPF(g.p), env) ? leaf(g.q) : null;
        if (g.t === "and") { for (const x of g.ps) if (safeEval(toPF(x), env) === false) return leaf(x); return null; }
        return g;
    };
    const g = leaf(f) || f;
    let why = "";
    if (g.t === "cmp") {
        const a = show(g.a), b = show(g.b);
        why = g.a.t === "num" ? `${etext(g.b)} vaut ${b}` : g.b.t === "num" ? `${etext(g.a)} vaut ${a}` : `${etext(g.a)} vaut ${a}, ${etext(g.b)} vaut ${b}`;
    } else if (g.t === "dvd") why = `${etext(g.a)} vaut ${show(g.a)}`;
    else if (g.t === "not" && g.p.t === "dvd") why = `${etext(g.p.a)} vaut ${show(g.p.a)}`;
    else if (g.t === "prime") {
        try { const v = evalExpr(g.a, env); const r = qint(v) ? isPrime(v.n) : {}; why = `${etext(g.a)} vaut ${qtext(v)}${r.factor ? ` = ${r.factor} × ${v.n / r.factor}` : ""}`; } catch { /* rien */ }
    }
    return why ? `${head} : ${why}` : head;
}

// ---------------------------------------------------------------- découle de… (les pas d'une preuve)

/**
 * Les faits (des énoncés) entraînent-ils l'énoncé ? Les égalités servent à remplacer (une hypothèse de récurrence
 * remplace la somme jusqu'à n, « n = 2k » remplace n), une somme jusqu'à n + 1 se défait en somme jusqu'à n plus
 * son dernier terme ; le reste : les décisions ci-dessus. Dans une preuve, la machine calcule et développe — elle
 * ne connaît pas les formules qu'on démontre (pas de Faulhaber ici).
 * ctx : { vars: Map nom → domaine (dans l'ordre d'introduction), facts: [énoncés] }
 * → { ok: true, how } | { ok: false, counter } | { ok: null, why }
 */
export function entails(ctx, claim) {
    try { return entailsInner(ctx, claim); }
    catch (e) {
        if (e instanceof Undefined) return { ok: false, why: `calcul impossible : ${e.message}` };
        if (e instanceof Unknown || e instanceof RangeError) return { ok: null, why: e.message };
        throw e;
    }
}
function entailsInner(ctx, claim) {
    const order = [...ctx.vars.keys()];
    const lows = new Map();
    for (const [v, d] of ctx.vars) if (d === "N") lows.set(v, Q(0));
    const facts = ctx.facts.map(toPF);
    let goal = toPF(claim);
    // les règles : une égalité « pivot = … » (un atome, sinon la variable introduite la première)
    const rules = [];
    const others = [];
    for (const f of facts) {
        const r = f.t === "cmp" && f.op === "=" && f.d ? rule(f.d, order) : null;
        if (r) rules.push(r); else others.push(f);
    }
    const apply = (p) => {
        for (let round = 0; round < 6; round++) {
            let q = p;
            for (const r of rules) q = subst(q, r.v, r.by);
            q = peel(q, lows, rules);
            if (pkey(q) === pkey(p)) return q;
            p = q;
        }
        return p;
    };
    // les règles se simplifient entre elles (dans l'ordre), puis tout le reste
    for (let i = 0; i < rules.length; i++) for (let j = 0; j < i; j++) rules[i].by = subst(rules[i].by, rules[j].v, rules[j].by);
    const hyps = others.map((f) => mapPF(f, apply));
    // les bornes basses connues : n ≥ 1, n > 0 (pour défaire une somme, et pour les inégalités)
    for (const h of hyps) {
        if (h.t !== "cmp" || !h.d || !/^>=?$|^<=?$/.test(h.op)) continue;
        const d = h.op[0] === ">" ? h.d : pneg(h.d);
        const vs = [...pvars(d)];
        if (vs.length !== 1 || pdeg(d, vs[0]) !== 1) continue;
        const [c0, c1] = pcoeffs(d, vs[0]).map((c) => pconstOf(c) || ZERO);
        if (qsign(c1) <= 0) continue;
        let low = qdiv(qneg(c0), c1);
        if (h.op.length === 1) low = qadd(low, Q(1, low.d));   // n > c : n ≥ c + 1 (entiers)
        if (!lows.has(vs[0]) || qcmp(low, lows.get(vs[0])) > 0) lows.set(vs[0], low);
    }
    goal = mapPF(goal, apply);
    // des hypothèses contradictoires : tout en découle
    if (hyps.some((h) => safeEvalConst(h) === false) || rules.some(() => false)) return { ok: true, how: "les hypothèses se contredisent" };
    if (goal.t === "bool" && !goal.v) {
        const r = contradiction(hyps, rules, order, lows);
        if (r) return r;
    }
    const c = safeEvalConst(goal);
    if (c === true) return { ok: true, how: "calcul" };
    if (c === false && !hyps.length) return { ok: false, counter: null, why: "le calcul ne donne pas cela" };
    if (goal.t === "cmp" && goal.op === "=" && goal.d && pzero(goal.d)) return { ok: true, how: "calcul" };
    // l'énoncé, sous les hypothèses qui portent sur ses variables
    const gv = varsOf(goal);
    const rel = hyps.filter((h) => [...varsOf(h)].every((v) => gv.has(v)));
    const whole = rel.length ? { t: "imp", p: rel.length > 1 ? { t: "and", ps: rel } : rel[0], q: goal } : goal;
    const vs = [...varsOf(whole)];
    const opaque = polysOf(whole).some((p) => [...pvars(p)].some(isAtom));
    if (!opaque) {
        if (vs.length === 1 && ctx.vars.get(vs[0]) !== "R") {
            const lo = lows.get(vs[0]);
            const r = decideOne(whole, vs[0], lo && qint(lo) ? lo.n : null, null);
            if (r?.ok) return { ok: true, how: r.how };
        }
        if (vs.length && vs.every((v) => ctx.vars.get(v) !== "R")) {
            const r = decidePeriodic(whole, vs);
            if (r?.ok) return { ok: true, how: r.how };
        }
    }
    if (goal.t === "cmp" && goal.d && /[<>]/.test(goal.op)) {
        const d = goal.op[0] === ">" ? goal.d : pneg(goal.d);
        if (positive(d, lows, goal.op.length === 1)) return { ok: true, how: "coefficients positifs" };
    }
    if (goal.t === "cmp" && goal.op === "!=" && goal.d) {
        const c0 = pconstOf(goal.d);
        if (c0 && c0.n) return { ok: true, how: "calcul" };
        if (positive(goal.d, lows, true) || positive(pneg(goal.d), lows, true)) return { ok: true, how: "coefficients positifs" };
    }
    // non démontré : un contre-exemple des faits d'origine ?
    const counter = findCounter(ctx, claim);
    if (counter) return { ok: false, counter };
    return { ok: null, why: "la machine ne voit pas pourquoi" };
}
function safeEvalConst(p) {
    if (varsOf(p).size || polysOf(p).some((q) => [...pvars(q)].some(isAtom))) return null;
    try { return evalPF(p, new Map()); } catch { return null; }
}
function contradiction(hyps, rules, order, lows) {
    const all = hyps.length > 1 ? { t: "and", ps: hyps } : hyps[0];
    if (!all) return null;
    const vs = [...varsOf(all)];
    if (vs.length === 1) {
        const lo = lows.get(vs[0]);
        const r = decideOne({ t: "not", p: all }, vs[0], lo && qint(lo) ? lo.n : null, null);
        if (r?.ok) return { ok: true, how: `les hypothèses se contredisent (${r.how})` };
    }
    if (vs.length) {
        const r = decidePeriodic({ t: "not", p: all }, vs);
        if (r?.ok) return { ok: true, how: `les hypothèses se contredisent (${r.how})` };
    }
    void rules; void order;
    return null;
}
function rule(d, order) {
    const vs = [...pvars(d)];
    const linear = (v) => pdeg(d, v) === 1 && pconstOf(pcoeffs(d, v)[1]) && [...pvars(pcoeffs(d, v)[0])].every((w) => w !== v);
    const atoms = vs.filter((v) => isAtom(v) && linear(v)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    const plain = vs.filter((v) => !isAtom(v) && linear(v)).sort((a, b) => idx(order, a) - idx(order, b));
    const v = atoms[0] || plain[0];
    if (!v) return null;
    const [rest, c] = pcoeffs(d, v);
    // d = c·v + rest = 0 → v = −rest / c
    return { v, by: pscale(rest, qneg(qdiv(ONE, pconstOf(c)))) };
}
const idx = (order, v) => { const i = order.indexOf(v); return i < 0 ? 1e9 : i; };
/** Défaire ∑(a … b + c) en ∑(a … b) + ses c derniers termes, quand b + 1 ≥ a est sûr. */
function peel(p, lows, rules) {
    let q = p;
    for (const w of [...pvars(p)]) {
        if (!isAtom(w)) continue;
        const x = atomInfo(w);
        if (x.kind.startsWith("call:")) continue;
        // ∑ 1 pour k de a à b : b − a + 1 termes (quand b ≥ a − 1)
        if (x.kind === "sum" && pconstOf(x.f)) {
            const len = padd(psub(x.b, x.a), pconst(1));
            if (positive(len, lows, false)) { q = psubst(q, w, pscale(len, pconstOf(x.f))); continue; }
        }
        const c = x.b.get("")?.c || ZERO;
        if (!c.n || !qint(c)) continue;
        const b0 = psub(x.b, pconst(c));
        if (pconstOf(b0)) continue;
        // la condition : b0 + 1 ≥ a (et pour c < 0 : b0 + c + 1 ≥ a)
        const need = psub(padd(b0, pconst(c.n < 0n ? qadd(c, ONE) : ONE)), x.a);
        if (!positive(need, lows, false)) continue;
        const base = pvar(atom(x.kind, x.f, x.a, b0));
        const terms = [];
        const [from, to] = c.n > 0n ? [1n, c.n] : [c.n + 1n, 0n];
        for (let i = from; i <= to; i++) terms.push(subst(x.f, "_k", padd(b0, pconst(Q(i)))));
        let by;
        if (x.kind === "sum") { const s = terms.reduce(padd, new Map()); by = c.n > 0n ? padd(base, s) : psub(base, s); }
        else { if (c.n < 0n) continue; by = terms.reduce(pmul, base); }
        q = psubst(q, w, by);
    }
    void rules;
    return q;
}
/** Un cas où tous les faits sont vrais et l'énoncé faux (exact, dans un petit pavé). */
function findCounter(ctx, claim) {
    const vars = [...ctx.vars].map(([name, dom]) => ({ name, dom }));
    if (!vars.length || vars.some((v) => v.dom === "R")) return null;
    const used = new Set([...varsOf(toPF(claim)), ...ctx.facts.flatMap((f) => [...varsOf(toPF(f))])]);
    const vs = vars.filter((v) => used.has(v.name));
    if (!vs.length) return null;
    const pf = toPF(ctx.facts.length ? { t: "imp", p: { t: "and", ps: ctx.facts }, q: claim } : claim);
    const env = searchBox(pf, vs, vs.length === 1 ? 200 : vs.length === 2 ? 30 : 8, false);
    return env ? { env, text: explain(claim, env) } : null;
}

// ---------------------------------------------------------------- remplacer dans un énoncé

/** L'énoncé, la variable name remplacée par l'expression e (pour P(n + 1), et pour appliquer un théorème). */
export function substF(f, name, e) {
    const sx = (x) => substE(x, name, e);
    switch (f.t) {
        case "cmp": return { ...f, a: sx(f.a), b: sx(f.b) };
        case "dvd": return { ...f, m: sx(f.m), a: sx(f.a) };
        case "prime": case "square": return { ...f, a: sx(f.a) };
        case "not": return { ...f, p: substF(f.p, name, e) };
        case "and": case "or": return { ...f, ps: f.ps.map((x) => substF(x, name, e)) };
        case "imp": case "iff": return { ...f, p: substF(f.p, name, e), q: substF(f.q, name, e) };
        case "all": case "ex":
            if (f.vars.some((v) => v.name === name)) return f;
            return { ...f, lo: f.lo && sx(f.lo), hi: f.hi && sx(f.hi), cond: f.cond && substF(f.cond, name, e), body: substF(f.body, name, e) };
        default: return f;
    }
}
export function substE(x, name, e) {
    if (!x) return x;
    if (x.t === "var") return x.name === name ? e : x;
    if (x.t === "num") return x;
    if (x.t === "call") return { ...x, args: x.args.map((a) => substE(a, name, e)) };
    const out = { ...x };
    for (const k of ["a", "b", "f"]) if (x[k]) out[k] = substE(x[k], name, e);
    return out;
}
export { ftext, ptext, pvars, varsOf };

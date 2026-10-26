// lecture.js — lire le français mathématique : du texte à une formule de la logique du premier ordre.
//
// Un fragment du français, à lecture unique (comme les phrases de Grama Lectica) : chaque énoncé se traduit en une
// seule formule, ou il est refusé, l'endroit en cause souligné. C'est ce qui permet d'en faire une preuve : une
// phrase sans ambiguïté a un sens exact (Montague), et ce sens se vérifie.
//
//   expressions   2n + 1, n × (n + 1) / 2, n², (n+1)(n+2), le carré de n, la moitié de n, n!, $\frac{n(n+1)}{2}$,
//                 la somme des entiers de 1 à n, la somme des carrés de 1 à n, la somme de 2k − 1 pour k de 1 à n,
//                 le produit des entiers de 1 à n, la somme jusqu'à n + 1 (la dernière somme nommée, autre borne)
//   énoncés       A vaut B, A = B, A ≠ B, A < B, A est au moins B, A est (strictement) positif, A est pair,
//                 A est impair, A est divisible par 3, 3 divise A, A est un multiple de 5, A est premier,
//                 A est un carré parfait, A est un entier ; n'est pas…, et, ou, si … alors …, … si et seulement si …
//   quantificateurs  pour tout entier (naturel) n, …   pour tous entiers a et b, …   pour tout entier n ≥ 1, …
//                 pour chaque entier n de 1 à 100, …   il existe un entier k tel que …   quel que soit l'entier n, …
//
// Le résultat : des arbres (voir l'en-tête de decision.js pour leur forme), chaque nœud avec sa place (at, end).

import { Q, qparse, qint, pconstOf } from "./nombres.js";

export class Unclear extends Error {
    constructor(msg, at = 0, end = at) { super(msg); this.at = at; this.end = end; }
}

export const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------------------------------------------------------------- mots

const SUPERSCRIPT = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const SYMBOLS = { "×": "*", "·": "*", "⋅": "*", "∙": "*", "÷": "/", "−": "-", "–": "-", "≤": "<=", "⩽": "<=", "≥": ">=", "⩾": ">=",
    "≠": "!=", "∣": "|", "∈": "in", "ℕ": "N", "ℤ": "Z", "ℝ": "R" };
const TEX = { times: "*", cdot: "*", leq: "<=", le: "<=", geq: ">=", ge: ">=", neq: "!=", ne: "!=", mid: "|", in: "in",
    frac: "frac", dfrac: "frac", tfrac: "frac", sum: "sum", prod: "prod", mathbb: "", left: "", right: "", ldots: "", dots: "", cdots: "" };
// des mots composés : leurs traits d'union ne sont pas des « moins »
const COMPOUND = /c'est-à-dire|celle-ci|celui-ci|ceux-ci|celles-ci|peut-être|lui-même|elle-même|ci-dessus|ci-dessous|au-delà|vis-à-vis/giu;

/** Le texte en mots : { k: "num" | "word" | "sym", v (la forme pliée pour un mot), raw, at, end }. */
export function tokens(text) {
    text = text.replace(/[’ʼ]/g, "'").replace(COMPOUND, (m) => m.replace(/-/g, " "));
    const out = [];
    const re = /(\d+(?:[.,]\d+)?)|([\p{L}][\p{L}\p{Nd}]*'?)|\\([a-zA-Z]+|[,;! ])|([⁰¹²³⁴⁵⁶⁷⁸⁹]+)|(<=|>=|!=|==|\*\*|[-+*/^()=<>{}|!,;:.∑∏_]|[×·⋅∙÷−–≤⩽≥⩾≠∣∈ℕℤℝ])/gu;
    let m;
    while ((m = re.exec(text))) {
        const at = m.index, end = at + m[0].length;
        if (m[1]) out.push({ k: "num", v: qparse(m[1]), raw: m[1], at, end });
        else if (m[2]) {
            const ap = /^([cldjnmst]|qu|lorsqu|puisqu|jusqu)'(.*)$/iu.exec(m[2]);
            if (ap) {
                const cut = at + ap[1].length + 1;
                out.push({ k: "word", v: fold(ap[1]) + "'", raw: ap[1] + "'", at, end: cut });
                if (ap[2]) out.push({ k: "word", v: fold(ap[2]), raw: ap[2], at: cut, end });
            } else out.push({ k: "word", v: fold(m[2]).replace(/'$/, ""), raw: m[2].replace(/'$/, ""), at, end });
        } else if (m[3] !== undefined) {
            const t = TEX[m[3]];
            if (t) out.push({ k: "sym", v: t, raw: m[0], at, end });
            // \, \; \! et les commandes inconnues (\displaystyle…) : rien
        } else if (m[4]) {
            out.push({ k: "sym", v: "^", raw: "", at, end: at });
            out.push({ k: "num", v: Q([...m[4]].map((c) => SUPERSCRIPT[c]).join("")), raw: m[4], at, end });
        } else {
            let v = SYMBOLS[m[5]] || m[5];
            if (v === "**") v = "^";
            if (v === "==") v = "=";
            out.push({ k: "sym", v, raw: m[5], at, end });
        }
    }
    // « * » collé à un mot sans opérande de l'autre côté : l'italique du Markdown ; « _ » hors de \sum_ : idem
    return out.filter((t, i) => {
        if (t.k !== "sym") return true;
        if (t.v === "_") return ["sum", "prod"].includes(out[i - 1]?.v);
        if (t.v === "*") return operand(out[i - 1]) && (operand(out[i + 1]) || out[i + 1]?.v === "(" || out[i + 1]?.v === "-");
        if (t.v === "." && out[i - 1]?.k === "num" && out[i + 1]?.k === "num") return true;
        return true;
    });
}
const operand = (t) => t && (t.k === "num" || t.k === "word" || t.v === ")" || t.v === "}" || t.v === "!");

// ---------------------------------------------------------------- l'analyseur

const ARTICLES = new Set(["le", "la", "l'", "les", "un", "une", "des", "du"]);
const NOT_VAR = new Set(["a", "y", "l", "d", "s", "c", "j", "m", "t", "o"]);   // une lettre seule qui est un mot du français
const DOMAINS = { entier: "Z", entiers: "Z", reel: "R", reels: "R", nombre: null, nombres: null };

export class Parser {
    /** Les actions du document que lisent toutes les lectures (preuve/index.js les pose : nom replié → nombre de valeurs). */
    static actions = null;
    /** scope : Map nom → domaine ("Z", "N", "R") ; opts.auto : une lettre libre devient une variable (énoncé) */
    constructor(text, scope = new Map(), opts = {}) {
        this.text = text;
        this.t = tokens(text);
        this.i = 0;
        this.scope = new Map(scope);
        this.auto = opts.auto ? new Map() : null;   // les lettres libres d'un énoncé : quantifiées « pour tout »
        this.lastSum = opts.lastSum || null;
        this.subject = null;
        // les actions du document (« pour compter les diviseurs d'un nombre, … ») : nom replié → nombre de valeurs
        this.actions = opts.actions || Parser.actions;
    }
    get done() { return this.i >= this.t.length; }
    peek(k = 0) { return this.t[this.i + k]; }
    pos() { return this.peek()?.at ?? this.text.length; }
    is(v, k = 0) { const t = this.peek(k); return !!t && (t.k === "word" || t.k === "sym") && (Array.isArray(v) ? v.includes(t.v) : t.v === v); }
    eat(v) { if (this.is(v)) { return this.t[this.i++]; } return null; }
    /** Une suite de mots : eats("si", "et", "seulement", "si") — tout ou rien. */
    eats(...vs) {
        for (let k = 0; k < vs.length; k++) if (!this.is(vs[k], k)) return false;
        this.i += vs.length;
        return true;
    }
    fail(msg, at = this.pos(), end) { throw new Unclear(msg, at, end ?? (this.peek()?.end ?? at)); }
    expect(v, msg) { const t = this.eat(v); if (!t) this.fail(msg); return t; }
    article() { while (this.peek()?.k === "word" && ARTICLES.has(this.peek().v)) this.i++; }
    node(n, at) { n.at = at; n.end = this.t[this.i - 1]?.end ?? at; return n; }

    isVarWord(t) {
        if (t === undefined) { this.splitWord(); t = this.peek(); }
        if (!t || t.k !== "word") return false;
        if (this.scope.has(t.raw)) return true;
        if (this.auto == null || !/^\p{L}$/u.test(t.raw) || /^[àù]$/.test(t.v)) return false;
        if (!NOT_VAR.has(t.v)) return true;
        // « a », « y » : des mots du français, sauf entre deux signes (« si a > b », « x = y »)
        const k = this.t.indexOf(t), prev = this.t[k - 1], next = this.t[k + 1];
        const sym = (x) => x?.k === "sym" && ![",", ".", ";", ":", "'"].includes(x.v);
        return sym(prev) || sym(next);
    }

    /** « 2ab » : « ab » est a × b quand a et b sont des lettres introduites (et pas un mot) */
    splitWord() {
        const t = this.peek();
        if (!t || t.k !== "word" || this.scope.has(t.raw) || t.raw.length < 2 || t.raw.length > 4 || t.raw.endsWith("'")) return;
        if (![...t.raw].every((c) => this.scope.has(c))) return;
        this.t.splice(this.i, 1, ...[...t.raw].map((c, j) => ({ k: "word", v: fold(c), raw: c, at: t.at + j, end: t.at + j + 1 })));
    }

    // ---------------- expressions
    expr() {
        const at = this.pos();
        let a = this.term();
        for (;;) {
            if (this.eat("+") || (this.is("plus") && !this.is(["petit", "grand"], 1) && this.eat("plus"))) a = this.node({ t: "add", a, b: this.term() }, at);
            else if (this.eat("-") || (this.is("moins") && this.eat("moins"))) a = this.node({ t: "sub", a, b: this.term() }, at);
            else return a;
        }
    }
    term() {
        const at = this.pos();
        let a = this.unary();
        for (;;) {
            if (this.eat("*") || this.eat("fois")) a = this.node({ t: "mul", a, b: this.unary() }, at);
            else if (this.eat("/") || this.eats("divise", "par")) a = this.node({ t: "div", a, b: this.unary() }, at);
            // la multiplication sous-entendue : 2n, n(n + 1), (n + 1)(n + 2), 2\frac…
            else if (this.is("(") || this.is("{") || this.is("frac") || (this.isVarWord() && this.prevOperand())) a = this.node({ t: "mul", a, b: this.unary() }, at);
            else return a;
        }
    }
    prevOperand() { const p = this.t[this.i - 1]; return p && (p.k === "num" || p.v === ")" || p.v === "}" || p.v === "!" || (p.k === "word" && this.isVarWord(p))); }
    unary() {
        const at = this.pos();
        if (this.eat("-") || this.eat("moins")) return this.node({ t: "neg", a: this.unary() }, at);
        if (this.eat("+")) return this.unary();
        return this.power();
    }
    power() {
        const at = this.pos();
        let a = this.postfix();
        for (;;) {
            if (this.eat("^")) a = this.node({ t: "pow", a, e: this.exponent() }, at);
            else if (this.eats("au", "carre")) a = this.node({ t: "pow", a, e: 2 }, at);
            else if (this.eats("au", "cube")) a = this.node({ t: "pow", a, e: 3 }, at);
            else if (this.eats("puissance")) a = this.node({ t: "pow", a, e: this.exponent() }, at);
            else return a;
        }
    }
    exponent() {
        const at = this.pos();
        const e = this.eat("{") ? this.closing(this.expr(), "}") : this.postfix();
        const c = constValue(e);
        if (!c || !qint(c) || c.n < 0n || c.n > 60n) this.fail("un exposant doit être un nombre entier (de 0 à 60)", at);
        return Number(c.n);
    }
    closing(e, close) { this.expect(close, `il manque « ${close === "}" ? "}" : ")"} »`); return e; }
    postfix() {
        const at = this.pos();
        let a = this.primary();
        while (this.is("!") && !this.is("=", 1)) { this.i++; a = this.node({ t: "big", kind: "prod", k: "_k", f: { t: "var", name: "_k" }, a: num(1), b: a }, at); }
        return a;
    }
    primary() {
        const at = this.pos(), tk = this.peek();
        if (!tk) this.fail("il manque une valeur à la fin");
        if (tk.k === "num") { this.i++; return this.node({ t: "num", v: tk.v }, at); }
        if (this.eat("(")) return this.closing(this.expr(), ")");
        if (this.eat("{")) return this.closing(this.expr(), "}");
        if (this.eat("frac")) {
            this.expect("{", "\\frac{…}{…} : il manque « { »");
            const a = this.closing(this.expr(), "}");
            this.expect("{", "\\frac{…}{…} : il manque le dénominateur");
            const b = this.closing(this.expr(), "}");
            return this.node({ t: "div", a, b }, at);
        }
        if (this.is("sum") || this.is("prod")) return this.texBig();
        if (tk.k === "word" && this.isVarWord()) {
            const tk = this.peek();
            this.i++;
            if (!this.scope.has(tk.raw)) { this.auto.set(tk.raw, "Z"); this.scope.set(tk.raw, "Z"); }
            return this.node({ t: "var", name: tk.raw }, at);
        }
        if (tk.k === "word") {
            const w = this.wordValue();
            if (w) return w;
            if (/^\p{L}$/u.test(tk.raw) && !NOT_VAR.has(tk.v)) this.fail(`« ${tk.raw} » n'est pas introduit (écrire « Soit ${tk.raw} un entier. »)`, tk.at, tk.end);
        }
        this.fail(`une valeur est attendue ici, pas « ${tk.raw} »`, tk.at, tk.end);
    }
    /** le carré de n, la moitié de n, la somme des entiers de 1 à n… */
    wordValue() {
        const start = this.i, at = this.pos();
        const call = this.action(at);
        if (call) return call;
        this.article();
        const w = this.peek()?.v;
        const UNARY = { carre: 2, cube: 3 };
        const SCALE = { double: Q(2), triple: Q(3), moitie: Q(1, 2), tiers: Q(1, 3), quart: Q(1, 4), oppose: Q(-1) };
        if (w in UNARY || w in SCALE || w === "successeur" || w === "predecesseur" || w === "factorielle") {
            this.i++;
            if (!this.eat("de") && !this.eat("d'") && !this.eat("du")) { this.i = start; return null; }
            const a = this.unary();
            if (w in UNARY) return this.node({ t: "pow", a, e: UNARY[w] }, at);
            if (w in SCALE) return this.node({ t: "mul", a: { t: "num", v: SCALE[w] }, b: a }, at);
            if (w === "factorielle") return this.node({ t: "big", kind: "prod", k: "_k", f: { t: "var", name: "_k" }, a: num(1), b: a }, at);
            return this.node({ t: w === "successeur" ? "add" : "sub", a, b: num(1) }, at);
        }
        if (w === "somme" || w === "produit") { this.i++; return this.big(w === "somme" ? "sum" : "prod", at); }
        if (w === "difference" && (this.eat("difference"), this.eat("de") || this.eat("d'"))) {
            const a = this.expr(); this.expect("et", "« la différence de A et B »"); this.eat("de"); this.eat("d'");
            return this.node({ t: "sub", a, b: this.expr() }, at);
        }
        if (w === "quotient" && (this.eat("quotient"), this.eat("de") || this.eat("d'"))) {
            const a = this.expr(); this.expect("par", "« le quotient de A par B »");
            return this.node({ t: "div", a, b: this.expr() }, at);
        }
        this.i = start;
        return null;
    }
    /** Une action du document, appelée : « compter les diviseurs de n », « pgcd de a et b » (le nom le plus long). */
    action(at) {
        if (!this.actions?.size) return null;
        const start = this.i;
        this.article();
        let best = null;
        for (const [name, arity] of this.actions) {
            const ws = name.split(" ");
            if (ws.every((w, k) => this.is(w, k)) && (!best || ws.length > best.ws.length)) best = { name, ws, arity };
        }
        if (!best) { this.i = start; return null; }
        this.i += best.ws.length;
        // « compter les diviseurs de n », ou un verbe et sa valeur : « doubler n »
        if (!this.eat("de") && !this.eat("d'") && !this.eat("du")) {
            const t = this.peek();
            if (!t || !(t.k === "num" || this.is("(") || (t.k === "word" && this.isVarWord(t)))) { this.i = start; return null; }
        }
        const args = [this.unary()];
        while (args.length < best.arity && (this.eat("et") || this.eat(","))) { this.eat("de"); this.eat("d'"); args.push(this.unary()); }
        if (args.length !== best.arity) this.fail(`« ${best.name} » attend ${best.arity} valeurs`, at);
        return this.node({ t: "call", name: best.name, args }, at);
    }
    /** Après « la somme » / « le produit » : des entiers de A à B, des carrés…, de E pour k de A à B, jusqu'à B, de A et B. */
    big(kind, at) {
        const k = { t: "var", name: "_k" };
        if (this.eat("jusqu'") || this.eats("jusque")) {
            this.eat("a"); this.eat("au"); this.eat("rang");
            const last = this.lastSum;
            if (!last || last.kind !== kind) this.fail(`« ${kind === "sum" ? "la somme" : "le produit"} jusqu'à … » : quelle ${kind === "sum" ? "somme" : "produit"} ? (la nommer d'abord en entier)`, at);
            return this.node({ ...last, b: this.expr() }, at);
        }
        const lists = { entiers: k, carres: { t: "pow", a: k, e: 2 }, cubes: { t: "pow", a: k, e: 3 }, inverses: { t: "div", a: num(1), b: k } };
        if (this.eat("des")) {
            // « des n premiers nombres impairs » (pairs, entiers, carrés, cubes) : pour k de 1 à n
            const first = this.t.findIndex((x, j) => j > this.i && j <= this.i + 6 && (x.v === "premiers" || x.v === "premieres"));
            if (first > this.i) {
                const save = this.i;
                const n = this.expr();
                if (this.eat("premiers") || this.eat("premieres")) {
                    this.eat("nombres");
                    const TERMS = { impairs: { t: "sub", a: { t: "mul", a: num(2), b: k }, b: num(1) }, pairs: { t: "mul", a: num(2), b: k }, entiers: k, carres: { t: "pow", a: k, e: 2 }, cubes: { t: "pow", a: k, e: 3 } };
                    const w = this.peek()?.v;
                    if (w in TERMS) {
                        this.i++;
                        this.eat("naturels"); this.eat("positifs");
                        const node = this.node({ t: "big", kind, k: "_k", f: TERMS[w], a: num(1), b: n }, at);
                        if (kind === "sum") this.lastSum = node;
                        return node;
                    }
                }
                this.i = save;
            }
            const w = this.peek()?.v;
            if (w in lists) {
                this.i++;
                if (w !== "entiers") { this.eat("des"); this.eat("entiers"); }
                this.eat("naturels"); this.eat("allant");
                return this.bounded(kind, "_k", lists[w], at);
            }
            return this.ofExpr(kind, at);
        }
        if (this.eat("de") || this.eat("d'")) return this.ofExpr(kind, at);
        // « la somme » seule : la dernière nommée
        if (this.lastSum && kind === "sum") return this.node({ ...this.lastSum }, at);
        this.fail(`« ${kind === "sum" ? "la somme" : "le produit"} » de quoi ? (« des entiers de 1 à n », « de 2k − 1 pour k de 1 à n »)`, at);
    }
    ofExpr(kind, at) {
        // « la somme de 2k − 1 pour k de 1 à n » : k est muet ; « la somme de a et b » : a + b
        const save = this.i, scope = this.scope;
        const pour = this.t.findIndex((x, j) => j >= this.i && x.v === "pour");
        const bound = pour >= 0 && this.t[pour + 1]?.k === "word" && /^\p{L}$/u.test(this.t[pour + 1].raw) ? this.t[pour + 1].raw : null;
        if (bound) { this.scope = new Map(scope); this.scope.set(bound, "Z"); }
        const f = this.expr();
        this.scope = scope;
        if (bound && this.eat("pour")) {
            this.i++;   // la lettre
            this.eat("allant");
            return this.bounded(kind, bound, f, at);
        }
        if (this.eat("et")) {
            this.eat("de"); this.eat("d'");
            return this.node({ t: kind === "sum" ? "add" : "mul", a: f, b: this.expr() }, at);
        }
        this.i = save;
        this.fail(`« ${kind === "sum" ? "la somme" : "le produit"} de … » : pour quelle lettre, de combien à combien ? (« pour k de 1 à n »)`, at);
    }
    bounded(kind, k, f, at) {
        this.expect(["de", "d'"], "de combien à combien ? (« de 1 à n »)");
        const a = this.expr();
        if (!this.eat("a") && !this.eat("à") && !this.eats("jusqu'", "a") && !this.eats("jusqu'", "à")) this.fail("« de … à … » : il manque « à »");
        const b = this.expr();
        const n = this.node({ t: "big", kind, k: "_k", f: rename(f, k, "_k"), a, b }, at);
        if (kind === "sum") this.lastSum = n;
        return n;
    }
    texBig() {
        const at = this.pos(), kind = this.t[this.i++].v === "sum" ? "sum" : "prod";
        this.expect("_", "\\sum_{k=1}^{n} : il manque « _ »");
        this.expect("{", "\\sum_{k=1}^{n} : il manque « { »");
        const kt = this.peek();
        if (kt?.k !== "word") this.fail("\\sum_{k=1}^{n} : quelle lettre ?");
        this.i++;
        this.expect("=", "\\sum_{k=1}^{n} : il manque « = »");
        const a = this.closing(this.expr(), "}");
        this.expect("^", "\\sum_{k=1}^{n} : il manque « ^ »");
        const b = this.eat("{") ? this.closing(this.expr(), "}") : this.primary();
        const scope = this.scope;
        this.scope = new Map(scope); this.scope.set(kt.raw, "Z");
        const f = this.term();
        this.scope = scope;
        const n = this.node({ t: "big", kind, k: "_k", f: rename(f, kt.raw, "_k"), a, b }, at);
        if (kind === "sum") this.lastSum = n;
        return n;
    }

    // ---------------- énoncés
    formula() {
        const at = this.pos();
        if (this.startsQuantifier()) return this.quantified();
        if (this.eat("si") || this.eat("lorsque") || this.eat("lorsqu'") || this.eat("quand")) {
            const p = this.disj();
            this.eat(",");
            this.eat("alors");
            return this.node({ t: "imp", p, q: this.formula() }, at);
        }
        const p = this.disj();
        if (this.eats("si", "et", "seulement", "si")) return this.node({ t: "iff", p, q: this.disj() }, at);
        if (this.eat("implique") || this.eats("entraine")) return this.node({ t: "imp", p, q: this.formula() }, at);
        return p;
    }
    disj() {
        const at = this.pos(), ps = [this.conj()];
        while (this.is("ou") && !this.is("egal", 1)) { this.i++; ps.push(this.conj()); }
        return ps.length > 1 ? this.node({ t: "or", ps }, at) : ps[0];
    }
    conj() {
        const at = this.pos(), ps = [this.literal()];
        while (this.is("et") && !this.is("seulement", 1)) { this.i++; ps.push(this.literal()); }
        return ps.length > 1 ? this.node({ t: "and", ps }, at) : ps[0];
    }
    literal() {
        const at = this.pos();
        if (this.startsQuantifier()) return this.quantified();
        if (this.eats("c'", "est", "absurde") || this.eat("contradiction") || this.eat("absurde") || this.eats("c'", "est", "impossible")) return this.node({ t: "bool", v: false }, at);
        if (this.eat("non") && this.eat(",")) return this.node({ t: "not", p: this.literal() }, at);
        // « et divisible par 3 » : le même sujet que la proposition d'avant
        const subject = this.startsPredicate() && this.subject ? this.subject : this.expr();
        this.subject = subject;
        return this.predicate(subject, at);
    }
    startsPredicate() { return this.is(["est", "soit", "vaut", "vaille", "egale", "=", "!=", "<", ">", "<=", ">=", "divise", "|", "n'", "ne", "fait", "donne", "pair", "impair", "divisible", "premier"]); }
    predicate(a, at) {
        let neg = false;
        if (this.eat("n'") || this.eat("ne")) neg = true;
        const done = (p) => { if (neg) { this.expect(["pas", "plus"], "« n'… pas » : il manque « pas »"); } return this.node(neg ? { t: "not", p } : p, at); };
        const cmp = (op) => ({ t: "cmp", op, a, b: this.expr() });
        if (neg && this.is("vaut")) { this.i++; this.expect("pas", "« ne vaut pas »"); return this.node({ t: "not", p: cmp("=") }, at); }
        if (neg && this.is("divise")) { this.i++; this.expect("pas", "« ne divise pas »"); return this.node({ t: "not", p: { t: "dvd", m: a, a: this.expr() } }, at); }
        for (const [sym, op] of [["=", "="], ["!=", "!="], ["<=", "<="], [">=", ">="], ["<", "<"], [">", ">"]]) if (this.eat(sym)) return done(cmp(op));
        if (this.eat("vaut") || this.eat("vaille") || this.eat("valent") || this.eat("egale") || this.eat("fait") || this.eat("donne")) {
            // « vaut au moins 2 », « vaut au plus 10 », « vaut plus de 3 » : un comparatif, lu comme après « est »
            if (this.is(["au", "plus", "moins", "strictement"]) && !this.is("(", 1)) return done(this.afterEst(a, at, false));
            return done(cmp("="));
        }
        if (this.eat("divise") || this.eat("|")) return done({ t: "dvd", m: a, a: this.expr() });
        if (this.is(["pair", "impair", "divisible", "premier"])) return done(this.adjective(a));
        if (this.eat("est") || this.eat("soit") || this.eat("sont") || this.eat("soient")) {
            if (neg) this.expect(["pas", "plus"], "« n'est pas … » : il manque « pas »");
            return this.afterEst(a, at, neg);
        }
        this.fail("ce qui est dit de cette valeur est attendu ici (« vaut … », « est pair », « est au moins … »)");
    }
    afterEst(a, at, neg) {
        const wrap = (p) => this.node(neg ? { t: "not", p } : p, at);
        const cmp = (op) => wrap({ t: "cmp", op, a, b: this.expr() });
        const zero = (op) => wrap({ t: "cmp", op, a, b: num(0) });
        const strict = !!this.eat("strictement");
        if (this.eats("egal", "a") || this.eats("egale", "a") || this.eats("egal", "à") || this.eats("egale", "à")) return cmp("=");
        if (this.eat("egal") || this.eat("egale")) { this.eat("a"); return cmp("="); }
        if (this.eat("different") || this.eat("differente")) { this.expect(["de", "d'"], "« différent de »"); return cmp("!="); }
        if (this.eat("inferieur") || this.eat("inferieure")) { if (this.eats("ou", "egal") || this.eats("ou", "egale")) { this.eat("a"); return cmp("<="); } this.eat("a"); return cmp(strict ? "<" : "<="); }
        if (this.eat("superieur") || this.eat("superieure")) { if (this.eats("ou", "egal") || this.eats("ou", "egale")) { this.eat("a"); return cmp(">="); } this.eat("a"); return cmp(strict ? ">" : ">="); }
        if (this.eats("plus", "petit")) { if (this.eats("ou", "egal")) { this.eat("a"); return cmp("<="); } this.expect(["que", "qu'"], "« plus petit que »"); return cmp("<"); }
        if (this.eats("plus", "grand")) { if (this.eats("ou", "egal")) { this.eat("a"); return cmp(">="); } this.expect(["que", "qu'"], "« plus grand que »"); return cmp(">"); }
        if (this.eats("au", "moins")) return cmp(">=");
        if (this.eats("au", "plus")) return cmp("<=");
        if (this.eats("plus", "de") || this.eats("plus", "d'")) return cmp(">");
        if (this.eats("moins", "de") || this.eats("moins", "d'")) return cmp("<");
        if (this.eat("positif") || this.eat("positive")) return zero(strict ? ">" : ">=");
        if (this.eat("negatif") || this.eat("negative")) return zero(strict ? "<" : "<=");
        if (this.eat("nul") || this.eat("nulle") || this.eat("vide")) return zero("=");
        if (this.eats("non", "nul") || this.eats("non", "nulle")) return zero("!=");
        if (this.eats("un", "entier") || this.eats("entier")) return wrap({ t: "dvd", m: num(1), a });
        if (this.eats("un", "carre") || this.eats("un", "carre", "parfait")) { this.eat("parfait"); return wrap({ t: "square", a }); }
        if (this.eats("un", "nombre", "premier")) return wrap({ t: "prime", a });
        if (this.eats("un", "multiple", "de") || this.eats("multiple", "de") || this.eats("un", "multiple", "d'") || this.eats("multiple", "d'")) return wrap({ t: "dvd", m: this.expr(), a });
        if (this.is(["pair", "paire", "impair", "impaire", "divisible", "premier"])) return wrap(this.adjective(a));
        this.fail("« est … » : quoi ? (« est pair », « est au moins 3 », « est égal à … », « est divisible par 3 »)");
    }
    adjective(a) {
        if (this.eat("pair") || this.eat("paire")) return { t: "dvd", m: num(2), a };
        if (this.eat("impair") || this.eat("impaire")) return { t: "not", p: { t: "dvd", m: num(2), a } };
        if (this.eat("premier")) return { t: "prime", a };
        this.eat("divisible");
        this.expect("par", "« divisible par … »");
        return { t: "dvd", m: this.expr(), a };
    }

    // ---------------- quantificateurs
    startsQuantifier() {
        return (this.is("pour") && this.is(["tout", "toute", "tous", "toutes", "chaque"], 1)) || this.is("quel") || this.is("quelle")
            || (this.is("il") && (this.is("existe", 1) || (this.is("n'", 1) && this.is("existe", 2))));
    }
    quantified() {
        const at = this.pos();
        let kind = "all", negate = false;
        if (this.eat("il")) {
            if (this.eat("n'")) negate = true;
            this.expect("existe", "« il existe »");
            if (negate) this.expect("pas", "« il n'existe pas »");
            kind = "ex";
        } else if (this.eat("quel") || this.eat("quelle")) {
            this.expect("que", "« quel que soit »"); this.expect("soit", "« quel que soit »");
        } else { this.eat("pour"); this.i++; }
        this.article();
        this.eat("d'"); this.eat("de");
        const q = this.binder(kind === "ex");
        const scope = this.scope;
        this.scope = new Map(scope);
        for (const v of q.vars) this.scope.set(v.name, v.dom);
        if (kind === "ex") {
            if (this.eats("tel", "que") || this.eats("telle", "que") || this.eats("tels", "que") || this.eats("telles", "que") || this.eats("tel", "qu'") || this.eats("telle", "qu'")
                || this.eats("pour", "lequel") || this.eats("pour", "laquelle") || this.eat(",")) { /* le corps */ }
            q.body = this.formula();
        } else {
            this.expect(",", "« pour tout entier n, … » : il manque la virgule");
            q.body = this.formula();
        }
        this.scope = scope;
        const n = this.node({ t: kind, ...q }, at);
        return negate ? this.node({ t: "not", p: n }, at) : n;
    }
    /** « entier naturel n », « entiers a et b », « n entier », « n ∈ ℕ », « entier n ≥ 1 », « entier n de 1 à 10 », « entier n pair » */
    binder(ex = false) {
        let dom = this.domainWords();
        const vars = [];
        const name = () => {
            const t = this.peek();
            if (t?.k !== "word" || !/^\p{L}[\p{L}\p{N}]*$/u.test(t.raw) || t.raw.length > 3) this.fail("quelle lettre ? (« pour tout entier n, … »)");
            this.i++;
            vars.push({ name: t.raw });
        };
        this.eat("deux"); this.eat("trois");
        name();
        while ((this.is("et") || this.is(",")) && this.peek(1)?.k === "word" && /^\p{L}$/u.test(this.peek(1).raw) && !["et", "si"].includes(this.peek(1).v)
            && (this.is([",", "et", "de", "entre", "dans", "in", ">=", "<=", ">", "<", "tels", "telles", "entiers", "reels", "deux"], 2) || this.peek(2) == null)) {
            this.i++; name();
        }
        if (!dom) dom = this.domainWords();
        if (this.eat("in") || this.eat("dans")) {
            const t = this.peek();
            const D = { n: "N", z: "Z", r: "R" }[t?.v];
            if (!D) this.fail("ℕ, ℤ ou ℝ ?");
            this.i++;
            dom = D;
            if (this.eat("*")) this.star = true;
        }
        dom ||= "Z";
        const q = { vars: vars.map((v) => ({ ...v, dom: dom === "N*" ? "N" : dom })), cond: null, lo: null, hi: null };
        const conds = [];
        if (dom === "N*" || this.star) { this.star = false; for (const v of q.vars) conds.push({ t: "cmp", op: ">=", a: { t: "var", name: v.name }, b: num(1) }); }
        const scope = this.scope;
        this.scope = new Map(scope);
        for (const v of q.vars) this.scope.set(v.name, q.vars[0].dom);
        const v0 = { t: "var", name: q.vars[0].name };
        // une borne : « de 1 à 100 », « entre 1 et 100 », « allant de … à … »
        this.eat("allant"); this.eat("compris");
        if (this.eat("de") || this.eat("d'")) {
            q.lo = this.expr();
            if (!this.eat("a") && !this.eat("à")) this.fail("« de … à … » : il manque « à »");
            q.hi = this.expr();
        } else if (this.eat("entre")) {
            q.lo = this.expr(); this.expect("et", "« entre … et … »"); q.hi = this.expr();
        }
        // une condition : « n ≥ 1 », « n pair », « non nul », « tel que … »
        for (;;) {
            if (this.is([">=", "<=", ">", "<", "!="])) { const op = this.t[this.i++].v; conds.push({ t: "cmp", op, a: v0, b: this.expr() }); continue; }
            if (this.is(["pair", "impair", "premier"])) { conds.push(this.adjective(v0)); continue; }
            if (this.eats("non", "nul")) { conds.push({ t: "cmp", op: "!=", a: v0, b: num(0) }); continue; }
            if (this.eats("au", "moins")) { conds.push({ t: "cmp", op: ">=", a: v0, b: this.expr() }); continue; }
            if (this.eat("strictement") && (this.eat("positif") || this.eat("positifs"))) { conds.push({ t: "cmp", op: ">", a: v0, b: num(0) }); continue; }
            if (this.eats("superieur", "ou", "egal", "a") || this.eats("superieur", "a")) { conds.push({ t: "cmp", op: ">=", a: v0, b: this.expr() }); continue; }
            break;
        }
        // pour tout … tel que P, Q : la condition (pour « il existe … tel que », c'est le corps)
        if (!ex && this.is(["tel", "telle", "tels", "telles"]) && this.is(["que", "qu'"], 1)) { this.i += 2; conds.push(this.disj()); }
        this.scope = scope;
        q.cond = conds.length ? (conds.length > 1 ? { t: "and", ps: conds } : conds[0]) : null;
        return q;
    }
    domainWords() {
        let dom = null;
        this.eat("nombres"); this.eat("nombre");
        const w = this.peek()?.v;
        if (w in DOMAINS && DOMAINS[w]) {
            this.i++;
            dom = DOMAINS[w];
            if (this.eat("naturel") || this.eat("naturels")) dom = "N";
            this.eat("relatif"); this.eat("relatifs");
            if (dom === "N" && (this.eats("non", "nul") || this.eats("non", "nuls"))) dom = "N*";
            if (this.eats("strictement", "positif") || this.eats("strictement", "positifs")) dom = "N*";
            else if (this.eat("positif") || this.eat("positifs")) dom = dom === "Z" ? "N" : dom;
        }
        return dom;
    }
}

export const num = (n) => ({ t: "num", v: Q(n) });
function rename(e, from, to) {
    if (!e || typeof e !== "object") return e;
    if (e.t === "var") return e.name === from ? { ...e, name: to } : e;
    const out = { ...e };
    for (const k of ["a", "b", "f"]) if (e[k]) out[k] = rename(e[k], from, to);
    return out;
}

/** La valeur d'une expression sans variable (pour un exposant), ou null. */
export function constValue(e) {
    switch (e.t) {
        case "num": return e.v;
        case "neg": { const a = constValue(e.a); return a && Q(-a.n, a.d); }
        case "add": case "sub": case "mul": {
            const a = constValue(e.a), b = constValue(e.b);
            if (!a || !b) return null;
            return e.t === "add" ? Q(a.n * b.d + b.n * a.d, a.d * b.d) : e.t === "sub" ? Q(a.n * b.d - b.n * a.d, a.d * b.d) : Q(a.n * b.n, a.d * b.d);
        }
        default: return null;
    }
}
void pconstOf;

// ---------------------------------------------------------------- écrire

const PREC = { add: 1, sub: 1, mul: 2, div: 2, neg: 3, pow: 4 };
const SUPS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
/** L'expression écrite, avec les parenthèses nécessaires : n × (n + 1) / 2. */
export function etext(e, outer = 0) {
    const wrap = (s, p) => (p < outer ? `(${s})` : s);
    switch (e.t) {
        case "num": return e.v.d === 1n ? String(e.v.n).replace("-", "−") : `${e.v.n}/${e.v.d}`.replace("-", "−");
        case "var": return e.name === "_k" ? "k" : e.name;
        case "call": return `${e.name} de ${e.args.map((a) => etext(a, 9)).join(" et ")}`;
        case "add":
            // n + 1 + 1 : n + 2 (ce qu'écrit P(n + 1))
            if (e.a.t === "add" && e.a.b.t === "num" && e.b.t === "num" && e.a.b.v.d === 1n && e.b.v.d === 1n) return etext({ t: "add", a: e.a.a, b: { t: "num", v: Q(e.a.b.v.n + e.b.v.n) } }, outer);
            return wrap(`${etext(e.a, 1)} + ${etext(e.b, 2)}`, 1);
        case "sub": return wrap(`${etext(e.a, 1)} − ${etext(e.b, 2)}`, 1);
        case "mul": return wrap(`${etext(e.a, 2)} × ${etext(e.b, 3)}`, 2);
        case "div": return wrap(`${etext(e.a, 2)} / ${etext(e.b, 3)}`, 2);
        case "neg": return wrap(`−${etext(e.a, 3)}`, 3);
        case "pow": return wrap(`${etext(e.a, 5)}${String(e.e).split("").map((d) => SUPS[d]).join("")}`, 4);
        case "big": {
            const f = etext(e.f, 0);
            if (e.kind === "prod" && e.f.t === "var" && e.a.t === "num" && e.a.v.n === 1n) return wrap(`${etext(e.b, 5)}!`, 4);
            return `${e.kind === "sum" ? "∑" : "∏"}(k = ${etext(e.a)} … ${etext(e.b)}) ${/[ +−]/.test(f) ? `(${f})` : f}`;
        }
        default: return "?";
    }
}
const OPS = { "=": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" };
/** L'énoncé écrit, en français compact. */
export function ftext(f) {
    switch (f.t) {
        case "cmp": return `${etext(f.a)} ${OPS[f.op]} ${etext(f.b)}`;
        case "dvd": return f.m.t === "num" && f.m.v.n === 2n && f.m.v.d === 1n ? `${etext(f.a)} est pair` : f.m.t === "num" && f.m.v.n === 1n ? `${etext(f.a)} est un entier` : `${etext(f.a)} est divisible par ${etext(f.m)}`;
        case "prime": return `${etext(f.a)} est premier`;
        case "square": return `${etext(f.a)} est un carré parfait`;
        case "not":
            if (f.p.t === "dvd" && f.p.m.t === "num" && f.p.m.v.n === 2n) return `${etext(f.p.a)} est impair`;
            if (f.p.t === "cmp" && f.p.op === "=") return `${etext(f.p.a)} ≠ ${etext(f.p.b)}`;
            return `non (${ftext(f.p)})`;
        case "and": return f.ps.map(ftext).join(" et ");
        case "or": return f.ps.map(ftext).join(" ou ");
        case "imp": return `si ${ftext(f.p)}, alors ${ftext(f.q)}`;
        case "iff": return `${ftext(f.p)} si et seulement si ${ftext(f.q)}`;
        case "bool": return f.v ? "vrai" : "contradiction";
        case "all": case "ex": {
            const D = { Z: "entier", N: "entier naturel", R: "réel" }[f.vars[0].dom];
            const vs = f.vars.map((v) => v.name).join(" et ");
            const range = f.lo ? ` de ${etext(f.lo)} à ${etext(f.hi)}` : "";
            const cond = f.cond ? ` tel que ${ftext(f.cond)}` : "";
            return f.t === "all" ? `pour tout ${D} ${vs}${range}${cond}, ${ftext(f.body)}` : `il existe un ${D} ${vs}${range} tel que ${ftext(f.body)}`;
        }
        default: return "?";
    }
}

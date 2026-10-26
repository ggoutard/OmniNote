// formulas.js — les formules du document deviennent des fonctions du code.
//
// Une équation écrite en LaTeX, entre « $$ » :
//
//     $$ f(x, y) = \frac{x^2 + \sqrt{y}}{2} $$
//
// se lit comme une définition, et les blocs Python, JavaScript, C, C++ et Rust du document peuvent l'appeler sans
// la recopier : resultat = f(10, 16). La formule est traduite dans chaque langage (math.sqrt et ** en Python,
// __builtin_sqrt et __builtin_pow en C et C++, .sqrt() et .powf() en Rust…), et ajoutée au bloc seulement s'il
// l'appelle. Une formule sans parenthèses (« $$ g = 9{,}81 $$ ») est une constante ; une formule dont le membre de
// gauche n'a pas d'arguments mais le membre de droite des inconnues (« $$ E = m c^2 $$ ») devient E(m, c).
//
// Ce que la lecture comprend :
//   - l'arithmétique : + - \cdot \times / \div, la multiplication sous-entendue (2x, xy, 2\pi r), \frac, ^, \sqrt,
//     \sqrt[n], n!, \binom, |x|, \lfloor \rceil, \min \max, les fonctions (\sin… \sinh… \exp \ln \log \log_b) ;
//   - les noms : x_1, v_{max}, les lettres grecques, \mathrm{…}, \bar{x} (le nom x_bar), \pi, e ;
//   - les sommes et produits : \sum_{i=1}^{n}, _{1 \le i < n}, _{i \in \{1, 2, 5\}}, imbriqués, jusqu'à \infty
//     (on additionne jusqu'à ce que les termes ne changent plus rien), et \max_i, \min_i ;
//   - les listes (vecteurs, matrices) : dans une somme, x_i est le i-ième élément de la liste x (A_{ij} : une
//     matrice), et sa longueur se devine (\sum_i x_i, ou n quand il n'est pas un argument) ; \sum_{x \in X} ;
//     \vec u \cdot \vec v (produit scalaire), \|\vec v\|, \operatorname{tr}(A), \#X, les vecteurs (1, 2, 3)
//     et les matrices \begin{pmatrix} … \end{pmatrix} ;
//   - les intégrales \int_a^b … \,dx (Gauss-Legendre, 2000 points), bornes infinies comprises ;
//   - les limites \lim_{x \to a}, a^+, a^-, \pm\infty (extrapolation de Richardson) ;
//   - les dérivées \frac{d}{dx}, \frac{d^2}{dx^2}, \frac{\partial^2}{\partial x \partial y}, \frac{df}{dx}, f'(x),
//     f''(x) : calculées exactement (règles de dérivation), sinon par différences finies ;
//   - les nombres complexes : i (quand il n'est ni un argument ni un indice), \mathrm{i}, \Re \Im \arg, z^* ;
//   - les fonctions par morceaux \begin{cases} … \end{cases} (< > \le \ge = \neq, « et », « ou », « sinon ») et
//     les conditions \forall x \in X, \exists x \in X ;
//   - les appels d'une formule à une autre, avec ou sans arguments (\bar{x} dans une autre formule : x_bar(x)).

const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
    "mu", "nu", "xi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"]);
const FUNCS = { sin: "sin", cos: "cos", tan: "tan", arcsin: "asin", arccos: "acos", arctan: "atan", sinh: "sinh", cosh: "cosh", tanh: "tanh",
    exp: "exp", ln: "ln", log: "log10", lg: "log10", min: "min", max: "max", abs: "abs",
    Re: "re", Im: "im", re: "re", im: "im", arg: "arg", conj: "conj", tr: "tr", Tr: "tr" };
const SPACING = new Set(["left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr", "displaystyle", "textstyle", "quad", "qquad",
    ",", ";", ":", "!", " ", "limits", "nolimits"]);
const CMP = { "<": "<", ">": ">", "=": "==", lt: "<", gt: ">", le: "<=", leq: "<=", leqslant: "<=", ge: ">=", geq: ">=", geqslant: ">=", ne: "!=", neq: "!=" };
const AND = new Set(["et", "and", "land", "wedge"]), OR = new Set(["ou", "or", "lor", "vee"]);
const ELSE = new Set(["sinon", "otherwise", "else", "autrement", "ailleurs"]), IF = new Set(["si", "if", "pour", "when", "lorsque", "quand"]);
// les mots de \text{…} qui séparent une condition, au lieu de multiplier
const WORDS = new Set([...AND, ...OR, ...ELSE, ...IF]);
// les commandes qui ne commencent pas un terme
const STOP = new Set(["cdot", "times", "div", "right", "rfloor", "rceil", "rvert", "rVert", "end", "in", "land", "lor", "wedge", "vee", "forall",
    "exists", "mid", "colon", "to", "rightarrow", ...Object.keys(CMP)]);
// \bar{x} → x_bar ; \vec{v} → v (une liste)
const ACCENTS = { bar: "bar", overline: "bar", hat: "hat", widehat: "hat", tilde: "tilde", widetilde: "tilde", dot: "dot", ddot: "ddot" };
const VECS = new Set(["vec", "mathbf", "boldsymbol", "bm", "overrightarrow", "vb"]);
// les opérations « en grand » : \sum, \prod, \max_i, \min_i
const BIG = new Set(["sum", "prod", "max", "min"]);
// les nœuds qui lient une variable dans body : \sum_i, \int … dx, \forall x
const BINDS = new Set(["sum", "each", "int", "all", "any"]);

class TexError extends Error {}

let UID = 0;
const fresh = (p) => `_lx_${p}${++UID}`;

// ---------------------------------------------------------------- l'arbre

const N = (v) => ({ k: "num", v: String(v) });
const V = (v) => ({ k: "var", v });
const ZERO = N(0), ONE = N(1);
const add = (a, b) => ({ k: "add", a, b }), sub = (a, b) => ({ k: "sub", a, b }), mul = (a, b) => ({ k: "mul", a, b });
const div = (a, b) => ({ k: "div", a, b }), neg = (a) => ({ k: "neg", a }), pow = (a, b) => ({ k: "pow", a, b });
const fn = (f, ...args) => ({ k: "fn", f, args });
const I = { k: "const", v: "i" };
const isNum = (n, v) => n.k === "num" && (v == null || Number(n.v) === v);
const infSign = (n) => (n?.k === "inf" ? 1 : n?.k === "neg" && n.a.k === "inf" ? -1 : 0);

/** Les sous-expressions d'un nœud (sans body, lu à part : il peut lier une variable). */
const kids = (n) => [n.a, n.b, n.from, n.to, ...(n.args || []), ...(n.i || []), ...(n.items || []), ...(n.rows || []).flatMap((r) => [r.val, r.cond])].filter(Boolean);

/** Reconstruire l'arbre de bas en haut : visit(nœud, variables liées) rend le nœud (ou un autre). */
function transform(n, visit, bound = new Set()) {
    if (!n || typeof n !== "object") return n;
    const t = (x) => transform(x, visit, bound);
    const m = { ...n };
    for (const key of ["a", "b", "from", "to"]) if (n[key]) m[key] = t(n[key]);
    for (const key of ["args", "i", "items"]) if (n[key]) m[key] = n[key].map(t);
    if (n.rows) m.rows = n.rows.map((r) => ({ val: t(r.val), cond: r.cond && t(r.cond) }));
    if (n.body) m.body = transform(n.body, visit, BINDS.has(n.k) ? new Set([...bound, n.v]) : bound);
    return visit(m, bound);
}
/** La variable v remplacée par l'expression x (là où elle n'est pas liée) */
const subst = (n, v, x) => transform(n, (m, bound) => (m.k === "var" && m.v === v && !bound.has(v) ? x : m));

/** Les inconnues d'une expression, dans l'ordre où elles apparaissent (sans les indices de \sum, ni le x de dx). */
function freeVars(n, bound = new Set(), out = []) {
    if (!n || typeof n !== "object") return out;
    const see = (v) => { if (!bound.has(v) && !out.includes(v)) out.push(v); };
    if (n.k === "var" || n.k === "idx" || n.k === "len") see(n.v);
    if (n.list) see(n.list);
    for (const x of kids(n)) freeVars(x, bound, out);
    if (n.body) freeVars(n.body, BINDS.has(n.k) ? new Set([...bound, n.v]) : bound, out);
    return out;
}
const walk = (n, f) => { if (!n || typeof n !== "object") return; f(n); for (const x of [...kids(n), n.body]) walk(x, f); };
const calls = (n) => { const out = new Set(); walk(n, (m) => { if (m.k === "call" || m.k === "dcall") out.add(m.f); }); return out; };
/** Les listes d'une expression : nom → nombre d'indices (1 : un vecteur, 2 : une matrice) */
function listsOf(n) {
    const out = new Map();
    const see = (v, d) => out.set(v, Math.max(out.get(v) || 0, d));
    walk(n, (m) => {
        if (m.k === "idx") see(m.v, m.i.length);
        if (m.k === "len") see(m.v, m.dim + 1);
        if (m.list) see(m.list, 1);
        if (m.k === "var" && m.vec) see(m.v, 1);
    });
    return out;
}

/** Une somme sur les éléments d'une liste : \sum_{j=1}^{len(x)} terme(j) */
function overList(list, term, op = "sum") {
    const j = fresh("j");
    return { k: "sum", op, v: j, from: ONE, to: { k: "len", v: list, dim: 0 }, body: term(V(j)) };
}
const elem = (list, ...i) => ({ k: "idx", v: list, i });

// ---------------------------------------------------------------- lecture

function tokenize(tex) {
    const out = [];
    let i = 0;
    while (i < tex.length) {
        const c = tex[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "\\") {
            const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
            out.push({ t: "cmd", v: m[1] });
            i += m[0].length;
            continue;
        }
        // un nombre : 9.81, 9{,}81 (la virgule française de LaTeX), 1\,000 n'est pas lu
        const n = /^(\d+(?:(?:\.|\{,\})\d+)?|\.\d+)/.exec(tex.slice(i));
        if (n) { out.push({ t: "num", v: n[1].replace("{,}", ".") }); i += n[0].length; continue; }
        if (/[A-Za-z]/.test(c)) { out.push({ t: "let", v: c }); i++; continue; }
        out.push({ t: "op", v: c });
        i++;
    }
    return out;
}

/** Le texte d'un groupe { … } brut (pour \mathrm{…}, \text{…}, les indices). */
function rawGroup(p) {
    if (p.peek()?.v !== "{") { const t = p.next(); return t ? t.v : ""; }
    p.next();
    let depth = 1, s = "";
    while (p.peek()) {
        const t = p.next();
        if (t.v === "{") depth++;
        if (t.v === "}" && --depth === 0) break;
        s += t.v;
    }
    return s;
}

class Parser {
    constructor(tokens, known, bound = []) {
        this.toks = tokens.filter((t) => !(t.t === "cmd" && SPACING.has(t.v)));
        this.i = 0;
        this.known = known;
        this.bound = bound;
        this.intDepth = 0;
    }
    peek(k = 0) { return this.toks[this.i + k]; }
    next() { return this.toks[this.i++]; }
    is(v) { return this.peek()?.v === v && this.peek().t !== "num"; }
    eat(v) { if (this.is(v)) { this.i++; return true; } return false; }
    want(v) { if (!this.eat(v)) throw new TexError(`« ${v} » attendu`); }
    /** Les jetons d'un groupe { … } (ou un seul jeton), sans les accolades */
    groupTokens() {
        if (!this.is("{")) return [this.next()].filter(Boolean);
        this.next();
        const out = [];
        let depth = 1;
        while (this.peek()) {
            const t = this.next();
            if (t.v === "{" && t.t === "op") depth++;
            if (t.v === "}" && t.t === "op" && --depth === 0) return out;
            out.push(t);
        }
        throw new TexError("« } » attendu");
    }
    sub(tokens) { return new Parser(tokens, this.known, this.bound); }

    /** Le membre de droite : une expression, ou une condition (x > 0, \forall x \in X, …) */
    top() {
        if (this.is("forall") || this.is("exists")) return this.condition();
        const a = this.expr();
        if (this.peek() && CMP[this.peek().v] && this.peek().t !== "num") return this.condition(a);
        return a;
    }
    expr() {
        let a = this.term();
        for (;;) {
            if (this.eat("+")) a = add(a, this.term());
            else if (this.eat("-")) a = sub(a, this.term());
            else return a;
        }
    }
    term() {
        let a = this.unary();
        for (;;) {
            const t = this.peek();
            if (!t) return a;
            if (t.v === "*" || (t.t === "cmd" && (t.v === "cdot" || t.v === "times"))) { this.next(); a = this.times(a, this.unary(), t.v === "cdot"); continue; }
            if (t.v === "/" || (t.t === "cmd" && t.v === "div")) { this.next(); a = div(a, this.unary()); continue; }
            if (this.startsPrimary(t)) { a = this.times(a, this.power()); continue; }
            return a;
        }
    }
    /** a · b ; deux vecteurs : leur produit scalaire */
    times(a, b) {
        if (a.k === "var" && a.vec && b.k === "var" && b.vec) return overList(a.v, (j) => mul(elem(a.v, j), elem(b.v, j)));
        return mul(a, b);
    }
    startsPrimary(t) {
        if (t === this.peek() && (this.isDiff() || WORDS.has(this.peekWord()))) return false;
        if (t.t === "num" || t.t === "let") return true;
        if (t.t === "op") return t.v === "(" || t.v === "[" || t.v === "{";
        if (t.t === "cmd") return !STOP.has(t.v) && !/^[^A-Za-z]$/.test(t.v);
        return false;
    }
    /** Le mot de \text{…} qui vient, sans le lire */
    peekWord() {
        const t = this.peek();
        if (t?.t !== "cmd") return null;
        if (AND.has(t.v) || OR.has(t.v)) return t.v;
        if (!["text", "mathrm", "textrm"].includes(t.v) || this.peek(1)?.v !== "{") return null;
        let w = "";
        for (let k = 2; this.peek(k) && this.peek(k).v !== "}"; k++) w += this.peek(k).v;
        return w.toLowerCase().replace(/[^a-z]/g, "");
    }
    /** « dx » (ou \mathrm{d}x) à la fin d'une intégrale */
    isDiff() {
        if (!this.intDepth) return false;
        const t = this.peek();
        if (t?.t === "let" && t.v === "d" && this.peek(1)?.t === "let") return true;
        return t?.t === "cmd" && t.v === "mathrm" && this.peek(1)?.v === "{" && this.peek(2)?.v === "d" && this.peek(3)?.v === "}";
    }
    unary() {
        if (this.eat("-")) return neg(this.unary());
        if (this.eat("+")) return this.unary();
        return this.power();
    }
    power() {
        let a = this.postfix(this.primary());
        if (this.eat("^")) {
            // z^* : le conjugué
            if (this.is("*") || (this.is("{") && this.peek(1)?.v === "*" && this.peek(2)?.v === "}")) { if (this.eat("{")) { this.next(); this.next(); } else this.next(); a = fn("conj", a); }
            else a = pow(a, this.group());
        }
        return this.postfix(a);
    }
    postfix(a) {
        while (this.is("!")) { this.next(); a = { k: "fact", a }; }
        return a;
    }
    /** L'argument de ^ ou d'une commande : { … } ou un seul élément. */
    group() {
        if (this.eat("{")) { const e = this.expr(); this.want("}"); return e; }
        const t = this.peek();
        if (t?.t === "num" && t.v.length > 1 && !t.v.includes(".")) { this.next(); this.toks.splice(this.i, 0, { t: "num", v: t.v.slice(1) }); return N(t.v[0]); }
        return this.primary();
    }
    primary() {
        const t = this.next();
        if (!t) throw new TexError("la formule s'arrête trop tôt");
        if (t.t === "num") return N(t.v);
        if (t.t === "op") {
            if (t.v === "(" || t.v === "[") {
                const e = this.expr();
                // (1, 2, 3) : un vecteur
                if (t.v === "(" && this.is(",")) { const items = [e]; while (this.eat(",")) items.push(this.expr()); this.want(")"); return { k: "list", items }; }
                this.want(t.v === "(" ? ")" : "]");
                return e;
            }
            if (t.v === "{") { const e = this.expr(); this.want("}"); return e; }
            if (t.v === "|") { const e = this.expr(); this.want("|"); return this.absOf(e); }
            throw new TexError(`« ${t.v} » inattendu`);
        }
        if (t.t === "let") return this.name(t.v);
        const c = t.v;
        if (c === "frac" || c === "dfrac" || c === "tfrac") { const d = this.derivative(); if (d) return d; const a = this.group(), b = this.group(); return div(a, b); }
        if (c === "sqrt") {
            if (this.eat("[")) { const n = this.expr(); this.want("]"); return pow(this.group(), div(ONE, n)); }
            return fn("sqrt", this.group());
        }
        if (c === "pi") return { k: "const", v: "pi" };
        if (c === "imath" || c === "jmath") return I;
        if (c === "infty") return { k: "inf" };
        if (c === "binom" || c === "dbinom" || c === "tbinom") {
            const n = this.group(), k = this.group();
            return div({ k: "fact", a: n }, mul({ k: "fact", a: k }, { k: "fact", a: sub(n, k) }));
        }
        if (c === "int") return this.integral();
        if (c === "lim") return this.limit();
        if (c === "begin") return this.environment();
        if (c === "lfloor" || c === "lceil") { const e = this.expr(); this.want(c === "lfloor" ? "rfloor" : "rceil"); return fn(c === "lfloor" ? "floor" : "ceil", e); }
        if (c === "vert" || c === "lvert") { const e = this.expr(); if (!this.eat("vert")) this.want("rvert"); return this.absOf(e); }
        if (c === "|" || c === "lVert" || c === "Vert") {
            const e = this.expr();
            if (!this.eat("|") && !this.eat("rVert")) this.want("Vert");
            if (e.k !== "var") throw new TexError("\\| … \\| : la norme d'une liste (\\|v\\|)");
            return fn("sqrt", overList(e.v, (j) => pow(elem(e.v, j), N(2))));
        }
        if (c === "#") { const n = this.primary(); if (n.k !== "var") throw new TexError("\\# : le nombre d'éléments d'une liste (\\#X)"); return { k: "len", v: n.v, dim: 0 }; }
        if (VECS.has(c)) { const w = rawGroup(this).replace(/\\/g, ""); const n = this.name(w.replace(/\W+/g, "_"), true); if (n.k === "var") n.vec = true; return n; }
        if (ACCENTS[c]) { const w = rawGroup(this).replace(/\\/g, ""); return this.name(`${w.replace(/\W+/g, "_")}_${ACCENTS[c]}`, true); }
        if (c === "mathrm" || c === "text" || c === "operatorname" || c === "mathit" || c === "textrm") {
            const word = rawGroup(this).trim();
            if (word === "e") return { k: "const", v: "e" };
            if (word === "i" || word === "j") return I;
            if (FUNCS[word]) return this.func(FUNCS[word]);
            return this.name(word.replace(/\W+/g, "_"), true);
        }
        if (BIG.has(c) && (c === "sum" || c === "prod" || this.is("_"))) return this.bigop(c);
        if (c === "log" && this.is("_")) { this.next(); const base = this.group(); const arg = this.funcArg(); return div(fn("ln", arg), fn("ln", base)); }
        if (FUNCS[c]) return this.func(FUNCS[c]);
        if (GREEK.has(c)) return this.name(c, true);
        throw new TexError(`\\${c} n'est pas encore compris`);
    }
    /** |x| ; |\vec v| : la norme */
    absOf(e) {
        if (e.k === "var" && e.vec) return fn("sqrt", overList(e.v, (j) => pow(elem(e.v, j), N(2))));
        return fn("abs", e);
    }
    /** \sin x, \sin(x), \sin^2 x, \max(a, b), \operatorname{tr}(A) */
    func(f) {
        let power = null;
        if (this.eat("^")) power = this.group();
        let args;
        if (f === "min" || f === "max") { this.want("("); args = [this.expr()]; while (this.eat(",")) args.push(this.expr()); this.want(")"); }
        else args = [this.funcArg()];
        let call = fn(f, ...args);
        if (f === "tr") {
            if (args[0].k !== "var") throw new TexError("\\operatorname{tr} : la trace d'une matrice (\\operatorname{tr}(A))");
            call = overList(args[0].v, (j) => elem(args[0].v, j, j));
        }
        return power ? pow(call, power) : call;
    }
    funcArg() {
        if (this.is("(")) { this.next(); const e = this.expr(); this.want(")"); return e; }
        // sans parenthèses : le terme qui suit (\sin 2x = sin(2x))
        let a = this.power();
        while (this.peek() && this.peek().t !== "op" && this.startsPrimary(this.peek()) && !(this.peek().t === "cmd" && FUNCS[this.peek().v])) a = mul(a, this.power());
        return a;
    }
    /** Le terme d'une somme, l'indice étant lié pendant sa lecture */
    boundTerm(v) {
        this.bound.push(v);
        try { return this.term(); } finally { this.bound.pop(); }
    }
    /**
     * \sum_{i=1}^{n} terme, \sum_{1 \le i \le n}, \sum_{i \in \{1, 2, 5\}}, \sum_{x \in X}, \sum_i x_i (toute la liste),
     * \max_i x_i : le terme va jusqu'au + ou - suivant.
     */
    bigop(c) {
        this.want("_");
        const toks = this.groupTokens();
        const head = toks[0], op = toks[1];
        let v, from = ONE, to = null;
        if (head?.t === "let" && toks.length === 1) v = head.v;
        else if (head?.t === "let" && op?.v === "=") {
            v = head.v;
            const p = this.sub(toks.slice(2));
            from = p.expr();
            if (p.peek()) throw new TexError(`\\${c} : « ${p.peek().v} » inattendu dans l'indice`);
            this.want("^");
            to = this.group();
        } else if (head?.t === "let" && op?.v === "in") {
            v = head.v;
            const rest = toks.slice(2);
            if (rest[0]?.v === "{" && rest[0].t === "cmd") {
                // \{1, 2, 5\} : le terme, écrit pour chaque valeur
                const p = this.sub(rest.slice(1, rest.length - 1));
                const set = [p.expr()];
                while (p.eat(",")) set.push(p.expr());
                const body = this.boundTerm(v);
                const terms = set.map((x) => subst(body, v, x));
                if (c === "max" || c === "min") return fn(c, ...terms);
                return terms.reduce((a, b) => (c === "sum" ? add(a, b) : mul(a, b)));
            }
            const p = this.sub(rest);
            const list = p.primary();
            if (list.k !== "var" || p.peek()) throw new TexError(`\\${c}_{${v} \\in …} : une liste nommée (X) ou un ensemble \\{1, 2, 3\\}`);
            return { k: "each", op: c, v, list: list.v, body: this.boundTerm(v) };
        } else {
            // 1 \le i \le n, 0 \le i < n
            const p = this.sub(toks);
            from = p.expr();
            const o1 = p.next(), w = p.next(), o2 = p.next();
            if (!o1 || !CMP[o1.v] || w?.t !== "let" || !o2 || !CMP[o2.v]) throw new TexError(`\\${c} : l'indice (i = …) est attendu`);
            v = w.v;
            to = p.expr();
            if (o1.v === "<" || o1.v === "lt") from = add(from, ONE);
            if (o2.v === "<" || o2.v === "lt") to = sub(to, ONE);
        }
        const body = this.boundTerm(v);
        if (!to) {
            // \sum_i x_i : jusqu'au bout de la liste
            let found = null;
            walk(body, (m) => { if (!found && m.k === "idx") { const d = m.i.findIndex((x) => x.k === "var" && x.v === v); if (d >= 0) found = { k: "len", v: m.v, dim: d }; } });
            if (!found) throw new TexError(`\\${c}_${v} : quelle liste ? (x_${v} dans le terme, ou des bornes ${v}=1 … n)`);
            to = found;
        }
        if (infSign(from)) throw new TexError(`\\${c} : la somme commence à un nombre fini`);
        if (infSign(to) && (c === "max" || c === "min")) throw new TexError(`\\${c} : jusqu'à l'infini, ce n'est pas calculable`);
        return { k: "sum", op: c, v, from, to, body };
    }
    /** \int_a^b terme \,dx */
    integral() {
        let from = null, to = null;
        for (let k = 0; k < 2; k++) {
            if (this.eat("_")) from = this.group();
            else if (this.eat("^")) to = this.group();
        }
        if (!from || !to) throw new TexError("\\int : seules les intégrales avec leurs bornes (\\int_a^b) se calculent");
        this.intDepth++;
        let body;
        try { body = this.expr(); } finally { this.intDepth--; }
        let v;
        if (this.peek()?.t === "let" && this.peek().v === "d") { this.next(); v = this.next()?.v; }
        else if (this.peek()?.v === "mathrm") { this.next(); rawGroup(this); v = this.next()?.v; }
        if (!v) throw new TexError("\\int : le « dx » de la fin est attendu");
        const sa = infSign(from), sb = infSign(to);
        if (!sa && !sb) return { k: "int", v, from, to, body };
        // une borne infinie : un changement de variable ramène l'intégrale sur un intervalle fini
        // (Gauss-Legendre n'évalue pas les bords, où le changement de variable est infini)
        const t = fresh("t"), T = V(t);
        const r = div(T, sub(ONE, T)), jac = div(ONE, pow(sub(ONE, T), N(2)));
        if (sa === sb) throw new TexError("\\int : les deux bornes sont le même infini");
        if (sa === 0 && sb === 1) return { k: "int", v: t, from: ZERO, to: ONE, body: mul(subst(body, v, add(from, r)), jac) };
        if (sa === -1 && sb === 0) return { k: "int", v: t, from: ZERO, to: ONE, body: mul(subst(body, v, sub(to, r)), jac) };
        if (sa === 1 && sb === 0) return neg({ k: "int", v: t, from: ZERO, to: ONE, body: mul(subst(body, v, add(to, r)), jac) });
        if (sa === 0 && sb === -1) return neg({ k: "int", v: t, from: ZERO, to: ONE, body: mul(subst(body, v, sub(from, r)), jac) });
        // de -∞ à +∞ : x = t / (1 - t²)
        const q = sub(ONE, pow(T, N(2)));
        const whole = { k: "int", v: t, from: neg(ONE), to: ONE, body: mul(subst(body, v, div(T, q)), div(add(ONE, pow(T, N(2))), pow(q, N(2)))) };
        return sa === -1 ? whole : neg(whole);
    }
    /** \lim_{x \to a} terme : extrapolation de Richardson, de part et d'autre (a^+, a^- : d'un côté) */
    limit() {
        this.want("_");
        let toks = this.groupTokens();
        const v = toks[0];
        if (v?.t !== "let" || !["to", "rightarrow", "longrightarrow"].includes(toks[1]?.v)) throw new TexError("\\lim : « x \\to a » est attendu en indice");
        toks = toks.slice(2);
        // a^+, a^-, a^{+}
        let side = 0;
        const L = toks.length;
        if (L >= 2 && toks[L - 2].v === "^" && (toks[L - 1].v === "+" || toks[L - 1].v === "-")) { side = toks[L - 1].v === "+" ? 1 : -1; toks = toks.slice(0, L - 2); }
        else if (L >= 4 && toks[L - 4].v === "^" && toks[L - 3].v === "{" && (toks[L - 2].v === "+" || toks[L - 2].v === "-") && toks[L - 1].v === "}") { side = toks[L - 2].v === "+" ? 1 : -1; toks = toks.slice(0, L - 4); }
        const p = this.sub(toks);
        const a = p.expr();
        if (p.peek()) throw new TexError(`\\lim : « ${p.peek().v} » inattendu`);
        const body = this.boundTerm(v.v);
        const at = (x) => subst(body, v.v, x);
        const inf = infSign(a);
        // g(h) → la limite quand h → 0⁺ ; R2 : deux extrapolations (erreur en h³)
        const R2 = (g, h) => {
            const R1 = (k) => sub(mul(N(2), g(div(k, N(2)))), g(k));
            return div(sub(mul(N(4), R1(div(h, N(2)))), R1(h)), N(3));
        };
        const scale = inf ? ONE : fn("max", ONE, fn("abs", a));
        const g = inf ? (k) => at(div(N(inf), k)) : side ? (k) => at(side > 0 ? add(a, k) : sub(a, k)) : null;
        // des deux côtés : la moyenne n'a que des puissances paires de h, une extrapolation suffit (erreur en h⁴)
        const m = (k) => div(add(at(add(a, k)), at(sub(a, k))), N(2));
        const est = (h) => (g ? R2(g, h) : div(sub(mul(N(4), m(div(h, N(2)))), m(h)), N(3)));
        const h = (x) => mul(N(x), scale);
        // deux estimations qui s'accordent : la limite ; sinon (x ln x en 0, une convergence lente) : tout près du point
        const r1 = est(h("0.001")), r2 = est(h("0.0001"));
        const near = g ? g(h("1e-12")) : m(h("1e-9"));
        return { k: "cases", rows: [{ val: r2, cond: { k: "cmp", op: "<=", a: fn("abs", sub(r1, r2)), b: mul(N("1e-7"), fn("max", ONE, fn("abs", r2))) } }, { val: near, cond: null }] };
    }
    /** \frac{d}{dx} terme, \frac{d^2}{dx^2}, \frac{\partial^2}{\partial x \partial y}, \frac{df}{dx} → { k: "D" } ou null */
    derivative() {
        const save = this.i;
        const d = () => {
            const t = this.peek();
            if (t?.t === "let" && t.v === "d") { this.next(); return true; }
            if (t?.t === "cmd" && t.v === "partial") { this.next(); return true; }
            if (t?.t === "cmd" && t.v === "mathrm" && this.peek(1)?.v === "{" && this.peek(2)?.v === "d" && this.peek(3)?.v === "}") { this.i += 4; return true; }
            return false;
        };
        const order = () => {
            if (!this.eat("^")) return 1;
            const t = this.groupTokens();
            const n = t.length === 1 && t[0].t === "num" ? Number(t[0].v) : NaN;
            if (!(n >= 1 && n <= 4)) throw new TexError("une dérivée d'ordre 1 à 4");
            return n;
        };
        try {
            if (!this.eat("{") || !d()) throw 0;
            const n = order();
            let what = null;
            if (this.peek()?.t === "let" && this.peek(1)?.v === "}") what = this.next().v;
            else if (this.peek()?.t === "cmd" && GREEK.has(this.peek().v) && this.peek(1)?.v === "}") what = this.next().v;
            if (!this.eat("}") || !this.eat("{")) throw 0;
            const vars = [];
            while (d()) {
                const t = this.next();
                if (!t || !(t.t === "let" || (t.t === "cmd" && GREEK.has(t.v)))) throw 0;
                const k = order();
                for (let j = 0; j < k; j++) vars.push(t.v);
            }
            if (!vars.length || !this.eat("}")) throw 0;
            if (vars.length === 1 && n > 1) while (vars.length < n) vars.push(vars[0]);
            if (vars.length !== n) throw new TexError(`\\frac{d^${n}}{…} : ${n} variables sont attendues en bas`);
            const body = what ? V(what) : this.term();
            return { k: "D", vars, body };
        } catch (e) {
            if (e instanceof TexError) throw e;
            this.i = save;
            return null;
        }
    }
    /** \begin{cases}, \begin{pmatrix} … */
    environment() {
        const env = rawGroup(this);
        if (env === "cases" || env === "dcases") return this.cases();
        if (/^[pbBvV]?matrix\*?$|^array$/.test(env)) {
            if (env === "array") rawGroup(this);
            if (/^[vV]/.test(env)) throw new TexError("\\begin{vmatrix} (le déterminant) n'est pas encore compris");
            const rows = [];
            for (;;) {
                const cells = [this.expr()];
                while (this.eat("&")) cells.push(this.expr());
                rows.push(cells);
                if (this.eat("\\")) { if (this.is("end")) break; continue; }
                if (this.is("end")) break;
                throw new TexError(`\\begin{${env}} : « ${this.peek()?.v ?? "fin"} » inattendu`);
            }
            this.want("end");
            rawGroup(this);
            if (rows.length === 1) return { k: "list", items: rows[0] };
            if (rows.every((r) => r.length === 1)) return { k: "list", items: rows.map((r) => r[0]) };
            if (rows.some((r) => r.length !== rows[0].length)) throw new TexError(`\\begin{${env}} : toutes les lignes doivent avoir le même nombre de colonnes`);
            return { k: "list", items: rows.map((r) => ({ k: "list", items: r })) };
        }
        throw new TexError(`\\begin{${env}} n'est pas encore compris`);
    }
    /** \begin{cases} valeur & condition \\\\ … \end{cases} */
    cases() {
        const rows = [];
        for (;;) {
            const val = this.expr();
            let cond = null;
            if (this.eat("&")) cond = this.condition();
            rows.push({ val, cond });
            if (this.eat("\\")) { if (this.is("end")) break; continue; }
            if (this.is("end")) break;
            throw new TexError(`\\begin{cases} : « ${this.peek()?.v ?? "fin"} » inattendu`);
        }
        this.want("end");
        rawGroup(this);
        return { k: "cases", rows };
    }
    /** si x > 0 et x \le 1, \forall x \in X, x > 0, ou sinon → { k: "cmp" | "and" | "or" | "all" | "any" } ou null (sinon) */
    condition(first = null) {
        const word = () => {
            const w = this.peekWord();
            if (w) { if (["text", "mathrm", "textrm"].includes(this.peek().v)) { this.next(); rawGroup(this); } else this.next(); }
            return w;
        };
        let w = first ? null : word();
        if (w && ELSE.has(w)) { this.eat(","); this.eat("."); return null; }
        let or = null, and = null;
        for (;;) {
            let cmp = null;
            if (!first && (this.is("forall") || this.is("exists"))) {
                // \forall x \in X, condition
                const q = this.next().v, v = this.next();
                if (v?.t !== "let" || !this.eat("in")) throw new TexError(`\\${q} : « x \\in X » est attendu`);
                const list = this.primary();
                if (list.k !== "var") throw new TexError(`\\${q} x \\in X : une liste nommée`);
                this.eat(",") || this.eat(":") || this.eat("mid") || this.eat("colon");
                this.bound.push(v.v);
                let body;
                try { body = this.condition(); } finally { this.bound.pop(); }
                cmp = { k: q === "forall" ? "all" : "any", v: v.v, list: list.v, body };
            } else {
                let a = first || this.expr();
                first = null;
                while (this.peek() && CMP[this.peek().v] && this.peek().t !== "num") {
                    const op = CMP[this.next().v], b = this.expr();
                    const c = { k: "cmp", op, a, b };
                    cmp = cmp ? { k: "and", a: cmp, b: c } : c;
                    a = b;
                }
                if (!cmp) throw new TexError("une condition (x > 0, x \\le 1…) est attendue");
            }
            and = and ? { k: "and", a: and, b: cmp } : cmp;
            this.eat(",");
            w = this.peekWord();
            if (w && AND.has(w)) { word(); continue; }
            if (w && OR.has(w)) { word(); or = or ? { k: "or", a: or, b: and } : and; and = null; continue; }
            break;
        }
        this.eat(".");
        return or ? { k: "or", a: or, b: and } : and;
    }
    /**
     * Un nom : une lettre (avec son indice), un nom grec ; suivi de « ( », l'appel d'une autre formule (f'(x) : sa
     * dérivée). Dans une somme, x_i (l'indice parle de i) est le i-ième élément de la liste x.
     */
    name(base, whole = false) {
        let id = base;
        if (this.is("_")) {
            const save = this.i;
            this.next();
            const ix = this.bound.length ? this.indexOf() : null;
            if (ix) return elem(base, ...ix);
            this.i = save + 1;
            id += "_" + rawGroup(this).replace(/\\/g, "").replace(/\W+/g, "_");
        }
        let primes = 0;
        while (this.is("'")) { this.next(); primes++; }
        if (this.known.has(id) && this.is("(")) {
            this.next();
            const args = [];
            if (!this.is(")")) { args.push(this.expr()); while (this.eat(",")) args.push(this.expr()); }
            this.want(")");
            return primes ? { k: "dcall", f: id, order: primes, args } : { k: "call", f: id, args };
        }
        if (primes) throw new TexError(`${id}' : la dérivée d'une formule s'écrit avec ses arguments (${id}'(x))`);
        if (!whole && id === "e" && !this.known.has("e")) return { k: "const", v: "e" };
        return V(id);
    }
    /** L'indice d'un élément, s'il parle d'un indice de somme : i, i+1, ij, i,j → [expressions] ou null */
    indexOf() {
        const toks = this.groupTokens();
        const bound = new Set(this.bound);
        let out;
        if (toks.length > 1 && toks.every((t) => t.t === "let" && bound.has(t.v))) out = toks.map((t) => V(t.v));
        else {
            const p = this.sub(toks);
            try {
                out = [p.expr()];
                while (p.eat(",")) out.push(p.expr());
                if (p.peek()) return null;
            } catch { return null; }
        }
        return out.some((x) => freeVars(x).some((v) => bound.has(v))) ? out : null;
    }
}

/** « a = b » au premier niveau (pas dans \frac{…=…}) */
function splitEquals(tex) {
    let depth = 0;
    for (let i = 0; i < tex.length; i++) {
        const c = tex[i];
        if (c === "{" || c === "(") depth++;
        else if (c === "}" || c === ")") depth--;
        else if (c === "=" && depth === 0 && tex[i - 1] !== "\\" && tex[i - 1] !== "<" && tex[i - 1] !== ">" && tex[i + 1] !== "=") return [tex.slice(0, i).trim(), tex.slice(i + 1).trim()];
    }
    return null;
}

/** Le membre de gauche : « f(x, y) », « V_{boule}(r) », « g », « \Delta E(m) », « \bar{x} », « \vec{F}(t) » → { name, params } */
function parseHead(tex) {
    const accent = /^\s*\\(bar|overline|hat|widehat|tilde|widetilde|dot|ddot|vec|mathbf|boldsymbol|bm)\{\\?([A-Za-z]+)\}/.exec(tex);
    if (accent) tex = (ACCENTS[accent[1]] ? `${accent[2]}_${ACCENTS[accent[1]]}` : accent[2]) + tex.slice(accent[0].length);
    const m = /^\s*((?:\\[A-Za-z]+|[A-Za-z]\w*?)(?:_\{[^}]*\}|_[A-Za-z0-9]+)?|\\(?:mathrm|text|operatorname)\{[^}]+\}(?:_\{[^}]*\}|_[A-Za-z0-9])?)\s*(?:(?:\\left)?\(\s*(.*?)\s*(?:\\right)?\))?\s*$/.exec(tex);
    if (!m) return null;
    let name = m[1].replace(/\\(?:mathrm|text|operatorname)\{([^}]+)\}/, "$1").replace(/^\\/, "");
    name = name.replace(/_\{([^}]*)\}/, (_, s) => "_" + s.replace(/\\/g, "")).replace(/[^\w]/g, "_");
    if (!/^[A-Za-z]/.test(name) || FUNCS[name] === name) return null;
    // (les arguments : x, \vec{v}, \mathbf{A}, x_1)
    const params = m[2] != null ? m[2].split(",").map((p) => p.trim().replace(/^\\(?:vec|mathbf|boldsymbol|bm)\{\\?([^}]*)\}/, "$1").replace(/^\\/, "").replace(/_\{([^}]*)\}/, "_$1").replace(/[^\w]/g, "_")).filter(Boolean) : null;
    if (params && params.some((p) => !/^[A-Za-z]\w*$/.test(p))) return null;
    return { name, params };
}

// ---------------------------------------------------------------- dérivées

const has = (n, v) => freeVars(n).includes(v);

/** La dérivée de n par v, par différences finies (ce que les règles ne savent pas dériver) */
function numeric(n, v) {
    const h = mul(N("1e-5"), fn("max", ONE, fn("abs", V(v))));
    return div(sub(subst(n, v, add(V(v), h)), subst(n, v, sub(V(v), h))), mul(N(2), h));
}

/** La dérivée de n par v (les appels de formules déjà remplacés par leur corps) */
function diff(n, v) {
    const d = (x) => diff(x, v);
    if (!has(n, v)) return ZERO;
    const a = n.a, b = n.b;
    switch (n.k) {
        case "var": return n.v === v ? ONE : ZERO;
        case "add": return add(d(a), d(b));
        case "sub": return sub(d(a), d(b));
        case "neg": return neg(d(a));
        case "mul": return add(mul(d(a), b), mul(a, d(b)));
        case "div": return div(sub(mul(d(a), b), mul(a, d(b))), pow(b, N(2)));
        case "pow":
            if (!has(b, v)) return mul(mul(b, pow(a, sub(b, ONE))), d(a));
            if (!has(a, v)) return mul(mul(n, fn("ln", a)), d(b));
            return mul(n, add(mul(d(b), fn("ln", a)), div(mul(b, d(a)), a)));
        case "fn": {
            const x = n.args[0], dx = n.args.length === 1 ? d(x) : null;
            switch (n.f) {
                case "sin": return mul(fn("cos", x), dx);
                case "cos": return neg(mul(fn("sin", x), dx));
                case "tan": return div(dx, pow(fn("cos", x), N(2)));
                case "asin": return div(dx, fn("sqrt", sub(ONE, pow(x, N(2)))));
                case "acos": return neg(div(dx, fn("sqrt", sub(ONE, pow(x, N(2))))));
                case "atan": return div(dx, add(ONE, pow(x, N(2))));
                case "sinh": return mul(fn("cosh", x), dx);
                case "cosh": return mul(fn("sinh", x), dx);
                case "tanh": return div(dx, pow(fn("cosh", x), N(2)));
                case "exp": return mul(n, dx);
                case "ln": return div(dx, x);
                case "log10": return div(dx, mul(x, fn("ln", N(10))));
                case "sqrt": return div(dx, mul(N(2), n));
                case "abs": return mul(dx, div(x, n));
                case "re": case "im": case "conj": return fn(n.f, dx);
                default: return numeric(n, v);
            }
        }
        case "sum":
            if (n.op !== "sum" || has(n.from, v) || has(n.to, v) || n.v === v) return numeric(n, v);
            return { ...n, body: d(n.body) };
        case "each":
            if (n.op !== "sum" || n.v === v) return numeric(n, v);
            return { ...n, body: d(n.body) };
        case "int": {
            // Leibniz : la dérivée sous l'intégrale, et les bornes
            const inner = n.v === v ? ZERO : { ...n, body: d(n.body) };
            return sub(add(inner, mul(subst(n.body, n.v, n.to), d(n.to))), mul(subst(n.body, n.v, n.from), d(n.from)));
        }
        case "cases": return { ...n, rows: n.rows.map((r) => ({ val: d(r.val), cond: r.cond })) };
        default: return numeric(n, v);
    }
}

/** Simplifier un peu ce que la dérivation laisse (0 · x, x^1, 2 · 3…) */
function simplify(n) {
    return transform(n, (m) => {
        const a = m.a, b = m.b;
        const both = a && b && a.k === "num" && b.k === "num";
        const num = (x) => (Number.isFinite(x) && Math.abs(x) < 1e15 ? N(Number(x.toPrecision(15))) : null);
        switch (m.k) {
            case "add": if (both) return num(+a.v + +b.v) || m; if (isNum(a, 0)) return b; if (isNum(b, 0)) return a; return m;
            case "sub": if (both) return num(+a.v - +b.v) || m; if (isNum(b, 0)) return a; if (isNum(a, 0)) return neg(b); return m;
            case "mul":
                if (both) return num(+a.v * +b.v) || m;
                if (isNum(a, 0) || isNum(b, 0)) return ZERO;
                if (isNum(a, 1)) return b;
                if (isNum(b, 1)) return a;
                return m;
            case "div": if (isNum(a, 0)) return ZERO; if (isNum(b, 1)) return a; return m;
            case "pow": if (isNum(b, 1)) return a; if (isNum(b, 0)) return ONE; if (both) return num(Math.pow(+a.v, +b.v)) || m; return m;
            case "neg": if (a.k === "neg") return a.a; if (isNum(a, 0)) return ZERO; return m;
            case "int": case "each": return m.op !== "prod" && isNum(m.body, 0) ? ZERO : m;
            case "sum": return m.op === "sum" && isNum(m.body, 0) ? ZERO : m;
            default: return m;
        }
    });
}

// ---------------------------------------------------------------- les formules du document

/** Le sens des noms : constantes, fonctions, leurs arguments, ce qu'elles utilisent */
function classify(list, by) {
    const consts = new Set(list.filter((f) => !f.error && !f.head && freeVars(f.ast).every((v) => by.has(v) && v !== f.name)).map((f) => f.name));
    for (const f of list) {
        if (f.error) continue;
        f.free = freeVars(f.ast);
        const unknown = f.free.filter((v) => !(f.head || []).includes(v) && !consts.has(v) && !(by.has(v) && by.get(v) !== f && (by.get(v).head || by.get(v).kind === "fn")));
        if (!f.head) { f.kind = unknown.length ? "fn" : "const"; f.params = f.kind === "fn" ? unknown : []; f.outside = []; }
        else { f.kind = "fn"; f.params = f.head; f.outside = unknown; }
        f.uses = [...calls(f.ast), ...f.free.filter((v) => consts.has(v) && v !== f.name)];
    }
}

/**
 * Les définitions du document : chaque « $$ nom(args) = expression $$ » hors des blocs de code.
 * → [{ line, end, name, params, kind, ast, value, lists, complex, error, … }] (une redéfinition remplace la précédente)
 */
export function findFormulas(lines, inCode = () => false) {
    UID = 0;
    const eqs = [];
    for (let i = 0; i < lines.length; i++) {
        if (inCode(i)) continue;
        const t = lines[i].trim();
        let tex = null, at = i;
        const one = /^\$\$(.+?)\$\$\s*(?:\{#[\w:.-]+\})?\s*$/.exec(t);
        if (one) tex = one[1];
        else if (t === "$$") {
            const body = [];
            let j = i + 1;
            while (j < lines.length && !/^\$\$/.test(lines[j].trim())) body.push(lines[j++]);
            if (j < lines.length) { tex = body.join(" "); i = j; }
        }
        if (tex == null) continue;
        tex = tex.replace(/\\label\{[^}]*\}/g, "").replace(/[.,;]\s*$/, "").trim();
        const eq = splitEquals(tex);
        if (!eq) continue;
        const head = parseHead(eq[0]);
        if (!head) continue;
        eqs.push({ line: at, end: i, tex, lhs: eq[0], rhs: eq[1], name: head.name, head: head.params });
    }
    const known = new Set(eqs.filter((e) => e.head).map((e) => e.name));
    const by = new Map();
    for (const e of eqs) {
        try {
            const p = new Parser(tokenize(e.rhs), known);
            const ast = p.top();
            if (p.peek()) throw new TexError(`« ${p.peek().v} » inattendu`);
            by.set(e.name, { ...e, ast });
        } catch (err) {
            by.set(e.name, { ...e, error: err instanceof TexError ? err.message : String(err.message || err) });
        }
    }
    const list = [...by.values()];
    const live = () => list.filter((f) => !f.error);
    const guard = (f, work) => { try { work(); } catch (err) { f.error = err instanceof TexError ? err.message : String(err.message || err); } };

    for (const f of live()) guard(f, () => {
        // i : l'unité imaginaire, s'il n'est pas un argument
        if (!(f.head || []).includes("i") && freeVars(f.ast).includes("i")) f.ast = subst(f.ast, "i", I);
        // \sum_{i=1}^{n} x_i : n est la longueur de x (s'il n'est pas un argument)
        walk(f.ast, (m) => {
            if (m.k !== "sum" || m.to.k !== "var" || (f.head || []).includes(m.to.v)) return;
            let found = null;
            walk(m.body, (x) => { if (!found && x.k === "idx") { const d = x.i.findIndex((y) => y.k === "var" && y.v === m.v); if (d >= 0) found = { k: "len", v: x.v, dim: d }; } });
            if (found && !(f.autoLen || []).some(([n]) => n === m.to.v)) (f.autoLen = f.autoLen || []).push([m.to.v, found]);
        });
        for (const [n, len] of f.autoLen || []) f.ast = subst(f.ast, n, len);
    });
    classify(list, by);
    // une formule nommée sans ses arguments (\bar{x} dans la variance) : l'appel, avec les mêmes noms
    for (const f of live()) guard(f, () => {
        f.ast = transform(f.ast, (m, bound) => {
            const g = m.k === "var" && !bound.has(m.v) && m.v !== f.name ? by.get(m.v) : null;
            return g && !g.error && g.kind === "fn" ? { k: "call", f: g.name, args: g.params.map(V) } : m;
        });
    });
    classify(list, by);
    // les dérivées : les appels remplacés par le corps de la formule appelée, puis les règles de dérivation
    const inlined = new Map();
    const body = (name, depth = 0) => {
        const g = by.get(name);
        if (!g || g.error || g.kind !== "fn") throw new TexError(`${name} n'est pas une formule à dériver`);
        if (depth > 12) throw new TexError(`${name} : des formules qui s'appellent en boucle`);
        if (!inlined.has(name)) inlined.set(name, resolve(g.ast, depth + 1));
        return { params: g.params, ast: inlined.get(name) };
    };
    const callBody = (name, args, depth) => {
        const { params, ast } = body(name, depth);
        // d'abord des noms neufs, pour qu'un argument ne soit pas pris pour un autre
        const tmp = params.map(() => fresh("p"));
        let out = params.reduce((x, p, k) => subst(x, p, V(tmp[k])), ast);
        return tmp.reduce((x, p, k) => subst(x, p, args[k] || ZERO), out);
    };
    const inline = (n, depth) => transform(n, (m) => (m.k === "call" && by.get(m.f) && !by.get(m.f).error ? inline(callBody(m.f, m.args, depth), depth + 1) : m));
    const resolve = (n, depth = 0) => transform(n, (m) => {
        if (m.k === "D") return simplify(m.vars.reduce((x, v) => simplify(diff(x, v)), inline(m.body, depth)));
        if (m.k === "dcall") {
            // f'(a) : la dérivée de f par son premier argument, prise en a
            const { params, ast } = body(m.f, depth);
            if (!params.length) throw new TexError(`${m.f}' : ${m.f} n'a pas d'argument`);
            const tmp = params.map(() => fresh("p"));
            let x = inline(params.reduce((y, p, k) => subst(y, p, V(tmp[k])), ast), depth);
            for (let k = 0; k < m.order; k++) x = simplify(diff(x, tmp[0]));
            return tmp.reduce((y, p, k) => subst(y, p, m.args[k] || ZERO), x);
        }
        return m;
    });
    for (const f of live()) guard(f, () => {
        let found = false;
        walk(f.ast, (m) => { if (m.k === "D" || m.k === "dcall") found = true; });
        if (found) f.ast = resolve(f.ast);
    });
    classify(list, by);
    // les listes (et leur nombre d'indices), les nombres complexes
    for (const f of live()) f.lists = listsOf(f.ast);
    const cx0 = (n) => { let c = false; walk(n, (m) => { if ((m.k === "const" && m.v === "i") || (m.k === "fn" && ["re", "im", "arg", "conj"].includes(m.f))) c = true; }); return c; };
    for (const f of live()) f.complex = cx0(f.ast);
    for (let changed = true; changed;) {
        changed = false;
        for (const f of live()) if (!f.complex && [...f.uses].some((u) => by.get(u)?.complex)) { f.complex = true; changed = true; }
    }
    // le type du résultat : un nombre, une liste, une condition
    for (const f of live()) f.result = f.ast.k === "list" ? (f.ast.items.some((x) => x.k === "list") ? "matrix" : "vector") : ["cmp", "and", "or", "all", "any"].includes(f.ast.k) ? "bool" : "number";
    // une constante s'écrit par sa valeur, calculée ici : elle ne dépend plus de rien, dans aucun langage
    for (const f of list) {
        if (f.error || f.kind !== "const") continue;
        try {
            const v = evaluate(list.filter((x) => x !== f), emit(f.ast, ctx("javascript", f.complex)));
            if (!isValue(v)) throw new TexError("la valeur n'est pas un nombre fini");
            f.value = v;
            f.uses = [];
        } catch (e) { f.error = e instanceof TexError ? e.message : `ne se calcule pas (${e.message})`; }
    }
    return list;
}

/** Une valeur qu'on sait écrire : un nombre fini, un complexe, un booléen, une liste (de listes) de nombres */
const isComplex = (v) => v && typeof v === "object" && !Array.isArray(v) && typeof v.re === "number" && typeof v.im === "number";
function isValue(v) {
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "boolean") return true;
    if (isComplex(v)) return Number.isFinite(v.re) && Number.isFinite(v.im);
    return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" ? Number.isFinite(x) : Array.isArray(x) && x.length === v[0].length && x.every((y) => typeof y === "number" && Number.isFinite(y)));
}

/** Une valeur, à afficher : 9,81 ; 1 + 2i ; (1 ; 2 ; 3) ; vrai */
/** Un complexe sans ses restes d'arrondi : (1 + i)² = 2i, pas 1,2·10⁻¹⁶ + 2i */
function clean(v) {
    const t = 1e-12 * Math.max(1, Math.abs(v.re), Math.abs(v.im));
    return { re: Math.abs(v.re) < t ? 0 : v.re, im: Math.abs(v.im) < t ? 0 : v.im };
}

export function formatValue(v) {
    const n = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 10 });
    if (typeof v === "number") return n(v);
    if (typeof v === "boolean") return v ? "vrai" : "faux";
    if (isComplex(v)) v = clean(v);
    if (isComplex(v)) return v.im === 0 ? n(v.re) : `${v.re ? n(v.re) + (v.im < 0 ? " − " : " + ") : v.im < 0 ? "−" : ""}${Math.abs(v.im) === 1 ? "" : n(Math.abs(v.im))}i`;
    if (Array.isArray(v)) return `(${v.map((x) => (Array.isArray(x) ? `(${x.map(n).join(" ; ")})` : n(x))).join(" ; ")})`;
    return String(v);
}

// ---------------------------------------------------------------- écriture, langage par langage

const FN_REAL = {
    python: { sqrt: "_lx_m.sqrt", sin: "_lx_m.sin", cos: "_lx_m.cos", tan: "_lx_m.tan", asin: "_lx_m.asin", acos: "_lx_m.acos", atan: "_lx_m.atan",
        sinh: "_lx_m.sinh", cosh: "_lx_m.cosh", tanh: "_lx_m.tanh", exp: "_lx_m.exp", ln: "_lx_m.log", log10: "_lx_m.log10", abs: "abs",
        floor: "_lx_m.floor", ceil: "_lx_m.ceil", min: "min", max: "max" },
    javascript: { sqrt: "Math.sqrt", sin: "Math.sin", cos: "Math.cos", tan: "Math.tan", asin: "Math.asin", acos: "Math.acos", atan: "Math.atan",
        sinh: "_lx_sinh", cosh: "_lx_cosh", tanh: "_lx_tanh", exp: "Math.exp", ln: "Math.log", log10: "_lx_log10", abs: "Math.abs",
        floor: "Math.floor", ceil: "Math.ceil", min: "Math.min", max: "Math.max" },
    c: { sqrt: "__builtin_sqrt", sin: "__builtin_sin", cos: "__builtin_cos", tan: "__builtin_tan", asin: "__builtin_asin", acos: "__builtin_acos", atan: "__builtin_atan",
        sinh: "__builtin_sinh", cosh: "__builtin_cosh", tanh: "__builtin_tanh", exp: "__builtin_exp", ln: "__builtin_log", log10: "__builtin_log10", abs: "__builtin_fabs",
        floor: "__builtin_floor", ceil: "__builtin_ceil", min: "__builtin_fmin", max: "__builtin_fmax" },
    rust: { sqrt: ".sqrt", sin: ".sin", cos: ".cos", tan: ".tan", asin: ".asin", acos: ".acos", atan: ".atan", sinh: ".sinh", cosh: ".cosh", tanh: ".tanh",
        exp: ".exp", ln: ".ln", log10: ".log10", abs: ".abs", floor: ".floor", ceil: ".ceil", min: ".min", max: ".max" },
};
FN_REAL.cpp = FN_REAL.c;
const FN_CX = {
    python: { sqrt: "_lx_c.sqrt", sin: "_lx_c.sin", cos: "_lx_c.cos", tan: "_lx_c.tan", asin: "_lx_c.asin", acos: "_lx_c.acos", atan: "_lx_c.atan",
        sinh: "_lx_c.sinh", cosh: "_lx_c.cosh", tanh: "_lx_c.tanh", exp: "_lx_c.exp", ln: "_lx_c.log", log10: "_lx_c.log10", abs: "abs", arg: "_lx_c.phase" },
    javascript: { sqrt: "_lx_C.sqrt", sin: "_lx_C.sin", cos: "_lx_C.cos", tan: "_lx_C.tan", sinh: "_lx_C.sinh", cosh: "_lx_C.cosh", tanh: "_lx_C.tanh",
        exp: "_lx_C.exp", ln: "_lx_C.ln", log10: "_lx_C.log10", abs: "_lx_C.abs", arg: "_lx_C.arg", re: "_lx_C.re", im: "_lx_C.im", conj: "_lx_C.conj" },
    c: { sqrt: "__builtin_csqrt", sin: "__builtin_csin", cos: "__builtin_ccos", tan: "__builtin_ctan", asin: "__builtin_casin", acos: "__builtin_cacos", atan: "__builtin_catan",
        sinh: "__builtin_csinh", cosh: "__builtin_ccosh", tanh: "__builtin_ctanh", exp: "__builtin_cexp", ln: "__builtin_clog", abs: "__builtin_cabs", arg: "__builtin_carg",
        conj: "__builtin_conj", re: "__builtin_creal", im: "__builtin_cimag" },
    cpp: { sqrt: "std::sqrt", sin: "std::sin", cos: "std::cos", tan: "std::tan", asin: "std::asin", acos: "std::acos", atan: "std::atan", sinh: "std::sinh",
        cosh: "std::cosh", tanh: "std::tanh", exp: "std::exp", ln: "std::log", log10: "std::log10", abs: "std::abs", arg: "std::arg", conj: "std::conj", re: "std::real", im: "std::imag" },
    rust: { sqrt: ".sqrt", sin: ".sin", cos: ".cos", tan: ".tan", sinh: ".sinh", cosh: ".cosh", tanh: ".tanh", exp: ".exp", ln: ".ln", log10: ".log10", conj: ".conj" },
};
const CX_TYPE = { c: "_Complex double", cpp: "std::complex<double>" };
const GL = "0.28867513459481287"; // 1 / (2√3) : les deux points de Gauss-Legendre, dans chaque pas

const ctx = (lang, cx = false) => ({ lang, cx, C: lang === "c" || lang === "cpp" });

/** Une expression, écrite dans un langage. */
function emit(n, X) {
    const r = (x) => emit(x, X);
    const { lang, cx, C } = X;
    const num = (v) => (lang === "python" || lang === "javascript" || /[.eE]/.test(v) ? v : v + ".0");
    const rx = (s) => (cx && lang === "rust" ? `_LxC::r(${s})` : s); // un f64 de Rust, dans une formule complexe
    const nope = (what) => { throw new TexError(`${what} ne s'écrit pas en ${LANG_NAMES[lang]}`); };
    const realOf = (s) => (!cx ? s : lang === "python" ? `(${s}).real` : lang === "javascript" ? `_lx_C.re(${s})` : lang === "c" ? `__builtin_creal(${s})` : lang === "cpp" ? `std::real(${s})` : `(${s}).re`);
    const op = (o, a, b) => {
        if (cx && lang === "javascript") return `_lx_C.${{ "+": "add", "-": "sub", "*": "mul", "/": "div" }[o]}(${a}, ${b})`;
        return `(${a} ${o} ${b})`;
    };
    switch (n.k) {
        case "num": return rx(num(n.v));
        case "var": return n.v;
        case "const":
            if (n.v === "i") return { python: "1j", javascript: "_lx_C.I", c: "(1.0i)", cpp: "std::complex<double>(0.0, 1.0)", rust: "_LxC { re: 0.0, im: 1.0 }" }[lang];
            return rx(CONSTS[C ? "c" : lang][n.v]);
        case "inf": throw new TexError("∞ ne s'emploie qu'en borne (d'une somme, d'une intégrale, d'une limite)");
        case "add": return op("+", r(n.a), r(n.b));
        case "sub": return op("-", r(n.a), r(n.b));
        case "mul": return op("*", r(n.a), r(n.b));
        case "div": return op("/", r(n.a), r(n.b));
        case "neg": return cx && lang === "javascript" ? `_lx_C.neg(${r(n.a)})` : `(-${r(n.a)})`;
        case "pow": {
            const a = r(n.a), b = r(n.b);
            if (cx) return { python: `(${a}) ** (${b})`, javascript: `_lx_C.pow(${a}, ${b})`, c: `__builtin_cpow(${a}, ${b})`, cpp: `std::pow(${a}, ${b})`, rust: `(${a}).powc(${b})` }[lang];
            return { python: `(${a}) ** (${b})`, javascript: `Math.pow(${a}, ${b})`, c: `__builtin_pow(${a}, ${b})`, cpp: `__builtin_pow(${a}, ${b})`, rust: `(${a}).powf(${b})` }[lang];
        }
        case "fact": {
            const a = realOf(r(n.a));
            return { python: `_lx_m.gamma((${a}) + 1)`, javascript: `_lx_fact(${a})`, c: `__builtin_tgamma((${a}) + 1.0)`, cpp: `__builtin_tgamma((${a}) + 1.0)`,
                rust: rx(`(1..=((${a}) as i64)).map(|_k| _k as f64).product::<f64>()`) }[lang];
        }
        case "fn": {
            const args = n.args.map(r);
            if (cx) {
                if (lang === "python" && ["re", "im", "conj"].includes(n.f)) return `(${args[0]}).${{ re: "real", im: "imag", conj: "conjugate()" }[n.f]}`;
                if (lang === "rust") {
                    if (n.f === "re" || n.f === "im") return `_LxC::r((${args[0]}).${n.f})`;
                    if (n.f === "abs" || n.f === "arg") return `_LxC::r((${args[0]}).${n.f}())`;
                }
                if (lang === "c" && n.f === "log10") return `(__builtin_clog(${args[0]}) / 2.302585092994046)`;
                const f = FN_CX[lang][n.f];
                if (!f) nope(`\\${n.f} sur des nombres complexes`);
                return lang === "rust" ? `(${args[0]})${f}()` : `${f}(${args.join(", ")})`;
            }
            const f = FN_REAL[lang][n.f];
            if (!f) nope(`\\${n.f}`);
            if (lang === "rust") return `(${args[0]})${f}(${args.slice(1).join(", ")})`;
            if ((n.f === "min" || n.f === "max") && args.length > 2 && C) return args.reduce((x, y) => `${f}(${x}, ${y})`);
            return `${f}(${args.join(", ")})`;
        }
        case "call": return `${n.f}(${n.args.map(r).join(", ")})`;
        case "idx": {
            const ix = n.i.map((x) => realOf(r(x)));
            const one = { python: (i) => `[int(${i}) - 1]`, javascript: (i) => `[(${i}) - 1]`, c: (i) => `[(long)(${i}) - 1]`, cpp: (i) => `[(long)(${i}) - 1]`, rust: (i) => `[(${i}) as usize - 1]` }[lang];
            if (lang === "rust") return rx(n.v + ix.map(one).join(".as_ref()"));
            return (C ? `(${n.v})` : n.v) + ix.map(one).join("");
        }
        case "len": {
            const x = n.dim ? (lang === "rust" ? `${n.v}[0].as_ref()` : `${n.v}[0]`) : n.v;
            return { python: `len(${x})`, javascript: `${x}.length`, c: `((double)(sizeof(${x}) / sizeof((${x})[0])))`, cpp: `((double)std::size(${x}))`, rust: rx(`(${x}.len() as f64)`) }[lang];
        }
        case "list": {
            if (C) nope("une formule qui rend une liste");
            const items = n.items.map(r).join(", ");
            return lang === "rust" ? `vec![${items}]` : `[${items}]`;
        }
        case "sum": return loop(n, X, r);
        case "each": return each(n, X, r);
        case "int": return integral(n, X, r);
        case "cmp": return `(${realOf(r(n.a))} ${n.op} ${realOf(r(n.b))})`;
        case "and": case "or": return `(${r(n.a)} ${lang === "python" ? n.k : n.k === "and" ? "&&" : "||"} ${r(n.b)})`;
        case "all": case "any": {
            const q = n.k, b = r(n.body), L = n.list;
            if (lang === "python") return `${q}(${b} for ${n.v} in ${L})`;
            if (lang === "javascript") return `${L}.${q === "all" ? "every" : "some"}(function (${n.v}) { return ${b}; })`;
            if (lang === "rust") { if (cx) nope("\\forall dans une formule complexe"); return `${L}.iter().${q}(|&${n.v}| ${b})`; }
            return `({ int _lx_r = ${q === "all" ? 1 : 0}; for (unsigned long _lx_j = 0; _lx_j < (unsigned long)${emit({ k: "len", v: L, dim: 0 }, X)}; _lx_j++) { double ${n.v} = (${L})[_lx_j]; if (${q === "all" ? "!" : ""}(${b})) { _lx_r = ${q === "all" ? 0 : 1}; break; } } _lx_r; })`;
        }
        case "cases": {
            const nan = rx({ python: 'float("nan")', javascript: "NaN", c: '__builtin_nan("")', cpp: '__builtin_nan("")', rust: "std::f64::NAN" }[lang]);
            const rest = n.rows.find((x) => !x.cond);
            return n.rows.filter((x) => x.cond).reduceRight((acc, x) => {
                const c = r(x.cond), a = r(x.val);
                return lang === "python" ? `(${a} if ${c} else ${acc})` : lang === "rust" ? `(if ${c} { ${a} } else { ${acc} })` : `(${c} ? ${a} : ${acc})`;
            }, rest ? r(rest.val) : nan);
        }
        default: throw new TexError(`(${n.k})`);
    }
}
const CONSTS = { python: { pi: "_lx_m.pi", e: "_lx_m.e" }, javascript: { pi: "Math.PI", e: "Math.E" }, c: { pi: "3.14159265358979323846", e: "2.71828182845904523536" },
    rust: { pi: "std::f64::consts::PI", e: "std::f64::consts::E" } };
const LANG_NAMES = { python: "Python", javascript: "JavaScript", c: "C", cpp: "C++", rust: "Rust" };

/** Le départ et le pas d'une accumulation : somme, produit, maximum, minimum */
function acc(op, X, s, t) {
    const { lang, cx, C } = X;
    if (cx && (op === "max" || op === "min")) throw new TexError(`\\${op} de nombres complexes n'a pas de sens`);
    if (lang === "javascript") return op === "sum" ? (cx ? `_lx_C.add(${s}, ${t})` : `${s} + (${t})`) : op === "prod" ? (cx ? `_lx_C.mul(${s}, ${t})` : `${s} * (${t})`) : `Math.${op}(${s}, ${t})`;
    if (C) return op === "sum" ? `${s} + (${t})` : op === "prod" ? `${s} * (${t})` : `__builtin_f${op}(${s}, ${t})`;
    return null;
}
const INIT = { sum: "0", prod: "1", max: "-Infinity", min: "Infinity" };
const C_INIT = { sum: "0.0", prod: "1.0", max: "-__builtin_inf()", min: "__builtin_inf()" };

/** \sum_{v=a}^{b} : une boucle (jusqu'à \infty : jusqu'à ce que les termes ne changent plus rien) */
function loop(n, X, r) {
    const { lang, cx, C } = X;
    const v = n.v, op = n.op, a = r(n.from), body = r(n.body);
    const T = C ? (cx ? CX_TYPE[lang] : "double") : null;
    if (infSign(n.to)) {
        if (lang === "python") return `_lx_suminf(lambda ${v}: ${body}, ${a}, "${op}")`;
        if (lang === "javascript") return `_lx_suminf(function (${v}) { return ${body}; }, ${a}, "${op}")`;
        if (C) return `({ ${T} _lx_s = ${C_INIT[op]}, _lx_t = 0.0; int _lx_z = 0; long _lx_a = (long)(${cx ? `${lang === "c" ? "__builtin_creal" : "std::real"}(${a})` : a}); for (long _lx_n = 0; _lx_n < 1000000 && _lx_z < 10; _lx_n++) { double ${v} = (double)(_lx_a + _lx_n); _lx_t = (${body}); ${T} _lx_u = ${acc(op, X, "_lx_s", "_lx_t")}; _lx_z = _lx_u == _lx_s ? _lx_z + 1 : 0; _lx_s = _lx_u; } _lx_z < 10 && ${op === "sum" ? 1 : 0} ? _lx_s - _lx_t / 2.0 : _lx_s; })`;
        if (cx) throw new TexError("une somme infinie de nombres complexes ne s'écrit pas encore en Rust");
        return `{ let (mut _lx_s, mut _lx_t, mut _lx_z) = (${op === "sum" ? "0.0" : "1.0"}f64, 0.0f64, 0); let _lx_a = (${a}) as i64; for _lx_n in 0..1000000i64 { let ${v} = (_lx_a + _lx_n) as f64; _lx_t = ${body}; let _lx_u = _lx_s ${op === "sum" ? "+" : "*"} _lx_t; _lx_z = if _lx_u == _lx_s { _lx_z + 1 } else { 0 }; _lx_s = _lx_u; if _lx_z >= 10 { break; } } if _lx_z < 10 && ${op === "sum"} { _lx_s - _lx_t / 2.0 } else { _lx_s } }`;
    }
    const b = r(n.to);
    if (lang === "python") {
        const range = `range(int(${cx ? `(${a}).real` : a}), int(${cx ? `(${b}).real` : b}) + 1)`;
        if (op === "prod") return `_lx_reduce(lambda _lx_p, ${v}: _lx_p * (${body}), ${range}, 1)`;
        if (cx && op !== "sum") throw new TexError(`\\${op} de nombres complexes n'a pas de sens`);
        return `${op}(${body} for ${v} in ${range})`;
    }
    if (lang === "javascript") return `(function (_a, _b) { var _s = ${INIT[op]}; for (var ${v} = Math.trunc(_a); ${v} <= _b; ${v}++) _s = ${acc(op, X, "_s", body)}; return _s; })(${cx ? `_lx_C.re(${a})` : a}, ${cx ? `_lx_C.re(${b})` : b})`;
    if (C) {
        const re = (s) => (cx ? `${lang === "c" ? "__builtin_creal" : "std::real"}(${s})` : s);
        return `({ ${T} _lx_s = ${C_INIT[op]}; long _lx_b = (long)(${re(b)}); for (double ${v} = (double)(long)(${re(a)}); ${v} <= _lx_b; ${v}++) _lx_s = ${acc(op, X, "_lx_s", body)}; _lx_s; })`;
    }
    // Rust
    const range = `((${cx ? `(${a}).re` : a}) as i64..=(${cx ? `(${b}).re` : b}) as i64).map(|${v}| { let ${v} = ${cx ? `_LxC::r(${v} as f64)` : `${v} as f64`}; ${body} })`;
    if (cx) { if (op === "max" || op === "min") throw new TexError(`\\${op} de nombres complexes n'a pas de sens`); return `${range}.fold(_LxC::r(${op === "sum" ? "0.0" : "1.0"}), |_s, _t| _s ${op === "sum" ? "+" : "*"} _t)`; }
    return range + { sum: ".sum::<f64>()", prod: ".product::<f64>()", max: ".fold(std::f64::NEG_INFINITY, f64::max)", min: ".fold(std::f64::INFINITY, f64::min)" }[op];
}

/** \sum_{x \in X} : sur les éléments d'une liste */
function each(n, X, r) {
    const { lang, cx, C } = X;
    const v = n.v, op = n.op, L = n.list, body = r(n.body);
    if (lang === "python") {
        if (op === "prod") return `_lx_reduce(lambda _lx_p, ${v}: _lx_p * (${body}), ${L}, 1)`;
        return `${op}(${body} for ${v} in ${L})`;
    }
    if (lang === "javascript") return `(function (_l) { var _s = ${INIT[op]}; for (var _j = 0; _j < _l.length; _j++) { var ${v} = _l[_j]; _s = ${acc(op, X, "_s", body)}; } return _s; })(${L})`;
    if (C) return `({ ${cx ? CX_TYPE[lang] : "double"} _lx_s = ${C_INIT[op]}; for (unsigned long _lx_j = 0; _lx_j < (unsigned long)${emit({ k: "len", v: L, dim: 0 }, X)}; _lx_j++) { double ${v} = (${L})[_lx_j]; _lx_s = ${acc(op, X, "_lx_s", body)}; } _lx_s; })`;
    if (cx) throw new TexError("les listes dans une formule complexe ne s'écrivent pas encore en Rust");
    return `${L}.iter().map(|&${v}| ${body})` + { sum: ".sum::<f64>()", prod: ".product::<f64>()", max: ".fold(std::f64::NEG_INFINITY, f64::max)", min: ".fold(std::f64::INFINITY, f64::min)" }[op];
}

/** \int_a^b : Gauss-Legendre à deux points, sur 1000 pas (exacte pour les polynômes de degré 3, et les bords ne sont pas évalués) */
function integral(n, X, r) {
    const { lang, cx, C } = X;
    const v = n.v, a = r(n.from), b = r(n.to), body = r(n.body);
    if (lang === "python") return `(lambda _lx_a, _lx_b: (_lx_b - _lx_a) / 2000 * sum((lambda ${v}: ${body})(_lx_a + (_lx_b - _lx_a) * (_lx_k + 0.5 + _lx_q * ${GL}) / 1000) for _lx_k in range(1000) for _lx_q in (-1, 1)))(${cx ? `(${a}).real` : a}, ${cx ? `(${b}).real` : b})`;
    if (lang === "javascript") return `(function (_a, _b) { var _h = (_b - _a) / 1000, _s = 0; for (var _k = 0; _k < 1000; _k++) for (var _q = -1; _q <= 1; _q += 2) { var ${v} = _a + (_k + 0.5 + _q * ${GL}) * _h; _s = ${cx ? `_lx_C.add(_s, ${body})` : `_s + (${body})`}; } return ${cx ? "_lx_C.mul(_s, _h / 2)" : "_s * _h / 2"}; })(${cx ? `_lx_C.re(${a})` : a}, ${cx ? `_lx_C.re(${b})` : b})`;
    if (C) {
        const re = (s) => (cx ? `${lang === "c" ? "__builtin_creal" : "std::real"}(${s})` : s);
        return `({ double _lx_a = (${re(a)}), _lx_h = ((${re(b)}) - _lx_a) / 1000.0; ${cx ? CX_TYPE[lang] : "double"} _lx_i = 0.0; for (int _lx_k = 0; _lx_k < 1000; _lx_k++) for (int _lx_q = -1; _lx_q <= 1; _lx_q += 2) { double ${v} = _lx_a + (_lx_k + 0.5 + _lx_q * ${GL}) * _lx_h; _lx_i += (${body}); } _lx_i * (_lx_h / 2.0); })`;
    }
    const pt = `_lx_a + ((_lx_k / 2) as f64 + 0.5 + (if _lx_k % 2 == 0 { -1.0 } else { 1.0 }) * ${GL}) * _lx_h`;
    if (cx) return `{ let _lx_a: f64 = (${a}).re; let _lx_h = ((${b}).re - _lx_a) / 1000.0; (0..2000i64).map(|_lx_k| { let ${v} = _LxC::r(${pt}); ${body} }).fold(_LxC::r(0.0), |_s, _t| _s + _t) * _LxC::r(_lx_h / 2.0) }`;
    return `{ let _lx_a: f64 = ${a}; let _lx_h = ((${b}) - _lx_a) / 1000.0; (0..2000i64).map(|_lx_k| { let ${v} = ${pt}; ${body} }).sum::<f64>() * _lx_h / 2.0 }`;
}

// ---------------------------------------------------------------- les définitions

/** Une valeur calculée, écrite comme une constante du langage */
function literal(v, lang) {
    const num = (x) => { const s = String(x); return lang === "python" || lang === "javascript" || /[.eE]/.test(s) ? s : s + ".0"; };
    if (typeof v === "boolean") return lang === "python" ? (v ? "True" : "False") : lang === "c" || lang === "cpp" ? (v ? "1" : "0") : String(v);
    if (isComplex(v)) v = clean(v);
    if (isComplex(v)) return { python: `complex(${v.re}, ${v.im})`, javascript: `_lx_C.z(${v.re}, ${v.im})`, c: `(${num(v.re)} + ${num(v.im)} * 1.0i)`,
        cpp: `std::complex<double>(${num(v.re)}, ${num(v.im)})`, rust: `_LxC { re: ${num(v.re)}, im: ${num(v.im)} }` }[lang];
    if (Array.isArray(v)) {
        const inner = v.map((x) => literal(x, lang)).join(", ");
        return lang === "c" || lang === "cpp" ? `{${inner}}` : `[${inner}]`;
    }
    return num(v);
}

function define(f, lang) {
    const X = ctx(lang, f.complex);
    const cx = f.complex;
    const ps = f.params;
    const lists = f.lists || new Map();
    if (f.kind === "const" && f.value != null) {
        const v = f.value, lit = literal(v, lang);
        if (Array.isArray(v)) {
            const dims = Array.isArray(v[0]) ? [v.length, v[0].length] : [v.length];
            if (lang === "python") return `${f.name} = ${lit}`;
            if (lang === "javascript") return `var ${f.name} = ${lit};`;
            if (lang === "c" || lang === "cpp") return `static const double ${f.name}${dims.map((d) => `[${d}]`).join("")} = ${lit};`;
            return `#[allow(dead_code, non_upper_case_globals)] const ${f.name}: ${dims.reduceRight((t, d) => `[${t}; ${d}]`, "f64")} = ${lit};`;
        }
        if (lang === "python") return `${f.name} = ${lit}`;
        if (lang === "javascript") return `var ${f.name} = ${lit};`;
        if (lang === "c" || lang === "cpp") return `#define ${f.name} (${lit})`;
        const type = typeof v === "boolean" ? "bool" : isComplex(v) ? "_LxC" : "f64";
        return `#[allow(dead_code, non_upper_case_globals)] const ${f.name}: ${type} = ${lit};`;
    }
    const body = emit(f.ast, X);
    if (lang === "python") return f.kind === "const" ? `${f.name} = ${body}` : `def ${f.name}(${ps.join(", ")}):\n    return ${body}`;
    if (lang === "javascript") return f.kind === "const" ? `var ${f.name} = ${body};` : `function ${f.name}(${ps.join(", ")}) { return ${body}; }`;
    if (lang === "c" || lang === "cpp") {
        // une macro : hors de main(), sans en-tête, et la jonction ne la prend pas pour une variable
        if (f.kind === "const") return `#define ${f.name} (${body})`;
        let b = body;
        const as = cx ? (lang === "c" ? "(_Complex double)" : "std::complex<double>") : "(double)";
        for (const p of ps) if (!lists.has(p)) b = b.replace(new RegExp(`\\b${p}\\b`, "g"), `(${as}(${p}))`);
        return `#define ${f.name}(${ps.join(", ")}) (${b})`;
    }
    if (lang === "rust") {
        const num = cx ? "_LxC" : "f64";
        const ret = f.result === "bool" ? "bool" : f.result === "vector" ? `Vec<${num}>` : f.result === "matrix" ? `Vec<Vec<${num}>>` : num;
        if (f.kind === "const") return `#[allow(dead_code, non_upper_case_globals, unused_parens)] fn ${f.name}() -> ${ret} { ${body} }`;
        const gens = [], args = [], lets = [];
        ps.forEach((p, k) => {
            const d = lists.get(p) || 0;
            if (d === 2) gens.push(`R${k}: AsRef<[f64]>`, `T${k}: AsRef<[R${k}]>`);
            else gens.push(`T${k}: ${d ? "AsRef<[f64]>" : `Into<${num}>`}`);
            args.push(`${p}: T${k}`);
            lets.push(d ? `let ${p} = ${p}.as_ref();` : `let ${p}: ${num} = ${p}.into();`);
        });
        return `#[allow(dead_code, non_snake_case, unused_parens)] fn ${f.name}<${gens.join(", ")}>(${args.join(", ")}) -> ${ret} { ${lets.join(" ")} ${body} }`;
    }
    return null;
}

export const FORMULA_LANGS = ["python", "javascript", "c", "cpp", "rust"];

const PY_HELPERS = `import math as _lx_m
import cmath as _lx_c
from functools import reduce as _lx_reduce
def _lx_suminf(f, a, op):
    s, t, z = (0 if op == "sum" else 1), 0, 0
    for n in range(1000000):
        t = f(int(a) + n)
        u = s + t if op == "sum" else s * t
        z = z + 1 if u == s else 0
        s = u
        if z >= 10:
            return s
    return s - t / 2 if op == "sum" else s`;

const JS_HELPERS = [
    "function _lx_log10(x) { return Math.log(x) / Math.LN10; }",
    "function _lx_sinh(x) { return (Math.exp(x) - Math.exp(-x)) / 2; }",
    "function _lx_cosh(x) { return (Math.exp(x) + Math.exp(-x)) / 2; }",
    "function _lx_tanh(x) { return _lx_sinh(x) / _lx_cosh(x); }",
    "function _lx_fact(n) { var r = 1; for (var k = 2; k <= n; k++) r *= k; return r; }",
    // les nombres complexes : des { re, im }, et les nombres ordinaires restent des nombres
    `var _lx_C = (function () {
    function Z(re, im) { this.re = re; this.im = im; }
    Z.prototype.toString = function () { var r = this.re, i = this.im; return i === 0 ? String(r) : r === 0 ? i + "i" : r + (i < 0 ? " - " : " + ") + Math.abs(i) + "i"; };
    try { Z.prototype[Symbol.for("nodejs.util.inspect.custom")] = Z.prototype.toString; } catch (e) {}
    function z(x) { return x instanceof Z ? x : new Z(+x, 0); }
    function real(a, b) { return typeof a === "number" && (b === undefined || typeof b === "number"); }
    var C = {
        Z: Z, I: new Z(0, 1), z: function (re, im) { return new Z(re, im); },
        add: function (a, b) { if (real(a, b)) return a + b; a = z(a); b = z(b); return new Z(a.re + b.re, a.im + b.im); },
        sub: function (a, b) { if (real(a, b)) return a - b; a = z(a); b = z(b); return new Z(a.re - b.re, a.im - b.im); },
        mul: function (a, b) { if (real(a, b)) return a * b; a = z(a); b = z(b); return new Z(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); },
        div: function (a, b) { if (real(a, b)) return a / b; a = z(a); b = z(b); var d = b.re * b.re + b.im * b.im; return new Z((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); },
        neg: function (a) { return real(a) ? -a : new Z(-a.re, -a.im); },
        exp: function (a) { if (real(a)) return Math.exp(a); var m = Math.exp(a.re); return new Z(m * Math.cos(a.im), m * Math.sin(a.im)); },
        ln: function (a) { if (real(a) && a >= 0) return Math.log(a); a = z(a); return new Z(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re)); },
        log10: function (a) { return C.div(C.ln(a), Math.LN10); },
        pow: function (a, b) { if (real(a, b) && (a >= 0 || Number.isInteger(b))) return Math.pow(a, b); a = z(a); if (a.re === 0 && a.im === 0) return 0; return C.exp(C.mul(b, C.ln(a))); },
        sqrt: function (a) { return real(a) && a >= 0 ? Math.sqrt(a) : C.pow(a, 0.5); },
        sin: function (a) { if (real(a)) return Math.sin(a); return new Z(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im)); },
        cos: function (a) { if (real(a)) return Math.cos(a); return new Z(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im)); },
        tan: function (a) { return C.div(C.sin(a), C.cos(a)); },
        sinh: function (a) { return C.div(C.sub(C.exp(a), C.exp(C.neg(a))), 2); },
        cosh: function (a) { return C.div(C.add(C.exp(a), C.exp(C.neg(a))), 2); },
        tanh: function (a) { return C.div(C.sinh(a), C.cosh(a)); },
        abs: function (a) { return real(a) ? Math.abs(a) : Math.hypot(a.re, a.im); },
        arg: function (a) { return real(a) ? (a < 0 ? Math.PI : 0) : Math.atan2(a.im, a.re); },
        conj: function (a) { return real(a) ? a : new Z(a.re, -a.im); },
        re: function (a) { return real(a) ? a : a.re; },
        im: function (a) { return real(a) ? 0 : a.im; },
        eq: function (a, b) { a = z(a); b = z(b); return a.re === b.re && a.im === b.im; },
    };
    return C;
})();`,
    `function _lx_suminf(f, a, op) {
    var C = _lx_C, s = op === "sum" ? 0 : 1, t = 0, z = 0;
    for (var n = 0; n < 1000000; n++) {
        t = f(Math.trunc(a) + n);
        var u = op === "sum" ? C.add(s, t) : C.mul(s, t);
        z = C.eq(u, s) ? z + 1 : 0;
        s = u;
        if (z >= 10) return s;
    }
    return op === "sum" ? C.sub(s, C.mul(t, 0.5)) : s;
}`,
].join("\n");

const RUST_COMPLEX = [
    "#[derive(Clone, Copy, Debug, PartialEq)] #[allow(non_camel_case_types)] struct _LxC { re: f64, im: f64 }",
    "#[allow(dead_code)] impl _LxC { fn r(_lx_x: f64) -> _LxC { _LxC { re: _lx_x, im: 0.0 } } fn abs(self) -> f64 { self.re.hypot(self.im) } fn arg(self) -> f64 { self.im.atan2(self.re) } fn conj(self) -> _LxC { _LxC { re: self.re, im: -self.im } } fn exp(self) -> _LxC { let _lx_m = self.re.exp(); _LxC { re: _lx_m * self.im.cos(), im: _lx_m * self.im.sin() } } fn ln(self) -> _LxC { _LxC { re: self.abs().ln(), im: self.arg() } } fn log10(self) -> _LxC { self.ln() / _LxC::r(std::f64::consts::LN_10) } fn powc(self, _lx_w: _LxC) -> _LxC { if self.re == 0.0 && self.im == 0.0 { _LxC::r(0.0) } else { (_lx_w * self.ln()).exp() } } fn sqrt(self) -> _LxC { self.powc(_LxC::r(0.5)) } fn sin(self) -> _LxC { _LxC { re: self.re.sin() * self.im.cosh(), im: self.re.cos() * self.im.sinh() } } fn cos(self) -> _LxC { _LxC { re: self.re.cos() * self.im.cosh(), im: -self.re.sin() * self.im.sinh() } } fn tan(self) -> _LxC { self.sin() / self.cos() } fn sinh(self) -> _LxC { (self.exp() - (-self).exp()) / _LxC::r(2.0) } fn cosh(self) -> _LxC { (self.exp() + (-self).exp()) / _LxC::r(2.0) } fn tanh(self) -> _LxC { self.sinh() / self.cosh() } }",
    "impl std::ops::Add for _LxC { type Output = _LxC; fn add(self, _lx_o: _LxC) -> _LxC { _LxC { re: self.re + _lx_o.re, im: self.im + _lx_o.im } } }",
    "impl std::ops::Sub for _LxC { type Output = _LxC; fn sub(self, _lx_o: _LxC) -> _LxC { _LxC { re: self.re - _lx_o.re, im: self.im - _lx_o.im } } }",
    "impl std::ops::Mul for _LxC { type Output = _LxC; fn mul(self, _lx_o: _LxC) -> _LxC { _LxC { re: self.re * _lx_o.re - self.im * _lx_o.im, im: self.re * _lx_o.im + self.im * _lx_o.re } } }",
    "impl std::ops::Div for _LxC { type Output = _LxC; fn div(self, _lx_o: _LxC) -> _LxC { let _lx_d = _lx_o.re * _lx_o.re + _lx_o.im * _lx_o.im; _LxC { re: (self.re * _lx_o.re + self.im * _lx_o.im) / _lx_d, im: (self.im * _lx_o.re - self.re * _lx_o.im) / _lx_d } } }",
    "impl std::ops::Neg for _LxC { type Output = _LxC; fn neg(self) -> _LxC { _LxC { re: -self.re, im: -self.im } } }",
    "impl From<f64> for _LxC { fn from(_lx_x: f64) -> _LxC { _LxC::r(_lx_x) } } impl From<i32> for _LxC { fn from(_lx_x: i32) -> _LxC { _LxC::r(_lx_x as f64) } }",
    "impl std::fmt::Display for _LxC { fn fmt(&self, _lx_f: &mut std::fmt::Formatter) -> std::fmt::Result { if self.im == 0.0 { write!(_lx_f, \"{}\", self.re) } else if self.re == 0.0 { write!(_lx_f, \"{}i\", self.im) } else { write!(_lx_f, \"{} {} {}i\", self.re, if self.im < 0.0 { \"-\" } else { \"+\" }, self.im.abs()) } } }",
];

/**
 * Ce qu'il faut ajouter à un bloc pour qu'il appelle les formules qu'il nomme. Python et JavaScript (qui gardent
 * leur état) : { prelude }, à exécuter juste avant le bloc. C, C++, Rust : { lines, count }, des lignes à mettre en
 * tête (count : leur nombre, pour recaler les numéros de ligne des erreurs). { error } si une formule ne s'écrit pas.
 */
export function injection(formulas, lang, code) {
    if (!FN_REAL[lang] || !formulas.length) return null;
    const ok = new Map(formulas.filter((f) => !f.error).map((f) => [f.name, f]));
    const strip = code.replace(lang === "python" ? /#[^\n]*/g : /\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    // les formules nommées par le bloc, sans celles qu'il définit lui-même
    const own = (n) => new RegExp(lang === "python" ? `^\\s*(def\\s+${n}\\b|${n}\\s*=[^=])` : `\\b(double|float|int|long|auto|let|var|const|fn|function)\\s+(mut\\s+)?${n}\\b`, "m").test(strip);
    const want = [...ok.keys()].filter((n) => new RegExp(`(^|[^\\w.])${n}\\b`).test(strip) && !own(n));
    if (!want.length) return null;
    // et celles dont elles ont besoin, dans l'ordre
    const order = [], seen = new Set();
    const visit = (n) => { if (seen.has(n) || !ok.has(n)) return; seen.add(n); for (const u of ok.get(n).uses || []) visit(u); order.push(ok.get(n)); };
    want.forEach(visit);
    const defs = [];
    for (const f of order) { try { defs.push(define(f, lang)); } catch (e) { return { error: `${f.name} : ${e.message}` }; } }
    const complex = order.some((f) => f.complex || isComplex(f.value));
    // (parts : les morceaux du prélude, que la page n'envoie au noyau que s'il ne les a pas déjà)
    if (lang === "python") return { prelude: `${PY_HELPERS}\n${defs.join("\n")}`, parts: [PY_HELPERS, ...defs], names: want };
    if (lang === "javascript") return { prelude: `${JS_HELPERS}\n${defs.join("\n")}`, parts: [JS_HELPERS, ...defs], names: want };
    const head = lang === "cpp" && complex ? ["#include <complex>"] : lang === "rust" && complex ? RUST_COMPLEX : [];
    const lines = [...head, ...defs];
    return { lines, count: lines.length, names: want };
}

/** La signature d'une formule, pour l'afficher : « f(x, y) », « moyenne(x[]) », « g » */
export const signature = (f) => (f.kind === "fn" ? `${f.name}(${f.params.map((p) => p + "[]".repeat(f.lists?.get(p) || 0)).join(", ")})` : f.name);

/** Évaluer une formule tout de suite (dans la page) : pour l'aperçu, et {{f(10, 16)}} dans le texte. */
export function evaluate(formulas, expr, scope = {}) {
    const ok = formulas.filter((f) => !f.error && f.kind);
    const src = ok.map((f) => define(f, "javascript")).join("\n");
    const names = Object.keys(scope).filter((k) => /^[A-Za-z_]\w*$/.test(k));
    // eslint-disable-next-line no-new-func
    return new Function(...names, `"use strict"; ${JS_HELPERS}\n${src}\nreturn (${expr});`)(...names.map((k) => scope[k]));
}

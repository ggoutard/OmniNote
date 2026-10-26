// Grama Lectica — exécution : l'arbre de syntaxe s'évalue directement, dans la page.
//
// Valeurs : nombres, textes, vrai/faux, listes, fonctions définies par une phrase, et fiches : les objets
// d'une classe (« un appartement a un loyer… »). Une liste est une valeur (la modifier en crée une autre) ;
// une fiche est un objet partagé : une action qui la reçoit peut changer ses champs, comme une méthode.
// Le document s'exécute de haut en bas, dans un même environnement : une phrase voit ce que les phrases
// d'avant ont défini. Seul « affiche » produit une sortie ; une erreur est rattachée à l'endroit du texte en cause.

export class Fault extends Error {
    constructor(msg, at, end) { super(msg); this.at = at; this.end = end; }
}
class Returned { constructor(value) { this.value = value; } }

// Les deux moteurs (cette page et le C++) comptent de la même façon : un tour de boucle ou un appel d'action
// est un pas ; au-delà de LIMIT, la phrase s'arrête. Au-delà de MAX_LINES lignes, on ne compte plus que le reste.
const LIMIT = 200000;
const MAX_LINES = 1000;

/** Un objet d'une classe : ses champs, dans l'ordre de la classe (ceux qui n'ont pas encore de valeur sont absents). */
export class Fiche {
    constructor(cls) { this.cls = cls; this.vals = new Map(); }
}
const label = (n) => n.replace(/_/g, " ");
const DEEP = 16;   // une fiche peut se contenir elle-même : au-delà, « … »

const nameOfClass = (c) => c.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();

/** Une donnée venue de Python (JSON) en valeur : un dictionnaire {"$fiche": {…}} devient une fiche de ce nom. */
export function seedValue(v, name = "fiche") {
    if (Array.isArray(v)) return v.map((x) => seedValue(x, name));
    if (v && typeof v === "object" && v.$fiche) {
        const keys = Object.keys(v.$fiche);
        // Un objet garde le nom de sa classe (Python, Java) ; un dictionnaire prend celui de sa variable
        const r = new Fiche({ name: v.$class ? nameOfClass(v.$class) : name, art: "une fiche", parent: null, fields: keys, defaults: new Map() });
        for (const k of keys) r.vals.set(k, seedValue(v.$fiche[k], k));
        return r;
    }
    return v;
}

/** Égalité : les listes se comparent élément par élément, les fiches sont égales si c'est le même objet. */
export function same(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => same(x, b[k]));
    return a === b;
}

/** Une valeur, telle qu'on l'écrit en français. */
export function show(v, d = 0) {
    if (d > DEEP) return "…";
    const inner = (x) => (typeof x === "string" ? `«${x}»` : show(x, d + 1));
    if (typeof v === "number") {
        if (!Number.isFinite(v)) return Number.isNaN(v) ? "indéfini" : v > 0 ? "l'infini" : "moins l'infini";
        return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6).replace(".", ",");
    }
    if (typeof v === "boolean") return v ? "vrai" : "faux";
    if (Array.isArray(v)) return `[${v.map(inner).join(" ; ")}]`;
    if (v instanceof Fiche) return `${label(v.cls.name)} (${v.cls.fields.filter((f) => v.vals.has(f)).map((f) => `${label(f)} : ${inner(v.vals.get(f))}`).join(" ; ")})`;
    if (v && v.params) return `l'action ${v.name}`;
    return String(v);
}

const kindOf = (v) => (typeof v === "number" ? "un nombre" : typeof v === "string" ? "un texte" : typeof v === "boolean" ? "vrai ou faux" : Array.isArray(v) ? "une liste"
    : v instanceof Fiche ? `${v.cls.art} ${label(v.cls.name)}` : "une action");

export class Machine {
    constructor() {
        this.globals = new Map();
        this.classes = new Map();
        this.tables = new Map();   // un tableau du document : les mêmes fiches à chaque mention
        this.own = new Set();      // les données que le document lui-même a écrites (elles seules repartent vers Python)
        this.steps = 0;
    }

    /** Exécute une phrase ; rend les lignes affichées. */
    run(ast) {
        this.steps = 0;
        this.out = [];
        this.dropped = 0;
        try { this.exec(ast, this.globals); }
        catch (r) {
            if (r instanceof Fault) { this.close(); throw r; }
            if (!(r instanceof Returned)) throw r;   // « renvoie » hors d'une action : la phrase s'arrête là
        }
        this.close();
        return this.out;
    }

    close() {
        if (this.dropped) { this.out.push(`… ${this.dropped} lignes de plus`); this.dropped = 0; }
    }

    tick() {
        if (++this.steps > LIMIT) throw new Fault("trop long : la phrase tourne sans fin ?");
    }

    *scopeNames(scope) { for (let s = scope; s; s = s.parent) yield* s; }

    find(name, scope) {
        for (let s = scope; s; s = s.parent) if (s.has(name)) return s.get(name);
        return this.globals.get(name);
    }

    lookup(n, scope) {
        for (let s = scope; s; s = s.parent) if (s.has(n.name)) return s.get(n.name);
        if (this.globals.has(n.name)) return this.globals.get(n.name);
        // « le balcon du studio » : si « studio » est une fiche, c'est un champ qu'elle n'a pas
        for (let k = n.name.indexOf("_de_"); k > 0; k = n.name.indexOf("_de_", k + 1)) {
            const o = this.find(n.name.slice(k + 4), scope);
            if (o instanceof Fiche) throw new Fault(`${kindOf(o)} n'a pas de « ${label(n.name.slice(0, k))} »`, n.at, n.end);
        }
        // Le nom connu le plus proche (« loyre » -> loyer) ; même choix que le moteur C++ (distance, puis ordre)
        const near = nearest(n.name, [...this.scopeNames(scope), ...this.globals].filter(([, v]) => !(v && v.params)).map(([k]) => k));
        throw new Fault(`« ${label(n.name)} » n'a pas encore de valeur${near ? ` — « ${label(near)} » ?` : ""}`, n.at, n.end);
    }

    assign(n, v, scope) {
        // Dans une action, une donnée nouvelle reste locale ; une donnée du document se modifie là où elle vit
        for (let s = scope; s; s = s.parent) if (s.has(n.name)) { s.set(n.name, v); if (s === this.globals) this.own.add(n.name); return v; }
        const into = this.globals.has(n.name) ? this.globals : scope;
        into.set(n.name, v);
        if (into === this.globals) this.own.add(n.name);
        return v;
    }

    num(v, what, node) {
        if (typeof v !== "number") throw new Fault(`${what} : il faut un nombre, pas ${kindOf(v)}`, node?.at, node?.end);
        return v;
    }

    list(v, what, node) {
        if (typeof v === "string") return [...v];
        if (!Array.isArray(v)) throw new Fault(`${what} : il faut une liste, pas ${kindOf(v)}`, node?.at, node?.end);
        return v;
    }

    exec(s, scope) {
        switch (s.type) {
            case "seq": for (const x of s.list) this.exec(x, scope); return;
            case "show": {
                // Une espace entre deux valeurs, sauf si l'une l'a déjà : « affiche «Total : » et le total »
                const line = s.exprs.map((e) => show(this.eval(e, scope))).reduce((a, p, k) => (!k ? p : /[ \t\n]$/.test(a) || /^[ \t\n]/.test(p) ? a + p : `${a} ${p}`), "");
                if (this.out.length < MAX_LINES) this.out.push(line); else this.dropped++;
                return;
            }
            // La valeur d'abord, puis la cible (pour un champ : l'objet, puis le champ)
            case "assign": { const v = this.eval(s.expr, scope); this.slot(s.target, scope, false).set(v); return; }
            case "add": {
                const v = this.eval(s.expr, scope);
                const slot = this.slot(s.target, scope, false), cur = slot.cur;
                const next = cur === undefined ? (typeof v === "number" ? v : [v])
                    : Array.isArray(cur) ? [...cur, ...(Array.isArray(v) ? v : [v])]
                    : typeof cur === "string" ? cur + show(v)
                    : this.num(cur, "ajouter", s.target) + this.num(v, "ajouter", s.target);
                slot.set(next);
                return;
            }
            case "remove": {
                const v = this.eval(s.expr, scope);
                const slot = this.slot(s.target, scope, true), cur = slot.cur;
                if (Array.isArray(cur)) {
                    const k = cur.findIndex((x) => same(x, v));
                    if (k < 0) throw new Fault(`${show(v)} n'est pas dans « ${label(s.target.field ?? s.target.name)} »`, s.target.at, s.target.end);
                    slot.set(cur.filter((_, j) => j !== k));
                } else slot.set(this.num(cur, "retirer", s.target) - this.num(v, "retirer", s.target));
                return;
            }
            case "class": {
                // « un studio est une sorte d'appartement qui a une mezzanine » : les champs du parent d'abord
                let parent = null;
                if (s.parent) {
                    parent = this.classes.get(s.parent.name);
                    if (!parent) throw new Fault(`« ${label(s.parent.name)} » n'est pas encore défini`, s.parent.at, s.parent.end);
                }
                const fields = parent ? [...parent.fields] : [], defaults = new Map(parent ? parent.defaults : []);
                for (const f of s.fields) {
                    if (!fields.includes(f.name)) fields.push(f.name);
                    if (f.default) defaults.set(f.name, this.eval(f.default, scope));
                }
                this.classes.set(s.name, { name: s.name, art: s.art, parent, fields, defaults });
                return;
            }
            case "if": {
                if (this.truth(this.eval(s.cond, scope))) this.exec(s.then, scope);
                else if (s.else) this.exec(s.else, scope);
                return;
            }
            case "repeat": {
                const n = this.num(this.eval(s.count, scope), "répéter");
                for (let k = 0; k < n; k++) { this.tick(); this.exec(s.body, scope); }
                return;
            }
            case "foreach": {
                const xs = this.list(this.eval(s.list, scope), "pour chaque");
                for (const x of xs) { this.tick(); scope.set(s.var, x); if (scope === this.globals) this.own.add(s.var); this.exec(s.body, scope); }
                return;
            }
            case "while": {
                while (this.truth(this.eval(s.cond, scope))) { this.tick(); this.exec(s.body, scope); }
                return;
            }
            case "define": this.globals.set(s.name, { name: s.name, params: s.params, body: s.body }); return;
            case "return": throw new Returned(this.eval(s.expr, scope));
            case "expr": this.last = this.eval(s.expr, scope); return;
        }
    }

    /** Le champ d'une fiche ; sur une liste, le champ de chaque élément (« les loyers des apparts »). */
    field(o, e) {
        if (Array.isArray(o)) return o.map((x) => this.field(x, e));
        this.owner(o, e);
        if (!o.vals.has(e.field)) throw new Fault(`« ${label(e.field)} » n'a pas encore de valeur (${kindOf(o)})`, e.at, e.end);
        return o.vals.get(e.field);
    }

    owner(o, e) {
        if (!(o instanceof Fiche)) throw new Fault(`« ${label(e.field)} » : il faut une fiche, pas ${kindOf(o)}`, e.at, e.end);
        if (!o.cls.fields.includes(e.field)) throw new Fault(`${kindOf(o)} n'a pas de « ${label(e.field)} »`, e.at, e.end);
    }

    /** Ce qu'une instruction modifie : une donnée, ou le champ d'une fiche. cur : sa valeur (undefined si elle n'en a pas). */
    slot(t, scope, must) {
        if (t.type === "field") {
            const o = this.eval(t.obj, scope);
            if (must) this.field(o, t); else this.owner(o, t);
            return { cur: o.vals.get(t.field), set: (v) => o.vals.set(t.field, v) };
        }
        let cur;
        if (must) cur = this.lookup(t, scope);
        else try { cur = this.lookup(t, scope); } catch { cur = undefined; }
        return { cur, set: (v) => this.assign(t, v, scope) };
    }

    truth(v) {
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
        return !!v;
    }

    eval(e, scope) {
        switch (e.type) {
            case "num": case "str": case "bool": return e.value;
            case "name": return this.lookup(e, scope);
            case "list": return e.items.map((x) => this.eval(x, scope));
            case "range": {
                const a = this.num(this.eval(e.from, scope), "les nombres de"), b = this.num(this.eval(e.to, scope), "les nombres jusqu'à");
                if (Math.abs(b - a) > 100000) throw new Fault("liste trop grande (plus de 100 000 nombres)");
                const out = [];
                for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? 1 : -1) out.push(x);
                return out;
            }
            case "neg": return -this.num(this.eval(e.expr, scope), "moins");
            case "not": return !this.truth(this.eval(e.expr, scope));
            case "test": {
                const v = this.eval(e.expr, scope);
                switch (e.test) {
                    case "even": return this.num(v, "pair") % 2 === 0;
                    case "odd": return Math.abs(this.num(v, "impair") % 2) === 1;
                    case "empty": return (typeof v === "string" || Array.isArray(v)) ? v.length === 0 : v === 0;
                    case "positive": return this.num(v, "positif") > 0;
                    case "negative": return this.num(v, "négatif") < 0;
                }
                return false;
            }
            case "builtin": return this.builtin(e, this.eval(e.arg, scope));
            case "new": {
                const vals = e.fields.map((f) => this.eval(f.expr, scope));
                const c = this.classes.get(e.cls);
                if (!c) throw new Fault(`« ${label(e.cls)} » n'est pas encore défini (« un ${label(e.cls)} a … »)`, e.at, e.end);
                const r = new Fiche(c);
                for (const [k, v] of c.defaults) r.vals.set(k, v);
                e.fields.forEach((f, k) => {
                    if (!c.fields.includes(f.name)) throw new Fault(`${kindOf(r)} n'a pas de « ${label(f.name)} »`, e.at, e.end);
                    r.vals.set(f.name, vals[k]);
                });
                return r;
            }
            case "field": return this.field(this.eval(e.obj, scope), e);
            case "table": {
                if (!this.tables.has(e.name)) {
                    const cls = { name: e.name, art: "une ligne de", parent: null, fields: e.columns, defaults: new Map() };
                    this.tables.set(e.name, e.rows.map((row) => {
                        const r = new Fiche(cls);
                        row.forEach((v, k) => { if (v !== "") r.vals.set(e.columns[k], v); });
                        return r;
                    }));
                }
                return this.tables.get(e.name);
            }
            case "where": {
                const xs = this.list(this.eval(e.list, scope), "dont", e);
                const rhs = e.rhs ? this.eval(e.rhs, scope) : undefined;
                return xs.filter((x) => {
                    // « les notes qui sont au moins 10 » : sans champ, le test porte sur l'élément lui-même
                    if (!e.field) return e.op.startsWith("test:") ? this.truth(this.eval({ type: "test", test: e.op.slice(5), expr: { type: "lit", value: x } }, scope))
                        : this.truth(this.compare(e.op, x, rhs, e));
                    this.owner(x, e);
                    if (!x.vals.has(e.field)) return false;   // une case vide ne passe aucun test
                    const v = x.vals.get(e.field);
                    return e.op.startsWith("test:") ? this.truth(this.eval({ type: "test", test: e.op.slice(5), expr: { type: "lit", value: v } }, scope))
                        : this.truth(this.compare(e.op, v, rhs, e));
                });
            }
            case "lit": return e.value;
            case "isa": {
                const v = this.eval(e.expr, scope);
                let yes = false;
                for (let c = v instanceof Fiche ? v.cls : null; c; c = c.parent) if (c.name === e.cls) yes = true;
                return e.neg ? !yes : yes;
            }
            case "call": return this.call(e, scope);
            case "bin": return this.binary(e, scope);
        }
        throw new Fault("expression inconnue");
    }

    binary(e, scope) {
        if (e.op === "and") return this.truth(this.eval(e.left, scope)) && this.truth(this.eval(e.right, scope));
        if (e.op === "or") return this.truth(this.eval(e.left, scope)) || this.truth(this.eval(e.right, scope));
        return this.compare(e.op, this.eval(e.left, scope), this.eval(e.right, scope), e);
    }

    compare(op, a, b, e) {
        switch (op) {
            case "add":
                if (Array.isArray(a)) return [...a, ...(Array.isArray(b) ? b : [b])];
                if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
                return this.num(a, "plus", e) + this.num(b, "plus", e);
            case "concat": return show(a) + show(b);
            case "sub": return this.num(a, "moins", e) - this.num(b, "moins", e);
            case "mul": return this.num(a, "fois", e) * this.num(b, "fois", e);
            case "div":
                if (this.num(b, "divisé par", e) === 0) throw new Fault("division par zéro", e.at, e.end);
                return this.num(a, "divisé par", e) / b;
            case "mod": return this.num(a, "modulo", e) % this.num(b, "modulo", e);
            case "pow": return this.num(a, "puissance", e) ** b;
            case "eq": return same(a, b);
            case "ne": return !same(a, b);
            case "gt": return this.order(a, b, e) > 0;
            case "lt": return this.order(a, b, e) < 0;
            case "ge": return this.order(a, b, e) >= 0;
            case "le": return this.order(a, b, e) <= 0;
            case "contains": return Array.isArray(a) ? a.some((x) => same(x, b)) : show(a).includes(show(b));
        }
        throw new Fault("opération inconnue", e.at, e.end);
    }

    order(a, b, e) {
        if (typeof a === "number" && typeof b === "number") return a - b;
        if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, "fr");
        throw new Fault(`comparer ${kindOf(a)} et ${kindOf(b)} n'a pas de sens`, e.at, e.end);
    }

    builtin(e, v) {
        const nums = (what) => this.list(v, what, e).map((x) => this.num(x, what, e));
        switch (e.fn) {
            case "sum": return nums("la somme").reduce((s, x) => s + x, 0);
            case "mean": { const xs = nums("la moyenne"); if (!xs.length) throw new Fault("la moyenne d'une liste vide n'existe pas", e.at, e.end); return xs.reduce((s, x) => s + x, 0) / xs.length; }
            case "max": { const xs = nums("le maximum"); if (!xs.length) throw new Fault("liste vide", e.at, e.end); return Math.max(...xs); }
            case "min": { const xs = nums("le minimum"); if (!xs.length) throw new Fault("liste vide", e.at, e.end); return Math.min(...xs); }
            case "len": return typeof v === "string" ? v.length : this.list(v, "la longueur", e).length;
            // « combien de chats » : les éléments d'une liste, ou le nombre lui-même (« il y a 4 chats »)
            case "count": return typeof v === "number" ? v : typeof v === "string" ? v.length : this.list(v, "le nombre", e).length;
            case "sqrt": { const x = this.num(v, "la racine", e); if (x < 0) throw new Fault("pas de racine d'un nombre négatif", e.at, e.end); return Math.sqrt(x); }
            case "abs": return Math.abs(this.num(v, "la valeur absolue", e));
            case "round": return Math.round(this.num(v, "l'arrondi", e));
            case "first": { const xs = this.list(v, "le premier", e); if (!xs.length) throw new Fault("liste vide", e.at, e.end); return xs[0]; }
            case "last": { const xs = this.list(v, "le dernier", e); if (!xs.length) throw new Fault("liste vide", e.at, e.end); return xs[xs.length - 1]; }
            case "sorted": return [...this.list(v, "trier", e)].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : show(a).localeCompare(show(b), "fr")));
            case "reversed": return [...this.list(v, "inverser", e)].reverse();
        }
        throw new Fault("fonction inconnue", e.at, e.end);
    }

    call(e, scope) {
        // Les valeurs d'abord, puis l'action : le même ordre que le moteur C++ (gl::call reçoit des valeurs)
        const vals = e.args.map((a) => this.eval(a, scope));
        const f = this.globals.get(e.name);
        if (!f?.params) throw new Fault(`« ${e.name} » n'est pas encore défini (« pour ${e.name} …, renvoie … »)`, e.at, e.end);
        if (f.params.length !== e.args.length) throw new Fault(`${e.name} attend ${f.params.length} valeurs`, e.at, e.end);
        this.tick();
        if ((this.depth = (this.depth || 0) + 1) > 200) { this.depth = 0; throw new Fault("trop d'appels imbriqués", e.at, e.end); }
        const local = new Map(f.params.map((p, k) => [p, vals[k]]));
        local.parent = null;   // une action ne voit que ses paramètres et le document
        try {
            this.last = undefined;
            this.exec(f.body, local);
            return this.last;
        } catch (r) {
            if (r instanceof Returned) return r.value;
            throw r;
        } finally {
            this.depth--;
        }
    }
}

const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);

/** Les données du document en Python, pour que les blocs ```python les retrouvent. */
export function toPython(globals) {
    const lit = (v, d = 0) => (d > DEEP ? null : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "float('nan')") : typeof v === "boolean" ? (v ? "True" : "False")
        : typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map((x) => lit(x, d + 1)).join(", ")}]`
        : v instanceof Fiche ? `{${[...v.vals].map(([k, x]) => `${JSON.stringify(k)}: ${lit(x, d + 1)}`).join(", ")}}` : null);
    const lines = [];
    for (const [k, v] of globals) {
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(k) || PY_KEYWORDS.has(k) || (v && v.params)) continue;
        const l = lit(v);
        if (l !== null && !l.includes("null")) lines.push(`${k} = ${l}`);
    }
    return lines.join("\n");
}

/**
 * Les variables du document pour la jonction des langages (js/kernel.js) : { nom: { v, k } }, k étant la sorte
 * (int, float, str, bool, int[], float[], str[], bool[], list, fiche). Les actions définies n'en sont pas.
 */
export function toShare(globals) {
    const plain = (v, d = 0) => {
        if (d > DEEP) return undefined;
        if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
        if (typeof v === "string" || typeof v === "boolean") return v;
        if (Array.isArray(v)) { const l = v.map((x) => plain(x, d + 1)); return l.includes(undefined) ? undefined : l; }
        if (v instanceof Fiche) { const o = {}; for (const [k, x] of v.vals) { const y = plain(x, d + 1); if (y !== undefined) o[k] = y; } return o; }
        return undefined;
    };
    const kind = (v) => {
        if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
        if (typeof v === "string") return "str";
        if (typeof v === "boolean") return "bool";
        if (Array.isArray(v)) {
            const ks = new Set(v.map(kind));
            if (!v.length) return "list";
            if (ks.size === 1 && ["int", "float", "str", "bool"].includes([...ks][0])) return `${[...ks][0]}[]`;
            if ([...ks].every((k) => k === "int" || k === "float")) return "float[]";
            return "list";
        }
        return "fiche";
    };
    const out = {};
    for (const [k, v] of globals) {
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(k) || (v && v.params)) continue;
        const p = plain(v);
        if (p !== undefined) out[k] = { v: p, k: kind(p) };
    }
    return out;
}

/** Le nom le plus proche de name parmi names (au plus un tiers de lettres différentes), ou null. */
function nearest(name, names) {
    const a = Array.from(name), lim = Math.max(1, Math.floor(a.length / 3));
    let best = null, bd = Infinity;
    for (const n of new Set(names)) {
        if (n === name) continue;
        const b = Array.from(n);
        let row = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            const next = [i];
            for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            row = next;
        }
        const d = row[b.length];
        if (d <= lim && (d < bd || (d === bd && cmp(n, best) < 0))) { best = n; bd = d; }
    }
    return best;
}

/** L'ordre des octets UTF-8 (celui de std::string en C++) : l'ordre des points de code. */
const cmp = (x, y) => { const a = Array.from(x), b = Array.from(y); for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = a[i].codePointAt(0) - b[i].codePointAt(0); if (d) return d; } return a.length - b.length; };

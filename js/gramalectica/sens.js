// sens.js — le juge par les sortes : ce qu'est chaque donnée du document, sans rien exécuter, et les phrases qui
// n'ont pas de sens (« la moyenne des élèves » : des fiches ne font pas une moyenne ; « le loyer plus la surface » :
// des € et des m²). Il suit l'exécution (run.js) nœud par nœud, mais sur des sortes (../modele/sortes.js) au lieu de
// valeurs — une interprétation abstraite.
//
// L'inférence va dans les deux sens, jusqu'à ce que plus rien ne change :
//   · de bas en haut : 0 est un entier, « 12, 15 et 9 » une liste d'entiers, l'appel « déposer le mien et 100 »
//     donne au paramètre « somme » la sorte de 100 ;
//   · de haut en bas : « ajoute la somme au solde » (un nombre) fait de « somme » un nombre, même sans appel ;
//     « le solde du compte » fait de « compte » une fiche qui a un solde ; un paramètre nommé comme une classe
//     (« pour déposer un compte bancaire… ») est une fiche de cette classe.
// Rien n'est jamais déclaré faux sur une sorte incertaine (⊥, ?, ⊤) : seulement deux sortes sûres qui ne vont pas
// ensemble. L'exécution reste le dernier juge ; celui-ci répond avant elle, et là où elle ne passe pas (le corps
// d'une action jamais appelée).

import * as S from "../modele/sortes.js";

const ROUNDS = 6;

/**
 * Typer un document : asts (un par phrase, null si elle ne se lit pas), tables (tablesIn, avec units), values (les
 * données venues de Python ou SQL : nom → valeur).
 * → { globals: Map nom → sorte, classes: Map classe → { parent, fields: Map champ → sorte, table }, fns: Map action →
 *     { params, locals: Map, rend }, defs / uses: Map nom → Set(indice de phrase), conflicts: [[{ at, end, msg }]] }
 */
export function typeDocument(asts, tables = new Map(), values = new Map()) {
    const T = { globals: new Map(), classes: new Map(), fns: new Map(), defs: new Map(), uses: new Map(), conflicts: asts.map(() => []), origin: new Map(), bumps: new Map() };
    for (const [n, v] of values) { T.globals.set(n, S.sortOf(v, n)); T.origin.set(n, "externe"); }
    for (const [n, t] of tables) {
        const fields = new Map();
        t.columns.forEach((c, j) => {
            let s = S.BOT;
            for (const row of t.rows) if (row[j] !== "" && row[j] != null) s = S.join(s, S.sortOf(row[j]));
            const unite = t.units?.[j];
            if (unite && s.k === "nombre") s = S.nombre({ ...s, unite });
            fields.set(c, s);
        });
        T.classes.set(n, { parent: null, fields, table: true });
    }
    for (let round = 0; round < ROUNDS; round++) {
        const J = judge(T, { round, frozen: false, report: false });
        asts.forEach((a, k) => a && J.phrase(a, k));
        if (!J.changed) break;
    }
    const J = judge(T, { round: ROUNDS, frozen: true, report: true });
    T.nodes = asts.map(() => []);
    asts.forEach((a, k) => { if (a) { T.conflicts[k] = J.phrase(a, k); T.nodes[k] = J.nodes; } });
    // les ajouts comptés d'une boucle, reportés dans la sorte de leur donnée (pour le modèle, le survol)
    for (const [map, names] of T.bumps) for (const [n, sites] of names) if (map.has(n)) map.set(n, bumped(map.get(n), sites));
    return T;
}

/** Les incohérences d'une phrase lue autrement, dans un document déjà typé (sans le modifier) : [{ at, end, msg }]. */
export function conflictsOf(ast, T, k = -1) {
    return judge(T, { round: ROUNDS, frozen: true, report: true }).phrase(ast, k);
}

/** La sorte de chaque nom d'une phrase (lue autrement, peut-être), à sa place : [{ at, end, sort }]. */
export function sortsIn(ast, T, k = -1) {
    const J = judge(T, { round: ROUNDS, frozen: true, report: true });
    J.phrase(ast, k);
    return J.nodes;
}

/** Les sortes du document en une ligne (grossières, sans bornes) : pour la signature des lectures. */
export function typingKey(T) {
    const out = [];
    for (const [n, s] of T.globals) out.push(`${n}:${S.key(s)}`);
    for (const [c, x] of T.classes) for (const [f, s] of x.fields) out.push(`${c}.${f}:${S.key(s)}`);
    for (const [f, x] of T.fns) out.push(`${f}(${x.params.map((p) => S.key(x.locals.get(p))).join(",")})`);
    return out.join(";");
}

function judge(T, { round, frozen, report }) {
    const parentOf = (c) => T.classes.get(c)?.parent ?? null;
    const J = { changed: false };
    let errs = [], nerr = 0, nodes = [];
    // (en rendant compte : la sorte de chaque nom, à sa place dans la phrase — pour les règles apprises)
    const seen = (e, s) => { if (report && e?.at != null && (e.type === "name" || e.type === "field")) nodes.push({ at: e.at, end: e.end, sort: s }); return s; };
    const err = (node, msg) => {
        if (!msg) return;
        nerr++;
        if (report && !errs.some((e) => e.msg === msg)) errs.push({ at: node?.at, end: node?.end, msg });
    };
    let phraseK = -1;

    // une sorte qui s'élargit : jointure, et au-delà du premier tour, les bornes qui bougent encore sont lâchées
    // (l'élargissement de l'interprétation abstraite : « on ajoute 1 à la quantité » dans une boucle)
    const widen = (old, nv) => {
        if (round < 2 || old?.k !== "nombre" || nv.k !== "nombre") return nv;
        return S.nombre({ ...nv, min: nv.min === old.min ? nv.min : null, max: nv.max === old.max ? nv.max : null });
    };
    const put = (map, k, s) => {
        if (frozen || !s) return;
        const old = map.get(k);
        let nv = S.join(old, s, parentOf);
        if (old && nv.k === "nombre") nv = widen(old, nv);
        if (!old || S.key(old, true) !== S.key(nv, true)) { map.set(k, nv); J.changed = true; }
    };
    const note = (map, n) => { if (phraseK < 0) return; if (!map.has(n)) map.set(n, new Set()); map.get(n).add(phraseK); };

    // la portée : les paramètres et données locales d'une action, puis le document
    const where = (n, sc) => (sc && sc.has(n) ? sc : T.globals);
    const get = (n, sc) => {
        const map = sc && sc.has(n) ? sc : T.globals.has(n) ? T.globals : null;
        if (!map) return null;
        const sites = T.bumps.get(map)?.get(n);
        return sites ? bumped(map.get(n), sites) : map.get(n);
    };
    // les boucles en cours et leur nombre de tours (Infinity : « tant que », une liste de longueur inconnue)
    const trips = [];
    const tripsOf = (e, sc) => {
        if (e?.type === "list") return e.items.length;
        if (e?.type === "range") {
            const a = expr(e.from, sc), b = expr(e.to, sc);
            if (a.min != null && a.min === a.max && b.min != null && b.min === b.max) return Math.abs(b.min - a.min) + 1;
        }
        return Infinity;
    };
    const loop = (n, body) => { trips.push(n); try { body(); } finally { trips.pop(); } };
    const ownerOf = (cls, f) => { for (let c = cls; c; c = parentOf(c)) if (T.classes.get(c)?.fields.has(f)) return c; return null; };
    const withField = (f) => [...T.classes].filter(([, c]) => c.fields.has(f)).map(([n]) => n);

    /** De haut en bas : ce nœud doit être de cette sorte — s'il n'en a pas encore, il la prend. */
    const need = (e, s, sc) => {
        if (!e || frozen) return;
        if (e.type === "name") {
            const cur = get(e.name, sc);
            if (!cur || cur.k === "⊥" || (cur.k === "liste" && cur.de.k === "⊥" && s.k === "liste")) put(where(e.name, sc), e.name, s);
        } else if (e.type === "field") {
            const o = expr(e.obj, sc);
            const c = o.k === "fiche" ? ownerOf(o.cls, e.field) : null;
            if (c && (T.classes.get(c).fields.get(e.field)?.k ?? "⊥") === "⊥") put(T.classes.get(c).fields, e.field, s);
        }
    };

    function expr(e, sc) { return seen(e, expr0(e, sc)); }
    function expr0(e, sc) {
        if (!e) return S.DYN;
        switch (e.type) {
            case "num": { const s = S.sortOf(e.value); return e.unit && s.k === "nombre" ? S.nombre({ ...s, unite: e.unit }) : s; }
            case "str": return S.TEXTE;
            case "bool": return S.BOOL;
            case "lit": return S.sortOf(e.value);
            case "name": {
                if (!sc?.has(e.name)) note(T.uses, e.name);
                const s = get(e.name, sc);
                if (s) return s;
                if (T.fns.has(e.name)) return S.action(T.fns.get(e.name).params.map(() => S.BOT));
                return S.DYN;   // pas encore de valeur ici : l'exécution le dira
            }
            case "list": return S.liste(e.items.reduce((s, x) => S.join(s, expr(x, sc), parentOf), S.BOT));
            case "range": {
                const a = num(e.from, sc, "les nombres de"), b = num(e.to, sc, "les nombres jusqu'à");
                const ends = [a.min, a.max, b.min, b.max];
                return S.liste(S.nombre({ entier: a.entier && b.entier, unite: a.unite || b.unite,
                    min: ends.every((x) => x != null) ? Math.min(...ends) : null, max: ends.every((x) => x != null) ? Math.max(...ends) : null }));
            }
            case "neg": { const s = num(e.expr, sc, "moins"); return S.nombre({ ...s, min: s.max != null ? -s.max : null, max: s.min != null ? -s.min : null }); }
            case "not": expr(e.expr, sc); return S.BOOL;
            case "test": {
                const s = expr(e.expr, sc);
                if (e.test !== "empty") need(e.expr, S.NOMBRE, sc);
                err(e.expr ?? e, S.test(e.test, s).err);
                return S.BOOL;
            }
            case "builtin": {
                const s = expr(e.arg, sc);
                if (["sum", "mean", "max", "min"].includes(e.fn)) need(e.arg, S.liste(S.NOMBRE), sc);
                if (["sqrt", "abs", "round"].includes(e.fn)) need(e.arg, S.NOMBRE, sc);
                const r = S.builtin(e.fn, s);
                err(e, r.err);
                return r.sort;
            }
            case "new": {
                for (const f of e.fields) {
                    const v = expr(f.expr, sc), c = ownerOf(e.cls, f.name);
                    if (c) put(T.classes.get(c).fields, f.name, v);
                    else if (T.classes.has(e.cls)) err(e, `${S.text(S.fiche(e.cls))} n'a pas de « ${label(f.name)} »`);
                }
                return S.fiche(e.cls);
            }
            case "field": return field(expr(e.obj, sc), e, sc);
            case "table": return S.liste(S.fiche(e.name, true));
            case "where": {
                const L = expr(e.list, sc);
                const el = L.k === "liste" ? L.de : L.k === "texte" ? S.TEXTE : null;
                if (S.definite(L) && !el) err(e, `« dont » : il faut une liste, pas ${S.text(L)}`);
                const rhs = e.rhs ? expr(e.rhs, sc) : null;
                let v = el ?? S.DYN;
                if (e.field) v = field(v, e, sc, true);
                if (e.op.startsWith("test:")) err(e, S.test(e.op.slice(5), v).err);
                else if (rhs) err(e, S.apply(e.op, v, rhs).err);
                return L;
            }
            case "isa": expr(e.expr, sc); return S.BOOL;
            case "call": return call(e, sc);
            case "bin": {
                const a = expr(e.left, sc), b = expr(e.right, sc);
                if (["sub", "mul", "div", "mod", "pow"].includes(e.op) || (e.op === "add" && (a.k === "nombre" || b.k === "nombre") && a.k !== "liste" && a.k !== "texte" && b.k !== "texte")
                    || (["gt", "lt", "ge", "le"].includes(e.op) && (a.k === "nombre" || b.k === "nombre"))) {
                    need(e.left, S.NOMBRE, sc); need(e.right, S.NOMBRE, sc);
                }
                const r = S.apply(e.op, a, b);
                err(e, r.err);
                return r.sort;
            }
        }
        return S.DYN;
    }

    const num = (e, sc, what) => {
        const s = expr(e, sc);
        need(e, S.NOMBRE, sc);
        if (S.definite(s) && s.k !== "nombre") { err(e, `${what} : il faut un nombre, pas ${S.text(s)}`); return S.NOMBRE; }
        return s.k === "nombre" ? s : S.NOMBRE;
    };

    /** Le champ f d'une sorte (une fiche, ou une liste de fiches : le champ de chacune). each : dans un « dont ». */
    function field(o, e, sc, each = false) {
        if (o.k === "liste" && !each) return S.liste(field(o.de, e, sc));
        if (o.k === "fiche") {
            const c = ownerOf(o.cls, e.field);
            if (c) return T.classes.get(c).fields.get(e.field) ?? S.BOT;
            if (T.classes.has(o.cls)) err(e, `${S.text(o)} n'a pas de « ${label(e.field)} »`);
            return S.DYN;
        }
        if (o.k === "⊥" && !each) {
            // « le solde du compte » : le compte est une fiche d'une classe qui a un solde, s'il n'y en a qu'une
            const cs = withField(e.field);
            if (cs.length === 1) need(e.obj, S.fiche(cs[0]), sc);
        }
        if (S.definite(o)) err(e, `« ${label(e.field)} » : il faut une fiche, pas ${S.text(o)}`);
        return S.DYN;
    }

    function call(e, sc) {
        const vals = e.args.map((a) => expr(a, sc));
        const f = T.fns.get(e.name);
        if (!f) return S.DYN;
        if (f.params.length !== e.args.length) { err(e, `${label(e.name)} attend ${f.params.length} valeur${f.params.length > 1 ? "s" : ""}`); return f.rend; }
        f.params.forEach((p, j) => put(f.locals, p, vals[j]));
        if (report) f.params.forEach((p, j) => {
            const want = f.locals.get(p);
            if (S.definite(want) && S.definite(vals[j]) && want.k !== vals[j].k) err(e.args[j], `${label(e.name)} : « ${label(p)} » est ${S.text(want)}, pas ${S.text(vals[j])}`);
        });
        return f.rend ?? S.BOT;
    }

    /** Ce qu'une instruction modifie : sa sorte actuelle, et comment la changer. */
    function slot(t, sc) {
        if (t.type === "field") {
            const o = expr(t.obj, sc);
            if (o.k === "⊥") { const cs = withField(t.field); if (cs.length === 1) need(t.obj, S.fiche(cs[0]), sc); }
            const c = o.k === "fiche" ? ownerOf(o.cls, t.field) : null;
            if (!c) { if (S.definite(o) && o.k !== "fiche") err(t, `« ${label(t.field)} » : il faut une fiche, pas ${S.text(o)}`); return { cur: S.DYN, set: () => {} }; }
            const fields = T.classes.get(c).fields;
            return { cur: fields.get(t.field) ?? S.BOT, set: (s) => put(fields, t.field, s) };
        }
        if (!sc?.has(t.name)) note(T.defs, t.name);
        // dans une action, une donnée nouvelle reste locale ; une donnée du document se modifie là où elle vit
        const map = sc && (sc.has(t.name) || !T.globals.has(t.name)) ? sc : T.globals;
        return { cur: map.get(t.name) ?? S.BOT, set: (s) => put(map, t.name, s) };
    }

    function stmt(s, sc, fn) {
        switch (s.type) {
            case "seq": for (const x of s.list) stmt(x, sc, fn); return;
            case "show": s.exprs.forEach((x) => expr(x, sc)); return;
            // une valeur sans sens n'est pas écrite : elle ferait de la donnée « plusieurs sortes » et cacherait l'erreur
            case "assign": { const n0 = nerr, v = expr(s.expr, sc); seen(s.target, v); if (nerr === n0) slot(s.target, sc).set(v); return; }
            case "add": case "remove": {
                const n0 = nerr, v = expr(s.expr, sc), sl = slot(s.target, sc), cur = sl.cur;
                if (nerr !== n0) return;
                if (cur.k === "nombre" && s.type === "add") need(s.expr, S.NOMBRE, sc);
                // dans une boucle comptée, un ajout positif et borné : la donnée part de sa valeur et gagne au plus tours × pas
                // (c'est ce que l'élargissement perdrait : « on ajoute 1 à la quantité » 100 fois donne au plus 100)
                const n = trips.reduce((a, b) => a * b, 1);
                if (s.type === "add" && trips.length && Number.isFinite(n) && s.target.type === "name" && cur.k === "nombre" && v.k === "nombre"
                    && v.min != null && v.min >= 0 && v.max != null) {
                    const map = sc && (sc.has(s.target.name) || !T.globals.has(s.target.name)) ? sc : T.globals;
                    if (!T.bumps.has(map)) T.bumps.set(map, new Map());
                    const names = T.bumps.get(map);
                    if (!names.has(s.target.name)) names.set(s.target.name, new Map());
                    const site = names.get(s.target.name), was = site.get(s);
                    if (!frozen && (!was || was.max !== n * v.max || was.entier !== !!v.entier)) { site.set(s, { max: n * v.max, entier: !!v.entier }); J.changed = true; }
                    return;
                }
                if (cur.k === "liste" && cur.de.k !== "⊥" && v.k === "⊥") need(s.expr, cur.de, sc);
                let next;
                if (cur.k === "⊥") next = s.type === "remove" ? S.NOMBRE : v.k === "nombre" ? v : v.k === "⊥" ? S.BOT : S.liste(v);
                else if (cur.k === "liste") next = s.type === "remove" ? cur : S.liste(S.join(cur.de, v.k === "liste" ? v.de : v, parentOf));
                else if (cur.k === "texte" && s.type === "add") next = S.TEXTE;
                else { const r = S.apply(s.type === "add" ? "add" : "sub", cur, v); err(s.target, r.err && r.err.replace(/^(plus|moins) :/, s.type === "add" ? "ajouter :" : "retirer :")); next = r.sort; }
                sl.set(next);
                return;
            }
            case "class": {
                if (!T.classes.has(s.name)) T.classes.set(s.name, { parent: null, fields: new Map() });
                const c = T.classes.get(s.name);
                c.parent = s.parent?.name ?? null;
                note(T.defs, s.name);
                for (const f of s.fields) {
                    if (!c.fields.has(f.name)) { c.fields.set(f.name, S.BOT); if (!frozen) J.changed = true; }
                    if (f.default) put(c.fields, f.name, expr(f.default, sc));
                }
                return;
            }
            case "if": expr(s.cond, sc); stmt(s.then, sc, fn); if (s.else) stmt(s.else, sc, fn); return;
            case "while": expr(s.cond, sc); loop(Infinity, () => stmt(s.body, sc, fn)); return;
            case "repeat": { const c = num(s.count, sc, "répéter"); loop(c.max != null && c.min === c.max ? c.max : Infinity, () => stmt(s.body, sc, fn)); return; }
            case "foreach": {
                const L = expr(s.list, sc);
                const el = L.k === "liste" ? L.de : L.k === "texte" ? S.TEXTE : S.definite(L) ? null : S.DYN;
                if (!el) err(s.list ?? s, `pour chaque : il faut une liste, pas ${S.text(L)}`);
                const map = sc ?? T.globals;
                if (map === T.globals) note(T.defs, s.var);
                put(map, s.var, el ?? S.DYN);
                loop(tripsOf(s.list, sc), () => stmt(s.body, sc, fn));
                return;
            }
            case "define": {
                note(T.defs, s.name);
                if (!T.fns.has(s.name)) { T.fns.set(s.name, { params: s.params, locals: new Map(), rend: S.BOT }); J.changed = true; }
                const f = T.fns.get(s.name);
                f.params = s.params;
                for (const p of s.params) {
                    if (!f.locals.has(p)) f.locals.set(p, S.BOT);
                    // un paramètre nommé comme une classe (« pour déposer un compte bancaire… ») : une fiche de cette classe
                    if (T.classes.has(p) && !T.classes.get(p).table) put(f.locals, p, S.fiche(p));
                }
                stmt(s.body, f.locals, f);
                return;
            }
            case "return": case "expr": {
                const v = expr(s.expr, sc);
                if (fn && !frozen) { const nv = S.join(fn.rend, v, parentOf); if (S.key(nv, true) !== S.key(fn.rend, true)) { fn.rend = widen(fn.rend, nv); J.changed = true; } }
                return;
            }
        }
    }

    J.phrase = (ast, k) => {
        errs = [];
        nodes = [];
        phraseK = k;
        stmt(ast, null, null);
        J.nodes = nodes;
        return errs;
    };
    return J;
}

const label = (n) => String(n).replace(/_/g, " ");

/** Une donnée et ce que des boucles comptées lui ajoutent : au plus « tours × pas » de plus que sa valeur de départ. */
function bumped(base, sites) {
    if (base?.k !== "nombre" || !sites.size) return base;
    let total = 0, entier = base.entier;
    for (const b of sites.values()) { total += b.max; entier = entier && b.entier; }
    return S.nombre({ unite: base.unite, entier, min: base.min, max: base.max != null ? base.max + total : null });
}

// Grama Lectica — du document au programme C++.
//
// Le même arbre que lit l'interpréteur de la page devient un programme C++17 qui n'inclut que gl.hpp et se lie
// au moteur déjà compilé (gl_runtime.o). Chaque phrase est une fonction, chaque action définie aussi ; main()
// les appelle dans l'ordre du document, et le moteur entoure chaque phrase d'un marqueur : la page rattache
// chaque sortie, chaque erreur (avec sa place dans le texte) à sa phrase.
// L'ordre d'évaluation est celui de la page, de gauche à droite : les opérandes passent par des tableaux
// (initialisés dans l'ordre) ou par une variable temporaire.

const lit = (s) => JSON.stringify(String(s));
const numLit = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

export function toCpp(read, { header = '#include "gl.hpp"', external = null } = {}) {
    let uid = 0;
    const fresh = (p) => `${p}${uid++}_`;
    const pos = (n) => `${n.at ?? -1}, ${n.end ?? -1}`;
    const label = (name) => lit(name.replace(/_/g, " "));
    const actions = [];
    // Un tableau du document : construit une fois, les mêmes fiches à chaque mention
    const tables = new Map();
    const tableFn = (e) => {
        if (!tables.has(e.name)) {
            const f = `table${tables.size}_`, n = e.columns.length;
            const cell = (v) => (v === "" || v === undefined ? "gl::V()" : typeof v === "number" ? `gl::V(${numLit(v)})` : `gl::V(${lit(v)})`);
            const cells = e.rows.flatMap((row) => e.columns.map((_, k) => cell(row[k])));
            tables.set(e.name, f);
            actions.push(`static gl::V ${f}() {\nstatic const char* const cols[] = {${e.columns.map(lit).join(", ")}};\n`
                + `static gl::V t = []{ ${cells.length ? `gl::V cells[] = {${cells.join(", ")}};` : "gl::V* cells = nullptr;"} return gl::table(${lit(e.name)}, cols, ${n}, cells, ${e.rows.length}); }();\nreturn t;\n}`);
        }
        return `${tables.get(e.name)}()`;
    };

    // Plusieurs valeurs, évaluées de gauche à droite, puis passées ensemble
    const many = (xs, f) => {
        if (!xs.length) return f("nullptr", 0);
        const t = fresh("t");
        return `([&]{ gl::V ${t}[] = {${xs.join(", ")}}; return ${f(t, xs.length)}; }())`;
    };
    const pair = (a, b, f) => { const x = fresh("a"); return `([&]{ gl::V ${x} = ${a}; return ${f(x, b)}; }())`; };

    const expr = (e) => {
        switch (e.type) {
            case "num": return `gl::V(${numLit(e.value)})`;
            case "str": return `gl::V(${lit(e.value)})`;
            case "bool": return `gl::V(${e.value})`;
            case "name": return `gl::lookup(S, ${lit(e.name)}, ${label(e.name)}, ${pos(e)})`;
            case "list": return many(e.items.map(expr), (t, n) => `gl::list(${t}, ${n})`);
            case "range": return pair(expr(e.from), expr(e.to), (a, b) => `gl::range(${a}, ${b})`);
            case "neg": return `gl::neg(${expr(e.expr)})`;
            case "not": return `gl::V(!gl::truth(${expr(e.expr)}))`;
            case "test": return `gl::test(${lit(e.test)}, ${expr(e.expr)})`;
            case "builtin": return `gl::builtin(${lit(e.fn)}, ${expr(e.arg)}, ${pos(e)})`;
            case "call": return many(e.args.map(expr), (t, n) => `gl::call(${lit(e.name)}, ${t}, ${n}, ${pos(e)})`);
            case "new": {
                const ks = fresh("ks");
                return many(e.fields.map((f) => expr(f.expr)), (t, n) => (n
                    ? `([&]{ static const char* const ${ks}[] = {${e.fields.map((f) => lit(f.name)).join(", ")}}; return gl::make(${lit(e.cls)}, ${ks}, ${t}, ${n}, ${pos(e)}); }())`
                    : `gl::make(${lit(e.cls)}, nullptr, nullptr, 0, ${pos(e)})`));
            }
            case "field": return `gl::field(${expr(e.obj)}, ${lit(e.field)}, ${pos(e)})`;
            case "table": return tableFn(e);
            case "where": return pair(expr(e.list), e.rhs ? expr(e.rhs) : "gl::V()", (a, b) => `gl::where(${a}, ${lit(e.field)}, ${lit(e.op)}, ${b}, ${pos(e)})`);
            case "isa": return `gl::isa(${expr(e.expr)}, ${lit(e.cls)}, ${e.neg})`;
            case "bin": {
                const A = expr(e.left), B = expr(e.right);
                if (e.op === "and") return `gl::V(gl::truth(${A}) && gl::truth(${B}))`;
                if (e.op === "or") return `gl::V(gl::truth(${A}) || gl::truth(${B}))`;
                return pair(A, B, (a, b) => `gl::binop(${lit(e.op)}, ${a}, ${b}, ${pos(e)})`);
            }
        }
        throw new Error(`nœud inconnu : ${e.type}`);
    };

    // inFn : dans le corps d'une action (« renvoie » rend la valeur), sinon dans une phrase
    const stmt = (s, inFn) => {
        switch (s.type) {
            case "seq": return s.list.map((x) => stmt(x, inFn)).join("\n");
            case "show": {
                const t = fresh("t");
                return `{ gl::V ${t}[] = {${s.exprs.map(expr).join(", ")}}; gl::print(${t}, ${s.exprs.length}); }`;
            }
            // Le champ d'une fiche : la valeur d'abord, puis l'objet, comme dans la page
            case "assign": case "add": case "remove": {
                const t = s.target;
                if (t.type === "field") {
                    const v = fresh("v"), fn = { assign: "setField", add: "addToField", remove: "removeFromField" }[s.type];
                    return `{ gl::V ${v} = ${expr(s.expr)}; gl::${fn}(${expr(t.obj)}, ${lit(t.field)}, ${v}, ${pos(t)}); }`;
                }
                if (s.type === "assign") return `gl::assign(S, ${lit(t.name)}, ${expr(s.expr)});`;
                return `gl::${s.type === "add" ? "addTo" : "removeFrom"}(S, ${lit(t.name)}, ${label(t.name)}, ${expr(s.expr)}, ${pos(t)});`;
            }
            case "class": {
                const pre = s.parent ? `gl::needClass(${lit(s.parent.name)}, ${pos(s.parent)}); ` : "";
                const parent = s.parent ? lit(s.parent.name) : "nullptr";
                if (!s.fields.length) return `{ ${pre}gl::defineClass(${lit(s.name)}, ${lit(s.art)}, ${parent}, nullptr, nullptr, 0); }`;
                const fs = fresh("fs"), ds = fresh("ds");
                return `{ ${pre}static const char* const ${fs}[] = {${s.fields.map((f) => lit(f.name)).join(", ")}};\n`
                    + `gl::V ${ds}[] = {${s.fields.map((f) => (f.default ? expr(f.default) : "gl::V()")).join(", ")}};\n`
                    + `gl::defineClass(${lit(s.name)}, ${lit(s.art)}, ${parent}, ${fs}, ${ds}, ${s.fields.length}); }`;
            }
            case "if": return `if (gl::truth(${expr(s.cond)})) {\n${stmt(s.then, inFn)}\n}${s.else ? ` else {\n${stmt(s.else, inFn)}\n}` : ""}`;
            case "repeat": {
                const n = fresh("n"), k = fresh("k");
                return `{ double ${n} = gl::num(${expr(s.count)}, "répéter");\nfor (double ${k} = 0; ${k} < ${n}; ${k}++) { gl::tick();\n${stmt(s.body, inFn)}\n} }`;
            }
            case "foreach": {
                const xs = fresh("xs"), k = fresh("k");
                return `{ gl::V ${xs} = gl::aslist(${expr(s.list)}, "pour chaque");\nfor (int ${k} = 0, n_ = gl::count(${xs}); ${k} < n_; ${k}++) { gl::tick(); gl::set(S, ${lit(s.var)}, gl::item(${xs}, ${k}));\n${stmt(s.body, inFn)}\n} }`;
            }
            case "while": return `while (gl::truth(${expr(s.cond)})) { gl::tick();\n${stmt(s.body, inFn)}\n}`;
            case "define": {
                const f = fresh("act"), ps = fresh("ps");
                actions.push(`static gl::V ${f}(gl::Scope& S) {\ngl::V last_;\n${stmt(s.body, true)}\nreturn last_;\n}`);
                return `{ static const char* ${ps}[] = {${s.params.map(lit).join(", ") || "nullptr"}}; gl::define(${lit(s.name)}, ${ps}, ${s.params.length}, ${f}); }`;
            }
            case "return": return inFn ? `return ${expr(s.expr)};` : `throw gl::Returned{${expr(s.expr)}};`;
            case "expr": return inFn ? `last_ = ${expr(s.expr)};` : `(void)(${expr(s.expr)});`;
        }
        throw new Error(`instruction inconnue : ${s.type}`);
    };

    // Les données venues de Python et de SQL : présentes avant la première phrase, comme dans la page
    const value = (v, name) => {
        if (Array.isArray(v)) return many(v.map((x) => value(x, name)), (t, n) => `gl::list(${t}, ${n})`);
        if (v && typeof v === "object" && v.$fiche) {
            const keys = Object.keys(v.$fiche), ks = fresh("ks");
            const cls = v.$class ? v.$class.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : name;   // comme seedValue
            if (!keys.length) return `gl::record(${lit(cls)}, nullptr, nullptr, 0)`;
            return `([&]{ static const char* const ${ks}[] = {${keys.map(lit).join(", ")}}; gl::V vs_[] = {${keys.map((k) => value(v.$fiche[k], k)).join(", ")}}; return gl::record(${lit(cls)}, ${ks}, vs_, ${keys.length}); }())`;
        }
        if (typeof v === "number") return `gl::V(${numLit(v)})`;
        if (typeof v === "boolean") return `gl::V(${v})`;
        return `gl::V(${lit(v)})`;
    };
    const seeds = external ? [...external.values].map(([k, v]) => `gl::set(gl::globals(), ${lit(k)}, ${value(v, k)});`) : [];
    const phrases = [], calls = [];
    read.forEach((r, k) => {
        if (!r.ast) return;
        phrases.push(`static void phrase${k}() {\ngl::Scope& S = gl::globals();\n(void)S;\n${stmt(r.ast, false)}\n}`);
        calls.push(`gl::phrase(${k}, phrase${k});`);
    });
    return `${header}\n\n${actions.join("\n\n")}\n\n${phrases.join("\n\n")}\n\nint main() {\n${seeds.join("\n")}\n${calls.join("\n")}\nreturn 0;\n}\n`;
}

/** Les sorties du programme, rattachées aux phrases : [{ lines, fault? } | null], comme runDocument. */
export function readOutput(text, count) {
    const results = Array.from({ length: count }, () => null);
    let cur = null;
    for (const line of text.replace(/\n$/, "").split("\n")) {
        if (line.startsWith("\x1eP")) { cur = Number(line.slice(2)); results[cur] = { lines: [] }; continue; }
        if (cur === null) continue;
        if (line.startsWith("\x1eF")) {
            const m = /^\x1eF(-?\d+) (-?\d+) (.*)$/s.exec(line);
            results[cur].fault = { msg: m[3], at: +m[1] < 0 ? undefined : +m[1], end: +m[2] < 0 ? undefined : +m[2] };
            continue;
        }
        results[cur].lines.push(line);
    }
    return results;
}

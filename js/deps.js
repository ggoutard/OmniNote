// L'index des dépendances entre les blocs du document (toutes les pages) : ce que chaque bloc définit (variables,
// fonctions, classes, imports, tables SQL) et ce qu'il utilise. Avant d'exécuter un bloc, ceux qui lui fournissent
// un nom et n'ont pas tourné dans la machine (ou ont changé depuis, ou dépendent d'un bloc rejoué après eux)
// passent d'abord, dans l'ordre : on n'exécute plus un bloc sur une mémoire vide ou périmée.
//
// Lecture volontairement simple (pas d'analyse complète du langage) : Python, JavaScript et SQL, les langages qui
// gardent leur état. Les variables d'un langage se lisent dans les autres (la jonction) : un nom est cherché dans
// tous ; une table SQL (« table:nom ») se crée en SQL ou par sql("CREATE …") et se lit en SQL ou par sql("SELECT …").

export const DEP_LANGS = new Set(["python", "javascript", "sql"]);

const PY_WORDS = new Set(("False None True and as assert async await break class continue def del elif else except finally for from " +
    "global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls " +
    "abs all any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir divmod enumerate eval " +
    "exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map " +
    "max memoryview min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str " +
    "sum super tuple type vars zip __name__ __file__ Exception ValueError TypeError KeyError IndexError NameError ZeroDivisionError " +
    "RuntimeError StopIteration AttributeError ImportError OSError ArithmeticError AssertionError NotImplementedError").split(" "));
const JS_WORDS = new Set(("break case catch class const continue debugger default delete do else export extends false finally for function " +
    "if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield " +
    "async await NaN Infinity Math JSON Object Array String Number Boolean Date RegExp Map Set WeakMap WeakSet Promise Symbol Error " +
    "TypeError RangeError console parseInt parseFloat isNaN isFinite globalThis window document setTimeout clearTimeout setInterval " +
    "clearInterval BigInt Reflect Proxy Intl arguments require module exports").split(" "));
const SQL_HINT = /\b(SELECT|CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|FROM)\b/i;
const IDENT = /[A-Za-z_À-ɏ][\wÀ-ɏ]*/g;

/** Les tables d'un texte SQL : { defs, uses } (noms « table:… », en minuscules) */
function sqlTables(text) {
    const defs = new Set(), uses = new Set();
    const t = text.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
    for (const m of t.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi)) defs.add("table:" + m[1].toLowerCase());
    for (const m of t.matchAll(/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|DROP\s+(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?|ALTER\s+TABLE)\s+["`[]?(\w+)/gi)) defs.add("table:" + m[1].toLowerCase());
    for (const m of t.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+["`[]?(\w+)/gi)) {
        const n = m[1].toLowerCase();
        if (!/^(select|where|values)$/.test(n)) uses.add("table:" + n);
    }
    // les sous-requêtes d'une table qu'on crée ici ne dépendent pas d'ailleurs
    for (const d of defs) uses.delete(d);
    return { defs, uses };
}

/** Python : les chaînes et commentaires retirés (le SQL des chaînes et les { } des f-strings gardés à part) */
function pyStrip(code, sqlParts) {
    let out = "", i = 0;
    while (i < code.length) {
        const c = code[i];
        if (c === "#") { while (i < code.length && code[i] !== "\n") i++; continue; }
        if (c === '"' || c === "'") {
            const prefix = /([rRbBfFuU]{0,2})$/.exec(out)[1];
            const triple = code.startsWith(c.repeat(3), i);
            const q = triple ? c.repeat(3) : c;
            let j = i + q.length, body = "";
            while (j < code.length && !code.startsWith(q, j)) {
                if (code[j] === "\\") { body += code[j] + (code[j + 1] || ""); j += 2; continue; }
                if (!triple && code[j] === "\n") break;
                body += code[j++];
            }
            i = Math.min(code.length, j + q.length);
            if (SQL_HINT.test(body)) sqlParts.push(body);
            // f"… {x} …" : les expressions entre accolades sont du code
            const expr = /f/i.test(prefix) ? [...body.matchAll(/\{([^{}:!]+)[^{}]*\}/g)].map((m) => m[1]).join(" ") : "";
            out += ` "" ${expr} `;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

function pySymbols(code) {
    const defs = new Set(), uses = new Set(), sqlParts = [];
    const text = pyStrip(code, sqlParts);
    // les lignes logiques : les parenthèses ouvertes prolongent la ligne
    const lines = [];
    let cur = "", depth = 0;
    for (const raw of text.split("\n")) {
        cur = cur ? cur + " " + raw.trim() : raw;
        for (const ch of raw) { if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth = Math.max(0, depth - 1); }
        if (depth === 0 && !/\\\s*$/.test(raw)) { lines.push(cur); cur = ""; }
    }
    if (cur) lines.push(cur);
    const names = (s) => (s.match(IDENT) || []).filter((n) => !PY_WORDS.has(n));
    const addTargets = (s, into) => { for (const part of s.split(/\s*=\s*/)) if (/^[\w\s,()[\]*]+$/.test(part) && !/\w\s*\[/.test(part)) for (const n of names(part)) into.add(n); };
    let fn = null;   // { indent, locals } : le corps d'une fonction (ses noms locaux ne sont pas des dépendances)
    const bodyUses = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const indent = /^\s*/.exec(line)[0].length;
        if (fn && indent <= fn.indent) fn = null;
        const s = line.trim();
        let m;
        if ((m = /^(?:async\s+)?def\s+(\w+)\s*\((.*?)\)\s*(?:->.*)?:/.exec(s))) {
            if (!fn) defs.add(m[1]);
            const locals = new Set(names(m[2].replace(/=[^,]*/g, "")));
            if (fn) { fn.locals.add(m[1]); for (const n of locals) fn.locals.add(n); }
            else fn = { indent, locals };
            for (const d of m[2].matchAll(/=([^,]*)/g)) for (const n of names(d[1])) uses.add(n);
            continue;
        }
        if ((m = /^class\s+(\w+)\s*(?:\((.*?)\))?\s*:/.exec(s))) {
            if (!fn) defs.add(m[1]);
            for (const n of names(m[2] || "")) uses.add(n);
            if (!fn) fn = { indent, locals: new Set() };   // ses méthodes et attributs restent dans la classe
            continue;
        }
        const into = fn ? fn.locals : defs;
        if ((m = /^import\s+(.+)$/.exec(s))) {
            for (const part of m[1].split(",")) { const a = /(\w+)(?:\.\w+)*(?:\s+as\s+(\w+))?/.exec(part.trim()); if (a) into.add(a[2] || a[1]); }
            continue;
        }
        if ((m = /^from\s+\S+\s+import\s+(.+)$/.exec(s))) {
            for (const part of m[1].replace(/[()]/g, "").split(",")) { const a = /(\w+)(?:\s+as\s+(\w+))?/.exec(part.trim()); if (a && a[1] !== "*") into.add(a[2] || a[1]); }
            continue;
        }
        let expr = s;
        if ((m = /^(?:async\s+)?for\s+(.+?)\s+in\s+(.+):/.exec(s))) { for (const n of names(m[1])) into.add(n); expr = m[2]; }
        else if ((m = /^(with\s+.+):$/.exec(s))) { for (const a of m[1].matchAll(/\bas\s+(\w+)/g)) into.add(a[1]); expr = m[1].replace(/\bas\s+\w+/g, ""); }
        else if ((m = /^except\b(.*?)(?:\bas\s+(\w+))?\s*:/.exec(s))) { if (m[2]) into.add(m[2]); expr = m[1]; }
        else if ((m = /^global\s+(.+)$/.exec(s))) { if (fn) for (const n of names(m[1])) defs.add(n); continue; }
        else if ((m = /^([^=]+?)\s*(\+|-|\*\*?|\/\/?|%|\||&|\^|>>|<<|@)=(?!=)\s*(.*)$/.exec(s))) {
            // x += … : x est lu puis écrit
            for (const n of names(m[1].split(/[.[]/)[0])) (fn && fn.locals.has(n) ? null : uses.add(n));
            if (!/[.[]/.test(m[1])) addTargets(m[1], into);
            expr = m[3] + " " + m[1].replace(/^[^.[]+/, "");
        } else if ((m = /^((?:[^=()'"]|\([^()]*\))+?)\s*=(?!=)\s*(.*)$/.exec(s)) && !/[<>!]$/.test(m[1])) {
            const target = m[1];
            if (/[.[]/.test(target)) { const base = names(target.split(/[.[]/)[0]); for (const n of base) (fn && fn.locals.has(n) ? null : uses.add(n)); expr = m[2] + " " + target.replace(/^[^.[]+/, ""); }
            else { addTargets(target, into); expr = m[2]; }
        }
        // les noms lus : pas après un point, pas un argument nommé (f(x=1)), pas un nom local de la fonction
        // (les paramètres d'un lambda et les variables d'une compréhension sont locaux à l'expression)
        const lam = new Set();
        const flat = expr.replace(/\.\s*[A-Za-z_]\w*/g, " ").replace(/([(,]\s*)\w+\s*=(?!=)/g, "$1")
            .replace(/\blambda\s+([^:]*):/g, (a, ps) => { for (const n of names(ps)) lam.add(n); return " "; })
            .replace(/\bfor\s+([\w\s,()]+?)\s+in\b/g, (a, ps) => { for (const n of names(ps)) lam.add(n); return " "; });
        for (const n of names(flat)) {
            if (lam.has(n) || (fn && fn.locals.has(n))) continue;
            if (fn) bodyUses.push([n, fn]); else uses.add(n);
        }
    }
    // dans une fonction, un nom assigné plus bas reste local (Python le sait à la compilation)
    for (const [n, f] of bodyUses) if (!f.locals.has(n)) uses.add(n);
    for (const part of sqlParts) { const t = sqlTables(part); for (const d of t.defs) defs.add(d); for (const u of t.uses) uses.add(u); }
    return { defs, uses };
}

function jsSymbols(code) {
    const defs = new Set(), uses = new Set();
    let text = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    text = text.replace(/`(?:[^`\\]|\\.)*`/g, (t) => ` "" ${[...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" ")} `)
        .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    // le niveau zéro des accolades : ce qui y est déclaré reste en mémoire
    let depth = 0, top = "";
    for (const ch of text) { if (ch === "{") depth++; if (depth === 0) top += ch; else top += ch === "\n" ? "\n" : " "; if (ch === "}") depth = Math.max(0, depth - 1); }
    const names = (s) => (s.match(IDENT) || []).filter((n) => !JS_WORDS.has(n));
    const local = new Set();
    for (const m of top.matchAll(/\b(?:let|const|var)\s+([^=;\n]+?)\s*(?:=|;|\n|$)/g)) for (const n of names(m[1])) defs.add(n);
    for (const m of text.matchAll(/\b(?:function\*?|class)\s+(\w+)/g)) (top.includes(m[0]) ? defs : local).add(m[1]);
    for (const m of top.matchAll(/(?:^|[;\n])\s*(\w+)\s*=(?!=)/g)) defs.add(m[1]);
    // les noms locaux : paramètres et déclarations dans les accolades
    for (const m of text.matchAll(/\bfunction\*?\s*\w*\s*\(([^)]*)\)/g)) for (const n of names(m[1])) local.add(n);
    for (const m of text.matchAll(/\(([^()]*)\)\s*=>/g)) for (const n of names(m[1])) local.add(n);
    for (const m of text.matchAll(/\b(\w+)\s*=>/g)) local.add(m[1]);
    for (const m of text.matchAll(/\b(?:let|const|var)\s+([^=;\n]+?)\s*(?:=|;|\n|$|\bof\b|\bin\b)/g)) for (const n of names(m[1])) if (!defs.has(n)) local.add(n);
    for (const m of text.matchAll(/\bcatch\s*\((\w+)\)/g)) local.add(m[1]);
    const flat = text.replace(/\.\s*[A-Za-z_$][\w$]*/g, " ").replace(/([{,]\s*)\w+\s*:(?!:)/g, "$1");
    for (const n of names(flat)) if (!local.has(n)) uses.add(n);
    return { defs, uses };
}

/** Ce qu'un bloc définit et ce qu'il utilise (moins ce qu'il définit lui-même) */
export function symbols(lang, code) {
    const r = lang === "python" ? pySymbols(code) : lang === "javascript" ? jsSymbols(code) : lang === "sql" ? sqlTables(code) : { defs: new Set(), uses: new Set() };
    r.defs.delete("_");
    for (const d of r.defs) if (!d.startsWith("table:") || lang === "sql") r.uses.delete(d);
    r.uses.delete("_");
    return r;
}

/** Une empreinte du bloc : la même tant que son langage et son code ne changent pas */
export function blockHash(lang, code) {
    let h = 2166136261;
    const s = lang + "\u0000" + code;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ":" + s.length;
}

/**
 * Ce qu'il faut exécuter avant entries[target], dans l'ordre (des indices de entries).
 * entries : [{ lang, code, h }] dans l'ordre du document (les pages, puis les blocs de chacune) ;
 * ranAt : Map empreinte -> numéro d'exécution réussie dans la machine actuelle (absente : jamais, ou plus depuis
 * un redémarrage). Le fournisseur d'un nom est le dernier bloc avant celui qui l'utilise qui le définit ; il passe
 * s'il n'a pas tourné, ou si l'un de ses propres fournisseurs tourne (ou a tourné) après lui.
 */
export function planDeps(entries, target, ranAt) {
    const sym = entries.map((e) => (e.sym ??= symbols(e.lang, e.code)));
    const provider = (name, before) => { for (let j = before - 1; j >= 0; j--) if (sym[j].defs.has(name)) return j; return -1; };
    const order = [], state = new Map();   // indice -> { stale, at }
    const visit = (i, path) => {
        if (state.has(i)) return state.get(i);
        if (path.has(i)) return { stale: false, at: ranAt.get(entries[i].h) ?? -1 };
        path.add(i);
        let stale = i !== target && !ranAt.has(entries[i].h);
        const at = ranAt.get(entries[i].h) ?? -1;
        const from = new Set();
        for (const name of sym[i].uses) { const j = provider(name, i); if (j >= 0) from.add(j); }
        for (const j of [...from].sort((a, b) => a - b)) {
            const r = visit(j, path);
            if (i !== target && (r.stale || r.at > at)) stale = true;
        }
        path.delete(i);
        const r = { stale, at: stale ? Infinity : at, from: [...from] };
        state.set(i, r);
        if (stale) order.push(i);
        return r;
    };
    visit(target, new Set());
    return { order, uses: [...sym[target].uses], from: state.get(target)?.from || [] };
}

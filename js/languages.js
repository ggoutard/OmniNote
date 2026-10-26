// languages.js — Les langages des cellules : où ils s'exécutent, comment ils se colorent.
//   engine "vm"      noyau Python résident de la machine virtuelle (et les compilateurs, interpréteurs qu'il lance)
//   engine "jvm"     module Java chargé dans la JVM du lanceur (JavaScript, Java)
//   engine "page"    rendu dans la page, sans machine (Markdown, HTML, LaTeX, Mermaid)

/* global buble */

export const LANGS = {
    python: { label: "Python", short: "py", ext: "py", color: "#3B82F6", mode: "python", engine: "vm", version: "3.7",
        about: "Espace de noms partagé, magies %time, %%sql…, commandes !shell, graphiques et tableaux." },
    javascript: { label: "JavaScript", short: "js", ext: "js", color: "#EAB308", mode: "javascript", engine: "jvm", version: "ES2015 → Nashorn",
        about: "Écrit en JavaScript moderne, transpilé puis exécuté par Nashorn dans la JVM de la machine." },
    java: { label: "Java", short: "java", ext: "java", color: "#F97316", mode: "text/x-java", engine: "jvm", version: "8",
        about: "Des instructions, ou des classes : compilées par ECJ, réutilisables d'une cellule à l'autre." },
    cpp: { label: "C++", short: "cpp", ext: "cpp", color: "#6366F1", mode: "text/x-c++src", engine: "vm", version: "GCC 8 · C++17",
        about: "Compilé par g++ dans la machine. Sans main(), la cellule devient le corps d'un main (iostream, vector, map… déjà inclus)." },
    c: { label: "C", short: "c", ext: "c", color: "#64748B", mode: "text/x-csrc", engine: "vm", version: "GCC 8 · C11",
        about: "Compilé par gcc dans la machine ; sans main(), la cellule en devient le corps." },
    rust: { label: "Rust", short: "rs", ext: "rs", color: "#CE422B", mode: "text/x-rustsrc", engine: "vm", version: "1.41 · édition 2018",
        about: "Compilé par rustc dans la machine. Sans fn main(), la cellule en devient le corps (fonctions et structures comprises)." },
    go: { label: "Go", short: "go", ext: "go", color: "#00ADD8", mode: "text/x-go", engine: "vm", version: "yaegi · Go 1.22",
        about: "Interprété par yaegi : des instructions comme dans une console (fmt, math, strings… déjà importés), ou un package main." },
    php: { label: "PHP", short: "php", ext: "php", color: "#777BB4", mode: "text/x-php", engine: "vm", version: "7.3",
        about: "Interpréteur PHP en ligne de commande ; « <?php » est facultatif. json, mbstring, ctype…" },
    cobol: { label: "COBOL", short: "cob", ext: "cob", color: "#0EA5E9", mode: "cobol", engine: "vm", version: "GnuCOBOL 3.2",
        about: "Programme complet, ou seulement des instructions (avec ou sans WORKING-STORAGE) ; format libre ou fixe." },
    sh: { label: "Shell", short: "sh", ext: "sh", color: "#22C55E", mode: "shell", engine: "vm", version: "busybox ash",
        about: "Le dossier courant et les variables exportées persistent ; awk, sed, grep, find, tar…" },
    sql: { label: "SQL", short: "sql", ext: "sql", color: "#06B6D4", mode: "text/x-sqlite", engine: "vm", version: "SQLite 3.27",
        about: "Base partagée avec Python : sql(\"SELECT …\"), et sql_result après chaque requête." },
    tcl: { label: "Tcl", short: "tcl", ext: "tcl", color: "#A855F7", mode: "tcl", engine: "vm", version: "8.6",
        about: "Interpréteur Tcl persistant : proc, dict, expr, regexp, string…" },
    scheme: { label: "Scheme", short: "scm", ext: "scm", color: "#EC4899", mode: "scheme", engine: "vm", version: "intégré",
        about: "define, lambda, let nommé, cond, map, récursion terminale." },
    awk: { label: "AWK", short: "awk", ext: "awk", color: "#84CC16", mode: "shell", engine: "vm", version: "busybox",
        about: "« # input: fichier » en première ligne pour traiter un fichier." },
    markdown: { label: "Markdown", short: "md", ext: "md", color: "#64748B", mode: "gfm", engine: "page", version: "GFM",
        about: "Titres, tableaux, cases à cocher, formules $…$, diagrammes Mermaid, encadrés > [!NOTE]." },
    html: { label: "HTML", short: "html", ext: "html", color: "#F43F5E", mode: "htmlmixed", engine: "page", version: "isolé",
        about: "Rendu dans un cadre isolé, scripts compris." },
    latex: { label: "LaTeX", short: "tex", ext: "tex", color: "#14B8A6", mode: "stex", engine: "page", version: "KaTeX",
        about: "Formules en mode display, une par ligne vide." },
    csv: { label: "CSV", short: "csv", ext: "csv", color: "#0EA5E9", mode: "text/plain", engine: "page", version: "graphique",
        about: "Données en colonnes : un graphique choisi selon les en-têtes (dates, libellés, nombres, unités), ou le tableau." },
    mermaid: { label: "Mermaid", short: "mmd", ext: "mmd", color: "#8B5CF6", mode: "text/plain", engine: "page", version: "10",
        about: "Diagrammes : flowchart, séquence, classes, Gantt, états…" },
};

export const ORDER = ["python", "javascript", "java", "cpp", "c", "rust", "go", "php", "cobol", "sh", "sql", "tcl", "scheme", "awk", "markdown", "html", "latex", "csv", "mermaid"];

// Magies de cellule qui changent de langage (« %%sql » en tête d'une cellule Python…)
const MAGIC_LANG = {
    sh: "sh", bash: "sh", sql: "sql", tcl: "tcl", scheme: "scheme", awk: "awk",
    javascript: "javascript", js: "javascript", java: "java", cpp: "cpp", "c++": "cpp", c: "c", cobol: "cobol", html: "html", markdown: "markdown", md: "markdown",
    rust: "rust", go: "go", php: "php",
    latex: "latex", mermaid: "mermaid",
};

/** Langage effectif d'une cellule de code et le code à exécuter (sans la ligne de magie). */
export function resolve(lang, source) {
    const m = /^%%(\w+)[^\n]*\n?/.exec(source);
    if (m && MAGIC_LANG[m[1]] && (MAGIC_LANG[m[1]] === "javascript" || MAGIC_LANG[m[1]] === "java" || LANGS[MAGIC_LANG[m[1]]].engine === "page")) {
        return { lang: MAGIC_LANG[m[1]], code: source.slice(m[0].length) };
    }
    return { lang, code: source };
}

// Fonctions récentes absentes de Nashorn (ECMAScript 5.1) : ajoutées avant le code transpilé
const POLYFILLS = `
if (!Object.assign) Object.assign = function (t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; };
if (!Object.entries) Object.entries = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); };
if (!Object.values) Object.values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
if (!Array.from) Array.from = function (x, f) { var a = []; if (x && x.length !== undefined) for (var i = 0; i < x.length; i++) a.push(f ? f(x[i], i) : x[i]); return a; };
if (!Array.of) Array.of = function () { return Array.prototype.slice.call(arguments); };
if (!Array.prototype.find) Array.prototype.find = function (f) { for (var i = 0; i < this.length; i++) if (f(this[i], i, this)) return this[i]; };
if (!Array.prototype.findIndex) Array.prototype.findIndex = function (f) { for (var i = 0; i < this.length; i++) if (f(this[i], i, this)) return i; return -1; };
if (!Array.prototype.includes) Array.prototype.includes = function (v) { return this.indexOf(v) >= 0; };
if (!Array.prototype.fill) Array.prototype.fill = function (v) { for (var i = 0; i < this.length; i++) this[i] = v; return this; };
if (!Array.prototype.flat) Array.prototype.flat = function () { return [].concat.apply([], this); };
if (!String.prototype.includes) String.prototype.includes = function (s) { return this.indexOf(s) >= 0; };
if (!String.prototype.startsWith) String.prototype.startsWith = function (s) { return this.lastIndexOf(s, 0) === 0; };
if (!String.prototype.endsWith) String.prototype.endsWith = function (s) { return this.slice(-s.length) === s; };
if (!String.prototype.repeat) String.prototype.repeat = function (n) { return new Array(n + 1).join(this); };
if (!String.prototype.padStart) String.prototype.padStart = function (n, c) { var s = String(this); c = c || ' '; while (s.length < n) s = c + s; return s.slice(-Math.max(n, this.length)); };
if (!String.prototype.padEnd) String.prototype.padEnd = function (n, c) { var s = String(this); c = c || ' '; while (s.length < n) s += c; return s.slice(0, Math.max(n, this.length)); };
if (!Number.isInteger) Number.isInteger = function (x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; };
if (!Math.trunc) Math.trunc = function (x) { return x < 0 ? Math.ceil(x) : Math.floor(x); };
if (!Math.hypot) Math.hypot = function () { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i] * arguments[i]; return Math.sqrt(s); };
if (!Math.log2) Math.log2 = function (x) { return Math.log(x) / Math.LN2; };
if (!Math.log10) Math.log10 = function (x) { return Math.log(x) / Math.LN10; };
if (!Math.sign) Math.sign = function (x) { return x > 0 ? 1 : x < 0 ? -1 : x; };
`;

/** Les fonctions d'appoint : évaluées une fois par moteur dans la machine (LumenJava), pas devant chaque cellule —
 *  Nashorn les recompilerait à chaque nouvelle cellule (plusieurs secondes dans la machine émulée). */
export const JS_PRELUDE = POLYFILLS.trim();
export const JS_LINE_OFFSET = 0;

/** JavaScript moderne (fonctions fléchées, classes, gabarits, déstructuration…) -> ES5 pour Nashorn. */
export function transpile(code) {
    const out = buble.transform(code, {
        transforms: { modules: false, dangerousForOf: true, dangerousTaggedTemplateString: true, asyncAwait: false, generator: false },
        objectAssign: "Object.assign",
    }).code;
    return out;
}

export function languageOf(name) {
    return LANGS[name] || LANGS.python;
}

/** Coloration de Rust, Go et PHP : le mode C générique de CodeMirror (clike), avec leurs mots. */
export function defineModes(CodeMirror) {
    const words = (str) => Object.fromEntries(str.split(" ").map((w) => [w, true]));
    const raw = (q) => (stream) => { while (!stream.eol()) if (stream.next() === q) return "string"; return "string"; };
    CodeMirror.defineMIME("text/x-rustsrc", {
        name: "clike",
        keywords: words("as break const continue crate else enum extern fn for if impl in let loop match mod move mut pub ref return " +
            "self Self static struct super trait type unsafe use where while async await dyn macro_rules"),
        types: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box HashMap HashSet BTreeMap"),
        atoms: words("true false None Some Ok Err"),
        blockKeywords: words("else enum fn for if impl loop match mod struct trait while"),
        defKeywords: words("fn struct enum trait impl mod type let"),
        hooks: { "#": (stream) => { stream.match(/^!?\[[^\]]*\]/); return "meta"; } },
    });
    CodeMirror.defineMIME("text/x-go", {
        name: "clike",
        keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map " +
            "package range return select struct switch type var"),
        types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr"),
        atoms: words("true false iota nil"),
        builtin: words("append cap close copy delete len make new panic print println recover"),
        blockKeywords: words("for if switch select func struct interface"),
        defKeywords: words("func type var const"),
        hooks: { "`": raw("`") },
    });
    CodeMirror.defineMIME("text/x-php", {
        name: "clike",
        keywords: words("abstract and array as break callable case catch class clone const continue declare default do echo else elseif " +
            "empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if " +
            "implements include include_once instanceof insteadof interface isset list namespace new or print private protected public " +
            "require require_once return static switch throw trait try unset use var while xor yield"),
        atoms: words("true false null TRUE FALSE NULL"),
        builtin: words("count strlen implode explode array_map array_filter array_sum json_encode json_decode printf sprintf str_repeat"),
        blockKeywords: words("catch do else elseif for foreach if switch try while function class"),
        defKeywords: words("class function interface trait"),
        hooks: {
            $: (stream) => { stream.eatWhile(/[\w\u00a1-\uffff]/); return "variable-2"; },
            "#": (stream) => { stream.skipToEnd(); return "comment"; },
            "<": (stream) => (stream.match(/^\?(php|=)?/) ? "meta" : false),
        },
    });
}

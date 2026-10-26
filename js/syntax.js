// Lumen — coloration fine des blocs de code, à la manière de Visual Studio Code.
//
// Les modes de CodeMirror distinguent mots-clés, chaînes, nombres et commentaires. Cette couche enveloppe
// chaque mode de langage (Python, Java, C, SQL, shell…) et précise ses jetons :
//   · mots de contrôle (if, for, return, import…) à part des mots de déclaration (def, class, int…) ;
//   · appels et définitions de fonctions, noms de classes, constantes, self / this ;
//   · parenthèses, crochets et accolades colorés selon leur profondeur.
// Le Markdown, le HTML et le LaTeX gardent leur mode d'origine.

/* global CodeMirror */

const CONTROL = new Set(("if elif else for foreach while do return break continue switch case default try except catch " +
    "finally throw throws raise import from export as with yield await async goto pass then fi esac done elsif unless " +
    "loop end-if end-perform perform until").split(" "));
const SELF = new Set(["self", "this", "cls", "super"]);
const ATOMS = new Set(["True", "False", "None", "true", "false", "null", "nil", "undefined", "NULL", "nullptr"]);
const DECLARE_TYPE = new Set(["class", "struct", "interface", "enum", "record", "trait", "type", "new", "extends", "implements"]);
const NAME = /^[A-Za-z_$][\w$]*$/;
const SKIP = new Set(["null", "markdown", "gfm", "xml", "htmlmixed", "stex", "yaml-frontmatter"]);
const OPEN = "([{", CLOSE = ")]}";

function enrich(base) {
    const mode = Object.create(base);
    mode.lumenRich = true;
    mode.startState = (...a) => ({ inner: CodeMirror.startState(base, ...a), depth: 0, prev: null });
    mode.copyState = (s) => ({ inner: CodeMirror.copyState(base, s.inner), depth: s.depth, prev: s.prev });
    mode.innerMode = (s) => ({ state: s.inner, mode: base });
    if (base.indent) mode.indent = (s, text, line) => base.indent(s.inner, text, line);
    if (base.blankLine) mode.blankLine = (s) => base.blankLine(s.inner);
    mode.token = (stream, s) => {
        const style = base.token(stream, s.inner);
        const t = stream.current();
        if (!t.trim()) return style;
        const st = style || "";
        if (/\b(string|comment)\b/.test(st)) { s.prev = null; return style; }

        // Parenthèses par profondeur
        if (t.length === 1 && OPEN.includes(t)) { const c = `lx-br${s.depth % 3}`; s.depth++; s.prev = null; return `${st} ${c}`.trim(); }
        if (t.length === 1 && CLOSE.includes(t)) { s.depth = Math.max(0, s.depth - 1); s.prev = null; return `${st} lx-br${s.depth % 3}`.trim(); }

        const prev = s.prev;
        s.prev = null;
        if (/\bkeyword\b/.test(st)) {
            s.prev = t;
            if (ATOMS.has(t)) return "atom";
            if (SELF.has(t)) return "lx-self";
            return CONTROL.has(t) ? "keyword lx-ctl" : style;
        }
        if (!NAME.test(t)) return style;
        if (SELF.has(t)) return "lx-self";
        if (ATOMS.has(t)) return "atom";
        if (!st || /\b(variable|variable-2|variable-3|def|property|builtin|type|qualifier)\b/.test(st)) {
            if (prev && DECLARE_TYPE.has(prev)) return "lx-cls";
            if (stream.match(/^\s*\(/, false)) return /^[A-Z][a-z]/.test(t) ? "lx-cls" : "lx-fn";
            if (/\bdef\b/.test(st)) return "lx-fn";
            if (/^[A-Z][A-Z0-9_]+$/.test(t)) return "lx-const";
            if (/^[A-Z]\w*[a-z]/.test(t) && !/\bproperty\b/.test(st)) return "lx-cls";
            if (!st || st === "variable") return "variable";
        }
        return style;
    };
    return mode;
}

const getMode = CodeMirror.getMode;
CodeMirror.getMode = function (options, spec) {
    const m = getMode.call(this, options, spec);
    return SKIP.has(m.name) || m.lumenRich ? m : enrich(m);
};

// ---------------------------------------------------------------- COBOL
// Le mode de CodeMirror ne connaît que des mots-clés. Celui-ci lit la structure du langage : divisions et
// sections, numéros de niveau, noms déclarés, clauses PIC (« 9(7)V99 », « Z,ZZZ,ZZ9.99 »), verbes et mots de
// contrôle, constantes figuratives (ZERO, SPACES…), paragraphes, point de fin de phrase, commentaires « *> »
// et colonne 7 du format fixe (« * », « / »), zone de numérotation.

const COB = (s) => new Set(s.split(/\s+/));
const COB_CTL = COB("IF ELSE END-IF EVALUATE WHEN OTHER END-EVALUATE PERFORM END-PERFORM UNTIL VARYING TIMES THRU THROUGH " +
    "GO GOBACK STOP RUN EXIT CONTINUE CALL END-CALL RETURN NEXT SENTENCE WITH TEST BEFORE AFTER");
const COB_VERB = COB("MOVE COMPUTE DISPLAY ACCEPT ADD SUBTRACT MULTIPLY DIVIDE INITIALIZE STRING UNSTRING INSPECT TALLYING " +
    "REPLACING READ WRITE REWRITE DELETE OPEN CLOSE START SEARCH SET SORT MERGE RELEASE CANCEL ALLOCATE FREE COPY " +
    "END-COMPUTE END-ADD END-SUBTRACT END-MULTIPLY END-DIVIDE END-READ END-WRITE END-STRING END-UNSTRING END-SEARCH END-DISPLAY END-ACCEPT");
const COB_FIG = COB("ZERO ZEROS ZEROES SPACE SPACES HIGH-VALUE HIGH-VALUES LOW-VALUE LOW-VALUES QUOTE QUOTES NULL NULLS TRUE FALSE ALL");
const COB_WORD = COB("DIVISION SECTION PROGRAM-ID AUTHOR FUNCTION-ID CLASS-ID IDENTIFICATION ENVIRONMENT DATA PROCEDURE " +
    "CONFIGURATION INPUT-OUTPUT FILE-CONTROL WORKING-STORAGE LOCAL-STORAGE LINKAGE FILE SCREEN REPORT SELECT ASSIGN FD SD " +
    "ORGANIZATION ACCESS MODE SEQUENTIAL LINE INDEXED RELATIVE RECORD KEY STATUS " +
    "PIC PICTURE VALUE VALUES IS ARE OCCURS DEPENDING INDEXED REDEFINES RENAMES USAGE COMP COMP-1 COMP-2 COMP-3 COMP-5 BINARY " +
    "PACKED-DECIMAL DISPLAY-1 POINTER SIGN LEADING TRAILING SEPARATE JUSTIFIED RIGHT LEFT BLANK FILLER GLOBAL EXTERNAL " +
    "FROM BY TO INTO GIVING ROUNDED REMAINDER ON SIZE ERROR NOT INVALID END AT OF IN USING RETURNING REFERENCE CONTENT " +
    "AND OR EQUAL EQUALS GREATER LESS THAN POSITIVE NEGATIVE NUMERIC ALPHABETIC UPON CONSOLE NO ADVANCING DELIMITED " +
    "COUNT POINTER CORRESPONDING CORR FIRST INITIAL CHARACTERS UP DOWN OUTPUT I-O EXTEND FUNCTION");

CodeMirror.defineMode("cobol", () => ({
    lumenRich: true,
    lineComment: "*>",
    startState: () => ({ div: "", expect: null, depth: 0 }),
    copyState: (s) => ({ ...s }),
    token(stream, s) {
        if (stream.sol()) {
            s.expect = s.expect === "name-or-level" ? null : s.expect === "pic" ? null : s.expect;
            s.line = true;
            // format fixe : zone de numérotation (colonnes 1 à 6), puis « * » ou « / » en colonne 7 pour un commentaire
            if (stream.match(/^\d{6}(?=[ *\/-]|$)/)) return "comment";
            if (stream.column() === 6 && /[*\/]/.test(stream.peek() || "")) { stream.skipToEnd(); return "comment"; }
        }
        if (stream.column() === 6 && /^[\d ]{6}[*\/]/.test(stream.string)) { stream.skipToEnd(); return "comment"; }
        if (stream.eatSpace()) return null;
        const first = s.line;
        s.line = false;
        if (stream.match("*>")) { stream.skipToEnd(); return "comment"; }
        if (stream.match(/^"(?:[^"]|"")*"?/) || stream.match(/^'(?:[^']|'')*'?/)) return "string";
        // une clause PIC : tout le motif d'un seul tenant, sans le point qui finit la phrase
        if (s.expect === "pic") {
            if (stream.match(/^IS\b/i)) return "keyword";
            const m = stream.match(/^\S+/);
            if (m) {
                if (/\.$/.test(m[0]) && m[0].length > 1) stream.backUp(1);
                s.expect = null;
                return "string-2";
            }
        }
        if (stream.match(/^[+-]?\d+(?:[.,]\d+)?(?![\w-])/)) {
            const t = stream.current();
            // un numéro de niveau en tête de ligne (01, 05, 77, 88…) : le nom déclaré suit
            if (first && s.div === "DATA" && /^\d{1,2}$/.test(t)) { s.expect = "decl"; return "meta"; }
            return "number";
        }
        if (stream.match(/^\.(?=\s|$)/)) { s.expect = null; return "lx-period"; }
        if (stream.match(/^[()]/)) {
            const open = stream.current() === "(";
            if (!open) s.depth = Math.max(0, s.depth - 1);
            const c = `bracket lx-br${s.depth % 3}`;
            if (open) s.depth++;
            return c;
        }
        if (stream.match(/^(\*\*|>=|<=|[-+*\/=<>&:,])/)) return "operator";
        const w = stream.match(/^[A-Za-z0-9][A-Za-z0-9_-]*/);
        if (!w) { stream.next(); return null; }
        const word = w[0].toUpperCase().replace(/-$/, "");
        // « IDENTIFICATION DIVISION », « WORKING-STORAGE SECTION » : les grandes parties du programme
        if (stream.match(/^\s+(DIVISION|SECTION)\b/i, false)) {
            if (/^(IDENTIFICATION|ID|ENVIRONMENT|DATA|PROCEDURE)$/.test(word)) s.div = word === "ID" ? "IDENTIFICATION" : word;
            return "lx-cobdiv";
        }
        if (word === "DIVISION" || word === "SECTION") return "lx-cobdiv";
        if (s.expect === "decl") { s.expect = null; return "def"; }
        if (s.expect === "prog") { s.expect = null; return "lx-cls"; }
        if (s.expect === "call") { s.expect = null; return "lx-fn"; }
        if (word === "PIC" || word === "PICTURE") { s.expect = "pic"; return "keyword"; }
        if (word === "PROGRAM-ID" || word === "FUNCTION-ID") { s.expect = "prog"; return "keyword"; }
        if (word === "PERFORM" || word === "GO" || word === "THRU" || word === "THROUGH") {
            // PERFORM CALCUL : un paragraphe ; PERFORM VARYING / UNTIL / n TIMES : une boucle
            if (stream.match(/^\s+(?!VARYING\b|UNTIL\b|WITH\b|TEST\b|TO\b|\d)[A-Za-z0-9][\w-]*/i, false)) s.expect = word === "GO" ? "go" : "call";
            return "keyword lx-ctl";
        }
        if (s.expect === "go" && word === "TO") { s.expect = "call"; return "keyword lx-ctl"; }
        if (COB_FIG.has(word)) return "atom";
        if (COB_CTL.has(word)) return "keyword lx-ctl";
        if (COB_VERB.has(word)) return "keyword lx-cobverb";
        if (COB_WORD.has(word)) return "keyword";
        // un nom seul en tête de ligne, suivi d'un point, dans la PROCEDURE DIVISION : un paragraphe
        if (first && s.div === "PROCEDURE" && stream.match(/^\.\s*$/, false)) return "def";
        if (/^\d+$/.test(word)) return "number";
        return "variable-2";
    },
}));

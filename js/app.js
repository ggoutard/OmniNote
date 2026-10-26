// app.js — Lumen : un seul document, écrit comme un texte.
//   · le Markdown prend forme pendant la frappe (les signes de mise en forme ne s'affichent que sur la ligne du curseur) ;
//   · les blocs ```python, ```sql… se colorent selon leur langage ;
//   · « / » en début de ligne ouvre le menu : /python, /sql… insèrent un bloc, /exécuter lance le bloc ;
//   · le résultat d'un bloc s'affiche entre les lignes, juste sous le bloc ;
//   · la marge replie une section entière (titre) ou le code d'un bloc ;
//   · une fenêtre (tkinter, turtle, Swing) devient une image dans le résultat ; on peut la reprendre en direct,
//     la détacher dans une fenêtre flottante, la rattacher (nouvelle image) ou la passer en plein écran.

/* global CodeMirror */
import "./syntax.js";
import { Kernel } from "./kernel.js";
import { LANGS, ORDER, resolve, transpile, JS_LINE_OFFSET, JS_PRELUDE, languageOf, defineModes } from "./languages.js";
import { renderOutput, outputText, safeSvg, renderMarkdown, htmlHasCode } from "./render.js";
import { clipboardLang, detectPaste, dedent } from "./detect.js";
import { checkMath } from "./preuve/index.js";
import { buildModel } from "./modele/modele.js";
import { text as sortText } from "./modele/sortes.js";
import { knownName } from "./gramalectica/translate.js";
import { phrasesIn, slidersIn, tablesIn, externalData, readDocument, runDocument, toShare, toCpp, readOutput, contextOf, completions, correctPhrase,
    ambiguity, actionsFor, paraphrase, lexiconOf, withLexicon, readingRule, addReading, readingText, tournureFrom, addTournure } from "./gramalectica/index.js";
import { newCell, fromIpynb, toIpynb, library } from "./notebook.js";
import { welcome, dataTour, article, presentation } from "../examples/welcome.js";
import { irisProject } from "../examples/iris.js";
import { langueArticle } from "../examples/langue.js";
import { Terminal, TERM_ACTIONS } from "./terminal.js";
import { hasLink, makeLink, readLink, pack, unpack, linkOf } from "./link.js";
import { remember, list as versionList, bytesOf, saveUndo, loadUndo } from "./versions.js";
import { frontMatter, isScience, analyze, inlineParts, titleBlock, references, resolveLine } from "./science.js";
import { Deck, isDeck } from "./deck.js";
import { DEP_LANGS, planDeps, blockHash, symbols } from "./deps.js";
import { openDiagram } from "./diagram.js";
import { diag } from "./diag.js";
import { setupHome } from "./home.js";
import { setupPrint } from "./print.js";
import { setupVmWindows } from "./vmwindows.js";
import { setupCubi } from "./cubi.js";
import { createReactive } from "./reactive.js";
import { findFormulas, injection as formulaCode, evaluate as evalFormula, signature, formatValue, FORMULA_LANGS } from "./formulas.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
// Sur iPad (et iPhone avec clavier), Option sert aux caractères spéciaux et le système en garde les raccourcis :
// la touche Cmd (⌘) y remplace Alt dans ceux de TextEdit
const cmdForAlt = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ALT = cmdForAlt ? "⌘" : "Alt";
const MOD = isMac ? "⌘" : "Ctrl";
const Pos = CodeMirror.Pos;
const THEMES = { auto: "automatique", light: "clair", dark: "sombre", "hc-dark": "contraste élevé sombre", "hc-light": "contraste élevé clair" };
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace(".", ",")} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const prefs = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(`lumen.${k}`)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`lumen.${k}`, JSON.stringify(v)); } catch { /* navigation privée */ } },
};

const DOC_ID = "document";
// ```python, ```python {2|3-4|all} (lignes surlignées au clic), ````md magic-move (comme Slidev)
const FENCE = /^(`{3,}|~{3,})\s*([\w+#.-]*)((?:[ \t]+[\w-]+)*)[ \t]*(\{[^}]*\})?\s*$/;
const HEADING = /^(#{1,6})\s/;
const GUI = /\b(tkinter|turtle|Tk\(|javax\.swing|java\.awt|JFrame)\b/;

// ---------------------------------------------------------------- état

const S = {
    title: "Sans titre",
    pages: [{ cells: null }],   // les pages du document : { cells, path, hist, cur, top } (celle qu'on lit est dans l'éditeur)
    dirs: [],                   // les dossiers créés dans le terminal (ceux des chemins des pages s'en déduisent)
    prior: { phrases: [], tables: [], formulas: [], key: "" },   // ce que les autres pages apportent à celle qu'on lit
    page: 0,
    theme: prefs.get("theme", "auto"),
    dark: false,
    exec: 0,
    ranAt: new Map(),       // empreinte d'un bloc (deps.js) -> numéro de son exécution réussie dans la machine actuelle
    runSeq: 0,
    saved: 0,
    blocks: [],             // blocs de code du document, recalculés à chaque modification
    outs: new Map(),        // ligne d'ouverture du bloc -> { outputs, node, widget, status, running }
    // Les phrases _…_ (Grama Lectica) : aperçu de l'interpréteur, puis résultats du programme C++ compilé
    gl: { key: "", code: "", marks: [], outs: new Map(), read: [], results: [], cpp: null, cppTimer: 0, syncTimer: 0,
        sources: {}, ext: undefined, extKey: "" },   // sources : les objets de chaque langage (fiches de classe)
    media: new Map(),       // première ligne d'un <svg>…</svg> ou d'une image du texte -> { key, mark } : le dessin à la place du code
    labels: new Map(),      // ligne d'ouverture -> { key, marks } : la ligne ``` remplacée par le nom du langage
    folds: new Map(),       // ligne repliée -> marque
    fx: new Map(),          // ligne -> { cls, until } : animation passagère de la mise en forme
    gutter: new Map(),      // ligne -> repliée ou non : les flèches posées dans la marge
    fxTimer: 0,
    lastActive: null,
    showTrad: prefs.get("traduction", false),   // /traduction : sous chaque phrase en français libre, sa traduction
    sci: { on: false, info: null, marks: new Map() },
    math: { key: "", text: "", marks: [], widgets: [], timer: 0, results: [] },   // les énoncés et preuves vérifiés (preuve/)
    deckMode: false,        // mode présentation (deck.js) : l'en-tête « mode: présentation »
    formulas: [],           // les formules du document ($$ f(x, y) = … $$), appelables depuis le code (formulas.js)
    fxWidgets: new Map(),   // ligne de fin d'une formule -> { key, widget } : sa signature, sous l'équation   // mode scientifique (science.js) : ses rendus, ligne par ligne
    undoReady: false,       // l'annulation rangée (versions.js) a été reprise : on peut désormais la ranger
    link: null,             // document reçu par lien : { ro, hello } ; il n'est pas enregistré, sauf « Modifier une copie »
    opening: false,
};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const kernel = new Kernel($("#vm-screen"), { base: "./" });
// les formules ($$ … $$) déjà définies dans le noyau : par langage, les morceaux de prélude qu'il a (formulas.js,
// injection().parts) ; un bloc n'envoie que ceux qui lui manquent — souvent rien
const preludeSent = new Map();
const preludeMissing = (lang, fx) => { const have = preludeSent.get(lang); return (fx.parts || [fx.prelude]).filter((x) => !have?.has(x)); };
const preludeDone = (lang, parts) => { const have = preludeSent.get(lang) || new Set(); parts.forEach((x) => have.add(x)); preludeSent.set(lang, have); };
// Pour la console et les tests : l'état de la page, le noyau, et ce qu'il a mesuré (diag.js) — rien n'en sort
window.textedit = { kernel, diag, get state() { return S; }, get editor() { return cm; }, report: () => diagReport(), printView: (...a) => printer.printView(...a) };

// Les blocs ```java, ```sql… se colorent avec le mode de leur langage
defineModes(CodeMirror);
for (const [k, L] of Object.entries(LANGS)) {
    const spec = CodeMirror.resolveMode(L.mode);
    if (k !== "markdown" && !CodeMirror.modes[k] && CodeMirror.modes[spec.name]) CodeMirror.defineMIME(k, spec);
}
CodeMirror.defineMIME("py", "python");
CodeMirror.defineMIME("js", "javascript");

// ---------------------------------------------------------------- l'éditeur

/** Entoure chaque sélection du signe (« ** » en deux frappes) ; le texte reste sélectionné, sans le signe. */
function surround(ed, mark) {
    if (!ed.somethingSelected()) return CodeMirror.Pass;
    const sels = ed.listSelections();
    ed.operation(() => {
        const next = [];
        for (const r of [...sels].reverse()) {
            const from = CodeMirror.cmpPos(r.anchor, r.head) <= 0 ? r.anchor : r.head;
            const to = from === r.anchor ? r.head : r.anchor;
            ed.replaceRange(mark + ed.getRange(from, to) + mark, from, to, "+surround");
            next.unshift({ anchor: Pos(from.line, from.ch + mark.length), head: Pos(to.line, to.ch + (to.line === from.line ? mark.length : 0)) });
        }
        ed.setSelections(next);
    });
    return undefined;
}

/** Ctrl B / Ctrl I : met en gras ou en italique la sélection (ou le mot du curseur), ou l'enlève si elle l'est déjà. */
function toggleMark(ed, mark) {
    if (blockAt()) return CodeMirror.Pass;
    if (!ed.somethingSelected()) {
        const w = ed.findWordAt(ed.getCursor());
        if (w.anchor.ch === w.head.ch) { ed.replaceSelection(mark + mark); ed.setCursor(Pos(ed.getCursor().line, ed.getCursor().ch - mark.length)); return undefined; }
        ed.setSelection(w.anchor, w.head);
    }
    const from = ed.getCursor("from"), to = ed.getCursor("to"), n = mark.length;
    const before = ed.getRange(Pos(from.line, Math.max(0, from.ch - n)), from), after = ed.getRange(to, Pos(to.line, to.ch + n));
    // Déjà entouré (et pas un « ** » quand on demande l'italique) : on retire le balisage
    const bold = ed.getRange(Pos(from.line, Math.max(0, from.ch - 2)), from) === "**" && ed.getRange(to, Pos(to.line, to.ch + 2)) === "**";
    if (before === mark && after === mark && (n === 2 || !bold || ed.getRange(Pos(from.line, Math.max(0, from.ch - 3)), from) === "***")) {
        ed.operation(() => {
            ed.replaceRange("", to, Pos(to.line, to.ch + n), "+surround");
            ed.replaceRange("", Pos(from.line, from.ch - n), from, "+surround");
            ed.setSelection(Pos(from.line, from.ch - n), Pos(to.line, to.ch - (to.line === from.line ? n : 0)));
        });
        return undefined;
    }
    for (const c of mark) surround(ed, c);
    return undefined;
}

const cm = CodeMirror($("#doc"), {
    value: "",
    mode: { name: "gfm", highlightFormatting: true, fencedCodeBlockHighlighting: true },
    theme: "lumen",
    lineWrapping: true,   // texte et code reviennent à la ligne au bout de la colonne centrée
    scrollbarStyle: "null",
    singleCursorHeightPerLine: false,   // le curseur a la hauteur du texte qu'on écrit : grand dans un titre, petit dans le code   // pas de barres de défilement : la molette, le pavé tactile et le clavier suffisent
    viewportMargin: Infinity,
    gutters: ["lx-fold"],
    matchBrackets: true,
    autoCloseBrackets: "()[]{}",
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    placeholder: "Écrivez. « / » en début de ligne insère un bloc de code ou exécute.",
    spellcheck: false,
    extraKeys: {
        "Shift-Enter": () => { const b = blockAt(); if (!b) return CodeMirror.Pass; runBlock(b.open, { live: true }); leaveBlock(b); return undefined; },
        "Ctrl-Enter": () => { const b = blockAt(); if (!b) return CodeMirror.Pass; runBlock(b.open, { live: true }); return undefined; },
        "Cmd-Enter": () => { const b = blockAt(); if (!b) return CodeMirror.Pass; runBlock(b.open, { live: true }); return undefined; },
        // Comme VS Code : un signe de balisage tapé sur une sélection l'entoure au lieu de la remplacer
        "'*'": (ed) => surround(ed, "*"), "'_'": (ed) => surround(ed, "_"), "'`'": (ed) => surround(ed, "`"), "'~'": (ed) => surround(ed, "~"),
        "Ctrl-B": (ed) => toggleMark(ed, "**"), "Cmd-B": (ed) => toggleMark(ed, "**"),
        "Ctrl-I": (ed) => toggleMark(ed, "*"), "Cmd-I": (ed) => toggleMark(ed, "*"),
        Enter: (ed) => continueList(ed),
        Backspace: () => guardEdge(-1),
        Delete: () => guardEdge(1),
        Tab: (ed) => {
            if (ed.somethingSelected()) return ed.execCommand("indentMore");
            const cur = ed.getCursor();
            const before = ed.getLine(cur.line).slice(0, cur.ch);
            if (blockAt() && /[\w.]$/.test(before)) return ed.showHint({ hint: kernelHint, completeSingle: false });
            if (!blockAt() && /^\s*([-*+]|\d+[.)])\s/.test(before)) return ed.execCommand("indentMore");
            ed.replaceSelection(" ".repeat(ed.getOption("indentUnit")));
            return undefined;
        },
        [cmdForAlt ? "Cmd-Down" : "Alt-Down"]: () => jumpHeading(1),
        [cmdForAlt ? "Cmd-Up" : "Alt-Up"]: () => jumpHeading(-1),
        "Shift-Tab": (ed) => (ed.somethingSelected() || !blockAt() ? ed.execCommand("indentLess") : inspectAtCursor()),
        "Ctrl-Space": (ed) => (phrasePrefix() ? glcUpdate(true) : ed.showHint({ hint: kernelHint, completeSingle: false })),
        "Ctrl-/": "toggleComment",
        "Cmd-/": "toggleComment",
    },
});

// ---------------------------------------------------------------- blocs de code

function fenceLang(info) {
    const n = fold(info || "");
    const alias = { py: "python", python3: "python", js: "javascript", node: "javascript", bash: "sh", shell: "sh", zsh: "sh", "c++": "cpp", cxx: "cpp",
        sqlite: "sql", tex: "latex", cob: "cobol", scm: "scheme", lisp: "scheme", mmd: "mermaid", md: "markdown", tsv: "csv",
        rs: "rust", golang: "go", php7: "php", php8: "php" };
    const k = alias[n] || n;
    return LANGS[k] && k !== "markdown" ? k : null;
}

/** Les blocs ``` du document : ligne d'ouverture, de fermeture, langage. */
function scan() {
    const blocks = [];
    let open = null;
    let n = 0;
    cm.eachLine((h) => {
        const t = h.text;
        if (!open) {
            const m = FENCE.exec(t);
            if (m) open = { open: h, start: n, fence: m[1], lang: fenceLang(m[2]), info: m[2], extra: (m[3] || "").trim(), meta: m[4] || "" };
        } else if (/^\s*(`{3,}|~{3,})\s*$/.test(t) && t.trim()[0] === open.fence[0] && t.trim().length >= open.fence.length) {
            blocks.push({ ...open, close: h, end: n });
            open = null;
        }
        n++;
    });
    if (open) blocks.push({ ...open, close: null, end: cm.lastLine() });
    return blocks;
}

function blockAt(line = cm.getCursor().line) {
    return S.blocks.find((b) => line > b.start && line <= (b.close ? b.end - 1 : b.end)) || null;
}
function blockOf(open) { return S.blocks.find((b) => b.open === open) || null; }
function blockSource(b) {
    const last = b.close ? b.end - 1 : b.end;
    return last < b.start + 1 ? "" : cm.getRange(Pos(b.start + 1, 0), Pos(last, cm.getLine(last).length));
}

/** Après Maj Entrée : le curseur passe sous le bloc (une ligne vide est créée au besoin). */
function leaveBlock(b) {
    S.blocks = scan();
    b = blockOf(b.open) || b;   // le bloc a pu raccourcir (commande d'exécution retirée)
    const after = b.end + 1;
    if (after > cm.lastLine()) cm.replaceRange("\n", Pos(b.end, cm.getLine(b.end).length));
    cm.setCursor(Pos(after, 0));
}

// ---------------------------------------------------------------- mise en forme du texte

let decorating = false;
function decorate() {
    if (decorating) return;
    decorating = true;
    S.blocks = scan();
    const cur = S.link?.ro ? -1 : cm.getCursor().line;   // en lecture, aucune ligne ne montre ses signes
    const want = new Map();
    const inCode = new Set();
    for (const b of S.blocks) {
        want.set(b.open, b.close ? "lx-fence lx-fence-open" : "lx-fence-raw");
        if (b.close) want.set(b.close, "lx-fence lx-fence-close");
        for (let n = b.start; n <= b.end; n++) inCode.add(n);
        for (let n = b.start + 1; n <= (b.close ? b.end - 1 : b.end); n++) want.set(cm.getLineHandle(n), b.lang ? "lx-code" : "lx-code lx-plain");
    }
    let n = 0;
    // (l'en-tête « --- … --- » du mode scientifique n'est pas fait de traits de séparation)
    const fmEnd = cm.getLine(0)?.trim() === "---" ? frontMatter(cm.getValue().split("\n", 61))?.end ?? -1 : -1;
    cm.eachLine((h) => {
        const t = h.text;
        // l'en-tête « --- clé: valeur --- » : en petit, discret (sa dernière ligne n'est pas un titre souligné)
        if (n <= fmEnd) { want.set(h, n === 0 || n === fmEnd ? "lx-fm lx-fm-rule" : "lx-fm"); n++; return; }
        if (!inCode.has(n)) {
            const hm = HEADING.exec(t);
            const c = hm ? `lx-h lx-h${hm[1].length}` : /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(t) ? "lx-hr" : /^\s{0,3}>/.test(t) ? "lx-quote" : "";
            if (c) want.set(h, c);
            if (/^\s*\/[\p{L}#]/u.test(t)) want.set(h, "lx-cmd");   // une commande « / » s'écrit en bleu
        } else if (/^\s*\/ai\b/.test(t)) want.set(h, `${want.get(h) || ""} lx-cmd`.trim());
        n++;
    });
    // Le code d'un <svg> qu'on édite s'écrit en police de code
    for (const r of svgRegions()) for (let i = r.start; i <= r.end; i++) want.set(cm.getLineHandle(i), "lx-svgsrc");
    const active = cm.getLineHandle(cur);
    // La mise en forme qui vient de prendre forme s'anime un instant : un titre, un séparateur, une citation qui naît,
    // une ligne qu'on quitte (ses **gras**, `code`, liens se révèlent).
    const now = Date.now();
    if (!reduceMotion.matches) {
        const kind = (w) => /lx-h\b|lx-hr|lx-quote/.exec(w || "")?.[0];
        cm.eachLine((h) => {
            const before = kind(h.wrapClass), after = kind(want.get(h));
            if (after && after !== before && h !== active) S.fx.set(h, { cls: "lx-enter", until: now + 450 });
        });
        if (S.lastActive && S.lastActive !== active && cm.getLineNumber(S.lastActive) != null) {
            const left = kind(want.get(S.lastActive));
            if (left) S.fx.set(S.lastActive, { cls: "lx-enter", until: now + 450 });
            else if (/[*_`[~]/.test(S.lastActive.text)) S.fx.set(S.lastActive, { cls: "lx-settle", until: now + 650 });
        }
    }
    S.lastActive = active;
    for (const [h, fx] of S.fx) if (fx.until <= now || cm.getLineNumber(h) == null) S.fx.delete(h);
    if (S.fx.size) { clearTimeout(S.fxTimer); S.fxTimer = setTimeout(decorate, Math.min(...[...S.fx.values()].map((f) => f.until)) - now + 20); }
    cm.operation(() => {
        cm.eachLine((h) => {
            let w = want.get(h) || "";
            if (S.fx.has(h)) w = `${w} ${S.fx.get(h).cls}`.trim();
            if (h === active) w = `${w} lx-active`.trim();
            if ((h.wrapClass || "") !== w) {
                if (h.wrapClass) cm.removeLineClass(h, "wrap");
                if (w) cm.addLineClass(h, "wrap", w);
            }
        });
        drawFences();
        drawMedia();
        drawPhrases();
        drawScience();
        drawMath();
        drawDeckMode(fmEnd);
        drawComments(inCode);
        drawPageLinks(inCode);
        drawFormulas(inCode);
        drawFoldGutter(inCode);
        syncOutputs();
    });
    decorating = false;
    updateTitle();
    updateStatus();
}

/**
 * Un <svg>…</svg> écrit dans le texte s'affiche dessiné. Le curseur qui y entre (clic sur le dessin, flèches)
 * fait revenir le code ; il se redessine quand on en sort. Le SVG passe par safeSvg : ni script ni lien.
 */
function svgRegions() {
    const out = [];
    const inBlock = (n) => S.blocks.some((b) => n >= b.start && n <= b.end);
    for (let n = 0; n <= cm.lastLine(); n++) {
        if (!/^\s*<svg[\s>]/i.test(cm.getLine(n)) || inBlock(n)) continue;
        let end = n;
        while (end <= cm.lastLine() && !/<\/svg\s*>/i.test(cm.getLine(end)) && !inBlock(end)) end++;
        if (end > cm.lastLine() || inBlock(end)) continue;   // pas encore refermé : on le laisse en code
        out.push({ start: n, end });
        n = end;
    }
    return out;
}

// Une image Markdown seule sur sa ligne : ![légende](adresse), l'adresse pouvant être une image collée (data:)
const IMG_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)(?:\s*\{#[\w:.-]+\})?\s*$/;   // (étiquette {#fig:…} du mode scientifique)

/**
 * Les SVG et les images du texte s'affichent à la place de leur code, centrés, dans leurs proportions.
 * Le curseur qui y entre fait revenir le code ; l'adresse d'une image collée reste repliée en une étiquette.
 */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Un tableau Markdown en <table> : alignement de la ligne de tirets, nombres à droite, **gras** et `code` dans les cases */
function markdownTable(text) {
    const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const [head, rule, ...rows] = text.split("\n");
    const align = cells(rule).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:/.test(c) ? "left" : ""));
    const inline = (c) => esc(c).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const num = (c) => /^-?[\d\s\u00a0\u202f]+(?:[.,]\d+)?\s*[€$%]?$/.test(c) && /\d/.test(c);
    const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : num(c) ? ' class="num"' : ""}>${inline(c)}</${tag}>`;
    const t = document.createElement("table");
    t.className = "lx-tbl";
    const width = cells(head).length;
    t.innerHTML = `<thead><tr>${cells(head).map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${Array.from({ length: width }, (_, k) => cell("td", cells(r)[k] ?? "", k)).join("")}</tr>`).join("")}</tbody>`;
    return t;
}

function drawMedia() {
    const sel = cm.listSelections();
    const editing = (r) => sel.some((x) => Math.max(x.anchor.line, x.head.line) >= r.start && Math.min(x.anchor.line, x.head.line) <= r.end);
    const want = [];
    for (const r of svgRegions()) {
        if (editing(r)) continue;
        want.push({ ...r, kind: "svg", text: cm.getRange(Pos(r.start, 0), Pos(r.end, cm.getLine(r.end).length)) });
    }
    const inBlock = (n) => S.blocks.some((x) => n >= x.start && n <= x.end);
    // Un tableau Markdown se dessine en tableau quand le curseur n'y est pas ; y cliquer fait revenir ses « | »
    for (let n = 0; n < cm.lastLine(); n++) {
        if (inBlock(n) || !/^\s*\|/.test(cm.getLine(n)) || !TABLE_RULE.test(cm.getLine(n + 1))) continue;
        let end = n + 1;
        while (end < cm.lastLine() && /^\s*\|/.test(cm.getLine(end + 1))) end++;
        const r = { start: n, end, text: cm.getRange(Pos(n, 0), Pos(end, cm.getLine(end).length)), kind: "table" };
        if (!editing(r)) want.push(r);
        n = end;
    }
    for (let n = 0; n <= cm.lastLine(); n++) {
        const t = cm.getLine(n);
        const m = t.includes("![") && IMG_LINE.exec(t);
        if (!m || inBlock(n)) continue;
        const r = { start: n, end: n, text: t, alt: m[1], src: m[2] };
        if (!editing(r)) want.push({ ...r, kind: "img" });
        else if (m[2].startsWith("data:")) want.push({ ...r, kind: "chip", at: t.indexOf(m[2]) });
    }
    const seen = new Set();
    for (const r of want) {
        const h = cm.getLineHandle(r.start);
        const fig = S.sci.on && r.kind === "img" ? S.sci.info?.figures.get(r.start) : null;
        const key = `${r.kind}|${r.end - r.start}|${r.text}|${fig?.num || ""}`;
        seen.add(h);
        const old = S.media.get(h);
        if (old?.key === key && old.mark.find()) continue;
        old?.mark.clear();
        let mark;
        if (r.kind === "chip") {
            const chip = document.createElement("span");
            chip.className = "lx-data";
            chip.textContent = `image collée · ${Math.round(r.src.length * 0.75 / 1024)} Ko`;
            mark = cm.markText(Pos(r.start, r.at), Pos(r.start, r.at + r.src.length), { replacedWith: chip, atomic: true });
        } else {
            const box = document.createElement("div");
            box.className = "lx-media";
            if (r.kind === "table") box.append(markdownTable(r.text));
            else if (r.kind === "svg") {
                const svg = safeSvg(r.text.trim());
                if (svg) box.append(svg);
                else { box.classList.add("bad"); box.textContent = "SVG invalide — cliquer pour corriger"; }
            } else {
                const img = new Image();
                const size = /^(.*?)\s*\|\s*(\d{1,4})(?:\s*x\s*(\d{1,4}))?$/.exec(r.alt);   // ![légende|300] ou ![légende|300x200]
                if (size) { r.alt = size[1]; img.style.width = `${size[2]}px`; if (size[3]) img.style.height = `${size[3]}px`; img.classList.add("sized"); }
                img.alt = r.alt;
                img.decoding = "async";
                img.addEventListener("load", () => mark.changed());
                img.addEventListener("error", () => { box.classList.add("bad"); box.textContent = `Image introuvable : ${r.src.slice(0, 80)}`; mark.changed(); });
                img.src = r.src;
                box.append(img);
                if (fig) box.insertAdjacentHTML("beforeend", `<small class="sci-figcap">Figure ${fig.num}${r.alt ? " – " + esc(r.alt) : ""}</small>`);
                else if (r.alt && !/^(image|img)$/i.test(r.alt)) box.insertAdjacentHTML("beforeend", `<small>${esc(r.alt)}</small>`);
            }
            mark = cm.markText(Pos(r.start, 0), Pos(r.end, cm.getLine(r.end).length), { replacedWith: box, handleMouseEvents: true });
        }
        S.media.set(h, { key, mark });
    }
    for (const [h, v] of S.media) if (!seen.has(h)) { v.mark.clear(); S.media.delete(h); }
}

// ---------------------------------------------------------------- parler à la machine : _une phrase_
// Dans le texte, une phrase entre _…_ est une instruction de Grama Lectica (js/gramalectica). Ses mots se colorent
// comme du code selon ce que la machine a compris. Le document s'exécute de haut en bas à chaque changement, comme
// un tableur, directement dans la page : seul « affiche » produit une sortie, écrite sous la ligne comme le résultat
// d'un bloc. Une erreur ne s'écrit pas dans le texte : elle se souligne à l'endroit en cause, le message au survol.

function drawPhrases() {
    const G = S.gl;
    const active = S.link?.ro ? -1 : cm.getCursor().line;
    const inBlock = (n) => S.blocks.some((b) => n >= b.start && n <= b.end);
    const found = [];
    cm.eachLine((h) => {
        if (!h.text.includes("_")) return;
        const n = cm.getLineNumber(h);
        if (inBlock(n)) return;
        for (const p of phrasesIn(h.text)) found.push({ ...p, h, n });
    });
    // Les phrases des pages précédentes passent d'abord : ce qu'elles déclarent vaut pour celle-ci (sans s'afficher)
    const prior = S.prior.phrases, off = prior.length;
    G.found = found; G.off = off;
    const texts = [...prior, ...found.map((p) => p.text)];
    // Les tableaux Markdown du document sont des données (« le tableau Logements ») : un tableau modifié relance tout
    // … et les tables SQL : un tableau Markdown du même nom l'emporte
    // ce que le document a appris (learn.js) : son lexique, à la fin du texte
    const lex = lexiconOf(cm.getValue());
    const ext = { ...(G.ext || NO_EXT), lexicon: lex };
    const tables = new Map([...(ext?.tables || []), ...S.prior.tables, ...(/\|/.test(cm.getValue()) ? tablesIn(cm.getValue().split("\n")) : [])]);
    const key = `${active}${S.showTrad ? "t" : ""}|${S.prior.key}|${found.map((p) => `${p.n}:${p.from}:${p.text}`).join("\u0001")}|${JSON.stringify([...tables].map(([k, t]) => [k, t.columns, t.rows]))}|${G.extKey}|${JSON.stringify(lex)}`;
    if (key === G.key) return;
    const code = key.slice(key.indexOf("|"));
    G.key = key;
    if (code !== G.code) {
        G.code = code;
        G.read = readDocument(texts, tables, ext);
        G.results = runDocument(G.read, ext);
        G.readExt = ext;
        G.cpp = null;
        // Vers la jonction des langages : ce que le document a écrit, pas ce qu'il a reçu des autres
        scheduleSync(new Map([...G.results.globals].filter(([k]) => G.results.own.has(k))));
        scheduleCpp();
    }
    // La phrase qu'on vient de finir (son point est écrit) : se lit-elle de deux façons qui donnent deux résultats ?
    const done = found.findIndex((p) => p.n === active && /[.!?]\s*$/.test(p.text));
    const askKey = done >= 0 ? `${G.code}|${off + done}` : "";
    if (askKey !== G.askKey) {
        G.askKey = askKey;
        G.ask = null;
        if (done >= 0) { try { G.ask = { k: off + done, p: found[done], ...ambiguity(G.read, off + done, ext) }; } catch (e) { diag.log("lecture", { error: String(e?.message || e) }); } }
        if (!G.ask?.options) G.ask = null;
    }
    drawAsk(G.ask, lex);
    // Le programme C++ fait foi dès qu'il a tourné sur cette version du document
    const results = G.cpp?.code === G.code ? G.cpp.results : G.results.results;
    // Coloration, doutes, erreurs
    for (const m of G.marks) m.clear();
    G.marks = [];
    const at = (p, x) => Pos(p.n, p.from + 1 + (p.at ? p.at(x) : x));
    found.forEach((p, j) => {
        const k = off + j;
        const r = G.read[k], res = results[k];
        const editing = p.n === active;
        // au survol de la phrase : ce que la machine a compris, redit en français canonique (paraphrase.js)
        G.marks.push(cm.markText(Pos(p.n, p.from), Pos(p.n, p.to), { className: "lx-m", ...(r.ast ? { attributes: { title: `Compris : ${paraphrase(r.ast)}` } } : {}) }));
        // les curseurs {650, de 400 à 1500} : dessinés comme des curseurs, sauf sur la ligne qu'on écrit
        if (p.sliders && !editing) p.sliders.forEach((sl, q) => G.marks.push(cm.markText(Pos(p.n, p.from + 1 + sl.from), Pos(p.n, p.from + 1 + sl.to),
            { replacedWith: sliderWidget(p.h, p.from, q, sl), handleMouseEvents: true, atomic: true })));
        // une donnée : sa sorte au survol (« notes : une liste d'entiers »), d'après le juge par les sortes
        for (const role of r.roles) G.marks.push(cm.markText(at(p, role.at), at(p, role.end), { className: `lx-m-${role.role}`,
            ...(role.role === "data" ? { attributes: { title: sortTitle(p.text.slice(role.at, role.end), G.results.typing) } } : {}) }));
        for (const d of r.doubts) G.marks.push(cm.markText(at(p, d.at), at(p, d.end), { className: "lx-m-doubt", attributes: { title: d.msg } }));
        // Une phrase en français libre, traduite : pointillés et « ≈ » au bout ; la bulle dit en quoi et pourquoi
        if (r.translated) {
            const t = r.translated;
            const why = `Traduite : « ${t.text} »\nd'après la tournure ${t.rule}, ressemblance ${Math.round(t.score * 100)} %\n(/traduction pour voir les traductions, /corriger pour écrire la forme traduite)`;
            G.marks.push(cm.markText(Pos(p.n, p.from + 1), Pos(p.n, p.to - 1), { className: "lx-m-trans", attributes: { title: why } }));
            const sign = document.createElement("span");
            sign.className = "lx-m-sign";
            sign.textContent = "≈";
            sign.title = why;
            sign.addEventListener("mousedown", (e) => { e.preventDefault(); toggleTranslations(); });
            G.marks.push(cm.setBookmark(Pos(p.n, p.to), { widget: sign, insertLeft: true }));
        }
        // Relue par le sens, ou comme le document l'a appris : « ◆ », et ce qu'elle a compris au survol
        if (r.understood && !r.translated) {
            const u = r.understood;
            const why = u.kind === "sens"
                ? `J'ai lu : « ${u.shown} »\ncar telle qu'écrite, ${u.by === "sortes" ? "elle n'a pas de sens" : "elle ne se calcule pas"} : ${u.why}`
                : `J'ai lu : « ${u.shown} »\ncomme ce document l'a appris (lecture : ${readingText(u.rule)})`;
            const sign = document.createElement("span");
            sign.className = "lx-m-sign lx-m-understood";
            sign.textContent = "◆";
            sign.title = why;
            G.marks.push(cm.setBookmark(Pos(p.n, p.to), { widget: sign, insertLeft: true }));
        }
        const err = r.error || res?.fault;
        // Pendant qu'on écrit la phrase, pas de soulignement : elle n'est pas finie
        if (err && !editing) {
            const a = err.at ?? 0, b = err.end > a ? err.end : p.text.length;
            G.marks.push(cm.markText(at(p, a), at(p, b), { className: "lx-m-bad", attributes: { title: err.msg } }));
        }
        // Elle s'exécute, mais n'a pas de sens d'après les sortes (« le loyer plus la surface » : des € et des m²)
        else if (r.sense?.length && !editing) for (const d of r.sense) {
            const a = d.at ?? 0, b = d.end > a ? d.end : p.text.length;
            G.marks.push(cm.markText(at(p, a), at(p, b), { className: "lx-m-sense", attributes: { title: `Sans rien exécuter : ${d.msg}\n(/modèle : ce que le document sait de ses données)` } }));
        }
    });
    // Les sorties, sous la ligne, comme celles d'un bloc
    const byLine = new Map();
    found.forEach((p, j) => {
        const k = off + j;
        // « \u0001 » : une ligne de traduction (/traduction), affichée à part
        const trad = S.showTrad && G.read[k].translated ? [`\u0001${G.read[k].translated.text}`] : S.showTrad && G.read[k].understood ? [`\u0002${G.read[k].understood.shown}`] : [];
        if (S.showTrad && G.read[k].ast) trad.push(`\u0003${paraphrase(G.read[k].ast)}`);
        // une action du terminal, dans une page : dite, pas faite (le texte se relit à chaque frappe)
        const said = (l) => { const m = /^⟦([^⟧]*)⟧([\s\S]*)$/.exec(l); return m ? `↳ au terminal : ${m[1]} ${m[2].split("⟦⟧").map((a) => (/chemin : «([^»]*)»/.exec(a)?.[1] ?? a)).join(" ")}`.trim() : l; };
        const lines = [...trad, ...(results[k]?.lines || []).map(said)];
        if (lines.length) byLine.set(p.h, [...(byLine.get(p.h) || []), ...lines]);
    });
    for (const [h, o] of G.outs) {
        const want = byLine.get(h)?.join("\n");
        if (want === o.text && cm.getLineNumber(h) != null) continue;
        o.widget.clear();
        G.outs.delete(h);
    }
    for (const [h, lines] of byLine) {
        if (G.outs.has(h)) continue;
        const el = document.createElement("div");
        el.className = "lx-m-res";
        for (const l of lines) {
            const row = document.createElement("div");
            if (l.startsWith("\u0001")) { row.className = "lx-m-trad"; row.textContent = `≈ ${l.slice(1)}`; }
            else if (l.startsWith("\u0002")) { row.className = "lx-m-trad"; row.textContent = `◆ lu : ${l.slice(1)}`; }
            else if (l.startsWith("\u0003")) { row.className = "lx-m-trad lx-m-said"; row.textContent = `≡ ${l.slice(1)}`; }
            else row.textContent = l;
            el.append(row);
        }
        G.outs.set(h, { text: lines.join("\n"), widget: cm.addLineWidget(h, el, { noHScroll: true }) });
    }
    deck?.refresh();
}

// ---------------- les mathématiques vérifiées (preuve/)
// Un encadré « > [!THÉORÈME] » (proposition, lemme, corollaire, propriété) est un énoncé en français : la machine le
// démontre, le réfute (contre-exemple) ou le laisse « à démontrer ». L'encadré « > [!PREUVE] » qui le suit est vérifié
// pas à pas : ✓ au bout d'un pas qui découle des précédents, souligné quand il est faux ou non justifié, et sous la
// ligne ce que la machine en a compris. Le verdict s'écrit sous l'énoncé. Rien n'est calculé pendant qu'on écrit :
// un instant après.

/** Les actions du document qui calculent un nombre (« compter les diviseurs de n ») : un énoncé peut les nommer. */
function mathActions() {
    const G = S.gl;
    if (!G.results?.typing) return new Map();
    if (G.actionsCode !== G.code) { G.actionsCode = G.code; try { G.actions = actionsFor(G.read, G.results.typing, G.readExt); } catch { G.actions = new Map(); } }
    return G.actions;
}

function drawMath() {
    const M = S.math;
    const actions = mathActions();
    const text = cm.getValue() + `\u0001${[...actions.keys()].join(",")}${[...actions.values()].map((a) => a.key).join(",")}`;
    if (!text.includes("[!")) { if (M.key) clearMath(); M.text = text; return; }
    if (text !== M.text) {
        M.text = text;
        clearTimeout(M.timer);
        M.timer = setTimeout(() => cm.operation(drawMath), M.results.length ? 500 : 0);
        return;
    }
    const lines = cm.getValue().split("\n");
    const skip = new Set();
    for (const b of S.blocks) for (let n = b.start; n <= b.end; n++) skip.add(n);
    let results;
    try { results = checkMath(lines, skip, { actions }); } catch (e) { diag.log("preuve", { error: String(e?.message || e) }); results = []; }
    const active = S.link?.ro ? -1 : cm.getCursor().line;
    const key = `${active}|${JSON.stringify(results.map((r) => [r.end, r.status, r.badge, r.marks]))}`;
    if (key === M.key) return;
    clearMath();
    M.key = key;
    M.results = results;
    const ICON = { proved: "✓", false: "✗", unknown: "?", incomplete: "?", error: "✗", skip: "·" };
    for (const r of results) {
        // « > [!THÉORÈME] Titre » : « Théorème — Titre » (le mode scientifique les numérote déjà)
        if (!S.sci.on) for (const [n, name] of [[r.head, r.name], [r.proof?.head, r.proof?.name]]) {
            if (n == null || n === active) continue;
            const l = cm.getLine(n), a = l.indexOf("[!"), b = l.indexOf("]", a);
            if (a < 0 || b < 0) continue;
            const el = document.createElement("span");
            el.className = "pf-kind";
            el.textContent = name;
            M.marks.push(cm.markText(Pos(n, a), Pos(n, b + 1), { replacedWith: el, handleMouseEvents: true }));
        }
        // le verdict, sous l'énoncé
        const box = document.createElement("div");
        box.className = `pf-res pf-${r.status}`;
        const head = document.createElement("div");
        head.className = "pf-head";
        head.textContent = `${ICON[r.status]} ${r.badge.charAt(0).toUpperCase()}${r.badge.slice(1)}`;
        box.append(head);
        if (r.detail) { const d = document.createElement("div"); d.className = "pf-detail"; d.textContent = r.detail; box.append(d); }
        M.widgets.push(cm.addLineWidget(r.end, box, { noHScroll: true }));
        // les pas : ✓, soulignés, et ce que la machine en dit, sous chaque ligne
        const notes = new Map();
        for (const m of r.marks) {
            const editing = m.from.line === active;
            if (m.status === "ok") { if (!editing) M.marks.push(cm.setBookmark(Pos(m.to.line, m.to.ch), { widget: tick(m.msg), insertLeft: true })); continue; }
            if (m.status !== "note" && !editing && (m.to.line > m.from.line || m.to.ch > m.from.ch))
                M.marks.push(cm.markText(Pos(m.from.line, m.from.ch), Pos(m.to.line, m.to.ch), { className: m.status === "false" ? "pf-bad" : "pf-unk", attributes: { title: m.msg } }));
            (notes.get(m.to.line) || notes.set(m.to.line, []).get(m.to.line)).push(m);
        }
        for (const [n, ms] of notes) {
            if (n === active && ms.every((m) => m.status !== "note")) continue;
            const el = document.createElement("div");
            el.className = "pf-notes";
            for (const m of ms) { const row = document.createElement("div"); row.className = `pf-${m.status}`; row.textContent = m.msg; el.append(row); }
            M.widgets.push(cm.addLineWidget(n, el, { noHScroll: true }));
        }
    }
}
function tick(msg) {
    const el = document.createElement("span");
    el.className = "pf-tick";
    el.textContent = "✓";
    el.title = msg;
    return el;
}
function clearMath() {
    const M = S.math;
    M.marks.forEach((m) => m.clear());
    M.widgets.forEach((w) => w.clear());
    M.marks = []; M.widgets = []; M.key = ""; M.results = [];
}

// ---------------- le modèle du document : ce que sont ses données (modele/, gramalectica/sens.js)

/** La sorte d'une donnée nommée dans une phrase (« les notes » → « notes : une liste d'entiers »), pour son survol. */
function sortTitle(said, typing) {
    if (!typing) return "";
    const w = said.toLowerCase().replace(/^(?:les?|la|l'|des|du|de la|de|d'|un|une)\s*/u, "").trim();
    const names = [...typing.globals.keys()];
    const n = knownName(w, names) ?? knownName(w, names, true);
    if (n) return `${n.replace(/_/g, " ")} : ${sortText(typing.globals.get(n.replace(/ /g, "_")))}`;
    // dans le corps d'une action : ses paramètres et ses données locales (« la quantité » de « compter les diviseurs »)
    for (const [fn, x] of typing.fns) {
        const l = knownName(w, [...x.locals.keys()]);
        if (l) return `${l} (dans « ${fn.replace(/_/g, " ")} ») : ${sortText(x.locals.get(l.replace(/ /g, "_")))}`;
    }
    for (const [c, x] of typing.classes) {
        const f = knownName(w, [...x.fields.keys()]);
        if (f) return `${f} (${x.table ? "colonne du tableau" : "champ de"} ${c.replace(/_/g, " ")}) : ${sortText(x.fields.get(f.replace(/ /g, "_")))}`;
    }
    return "";
}

/** Le modèle du document : les sortes des phrases, les tableaux, les blocs de code, les théorèmes, réunis. */
function documentModel() {
    const G = S.gl;
    if (!G.results?.typing) return null;
    const entries = depEntries();
    const blocks = entries.map((e, i) => (DEP_LANGS.has(e.lang) ? { lang: e.lang, where: depLabel(e), e: i, ...symbols(e.lang, e.code) } : null)).filter(Boolean);
    const phrases = [...S.prior.phrases.map(() => null), ...(G.found || []).map((p) => ({ line: p.n }))];
    const tables = new Map([...S.prior.tables, ...(/\|/.test(cm.getValue()) ? tablesIn(cm.getValue().split("\n")) : [])]);
    let theorems = [];
    try { theorems = checkMath(cm.getValue().split("\n"), new Set(S.blocks.flatMap((b) => Array.from({ length: b.end - b.start + 1 }, (_, i) => b.start + i))), { actions: mathActions() }); } catch { /* (sans théorèmes) */ }
    return buildModel({ typing: G.results.typing, phrases, tables, blocks, theorems });
}

/** Ce que cette page définit (une phrase avec sa ligne, un tableau, un bloc, une valeur reçue) : pas les autres pages. */
const definedHere = (c) => [...c.defs, ...c.sources].some((d) => d.line != null || d.kind === "bloc" || d.kind === "valeur");

/** Les concepts de la page pour le diagramme : classes et leurs champs, tableaux, données, actions, et ce qui les lit. */
function diagramConcepts() {
    let model = null;
    try { model = documentModel(); } catch { /* (sans modèle) */ }
    if (!model) return [];
    const KIND = { classe: "cls", tableau: "mdt", donnée: "dat", action: "act" };
    return model.list().filter((c) => KIND[c.kind] && definedHere(c)).map((c) => {
        const at = [...c.defs, ...c.sources].find((d) => d.line != null);
        const blocks = (xs) => [...new Set(xs.filter((d) => d.kind === "bloc" && d.e != null).map((d) => d.e))];
        const lines = (xs) => [...new Set(xs.filter((d) => d.kind === "phrase" && d.line != null).map((d) => d.line))];
        return {
            name: c.name, kind: KIND[c.kind], k: S.page, line: at?.line ?? null, parent: c.parent,
            sum: model.why(c.name).replace(/^« [^»]+ » : /, "").replace(/ — défini par.*$/, ""),
            fields: c.fields ? [...model.fields(c.name)].map(([f, s]) => ({ name: f, sum: sortText(s) })) : [],
            defBlocks: blocks(c.defs), useBlocks: blocks(c.uses), useLines: lines(c.uses),
        };
    });
}

/** /modèle : ce que le document sait de ses données, par genre ; un clic mène à la ligne qui les définit. */
function showModel() {
    drawPhrases();
    const model = documentModel();
    const here = definedHere;
    const known = model ? model.list() : [];
    const all = known.filter(here), elsewhere = known.filter((c) => !here(c) && (c.defs.length || c.sources.length)).length;
    if (!all.length) { toast("Rien encore : écrivez une phrase _…_, un tableau ou un bloc de code"); return; }
    const KINDS = [["classe", "Classes"], ["tableau", "Tableaux"], ["donnée", "Données"], ["action", "Actions"], ["théorème", "Théorèmes"]];
    const line = (c) => c.defs.find((d) => d.line != null)?.line ?? c.sources.find((d) => d.line != null)?.line;
    const rows = KINDS.map(([k, title]) => {
        const cs = all.filter((c) => c.kind === k).sort((a, b) => a.name.localeCompare(b.name, "fr"));
        if (!cs.length) return "";
        return `<h3>${title}</h3>` + cs.map((c) => {
            const n = line(c);
            return `<div class="md-row"${n != null ? ` data-line="${n}"` : ""}><b>${esc(c.name.replace(/_/g, " "))}</b><span>${esc(model.why(c.name).replace(/^« [^»]+ » : /, ""))}</span></div>`;
        }).join("");
    }).join("");
    let dlg = $("#modele");
    if (!dlg) {
        dlg = document.createElement("dialog");
        dlg.id = "modele";
        dlg.className = "shortcuts modele";
        dlg.setAttribute("aria-label", "Ce que le document sait de ses données");
        dlg.innerHTML = `<h2>Ce que le document sait</h2><p class="about-small">Déduit du document seul : les phrases, les tableaux (et leurs unités), les blocs de code, les théorèmes. Rien n'est exécuté pour le savoir ; « connue à l'exécution » : un bloc qui n'a pas encore tourné.</p><div class="md-list"></div><form method="dialog"><button>Fermer</button></form>`;
        dlg.addEventListener("click", (e) => {
            if (e.target === dlg) { dlg.close(); return; }
            const r = e.target.closest("[data-line]");
            if (r) { dlg.close(); const p = Pos(+r.dataset.line, 0); cm.setCursor(p); cm.scrollIntoView(p, 120); cm.focus(); }
        });
        document.body.append(dlg);
    }
    dlg.querySelector(".md-list").innerHTML = rows + (elsewhere ? `<p class="about-small">Et ${elsewhere} définition${elsewhere > 1 ? "s" : ""} des pages précédentes.</p>` : "");
    dlg.showModal();
}

// ---------------- lire large : demander, apprendre (gramalectica/learn.js)
// Une phrase qu'on vient de finir se lit de deux façons sensées, aux résultats différents : la machine ne choisit pas
// en silence, elle propose les deux lectures (les parenthèses montrent la différence) avec leur résultat. Le choix
// s'apprend : il s'écrit dans le lexique du document (un commentaire à la fin), et vaut pour toute phrase de même forme.
const NO_EXT = { values: new Map(), tables: new Map(), fields: [] };

function drawAsk(ask, lex) {
    const G = S.gl;
    const key = ask ? `${ask.k}|${ask.options.map((o) => o.shown).join("|")}` : "";
    if (G.askW?.key === key && (!ask || cm.getLineNumber(G.askW.widget.line) != null)) return;
    G.askW?.widget.clear();
    G.askW = null;
    if (!ask) return;
    const el = document.createElement("div");
    el.className = "lx-ask";
    el.append(Object.assign(document.createElement("div"), { className: "lx-ask-q", textContent: `Cette phrase se lit de ${ask.options.length} façons — laquelle voulez-vous dire ?` }));
    ask.options.forEach((o, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lx-ask-opt";
        b.innerHTML = `<span class="lx-ask-shown"></span><span class="lx-ask-res"></span>`;
        b.firstChild.textContent = i ? o.shown : `${o.shown} (telle qu'écrite)`;
        b.lastChild.textContent = o.lines.length ? `→ ${o.lines.join(" · ")}` : "";
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => learnReading(ask, o, lex));
        el.append(b);
    });
    G.askW = { key, widget: cm.addLineWidget(ask.p.h, el, { noHScroll: true }) };
}

function learnReading(ask, o, lex) {
    const r = S.gl.read[ask.k];
    const rule = readingRule(r.text, r.roles, o.edits);
    if (!rule) { toast("Cette lecture ne s'apprend pas (elle dépend d'un nom du document)"); return; }
    saveLexicon({ ...lex, readings: addReading(lex.readings, rule) });
    toast(`Appris : « ${readingText(rule)} » — les phrases de même forme se liront ainsi (lexique, à la fin du document)`);
}
/** Le lexique réécrit dans le document (à la fin), sans déplacer le curseur. */
function saveLexicon(lex) {
    const text = cm.getValue(), next = withLexicon(text, lex);
    if (next === text) return;
    const cur = cm.getCursor();
    const m = /<!--\s*lexique\b[\s\S]*?-->/i.exec(text);
    if (m) cm.replaceRange(next.slice(m.index, next.length - (text.length - m.index - m[0].length)), cm.posFromIndex(m.index), cm.posFromIndex(m.index + m[0].length), "+lexique");
    else cm.replaceRange(next.slice(text.replace(/\s*$/, "").length), cm.posFromIndex(text.replace(/\s*$/, "").length), cm.posFromIndex(text.length), "+lexique");
    cm.setCursor(cur);
}

/** /apprendre : la phrase de cette ligne veut dire… — une tournure, généralisée (ce qui est commun devient {X}). */
function teachLine(n) {
    const j = (S.gl.found || []).findIndex((p) => p.n === n);
    if (j < 0) { toast("/apprendre s'applique à une phrase _…_ : placez-vous sur sa ligne"); return; }
    const ph = S.gl.found[j];
    const r = S.gl.read[S.gl.off + j];
    const guess = r?.translated?.text || r?.proposal || "Affiche …";
    const meant = prompt(`« ${ph.text} » veut dire, en Grama Lectica :`, guess);
    if (!meant) return;
    const t = tournureFrom(ph.text, meant);
    if (!t) { toast("Rien de commun entre les deux phrases : la tournure ne se généralise pas (gardez les mêmes noms)"); return; }
    const lex = lexiconOf(cm.getValue());
    saveLexicon({ ...lex, tournures: addTournure(lex.tournures, t) });
    toast(`Appris : « ${t.motif} » → « ${t.forme} »`);
}

// ---------------- le mode scientifique (science.js)
// Un en-tête « mode: scientifique » met le document en article : police de LaTeX (Computer Modern), sections
// numérotées, bloc de titre, équations numérotées, renvois, citations et bibliographie, valeurs calculées dans le
// texte. Comme le reste du Markdown, chaque élément se dessine quand le curseur n'est pas dessus.

/** Les valeurs que le texte peut citer ({{nom}}) : la jonction des langages, et les données des phrases. */
function sciValues() {
    const out = new Map(kernel.junction.list().map((x) => [x.name, x.v]));
    const g = S.gl.results?.globals;
    if (g) for (const [k, x] of Object.entries(toShare(g))) out.set(k, x.v);
    // {{ f(10, 16) }} : les formules du document, calculées dans la page (avec les variables de la jonction)
    out.eval = (expr) => evalFormula(S.formulas, expr, Object.fromEntries([...out].filter(([, v]) => typeof v === "number")));
    for (const f of S.formulas) if (f.kind === "const" && f.value != null && !out.has(f.name)) out.set(f.name, f.value);
    return out;
}

function katexHtml(tex, display) {
    try { return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }); }
    catch { return esc(tex); }
}

function drawScience() {
    const lines = cm.getValue().split("\n");
    const fm = frontMatter(lines);
    const on = isScience(fm);
    // (le mode change : les images se redessinent avec, ou sans, leur numéro de figure)
    if (on !== S.sci.on) { S.sci.on = on; document.body.classList.toggle("science", on); S.media.forEach((v) => v.mark.clear()); S.media.clear(); setTimeout(decorate); }
    // Hors du mode scientifique, les formules se mettent en forme quand même (sans numéro) : $$ … $$ et $…$
    const plain = !on;
    const blocks = S.blocks.map((b) => ({ start: b.start, end: b.end, lang: b.lang, info: b.info, code: blockSource(b) }));
    const info = analyze(lines, blocks);
    S.sci.info = plain ? null : info;
    const values = sciValues();
    const sel = cm.listSelections();
    const editing = (a, b) => sel.some((x) => Math.max(x.anchor.line, x.head.line) >= a && Math.min(x.anchor.line, x.head.line) <= b);
    const inBlock = new Set();
    for (const b of S.blocks) for (let n = b.start; n <= b.end; n++) inBlock.add(n);
    const want = new Map();   // première ligne -> { key, make }
    const put = (n, key, make) => want.set(cm.getLineHandle(n), { key, make });
    const title = lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, "") || "";

    // L'en-tête devient le bloc de titre, comme en LaTeX : le titre (la ligne « # », qui s'efface tant qu'on n'y
    // est pas), les auteurs, la date, le résumé
    const titleAt = lines.findIndex((l, i) => i > (fm?.end ?? -1) && /^#\s/.test(l));
    if (!plain && fm && !editing(fm.start, fm.end)) {
        const showTitle = titleAt >= 0 && !editing(titleAt, titleAt);
        const html = titleBlock(fm, showTitle ? title : "", (x) => renderInline(x, info, values));
        if (showTitle) put(titleAt, `title|${lines[titleAt]}`, () => [cm.markText(Pos(titleAt, 0), Pos(titleAt, lines[titleAt].length), { replacedWith: Object.assign(document.createElement("span"), { className: "sci-titleline" }), handleMouseEvents: true })]);
        put(0, `fm|${html}`, () => {
            const box = document.createElement("div");
            box.className = "sci-fm";
            box.innerHTML = html + '<div class="sci-fm-hint">en-tête de l\'article — cliquer pour le modifier</div>';
            return [cm.markText(Pos(fm.start, 0), Pos(fm.end, lines[fm.end].length), { replacedWith: box, handleMouseEvents: true })];
        });
    }
    for (let n = fm ? fm.end + 1 : 0; n < lines.length; n++) {
        if (inBlock.has(n) || (n === titleAt && want.has(cm.getLineHandle(n)))) continue;
        const t = lines[n], active = editing(n, n);
        const h = info.headings.get(n);
        const eq = info.equations.get(n);
        if (eq) {
            if (!editing(eq.start, eq.end)) {
                const html = `<div class="sci-eq-tex">${katexHtml(eq.tex, true)}</div>${plain ? "" : `<div class="sci-eq-num">(${eq.num})</div>`}`;
                put(n, `eq|${plain}|${eq.end - eq.start}|${eq.num}|${eq.tex}`, () => {
                    const box = document.createElement("div");
                    box.className = "sci-eq";
                    box.innerHTML = html;
                    return [cm.markText(Pos(eq.start, 0), Pos(eq.end, lines[eq.end].length), { replacedWith: box, handleMouseEvents: true })];
                });
            }
            n = eq.end;
            continue;
        }
        if (active) continue;
        const parts = [];
        if (plain) {
            for (const m of t.matchAll(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g)) {
                const from = m.index + m[1].length;
                parts.push({ from, to: from + m[2].length + 2, kind: "math", text: m[2] });
            }
        } else if (h) {
            const at = /^#+\s*/.exec(t)[0].length;
            parts.push({ from: at, to: at, kind: "num", text: `${h.num}\u2002` });
            const lm = /\s*\{#[\w:.-]+\}\s*$/.exec(t);
            if (lm) parts.push({ from: lm.index, to: t.length, kind: "hide", text: "" });
        }
        const th = plain ? null : info.theorems.get(n);
        if (th) {
            const m = /\[![^\]]+\]\s*(.*)$/.exec(t);
            const at = t.indexOf("[!");
            parts.push({ from: at, to: t.length, kind: "thm", text: `${th.name}${th.num ? " " + th.num : ""}${th.title ? ` (${th.title})` : ""}.`, html: true });
            void m;
        }
        const tb = plain ? null : info.tables.get(n);
        if (tb?.line) parts.push({ from: 0, to: t.length, kind: "cap", text: `Tableau ${tb.num} – ${tb.cap}` });
        if (!plain && !tb?.line && !th) {
            for (const p of inlineParts(t, info, values)) parts.push(p);
            // les formules en ligne $…$ (pas un prix « 5 $ » : pas d'espace contre les $)
            for (const m of t.matchAll(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g)) {
                const from = m.index + m[1].length;
                if (parts.some((x) => from < x.to && from + m[2].length + 2 > x.from)) continue;
                parts.push({ from, to: from + m[2].length + 2, kind: "math", text: m[2] });
            }
        }
        if (!parts.length) continue;
        parts.sort((a, b) => a.from - b.from);
        put(n, `line|${t}|${parts.map((p) => p.kind + p.text + (p.bad ? "!" : "")).join("|")}`, () => parts.map((p) => {
            const el = document.createElement("span");
            el.className = `sci-${p.kind}${p.bad ? " bad" : ""}`;
            if (p.kind === "math") el.innerHTML = katexHtml(p.text, false);
            else el.textContent = p.text;
            if (p.title) el.title = p.title;
            if (p.from === p.to) return cm.setBookmark(Pos(n, p.from), { widget: el, insertLeft: true });
            return cm.markText(Pos(n, p.from), Pos(n, p.to), { replacedWith: el, handleMouseEvents: true });
        }));
    }
    // Le bloc ```bib devient la liste des références (citées d'abord, dans l'ordre des citations)
    for (const b of plain ? [] : S.blocks) {
        if (!/^(bib|bibtex)$/i.test(b.info || "") || !b.close || editing(b.start, b.end)) continue;
        const html = references(info) || '<section class="sci-refs"><h2>Références</h2><p>Aucune entrée BibTeX lisible.</p></section>';
        put(b.start, `bib|${b.end - b.start}|${html}`, () => {
            const box = document.createElement("div");
            box.className = "sci-bib";
            box.innerHTML = html;
            return [cm.markText(Pos(b.start, 0), Pos(b.end, cm.getLine(b.end).length), { replacedWith: box, handleMouseEvents: true })];
        });
    }
    for (const [h, v] of S.sci.marks) {
        const w = want.get(h);
        if (w && w.key === v.key && v.marks.every((m) => m.find())) { want.delete(h); continue; }
        v.marks.forEach((m) => m.clear());
        S.sci.marks.delete(h);
    }
    for (const [h, w] of want) S.sci.marks.set(h, { key: w.key, marks: w.make() });
    if (plain) return;
    // Les légendes des figures produites par le code, sous leur sortie
    for (const b of S.blocks) {
        const st = S.outs.get(b.open);
        if (!st?.node) continue;
        const f = info.figures.get(b.start) || info.tables.get(b.start);
        let cap = st.node.querySelector(":scope > .sci-figcap");
        const text = f && f.num ? `${info.figures.has(b.start) ? "Figure" : "Tableau"} ${f.num}${f.cap ? " – " + f.cap : ""}` : "";
        if (!text || !st.outputs.length) { cap?.remove(); continue; }
        if (!cap) { cap = document.createElement("div"); cap.className = "sci-figcap"; st.node.append(cap); }
        if (cap.textContent !== text) { cap.textContent = text; widgetChanged(st); }
    }
}

/** Un morceau de texte de l'en-tête (Markdown en ligne, renvois, valeurs, formules) en HTML. */
function renderInline(text, info, values) {
    const html = resolveLine(text, info, values).replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_, a, tex) => a + katexHtml(tex, false));
    return renderMarkdown(html).replace(/^<p>|<\/p>\s*$/g, "");
}

// ---------------- le vrai programme : C++ compilé dans la machine
// Une pause dans l'écriture, et le document devient un programme C++17 (gramalectica/cpp.js) qui n'inclut que
// gl.hpp et se lie au moteur gl_runtime.o, compilé une seule fois dans la machine. Le programme est compilé par
// g++ et exécuté ; ses sorties remplacent l'aperçu de l'interpréteur.

const GL_DIR = new URL("./gramalectica/", import.meta.url);
let glApi = null, glObject = null;

/**
 * Le moteur dans la machine. Il est livré déjà compilé pour elle (gl_runtime.i386.o, construit dans la machine
 * par tools/build_gl_engine.cjs) : la page le dépose en un instant. Si le source du moteur a changé depuis
 * (empreinte gl_runtime.i386.o.sha1), la machine le recompile — plusieurs minutes, une fois par session.
 */
async function glEngine() {
    glApi ??= await (await fetch(new URL("gl.hpp", GL_DIR))).text();
    if (glObject) return glObject;
    // gl.hpp n'existe pas dans la machine : l'interface entre dans le source du moteur
    const src = (await (await fetch(new URL("gl_runtime.cpp", GL_DIR))).text()).replace('#include "gl.hpp"', glApi);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(src)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const shipped = await fetch(new URL("gl_runtime.i386.o.sha1", GL_DIR)).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    if (shipped.trim() === hash) {
        const path = `/tmp/lumen/gl_runtime-${hash.slice(0, 12)}.o`;
        // (l'état enregistré de la machine l'a déjà, tools/build_snapshot.js : rien à envoyer sur le port série)
        if ((await kernel.sh(`test -s ${path}`).catch(() => "")) !== "SH 0") {
            const bytes = new Uint8Array(await (await fetch(new URL("gl_runtime.i386.o", GL_DIR))).arrayBuffer());
            await kernel.writeFile(path, bytes);
        }
        glObject = path;
        return glObject;
    }
    let out = "", err = null;
    glStatus("wait", "Le moteur C++ a changé : compilation dans la machine (plusieurs minutes, une fois)…");
    await kernel.execute("python", `print(_lx_gl_runtime(${JSON.stringify(src)}))`, (m) => {
        if (m.t === "stream" && m.name === "stdout") out += m.text;
        else if (m.t === "error") err = `${m.ename} : ${m.evalue}`;
    }, { background: true, label: "moteur C++ des phrases" });
    if (err || !out.trim()) throw new Error(err || "le moteur n'a pas été compilé");
    glObject = out.trim();
    return glObject;
}

function glStatus(state, title = "") {
    const el = $("#st-gl");
    el.hidden = !state;
    el.dataset.state = state || "";
    el.textContent = { wait: "C++ …", ok: "C++ ✓", err: "C++ ✗" }[state] || "";
    el.title = title;
}

function scheduleCpp() {
    const G = S.gl;
    clearTimeout(G.cppTimer);
    if (!G.read.some((r) => r.ast)) { glStatus(null); return; }
    // Un document reçu par lien ne démarre pas la machine pour le second moteur : l'aperçu de la page suffit
    if (S.link && kernel.state !== "ready") { glStatus(null); return; }
    // Pendant un diaporama, la machine est aux blocs qu'on montre : les phrases gardent l'aperçu de la page (même moteur)
    if (deck) { glStatus(null); return; }
    glStatus("wait", "Le programme C++ sera compilé à la prochaine pause");
    G.cppTimer = setTimeout(runCpp, 4000);
}

async function runCpp() {
    const G = S.gl;
    // des blocs s'exécutent (une suite de dépendances…) : le programme attend une vraie pause
    const busy = kernel.running && !kernel.running.background;
    if (busy || kernel.jobs.some((j) => !j.background)) { G.cppTimer = setTimeout(runCpp, 4000); return; }
    // … et que l'on ait cessé d'exécuter des blocs depuis un moment : sinon il serait toujours devant le suivant
    // (sur une machine lente — un iPad —, il ne finirait jamais). Plus longtemps à chaque fois qu'il a dû céder.
    const slow = cmdForAlt || (G.cppMs ?? 0) > 30000;
    const quiet = Math.min(180000, (slow ? 45000 : 12000) * 2 ** (G.preempts || 0));
    const since = Date.now() - (kernel.lastForeground || 0);
    if (since < quiet) { G.cppTimer = setTimeout(runCpp, quiet - since); return; }
    const code = G.code, read = G.read, external = G.readExt;
    try {
        await kernel.start();
        const obj = await glEngine();
        if (G.code !== code) return;
        glStatus("wait", "Compilation et exécution du programme C++ dans la machine…");
        let out = "", err = null;
        const t0 = performance.now();
        // -O0 explicite : le noyau n'ajoute pas l'en-tête précompilé de la bibliothèque standard (le programme n'inclut que gl.hpp)
        const res = await kernel.execute("cpp", `// flags: -O0 ${obj}\n${toCpp(read, { header: glApi, external })}`, (m) => {
            if (m.t === "stream" && m.name === "stdout") out += m.text;
            else if (m.t === "error") err = `${m.ename} : ${m.evalue}`;
        }, { background: true, label: "programme C++ des phrases" });
        if (G.code !== code) return;   // le document a changé entre-temps : une autre compilation suivra
        // interrompue pour laisser passer un bloc qu'on a lancé : elle reprendra à la prochaine pause
        if (res?.preempted) { G.preempts = Math.min(4, (G.preempts || 0) + 1); scheduleCpp(); return; }
        if (err || !res?.ok) { glStatus("err", err || "le programme C++ n'a pas abouti"); return; }
        G.cpp = { code, results: readOutput(out, read.length) };
        G.preempts = 0;
        G.cppMs = performance.now() - t0;
        glStatus("ok", `Résultats du programme C++ compilé (${fmtMs(performance.now() - t0)})`);
        G.key = "";
        decorate();
    } catch (e) {
        glObject = null;
        if (G.code === code) glStatus("err", String(e.message || e));
    }
}

/** Les données des phrases rejoignent la jonction des langages (un instant après la dernière frappe) : tout bloc de
 *  code les lit à sa prochaine exécution, sous leur nom (« le prix de vente » : prix_de_vente). */
function scheduleSync(globals) {
    const G = S.gl;
    clearTimeout(G.syncTimer);
    G.syncTimer = setTimeout(() => {
        // les données des phrases qui changent (un curseur qu'on fait glisser…) : le document réactif recalcule ce qui les lit
        const mine = () => new Map([...kernel.junction.vars].filter(([, x]) => x.lang === "gl").map(([k, x]) => [k, JSON.stringify([x.v, x.k])]));
        const before = mine();
        kernel.junction.take("gl", toShare(globals));
        const after = mine();
        reactive.changed([...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => k));
    }, 400);
}

// Les variables des langages, que les phrases du texte « boivent » : celles de la jonction (la dernière écriture
// l'emporte, quel que soit le langage), puis les objets que seuls Python et Java décrivent (une fiche par classe).
const GL_ORDER = ["python", "javascript", "java", "tcl", "scheme", "sh"];
kernel.junction.addEventListener("change", (e) => { if (e.detail.lang !== "gl") glExternal(); });
kernel.addEventListener("gl-data", (e) => {
    const d = e.detail;
    S.gl.sources.python = d.values;
    S.gl.sources.sql = d.tables;
    Object.assign(S.gl.sources, d.langs || {});
    glExternal();
});
kernel.addEventListener("gl-lang", (e) => { S.gl.sources[e.detail.lang] = e.detail.values; glExternal(); });

function glExternal() {
    const G = S.gl, values = kernel.junction.values("gl");
    const own = new Set([...kernel.junction.vars].filter(([, x]) => x.lang === "gl").map(([k]) => k));
    for (const lang of GL_ORDER) for (const [k, v] of Object.entries(G.sources[lang] || {})) if (!(k in values) && !own.has(k)) values[k] = v;
    const ext = externalData(values, G.sources.sql || {});
    const key = JSON.stringify([[...ext.values], [...ext.tables]]);
    if (key === G.extKey) return;
    G.ext = ext;
    G.extKey = key;
    G.key = "";
    decorate();
}

/** Une image collée ou déposée : réduite si elle est grande (le document vit dans le navigateur), un SVG reste du SVG. */
async function imageMarkdown(file) {
    const name = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "image";
    if (file.type === "image/svg+xml") return (await file.text()).trim();
    const read = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
    if (file.type === "image/gif" || file.size < 200 * 1024) return `![${name}](${await read(file)})`;
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    let url = c.toDataURL("image/webp", 0.85);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", 0.85);
    return `![${name}](${url})`;
}

async function insertImages(files, at = cm.getCursor()) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return false;
    const md = (await Promise.all(list.map(imageMarkdown))).join("\n\n");
    S.blocks = scan();
    let n = at.line;
    const b = blockAt(n) || S.blocks.find((x) => n === x.start || n === x.end);
    if (b) n = b.end;   // jamais dans un bloc de code : juste après
    const line = cm.getLine(n);
    let first;
    if (!line.trim() && !b) { cm.replaceRange(md, Pos(n, 0), Pos(n, line.length)); first = n; }
    else { cm.replaceRange("\n" + md, Pos(n, line.length)); first = n + 1; }
    const last = first + md.split("\n").length - 1;
    if (last === cm.lastLine()) cm.replaceRange("\n", Pos(last, cm.getLine(last).length));
    cm.setCursor(Pos(last + 1, 0));
    cm.focus();
    return true;
}

/** Les lignes ``` d'un bloc ne s'affichent jamais : le bloc se lit comme du code, son langage est dans la barre d'état. */
function drawFences() {
    const seen = new Set();
    for (const b of S.blocks) {
        if (!b.close) continue;
        seen.add(b.open);
        const key = `${b.open.text}|${b.close.text}`;
        const lab = S.labels.get(b.open);
        if (lab?.key === key && lab.marks.every((m) => m.find())) continue;
        lab?.marks.forEach((m) => m.clear());
        const hide = (n, len) => cm.markText(Pos(n, 0), Pos(n, len), { replacedWith: document.createElement("span"), atomic: true });
        S.labels.set(b.open, { key, marks: [hide(b.start, b.open.text.length), hide(b.end, b.close.text.length)] });
    }
    for (const [h, lab] of S.labels) if (!seen.has(h)) { lab.marks.forEach((m) => m.clear()); S.labels.delete(h); }
}

/** Le curseur ne s'arrête pas sur une ligne ``` cachée : il entre dans le bloc ou en sort. */
let prevLine = 0;
function skipFences() {
    S.blocks = scan();
    const cur = cm.getCursor();
    const b = !cm.somethingSelected() && S.blocks.find((x) => x.close && (cur.line === x.start || cur.line === x.end));
    if (b) {
        if (b.end - b.start < 2) { cm.replaceRange("\n", Pos(b.start, b.open.text.length)); S.blocks = scan(); }
        const blk = blockOf(b.open) || b;
        // À la souris, on entre toujours dans le bloc qu'on vise ; au clavier, on le traverse dans le sens du déplacement
        const down = clicked ? cur.line === blk.start : cur.line >= prevLine;
        let target = clicked ? (cur.line === blk.start ? blk.start + 1 : blk.end - 1)
            : cur.line === blk.start ? (down ? blk.start + 1 : blk.start - 1) : (down ? blk.end + 1 : blk.end - 1);
        if (target < 0) target = blk.start + 1;
        if (target > cm.lastLine()) cm.replaceRange("\n", Pos(cm.lastLine(), cm.getLine(cm.lastLine()).length));
        const inside = target > blk.start && target < blk.end;
        cm.setCursor(Pos(target, inside && !down ? cm.getLine(target).length : inside ? 0 : down ? 0 : cm.getLine(target).length));
    }
    prevLine = cm.getCursor().line;
    clicked = false;
}
let clicked = false;
cm.on("mousedown", () => { clicked = true; });
cm.on("paste", (ed, e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
        e.preventDefault();
        insertImages(files).catch(() => toast("Cette image n'a pas pu être collée"));
        return;
    }
    pasteCode(e);
});

/**
 * Du code collé dans le texte devient un bloc du bon langage, comme une image devient une image.
 * Le texte se colle d'abord tel quel, puis le bloc l'entoure : Ctrl+Z retire le bloc et garde le texte.
 * Dans un bloc sans langage, le collage lui donne le sien.
 */
function pasteCode(e) {
    const data = e.clipboardData;
    const text = data?.getData("text/plain")?.replace(/\r\n?/g, "\n");
    if (!text || cm.somethingSelected() && cm.listSelections().length > 1) return;
    S.blocks = scan();
    const cur = cm.getCursor("from");
    const inBlock = blockAt(cur.line);
    // « >>> » en tête de chaque ligne : une console Python ; « $ » : un terminal
    const bare = stripPrompts(text);
    const prompt = bare !== text ? (/^>>>/m.test(text) ? { name: "python", code: true } : { name: "sh", code: true }) : null;
    const found = detectPaste(bare, prompt || clipboardLang(data), { known: (n) => !!fenceLang(n) });
    if (!found) return;
    const lang = found.lang ? fenceLang(found.lang) : null;
    if (inBlock) {
        if (inBlock.info || !lang || !inBlock.close) return;
        // Bloc ``` encore sans langage : le collage le lui donne
        cm.replaceRange("```" + lang, Pos(inBlock.start, 0), Pos(inBlock.start, cm.getLine(inBlock.start).length));
        toast(`Bloc ${LANGS[lang].label}`);
        return;
    }
    e.preventDefault();
    const code = dedent(stripPrompts(text));
    const line = cm.getLine(cur.line);
    const before = cm.somethingSelected() ? line.slice(0, cur.ch) : line.slice(0, cur.ch);
    const end = cm.getCursor("to");
    const after = cm.getLine(end.line).slice(end.ch);
    // 1. le texte, tel quel
    cm.replaceSelection(code, "end", "paste");
    cm.changeGeneration(true);
    // 2. le bloc autour, sur ses propres lignes
    const from = Pos(cur.line, cur.ch), to = cm.getCursor();
    const info = lang || (found.info ? fold(found.info) : "");
    const head = (before.trim() ? "\n" : "") + "```" + info + "\n";
    const tail = "\n```" + (after.trim() ? "\n" : "");
    cm.operation(() => {
        cm.replaceRange(tail, to, to, "+fence");
        cm.replaceRange(head, from, from, "+fence");
    });
    S.blocks = scan();
    const blk = S.blocks.find((b) => b.start === from.line + (before.trim() ? 1 : 0));
    // Le curseur sort du bloc : on continue d'écrire en dessous, comme après une image
    if (blk?.close) {
        if (blk.end === cm.lastLine()) cm.replaceRange("\n", Pos(blk.end, cm.getLine(blk.end).length), null, "+fence");
        cm.setCursor(Pos(blk.end + 1, 0));
    }
    decorate();
    if (lang) warmLanguages();
    toast(`Collé comme bloc ${lang ? LANGS[lang].label : "de code"} · Ctrl+Z pour du texte`);
}
cm.on("drop", (ed, e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    document.body.classList.remove("dropping");
    insertImages(files, ed.coordsChar({ left: e.clientX, top: e.clientY }, "window")).catch(() => toast("Cette image n'a pas pu être insérée"));
});
cm.on("beforeChange", (ed, ch) => {
    if (ch.origin !== "paste") return;
    const b = blockAt(ch.from.line);
    if (!b || !b.lang || LANGS[b.lang]?.engine === "page") return;
    const t = ch.text.join("\n"), u = unbreak(t);
    if (u !== t) ch.update(null, null, u.split("\n"));
});

/** Effacer au bord d'un bloc ne fusionne pas le code avec ses lignes ``` ; un bloc vide s'efface en entier. */
function guardEdge(dir) {
    if (cm.somethingSelected()) return CodeMirror.Pass;
    const cur = cm.getCursor();
    const b = blockAt(cur.line);
    if (!b?.close) return CodeMirror.Pass;
    const atStart = dir < 0 && cur.line === b.start + 1 && cur.ch === 0;
    const atEnd = dir > 0 && cur.line === b.end - 1 && cur.ch === cm.getLine(cur.line).length;
    if (!atStart && !atEnd) return CodeMirror.Pass;
    if (!blockSource(b).trim()) {
        const from = b.start > 0 ? Pos(b.start - 1, cm.getLine(b.start - 1).length) : Pos(0, 0);
        cm.replaceRange("", from, b.start > 0 ? Pos(b.end, cm.getLine(b.end).length) : Pos(Math.min(b.end + 1, cm.lastLine()), 0));
    }
    return undefined;
}

function updateTitle() {
    renderPages();
    const line = (S.page ? cellsText(S.pages[0].cells || []) : cm.getValue()).split("\n").find((l) => /^#\s/.test(l));
    const title = line ? line.replace(/^#\s+/, "").replace(/[*_`]/g, "").trim() : "Sans titre";
    if (title !== S.title || !document.title.endsWith("TextEdit")) {
        S.title = title;
        document.title = `${title} · TextEdit`;
    }
}

// ---------------------------------------------------------------- repliage (marge)

// Dans le code, comme dans un IDE : seules les constructions se replient (fonctions, classes, boucles, conditions…),
// jusqu'au retour à leur niveau d'indentation. Une ligne ordinaire n'a pas de flèche.
const FOLD_START = {
    python: /^\s*(async\s+def|def|class|for|while|if|elif|else|try|except|finally|with)\b.*:\s*(#.*)?$/,
    sh: /^\s*(for|while|until|if|case|select)\b|^\s*(function\s+)?[\w-]+\s*\(\)\s*\{?\s*$/,
    scheme: /^\s*\((define|let\*?|letrec|lambda|cond|case|do|when|unless)\b/,
    sql: null, cobol: null, html: null, latex: null, mermaid: null, csv: null,
};
const BRACE_START = /\{\s*(\/\/.*|\/\*.*\*\/\s*)?$/;   // JavaScript, Java, C, C++, AWK, Tcl : une ligne qui ouvre une accolade
const indentOf = (t) => /^\s*/.exec(t)[0].replace(/\t/g, "    ").length;

function codeFoldRange(n, b) {
    const text = cm.getLine(n);
    const re = b.lang in FOLD_START ? FOLD_START[b.lang] : BRACE_START;
    if (!re || !re.test(text)) return null;
    const base = indentOf(text);
    const last = b.close ? b.end - 1 : b.end;
    let end = n;
    for (let i = n + 1; i <= last; i++) {
        const t = cm.getLine(i);
        if (!t.trim()) continue;
        if (indentOf(t) <= base) break;
        end = i;
    }
    return end > n ? { from: Pos(n, text.length), to: Pos(end, cm.getLine(end).length), kind: "code" } : null;
}

function foldRange(h) {
    const n = cm.getLineNumber(h);
    if (n == null) return null;
    const b = blockAt(n);
    if (b) return b.lang ? codeFoldRange(n, b) : null;
    const hm = HEADING.exec(h.text);
    if (!hm) return null;
    const level = hm[1].length;
    let end = cm.lastLine();
    for (let i = n + 1; i <= cm.lastLine(); i++) {
        const m = HEADING.exec(cm.getLine(i));
        if (m && m[1].length <= level && !S.blocks.some((x) => i > x.start && i <= x.end)) { end = i - 1; break; }
    }
    while (end > n && !cm.getLine(end).trim()) end--;
    return end > n ? { from: Pos(n, h.text.length), to: Pos(end, cm.getLine(end).length), kind: "section" } : null;
}

function toggleFold(h) {
    const m = S.folds.get(h);
    if (m) { m.clear(); S.folds.delete(h); decorate(); return; }
    const r = foldRange(h);
    if (!r) return;
    const lines = r.to.line - r.from.line;
    const node = document.createElement("span");
    node.className = "lx-folded";
    node.textContent = `… ${lines} ligne${lines > 1 ? "s" : ""}`;
    const mark = cm.markText(r.from, r.to, { replacedWith: node, clearOnEnter: false });
    mark.lxKind = r.kind;
    node.addEventListener("mousedown", (e) => { e.preventDefault(); toggleFold(h); });
    S.folds.set(h, mark);
    decorate();
}

function drawFoldGutter(inCode) {
    for (const [h, m] of S.folds) if (!m.find() || cm.getLineNumber(h) == null) { m.clear(); S.folds.delete(h); }
    // Les flèches voulues (ligne -> ouverte ou repliée), comparées à celles déjà posées : on ne touche qu'aux différences
    const want = new Map();
    let n = 0;
    cm.eachLine((h) => {
        if (!inCode.has(n) && HEADING.test(h.text) && (S.folds.has(h) || foldRange(h))) want.set(h, S.folds.has(h));
        n++;
    });
    for (const b of S.blocks) {
        if (!b.lang) continue;
        for (let i = b.start + 1; i <= (b.close ? b.end - 1 : b.end); i++) {
            const h = cm.getLineHandle(i);
            if (S.folds.has(h) || codeFoldRange(i, b)) want.set(h, S.folds.has(h));
        }
    }
    for (const [h, folded] of S.gutter) if (want.get(h) !== folded && cm.getLineNumber(h) != null) cm.setGutterMarker(h, "lx-fold", null);
    for (const [h, folded] of want) {
        if (S.gutter.get(h) === folded) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = `lx-fold-btn${folded ? " folded" : ""}`;
        el.title = folded ? "Déplier" : "Replier";
        el.innerHTML = '<svg viewBox="0 0 12 12"><path d="M4.5 3l3 3-3 3"/></svg>';
        el.addEventListener("mousedown", (e) => { e.preventDefault(); toggleFold(h); });
        cm.setGutterMarker(h, "lx-fold", el);
    }
    S.gutter = want;
}

/** Replie, dans chaque bloc, les constructions de premier niveau (celles qui ne sont pas déjà dans un repli). */
function foldAllCode() {
    for (const b of S.blocks) {
        if (!b.lang) continue;
        for (let n = b.start + 1; n <= (b.close ? b.end - 1 : b.end); n++) {
            const h = cm.getLineHandle(n);
            const r = S.folds.has(h) ? S.folds.get(h).find() : codeFoldRange(n, b);
            if (!r) continue;
            if (!S.folds.has(h)) toggleFold(h);
            n = r.to.line;
        }
    }
}

// ---------------------------------------------------------------- résultats entre les lignes

function stateOf(open) {
    let st = S.outs.get(open);
    if (!st) {
        st = { open, outputs: [], node: null, widget: null, status: null, running: false };
        S.outs.set(open, st);
    }
    return st;
}

function ensureNode(st) {
    if (st.node) return st.node;
    st.node = document.createElement("div");
    st.node.className = "lx-out";
    st.node.innerHTML = '<div class="lx-out-status"></div><div class="outputs" aria-live="polite"></div>';
    return st.node;
}

/** Chaque résultat suit son bloc : rattaché à sa dernière ligne, masqué si sa section est repliée. */
function syncOutputs() {
    const sections = [...S.folds.values()].filter((m) => m.lxKind === "section").map((m) => m.find()).filter(Boolean);
    for (const [open, st] of S.outs) {
        const b = blockOf(open);
        if (!b) {
            st.widget?.clear();
            if (VM.owner === st) vmRelease();
            S.outs.delete(open);
            continue;
        }
        const has = st.outputs.length || st.running || st.status || st.node?.querySelector(".input-ask, .lx-win");
        const target = b.close || cm.getLineHandle(b.end);
        if (!has) { st.widget?.clear(); st.widget = null; continue; }
        if (st.widget && st.widget.line !== target) { st.widget.clear(); st.widget = null; }
        if (!st.widget) st.widget = cm.addLineWidget(target, ensureNode(st), { noHScroll: true });
        const line = cm.getLineNumber(target);
        const hidden = sections.some((r) => line > r.from.line && line <= r.to.line);
        if (st.node.hidden !== hidden) { st.node.hidden = hidden; widgetChanged(st); }
    }
}

function setStatus(st, text, kind = "") {
    st.status = text ? { text, kind } : null;
    const el = $(".lx-out-status", ensureNode(st));
    el.className = `lx-out-status ${kind}`;
    el.textContent = text || "";
    syncOutputs();
    widgetChanged(st);
    deck?.refresh();
}

function renderOutputs(st) {
    const box = $(".outputs", ensureNode(st));
    // La fenêtre en direct ne bouge pas : la déplacer ferait perdre le clavier à la machine
    const keep = VM.owner === st && VM.mode === "inline" ? box.querySelector(":scope > .lx-win.live") : null;
    for (const c of [...box.children]) if (c !== keep) c.remove();
    const els = st.outputs.map((o) => (o.metadata?.lumen?.window ? keep || windowFrame(st, o) : renderOutput(o, { dark: S.dark, live: liveHtml.has(o), offline: received(), runHtml: () => runHtmlOutput(st, o) })));
    if (VM.owner === st && !st.outputs.some((o) => o.metadata?.lumen?.window)) els.push(keep || windowFrame(st, null));
    let after = false;
    for (const el of els) {
        if (el === keep) { after = true; continue; }
        if (keep && !after) box.insertBefore(el, keep); else box.append(el);
    }
    syncOutputs();
    widgetChanged(st);
    deck?.refresh();
}
/** La sortie d'un bloc a changé de taille (sa ligne a pu disparaître : le document remplacé pendant qu'elle arrive). */
function widgetChanged(st) { if (st.widget?.line && cm.getLineNumber(st.widget.line) != null) st.widget.changed(); }

function addOutput(st, out) {
    const last = st.outputs[st.outputs.length - 1];
    if (out.output_type === "stream" && last?.output_type === "stream" && last.name === out.name) {
        last.text = outputText(last.text) + out.text;
        const pre = $(".outputs", ensureNode(st)).lastElementChild;
        if (pre?.matches?.(".out-stream")) {
            pre.textContent = last.text;
            // (la ligne du bloc a pu disparaître : le document remplacé pendant que la sortie arrive)
            widgetChanged(st);
            deck?.refresh();
            return;
        }
        renderOutputs(st);
        return;
    }
    if (out.display_id) {
        const i = st.outputs.findIndex((o) => o.display_id === out.display_id);
        if (i >= 0) { st.outputs[i] = out; renderOutputs(st); return; }
    }
    st.outputs.push(out);
    renderOutputs(st);
}

// ---------------------------------------------------------------- exécution

/**
 * live : une demande de la personne (▶, Maj Entrée) ; le HTML s'exécute alors, après l'avertissement s'il contient du
 * code. Sinon (à l'ouverture, en quittant le bloc, Tout exécuter), le HTML s'affiche sans rien exécuter.
 */
async function runBlock(open, { live = false, deps = true, reactive: fromReactive = false } = {}) {
    let b = blockOf(open);
    if (!b) return true;
    if (!b.lang) { toast("Ce bloc n'a pas de langage exécutable : ```python, ```sql…"); return true; }
    const st = stateOf(open);
    if (st.running) return false;
    // D'abord les blocs dont il dépend (cette page et les précédentes), s'ils n'ont pas tourné ou ont changé
    if (deps && languageOf(b.lang).engine !== "page") {
        const page = S.page;
        if (!(await runDeps(open))) return false;
        // pendant l'attente, la page a pu changer (une autre page ouverte, le livre) : le bloc se relit
        if (S.page !== page) return false;
        b = blockOf(open);
        if (!b) return true;
    }
    if (languageOf(b.lang).engine !== "page") {
        const raw = blockSource(b), fixed = unbreak(unrun(raw));
        if (fixed !== raw) {
            const last = b.close ? b.end - 1 : b.end;
            cm.replaceRange(fixed, Pos(b.start + 1, 0), Pos(last, cm.getLine(last).length));
            S.blocks = scan();
            return runBlock(open);
        }
    }
    const src = blockSource(b);
    const { lang, code } = resolve(b.lang, src);
    const L = languageOf(lang);
    const gui = GUI.test(src);
    st.outputs = st.outputs.filter((o) => o.metadata?.lumen?.window && gui);
    renderOutputs(st);
    S.exec++;
    if (L.engine === "page") {
        const data = lang === "html" ? { "text/html": code } : lang === "latex" ? { "text/latex": code } :
            lang === "mermaid" ? { "text/markdown": "```mermaid\n" + code + "\n```" } :
            lang === "csv" ? { "application/vnd.lumen.chart+json": { csv: code } } : { "text/markdown": code };
        if (lang === "html" && live && htmlHasCode(code) && !(await confirmCode(code))) return true;
        st.outputs = [];
        const out = { output_type: "display_data", data, metadata: {} };
        if (lang === "html" && live) liveHtml.add(out);
        addOutput(st, out);
        setStatus(st, "");
        st.rendered = src;
        persist();
        return true;
    }
    let source = code;
    if (lang === "javascript") {
        try {
            source = transpile(code);
        } catch (e) {
            const line = e.loc ? ` · ligne ${e.loc.line}` : "";
            addOutput(st, { output_type: "error", ename: "SyntaxError", evalue: String(e.message).replace(/\s*\(\d+:\d+\)$/, "") + line, traceback: e.snippet ? e.snippet.split("\n") : [] });
            setStatus(st, "erreur de syntaxe", "err");
            return false;
        }
    }
    // Les formules du document que nomme le bloc lui sont données (formulas.js) : Python et JavaScript les reçoivent
    // juste avant (ils gardent leur état), C, C++ et Rust en tête du source ; les numéros de ligne sont recalés
    const fx = formulaCode(S.formulas, lang, code);
    if (fx?.error) {
        addOutput(st, { output_type: "error", ename: "Formule", evalue: fx.error, traceback: [] });
        setStatus(st, "erreur dans une formule", "err");
        return false;
    }
    let shift = 0, after = 0;
    if (fx?.lines) {
        const ls = source.split("\n");
        after = /^\s*(?:\/\/|\*>)\s*flags?\s*:/.test(ls[0]) ? 1 : 0;   // « // flags: » reste en tête
        ls.splice(after, 0, ...fx.lines);
        source = ls.join("\n");
        shift = fx.lines.length;
    }
    st.running = true;
    st.lang = lang;
    // « en attente » : dire derrière quoi (un autre bloc, le programme C++ des phrases…)
    const ahead = kernel.running;
    const behind = ahead ? (ahead.label || `bloc ${LANGS[ahead.lang]?.label || ahead.lang}`) : "";
    setStatus(st, kernel.state === "ready" || kernel.state === "busy" ? `en attente${behind ? ` : ${behind}` : ""}` : "démarrage de la machine…", "wait");
    let started = 0, ticker = 0, stage = "", liveTimer = 0;
    const me = `${pageName(S.page)} · bloc ${S.blocks.filter((x) => x.lang && x.start <= b.start).length}`;
    // tant qu'il attend, le bloc dit ce qui passe devant lui (cela change : un bloc, puis le programme des phrases…)
    const waiting = setInterval(() => {
        if (started || !st.running) return;
        const a = kernel.running;
        if (a && a.label !== me) setStatus(st, `en attente : ${a.label || `bloc ${LANGS[a.lang]?.label || a.lang}`}`, "wait");
    }, 1000);
    const onEvent = (m) => {
        if (m.t === "status") {
            clearInterval(waiting);
            started = performance.now();
            ticker = setInterval(() => setStatus(st, `${stage && !stage.startsWith("Compilé") && stage !== "Déjà compilé" ? `${stage} · ` : ""}${fmtMs(performance.now() - started)}`, "live"), 100);
            // Une fenêtre qui retient le bloc (mainloop) s'affiche en direct pour qu'on puisse s'en servir
            // (pendant un diaporama, elle flotte au-dessus de la diapositive)
            if (gui) liveTimer = setTimeout(() => { if (st.running) (deck ? vmFloat(st) : vmInline(st)); }, 1500);
            return;
        }
        if (m.t === "stage") { stage = m.text; return; }
        if (m.t === "window") { st.win = m.rect; if (VM.owner === st) fitVm(); return; }
        if (m.t === "stream") addOutput(st, { output_type: "stream", name: m.name, text: m.text });
        else if (m.t === "display") addOutput(st, { output_type: "display_data", data: m.data, metadata: {}, display_id: m.display_id || undefined });
        else if (m.t === "result") addOutput(st, { output_type: "execute_result", data: m.data, metadata: {}, execution_count: S.exec });
        else if (m.t === "error") {
            const unshift = (s) => (shift ? String(s).replace(/(ligne\s+|cellule\.\w+:)(\d+)/g, (a, p, k) => `${p}${+k > after + shift ? k - shift : Math.max(1, after)}`) : s);
            const fix = (s) => unshift(lang === "javascript" ? String(s).replace(/ligne (\d+)/g, (a, k) => `ligne ${Math.max(1, k - JS_LINE_OFFSET)}`) : s);
            addOutput(st, { output_type: "error", ename: m.ename, evalue: fix(m.evalue), traceback: (m.traceback || []).map(fix) });
        } else if (m.t === "clear") { st.outputs = []; renderOutputs(st); }
        else if (m.t === "input") askInput(st, m);
    };
    let res;
    try {
        const missing = fx?.prelude ? preludeMissing(lang, fx) : [];
        if (missing.length) {
            let bad = null;
            await kernel.execute(lang, missing.join("\n"), (m) => { if (m.t === "error") bad = m; }, { label: `${me} · formules`, ...(lang === "javascript" ? { prelude: JS_PRELUDE } : {}) });
            if (bad) addOutput(st, { output_type: "error", ename: "Formule", evalue: `${fx.names.join(", ")} : ${bad.ename} ${bad.evalue}`, traceback: [] });
            else preludeDone(lang, missing);
        }
        res = await kernel.execute(lang, source, onEvent, { label: me, ...(lang === "javascript" ? { prelude: JS_PRELUDE } : {}) });
    } catch (e) {
        res = { ok: false, ms: 0 };
        addOutput(st, { output_type: "error", ename: "Machine", evalue: String(e.message || e), traceback: [] });
    }
    clearInterval(ticker);
    clearInterval(waiting);
    clearTimeout(liveTimer);
    st.running = false;
    $(".input-ask", ensureNode(st))?.remove();
    const ms = res.ms ?? (started ? performance.now() - started : 0);
    const note = stage.startsWith("Compilé") ? ` · ${stage.replace("Compilé en ", "compilation ").replace(".", ",")}` : stage === "Déjà compilé" ? " · sans recompiler" : "";
    setStatus(st, res.ok ? `${fmtMs(ms)}${note}` : `erreur · ${fmtMs(ms)}`, res.ok ? "ok" : "err");
    // Fenêtre ouverte par le bloc : son image prend place dans le résultat
    if (res.win !== undefined) st.win = res.win;
    if (gui && res.ok) {
        // Fenêtre encore ouverte : on la prend telle quelle ; fermée avec la fin du bloc : sa dernière image
        if (VM.owner === st) vmFreeze(st, { last: !st.win });
        else setTimeout(() => windowImage(st), 900);
    }
    if (res.ok && DEP_LANGS.has(lang)) S.ranAt.set(blockHash(lang, code), ++S.runSeq);
    persist();
    if (S.sci.on) decorate();   // de nouvelles valeurs pour les {{…}} du texte
    // document réactif : ce que ce bloc vient de définir se propage aux blocs qui le lisent (reactive.js)
    if (res.ok && deps && !fromReactive && DEP_LANGS.has(lang)) {
        const entries = depEntries(), i = entries.findIndex((x) => x.page === S.page && x.open === open);
        if (i >= 0) reactive.changed([...symbols(lang, code).defs].map((n) => n.replace(/^table:/, "")), { after: i });
    }
    return res.ok;
}

function askInput(st, m) {
    const box = $(".outputs", ensureNode(st));
    const form = document.createElement("form");
    form.className = "input-ask";
    form.innerHTML = `<label><span class="prompt"></span><input type="${m.password ? "password" : "text"}" autocomplete="off" spellcheck="false"></label>`;
    $(".prompt", form).textContent = m.prompt || "Entrée :";
    box.append(form);
    syncOutputs();
    widgetChanged(st);
    const input = $("input", form);
    input.focus();
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const value = input.value;
        form.remove();
        addOutput(st, { output_type: "stream", name: "stdout", text: `${m.prompt || ""}${m.password ? "•".repeat(value.length) : value}\n` });
        kernel.reply(value);
        cm.focus();
    });
    input.addEventListener("keydown", (e) => e.stopPropagation());
}

// ---------------------------------------------------------------- dépendances entre les blocs

/** Les blocs exécutables du document, dans l'ordre des pages : ceux de la page lue viennent de l'éditeur */
function depEntries() {
    const out = [];
    S.pages.forEach((p, k) => {
        if (k === S.page) {
            let n = 0;
            for (const b of S.blocks) {
                if (!b.lang) continue;
                n++;
                const { lang, code } = resolve(b.lang, blockSource(b));
                out.push({ page: k, open: b.open, n, lang, code, h: blockHash(lang, code) });
            }
            return;
        }
        let n = 0;
        for (const c of p.cells || []) {
            if (c.type !== "code" || !c.lang || c.lang === "markdown") continue;
            n++;
            const { lang, code } = resolve(c.lang, c.source.replace(/\n+$/, ""));
            out.push({ page: k, cell: c, n, lang, code, h: blockHash(lang, code) });
        }
    });
    return out;
}

const depLabel = (e) => `${pageName(e.page)} · bloc ${e.n}`;

/**
 * Avant le bloc open : les blocs qui lui fournissent ses noms (variables, fonctions, tables SQL) et qui n'ont pas
 * tourné dans la machine actuelle, ou ont changé depuis (deps.js). Ceux de la page lue s'exécutent à leur place ;
 * ceux des autres pages en arrière-plan, leurs résultats rangés dans leur page.
 */
async function runDeps(open) {
    const entries = depEntries();
    const t = entries.findIndex((e) => e.page === S.page && e.open === open);
    if (t < 0 || !DEP_LANGS.has(entries[t].lang)) return true;
    const { order } = planDeps(entries, t, S.ranAt);
    if (!order.length) return true;
    const st = stateOf(open);
    toast(`D'abord ${order.length > 1 ? `${order.length} blocs` : "un bloc"} dont il dépend : ${order.map((i) => depLabel(entries[i])).join(", ")}`);
    for (const i of order) {
        const e = entries[i];
        setStatus(st, `en attente : ${depLabel(e)}`, "wait");
        const ok = e.page === S.page ? await runBlock(e.open, { deps: false }) : await runElsewhere(e);
        if (!ok) {
            setStatus(st, `non exécuté : erreur dans ${depLabel(e)}`, "err");
            toast(`Le bloc dont il dépend a échoué : ${depLabel(e)}`);
            return false;
        }
    }
    return true;
}

/** Un bloc d'une autre page, sans l'afficher : ses résultats sont rangés dans sa cellule (on les voit en y allant) */
async function runElsewhere(e) {
    const { lang } = e;
    let source = e.code;
    if (lang === "javascript") {
        try { source = transpile(e.code); } catch (err) { e.cell.outputs = [{ output_type: "error", ename: "SyntaxError", evalue: String(err.message), traceback: [] }]; return false; }
    }
    const fx = formulaCode(S.formulas, lang, e.code);
    if (fx?.error) return false;
    if (fx?.lines) source = [...fx.lines, source].join("\n");
    const outputs = [];
    const extra = lang === "javascript" ? { prelude: JS_PRELUDE } : {};
    let res;
    try {
        const missing = fx?.prelude ? preludeMissing(lang, fx) : [];
        if (missing.length) {
            let bad = false;
            await kernel.execute(lang, missing.join("\n"), (m) => { if (m.t === "error") bad = true; }, { ...extra, label: `${depLabel(e)} · formules` });
            if (!bad) preludeDone(lang, missing);
        }
        res = await kernel.execute(lang, source, (m) => {
            if (m.t === "stream") outputs.push({ output_type: "stream", name: m.name, text: m.text });
            else if (m.t === "display") outputs.push({ output_type: "display_data", data: m.data, metadata: {} });
            else if (m.t === "result") outputs.push({ output_type: "execute_result", data: m.data, metadata: {}, execution_count: ++S.exec });
            else if (m.t === "error") outputs.push({ output_type: "error", ename: m.ename, evalue: m.evalue, traceback: m.traceback || [] });
            else if (m.t === "clear") outputs.length = 0;
        }, { ...extra, label: depLabel(e) });
    } catch (err) {
        res = { ok: false };
        outputs.push({ output_type: "error", ename: "Machine", evalue: String(err.message || err), traceback: [] });
    }
    // les flux qui se suivent ne font qu'une sortie (comme dans l'éditeur)
    e.cell.outputs = outputs.reduce((a, o) => {
        const last = a[a.length - 1];
        if (o.output_type === "stream" && last?.output_type === "stream" && last.name === o.name) last.text += o.text; else a.push(o);
        return a;
    }, []);
    if (res.ok) S.ranAt.set(e.h, ++S.runSeq);
    persist();
    return !!res.ok;
}

// ---------------------------------------------------------------- le diagramme du projet

/** Les pages (sections, blocs), les liens entre elles et les dépendances entre blocs, pour /diagramme */
function diagramData() {
    snapPage();
    ensurePaths();
    const entries = depEntries();
    const syms = entries.map((e) => (DEP_LANGS.has(e.lang) ? symbols(e.lang, e.code) : { defs: new Set(), uses: new Set() }));
    const deps = new Map(), uses = entries.map(() => []);
    entries.forEach((e, i) => {
        for (const name of syms[i].uses) {
            let j = i - 1;
            while (j >= 0 && !syms[j].defs.has(name)) j--;
            if (j < 0) continue;   // (un nom de Python, d'une bibliothèque, des phrases : pas d'un bloc)
            uses[i].push({ name, from: j });
            const key = `${j}>${i}`;
            if (!deps.has(key)) deps.set(key, { from: j, to: i, names: [] });
            deps.get(key).names.push(name);
        }
    });
    const out = entries.map((e, i) => {
        const fnRe = e.lang === "python" ? /^(?:async\s+)?(?:def|class)\s+(\w+)/gm : /\b(?:function\*?|class)\s+(\w+)/g;
        const fn = [...e.code.matchAll(fnRe)].map((m) => m[1]).filter((n) => syms[i].defs.has(n));
        const all = [...syms[i].defs];
        return {
            page: e.page, n: e.n, lang: e.lang, line: 0, code: e.code,
            defs: { fn, table: all.filter((n) => n.startsWith("table:")).map((n) => n.slice(6)), var: all.filter((n) => !n.startsWith("table:") && !fn.includes(n)) },
            uses: uses[i],
        };
    });
    const pages = [], cur = S.page;
    S.pages.forEach((p, k) => {
        const text = k === cur ? cm.getValue() : cellsText(p.cells || []);
        const items = [], links = [], seen = new Set();
        let fence = null, n = 0, lastH = -1;
        text.split("\n").forEach((l, line) => {
            const f = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(l);
            if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) fence = null; return; }
            if (f) {
                fence = f[1];
                if (!f[2]) return;
                n++;
                const e = entries.findIndex((x) => x.page === k && x.n === n);
                if (e >= 0) out[e].line = line;
                const d = e >= 0 ? out[e].defs : null;
                const names = d ? [...d.fn, ...d.table, ...d.var].slice(0, 3) : [];
                items.push({ kind: "code", lang: f[2], line, e: e >= 0 ? e : null, label: ` bloc ${n}${names.length ? " · " + names.join(", ") + (d.fn.length + d.table.length + d.var.length > 3 ? "…" : "") : ""}` });
                return;
            }
            const h = /^(#{1,4})\s+(.+?)\s*(?:\{#[\w:.-]+\})?\s*$/.exec(l);
            if (h) { items.push({ kind: "h", level: h[1].length, text: h[2].replace(/[*_`]/g, ""), line }); lastH = items.length - 1; return; }
            for (const m of l.matchAll(WIKI)) {
                S.page = k;   // (un lien se lit depuis le dossier de sa page)
                const to = linkTarget(m[1], true);
                S.page = cur;
                const key = `${lastH}>${to}`;
                if (to >= 0 && !seen.has(key)) { seen.add(key); links.push({ from: lastH, to }); }
            }
        });
        // le premier titre est celui de la page : il ne se répète pas dans la colonne
        if (items[0]?.kind === "h" && items[0].level === 1) { items.shift(); for (const l of links) l.from = l.from === 0 ? -1 : l.from - 1; }
        pages.push({ k, name: pageName(k), dir: dirOf(p.path), items, links });
    });
    // l'ordre : celui des pages, chaque dossier regroupé à sa première page (comme le livre)
    const firstOf = new Map();
    pages.forEach((p, i) => { if (!firstOf.has(p.dir)) firstOf.set(p.dir, i); });
    pages.sort((a, b) => firstOf.get(a.dir) - firstOf.get(b.dir) || a.k - b.k);
    return { pages, entries: out, deps: [...deps.values()], concepts: diagramConcepts(), pageName: (k) => pageName(k) };
}

function showDiagram() {
    openDiagram(diagramData(), {
        current: S.page,
        title: "Projet",
        go: (k, line) => {
            const at = () => { cm.focus(); cm.setCursor(line, 0); cm.scrollIntoView({ line, ch: 0 }, 140); };
            if (k === S.page) at(); else { switchPage(k); setTimeout(at, 520); }
        },
    });
}

async function runAll() {
    for (const b of S.blocks.filter((x) => x.lang)) {
        const ok = await runBlock(b.open);
        if (ok === false) { toast("Exécution arrêtée sur une erreur"); return; }
    }
}

/** /exécuter : le bloc du curseur, sinon le dernier bloc au-dessus. */
function runHere(line = cm.getCursor().line) {
    const b = blockAt(line) || [...S.blocks].reverse().find((x) => x.end <= line && x.lang);
    if (!b) { toast("Aucun bloc de code à exécuter au-dessus"); return; }
    runBlock(b.open, { live: true });
}

function clearOutputs() {
    vmRelease();
    for (const st of S.outs.values()) { st.outputs = []; renderOutputs(st); setStatus(st, ""); }
    persist();
}

// ---------------------------------------------------------------- fenêtres de la machine (vmwindows.js)

const { VM, fitVm, windowImage, windowFrame, vmInline, vmFloat, vmFreeze, vmRelease } = setupVmWindows({ $, kernel, persist, renderOutputs, toast });

// ---------------------------------------------------------------- menu « / »

// Tout passe par « / » : commandes, blocs de code, mise en forme ; dans un bloc, des modèles de code du langage.
// Grama Lectica (le français qui s'exécute) est caché pour l'instant : le moteur marche toujours (un document qui a
// des phrases _…_ les exécute), mais ses commandes ne sont pas proposées dans le menu. GRAMA à true les remet.
const GRAMA = false;
const COMMANDS = [
    { key: "executer", alt: "run", label: "Exécuter le bloc", hint: "Maj Entrée", run: (line) => runHere(line) },
    { key: "tout executer", label: "Tout exécuter", run: () => runAll() },
    { key: "aller", alt: "sommaire", label: "Aller à un titre…", hint: "/aller texte", run: () => {} , opens: "nav" },
    { key: "suivant", label: "Titre suivant", hint: `${ALT} ↓`, run: () => jumpHeading(1) },
    { key: "precedent", label: "Titre précédent", hint: `${ALT} ↑`, run: () => jumpHeading(-1) },
    { key: "interrompre", label: "Interrompre", run: () => kernel.interrupt() },
    { key: "redemarrer", label: "Redémarrer le noyau", run: () => restartKernel() },
    { key: "effacer", label: "Effacer les résultats", run: () => clearOutputs() },
    { key: "replier", label: "Replier les fonctions et les boucles", run: () => foldAllCode() },
    { key: "deplier", label: "Tout déplier", run: () => { for (const m of S.folds.values()) m.clear(); S.folds.clear(); decorate(); } },
    { key: "theme", label: "Thème suivant", hint: () => THEMES[S.theme], run: () => cycleTheme() },
    ...Object.entries(THEMES).map(([t, name]) => ({ key: `theme ${fold(name)}`, label: `Thème ${name}`, hint: () => (S.theme === t ? "actuel" : ""), run: () => setTheme(t) })),
    { key: "terminal", alt: "console", label: "Terminal", hint: "Ctrl ` · ls, tree, mkdir…", run: () => setTimeout(() => term.open()) },
    { key: "page", alt: "nouvelle page", label: "Nouvelle page", hint: `Ctrl ${ALT} N`, run: () => setTimeout(newPage) },
    { key: "page suivante", label: "Page suivante", hint: `Ctrl ${ALT} →`, run: () => setTimeout(() => stepPage(1)) },
    { key: "page precedente", label: "Page précédente", hint: `Ctrl ${ALT} ←`, run: () => setTimeout(() => stepPage(-1)) },
    { key: "supprimer la page", alt: "fermer la page", label: "Supprimer cette page", hint: () => (S.pages.length > 1 ? pageName(S.page) : "une seule page"), run: () => setTimeout(() => closePage()) },
    { key: "nouveau", label: "Nouveau document", run: () => replaceDocument(() => loadText("# Sans titre\n\n")) },
    { key: "ouvrir", label: "Ouvrir un .ted, .ipynb ou .md", run: () => $("#open-file").click() },
    { key: "enregistrer", alt: "ted", label: "Télécharger le projet (.ted)", hint: "toutes les pages, les dossiers et les résultats", run: () => saveTed() },
    { key: "diagramme", alt: "carte", label: "Diagramme du projet", hint: "sections, liens entre pages, dépendances entre blocs", run: () => showDiagram() },
    { key: "diagnostic", alt: "performance", label: "Diagnostic", hint: "ce que fait la machine, ce qui est lent : un rapport à copier", run: () => showDiagnostic() },
    { key: "accueil", alt: "menu", label: "Accueil", hint: "ouvrir un lien ou un .ted, hors ligne, Docker", run: () => openHome() },
    { key: "hors ligne", alt: "installer", label: "Hors ligne et installation", hint: "garder TextEdit et sa machine dans ce navigateur", run: () => openHome("offline") },
    { key: "telecharger", label: "Télécharger en .ipynb", run: () => saveIpynb() },
    { key: "markdown", alt: "telecharger md", label: "Télécharger en .md", run: () => saveMarkdown() },
    { key: "pdf", alt: "imprimer", label: "Exporter en PDF", hint: () => (S.pages.length > 1 ? "le livre : toutes les pages, sommaire" : S.deckMode ? "une diapositive par page" : "texte, code et résultats"), run: () => exportPdf() },
    { key: "pdf page", alt: "pdf cette page", label: "Exporter cette page en PDF", hint: "la page ouverte seulement", run: () => exportPdf({ book: false }) },
    { key: "pdf diaporama", alt: "pdf diapositives", label: "Exporter le diaporama en PDF", hint: "une diapositive par page", run: () => exportPdf({ deck: true }) },
    { key: "pdf notes", alt: "pdf avec notes", label: "Exporter le diaporama avec les notes", hint: "A4 : diapositive et notes", run: () => exportPdf({ deck: true, notes: true }) },
    { key: "science", alt: "scientifique", label: "Mode scientifique (article)", hint: () => (S.sci.on ? "actif" : "police LaTeX, numérotation, PDF"), run: () => toggleScience() },
    { key: "presenter", alt: "diaporama", label: "Présenter (diaporama)", hint: "F5 · Maj F5 depuis ici", run: (n) => startDeck({ line: n }) },
    { key: "presentation", alt: "mode presentation", label: "Mode présentation", hint: () => (S.deckMode ? "actif" : "diapositives animées, PDF"), run: () => toggleDeckMode() },
    { key: "versions", alt: "historique", label: "Versions du document", hint: "rouvrir, restaurer, envoyer", run: () => versionsDialog() },
    { key: "lien", alt: "partager", label: "Partager par lien", hint: "le document dans l'adresse", run: () => shareDialog() },
    { key: "copier", alt: "copy", label: "Copier le document et ses résultats", hint: "Markdown + mise en forme", run: () => copyDocument() },
    { grama: true, key: "traduction", alt: "comprendre", label: "Montrer ce que la machine a compris", hint: () => (S.showTrad ? "affichées" : "cachées"), run: () => toggleTranslations() },
    { key: "cubi", alt: "ia", label: "Cubi : réveiller l'IA locale", hint: "puis sélectionnez un passage · l'IA de Web-Agentic-Model", run: () => setTimeout(() => cubi.open()) },
    { key: "relire", label: "Cubi : relire la page", hint: "ses propositions surlignées", run: () => setTimeout(() => cubi.review()) },
    { key: "cubi personnage", alt: "voir cubi", label: "Cubi : le voir travailler", hint: "le site du modèle en entier, avec son personnage", run: () => setTimeout(() => cubi.watch()) },
    { key: "corriger", alt: "correct", label: "Corriger la ligne", hint: "le texte de la ligne", run: (n) => correctLine(n) },
    { grama: true, key: "apprendre", alt: "enseigner", label: "Apprendre ce que veut dire cette phrase", hint: "une tournure, pour tout le document", run: (n) => setTimeout(() => teachLine(n)) },
    { key: "modele", alt: "concepts ontologie sortes", label: "Ce que le document sait de ses données", hint: "sortes, champs, actions, d'où elles viennent", run: () => showModel() },
    { grama: true, key: "lexique", label: "Ce que ce document a appris", hint: "lectures et tournures, à la fin du texte", run: () => { const i = cm.getValue().search(/<!--\s*lexique\b/i); if (i < 0) toast("Ce document n'a encore rien appris (une question sous une phrase, ou /apprendre)"); else { const p = cm.posFromIndex(i); cm.setCursor(p); cm.scrollIntoView(p, 120); } } },
    { key: "envoyer", label: "Envoyer un fichier dans la machine", run: () => $("#upload-file").click() },
    { key: "visite", label: "Visite de TextEdit", run: () => replaceDocument(() => loadNotebook(welcome())) },
    { key: "exemple", label: "Exemple : analyse de données", run: () => replaceDocument(() => loadNotebook(dataTour())) },
    { key: "exemple presentation", alt: "exemple diaporama", label: "Exemple : présentation", hint: "mode présentation", run: () => replaceDocument(() => loadNotebook(presentation())) },
    { key: "exemple article", alt: "article", label: "Exemple : article scientifique", hint: "mode scientifique", run: () => replaceDocument(() => loadNotebook(article())) },
    { key: "exemple iris", alt: "projet iris", label: "Exemple : projet Iris", hint: "deep learning : SQL, réseau de neurones, validation, article, cours", run: () => replaceDocument(() => loadNotebook(irisProject())) },
    { grama: true, key: "exemple langue", alt: "programmer en francais", label: "Exemple : Programmer en français", hint: "langue naturelle, article vivant", run: () => replaceDocument(() => loadNotebook(langueArticle())) },
    { key: "aide", alt: "raccourcis", label: "Raccourcis", run: () => showShortcuts() },
    { key: "a propos", alt: "about", label: "À propos de TextEdit", hint: "confidentialité, réseau, liens", run: () => $("#about").showModal() },
].filter((c) => GRAMA || !c.grama).map((x) => ({ ...x, command: true }));

const FORMATS = [
    { key: "titre", label: "Titre", hint: "#", text: "# " },
    { key: "sous-titre", label: "Sous-titre", hint: "##", text: "## " },
    { key: "section", label: "Section", hint: "###", text: "### " },
    { key: "liste", label: "Liste", hint: "-", text: "- " },
    { key: "taches", label: "Tâches", hint: "- [ ]", text: "- [ ] " },
    { key: "citation", label: "Citation", hint: ">", text: "> " },
    { key: "separateur", label: "Séparateur", hint: "---", text: "---\n" },
    { key: "tableau", label: "Tableau", hint: "| |", text: "| Colonne | Colonne |\n|---|---|\n| § |  |" },
    { grama: true, key: "theoreme", alt: "preuve", label: "Théorème et preuve", hint: "vérifiés par la machine", text: "> [!THÉORÈME]\n> Pour tout entier naturel n, §\n\n> [!PREUVE]\n> Soit n un entier naturel.\n> " },
].filter((c) => GRAMA || !c.grama);

// Modèles de code ; « § » marque la place du curseur
const SNIPPETS = {
    python: [
        ["def", "fonction", "def §(args):\n    return "],
        ["class", "classe", "class §:\n    def __init__(self):\n        pass"],
        ["for", "boucle", "for § in range(10):\n    "],
        ["if", "condition", "if §:\n    \nelse:\n    "],
        ["while", "tant que", "while §:\n    "],
        ["try", "exception", "try:\n    §\nexcept Exception as e:\n    print(e)"],
        ["with", "fichier", "with open(\"§\") as f:\n    lignes = f.read().splitlines()"],
        ["comprehension", "liste en compréhension", "[§ for x in range(10)]"],
        ["print", "afficher", "print(§)"],
        ["display", "affichage riche", "display(§)"],
        ["plot", "graphique", "plot([1, 2, 3], [1, 4, 9], title=\"§\")"],
        ["table", "tableau interactif", "Table([{\"nom\": \"a\", \"valeur\": 1}])§"],
        ["sql", "requête SQLite", "sql(\"SELECT §\")"],
        ["input", "saisie", "valeur = input(\"§\")"],
        ["tkinter", "fenêtre", "import tkinter as tk\nr = tk.Tk()\ntk.Label(r, text=\"Bonjour§\").pack(padx=40, pady=40)\nr.update()"],
    ],
    javascript: [
        ["function", "fonction", "function §(args) {\n    return ;\n}"],
        ["arrow", "fonction fléchée", "const f = (§) => "],
        ["for", "boucle", "for (const x of §) {\n    \n}"],
        ["class", "classe", "class § {\n    constructor() {\n    }\n}"],
        ["log", "afficher", "console.log(§);"],
        ["html", "affichage HTML", "display.html(`§`);"],
        ["java", "classe Java", "const Liste = Java.type(\"java.util.ArrayList§\");"],
    ],
    java: [
        ["println", "afficher", "System.out.println(§);"],
        ["for", "boucle", "for (int i = 0; i < §; i++) {\n    \n}"],
        ["class", "classe", "class § {\n}"],
        ["methode", "méthode statique", "static int §(int x) {\n    return x;\n}"],
        ["list", "liste", "List<String> § = new ArrayList<>();"],
    ],
    sql: [
        ["select", "SELECT", "SELECT § FROM table;"],
        ["where", "SELECT … WHERE", "SELECT * FROM § WHERE condition;"],
        ["group", "GROUP BY", "SELECT colonne, COUNT(*) FROM § GROUP BY colonne;"],
        ["join", "JOIN", "SELECT * FROM a JOIN b ON a.id = b.§;"],
        ["create", "CREATE TABLE", "CREATE TABLE § (id INTEGER PRIMARY KEY, nom TEXT);"],
        ["insert", "INSERT", "INSERT INTO § VALUES ();"],
        ["update", "UPDATE", "UPDATE § SET colonne = valeur WHERE condition;"],
    ],
    sh: [
        ["for", "boucle", "for f in §*; do\n    echo \"$f\"\ndone"],
        ["if", "condition", "if [ -f § ]; then\n    \nfi"],
        ["function", "fonction", "§() {\n    \n}"],
        ["ls", "lister", "ls -la §"],
    ],
    cpp: [
        ["for", "boucle", "for (int i = 0; i < §; i++) {\n    \n}"],
        ["cout", "afficher", "cout << § << endl;"],
        ["vector", "vecteur", "vector<int> v = {§};"],
    ],
    c: [
        ["printf", "afficher", "printf(\"%d\\n\", §);"],
        ["for", "boucle", "for (int i = 0; i < §; i++) {\n    \n}"],
    ],
    rust: [
        ["println", "afficher", "println!(\"{}\", §);"],
        ["fn", "fonction", "fn §(x: i64) -> i64 {\n    x\n}"],
        ["for", "boucle", "for i in 0..§ {\n    \n}"],
        ["vec", "vecteur", "let v: Vec<i64> = vec![§];"],
        ["struct", "structure", "struct § {\n    nom: String,\n}"],
        ["match", "filtrage", "match § {\n    0 => {}\n    _ => {}\n}"],
    ],
    go: [
        ["println", "afficher", "fmt.Println(§)"],
        ["func", "fonction", "func §(x int) int {\n\treturn x\n}"],
        ["for", "boucle", "for i := 0; i < §; i++ {\n\t\n}"],
        ["range", "parcourir", "for i, x := range § {\n\tfmt.Println(i, x)\n}"],
        ["slice", "tranche", "nombres := []int{§}"],
        ["map", "table", "m := map[string]int{\"§\": 1}"],
    ],
    php: [
        ["echo", "afficher", "echo §, \"\\n\";"],
        ["function", "fonction", "function §($x) {\n    return $x;\n}"],
        ["foreach", "parcourir", "foreach ($§ as $x) {\n    echo $x, \"\\n\";\n}"],
        ["array", "tableau", "$t = [§];"],
        ["printf", "format", "printf(\"%s\\n\", §);"],
    ],
};

const slash = { el: null, items: [], active: 0, line: -1, indent: "", inline: null };

function slashQuery() {
    const cur = cm.getCursor();
    const text = cm.getLine(cur.line);
    if (cur.ch !== text.length || cm.somethingSelected()) return null;
    const m = /^(\s*)\/(.*)$/u.exec(text);
    if (!m) {
        // En fin de ligne, après du texte ou du code : « print(x) /exec », « _…_ /corriger ». Seulement les commandes,
        // d'un mot d'au moins deux lettres collé au « / » : une division « a / b » reste du code.
        const inl = /^(.*\S)\s+\/(\S.*)$/u.exec(text);
        if (!inl) return null;
        if (!/^[\p{L}\w-]{2,}$/u.test(inl[2])) return null;
        return { line: cur.line, indent: "", q: fold(inl[2]).trim(), block: blockAt(cur.line), nav: null, inline: inl[1].length };
    }
    const raw = m[2];
    const nav = /^(?:aller|sommaire|#)(?:\s+(.*))?$/iu.exec(raw);
    // Seuls des mots : « /usr/bin… » dans un bloc reste du code
    if (!/^[\p{L}\w+# -]*$/u.test(raw)) return null;
    const b = blockAt(cur.line);
    return { line: cur.line, indent: m[1], q: fold(raw).trim(), block: b, nav: nav ? fold(nav[1] || "").trim() : null };
}

function slashPool(s) {
    if (!s.block) {
        const langs = ORDER.filter((k) => k !== "markdown").map((k) => ({ key: k, alt: fold(LANGS[k].label), label: LANGS[k].label, hint: LANGS[k].version, block: k }));
        return [COMMANDS[0], COMMANDS[1], ...langs, ...FORMATS, ...COMMANDS.slice(2)];
    }
    // Dans un bloc : modèles du langage d'abord, puis les commandes ; « /usr/bin… » ne propose rien et reste du code
    // puis un autre langage ou du texte, qui coupent le bloc à cette ligne (« /java » dans du Python, « /markdown »)
    const snips = (SNIPPETS[s.block.lang] || []).map(([key, hint, text]) => ({ key, label: key, hint, snippet: text }));
    const langs = ORDER.filter((k) => k !== "markdown").map((k) => ({ key: k, alt: fold(LANGS[k].label), label: `Bloc ${LANGS[k].label}`, hint: "coupe ici", block: k, split: true }));
    const text = [{ key: "markdown", alt: "texte", label: "Texte", hint: "coupe ici", text: "§", split: true }, ...FORMATS.map((x) => ({ ...x, split: true }))];
    return [...snips, ...text, ...langs, ...COMMANDS];
}

/** Coupe le bloc à la ligne n : le code au-dessus et au-dessous reste dans deux blocs du même langage, la ligne n devient « middle ». */
function splitBlock(b, n, middle) {
    const last = b.close ? b.end - 1 : b.end;
    const lines = (from, to) => (to < from ? [] : cm.getRange(Pos(from, 0), Pos(to, cm.getLine(to).length)).split("\n"));
    const above = lines(b.start + 1, n - 1), below = lines(n + 1, last);
    const open = cm.getLine(b.start), close = b.close ? cm.getLine(b.end) : null;
    const out = [];
    if (above.some((l) => l.trim())) out.push(open, ...above, close || b.fence);
    const at = out.length;
    out.push(...middle.split("\n"));
    if (below.some((l) => l.trim())) out.push(open, ...below, ...(close ? [close] : []));
    else if (!middle.endsWith("```") && cm.getLine(b.end + 1)?.trim()) out.push("");
    const body = out.join("\n");
    const caret = body.indexOf("§");
    cm.replaceRange(body.replace("§", ""), Pos(b.start, 0), Pos(b.end, cm.getLine(b.end).length));
    if (caret >= 0) cm.setCursor(cm.posFromIndex(cm.indexFromPos(Pos(b.start, 0)) + caret));
    else cm.setCursor(Pos(b.start + at, 0));
    S.blocks = scan();
    decorate();
}

function slashUpdate() {
    const s = slashQuery();
    if (!s || (s.block && !s.q)) { slashClose(); return; }
    let items;
    if (s.inline != null) items = COMMANDS.filter((x) => !x.opens && (x.key.startsWith(s.q) || x.alt?.startsWith(s.q)));
    else if (s.nav != null) items = navItems(s.nav);
    else {
        // Dans un bloc, une commande ne vient que si son nom commence par la saisie
        const loose = (x) => !s.block && s.q.length > 1 && fold(x.label).includes(s.q);
        items = slashPool(s).filter((x) => !s.q || x.key.startsWith(s.q) || x.alt?.startsWith(s.q) || fold(x.label).startsWith(s.q) || loose(x));
        if (s.q) items.sort((a, c) => (c.key === s.q) - (a.key === s.q));   // « /java » avant JavaScript
    }
    if (!items.length) { slashClose(); return; }
    slash.items = items;
    slash.line = s.line;
    slash.indent = s.indent;
    slash.inline = s.inline ?? null;
    // La commande en fin de ligne s'affiche en bleu, comme une ligne « / »
    slash.mark?.clear();
    slash.mark = s.inline != null ? cm.markText(Pos(s.line, s.inline), Pos(s.line, cm.getLine(s.line).length), { className: "lx-cmd-inline" }) : null;
    slash.active = Math.min(slash.active, items.length - 1);
    if (!slash.el) {
        slash.el = document.createElement("div");
        slash.el.className = "menu slash";
        slash.el.setAttribute("role", "listbox");
        document.body.append(slash.el);
        slash.el.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); slashPick(+b.dataset.i); } });
        cm.addKeyMap(SLASH_KEYS);
    }
    const hint = (x) => (typeof x.hint === "function" ? x.hint() : x.hint || "");
    slash.el.innerHTML = items.map((x, i) => `<button type="button" data-i="${i}" class="${i === slash.active ? "on" : ""}${x.snippet ? " snip" : ""}${x.level ? ` l${x.level}` : ""}">${esc(x.label)}<small>${esc(hint(x))}</small></button>`).join("");
    slash.el.querySelector(".on")?.scrollIntoView({ block: "nearest" });
    const p = cm.cursorCoords(true, "window");
    const h = slash.el.offsetHeight;
    Object.assign(slash.el.style, { left: `${Math.min(p.left, innerWidth - 270)}px`, top: `${p.bottom + h + 8 > innerHeight ? p.top - h - 6 : p.bottom + 6}px` });
}

const SLASH_KEYS = {
    Up: () => { slash.active = (slash.active - 1 + slash.items.length) % slash.items.length; slashUpdate(); },
    Down: () => { slash.active = (slash.active + 1) % slash.items.length; slashUpdate(); },
    Enter: () => slashPick(slash.active),
    Tab: () => slashPick(slash.active),
    Esc: () => slashClose(),
};

function slashClose() {
    slash.mark?.clear();
    slash.mark = null;
    if (!slash.el) return;
    slash.el.remove();
    slash.el = null;
    slash.active = 0;
    cm.removeKeyMap(SLASH_KEYS);
}

/** Remplace la ligne « /… » par un texte ; « § » y place le curseur. */
function insertAt(n, text, indent = "") {
    const body = text.split("\n").map((l, i) => (i ? indent + l : indent + l)).join("\n");
    const at = body.indexOf("§");
    cm.replaceRange(body.replace("§", ""), Pos(n, 0), Pos(n, cm.getLine(n).length));
    if (at >= 0) cm.setCursor(cm.posFromIndex(cm.indexFromPos(Pos(n, 0)) + at));
}

function slashPick(i) {
    const x = slash.items[i];
    const n = slash.line;
    const indent = slash.indent;
    const inline = slash.inline;
    slashClose();
    if (!x) return;
    const len = cm.getLine(n).length;
    if (inline != null) {
        // « print(x) /exec » : la commande s'efface de la ligne, le reste de la ligne demeure
        cm.replaceRange("", Pos(n, inline), Pos(n, len));
        decorate();
        x.run(n);
        return;
    }
    if (x.goto != null) {
        // La ligne « /aller … » s'efface
        if (n > 0) cm.replaceRange("", Pos(n - 1, cm.getLine(n - 1).length), Pos(n, len));
        else cm.replaceRange("", Pos(n, 0), Pos(n, len));
        decorate();
        goToLine(x.goto > n ? x.goto - 1 : x.goto);
        return;
    }
    if (x.opens) {
        cm.replaceRange(`/${x.key} `, Pos(n, indent.length), Pos(n, len));
        slashUpdate();
        return;
    }
    if (x.command) {
        // La ligne « /commande » s'efface entièrement, elle ne reste ni dans le texte ni dans le code
        if (n > 0) cm.replaceRange("", Pos(n - 1, cm.getLine(n - 1).length), Pos(n, len));
        else cm.replaceRange("", Pos(n, 0), Pos(n, len));
        decorate();
        x.run(Math.max(0, n - 1));
        return;
    }
    if (x.split) {
        const b = blockAt(n);
        if (b) {
            splitBlock(b, n, x.block ? "```" + x.block + "\n§\n```" : (x.text.includes("§") ? x.text : x.text + "§"));
            if (x.block) warmLanguages();
            return;
        }
    }
    if (x.block) {
        const after = n < cm.lastLine() && cm.getLine(n + 1).trim() ? "\n" : "";
        cm.replaceRange("```" + x.block + "\n\n```" + after, Pos(n, 0), Pos(n, len));
        cm.setCursor(Pos(n + 1, 0));
        warmLanguages();
        return;
    }
    insertAt(n, x.snippet || x.text, indent);
}

// Dans un bloc, des propositions s'affichent pendant la frappe (mots du langage, complétion Python du noyau)
cm.on("inputRead", (ed, change) => {
    if (slash.el || ed.state.completionActive || !blockAt() || change.origin !== "+input") return;
    const cur = ed.getCursor();
    const before = ed.getLine(cur.line).slice(0, cur.ch);
    if (/(^|[^\w.])[A-Za-z_][\w]{1,}$|\.\w*$/.test(before)) ed.showHint({ hint: kernelHint, completeSingle: false, closeCharacters: /[\s()\[\]{};:>,=+\-*\/"']/ });
});

// ---------------------------------------------------------------- navigation

function headings() {
    const out = [];
    let n = 0;
    const inCode = (i) => S.blocks.some((b) => i >= b.start && i <= b.end);
    cm.eachLine((h) => {
        const m = HEADING.exec(h.text);
        if (m && !inCode(n)) out.push({ line: n, level: m[1].length, text: h.text.replace(HEADING, "").replace(/[*_`]/g, "").trim() });
        n++;
    });
    return out;
}

/** /aller texte : les titres du document, filtrés par la saisie, indentés selon leur niveau. */
function navItems(q) {
    const hs = headings().filter((h) => !q || fold(h.text).includes(q));
    return hs.map((h) => ({ key: "", label: `${"   ".repeat(h.level - 1)}${h.text || "(sans titre)"}`, hint: `ligne ${h.line + 1}`, goto: h.line, level: h.level }));
}

function goToLine(line) {
    // Une section repliée qui cache la cible s'ouvre
    for (const [h, m] of S.folds) { const r = m.find(); if (r && line > r.from.line && line <= r.to.line) { m.clear(); S.folds.delete(h); } }
    cm.focus();
    cm.setCursor(Pos(line, cm.getLine(line).length));
    const top = cm.charCoords(Pos(line, 0), "local").top;
    cm.scrollTo(null, Math.max(0, top - 48));
    decorate();
}

function jumpHeading(dir) {
    const cur = cm.getCursor().line;
    const hs = headings();
    const h = dir > 0 ? hs.find((x) => x.line > cur) : [...hs].reverse().find((x) => x.line < cur);
    if (h) goToLine(h.line);
}

// ---------------------------------------------------------------- code collé, phrases du document

/** Invites de console recopiées avec le code : « >>> », « ... », « $ » en tête de toutes les lignes de code. */
function stripPrompts(code) {
    const lines = code.split("\n").filter((l) => l.trim());
    if (lines.length && lines.every((l) => /^(>>>|\.\.\.)( |$)/.test(l))) return code.replace(/^(>>>|\.\.\.) ?/gm, "");
    if (lines.length && lines.every((l) => /^\$ /.test(l))) return code.replace(/^\$ /gm, "");
    return code;
}

/** Code copié d'une page web : des balises <br> à la place des retours à la ligne (seules sur leur ligne ou en fin de ligne). */
function unbreak(code) {
    if (!/<br\s*\/?>/i.test(code)) return code;
    if (!code.includes("\n")) return code.replace(/[ \t]*<br\s*\/?>[ \t]*/gi, "\n").replace(/&nbsp;/g, " ");
    return code.replace(/[ \t]*<br\s*\/?>[ \t]*$/gim, "").replace(/&nbsp;/g, " ");
}

/** Commande d'exécution restée dans le code (« /exec », « /run », « print(x) /exécuter ») : on la retire avant de lancer. */
const isRunWord = (w) => { w = fold(w); return w === "run" || (w.length >= 3 && "executer".startsWith(w)) || w === "tout executer"; };
function unrun(code) {
    return code.split("\n").flatMap((l) => {
        const own = /^\s*\/([\p{L} ]+?)\s*$/u.exec(l);
        if (own && isRunWord(own[1])) return [];
        const end = /^(.*\S)\s+\/([\p{L} ]+?)\s*$/u.exec(l);
        return [end && isRunWord(end[2]) ? end[1] : l];
    }).join("\n");
}

function glDoc(n) {
    const phrases = [...S.prior.phrases];
    cm.eachLine((h) => {
        const k = cm.getLineNumber(h);
        if (k === n || !h.text.includes("_") || S.blocks.some((b) => k >= b.start && k <= b.end)) return;
        for (const p of phrasesIn(h.text)) phrases.push(p.text);
    });
    const ext = S.gl.ext;
    const tables = new Map([...(ext?.tables || []), ...S.prior.tables, ...tablesIn(cm.getValue().split("\n"))]);
    return { phrases, tables, external: ext };
}

// ---------------- /corriger : les fautes d'une ligne
// Chaque phrase _…_ de la ligne est réécrite comme le moteur l'a lue (correctPhrase) : les mots qu'il a relus
// (« affich » → « affiche »), un mot en trop, un nom proche d'un nom connu. Ce qu'il ne comprend pas reste souligné.

/** /science : ajoute (ou retire) l'en-tête qui met le document en article. */
function toggleScience() {
    const lines = cm.getValue().split("\n");
    const fm = frontMatter(lines);
    if (fm && isScience(fm)) {
        const k = lines.findIndex((l, i) => i > 0 && i < fm.end && /^mode\s*:/i.test(l));
        cm.replaceRange("mode: texte", Pos(k, 0), Pos(k, lines[k].length));
        toast("Mode scientifique retiré (l'en-tête reste : « mode: scientifique » pour y revenir)");
        return;
    }
    if (fm) {
        const k = lines.findIndex((l, i) => i > 0 && i < fm.end && /^mode\s*:/i.test(l));
        if (k > 0) cm.replaceRange("mode: scientifique", Pos(k, 0), Pos(k, lines[k].length));
        else cm.replaceRange("mode: scientifique\n", Pos(1, 0));
    } else {
        const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        cm.replaceRange(`---\nmode: scientifique\nauteurs: Prénom Nom\ndate: ${date}\nrésumé: Ce que l'article montre, en quelques lignes.\n---\n`, Pos(0, 0));
    }
    toast("Mode scientifique : sections numérotées, équations $$…$$ {#eq:…}, figures, [@citations], {{valeurs}} — /pdf pour l'article");
}

// ---------------- le mode présentation (deck.js)
// Le document devient un diaporama : « --- » entre les diapositives (sinon chaque titre # ou ## en commence une),
// une disposition devinée, des animations d'une diapositive à l'autre, le code qui s'exécute (et se modifie) sur
// la diapositive. /présenter (F5) le lance pour n'importe quel document ; l'en-tête « mode: présentation » en fait
// un diaporama : bouton ▶ dans la barre d'état, PDF d'une diapositive par page, lien qui s'ouvre en diaporama.

let deck = null;

/** L'en-tête « mode: présentation » : le corps change de classe (les « --- » se voient en coupures de diapositive). */
function drawDeckMode(fmEnd) {
    const on = fmEnd > 0 && isDeck(frontMatter(cm.getValue().split("\n", fmEnd + 1)));
    if (on === S.deckMode) return;
    S.deckMode = on;
    document.body.classList.toggle("deck-mode", on);
}

/**
 * Les commentaires <!-- … --> du texte (notes de l'orateur, <!-- clic -->…) : en gris, dans la police du texte.
 * Le mode Markdown leur donne le même jeton qu'au `code` en ligne : on les repère ici pour les distinguer.
 */
function drawComments(inCode) {
    const text = cm.getValue();
    const key = text.includes("<!--") ? text : "";
    if (key === S.cmtKey) return;
    S.cmtKey = key;
    for (const m of S.cmtMarks || []) m.clear();
    S.cmtMarks = [];
    if (!key) return;
    for (const m of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        const from = cm.posFromIndex(m.index), to = cm.posFromIndex(m.index + m[0].length);
        if (inCode.has(from.line)) continue;
        S.cmtMarks.push(cm.markText(from, to, { className: "lx-mdcomment", inclusiveLeft: false, inclusiveRight: false }));
    }
}

// ---------------- liens entre les pages
// [[Calculs]], [[projet/calculs.md]], [[Calculs|le texte affiché]] ; et le Markdown [texte](projet/calculs.md), un
// chemin depuis le dossier de la page (ou depuis /). Un clic sur un lien dessiné ouvre la page (Ctrl clic sur la
// ligne qu'on écrit) ; une adresse web s'ouvre dans un nouvel onglet. mv renomme aussi les liens (voir le terminal).

const WIKI = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;
const MDLINK = /(?<!!)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/** La page que désigne un lien, depuis la page qu'on lit : son numéro, ou -1 */
function linkTarget(target, wiki) {
    ensurePaths();
    let t = decodeURIComponent(target.trim()).replace(/#.*$/, "");
    if (!t) return -1;
    const here = dirOf(S.pages[S.page]?.path || "");
    const norm = (p) => p.replace(/^\.\//, "");
    const resolve = (p) => {
        const parts = p.startsWith("/") ? [] : here ? here.split("/") : [];
        for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") parts.pop(); else parts.push(seg); }
        return parts.join("/");
    };
    const withMd = (p) => (/\.md$/i.test(p) ? p : p + ".md");
    for (const cand of [resolve(norm(t)), resolve(withMd(norm(t))), norm(t).replace(/^\//, ""), withMd(norm(t)).replace(/^\//, "")]) {
        const k = S.pages.findIndex((p) => p.path === cand);
        if (k >= 0) return k;
    }
    if (!wiki) return -1;
    // [[Titre]] : le titre de la page, ou le nom de son fichier, sans majuscules ni accents
    const f = (x) => fold(x).replace(/[-_\s]+/g, " ").trim();
    const want = f(t.replace(/\.md$/i, ""));
    let k = S.pages.findIndex((_, j) => f(pageName(j)) === want);
    if (k < 0) k = S.pages.findIndex((p) => f(p.path.slice(p.path.lastIndexOf("/") + 1).replace(/\.md$/, "")) === want);
    return k;
}

/** Les liens [[…]] : dessinés comme des liens (les crochets, sur la ligne du curseur seulement), absents en pointillés */
function drawPageLinks(inCode) {
    const text = cm.getValue();
    const key = text.includes("[[") ? `${S.page}|${S.pages.map((p) => p.path).join("\u0000")}|${text}` : "";
    if (key === S.wlKey) return;
    S.wlKey = key;
    for (const m of S.wlMarks || []) m.clear();
    S.wlMarks = [];
    if (!key) return;
    for (const m of text.matchAll(WIKI)) {
        const from = cm.posFromIndex(m.index);
        if (inCode.has(from.line)) continue;
        const k = linkTarget(m[1], true);
        const shown = m[2] != null ? m.index + 2 + m[1].length + 1 : m.index + 2, end = m.index + m[0].length;
        const mark = (a, b, className, attrs) => S.wlMarks.push(cm.markText(cm.posFromIndex(a), cm.posFromIndex(b), { className, attributes: attrs, inclusiveLeft: false, inclusiveRight: false }));
        mark(m.index, shown, "lx-wl-sign");
        mark(shown, end - 2, k >= 0 ? "lx-wl" : "lx-wl lx-wl-missing", { "data-target": m[1], title: k >= 0 ? `Ouvrir « ${pageName(k)} » (/${S.pages[k].path})` : `Pas de page « ${m[1]} » : un clic la crée` });
        mark(end - 2, end, "lx-wl-sign");
    }
}

/** Le lien sous le curseur de la souris : { wiki, target } ou null */
function linkAt(pos) {
    const line = cm.getLine(pos.line);
    for (const [re, wiki] of [[WIKI, true], [MDLINK, false]]) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) if (pos.ch >= m.index && pos.ch <= m.index + m[0].length) return { wiki, target: wiki ? m[1] : m[2], text: wiki ? m[2] || m[1] : m[1] };
    }
    return null;
}

/** Suivre un lien : une page du document (créée si [[…]] n'existe pas), ou une adresse web */
function followLink(link) {
    if (/^(https?:|mailto:)/i.test(link.target)) { open(link.target, "_blank", "noopener"); return; }
    if (!link.wiki && /^#/.test(link.target)) return;   // (#3 : une diapositive, en mode présentation)
    const k = linkTarget(link.target, link.wiki);
    if (k >= 0) { if (k === S.page) toast("C'est la page ouverte"); else switchPage(k); return; }
    if (!link.wiki) { toast(`Pas de page « ${link.target} » dans le document`); return; }
    if (S.link?.ro) { toast("Document en lecture seule"); return; }
    // [[Nouvelle idée]] : la page se crée, dans le dossier de celle-ci
    const title = link.target.replace(/\.md$/i, "").split("/").pop().trim();
    const dir = dirOf(S.pages[S.page].path);
    S.pages.push({ cells: [newCell("markdown", "markdown", `# ${title}`)], path: null });
    S.pages[S.pages.length - 1].path = pathFor(S.pages.length - 1, dir);
    pagesChanged();
    switchPage(S.pages.length - 1);
    toast(`Page « ${title} » créée`);
}

// Un clic sur un lien dessiné (hors de la ligne qu'on écrit), ou Ctrl clic n'importe où : le lien est suivi
cm.getWrapperElement().addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const onLink = e.target.closest?.(".lx-wl, .cm-link, .cm-url");
    if (!onLink && !(e.ctrlKey || e.metaKey)) return;
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, "window");
    // (les signes cachés faussent la colonne sous la souris : le lien dessiné dit lui-même où il mène)
    const wl = e.target.closest?.(".lx-wl");
    let link = wl ? { wiki: true, target: wl.dataset.target } : null;
    if (!link && onLink?.classList.contains("cm-link")) {
        const label = onLink.textContent;
        const all = [...cm.getLine(pos.line).matchAll(MDLINK)].filter((m) => m[1].includes(label) || label.includes(m[1]));
        all.sort((a, b) => Math.abs(a.index - pos.ch) - Math.abs(b.index - pos.ch));
        if (all[0]) link = { wiki: false, target: all[0][2] };
    }
    link ||= linkAt(pos);
    if (!link) return;
    const active = e.target.closest?.(".lx-active");
    if (active && !(e.ctrlKey || e.metaKey)) return;   // sur la ligne qu'on écrit : un clic place le curseur
    e.preventDefault();
    e.stopPropagation();
    followLink(link);
}, true);

/** mv a renommé des pages : les liens qui les désignaient suivent, sur toutes les pages */
function relink(moves) {
    if (!moves.length) return;
    const rel = (fromDir, to) => {
        const a = fromDir ? fromDir.split("/") : [], b = to.split("/");
        let i = 0;
        while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
        return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
    };
    // (les liens se lisent depuis le dossier de leur page)
    const fixText = (text, dir) => text
        .replace(MDLINK, (all, label, url) => {
            if (/^(https?:|mailto:|#)/i.test(url)) return all;
            const hit = moves.find(([from]) => from === linkTargetPath(url, dir));
            return hit ? `[${label}](${encodeURI(rel(dir, hit[1]))})` : all;
        })
        .replace(WIKI, (all, target, alias) => {
            const hit = moves.find(([from, , oldTitle]) => from === linkTargetPath(target, dir) || from === linkTargetPath(target + ".md", dir) || fold(target.trim()) === fold(oldTitle || ""));
            if (!hit) return all;
            const title = pageName(S.pages.findIndex((p) => p.path === hit[1]));
            return `[[${title}${alias != null ? "|" + alias : ""}]]`;
        });
    S.pages.forEach((p, k) => {
        const dir = dirOf(p.path);
        if (k === S.page) {
            const before = cm.getValue(), after = fixText(before, dir);
            if (after !== before) cm.replaceRange(after, Pos(0, 0), Pos(cm.lastLine(), cm.getLine(cm.lastLine()).length), "+terminal");
            return;
        }
        const cells = p.cells || [];
        let changed = false;
        const next = cells.map((c) => {
            if (c.type === "code" && c.lang !== "markdown") return c;
            const src = fixText(c.source, dir);
            if (src === c.source) return c;
            changed = true;
            return { ...c, source: src };
        });
        if (changed) p.cells = next;
    });
}
/** Le chemin que désigne un lien écrit dans le dossier dir (sans chercher s'il existe) */
function linkTargetPath(target, dir) {
    let t = target.trim().replace(/#.*$/, "");
    try { t = decodeURIComponent(t); } catch { /* tel quel */ }
    const parts = t.startsWith("/") ? [] : dir ? dir.split("/") : [];
    for (const seg of t.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") parts.pop(); else parts.push(seg); }
    return parts.join("/");
}

/**
 * Les formules du document ($$ f(x, y) = … $$) : relues à chaque changement ; sous chacune, sa signature et les
 * langages qui l'appellent (ou ce qui n'est pas compris). Leurs noms ne passent pas par la jonction.
 */
function drawFormulas(inCode) {
    const text = cm.getValue();
    // (les formules des autres pages d'abord : celles de la page ouverte les remplacent si elles ont le même nom)
    const others = S.prior.formulas, off = others.length;
    const key = text.includes("$$") || off ? `${S.prior.key}|${text}` : "";
    if (key !== S.fxKey) {
        S.fxKey = key;
        S.formulas = key ? findFormulas([...others, ...text.split("\n")], (n) => n >= off && inCode.has(n - off)) : [];
        for (const f of S.formulas) { f.line -= off; f.end -= off; }
        kernel.junction.reserved = new Set(S.formulas.filter((f) => !f.error).map((f) => f.name));
    }
    const want = new Map();
    for (const f of S.formulas) {
        const h = f.end >= 0 ? cm.getLineHandle(f.end) : null;
        if (!h) continue;
        const langs = FORMULA_LANGS.map((l) => LANGS[l]?.label || l).join(", ");
        const label = f.error ? `<b>ƒ ${esc(f.name)}</b> ${esc(f.error)}`
            : f.kind === "const" ? `<b>ƒ</b> <code>${esc(f.name)}</code> = ${esc(formatValue(f.value))} <span>· constante, dans les blocs ${esc(langs)}</span>`
            : `<b>ƒ</b> <code>${esc(signature(f))}</code> <span>· appelable dans les blocs ${esc(langs)}${f.outside?.length ? ` · utilise aussi ${esc(f.outside.join(", "))} (à définir dans le bloc)` : ""}</span>`;
        want.set(h, { key: label, bad: !!f.error });
    }
    for (const [h, w] of S.fxWidgets) {
        if (want.get(h)?.key === w.key && cm.getLineNumber(h) != null) continue;
        w.widget.clear();
        S.fxWidgets.delete(h);
    }
    for (const [h, w] of want) {
        if (S.fxWidgets.has(h)) continue;
        const el = document.createElement("div");
        el.className = `lx-fx${w.bad ? " bad" : ""}`;
        el.innerHTML = w.key;
        S.fxWidgets.set(h, { key: w.key, widget: cm.addLineWidget(h, el, { noHScroll: true }) });
    }
}

/** Ce que l'éditeur prête au diaporama : le document, les résultats, l'exécution, l'écriture du code. */
function deckEnv({ dark = S.dark } = {}) {
    const fm = () => { const lines = cm.getValue().split("\n", 61); return frontMatter(lines); };
    const results = (n) => {
        const h = cm.getLineHandle(n);
        return (h && S.gl.outs.get(h)?.text || "").split("\n").filter((l) => l && !l.startsWith("\u0001")).join("\n");
    };
    return {
        parts: () => docParts(),
        fm,
        title: S.title,
        dark,
        toast,
        exportPdf: (o) => exportPdf(o),
        phraseLine: (l) => (phrasesIn(l.text).length
            ? `${phraseSpans(l.text)}\n\n<div class="pr-res dk-glres" data-line="${l.n}">${esc(results(l.n))}</div>\n` : l.text),
        phraseResult: results,
        outputs: (open) => S.outs.get(open) || null,
        offline: () => received(),
        // (un diaporama reçu par lien n'exécute rien de lui-même, à l'arrivée sur une diapositive, sans accord)
        run: (open, { auto = false } = {}) => { if (auto && !S.trusted) { trustBanner(true); return null; } S.blocks = scan(); return runBlock(open, { live: !auto }); },
        live: (o) => liveHtml.has(o),
        setCode: (open, code) => {
            S.blocks = scan();
            const b = blockOf(open);
            if (!b || blockSource(b) === code) return;
            const last = b.close ? b.end - 1 : b.end;
            if (last < b.start + 1) cm.replaceRange(code + "\n", Pos(b.start + 1, 0));
            else cm.replaceRange(code, Pos(b.start + 1, 0), Pos(last, cm.getLine(last).length));
        },
        langLabel: (lang, info) => (lang ? LANGS[lang]?.label || lang : info || "texte"),
        onExit: (line) => {
            deck = null;
            goToLine(Math.min(line, cm.lastLine()));
            cm.focus();
        },
    };
}

/** /présenter, F5 : depuis le début ; Maj F5 (line) : depuis la diapositive du curseur. */
function startDeck({ line = null } = {}) {
    if (deck) return;
    S.blocks = scan();
    deck = new Deck(deckEnv());
    const start = line == null ? 0 : deck.slideAt(line);
    deck.open(start, { fullscreen: !S.link });
    // la machine démarre pendant qu'on présente : le premier bloc ira plus vite
    if (kernel.state === "off") kernel.start().catch(() => {});
}

/** /présentation : ajoute (ou retire) l'en-tête qui fait du document un diaporama. */
function toggleDeckMode() {
    const lines = cm.getValue().split("\n");
    const fm = frontMatter(lines);
    const k = fm ? lines.findIndex((l, i) => i > 0 && i < fm.end && /^mode\s*:/i.test(l)) : -1;
    if (fm && isDeck(fm)) {
        cm.replaceRange("mode: texte", Pos(k, 0), Pos(k, lines[k].length));
        toast("Mode présentation retiré (« mode: présentation » dans l'en-tête pour y revenir) ; F5 présente toujours");
        return;
    }
    if (fm) {
        if (k > 0) cm.replaceRange("mode: présentation", Pos(k, 0), Pos(k, lines[k].length));
        else cm.replaceRange("mode: présentation\n", Pos(1, 0));
    } else {
        const date = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        cm.replaceRange(`---\nmode: présentation\nauteur: Prénom Nom\ndate: ${date}\n---\n`, Pos(0, 0));
    }
    toast("Mode présentation : « --- » entre les diapositives, <!-- clic --> pour une étape, F5 pour présenter");
}

function toggleTranslations() {
    S.showTrad = !S.showTrad;
    prefs.set("traduction", S.showTrad);
    S.gl.key = "";
    drawPhrases();
    toast(S.showTrad ? "Traductions affichées : sous chaque phrase en français libre, la forme que la machine exécute" : "Traductions cachées (le signe ≈ reste)");
}

function correctLine(n) {
    if (blockAt(n)) { toast("/corriger s'applique aux phrases _…_ du texte"); return; }
    const line = cm.getLine(n);
    const all = [];
    cm.eachLine((h) => {
        const k = cm.getLineNumber(h);
        if (!h.text.includes("_") || S.blocks.some((b) => k >= b.start && k <= b.end)) return;
        for (const p of phrasesIn(h.text)) all.push({ ...p, n: k });
    });
    const prior = S.prior.phrases;
    const mine = all.map((p, i) => [p, prior.length + i]).filter(([p]) => p.n === n);
    if (!mine.length) { toast("Pas de phrase _…_ sur cette ligne"); return; }
    const ext = S.gl.ext;
    const tables = new Map([...(ext?.tables || []), ...S.prior.tables, ...tablesIn(cm.getValue().split("\n"))]);
    let text = line;
    const notes = [], left = [];
    for (const [p, i] of [...mine].reverse()) {
        if (p.sliders) { notes.push("une phrase avec un curseur reste telle quelle"); continue; }
        const r = correctPhrase([...prior, ...all.map((x) => x.text)], i, tables, ext);
        notes.push(...r.fixes);
        if (r.error) left.push(r.error);
        text = text.slice(0, p.from + 1) + r.text + text.slice(p.to - 1);
    }
    if (text !== line) cm.replaceRange(text, Pos(n, 0), Pos(n, line.length), "+corriger");
    decorate();
    toast(left.length ? `Encore incompris : ${left[0]}` : notes.length ? `Corrigé : ${notes.slice(0, 3).join(" ; ")}` : "Aucune faute trouvée");
}

// ---------------- autocomplétion des phrases
// Pendant qu'on écrit une phrase _…_, la lecture elle-même dit ce qui peut venir (gramalectica completions) :
// les mots de la langue attendus à cet endroit, et les données, actions et champs du document. Le menu s'ouvre
// après deux lettres (ou Ctrl+Espace) ; Tab ou Entrée choisit, Échap ferme.

const glc = { el: null, items: [], active: 0, line: -1, start: 0 };

/** La phrase en cours d'écriture : le texte entre son « _ » ouvrant et le curseur. */
function phrasePrefix() {
    const cur = cm.getCursor();
    if (cm.somethingSelected() || blockAt(cur.line)) return null;
    const m = /(?:^|[^\p{L}\p{N}_`])_(?!\s)([^_\n`]*)$/u.exec(cm.getLine(cur.line).slice(0, cur.ch));
    return m ? { line: cur.line, start: cur.ch - m[1].length, prefix: m[1] } : null;
}

function glcUpdate(forced = false) {
    if (slash.el) { glcClose(); return; }
    const p = phrasePrefix();
    if (!p) { glcClose(); return; }
    const partial = /[\p{L}'’]*$/u.exec(p.prefix)[0];
    if (!forced && !glc.el && partial.length < 2) return;   // discret : deux lettres tapées, ou Ctrl+Espace
    const d = glDoc(p.line);
    const c = completions(p.prefix, contextOf(d.phrases, d.tables, d.external));
    if (!c) { glcClose(); return; }
    glc.items = c.items;
    glc.line = p.line;
    glc.start = p.start;
    glc.active = Math.min(glc.active, c.items.length - 1);
    if (!glc.el) {
        glc.el = document.createElement("div");
        glc.el.className = "menu slash glc";
        glc.el.setAttribute("role", "listbox");
        document.body.append(glc.el);
        glc.el.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); glcPick(+b.dataset.i); } });
        cm.addKeyMap(GLC_KEYS);
    }
    glc.el.innerHTML = c.items.map((x, i) => `<button type="button" data-i="${i}" class="${i === glc.active ? "on" : ""}">${esc(x.label)}<small>${esc(x.kind)}</small></button>`).join("");
    glc.el.querySelector(".on")?.scrollIntoView({ block: "nearest" });
    const at = cm.cursorCoords(true, "window");
    const h = glc.el.offsetHeight;
    Object.assign(glc.el.style, { left: `${Math.min(at.left, innerWidth - 270)}px`, top: `${at.bottom + h + 8 > innerHeight ? at.top - h - 6 : at.bottom + 6}px` });
}

const GLC_KEYS = {
    Up: () => { glc.active = (glc.active - 1 + glc.items.length) % glc.items.length; glcUpdate(true); },
    Down: () => { glc.active = (glc.active + 1) % glc.items.length; glcUpdate(true); },
    Enter: () => glcPick(glc.active),
    Tab: () => glcPick(glc.active),
    Esc: () => glcClose(),
};

function glcClose() {
    if (!glc.el) return;
    glc.el.remove();
    glc.el = null;
    glc.active = 0;
    cm.removeKeyMap(GLC_KEYS);
}

function glcPick(i) {
    const x = glc.items[i];
    const cur = cm.getCursor();
    glcClose();
    if (!x || cur.line !== glc.line) return;
    // Le mot (ou les mots) déjà commencés sont remplacés ; une espace suit, sauf avant la fin de la phrase
    const next = cm.getLine(cur.line)[cur.ch];
    cm.replaceRange(x.label + (next === "_" || next === " " ? "" : " "), Pos(cur.line, glc.start + x.from), cur, "+glc");
}

// ---------------------------------------------------------------- frappe

function continueList(ed) {
    if (slash.el || ed.somethingSelected() || blockAt()) return CodeMirror.Pass;
    const cur = ed.getCursor();
    const line = ed.getLine(cur.line);
    const m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
    if (!m || cur.ch < m[0].length) return CodeMirror.Pass;
    if (!line.slice(m[0].length).trim()) { ed.replaceRange("", Pos(cur.line, 0), Pos(cur.line, line.length)); return undefined; }
    const bullet = m[3] ? `${+m[3] + 1}${m[4]}` : m[2];
    ed.replaceSelection(`\n${m[1]}${bullet}${m[5]}${m[6] ? "[ ] " : ""}`);
    return undefined;
}

const KEYWORDS = {
    python: "False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print len range enumerate zip dict list set tuple sorted sum min max abs round open display plot Table Figure sql progress input",
    javascript: "break case catch class const continue default delete do else export extends finally for function if in instanceof let new return super switch this throw try typeof var void while yield console.log display Java.type Math JSON Array Object String Number",
    java: "abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new package private protected public return short static super switch this throw throws try void while System.out.println String List ArrayList Map HashMap Arrays Collections Collectors Stream Math",
    sql: "SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP INDEX JOIN LEFT INNER ON AS AND OR NOT NULL COUNT SUM AVG MIN MAX DISTINCT PRIMARY KEY INTEGER TEXT REAL",
    sh: "echo cd ls pwd cat grep sed awk find export for do done if then else fi while case esac printf wc head tail sort uniq mkdir rm cp mv",
};

function wordHint(ed) {
    const cur = ed.getCursor();
    const line = ed.getLine(cur.line);
    let start = cur.ch;
    while (start && /[\w.$!]/.test(line[start - 1])) start--;
    const word = line.slice(start, cur.ch);
    const b = blockAt();
    if (!word || !b) return null;
    const pool = new Set((KEYWORDS[b.lang] || "").split(/\s+/));
    for (const m of blockSource(b).matchAll(/[A-Za-z_][\w]{2,}/g)) pool.add(m[0]);
    const list = [...pool].filter((w) => w.startsWith(word) && w !== word).sort().slice(0, 40);
    return list.length ? { list, from: Pos(cur.line, start), to: cur } : null;
}

async function kernelHint(ed, callback) {
    const b = blockAt();
    if (!b || resolve(b.lang, blockSource(b)).lang !== "python" || kernel.state !== "ready") return callback(wordHint(ed));
    const base = ed.indexFromPos(Pos(b.start + 1, 0));
    try {
        const r = await kernel.complete(blockSource(b), ed.indexFromPos(ed.getCursor()) - base);
        if (!r.matches.length) return callback(wordHint(ed));
        return callback({ list: r.matches, from: ed.posFromIndex(base + r.start), to: ed.posFromIndex(base + r.end) });
    } catch { return callback(wordHint(ed)); }
}
kernelHint.async = true;

async function inspectAtCursor() {
    const b = blockAt();
    if (!b || b.lang !== "python" || kernel.state !== "ready") return;
    const cur = cm.getCursor();
    const m = /([A-Za-z_][\w.]*)\(?$/.exec(cm.getLine(cur.line).slice(0, cur.ch));
    if (!m) return;
    try {
        const r = await kernel.inspect(m[1]);
        $(".lx-tooltip")?.remove();
        const tip = document.createElement("pre");
        tip.className = "lx-tooltip";
        tip.textContent = r.text;
        const { left, bottom } = cm.cursorCoords(true, "page");
        Object.assign(tip.style, { left: `${left}px`, top: `${bottom + 8}px` });
        document.body.append(tip);
        const close = () => { tip.remove(); removeEventListener("keydown", close, true); removeEventListener("pointerdown", close, true); };
        setTimeout(() => { addEventListener("keydown", close, true); addEventListener("pointerdown", close, true); });
    } catch { /* noyau occupé */ }
}

// Un bloc HTML, LaTeX ou Mermaid se rend dès que le curseur le quitte
let lastBlock = null;
function renderLeftBlock() {
    const b = blockAt();
    const prev = lastBlock && blockOf(lastBlock);
    lastBlock = b?.open || null;
    if (!prev || prev.open === b?.open || !prev.lang || LANGS[prev.lang].engine !== "page") return;
    if (S.outs.get(prev.open)?.rendered !== blockSource(prev)) runBlock(prev.open);
}

cm.on("changes", (ed, chs) => {
    decorate();
    persist();
    slashUpdate();
    // Seule la frappe ouvre l'autocomplétion des phrases ; un collage ou une annulation la ferment
    if (chs.some((c) => c.origin === "+input" || c.origin === "+delete")) glcUpdate(); else glcClose();
});
cm.on("cursorActivity", () => { skipFences(); decorate(); renderLeftBlock(); if (slash.el) slashUpdate(); if (glc.el) glcUpdate(true); });
cm.on("blur", () => setTimeout(() => { if (!document.activeElement?.closest?.(".CodeMirror")) { slashClose(); glcClose(); } }, 100));

// ---------------------------------------------------------------- document : chargement, enregistrement

/** Le document en cellules (.ipynb) : le texte entre les blocs devient du Markdown, chaque bloc exécutable une cellule de code. */
function toNotebook() {
    const cells = [];
    let md = [];
    const flush = () => { const s = md.join("\n").replace(/^\n+|\n+$/g, ""); if (s) cells.push(newCell("markdown", "markdown", s)); md = []; };
    for (let i = 0; i <= cm.lastLine();) {
        const b = S.blocks.find((x) => x.start === i);
        if (b?.lang) {
            flush();
            const c = newCell("code", b.lang, blockSource(b));
            const fence = [b.extra, b.meta].filter(Boolean).join(" ");
            if (fence) c.meta.fence = fence;
            const st = S.outs.get(b.open);
            c.outputs = st ? st.outputs.filter((o) => JSON.stringify(o).length < 300000) : [];
            cells.push(c);
            i = b.end + 1;
        } else if (b) {
            for (let k = b.start; k <= b.end; k++) md.push(cm.getLine(k));
            i = b.end + 1;
        } else {
            md.push(cm.getLine(i));
            i++;
        }
    }
    flush();
    const nb = { id: DOC_ID, title: S.title, cells: cells.length ? cells : [newCell("markdown", "markdown", "")], meta: {}, updated: Date.now() };
    // plusieurs pages : toutes, celle qu'on lit telle qu'elle est dans l'éditeur
    if (S.pages.length > 1 || S.dirs.length || S.pages[0].path?.includes("/")) {
        nb.pages = S.pages.map((p, k) => ({ name: pageName(k), path: p.path, cells: k === S.page ? nb.cells : p.cells || [] }));
        nb.page = S.page;
        if (S.dirs.length) nb.dirs = [...S.dirs];
    }
    return nb;
}

/** Le contraire de cellsText : un texte Markdown, ses blocs de code en cellules */
function textToCells(text) {
    const cells = [], md = [], lines = text.replace(/\n+$/, "").split("\n");
    const flush = () => { const t = md.join("\n").replace(/^\n+|\n+$/g, ""); if (t) cells.push(newCell("markdown", "markdown", t)); md.length = 0; };
    for (let i = 0; i < lines.length; i++) {
        const m = /^(`{3,}|~{3,})\s*([\w+#.-]+)(.*)$/.exec(lines[i]);
        const lang = m ? m[2].toLowerCase() : null;
        const end = lang && LANGS[lang] && lang !== "markdown" ? lines.findIndex((l, j) => j > i && l.startsWith(m[1]) && !l.slice(m[1].length).trim()) : -1;
        if (end < 0) { md.push(lines[i]); continue; }
        flush();
        const c = newCell("code", lang, lines.slice(i + 1, end).join("\n"));
        if (m[3].trim()) c.meta.fence = m[3].trim();
        cells.push(c);
        i = end;
    }
    flush();
    return cells;
}

/** Le texte de cellules, tel que l'éditeur le montre (les blocs entre ```) */
function cellsText(cells) {
    return cells.map((c) => (c.type === "code" && c.lang !== "markdown" ? "```" + c.lang + (c.meta?.fence ? " " + c.meta.fence : "") + "\n" + c.source.replace(/\n+$/, "") + "\n```" : c.source.replace(/\n+$/, "")))
        .filter((t) => t.trim()).join("\n\n") + "\n";
}

function loadNotebook(nb) {
    S.pages = nb.pages?.length ? nb.pages.map((p) => ({ cells: p.cells, path: p.path || null })) : [{ cells: nb.cells }];
    S.page = Math.min(Math.max(0, nb.page | 0), S.pages.length - 1);
    S.dirs = Array.isArray(nb.dirs) ? nb.dirs.filter((d) => typeof d === "string" && d) : [];
    ensurePaths();
    showCells(S.pages[S.page].cells);
    renderPages();
}

/**
 * Ce que les autres pages apportent à la page qu'on lit : les phrases des pages d'avant (dans l'ordre, comme un seul
 * programme), les tableaux et les lignes des formules de toutes les autres (le code des blocs mis de côté).
 */
function readOtherPages() {
    const phrases = [], tables = [], formulas = [];
    S.pages.forEach((p, k) => {
        if (k === S.page || !p.cells) return;
        const lines = [];
        let fence = false;
        for (const l of cellsText(p.cells).split("\n")) {
            if (/^\s*(```|~~~)/.test(l)) { fence = !fence; lines.push(""); continue; }
            lines.push(fence ? "" : l);
        }
        formulas.push(...lines, "");
        if (k > S.page) return;
        for (const l of lines) if (l.includes("_")) for (const ph of phrasesIn(l)) phrases.push(ph.text);
        if (lines.some((l) => l.includes("|"))) tables.push(...tablesIn(lines));
    });
    // les actions du terminal (« crée le dossier… ») : une page peut définir les siennes avec elles
    phrases.unshift(...TERM_ACTIONS);
    S.prior = { phrases, tables, formulas, key: `${S.page}:${S.pages.length}:${phrases.join("\u0001")}:${formulas.join("\n").length}:${formulas.filter((l) => l.includes("$$")).join("")}` };
}

/** Les cellules d'une page, dans l'éditeur (et leurs résultats sous les blocs) */
function showCells(cells) {
    readOtherPages();
    const parts = [];
    const outs = new Map();
    let line = 0;
    for (const c of cells) {
        const code = c.type === "code" && c.lang !== "markdown";
        const text = code ? "```" + c.lang + (c.meta?.fence ? " " + c.meta.fence : "") + "\n" + c.source.replace(/\n+$/, "") + "\n```" : c.source.replace(/\n+$/, "");
        if (!text.trim()) continue;
        if (code && c.outputs?.length) outs.set(line, c.outputs);
        parts.push(text);
        line += text.split("\n").length + 1;
    }
    S.keepPages = true;
    try { loadText(parts.join("\n\n") + "\n", outs); } finally { S.keepPages = false; }
}

function loadText(text, outs = new Map()) {
    if (!S.opening) leaveLink();
    // un texte ouvert seul (nouveau document, fichier .md) : une seule page
    if (!S.keepPages) { S.pages = [{ cells: null }]; S.page = 0; S.dirs = []; readOtherPages(); renderPages(); }
    vmRelease();
    for (const st of S.outs.values()) st.widget?.clear();
    S.outs.clear();
    for (const m of S.folds.values()) m.clear();
    S.folds.clear();
    for (const l of S.labels.values()) l.marks.forEach((m) => m.clear());
    S.labels.clear();
    cm.setValue(text);
    cm.clearHistory();
    S.blocks = scan();
    for (const b of S.blocks) {
        const o = outs.get(b.start);
        if (o) { const st = stateOf(b.open); st.outputs = o; renderOutputs(st); }
    }
    cm.setCursor(Pos(0, 0));
    decorate();
    // Les blocs rendus dans la page (HTML, LaTeX, Mermaid) n'attendent pas la machine
    // (un document reçu par lien : son HTML attend qu'on le demande)
    // (le HTML s'y affiche sans rien exécuter : ▶ l'exécute, après un avertissement s'il contient du code)
    for (const b of S.blocks) if (b.lang && LANGS[b.lang].engine === "page" && !outs.has(b.start)) runBlock(b.open);
    persist(true);
    warmLanguages();
}

let saveTimer = 0;
function persist(now = false) {
    clearTimeout(saveTimer);
    // Un document reçu par lien ne remplace pas celui du navigateur
    if (S.link) { $("#save-state").textContent = now || S.link.ro ? "" : "modifications non enregistrées"; return; }
    const run = () => {
        if (library.save(toNotebook()) === false) {
            $("#save-state").textContent = "non enregistré";
            if (!persist.warned) { persist.warned = true; toast("Le document est trop lourd pour le navigateur : /télécharger pour le garder", { ms: 6000 }); }
            return;
        }
        persist.warned = false;
        S.saved = Date.now();
        updateStatus();
        keepHistory();
    };
    if (now) run();
    else { $("#save-state").textContent = "modifié"; saveTimer = setTimeout(run, 700); }
}

function download(name, text, type = "application/json") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileName = () => fold(S.title || "document").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "document";

/** Le projet entier en un fichier .ted : toutes les pages, les dossiers, les résultats (le format du .ipynb) */
function saveTed() {
    const nb = toIpynb(toNotebook());
    nb.metadata = { ...nb.metadata, lumen: { ...(nb.metadata?.lumen || {}), ted: 1 } };
    download(`${fileName()}.ted`, JSON.stringify(nb, null, 1), "application/vnd.textedit+json");
    toast("Projet téléchargé : un .ted contient toutes les pages, les dossiers et les résultats");
}

function saveIpynb() { download(`${fileName()}.ipynb`, JSON.stringify(toIpynb(toNotebook()), null, 1)); toast("Document téléchargé au format .ipynb"); }
function saveMarkdown() {
    // (toutes les pages, l'une après l'autre)
    const text = S.pages.length > 1 ? S.pages.map((p, k) => (k === S.page ? cm.getValue() : cellsText(p.cells || [])).replace(/\n+$/, "")).join("\n\n") + "\n" : cm.getValue();
    download(`${fileName()}.md`, text, "text/markdown");
    toast("Document téléchargé au format .md");
}

// ---------------------------------------------------------------- /pdf et /copy
// Le document tel qu'on le lit : le texte mis en forme, le code coloré, et sous chaque bloc ou phrase ses résultats.
// /pdf en fait une page imprimable (le navigateur l'enregistre en PDF : texte sélectionnable, figures vectorielles) ;
// /copy le met dans le presse-papiers, en Markdown (pour un éditeur) et mis en forme (pour un traitement de texte).

/** Le document en morceaux : du texte (ses lignes, avec les résultats des phrases), et des blocs avec leurs sorties. */
function docParts() {
    S.blocks = scan();
    const parts = [];
    let text = null;
    for (let n = 0; n <= cm.lastLine(); n++) {
        const b = S.blocks.find((x) => x.start === n);
        if (b) {
            text = null;
            const lang = b.lang || "";
            parts.push({ kind: "block", open: b.open, start: b.start, lang, info: b.info, extra: b.extra || "", meta: b.meta || "", code: blockSource(b), page: !!lang && LANGS[lang]?.engine === "page", outputs: S.outs.get(b.open)?.outputs || [] });
            n = b.end;
            continue;
        }
        const h = cm.getLineHandle(n);
        if (/^\s*\/\p{L}/u.test(h.text)) continue;   // une commande « /… » n'est pas du texte
        if (!text) parts.push(text = { kind: "text", lines: [] });
        text.lines.push({ n, text: h.text, results: S.gl.outs.get(h)?.text || "" });
    }
    return parts;
}

/** Une ligne de texte : ses phrases _…_ gardent leur allure de phrase exécutable (pas de l'italique). */
function phraseSpans(text) {
    let line = text, shift = 0;
    for (const ph of phrasesIn(text)) {
        const span = `<span class="pr-phrase">${esc(ph.text)}</span>`;
        line = line.slice(0, ph.from + shift) + span + line.slice(ph.to + shift);
        shift += span.length - (ph.to - ph.from);
    }
    return line;
}

function replaceDocument(load) {
    if (cm.getValue().trim() && !confirm("Remplacer le document actuel ?")) return;
    splashDuring(load);
}


// (le reste — la page imprimable, le livre, /pdf, /copier — est dans print.js, installé à la fin de ce fichier)
function exportPdf(opts) { return printer.exportPdf(opts); }
function copyDocument() { return printer.copyDocument(); }

// ---------------------------------------------------------------- partager par lien
// Le document entier dans l'adresse (voir link.js) : à envoyer tel quel, rien n'est enregistré ailleurs.

async function shareDialog() {
    const dlg = $("#share");
    const nb = toNotebook();
    const opts = () => ({ hello: $("#sh-hello").value, ro: $("#sh-ro").checked, outputs: $("#sh-out").checked, images: $("#sh-img").checked });
    let url = "", seq = 0;
    const update = async () => {
        $("#sh-img").disabled = !$("#sh-out").checked;
        const n = ++seq;
        const u = await makeLink(nb, opts());
        if (n !== seq) return;
        url = u;
        $("#sh-url").value = u;
        const kb = u.length / 1024, size = $("#sh-size");
        size.textContent = `${u.length.toLocaleString("fr-FR")} caractères` + (u.length > 60000
            ? " : très long ; un courriel ou un lien raccourci le porte, une messagerie risque de le couper (retirez les images)"
            : u.length > 8000 ? " : passe par un courriel, un PDF ou un raccourcisseur de liens" : "");
        size.classList.toggle("warn", kb > 8);
    };
    if (!dlg.dataset.wired) {
        dlg.dataset.wired = "1";
        $("#sh-copy").addEventListener("click", async () => {
            try { await navigator.clipboard.writeText($("#sh-url").value); toast("Lien copié : collez-le dans votre message"); }
            catch { $("#sh-url").select(); toast("Copiez le lien sélectionné (Ctrl C)"); }
        });
        $("#sh-open").addEventListener("click", () => open($("#sh-url").value, "_blank", "noopener"));
        $("#sh-url").addEventListener("focus", (e) => e.target.select());
    }
    for (const id of ["sh-hello", "sh-ro", "sh-out", "sh-img"]) $(`#${id}`).oninput = update;
    if (!$("#sh-hello").value && S.link?.hello) $("#sh-hello").value = S.link.hello;
    await update();
    dlg.showModal();
}

async function openLink() {
    let got;
    try { got = await readLink(); }
    catch (e) { toast(`Lien illisible : ${e.message}`, { ms: 7000 }); return false; }
    S.link = { ro: got.ro, hello: got.hello };
    S.trusted = false;
    window.splashWord = got.hello;
    S.opening = true;
    try { loadNotebook(got.nb); } finally { S.opening = false; }
    cm.setOption("readOnly", got.ro);
    document.body.classList.toggle("reading", got.ro);
    $("#st-link-label").textContent = "reçu par lien";
    $("#st-keep").textContent = "Garder une copie";
    $("#st-link").hidden = false;
    trustBanner();
    // un diaporama envoyé par lien s'ouvre en diaporama, dès que l'écran d'accueil s'efface
    if (isDeck(frontMatter(cm.getValue().split("\n", 61)))) S.autoDeck = true;
    return true;
}

function leaveLink({ keep = false } = {}) {
    if (!S.link) return;
    S.link = null;
    if (keep) trustDocument(); else { S.trusted = true; $("#trust")?.remove(); }
    window.splashWord = "";
    cm.setOption("readOnly", false);
    document.body.classList.remove("reading");
    $("#st-link").hidden = true;
    if (hasLink()) history.replaceState(null, "", location.pathname + location.search);
    if (keep) persist(true);
}

$("#st-keep").addEventListener("click", () => {
    const version = S.link?.version;
    const ask = version ? "Cette version remplacera le document actuel (qui reste dans les versions). Continuer ?"
        : "Ce document, avec vos modifications, remplacera celui enregistré dans ce navigateur. Continuer ?";
    if (library.current() && !confirm(ask)) return;
    leaveLink({ keep: true });
    toast(version ? "Version restaurée : le document précédent reste dans /versions" : "Le document est à vous : il s'enregistre dans ce navigateur");
    cm.focus();
});
$("#st-mine").addEventListener("click", () => {
    window.splashWord = "";
    splashDuring(() => loadNotebook((library.current() && library.load(library.current())) || welcome()));
});
// Un autre lien collé dans la barre d'adresse de cet onglet
addEventListener("hashchange", async () => {
    if (!hasLink()) return;
    const got = await readLink().catch(() => null);
    window.splashWord = got?.hello || "";
    splashDuring(() => openLink().then((ok) => { if (ok) setTimeout(() => openHome("link"), 700); }));
});

// ---------------- rien ne s'exécute sans qu'on le demande
// Le HTML (blocs, résultats) s'affiche sans ses scripts ; ▶ l'exécute, dans un cadre isolé, après un avertissement
// s'il contient du code. Ce qu'on a exécuté ne se réexécute pas tout seul (ni au rechargement, ni dans un lien).
// Un document reçu par lien le dit dans un bandeau, et un diaporama reçu n'exécute rien de lui-même sans accord.

/** Les sorties HTML exécutées à la demande, le temps de la session (jamais enregistré : au rechargement, plus rien) */
const liveHtml = new WeakSet();
const approved = new Set();   // le code déjà accepté, pour ses propres documents, le temps de la session
S.trusted = true;
/** Un document reçu de quelqu'un (pas une de ses propres versions) : son HTML n'a jamais accès au réseau */
const received = () => !!S.link && !S.link.version;

/** L'avertissement avant d'exécuter du HTML qui contient du code : true pour exécuter */
function confirmCode(code) {
    if (!received() && approved.has(code)) return Promise.resolve(true);
    const dlg = $("#run-warn");
    $("#rw-from").hidden = !received();
    const scripts = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>|\son[a-z]+\s*=\s*("[^"]*"|'[^']*')|javascript:[^"'\s>]*/gi)].map((m) => (m[1] ?? m[2] ?? m[0]).trim()).filter(Boolean);
    $("#rw-code").textContent = (scripts.join("\n\n") || code).slice(0, 1500);
    return new Promise((done) => {
        let answered = false;
        const close = (ok) => { if (answered) return; answered = true; dlg.close(); if (ok && !received()) approved.add(code); done(ok); };
        $("#rw-run").onclick = () => close(true);
        $("#rw-cancel").onclick = () => close(false);
        dlg.onclose = () => close(false);
        dlg.showModal();
        $("#rw-cancel").focus();
    });
}

/** ▶ sur un résultat HTML (pandas, display(HTML(…))) qui contient du code */
async function runHtmlOutput(st, o) {
    if (!(await confirmCode(outputText(o.data["text/html"])))) return;
    liveHtml.add(o);
    renderOutputs(st);
}

function trustBanner(again = false) {
    if (!received()) return;
    const code = S.blocks.some((b) => b.lang);
    if (!code && !again) return;
    let bar = $("#trust");
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "trust";
        bar.className = "trust";
        bar.setAttribute("role", "status");
        const deckDoc = S.deckMode || isDeck(frontMatter(cm.getValue().split("\n", 61)));
        bar.innerHTML = '<span class="trust-text"><b>Document reçu par lien.</b> Rien ne s\'y exécute tout seul : le HTML s\'affiche sans ses scripts, et c\'est vous qui lancez chaque bloc. N\'exécutez pas un code sans savoir ce qu\'il fait. TextEdit ne vous demandera jamais de mot de passe.</span>'
            + (deckDoc ? '<button type="button" class="trust-ok">Laisser le diaporama exécuter</button>' : "") + '<button type="button" class="trust-x" title="Fermer">×</button>';
        bar.querySelector(".trust-ok")?.addEventListener("click", () => trustDocument());
        bar.querySelector(".trust-x").addEventListener("click", () => bar.remove());
        document.body.append(bar);
    } else if (again) bar.animate?.([{ transform: "translateX(-50%) scale(1.04)" }, { transform: "translateX(-50%)" }], { duration: 300 });
}

/** Accord donné : le diaporama reçu peut exécuter ses blocs de lui-même (#| exécuter: auto, au clic) */
function trustDocument() {
    if (S.trusted) return;
    S.trusted = true;
    $("#trust")?.remove();
    toast("Le diaporama exécutera ses blocs");
}

// ---------------------------------------------------------------- historique : versions et annulation
// (versions.js) Une version compressée, au format des liens, à chaque pause qui change vraiment le texte ; et
// l'historique de Ctrl Z, rangé avec le texte auquel il s'applique, repris au rechargement de la page.

function keepHistory(force = false) {
    if (S.link) return;
    const text = cm.getValue(), nb = toNotebook();
    const all = nb.pages ? nb.pages.map((p) => cellsText(p.cells)).join("\f") : text;
    remember(DOC_ID, all, S.title, () => pack(nb, { outputs: true, images: false }), { force }).catch(() => {});
    if (S.undoReady) saveUndo(DOC_ID, text, cm.getHistory()).catch(() => {});
}

async function restoreUndo() {
    try {
        const h = await loadUndo(DOC_ID, cm.getValue());
        // (rien tapé entre-temps : sinon l'historique ne correspondrait plus)
        if (h && !cm.historySize().undo) cm.setHistory(h);
    } catch { /* pas d'historique */ }
    S.undoReady = true;
}

const when = (t) => {
    const d = new Date(t), now = new Date(), min = Math.round((now - d) / 60000);
    const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    if (d.toDateString() === now.toDateString()) return `aujourd'hui, ${hm}`;
    if (new Date(now - 86400000).toDateString() === d.toDateString()) return `hier, ${hm}`;
    return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${hm}`;
};

async function versionsDialog() {
    const dlg = $("#versions"), box = $("#vs-list");
    keepHistory(true);
    await new Promise((r) => setTimeout(r, 150));
    const all = await versionList(DOC_ID);
    box.innerHTML = all.length ? "" : '<div class="vs-empty">Aucune version encore : elles se gardent pendant que vous écrivez.</div>';
    for (const v of all) {
        const row = document.createElement("div");
        row.className = "vs-row";
        row.innerHTML = `<div class="vs-when">${esc(when(v.t))}</div><div class="vs-meta">${esc(v.title || "Sans titre")} · ${v.chars.toLocaleString("fr-FR")} caractères · ${Math.max(1, Math.round(v.size / 1024))} Ko</div>` +
            '<div class="vs-acts"><button type="button" data-act="open">Ouvrir</button><button type="button" data-act="link">Lien</button></div>';
        row.querySelector('[data-act="open"]').onclick = async () => { dlg.close(); openVersion(v); };
        row.querySelector('[data-act="link"]').onclick = async () => {
            const url = linkOf(await bytesOf(v.id));
            try { await navigator.clipboard.writeText(url); toast(`Lien de la version (${when(v.t)}) copié`); }
            catch { prompt("Le lien de cette version :", url); }
        };
        box.append(row);
    }
    dlg.showModal();
}

/** Une version s'ouvre comme un document reçu par lien : à part, sans remplacer le document, jusqu'à « Restaurer ». */
async function openVersion(v) {
    const bytes = await bytesOf(v.id);
    if (!bytes) { toast("Cette version n'est plus disponible"); return; }
    const got = await unpack(bytes);
    keepHistory(true);   // le document tel qu'il est reste dans l'historique
    splashDuring(() => {
        S.link = { ro: false, hello: "", version: v.t };
        window.splashWord = "";
        S.opening = true;
        try { loadNotebook(got.nb); } finally { S.opening = false; }
        $("#st-link-label").textContent = `version : ${when(v.t)}`;
        $("#st-keep").textContent = "Restaurer cette version";
        $("#st-link").hidden = false;
    });
}

// ---------------------------------------------------------------- écran d'ouverture
// « TextEdit » s'écrit lettre par lettre pendant le chargement de la page, et le temps d'un changement de document.

const splash = $("#splash");
let splashTimer = 0;

function splashOut(min = 0) {
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => {
        splash.classList.add("out");
        cm.refresh();
        cm.focus();
    }, min);
}

function splashDuring(load) {
    if (reduceMotion.matches || !window.splashType) { load(); return; }
    clearTimeout(splashTimer);
    splash.classList.remove("out");
    // Le document change derrière le mot, pendant qu'il s'écrit ; la frappe est plus vive qu'à l'ouverture
    splashTimer = setTimeout(load, 300);
    window.splashType(0.55).then(() => splashOut(0));
}

async function openFile(file) {
    const text = await file.text();
    if (/\.(md|markdown|txt)$/i.test(file.name)) { replaceDocument(() => { loadText(text); toast(`« ${file.name} » ouvert`); }); return; }
    try {
        const nb = fromIpynb(text, file.name.replace(/\.(ipynb|ted)$/i, ""));
        replaceDocument(() => { loadNotebook(nb); toast(`« ${file.name} » ouvert`); });
    } catch (e) {
        toast(`Fichier illisible : ${e.message}`);
    }
}

async function uploadToMachine(file) {
    if (kernel.state !== "ready") { toast("La machine n'est pas encore prête"); return; }
    if (file.size > 4e6) { toast("Fichier trop gros (4 Mo au plus)"); return; }
    toast(`Envoi de ${file.name}…`);
    await kernel.writeFile(file.name, new Uint8Array(await file.arrayBuffer()));
    toast(`${file.name} est dans /tmp/lumen/work`);
}

// ---------------------------------------------------------------- machine : état et préchauffage

const KSTATE = {
    off: ["Machine arrêtée", "off"], booting: ["Démarrage", "boot"], starting: ["Installation", "boot"],
    ready: ["Prêt", "ready"], busy: ["Exécution", "busy"], error: ["Erreur", "error"],
};

kernel.addEventListener("state", (e) => {
    const { state, label, progress } = e.detail;
    // une machine qui (re)démarre a la mémoire vide : plus aucun bloc n'y a tourné
    if (state === "booting" || state === "starting") { S.ranAt.clear(); preludeSent.clear(); }
    const pill = $("#kernel");
    pill.dataset.state = KSTATE[state]?.[1] || state;
    $("#kernel-label").textContent = label || KSTATE[state]?.[0] || state;
    if (progress != null) pill.style.setProperty("--p", progress);
    if (state === "ready" && e.detail.info) $("#kernel").title = $("#kernel-sub").textContent = `Python ${e.detail.info.python} · SQLite ${e.detail.info.sqlite}`;
    if (state === "error") toast(`La machine n'a pas démarré : ${label}`);
    if (state === "ready") warmLanguages();
});
kernel.addEventListener("java", (e) => {
    if (e.detail.ecj === "ready" && kernel.info) $("#kernel").title = $("#kernel-sub").textContent = `Python ${kernel.info.python} · SQLite ${kernel.info.sqlite} · Java ${kernel.java.version || "8"}`;
});
kernel.addEventListener("ecj-progress", (e) => { $("#kernel-sub").textContent = `Compilateur Java · ${Math.round(e.detail * 100)} %`; });

function warmLanguages() {
    if (kernel.state !== "ready" || S.link) return;
    const langs = new Set(S.blocks.filter((b) => b.lang).map((b) => resolve(b.lang, blockSource(b)).lang));
    // Les rapides d'abord, un par un, en priorité minimale. Pas Rust : sa compilation (une minute, plus de 100 Mo)
    // ralentirait tout le reste, pour ne gagner que le chargement du compilateur
    for (const l of ["javascript", "java", "go", "php", "c", "cpp"]) if (langs.has(l)) kernel.warm(l);
}

async function restartKernel() {
    S.gl.sources = {};
    glExternal();
    glObject = null;
    toast("Redémarrage du noyau…");
    vmRelease();
    await kernel.restart();
    toast("Noyau redémarré : variables, tables et fichiers de travail remis à zéro");
}

// ---------------------------------------------------------------- thème, état, notifications

function applyTheme() {
    if (!THEMES[S.theme]) S.theme = "auto";
    S.dark = S.theme === "dark" || S.theme === "hc-dark" || (S.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = S.dark ? "dark" : "light";
    if (S.theme.startsWith("hc-")) document.documentElement.dataset.contrast = "high";
    else delete document.documentElement.dataset.contrast;
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

function setTheme(t) {
    S.theme = t;
    prefs.set("theme", t);
    toast(`Thème ${THEMES[t]}`);
    applyTheme();
    cm.refresh();
    for (const st of S.outs.values()) if (st.outputs.length) renderOutputs(st);
}

function cycleTheme() {
    const order = Object.keys(THEMES);
    setTheme(order[(order.indexOf(S.theme) + 1) % order.length]);
}

function updateStatus() {
    const cur = cm.getCursor();
    const b = blockAt(cur.line);
    // La barre reste sobre : le langage et ▶ seulement dans un bloc ; la ligne et l'enregistrement en infobulle
    $(".statusbar").title = `ligne ${cur.line + 1}`;
    $("#st-lang").textContent = b ? (b.lang ? LANGS[b.lang].label : b.info || "Texte brut") : "";
    $("#st-lang").hidden = !b;
    $("#st-run").hidden = !(b && b.lang);
    $("#st-present").hidden = !S.deckMode;
    const ago = S.saved ? Math.round((Date.now() - S.saved) / 1000) : null;
    // « enregistré » ne s'affiche pas (c'est l'état normal) : seulement « modifié », « non enregistré »…
    if (ago != null) { $("#save-state").textContent = ""; $("#save-state").title = ago < 5 ? "enregistré" : `enregistré il y a ${ago < 60 ? `${ago} s` : `${Math.round(ago / 60)} min`}`; }
}
setInterval(updateStatus, 5000);

function toast(text, { ms = 3200 } = {}) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

// Le langage du bloc, dans la barre d'état : un clic le change
function langMenu() {
    const b = blockAt();
    if (!b) return;
    $(".menu.langs")?.remove();
    const menu = document.createElement("div");
    menu.className = "menu langs";
    menu.innerHTML = ORDER.filter((k) => k !== "markdown").map((k) => `<button type="button" data-lang="${k}" class="${k === b.lang ? "on" : ""}">${LANGS[k].label}<small>${esc(LANGS[k].version)}</small></button>`).join("");
    document.body.append(menu);
    const r = $("#st-lang").getBoundingClientRect();
    Object.assign(menu.style, { right: `${Math.max(8, innerWidth - r.right)}px`, bottom: `${innerHeight - r.top + 6}px` });
    const close = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    setTimeout(() => addEventListener("pointerdown", outside, true));
    menu.addEventListener("click", (e) => {
        const k = e.target.closest("[data-lang]")?.dataset.lang;
        if (!k) return;
        close();
        const fresh = blockOf(b.open);
        if (fresh) cm.replaceRange("```" + k, Pos(fresh.start, 0), Pos(fresh.start, fresh.open.text.length));
        cm.focus();
        warmLanguages();
    });
}

// ---------------------------------------------------------------- diagnostic (diag.js)

function diagReport() {
    const nav = performance.getEntriesByType("navigation")[0];
    const info = kernel.info || {};
    return diag.report({
        "Machine": kernel.native ? "native (conteneur Docker)" : "émulée dans le navigateur (v86)",
        "État": `${kernel.state}${kernel.running ? ` — en cours : ${kernel.running.label || kernel.running.lang}` : ""}${kernel.jobs.length ? ` — ${kernel.jobs.length} en attente` : ""}`,
        "Langages": [info.python && `Python ${info.python}`, info.sqlite && `SQLite ${info.sqlite}`, kernel.java?.version && `Java ${kernel.java.version}`].filter(Boolean).join(" · ") || "—",
        "Navigateur": navigator.userAgent,
        "Processeur": `${navigator.hardwareConcurrency || "?"} cœurs${navigator.deviceMemory ? ` · ${navigator.deviceMemory} Go` : ""}`,
        "Page": `chargée en ${nav ? Math.round(nav.loadEventEnd || nav.domComplete) : "?"} ms · ${S.pages.length} page${S.pages.length > 1 ? "s" : ""} · ${cm.lineCount()} lignes ouvertes`,
        "Hors ligne": navigator.serviceWorker?.controller ? "Service Worker actif" : "sans Service Worker",
        "Phrases (C++)": S.gl.cppMs ? `dernière compilation ${(S.gl.cppMs / 1000).toFixed(1)} s${S.gl.preempts ? `, a cédé ${S.gl.preempts} fois` : ""}` : "pas encore compilées",
    });
}

function showDiagnostic() {
    let dlg = $("#diagnostic");
    if (!dlg) {
        dlg = document.createElement("dialog");
        dlg.id = "diagnostic";
        dlg.className = "shortcuts diag-dlg";
        dlg.setAttribute("aria-label", "Diagnostic");
        dlg.innerHTML = `<h2>Diagnostic</h2><p class="about-small">Ce que la machine a fait depuis l'ouverture de la page. Rien n'est envoyé : copiez le rapport pour le transmettre.</p>
            <pre class="diag-report"></pre><div class="rw-acts"><button type="button" data-act="refresh">Actualiser</button><button type="button" data-act="copy">Copier le rapport</button><button type="button" data-act="close">Fermer</button></div>`;
        document.body.append(dlg);
        dlg.addEventListener("close", () => setTimeout(refocusEditor, 0));
        dlg.addEventListener("click", async (e) => {
            const act = e.target.closest("button")?.dataset.act;
            if (act === "close") dlg.close();
            if (act === "refresh") dlg.querySelector(".diag-report").textContent = diagReport();
            if (act === "copy") {
                try { await navigator.clipboard.writeText(diagReport()); toast("Rapport copié"); }
                catch { toast("Le presse-papiers est refusé : sélectionnez le texte et copiez-le"); }
            }
        });
    }
    dlg.querySelector(".diag-report").textContent = diagReport();
    if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- aide

function showShortcuts() {
    const rows = [
        ["/", "Toutes les commandes, les blocs, la mise en forme"], ["/ dans un bloc", "Modèles de code du langage"], ["/exécuter", "Exécuter le bloc"],
        ["Maj Entrée", "Exécuter le bloc et en sortir"], [`${MOD} Entrée`, "Exécuter le bloc"], [`${MOD} Maj Entrée`, "Tout exécuter"],
        ["Tab / Maj Tab", "Compléter / documentation (Python)"], [`${MOD} /`, "Commenter"], [`${MOD} S / ${MOD} O`, "Télécharger / ouvrir"],
        ["Marge", "Replier une section ou un bloc"], ["Barre d'état", "Langage du bloc"],
        ["Ctrl `", "Terminal : les pages en fichiers et dossiers"], [`Ctrl ${ALT} N`, "Nouvelle page"], [`Ctrl ${ALT} → ←`, "Page suivante, précédente (Ctrl Tab si le navigateur le laisse)"],
        ["F5 / Maj F5", "Présenter : depuis le début / depuis ici"], ["→ ← espace, clic", "Diaporama : étape suivante, précédente"],
        ["O · N · P", "Diaporama : vue d'ensemble · notes · vue présentateur"], ["D · L · E", "Diaporama : crayon · laser · effacer"],
        ["B · W · F", "Diaporama : écran noir · blanc · plein écran"], ["12 Entrée", "Diaporama : aller à la diapositive 12"],
    ];
    $("#shortcuts-list").innerHTML = rows.map(([k, v]) => `<div><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join("");
    $("#shortcuts").showModal();
}

// ---------------------------------------------------------------- pages
// Un document peut avoir plusieurs pages (Ctrl Alt N) : chacune a son texte, ses résultats et son annulation ; la
// machine et ses variables sont communes. Ctrl Alt → ← (ou Ctrl Tab, là où le navigateur le laisse passer) changent
// de page ; les onglets sont dans la barre d'état. Toutes les pages s'enregistrent, voyagent dans le lien et le .ipynb.

const PAGE_HEADING = /^#{1,3}\s+\S/;
const cleanHeading = (l) => l.replace(/^#+\s+/, "").replace(/[*_`]/g, "").trim();

/** Le premier titre d'une page (pas un commentaire « # » d'un bloc de code), ou null */
function headingOf(k) {
    if (k === S.page) {
        for (let i = 0; i <= cm.lastLine(); i++) {
            const l = cm.getLine(i);
            if (PAGE_HEADING.test(l) && !S.blocks.some((b) => b.lang && i >= b.start && i <= b.end)) return cleanHeading(l);
        }
        return null;
    }
    const p = S.pages[k];
    if (!p) return null;
    // (gardé tant que les cellules de la page ne changent pas)
    if (p.headCells !== p.cells) {
        p.headCells = p.cells;
        const c = (p.cells || []).find((x) => (x.type !== "code" || x.lang === "markdown") && x.source.split("\n").some((l) => PAGE_HEADING.test(l)));
        p.head = c ? cleanHeading(c.source.split("\n").find((l) => PAGE_HEADING.test(l))) : null;
    }
    return p.head;
}

/** Le nom d'une page : son premier titre, sinon son fichier, sinon « Page 2 » */
function pageName(k) {
    const h = headingOf(k);
    if (h) return h;
    const file = S.pages[k]?.path;
    return file ? titleOfStem(file.slice(file.lastIndexOf("/") + 1)) : `Page ${k + 1}`;
}

// Une page s'appelle comme son titre : « # Budget 2024 » → Budget-2024.md ; et inversement (mv Bilan.md : « # Bilan »)
const stemOfTitle = (t) => t.replace(/[/\\:*?"<>|#`[\]]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
const titleOfStem = (f) => f.replace(/\.md$/, "").replace(/-/g, " ").trim();
const dirOf = (p) => (p && p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Le fichier d'une page sans titre : « page-3.md », unique dans son dossier */
function pathFor(k, dir = "") {
    const taken = new Set(S.pages.map((p) => p.path).filter(Boolean));
    const stem = stemOfTitle(headingOf(k) || "") || `page-${k + 1}`;
    const at = (n) => `${dir ? dir + "/" : ""}${stem}${n > 1 ? "-" + n : ""}.md`;
    let n = 1;
    while (taken.has(at(n))) n++;
    return at(n);
}
function ensurePaths() { S.pages.forEach((p, k) => { if (!p.path) p.path = pathFor(k); }); }

/** Les fichiers suivent les titres (dans leur dossier ; deux titres pareils : Calculs.md, Calculs-2.md) */
function syncPaths() {
    ensurePaths();
    const want = S.pages.map((_, k) => stemOfTitle(headingOf(k) || "") || null);
    const taken = new Set(S.pages.filter((_, k) => !want[k]).map((p) => p.path));
    S.pages.forEach((p, k) => {
        if (!want[k]) return;
        const dir = dirOf(p.path);
        const at = (n) => `${dir ? dir + "/" : ""}${want[k]}${n > 1 ? "-" + n : ""}.md`;
        const stem = at(1).slice(0, -3).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let path = new RegExp(`^${stem}(-\\d+)?\\.md$`).test(p.path) && !taken.has(p.path) ? p.path : null;
        for (let n = 1; !path; n++) if (!taken.has(at(n))) path = at(n);
        p.path = path;
        taken.add(path);
    });
}

/** Donner un titre à une page : son premier titre change (ou un titre s'ajoute en tête) */
function setHeading(k, title) {
    if (k === S.page) {
        for (let i = 0; i <= cm.lastLine(); i++) {
            const l = cm.getLine(i);
            if (!PAGE_HEADING.test(l) || S.blocks.some((b) => b.lang && i >= b.start && i <= b.end)) continue;
            cm.replaceRange(title, Pos(i, /^#+\s+/.exec(l)[0].length), Pos(i, l.length), "+terminal");
            return;
        }
        cm.replaceRange(`# ${title}\n\n`, Pos(0, 0), Pos(0, 0), "+terminal");
        return;
    }
    const p = S.pages[k], cells = JSON.parse(JSON.stringify(p.cells || []));
    const c = cells.find((x) => (x.type !== "code" || x.lang === "markdown") && x.source.split("\n").some((l) => PAGE_HEADING.test(l)));
    if (c) { const lines = c.source.split("\n"), j = lines.findIndex((l) => PAGE_HEADING.test(l)); lines[j] = lines[j].replace(/^(#+\s+).*$/, `$1${title}`); c.source = lines.join("\n"); }
    else cells.unshift(newCell("markdown", "markdown", `# ${title}`));
    p.cells = cells;
}

/** La page qu'on lit, rangée avant d'en ouvrir une autre */
function snapPage() {
    const p = S.pages[S.page];
    p.cells = toNotebook().cells;
    p.hist = cm.getHistory();
    p.cur = cm.getCursor();
    p.top = cm.getScrollInfo().top;
}

function openPage() {
    const p = S.pages[S.page];
    const opening = S.opening;
    S.opening = true;   // (un document reçu par lien le reste)
    try { showCells(p.cells || []); } finally { S.opening = opening; }
    if (p.hist) cm.setHistory(p.hist);
    if (p.cur) cm.setCursor(p.cur);
    if (p.top != null) cm.scrollTo(null, p.top);
    renderPages();
    cm.focus();
}

/**
 * Changer de page, à l'écran : une image de la page qu'on quitte glisse et s'efface d'un côté pendant que la
 * nouvelle arrive de l'autre (dir : 1 vers la suivante, -1 vers la précédente).
 */
function pageTransition(dir, work) {
    const canvas = $(".canvas"), sheet = $(".sheet", canvas);
    if (!sheet.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) { work(); return; }
    for (const g of canvas.querySelectorAll(".page-ghost")) g.remove();
    const top = $(".CodeMirror-scroll", sheet)?.scrollTop || 0;
    const ghost = sheet.cloneNode(true);
    ghost.classList.add("page-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
    ghost.querySelectorAll("textarea, input").forEach((e) => { e.tabIndex = -1; });
    canvas.append(ghost);
    const gs = $(".CodeMirror-scroll", ghost);
    if (gs) gs.scrollTop = top;
    work();
    const ease = "cubic-bezier(.16, 1, .3, 1)";
    ghost.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${-dir * 7}%) scale(.965)`, opacity: 0 }], { duration: 340, easing: ease, fill: "forwards" })
        .finished.then(() => ghost.remove(), () => ghost.remove());
    sheet.animate([{ transform: `translateX(${dir * 7}%) scale(.985)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 460, easing: ease })
        .finished.then(() => cm.refresh(), () => {});
}

function switchPage(k, dir = Math.sign(k - S.page)) {
    if (k >= 0 && k < S.pages.length && term?.isOpen) term.close({ quiet: k !== S.page });
    if (deck || k === S.page || k < 0 || k >= S.pages.length) return;
    pageTransition(dir, () => {
        snapPage();
        S.page = k;
        openPage();
    });
}

function stepPage(dir) {
    if (S.pages.length < 2) { toast(`Une seule page : Ctrl ${ALT} N (ou /page) en ajoute une`); return; }
    switchPage((S.page + dir + S.pages.length) % S.pages.length, dir);
}

function newPage() {
    if (deck) return;
    if (S.link?.ro) { toast("Document en lecture seule"); return; }
    const name = `Page ${S.pages.length + 1}`;
    pageTransition(1, () => {
        snapPage();
        S.pages.splice(S.page + 1, 0, { cells: [newCell("markdown", "markdown", `# ${name}`)] });
        S.page++;
        S.pages[S.page].path = pathFor(S.page, term?.cwd || "");
        openPage();
        cm.setSelection(Pos(0, 2), Pos(0, 2 + name.length));   // le titre, prêt à être remplacé
    });
    toast(`Nouvelle page : Ctrl ${ALT} → ← pour passer de l'une à l'autre`);
}

function closePage(k = S.page) {
    if (S.pages.length < 2) { toast("C'est la seule page du document"); return; }
    if (S.link?.ro) { toast("Document en lecture seule"); return; }
    if (!confirm(`Supprimer la page « ${pageName(k)} » ? (le document d'avant reste dans /versions)`)) return;
    keepHistory(true);
    if (k === S.page) {
        pageTransition(k < S.pages.length - 1 ? 1 : -1, () => {
            S.pages.splice(k, 1);
            S.page = Math.min(k, S.pages.length - 1);
            openPage();
        });
    } else {
        snapPage();
        S.pages.splice(k, 1);
        if (k < S.page) S.page--;
        readOtherPages();
        decorate();
        renderPages();
        persist(true);
    }
}

/** La page ouverte, dans la barre d'état (à partir de deux pages) : un clic donne la liste des pages */
function renderPages() {
    const box = $("#st-pages");
    if (!box) return;
    syncPaths();
    const key = `${S.page}|${S.pages.length}|${S.pages.length > 1 ? pageName(S.page) : ""}`;
    if (key === S.pagesKey) return;
    S.pagesKey = key;
    box.hidden = S.pages.length < 2;
    if (box.hidden) return;
    const n = pageName(S.page);
    box.innerHTML = `<button type="button" class="st-page on" data-menu="1" title="Les pages (Ctrl ${ALT} → ← : la suivante, la précédente)">${esc(n.length > 32 ? n.slice(0, 31) + "…" : n)} <span class="st-page-n">${S.page + 1}/${S.pages.length}</span></button>`;
}
function pagesMenu() {
    if ($(".menu.pages-menu")) { $(".menu.pages-menu").remove(); return; }
    const menu = document.createElement("div");
    menu.className = "menu pages-menu";
    menu.innerHTML = S.pages.map((p, k) => `<button type="button" data-k="${k}" class="${k === S.page ? "on" : ""}">${esc(pageName(k))}<small>${esc(p.path?.includes("/") ? p.path.slice(0, p.path.lastIndexOf("/") + 1) : "")}</small></button>`).join("")
        + `<button type="button" data-add="1">+ Nouvelle page<small>Ctrl ${ALT} N</small></button>`;
    document.body.append(menu);
    const r = $("#st-pages").getBoundingClientRect();
    Object.assign(menu.style, { left: `${Math.max(8, r.left)}px`, bottom: `${innerHeight - r.top + 6}px` });
    const close = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!menu.contains(e.target) && !e.target.closest("#st-pages")) close(); };
    setTimeout(() => addEventListener("pointerdown", outside, true));
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        close();
        if (b.dataset.add) newPage(); else if (+b.dataset.k !== S.page) switchPage(+b.dataset.k);
        cm.focus();
    });
    menu.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}
$("#st-pages").addEventListener("mousedown", (e) => e.preventDefault());   // l'éditeur garde le curseur
$("#st-pages").addEventListener("click", (e) => { if (e.target.closest("button")) pagesMenu(); });
addEventListener("keydown", (e) => {
    if (deck) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); e.stopPropagation(); stepPage(e.shiftKey ? -1 : 1); }
    // (sur iPad : Ctrl ⌘ → ←, Ctrl ⌘ N)
    else if ((cmdForAlt ? e.ctrlKey && e.metaKey : mod && e.altKey) && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); e.stopPropagation(); stepPage(e.key === "ArrowRight" ? 1 : -1); }
    else if ((cmdForAlt ? e.ctrlKey && e.metaKey : mod && e.altKey) && e.code === "KeyN") { e.preventDefault(); e.stopPropagation(); newPage(); }
    else if (e.ctrlKey && !e.altKey && e.code === "Backquote") { e.preventDefault(); e.stopPropagation(); term.toggle(); }
}, true);

// ---------------------------------------------------------------- terminal
// (terminal.js) Il prend la place de l'éditeur : les pages y sont des fichiers, rangés dans des dossiers (ls, tree,
// mkdir, touch, cat, rm, mv…). Ctrl ` (ou /terminal, ou >_ dans la barre d'état) passe de l'un à l'autre.

const pageAt = (path) => S.pages.findIndex((p) => p.path === path);

/** Les définitions en français des pages du document (« Pour archiver une page, … ») : le terminal les connaît */
function docDefinitions() {
    const all = [];
    S.pages.forEach((p, k) => {
        let fence = false;
        for (const l of (k === S.page ? cm.getValue() : cellsText(p.cells || [])).split("\n")) {
            if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
            if (!fence && l.includes("_")) for (const ph of phrasesIn(l)) all.push(ph.text);
        }
    });
    const key = all.join("\u0001");
    if (key !== docDefinitions.key) {
        docDefinitions.key = key;
        let read = [];
        // (lues avec les actions du terminal, qu'elles peuvent appeler)
        try { read = readDocument([...TERM_ACTIONS, ...all]).slice(TERM_ACTIONS.length); } catch { /* une phrase illisible : sans les définitions */ }
        docDefinitions.list = all.filter((_, k) => ["define", "class"].includes(read[k]?.ast?.type));
    }
    return docDefinitions.list;
}
const writable = () => { if (S.link?.ro) throw new Error("document en lecture seule"); };
/** Après un changement des pages : ce qu'elles s'apportent, les onglets, l'enregistrement */
function pagesChanged() {
    readOtherPages();
    decorate();
    renderPages();
    persist(true);
}

var term = new Terminal({
    files: () => (ensurePaths(), S.pages).map((p, k) => ({ path: p.path, title: pageName(k), current: k === S.page, lines: (k === S.page ? cm.getValue() : cellsText(p.cells || [])).replace(/\n+$/, "").split("\n").length })),
    dirs: () => S.dirs,
    setDirs(dirs) {
        const next = [...new Set(dirs)].sort();
        if (next.join("\n") === S.dirs.join("\n")) return;
        writable();
        S.dirs = next;
        persist(true);
    },
    read: (path) => { const k = pageAt(path); return k === S.page ? cm.getValue() : cellsText(S.pages[k].cells || []); },
    write(path, text, append) {
        writable();
        const k = pageAt(path), p = S.pages[k];
        if (k === S.page) {
            const end = Pos(cm.lastLine(), cm.getLine(cm.lastLine()).length);
            if (append) cm.replaceRange((cm.getValue().endsWith("\n") || !cm.getValue() ? "" : "\n") + text, end, end, "+terminal");
            else cm.replaceRange(text, Pos(0, 0), end, "+terminal");
        } else p.cells = append ? [...(p.cells || []), ...textToCells(text)] : textToCells(text);
        pagesChanged();
    },
    create(path, text) {
        writable();
        // une page vide (touch) prend le titre de son nom : touch Budget.md → « # Budget »
        const name = path.slice(path.lastIndexOf("/") + 1);
        S.pages.push({ cells: textToCells(text.trim() ? text : `# ${titleOfStem(name)}\n`), path: /\.md$/.test(name) ? path : path + ".md" });
        pagesChanged();
    },
    remove(paths) {
        writable();
        const gone = new Set(paths);
        if (S.pages.every((p) => gone.has(p.path))) return "le document garde au moins une page";
        keepHistory(true);   // (le document d'avant reste dans /versions)
        snapPage();
        const cur = S.pages[S.page], keep = S.pages.filter((p) => !gone.has(p.path));
        if (keep.includes(cur)) { S.pages = keep; S.page = keep.indexOf(cur); pagesChanged(); return null; }
        const at = Math.min(S.page, keep.length - 1);
        pageTransition(1, () => { S.pages = keep; S.page = at; openPage(); });
        return null;
    },
    move(pairs) {
        writable();
        // un nouveau nom : le titre de la page le prend (mv Calculs.md Bilan.md → « # Bilan »)
        const name = (p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
        const moved = [];
        for (const [from, to] of pairs) {
            const k = pageAt(from);
            if (k < 0) continue;
            const oldTitle = pageName(k);
            S.pages[k].path = /\.md$/.test(to) ? to : to + ".md";
            if (name(from) !== name(to)) setHeading(k, titleOfStem(name(to)));
            moved.push([from, null, oldTitle, k]);
        }
        syncPaths();
        // les liens vers ces pages suivent (leur nouveau chemin, après que le titre a donné le nom du fichier)
        relink(moved.map(([from, , oldTitle, k]) => [from, S.pages[k].path, oldTitle]));
        pagesChanged();
    },
    copy(pairs) {
        writable();
        snapPage();
        for (const [from, to] of pairs) {
            const src = S.pages[pageAt(from)], cells = JSON.parse(JSON.stringify(src.cells || []));
            const k = pageAt(to);
            if (k === S.page) { cm.setValue(cellsText(cells)); continue; }
            if (k >= 0) S.pages[k].cells = cells; else S.pages.push({ cells, path: /\.md$/.test(to) ? to : to + ".md" });
            // la copie s'appelle comme son fichier (cp Calculs.md Essai.md → « # Essai »)
            const nk = k >= 0 ? k : S.pages.length - 1, name = (p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "");
            if (name(from) !== name(to)) setHeading(nk, titleOfStem(name(to)));
        }
        pagesChanged();
    },
    open(path, line = 0) {
        const k = pageAt(path);
        if (k === S.page) term.swap($(".canvas .sheet"), null, -1); else switchPage(k);
        // open fichier 12, ou un clic sur une ligne de grep -n : le curseur sur la ligne
        if (line) setTimeout(() => { const n = Math.min(line - 1, cm.lastLine()); cm.setCursor(Pos(n, 0)); cm.scrollIntoView(Pos(n, 0), 120); }, 30);
        cm.focus();
    },
    focus: () => cm.focus(),
    // une phrase en français : avec les actions du terminal, les définitions des pages et celles tapées au terminal
    phrase(text, memo) {
        ensurePaths();
        const pages = S.pages.map((p, k) => {
            const body = k === S.page ? cm.getValue() : cellsText(p.cells || []);
            return { $fiche: { nom: p.path.slice(p.path.lastIndexOf("/") + 1), titre: pageName(k), dossier: dirOf(p.path), chemin: p.path, lignes: body.replace(/\n+$/, "").split("\n").length, ouverte: k === S.page } };
        });
        const values = { ...kernel.junction.values("terminal"), pages, dossiers: [...term.dirs()].sort(), dossier_courant: "/" + term.cwd, fichier_ouvert: S.pages[S.page].path, arborescence: "⟦tree⟧" };
        const ext = externalData(values, {});
        const texts = [...TERM_ACTIONS, ...docDefinitions(), ...memo, text];
        const read = readDocument(texts, new Map(), ext), r = read[read.length - 1];
        const translated = r.translated?.text;
        if (r.error) return { error: r.error.msg, translated };
        const out = runDocument(read, ext).results[read.length - 1] || {};
        if (out.fault) return { error: out.fault.msg, lines: out.lines, translated };
        const kind = r.ast?.type;
        return { lines: out.lines || [], translated, kind, keep: ["define", "class", "assign"].includes(kind) };
    },
}, { store: prefs, host: $(".canvas"), under: $(".canvas .sheet") });
$("#st-term").addEventListener("mousedown", (e) => e.preventDefault());
$("#st-term").addEventListener("click", () => term.toggle());

// ---------------------------------------------------------------- clavier, souris, fichiers

addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === "s") { e.preventDefault(); saveIpynb(); }
    else if (mod && k === "o") { e.preventDefault(); $("#open-file").click(); }
    else if (mod && e.shiftKey && e.key === "Enter") { e.preventDefault(); runAll(); }
    else if (e.key === "F5" && !mod && !deck) { e.preventDefault(); startDeck({ line: e.shiftKey ? cm.getCursor().line : null }); }
});

// Pendant la frappe, l'interface s'efface ; un mouvement de souris la rappelle
let calmAt = null;
addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey && e.target.closest?.(".CodeMirror")) document.body.classList.add("calm"); }, true);
addEventListener("pointermove", (e) => {
    if (calmAt && Math.hypot(e.screenX - calmAt[0], e.screenY - calmAt[1]) > 8) document.body.classList.remove("calm");
    calmAt = [e.screenX, e.screenY];
});

$("#st-lang").addEventListener("mousedown", (e) => { e.preventDefault(); langMenu(); });
// Au doigt, pas de Maj Entrée : le bouton ▶ de la barre d'état exécute le bloc du curseur
$("#st-run").addEventListener("pointerdown", (e) => e.preventDefault());   // le clavier virtuel reste ouvert
$("#st-run").addEventListener("click", () => { const b = blockAt(); if (b) runBlock(b.open, { live: true }); });
// Au doigt, pas de survol : toucher un mot souligné (erreur, lecture discutable) affiche son message
cm.getWrapperElement().addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const m = e.target.closest?.(".lx-m-bad, .lx-m-doubt, .lx-m-sense, .lx-m-data");
    if (m?.title) toast(m.title, { ms: 5000 });
});
$("#open-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ""; });
$("#upload-file").addEventListener("change", (e) => { for (const f of e.target.files) uploadToMachine(f); e.target.value = ""; });
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); document.body.classList.add("dropping"); } });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
addEventListener("drop", (e) => {
    if (e.defaultPrevented || !e.dataTransfer.files.length) return;   // une image déposée sur le texte y est déjà insérée
    e.preventDefault();
    document.body.classList.remove("dropping");
    for (const f of e.dataTransfer.files) (/\.(ted|ipynb|md|markdown)$/i.test(f.name) ? openFile(f) : uploadToMachine(f));
});
addEventListener("beforeunload", () => persist(true));
// L'onglet passe en arrière-plan (ou se ferme) : une version et l'annulation se rangent tout de suite
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { persist(true); keepHistory(true); } });
// La marge de gauche suit la largeur de la fenêtre
addEventListener("resize", () => cm.refresh());

// ---------------------------------------------------------------- démarrage

applyTheme();
const startId = new URLSearchParams(location.search).get("nb");
const initial = (startId === "analyse" && dataTour()) || (startId === "article" && article()) || (startId === "presentation" && presentation()) || (startId === "bienvenue" && welcome()) || (startId === "iris" && irisProject()) || (startId === "langue" && langueArticle()) || (library.current() && library.load(library.current())) || welcome();
// Un document reçu par lien s'ouvre à la place du sien ; la machine attend qu'on lance un bloc
if (!(hasLink() && await openLink())) {
    loadNotebook(initial);
    restoreUndo();
    kernel.start().catch(() => {});
} else S.undoReady = true;
cm.focus();
setTimeout(() => dispatchEvent(new Event("textedit-ready")), 0);
// L'écran d'ouverture reste le temps que « TextEdit » s'écrive et que les polices arrivent
// Une police qui arrive après coup (KaTeX, les fontes du code) change la taille des lignes et des formules :
// l'éditeur les remesure, sinon le curseur se dessine à côté de l'endroit où l'on écrit
for (const ev of ["keydown", "mousedown", "touchstart"]) cm.getWrapperElement().addEventListener(ev, () => { S.touched = true; }, { once: true, passive: true });
document.fonts?.addEventListener("loadingdone", () => { clearTimeout(S.fontTimer); S.fontTimer = setTimeout(() => cm.refresh(), 50); });
Promise.all([window.splashTyped, Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2500))])]).then(() => {
    splashOut(0);
    // un document reçu par lien : l'accueil dit d'abord ce qu'il contient (toujours, même si on l'a écarté)
    if (S.link && hasLink()) setTimeout(() => openHome("link"), 380);
    // l'accueil, sauf pour un document ouvert directement (?nb=, fichier ouvert depuis le système) ou si on l'a écarté
    // (pas si l'on a déjà commencé à écrire ou cliqué dans le document : il ne vient pas se mettre devant)
    else if (!hasLink() && !startId && !S.link && prefs.get("home", true) !== false && !("launchQueue" in window && new URLSearchParams(location.search).has("ted"))) setTimeout(() => { if (!S.touched) openHome(); }, 380);
    if (S.autoDeck) { S.autoDeck = false; setTimeout(() => startDeck(), 350); }
});
// ---------------------------------------------------------------- le clavier virtuel (téléphone, tablette)
// Android redimensionne la page (interactive-widget=resizes-content) ; iOS pose le clavier par-dessus. La place qu'il
// prend (visualViewport) devient --kb : la page d'écriture s'arrête au-dessus de lui, la barre d'état s'efface le
// temps de la frappe, et la ligne qu'on écrit reste visible.
const fullHeight = new Map();   // largeur de la fenêtre -> sa plus grande hauteur (sans clavier ; tourner l'écran change la largeur)
function fitKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const full = Math.max(fullHeight.get(innerWidth) || 0, innerHeight);
    fullHeight.set(innerWidth, full);
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    const typing = cm.hasFocus() || !!document.activeElement?.closest?.(".CodeMirror");
    // iOS : le clavier recouvre la page (kb) ; Android : la page rétrécit (la fenêtre bien moins haute que l'écran)
    const open = typing && (kb > 80 || (matchMedia("(pointer: coarse)").matches && innerHeight < full * 0.75));
    document.documentElement.style.setProperty("--kb", `${kb}px`);
    if (open !== document.body.classList.contains("kb-open")) {
        document.body.classList.toggle("kb-open", open);
        cm.refresh();
    }
    if (open) requestAnimationFrame(() => cm.scrollIntoView(null, 48));
}
window.visualViewport?.addEventListener("resize", fitKeyboard);
addEventListener("resize", fitKeyboard);
window.visualViewport?.addEventListener("scroll", fitKeyboard);
cm.on("focus", () => setTimeout(fitKeyboard, 350));
cm.on("blur", () => setTimeout(fitKeyboard, 350));
fitKeyboard();   // (la hauteur de la fenêtre sans clavier)

// ---------------------------------------------------------------- l'accueil, le hors ligne, les fichiers .ted (home.js)

// Une fenêtre (dialog) qui se ferme rend le focus au champ de l'éditeur, qui pour Chrome ne l'avait jamais perdu : la
// sélection du document, elle, reste ailleurs (sur un bouton de la barre d'état), et plus aucune touche ne s'écrit —
// un clic dans le texte n'y change rien, le champ ayant déjà le focus. On le lui reprend, puis on le lui rend.
function refocusEditor() {
    const field = cm.getInputField();
    if (document.activeElement !== field && document.activeElement !== document.body) return;
    field.blur();
    cm.focus();
}
for (const d of document.querySelectorAll("dialog")) d.addEventListener("close", () => setTimeout(refocusEditor, 0));
const home = setupHome({ S, cm, kernel, prefs, $, toast, snapPage, pageName, dirOf, cellsText, frontMatter, isDeck, LANGS, htmlHasCode,
    replaceDocument, loadText, loadNotebook, examples: { iris: irisProject, welcome, presentation, article }, openLink, hasLink, openFile });
function openHome(focus) { home.open(focus); }

$("#sc-about").addEventListener("click", (e) => { e.preventDefault(); $("#shortcuts").close(); $("#about").showModal(); });
$("#st-present").addEventListener("click", () => startDeck({ line: cm.getCursor().line }));
// le terminal se rouvre s'il l'était
if (prefs.get("term.open", false)) term.open();

// ---------------------------------------------------------------- Cubi (cubi.js) : l'IA locale de Web-Agentic-Model
const cubi = setupCubi({ cm, getTitle: () => S.title, toast, esc });

// ---------------------------------------------------------------- /pdf et /copier (print.js) : en dernier, quand tout ce qu'il emprunte existe
const printer = setupPrint({ S, WIKI, applyTheme, blockSource, cm, getDeck: () => deck, deckEnv, dirOf, docParts, ensurePaths, esc, fileName, headings, katexHtml,
    linkTarget, linkTargetPath, pageName, phraseSpans, renderInline, renderPages, sciValues, showCells, snapPage, term, toast, when, mathActions });

// ---------------------------------------------------------------- le document réactif (reactive.js) et ses curseurs

/** Le curseur d'une phrase : on le fait glisser, la valeur s'écrit dans le texte au relâcher (la phrase la relit, la
 *  jonction la donne aux blocs, et ce qui la lit se recalcule) ; la valeur s'affiche pendant qu'on glisse. */
function sliderWidget(handle, phraseFrom, q, sl) {
    const box = document.createElement("span");
    box.className = "lx-slider";
    box.title = `de ${sl.min} à ${sl.max}, par ${sl.step} — glisser, ou flèches ; cliquer sur la valeur pour l'écrire`;
    const input = Object.assign(document.createElement("input"), { type: "range", min: sl.min, max: sl.max, step: sl.step, value: sl.value });
    input.setAttribute("aria-label", "valeur");
    const out = document.createElement("output");
    // 7 plutôt que 7.0, 7,5 en français (7.5 si le document écrit ses décimales avec un point)
    const fmt = (v) => { let t = Number(v).toFixed(sl.decimals); if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, ""); return sl.dot ? t : t.replace(".", ","); };
    const show = (v) => { out.textContent = fmt(v); box.style.setProperty("--p", `${((v - sl.min) / (sl.max - sl.min || 1)) * 100}%`); };
    show(sl.value);
    const write = () => {
        const n = cm.getLineNumber(handle);
        if (n == null) return;
        const line = cm.getLine(n);
        const ph = phrasesIn(line).find((x) => x.from === phraseFrom) || phrasesIn(line).find((x) => x.sliders);
        const cur = ph?.sliders?.[q];
        if (!cur) return;
        const text = out.textContent;
        if (text === cur.text) return;
        // la valeur seule, dans les accolades : {650, de 400 à 1500} → {700, de 400 à 1500}
        const start = ph.from + 1 + cur.from + line.slice(ph.from + 1 + cur.from).indexOf(cur.text);
        cm.replaceRange(text, Pos(n, start), Pos(n, start + cur.text.length), "+curseur");
    };
    input.addEventListener("input", () => show(input.value));
    input.addEventListener("change", write);
    for (const ev of ["mousedown", "pointerdown", "touchstart", "click"]) box.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    // un clic sur la valeur : la ligne s'ouvre à l'écriture, le curseur de l'éditeur sur le nombre
    out.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const n = cm.getLineNumber(handle);
        if (n != null) { cm.focus(); cm.setCursor(Pos(n, phraseFrom + 2 + sl.from)); }
    });
    box.append(input, out);
    return box;
}

// Actif si l'en-tête le dit (« réactif: oui » / « non »), sinon dès qu'une phrase du document a un curseur
function reactiveOn() {
    const fm = frontMatter(cm.getValue().split("\n", 61));
    const said = fm?.fields?.["réactif"] ?? fm?.fields?.reactif ?? fm?.fields?.reactive;
    if (said != null && String(said).trim()) return /^(oui|yes|true|vrai|1|on)/i.test(String(said).trim());
    const texts = [cm.getValue(), ...S.pages.filter((_, k) => k !== S.page).map((p) => cellsText(p.cells || []))];
    return texts.some((t) => t.includes("{") && t.split("\n").some((l) => l.includes("_") && phrasesIn(l).some((p) => p.sliders)));
}
const reactive = createReactive({
    depEntries, symbols, DEP_LANGS, kernel, diag,
    isGui: (code) => GUI.test(code),
    isPage: (lang) => languageOf(lang).engine === "page",
    enabled: reactiveOn,
    run: (e) => (e.page === S.page ? runBlock(e.open, { deps: false, reactive: true }) : runElsewhere(e)),
    stale: (e, why) => { if (e.page === S.page && e.open) setStatus(stateOf(e.open), `à relancer : ${why}`, "wait"); },
    status: () => {},
});

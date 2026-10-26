// TextEdit — reconnaître du code collé et son langage.
//
// Un collage dans le texte devient un bloc de code quand il en est un : le presse-papiers le dit parfois
// (VS Code donne le langage, une page web le met dans la classe de son <pre>), sinon des indices pondérés
// départagent les langages. De la prose, une liste ou du Markdown ne sont jamais emballés.

// Indices par langage : [motif, poids]. Un motif compte une fois ; les plus parlants pèsent 5 et plus.
const CLUES = {
    python: [
        [/^\s*def \w+\s*\(.*\)\s*(->\s*[\w\[\], .]+)?:\s*$/m, 6], [/^\s*class \w+(\(.*\))?:\s*$/m, 6],
        [/^\s*(import [\w.]+(\s+as \w+)?|from [\w.]+ import .+)\s*$/m, 5], [/\bself\b/, 3], [/\bprint\(/, 3],
        [/\b(elif|None|True|False|lambda|nonlocal)\b/, 2], [/^\s*(if|for|while|with|try|except|else)\b.*:\s*$/m, 3],
        [/\bf"[^"]*\{|\bf'[^']*\{/, 3], [/^\s*@\w+/m, 1], [/^\s*#(?!include|!|\s*define)/m, 1],
        [/;\s*$/m, -2], [/\{\s*$/m, -3],
    ],
    javascript: [
        [/\b(const|let|var)\s+[\w${}\[\], ]+\s*=/, 4], [/=>/, 3], [/\bfunction\s*\w*\s*\(/, 4], [/console\.\w+\(/, 6],
        [/\b(document|window)\.\w+/, 4], [/===|!==/, 3], [/\brequire\(['"]|^\s*import .+ from ['"]|^\s*export (default |const |function )/m, 5],
        [/\b(async|await)\b/, 1], [/;\s*$/m, 1], [/\bdef \w+\(|^\s*import \w+\s*$/m, -4],
    ],
    java: [
        [/\bpublic\s+(static\s+)?(final\s+)?(class|void|interface|enum)\b/, 6], [/System\.(out|err)\.print/, 7],
        [/\bString\[\]\s*\w+/, 4], [/\b(private|protected|public)\s+[\w<>\[\]]+\s+\w+\s*[;=(]/, 4], [/@Override\b/, 5],
        [/^\s*import java\.|^\s*package [\w.]+;/m, 7], [/\bnew \w+(<.*>)?\(/, 1],
    ],
    cpp: [
        [/#include\s*<(iostream|vector|string|map|set|algorithm|memory|fstream|sstream|unordered_map)>/, 7],
        [/\bstd::/, 5], [/\b(cout|cin|cerr)\s*(<<|>>)/, 6], [/\busing namespace std\b/, 7], [/\btemplate\s*</, 4],
        [/\b(nullptr|constexpr|auto&?)\b/, 2],
    ],
    c: [
        [/#include\s*<(stdio|stdlib|string|math|stdint|stdbool|unistd)\.h>/, 7], [/\b(printf|scanf|fprintf|malloc|free)\s*\(/, 4],
        [/\bint\s+main\s*\(/, 3], [/\w->\w/, 1], [/\b(struct|typedef)\b/, 1],
    ],
    sh: [
        [/^#!\s*\/(usr\/)?bin\/(env\s+)?(ba|z|da)?sh/m, 9],
        [/^\s*(sudo\s+)?(echo|cd|ls|cat|grep|export|mkdir|rm|cp|mv|chmod|chown|apt(-get)?|pip3?|npm|git|curl|wget|tar|find|sed|awk|source|docker|python3?|make)\b[^(=]*$/m, 4],
        [/^\$ \S/m, 5], [/\b(fi|done|esac)\s*$/m, 4], [/;\s*(then|do)\s*$/m, 4], [/\$\{?\w+\}?/, 1], [/\s\|\s*\w+/, 1], [/\s&&\s/, 1],
    ],
    sql: [
        [/\bSELECT\b[\s\S]+?\bFROM\b/i, 7], [/\b(INSERT\s+INTO|CREATE\s+(TABLE|VIEW|INDEX)|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE)\b/i, 7],
        [/\b(WHERE|GROUP\s+BY|ORDER\s+BY|JOIN|VALUES|PRIMARY\s+KEY|LIMIT)\b/i, 2],
    ],
    html: [
        [/^\s*<(!DOCTYPE|html|head|body|div|p|span|ul|ol|li|table|section|article|nav|header|footer|main|form|button|h[1-6]|a\s|img|script|style|link|meta)\b/im, 6],
        [/<\/(div|p|span|li|a|h[1-6]|section|body|html|button|table)>/i, 3], [/\s(class|id|href|src|style)="/, 2],
    ],
    latex: [[/\\(begin|end)\{\w+\*?\}/, 6], [/\\(frac|sum|int|sqrt|alpha|beta|gamma|mathbb|left|right|cdot)\b/, 3], [/^\s*\$\$/m, 3]],
    mermaid: [[/^\s*(graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/m, 9], [/^\s*(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|mindmap)\b/m, 9]],
    tcl: [[/^\s*proc \w+ \{.*\} \{/m, 7], [/\[expr\s/, 5], [/^\s*(set \w+ |puts )/m, 3], [/^\s*foreach \w+ /m, 2]],
    scheme: [[/^\s*\((define|lambda|let\*?|display|letrec|cond)\b/m, 6], [/\)\)\)\s*$/m, 2]],
    awk: [[/^\s*(BEGIN|END)\s*\{/m, 7], [/\$(NF|NR|[0-9])\b/, 2], [/\bprint \$\d/, 4], [/-F\s*['"]?\S/, 2]],
    cobol: [[/\b(IDENTIFICATION|PROCEDURE|DATA|ENVIRONMENT)\s+DIVISION\b/i, 9], [/^\s*(PERFORM|DISPLAY|MOVE)\s/m, 2], [/\bSTOP RUN\b/i, 5]],
    rust: [
        [/\bfn\s+\w+\s*(<[^>]*>)?\s*\([^)]*\)\s*(->\s*[\w<>&\[\], ]+)?\s*\{/, 7], [/\blet\s+mut\s+\w+/, 7], [/\bprintln!\(/, 8],
        [/\b(impl|trait|pub fn|match)\b/, 2], [/&mut\s|&'\w+|::new\(\)|\.unwrap\(\)/, 3], [/^\s*use std::/m, 7], [/\bvec!\[/, 6],
    ],
    go: [
        [/^\s*package\s+\w+\s*$/m, 7], [/\bfunc\s+(\(\w+ \*?\w+\)\s*)?\w+\s*\(/, 6], [/\bfmt\.(Print|Sprint|Fprint)\w*\(/, 8],
        [/:=/, 2], [/^\s*import\s+(\(|"[\w/]+")/m, 5], [/\b(go func|chan |defer |range )/, 3], [/\[\](int|string|float64|byte)\{/, 5],
    ],
    php: [
        [/<\?php\b/, 10], [/\$\w+\s*=[^=]/, 4], [/\becho\s+["'$]/, 4], [/\$\w+->\w+/, 4], [/\b(foreach\s*\(\s*\$\w+\s+as\b|function\s+\w+\s*\(\s*\$)/, 6],
        [/\b(array\(|implode\(|explode\(|isset\(|strlen\()/, 3],
    ],
};

// Les langages de VS Code et des pages web, vers ceux de TextEdit
const ALIASES = {
    py: "python", python3: "python", ipython: "python", js: "javascript", jsx: "javascript", ts: "javascript", typescript: "javascript",
    javascriptreact: "javascript", typescriptreact: "javascript", node: "javascript", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
    shellscript: "sh", shell: "sh", bash: "sh", zsh: "sh", console: "sh", shellsession: "sh", sqlite: "sql", mysql: "sql", postgresql: "sql",
    pgsql: "sql", plsql: "sql", tex: "latex", xml: "html", xhtml: "html", vue: "html", scm: "scheme", racket: "scheme", lisp: "scheme",
    gawk: "awk", cob: "cobol", md: "markdown", rs: "rust", golang: "go", text: null, plaintext: null, txt: null, plain: null,
};

/** Langage donné par le presse-papiers : VS Code (vscode-editor-data), ou la classe du <pre>/<code> d'une page web. */
export function clipboardLang(data) {
    let name = null, code = false;
    try {
        const vs = data.getData("vscode-editor-data");
        if (vs) { name = JSON.parse(vs).mode || null; code = !!name && !(name.toLowerCase() in ALIASES && ALIASES[name.toLowerCase()] === null); }
    } catch { /* pas de VS Code */ }
    const html = data.getData("text/html") || "";
    if (!name && html) {
        const m = /class="[^"]*?\b(?:language|lang|highlight-source|brush:)[-:\s]?([\w+#-]+)/i.exec(html) || /\bdata-lang(?:uage)?="([\w+#-]+)"/i.exec(html);
        if (m) name = m[1];
        // Le texte copié est-il tout entier dans un <pre> ? Alors c'est du code, même sans langage annoncé
        code = !!m || /^\s*(<meta[^>]*>\s*)?(<[^>]+>\s*)*<pre\b/i.test(html);
    }
    if (name) name = name.toLowerCase();
    return { name: name && name in ALIASES ? ALIASES[name] : name, code };
}

function scores(text) {
    const out = {};
    for (const [lang, clues] of Object.entries(CLUES)) out[lang] = clues.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0);
    // C++ englobe C : à égalité, les indices propres au C++ l'emportent ; sans eux, c'est du C
    if (out.cpp > 0 && out.c > 0) out.cpp > 4 ? (out.c -= 4) : (out.cpp -= 4);
    return out;
}

/** Une ligne de prose : des mots, une ponctuation de phrase, pas de symboles de code. */
const PROSE = /^[\p{Lu}\p{Ll}«"'(][^;{}=<>]*[\p{L}\d)»"'][.!?:…]?$/u;
const MARKDOWN = /^\s{0,3}(#{1,6}\s+\S|[-*+]\s+\S|\d+[.)]\s+\S|>\s?|\|.*\|\s*$|!\[|\[[^\]]+\]\()/;

/**
 * Le collage est-il du code, et de quel langage ? Rend { lang, info } (info : le nom à écrire après ```),
 * ou null pour un collage de texte. `hint` vient de clipboardLang.
 */
export function detectPaste(text, hint = {}, { known }) {
    const body = text.replace(/\s+$/, "");
    if (!body.trim() || /^\s*(```|~~~)/m.test(body) || /^\s*<svg[\s>]/i.test(body)) return null;
    const lines = body.split("\n").filter((l) => l.trim());
    // Le presse-papiers sait : on le croit (du Markdown reste du texte : c'est la langue du document)
    if (hint.name === "markdown") return null;
    if (hint.name) return { lang: known(hint.name) ? hint.name : null, info: hint.name };
    const sc = scores(body);
    const [best, top] = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
    if (hint.code) return { lang: top >= 2 ? best : null, info: top >= 2 ? best : "" };

    // Sinon, des indices : du Markdown ou de la prose restent du texte
    const md = lines.filter((l) => MARKDOWN.test(l)).length;
    const prose = lines.filter((l) => l.trim().split(/\s+/).length >= 5 && PROSE.test(l.trim())).length;
    if (md / lines.length > 0.5 && top < 7) return null;
    if (prose / lines.length >= 0.5 && top < 9) return null;
    // Des lignes qui ont l'allure du code : indentées, closes par ; { } : ( ), faites d'appels et d'affectations
    const shaped = lines.filter((l) => /^(\t| {2,})\S|[;{}:,(\[]\s*$|^\s*[)\]}]|\w\s*=\s*\S|\w\(.*\)/.test(l)).length / lines.length;
    if (lines.length === 1) {
        // Une seule ligne ne devient un bloc que si elle est franchement du code
        if (top >= 6 || (top >= 3 && shaped === 1 && !/[.!?]$/.test(body.trim()))) return { lang: best, info: best };
        return null;
    }
    if (top >= 6 || (top >= 3 && shaped >= 0.5) || shaped >= 0.75) return { lang: top >= 2 ? best : null, info: top >= 2 ? best : "" };
    return null;
}

/** Retire l'indentation commune (code copié depuis le milieu d'un fichier) et les lignes vides du bord. */
export function dedent(code) {
    const lines = code.replace(/\t/g, "    ").replace(/^\s*\n|\s+$/g, "").split("\n");
    const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
    return pad > 0 && pad < Infinity ? lines.map((l) => l.slice(pad)).join("\n") : lines.join("\n");
}

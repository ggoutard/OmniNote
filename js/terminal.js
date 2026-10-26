// terminal.js — un terminal, pour ranger l'espace de travail : il prend la place de l'éditeur (Ctrl `).
//
// Les pages du document y sont des fichiers (calculs.md), rangés dans des dossiers (projet/analyse/) : on les
// organise avec les commandes de base de Linux, et leurs messages sont ceux de coreutils en français.
//
//   help                      les commandes
//   ls [-l] [chemin…]         le contenu d'un dossier (les dossiers d'abord, la page ouverte marquée)
//   tree [chemin]             l'arborescence
//   cd [chemin], pwd          le dossier courant (/, .., ~)
//   mkdir [-p] dossier…       créer un dossier ; rmdir dossier… le supprimer (vide)
//   touch fichier…            créer une page vide (rien si elle existe)
//   cat fichier…              afficher une page ; echo texte [> fichier | >> fichier]
//   rm [-r] [-f] chemin…      supprimer des pages (ou un dossier et ce qu'il contient, avec -r)
//   mv source… cible          renommer (le titre de la page suit), déplacer ; cp [-r] source… cible  copier
//   grep [-i] [-n] motif [chemin…]   chercher dans les pages
//   open fichier              ouvrir la page dans l'éditeur
//   history [-c], !!, !n      les commandes tapées ; clear (Ctrl L) ; exit (revenir à l'éditeur)
//
// Les pages s'appellent comme leur titre (« # Budget 2024 » : Budget-2024.md). Les jokers * ? [ ] se développent
// comme dans bash (grep loyer *), les noms affichés se cliquent (une page s'ouvre, un dossier s'ouvre dans ls), et
// Tab complète les commandes et les chemins (aussi d'après le titre), ↑ ↓ parcourent l'historique, Ctrl C abandonne la ligne. « ; » et « && »
// enchaînent des commandes. Le terminal ne connaît le document que par env (voir app.js) :
//   env.files() → [{ path, title, current, lines }], env.dirs() → [chemin], env.read(path), env.write(path, texte, ajout),
//   env.create(path, texte), env.remove(paths) → erreur ou null, env.move([[de, vers]]), env.copy([[de, vers]]),
//   env.setDirs(dirs), env.open(path), env.save()

const COMMANDS = {
    help: "les commandes", ls: "lister un dossier", tree: "l'arborescence", cd: "changer de dossier", pwd: "le dossier courant",
    mkdir: "créer un dossier", rmdir: "supprimer un dossier vide", touch: "créer une page", cat: "afficher une page",
    rm: "supprimer des pages ou un dossier (-r)", mv: "renommer, déplacer", cp: "copier", echo: "écrire (> fichier, >> fichier)",
    grep: "chercher dans les pages (grep mot *)", open: "ouvrir une page dans l'éditeur (open fichier [ligne])", history: "les commandes tapées (-c : effacer)",
    phrases: "les définitions en français gardées (-c : les oublier)",
    clear: "effacer l'écran (Ctrl L)", exit: "revenir à l'éditeur",
};
const ALIASES = { ouvrir: "open", edit: "open", code: "open", nano: "open", vim: "open", vi: "open", aide: "help", dir: "ls", ll: "ls -l", cls: "clear", quit: "exit" };
const MAX_HISTORY = 500;

// ---------------------------------------------------------------- les phrases (Grama Lectica)
// Une ligne en français (« Crée le dossier «projet». », « Pour chaque page des pages, … », _…_) est une phrase :
// Grama Lectica la lit avec les actions du terminal (définies en français ci-dessous), les définitions des pages du
// document et celles tapées ici. Les actions du terminal affichent une ligne « ⟦commande⟧argument⟦⟧argument »,
// que le terminal exécute ; une page venue d'une boucle s'affiche avec ses champs, dont son chemin.

export const TERM_ACTIONS = [
    "Pour créer le dossier un nom, on affiche «⟦mkdir -p⟧» suivi du nom.",
    "Pour créer la page un nom, on affiche «⟦touch⟧» suivi du nom.",
    "Pour supprimer une page, on affiche «⟦rm⟧» suivi de la page.",
    "Pour supprimer le dossier un nom, on affiche «⟦rm -r⟧» suivi du nom.",
    "Pour déplacer une page et un dossier, on affiche «⟦mv⟧» suivi de la page suivi de «⟦⟧» suivi du dossier.",
    "Pour copier une page et un nom, on affiche «⟦cp⟧» suivi de la page suivi de «⟦⟧» suivi du nom.",
    "Pour renommer une page et un nom, on affiche «⟦ren⟧» suivi de la page suivi de «⟦⟧» suivi du nom.",
    "Pour ouvrir une page, on affiche «⟦open⟧» suivi de la page.",
    "Pour lire une page, on affiche «⟦cat⟧» suivi de la page.",
    "Pour écrire un texte et une page, on affiche «⟦write⟧» suivi du texte suivi de «⟦⟧» suivi de la page.",
    "Pour aller dans un dossier, on affiche «⟦cd⟧» suivi du dossier.",
    "Pour lister un dossier, on affiche «⟦ls⟧» suivi du dossier.",
    "Pour chercher un mot, on affiche «⟦grep -n⟧» suivi du mot.",
    "Pour montrer une chose, on affiche la chose.",
];
const PHRASE_CMDS = new Set(["mkdir -p", "touch", "rm", "rm -r", "mv", "cp", "ren", "open", "cat", "write", "cd", "ls", "grep -n", "tree"]);
const DESTRUCTIVE = new Set(["rm", "rm -r", "mv", "ren", "write", "cp"]);

/** « Supprime la page «a» », « Déplace «a» dans le dossier «b» » → « Supprime «a» », « Déplace «a» et «b» » */
// (« Crée la page «X» » reste : c'est l'action « créer la page »)
// (« Va dans «outils» » garde son « dans » : c'est l'action « aller dans »)
const GOING = /^\s*(?:aller|vas?|allez|allons|entre[rz]?|rentre[rz]?)\b/iu;
const tidy = (t) => {
    t = t.replace(/(^|[^\p{L}])((?!cr[ée]{2}r?\b)\p{L}+)\s+(?:la page|le fichier|la note)\s+(«[^»]*»)/giu, "$1$2 $3");
    return GOING.test(t) ? t.replace(/\s+(?:dans le dossier|vers le dossier|vers|en)\s+(«[^»]*»)/gi, " dans $1")
        : t.replace(/\s+(?:dans le dossier|vers le dossier|dans|vers|en)\s+(«[^»]*»)/gi, " et $1");
};

/** Les chemins écrits tels quels (« cours/ », « ../notes », « Projet-Iris.md ») : entre « », sinon la phrase les coupe */
const quotePaths = (t) => t.replace(/(«[^»]*»)|(^|\s)((?:\.{1,2}\/|\/)[\p{L}\p{N}_-]+(?:[\/.][\p{L}\p{N}_-]+)*\/?|\.\.?\/?|\/|[\p{L}\p{N}_-]+(?:[\/.][\p{L}\p{N}_-]+)*\/(?:[\p{L}\p{N}_-]+(?:[\/.][\p{L}\p{N}_-]+)*)?|[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*\.\p{L}[\p{L}\p{N}]*)(?=\s|[.?!]?$)/gu,
    (all, q, sp, path) => (q ? q : `${sp}«${path}»`));

/** « « iris » n'a pas encore de valeur » : le mot, tel qu'il est écrit dans la phrase, devient un texte («iris») */
function quoteWord(t, name) {
    const words = name.split(/[\s_]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(«[^»]*»)|(?<![\\p{L}\\p{N}_])(${words.join("[\\s_]+")}[\\p{L}\\p{N}_./-]*)(?![\\p{L}\\p{N}_])`, "giu");
    let done = false;
    return t.replace(re, (all, q, w) => (q || done ? all : ((done = true), `«${w.replace(/[.]$/, "")}»${w.endsWith(".") ? "." : ""}`)));
}

const NOENT = "Aucun fichier ou dossier de ce type";

/** « /a/b/../c » depuis cwd → « a/c » (la racine : « ») ; null si on remonte au-dessus de la racine */
export function resolvePath(cwd, p = "") {
    const parts = p.startsWith("/") || p.startsWith("~") ? [] : cwd ? cwd.split("/") : [];
    for (const seg of p.replace(/^~\/?/, "").split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") { if (!parts.length) return ""; parts.pop(); continue; }
        parts.push(seg);
    }
    return parts.join("/");
}
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const parent = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const inside = (p, dir) => (dir ? p.startsWith(dir + "/") : true);

/**
 * Les mots d'une ligne : guillemets, \ ; et les opérateurs ; && > >> à part. Un mot est { s, g } : g quand il a un
 * joker (* ? [) hors des guillemets, à développer comme bash.
 */
function words(line) {
    const out = [];
    let cur = null, q = null, g = false;
    const push = () => { if (cur != null) out.push({ s: cur, g }); cur = null; g = false; };
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === q) q = null; else if (c === "\\" && q === '"' && i + 1 < line.length) cur += line[++i]; else cur += c; continue; }
        if (c === '"' || c === "'") { q = c; cur ??= ""; continue; }
        if (c === "\\" && i + 1 < line.length) { cur = (cur ?? "") + line[++i]; continue; }
        if (/\s/.test(c)) { push(); continue; }
        if (c === "*" || c === "?" || c === "[") g = true;
        if (c === ";") { push(); out.push({ op: ";" }); continue; }
        if (c === "&" && line[i + 1] === "&") { push(); out.push({ op: "&&" }); i++; continue; }
        if (c === ">") { push(); if (line[i + 1] === ">") { out.push({ op: ">>" }); i++; } else out.push({ op: ">" }); continue; }
        cur = (cur ?? "") + c;
    }
    if (q) throw new Error("guillemet non fermé");
    push();
    return out;
}

export class Terminal {
    constructor(env, { store, host, under } = {}) {
        this.env = env;
        this.store = store;
        this.host = host;
        this.under = under;
        this.cwd = "";
        this.history = store?.get("term.history", []) || [];
        this.memo = store?.get("term.phrases", []) || [];   // les définitions et valeurs données en français
        this.hpos = this.history.length;
        this.build();
    }

    // ---------------------------------------------------------------- l'écran
    // Le terminal prend la place de l'éditeur (host : la zone de l'éditeur, under : l'éditeur, qui s'efface)

    build() {
        const w = (this.win = document.createElement("section"));
        w.className = "term";
        w.hidden = true;
        w.setAttribute("aria-label", "Terminal");
        w.innerHTML = '<header class="term-head"><span class="term-title"></span><span class="term-hint">Ctrl ` ou Échap : revenir à la page</span></header>'
            + '<div class="term-body"><div class="term-out"></div><div class="term-line"><span class="term-ps"></span><input class="term-in" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Commande"></div></div>';
        (this.host || document.body).append(w);
        this.out = w.querySelector(".term-out");
        this.body = w.querySelector(".term-body");
        this.input = w.querySelector(".term-in");
        this.ps = w.querySelector(".term-ps");
        this.title = w.querySelector(".term-title");
        this.body.addEventListener("mouseup", () => { if (!getSelection().toString()) this.input.focus(); });
        // les noms cliquables : comme si on tapait la commande
        this.out.addEventListener("click", (e) => {
            const a = e.target.closest("[data-open], [data-cd]");
            if (!a || getSelection().toString()) return;
            const q = (p) => (/[\s"'\\;&>*?[]/.test(p) ? `"${p.replace(/["\\]/g, "\\$&")}"` : p);
            if (a.dataset.cd != null) this.submit(`cd ${q("/" + a.dataset.cd)} && ls`);
            else this.submit(`open ${q("/" + a.dataset.open)}${a.dataset.line ? ` ${a.dataset.line}` : ""}`);
        });
        this.input.addEventListener("keydown", (e) => this.key(e));
        this.prompt();
        this.print([["OmniNote — terminal de l'espace de travail. ", "dim"], ["help", "cmd"], [" pour les commandes ; les pages sont des fichiers, rangés dans des dossiers.", "dim"]]);
    }

    /** L'un arrive d'un côté pendant que l'autre s'efface (comme un changement de page) */
    swap(show, hide, dir) {
        if (!show.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const ease = "cubic-bezier(.16, 1, .3, 1)";
        show.animate([{ transform: `translateX(${dir * 7}%) scale(.985)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 460, easing: ease });
        hide?.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${-dir * 7}%) scale(.965)`, opacity: 0 }], { duration: 340, easing: ease });
    }

    get isOpen() { return !this.win.hidden; }
    open() {
        if (this.isOpen) { this.input.focus(); return; }
        this.win.hidden = false;
        document.body.classList.add("in-term");
        this.prompt();
        this.swap(this.win, this.under, 1);
        this.body.scrollTop = this.body.scrollHeight;
        this.input.focus();
        this.store?.set("term.open", true);
    }
    close({ quiet = false } = {}) {
        if (!this.isOpen) return;
        this.win.hidden = true;
        document.body.classList.remove("in-term");
        if (!quiet && this.under) this.swap(this.under, null, -1);
        this.store?.set("term.open", false);
        this.env.focus?.();
    }
    toggle() { if (this.isOpen) this.close(); else this.open(); }

    prompt() {
        const where = "/" + this.cwd;
        this.ps.replaceChildren(this.seg("omninote", "user"), this.seg(":", "dim"), this.seg(where, "dir"), this.seg("$ ", "dim"));
        this.title.textContent = `Terminal — ${where}`;
    }
    seg(text, cls, link) {
        const s = document.createElement("span");
        s.textContent = text;
        if (cls) s.className = `t-${cls}`;
        // un nom qu'on clique : { open: chemin, line } ouvre la page, { cd: dossier } y entre
        if (link) {
            s.classList.add("t-link");
            if (link.open != null) { s.dataset.open = link.open; if (link.line) s.dataset.line = link.line; s.title = `Ouvrir /${link.open}${link.line ? ` à la ligne ${link.line}` : ""}`; }
            if (link.cd != null) { s.dataset.cd = link.cd; s.title = `Aller dans /${link.cd}`; }
        }
        return s;
    }
    /** Une ligne : un texte, ou des morceaux [texte, classe, lien] */
    print(parts, cls = "") {
        const line = document.createElement("div");
        line.className = `term-l${cls ? ` t-${cls}` : ""}`;
        if (typeof parts === "string") line.textContent = parts;
        else for (const [t, c, link] of parts) line.append(this.seg(t, c, link));
        this.out.append(line);
        // (un écran trop long : on garde les 2000 dernières lignes)
        while (this.out.childElementCount > 2000) this.out.firstElementChild.remove();
        this.body.scrollTop = this.body.scrollHeight;
    }
    error(msg) { this.print(msg, "err"); this.failed = true; }

    // ---------------------------------------------------------------- le clavier

    key(e) {
        e.stopPropagation();
        const v = this.input.value;
        if (e.key === "Enter") { e.preventDefault(); this.input.value = ""; this.submit(v); return; }
        if (e.key === "Tab") { e.preventDefault(); this.complete(); return; }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            if (!this.history.length) return;
            if (this.hpos === this.history.length) this.draft = v;
            this.hpos = Math.max(0, Math.min(this.history.length, this.hpos + (e.key === "ArrowUp" ? -1 : 1)));
            this.input.value = this.hpos === this.history.length ? this.draft || "" : this.history[this.hpos];
            requestAnimationFrame(() => this.input.setSelectionRange(this.input.value.length, this.input.value.length));
            return;
        }
        if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); this.out.replaceChildren(); return; }
        // Ctrl C : abandonner la ligne (avec une sélection : copier)
        if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "c" && this.input.selectionStart === this.input.selectionEnd) { e.preventDefault(); this.echoLine(v + "^C"); this.input.value = ""; return; }
        if (e.key === "Escape") { e.preventDefault(); this.close(); }
    }

    echoLine(v) {
        const line = document.createElement("div");
        line.className = "term-l";
        line.append(...[...this.ps.childNodes].map((n) => n.cloneNode(true)), this.seg(v));
        this.out.append(line);
        this.body.scrollTop = this.body.scrollHeight;
    }

    submit(raw) {
        let v = raw;
        // !! et !n : une commande de l'historique
        const bang = /^\s*!(!|-?\d+)\s*$/.exec(v);
        if (bang) {
            const n = bang[1] === "!" ? this.history.length : +bang[1] < 0 ? this.history.length + 1 + +bang[1] : +bang[1];
            const got = this.history[n - 1];
            this.echoLine(v);
            if (!got) { this.error(`omninote: ${v.trim()} : événement introuvable`); this.hpos = this.history.length; return; }
            v = got;
            this.print(v, "dim");
        } else this.echoLine(v);
        if (v.trim()) {
            if (this.history[this.history.length - 1] !== v) this.history.push(v);
            if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
            this.store?.set("term.history", this.history);
        }
        this.hpos = this.history.length;
        this.draft = "";
        try { this.run(v); } catch (err) { this.error(`omninote: ${err.message}`); }
        this.prompt();
        this.body.scrollTop = this.body.scrollHeight;
    }

    /** Une ligne : des commandes séparées par ; ou && */
    run(line) {
        if (this.isPhrase(line)) { this.phrase(line); return; }
        const all = words(line);
        let cmd = [], skip = false;
        const go = (next) => {
            if (cmd.length && !skip) { this.failed = false; this.exec(cmd); }
            skip = next === "&&" && this.failed;
            cmd = [];
        };
        for (const w of all) {
            if (w.op === ";" || w.op === "&&") { go(w.op); continue; }
            cmd.push(w);
        }
        go(null);
    }

    /** Une phrase plutôt qu'une commande : en _…_, avec une majuscule, des « », ou un point final */
    isPhrase(line) {
        const t = line.trim();
        if (/^_.+_$/.test(t)) return true;
        const first = /^[\p{L}']+/u.exec(t)?.[0];
        if (!first || COMMANDS[first] || ALIASES[first]) return false;
        return /^\p{Lu}/u.test(t) || /[«»]/.test(t) || /[.?!]$/.test(t) || /^\p{L}+\s+\p{L}/u.test(t);
    }

    phrase(line) {
        let text = tidy(quotePaths(line.trim().replace(/^_(.+)_$/, "$1")));
        let res;
        // Un mot sans valeur, au terminal, est un nom (« va dans outils », « cherche iris ») : on le relit entre « »
        for (let tries = 0; ; tries++) {
            try { res = this.env.phrase(text, this.memo); } catch (e) { this.error(`phrase : ${e.message}`); return; }
            const m = res.error && tries < 4 && /« (.+?) » n'a pas encore de valeur/.exec(res.error);
            const next = m ? tidy(quoteWord(text, m[1])) : text;
            if (next === text) break;
            text = next;
        }
        if (res.translated) this.print([["≈ ", "dim"], [res.translated, "dim"]]);
        if (res.error) { this.error(`phrase : ${res.error}`); return; }
        const q = (p) => `"${String(p).replace(/["\\]/g, "\\$&")}"`;
        // une page venue d'une boucle s'affiche avec ses champs : on prend son chemin
        const arg = (a) => { const m = /chemin : «([^»]*)»/.exec(a); return m && !a.trim().startsWith("[") ? "/" + m[1] : a.trim(); };
        for (const l of res.lines || []) {
            const m = /^⟦([^⟧]*)⟧([\s\S]*)$/.exec(l);
            if (!m || !PHRASE_CMDS.has(m[1])) { this.print(l); continue; }
            const cmd = m[1], args = m[2] ? m[2].split("⟦⟧").map(arg) : [];
            // (une liste de pages : pas d'action destructrice sur tout un ensemble d'un coup)
            if (DESTRUCTIVE.has(cmd) && args.some((a) => a.startsWith("["))) { this.error(`phrase : « ${cmd} » sur toute une liste : dites laquelle (« Supprime «Notes.md». », ou une boucle « Pour chaque page des pages, … »)`); continue; }
            let shell;
            if (cmd === "ren") { const src = this.path(args[0]), dir = parent(src); shell = `mv ${q("/" + src)} ${q("/" + (dir ? dir + "/" : "") + args[1])}`; }
            else if (cmd === "write") shell = `echo ${q(args[0])} >> ${q(args[1])}`;
            else shell = [cmd, ...args.map(q)].join(" ");
            this.failed = false;
            this.run(shell);
        }
        // ce qui définit (une action, une classe) ou donne une valeur reste pour les phrases suivantes
        if (res.keep && !this.memo.includes(text)) {
            this.memo.push(text);
            if (this.memo.length > 200) this.memo.splice(0, this.memo.length - 200);
            this.store?.set("term.phrases", this.memo);
            if (res.kind === "define") this.print([["(définition gardée : ", "dim"], ["phrases", "cmd"], [" pour la liste)", "dim"]]);
        }
    }

    c_phrases(args) {
        if (args[0] === "-c") { this.memo = []; this.store?.set("term.phrases", []); this.print("définitions oubliées", "dim"); return; }
        if (!this.memo.length) { this.print([["Aucune : une phrase comme ", "dim"], ["Pour archiver une page, on crée le dossier «archives» et on déplace la page et «archives».", "cmd"], [" en définit une.", "dim"]]); return; }
        this.memo.forEach((m, k) => this.print([[String(k + 1).padStart(5) + "  ", "num"], [m, ""]]));
    }

    exec(tokens) {
        // les jokers : grep loyer *, ls projet/*.md (sans correspondance, le mot reste tel quel, comme bash)
        const argv = tokens.flatMap((t) => (t.op ? [t] : t.g ? this.glob(t.s) : [t.s]));
        let [name, ...args] = argv;
        if (typeof name !== "string") throw new Error("erreur de syntaxe près du symbole inattendu « > »");
        if (ALIASES[name]) { const [n, ...more] = ALIASES[name].split(" "); name = n; args = [...more, ...args]; }
        // > et >> : la sortie dans un fichier (echo, cat, ls, tree, pwd, grep, history)
        let redirect = null;
        const r = args.findIndex((a) => typeof a === "object");
        if (r >= 0) {
            const target = args[r + 1];
            if (typeof target !== "string") throw new Error("erreur de syntaxe près du symbole inattendu « newline »");
            redirect = { path: this.path(target), append: args[r].op === ">>" };
            args = args.filter((_, k) => k !== r && k !== r + 1);
        }
        const fn = this[`c_${name}`];
        if (!fn) { this.error(`omninote: ${name} : commande introuvable (help pour la liste)`); return; }
        if (!redirect) { fn.call(this, args); return; }
        // la sortie, recueillie au lieu d'être affichée
        const lines = [], print = this.print;
        this.print = (parts) => lines.push(typeof parts === "string" ? parts : parts.map(([t]) => t).join(""));
        try { fn.call(this, args); } finally { this.print = print; }
        const p = redirect.path;
        if (this.isDir(p)) { this.error(`omninote: ${p} : est un dossier`); return; }
        if (!this.isFile(p) && !this.isDir(parent(p))) { this.error(`omninote: ${p} : ${NOENT}`); return; }
        const text = lines.join("\n") + (lines.length ? "\n" : "");
        if (this.isFile(p)) this.env.write(p, text, redirect.append);
        else this.env.create(p, text);
    }

    // ---------------------------------------------------------------- le système de fichiers : les pages

    files() { return this.env.files(); }
    path(p) { return resolvePath(this.cwd, p); }
    isFile(p) { return this.files().some((f) => f.path === p); }
    /** Les dossiers : ceux créés, et ceux des chemins des pages */
    dirs() {
        const set = new Set(this.env.dirs());
        for (const f of this.files()) for (let d = parent(f.path); d; d = parent(d)) set.add(d);
        return set;
    }
    isDir(p) { return p === "" || this.dirs().has(p); }
    /** Le contenu direct d'un dossier : { dirs, files } triés */
    entries(dir) {
        const cmp = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
        const dirs = [...this.dirs()].filter((d) => d && parent(d) === dir).map(base).sort(cmp);
        const files = this.files().filter((f) => parent(f.path) === dir).sort((a, b) => cmp(base(a.path), base(b.path)));
        return { dirs, files };
    }
    flags(args, allowed) {
        const opts = new Set(), rest = [];
        let done = false;
        for (const a of args) {
            if (!done && a === "--") { done = true; continue; }
            if (!done && /^-[A-Za-z]+$/.test(a)) { for (const c of a.slice(1)) { if (!allowed.includes(c)) throw new Error(`option invalide -- '${c}'`); opts.add(c); } continue; }
            rest.push(a);
        }
        return { opts, rest };
    }

    // ---------------------------------------------------------------- les commandes

    c_help() {
        this.print("Les pages du document sont des fichiers, rangés dans des dossiers :", "dim");
        for (const [k, v] of Object.entries(COMMANDS)) this.print([[k.padEnd(9), "cmd"], [v, ""]]);
        this.print("");
        this.print("Et en français (Grama Lectica) : « les pages » (nom, titre, dossier, chemin, lignes, ouverte), « les dossiers », « le dossier courant », « le fichier ouvert » :", "dim");
        for (const ex of ["Crée le dossier «projet».", "Crée la page «Idées.md».", "Déplace «Idées.md» dans «projet».", "Renomme «Notes.md» en «Bilan.md».", "Pour chaque page des pages, on affiche le titre de la page.",
            "Pour chaque page des pages, si le dossier de la page est «brouillons», on supprime la page.", "Pour archiver une page, on crée le dossier «archives» et on déplace la page et «archives».", "Archive «Bilan.md».", "Montre l'arborescence.", "affiche le fichier ouvert"]) this.print([["  ", ""], [ex, "cmd"]]);
        this.print([["  actions : créer le dossier, créer la page, supprimer, supprimer le dossier, déplacer, copier, renommer, ouvrir, lire, écrire, aller dans, lister, chercher, montrer ; ", "dim"], ["phrases", "cmd"], [" : vos définitions", "dim"]]);
        this.print("");
        this.print([["*", "cmd"], [" ", "dim"], ["?", "cmd"], [" jokers (grep loyer *) · un nom se clique pour l'ouvrir · ", "dim"], ["Tab", "cmd"], [" complète (le nom ou le titre) · ", "dim"], ["↑ ↓", "cmd"], [" historique · ", "dim"], ["!!", "cmd"], [" la dernière commande · ", "dim"], ["; &&", "cmd"], [" enchaînent · ", "dim"], ["Ctrl `", "cmd"], [" ouvre et ferme", "dim"]]);
    }
    c_pwd() { this.print("/" + this.cwd); }
    c_cd(args) {
        const p = args[0] == null ? "" : this.path(args[0]);
        if (args.length > 1) { this.error("cd: trop d'arguments"); return; }
        if (this.isFile(p)) { this.error(`cd: ${args[0]}: N'est pas un dossier`); return; }
        if (!this.isDir(p)) { this.error(`cd: ${args[0]}: ${NOENT}`); return; }
        this.cwd = p;
    }
    c_ls(args) {
        const { opts, rest } = this.flags(args, "la1");
        const targets = rest.length ? rest : ["."];
        targets.forEach((t, k) => {
            const p = this.path(t);
            if (this.isFile(p)) { this.lsFile(this.files().find((f) => f.path === p), opts.has("l"), t); return; }
            if (!this.isDir(p)) { this.error(`ls: impossible d'accéder à '${t}': ${NOENT}`); return; }
            if (targets.length > 1) this.print(`${t}:`, "dim");
            const { dirs, files } = this.entries(p);
            if (opts.has("l")) {
                this.print(`total ${dirs.length + files.length}`, "dim");
                for (const d of dirs) {
                    const dp = p ? `${p}/${d}` : d, n = this.files().filter((f) => inside(f.path, dp)).length;
                    this.print([["d ", "dim"], [`${String(n).padStart(4)} p. `, "dim"], [`${d}/`, "dir", { cd: dp }]]);
                }
                for (const f of files) this.lsFile(f, true);
            } else {
                const parts = [];
                for (const d of dirs) parts.push([`${d}/`, "dir", { cd: p ? `${p}/${d}` : d }], ["  ", ""]);
                for (const f of files) parts.push([base(f.path), f.current ? "cur" : "file", { open: f.path }], ["  ", ""]);
                if (parts.length) this.print(parts.slice(0, -1));
            }
            if (k < targets.length - 1) this.print("");
        });
    }
    lsFile(f, long, shown = base(f.path)) {
        const link = { open: f.path };
        if (!long) { this.print([[shown, f.current ? "cur" : "file", link]]); return; }
        this.print([["- ", "dim"], [`${String(f.lines).padStart(4)} l. `, "dim"], [shown, f.current ? "cur" : "file", link], [this.titleNote(f), "dim", link], [f.current ? "  ← ouverte" : "", "dim"]]);
    }
    /** « Le titre », quand le nom du fichier ne le dit pas déjà */
    titleNote(f) {
        const stem = base(f.path).replace(/\.md$/, "");
        return f.title && f.title.replace(/\s+/g, "-") !== stem ? `  « ${f.title} »` : "";
    }
    c_tree(args) {
        const p = args[0] ? this.path(args[0]) : this.cwd;
        if (!this.isDir(p)) { this.error(`${args[0]} [erreur à l'ouverture du dossier]`); return; }
        let nd = 0, nf = 0;
        this.print([[p ? (args[0] || ".") : "/", "dir", { cd: p }]]);
        const walk = (dir, pre) => {
            const { dirs, files } = this.entries(dir);
            const items = [...dirs.map((d) => ({ d })), ...files.map((f) => ({ f }))];
            items.forEach((it, k) => {
                const last = k === items.length - 1;
                const branch = last ? "└── " : "├── ";
                if (it.d) {
                    nd++;
                    const dp = dir ? `${dir}/${it.d}` : it.d;
                    this.print([[pre + branch, "dim"], [`${it.d}/`, "dir", { cd: dp }]]);
                    walk(dp, pre + (last ? "    " : "│   "));
                } else {
                    nf++;
                    const link = { open: it.f.path };
                    this.print([[pre + branch, "dim"], [base(it.f.path), it.f.current ? "cur" : "file", link], [this.titleNote(it.f), "dim", link]]);
                }
            });
        };
        walk(p, "");
        this.print("");
        this.print(`${nd} dossier${nd > 1 ? "s" : ""}, ${nf} page${nf > 1 ? "s" : ""}`, "dim");
    }
    c_mkdir(args) {
        const { opts, rest } = this.flags(args, "pv");
        if (!rest.length) { this.error("mkdir: opérande manquant"); return; }
        const dirs = new Set(this.env.dirs());
        for (const a of rest) {
            const p = this.path(a);
            if (!p || this.isFile(p) || (this.isDir(p) && !opts.has("p"))) { if (!(opts.has("p") && this.isDir(p))) this.error(`mkdir: impossible de créer le dossier « ${a} »: Le fichier existe`); continue; }
            if (!this.isDir(parent(p)) && !opts.has("p")) { this.error(`mkdir: impossible de créer le dossier « ${a} »: ${NOENT}`); continue; }
            if (this.files().some((f) => f.path === parent(p))) { this.error(`mkdir: impossible de créer le dossier « ${a} »: N'est pas un dossier`); continue; }
            for (let d = p; d; d = parent(d)) dirs.add(d);
            if (opts.has("v")) this.print(`mkdir: création du dossier '${a}'`);
        }
        this.env.setDirs([...dirs]);
    }
    c_rmdir(args) {
        if (!args.length) { this.error("rmdir: opérande manquant"); return; }
        const dirs = new Set(this.env.dirs());
        for (const a of args) {
            const p = this.path(a);
            if (this.isFile(p)) { this.error(`rmdir: impossible de supprimer '${a}': N'est pas un dossier`); continue; }
            if (!p || !this.isDir(p)) { this.error(`rmdir: impossible de supprimer '${a}': ${p ? NOENT : "Périphérique ou ressource occupé"}`); continue; }
            const { dirs: sub, files } = this.entries(p);
            if (sub.length || files.length) { this.error(`rmdir: impossible de supprimer '${a}': Le dossier n'est pas vide`); continue; }
            dirs.delete(p);
            if (inside(this.cwd + "/", p)) this.cwd = parent(p);
        }
        this.env.setDirs([...dirs]);
    }
    c_touch(args) {
        if (!args.length) { this.error("touch: opérande de fichier manquant"); return; }
        for (const a of args) {
            const p = this.path(a);
            if (this.isFile(p) || this.isDir(p)) continue;
            if (!this.isDir(parent(p))) { this.error(`touch: impossible de faire un touch '${a}': ${NOENT}`); continue; }
            this.env.create(p, "");
        }
    }
    c_cat(args) {
        const { opts, rest } = this.flags(args, "n");
        if (!rest.length) { this.error("cat: opérande manquant (cat fichier)"); return; }
        for (const a of rest) {
            const p = this.path(a);
            if (this.isDir(p)) { this.error(`cat: ${a}: est un dossier`); continue; }
            if (!this.isFile(p)) { this.error(`cat: ${a}: ${NOENT}`); continue; }
            const lines = this.env.read(p).replace(/\n$/, "").split("\n");
            lines.forEach((l, k) => this.print(opts.has("n") ? [[`${String(k + 1).padStart(6)}  `, "dim"], [l, ""]] : l));
        }
    }
    c_echo(args) {
        this.print(this.flags(args, "n").rest.join(" "));
    }
    c_rm(args) {
        const { opts, rest } = this.flags(args, "rRfv");
        const rec = opts.has("r") || opts.has("R");
        if (!rest.length) { if (!opts.has("f")) this.error("rm: opérande manquant"); return; }
        const gone = new Set(), dirs = new Set(this.env.dirs());
        for (const a of rest) {
            const p = this.path(a);
            if (this.isFile(p)) { gone.add(p); continue; }
            if (this.isDir(p)) {
                if (!p) { this.error("rm: il est dangereux d'opérer récursivement sur '/'"); continue; }
                if (!rec) { this.error(`rm: impossible de supprimer '${a}': est un dossier`); continue; }
                for (const f of this.files()) if (inside(f.path, p)) gone.add(f.path);
                for (const d of [...dirs]) if (d === p || inside(d, p)) dirs.delete(d);
                continue;
            }
            if (!opts.has("f")) this.error(`rm: impossible de supprimer '${a}': ${NOENT}`);
        }
        if (gone.size) {
            const err = this.env.remove([...gone]);
            if (err) { this.error(`rm: ${err}`); return; }
            if (opts.has("v")) for (const g of gone) this.print(`'${g}' supprimé`);
        }
        this.env.setDirs([...dirs]);
        if (!this.isDir(this.cwd)) this.cwd = "";
    }
    /** Les déplacements de mv et cp : [[de, vers]] pour les pages, et les dossiers à créer */
    plan(cmd, args, rec) {
        if (args.length < 2) { this.error(args.length ? `${cmd}: opérande de fichier cible manquant après '${args[0]}'` : `${cmd}: opérande de fichier manquant`); return null; }
        const target = args[args.length - 1], tp = this.path(target), srcs = args.slice(0, -1);
        const intoDir = this.isDir(tp);
        if (srcs.length > 1 && !intoDir) { this.error(`${cmd}: la cible '${target}' n'est pas un dossier`); return null; }
        const moves = [], newDirs = [], oldDirs = [];
        for (const a of srcs) {
            const p = this.path(a);
            const dest = intoDir ? (tp ? `${tp}/${base(p)}` : base(p)) : tp;
            if (this.isFile(p)) {
                if (!intoDir && !this.isDir(parent(dest))) { this.error(`${cmd}: impossible de déplacer '${a}' vers '${target}': ${NOENT}`); continue; }
                if (dest === p) { this.error(`${cmd}: '${a}' et '${target}' sont le même fichier`); continue; }
                moves.push([p, dest]);
                continue;
            }
            if (this.isDir(p) && p) {
                if (!rec) { this.error(`${cmd}: -r non spécifié ; omission du dossier '${a}'`); continue; }
                if (dest === p || inside(dest, p)) { this.error(`${cmd}: impossible de déplacer '${a}' vers un sous-dossier de lui-même, '${target}'`); continue; }
                if (this.isFile(dest)) { this.error(`${cmd}: impossible d'écraser le fichier '${target}' par le dossier '${a}'`); continue; }
                for (const f of this.files()) if (inside(f.path, p)) moves.push([f.path, dest + f.path.slice(p.length)]);
                for (const d of this.dirs()) if (d === p || inside(d, p)) { newDirs.push(dest + d.slice(p.length)); oldDirs.push(d); }
                continue;
            }
            this.error(`${cmd}: impossible d'évaluer '${a}': ${NOENT}`);
        }
        return { moves, newDirs, oldDirs };
    }
    c_mv(args) {
        const plan = this.plan("mv", args, true);
        if (!plan) return;
        const dirs = new Set(this.env.dirs());
        for (const d of plan.oldDirs) dirs.delete(d);
        for (const d of plan.newDirs) dirs.add(d);
        // un fichier qui en remplace un autre : celui-ci part (comme mv)
        const replaced = plan.moves.map(([, to]) => to).filter((to) => this.isFile(to) && !plan.moves.some(([from]) => from === to));
        if (replaced.length) { const err = this.env.remove(replaced); if (err) { this.error(`mv: ${err}`); return; } }
        if (plan.moves.length) this.env.move(plan.moves);
        this.env.setDirs([...dirs]);
        if (plan.oldDirs.includes(this.cwd)) this.cwd = plan.newDirs[plan.oldDirs.indexOf(this.cwd)];
    }
    c_cp(args) {
        const { opts, rest } = this.flags(args, "rR");
        const plan = this.plan("cp", rest, opts.has("r") || opts.has("R"));
        if (!plan) return;
        const dirs = new Set(this.env.dirs());
        for (const d of plan.newDirs) dirs.add(d);
        this.env.setDirs([...dirs]);
        if (plan.moves.length) this.env.copy(plan.moves);
    }
    c_grep(args) {
        const { opts, rest } = this.flags(args, "inrlc");
        if (!rest.length) { this.error("grep: motif manquant (grep motif [fichier…])"); return; }
        const [pat, ...where] = rest;
        let re;
        try { re = new RegExp(pat, opts.has("i") ? "gi" : "g"); } catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.has("i") ? "gi" : "g"); }
        let list = this.files();
        if (where.length) {
            const want = new Set();
            for (const a of where) {
                const p = this.path(a);
                if (this.isFile(p)) want.add(p);
                else if (this.isDir(p)) for (const f of list) { if (inside(f.path, p)) want.add(f.path); }
                else this.error(`grep: ${a}: ${NOENT}`);
            }
            list = list.filter((f) => want.has(f.path));
        }
        let found = 0;
        for (const f of list) {
            const lines = this.env.read(f.path).split("\n");
            let n = 0;
            lines.forEach((l, k) => {
                re.lastIndex = 0;
                if (!re.test(l)) return;
                n++;
                found++;
                if (opts.has("l") || opts.has("c")) return;
                const link = { open: f.path, line: k + 1 };
                const parts = [[f.path, "file", { open: f.path }], [":", "dim"]];
                if (opts.has("n")) parts.push([String(k + 1), "num", link], [":", "dim"]);
                let last = 0;
                re.lastIndex = 0;
                for (const m of l.matchAll(re)) {
                    if (!m[0]) break;
                    parts.push([l.slice(last, m.index), "", link], [m[0], "hit", link]);
                    last = m.index + m[0].length;
                }
                parts.push([l.slice(last), "", link]);
                this.print(parts);
            });
            if (n && opts.has("l")) this.print([[f.path, "file", { open: f.path }]]);
            if (opts.has("c")) this.print([[f.path, "file", { open: f.path }], [":", "dim"], [String(n), "num"]]);
        }
        if (!found) this.failed = true;
    }
    c_open(args) {
        if (!args[0]) { this.error("open: opérande manquant (open fichier [ligne])"); return; }
        const p = this.path(args[0]), line = /^\d+$/.test(args[1] || "") ? +args[1] : 0;
        if (this.isDir(p)) { this.error(`open: ${args[0]}: est un dossier`); return; }
        if (!this.isFile(p)) { this.error(`open: ${args[0]}: ${NOENT} (touch ${args[0]} pour la créer)`); return; }
        this.print([["ouverte dans l'éditeur : ", "dim"], [p, "cur"]]);
        this.close({ quiet: true });
        this.env.open(p, line);
    }
    c_history(args) {
        if (args[0] === "-c") { this.history = []; this.hpos = 0; this.store?.set("term.history", []); return; }
        const n = args[0] && /^\d+$/.test(args[0]) ? +args[0] : this.history.length;
        const from = Math.max(0, this.history.length - n);
        this.history.slice(from).forEach((h, k) => this.print([[String(from + k + 1).padStart(5) + "  ", "num"], [h, ""]]));
    }
    c_clear() { this.out.replaceChildren(); }
    c_exit() { this.close(); }

    /** Un mot à jokers → les chemins qui lui correspondent, écrits comme le mot (relatifs ou depuis /) */
    glob(pat) {
        const abs = pat.startsWith("/") || pat.startsWith("~");
        const segs = pat.replace(/^~/, "").split("/").filter(Boolean);
        const re = (seg) => new RegExp("^" + seg.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        const join = (c, name) => ({ path: c.path ? `${c.path}/${name}` : name, shown: c.shown + (c.shown && !c.shown.endsWith("/") ? "/" : "") + name });
        let cur = [{ path: abs ? "" : this.cwd, shown: abs ? "/" : "" }];
        for (const seg of segs) {
            const next = [];
            for (const c of cur) {
                if (!this.isDir(c.path)) continue;
                if (!/[*?[]/.test(seg)) { next.push({ path: resolvePath(c.path, seg), shown: join(c, seg).shown }); continue; }
                const { dirs, files } = this.entries(c.path), r = re(seg);
                for (const name of [...dirs, ...files.map((f) => base(f.path))]) if (r.test(name)) next.push(join(c, name));
            }
            cur = next;
        }
        const out = cur.filter((c) => this.isDir(c.path) || this.isFile(c.path)).map((c) => c.shown);
        return out.length ? out : [pat];
    }

    // ---------------------------------------------------------------- Tab

    complete() {
        const v = this.input.value, at = this.input.selectionStart ?? v.length;
        const before = v.slice(0, at);
        const m = /(\S*)$/.exec(before);
        const word = m[1], first = !before.slice(0, before.length - word.length).trim();
        let options;
        if (first) options = [...Object.keys(COMMANDS), ...Object.keys(ALIASES)].filter((c) => c.startsWith(word)).map((c) => c + " ");
        else {
            const dirPart = word.includes("/") ? word.slice(0, word.lastIndexOf("/") + 1) : "";
            const dir = this.path(dirPart || ".");
            if (!this.isDir(dir)) return;
            const pre = word.slice(dirPart.length).replace(/^["']/, "");
            const { dirs, files } = this.entries(dir);
            const fold = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const all = [...dirs.map((d) => [`${d}/`, d]), ...files.map((f) => [`${base(f.path)} `, f.title || ""])];
            // le début du nom ; sinon, sans tenir compte des majuscules ni des accents, le début du nom ou du titre
            options = all.filter(([x]) => x.startsWith(pre)).map(([x]) => dirPart + x);
            if (!options.length && pre) options = all.filter(([x, t]) => fold(x).startsWith(fold(pre)) || fold(t).startsWith(fold(pre))).map(([x]) => dirPart + x);
        }
        if (!options.length) return;
        let common = options[0];
        for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
        if (options.length > 1 && (common.length <= word.length || !common.startsWith(word))) {
            this.echoLine(v);
            this.print(options.map((o) => [o.trim().slice(o.lastIndexOf("/", o.length - 2) + 1) + "  ", o.endsWith("/") ? "dir" : first ? "cmd" : "file"]));
            return;
        }
        const quoted = /\s/.test(common.trim()) ? `"${common.trimEnd()}"${common.endsWith(" ") ? " " : ""}` : common;
        this.input.value = before.slice(0, before.length - word.length) + quoted + v.slice(at);
        const pos = before.length - word.length + quoted.length;
        this.input.setSelectionRange(pos, pos);
    }
}

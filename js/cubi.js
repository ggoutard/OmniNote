// Cubi dans TextEdit : l'IA locale de Web-Agentic-Model (un modèle de langage qui tourne dans le navigateur), branchée
// par son API (Web-Agentic-Model/sdk/cubi.js). Rien n'est chargé tant qu'on n'a pas cliqué : TextEdit reste aussi léger.
//
// - Le logo, en bas à droite : un clic le réveille (le modèle se charge). Il ne fait que commenter, en petites
//   phrases au-dessus de lui : « Bonjour ! On bosse sur … ? », puis ce qu'il fait (je lis, je réfléchis, j'écris).
// - Réveillé, il propose son aide sur une sélection : une petite bulle demande « Que fait-on ? ». On écrit sa demande
//   (« corrige les fautes », « plus sobrement », ou une question : il lit alors toute la page en plus du passage).
// - Un clic sur le logo ouvre un grand champ : une demande sans sélection (« ajoute une section sur… », « écris une
//   conclusion »). Il lit le plan du document, choisit où l'ajouter, puis l'écrit ; l'ajout apparaît à sa place, en
//   vert, avec ✓ / ✕. Une question sur le document reçoit sa réponse dans une bulle, au-dessus du logo.
// - Ses changements s'affichent sur les mots mêmes : barrés en rouge, ajoutés en vert, avec ✓ (garder) et ✕ (revenir)
//   au bout du passage. Une réponse, surlignée en jaune, s'ouvre à côté : l'insérer ou la copier. Il lit aussi le code :
//   une sélection de code lui est confiée telle quelle. « /relire » relit toute la page, paragraphe par paragraphe.
// - Mode léger (par défaut) : le modèle seul, invisible. « /cubi personnage » : le site du modèle en entier, avec son
//   personnage, dans une fenêtre au-dessus de la page (le modèle redémarre une fois pour changer de mode).
//
// Formules, code, liens et phrases _…_ (qui s'exécutent) sont remplacés par des marqueurs ⟦1⟧, ⟦2⟧… avant une
// réécriture, et remis à leur place au retour : Cubi ne peut pas les abîmer.

// Le modèle est publié à côté de TextEdit, sur le même site : ggoutard.github.io/Web-Agentic-Model/. En local (Go Live),
// un dossier Web-Agentic-Model posé à côté de TextEdit sert d'abord ; sinon, la version publiée (en mode léger : le
// personnage demande le même site).
const MODEL_PATH = "../Web-Agentic-Model/";
const MODEL_SITE = "https://ggoutard.github.io/Web-Agentic-Model/";
const UI_PREF = "textedit-cubi-ui";
const MAX_PARTS = 40;
const MIN_CHARS = 12;
const JOY_MS = 2200;
// Ses petites phrases s'effacent après SAY_MS ; celles qui disent ce qu'il fait restent tant qu'il travaille.
const SAY_MS = 7000;
const HINT_CHARS = 90;
// « Relis la page », « corrige tout le document » : chaque paragraphe relu, ses propositions surlignées.
const READ_PAGE = /^(?:relis|relire|relecture|corrige[rz]?)(?:\s+(?:moi\s+)?(?:toute\s+|tout\s+)?(?:la\s+page|le\s+document|le\s+texte|tout))\s*[.!]?$/i;
// « change la boucle… », « remplace print par… », « renomme la variable… » : modifier ce qui existe, pas ajouter.
const EDIT = /^(chang|modifi|remplac|renomm|transform|corrig|mets?\b|passe\b|enl[eè]v|supprim|retir|tradui|convert|adapt|r[ée][ée]cri|refai|am[ée]lior|optimis|simplifi|raccourci|reformul|fai[st]? (que|en sorte)|rends?\b)|\bdans (le|ce) (code|bloc|paragraphe)\b/i;
const CODE_WORDS = /\b(code|fonction|variable|boucle|bloc|python|javascript|js|sql|rust|java|html|css|print|return|classe|m[ée]thode|import|if|for|while)\b|[`_()=]/i;
// Les mots français d'une demande et ce qu'ils désignent dans le code (« la boucle » : for, while…).
const CODE_SENSE = [
    [/boucle|it[ée]r|parcour|r[ée]p[eè]t/, /\b(for|while|foreach|loop|map)\b/],
    [/fonction|m[ée]thode/, /\b(def|function|fn|func|void|=>)\b|=>/],
    [/condition|\bsi\b|test/, /\b(if|else|elif|switch|case|match)\b/],
    [/classe|objet/, /\b(class|struct|interface)\b/],
    [/affich|imprim|log/, /\b(print|println|printf|console\.log|echo|puts)\b/],
    [/import|biblioth[eè]que|module/, /\b(import|require|use|include|from)\b/],
    [/renvo|retour/, /\breturn\b/],
    [/requ[eê]te|table|sql/, /\b(select|insert|update|from|where)\b/i],
];
const STOP = new Set("les des une pour dans avec que qui est sur par pas plus mais tout tous cette ce cet ses son leur aux du de la le un et ou en à au il elle on je tu nous vous code bloc".split(" "));
const PROTECT = /(?:```|~~~)[\s\S]*?(?:```|~~~)|`[^`\n]+`|\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\[\[[^\]\n]+\]\]|\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/\S+|(?<![\w*])_[^_\n]+_(?![\w*])/g;
const PREFIX = /^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*|#{1,6}\s+))/;
// Son visage. Dans le logo, il change d'expression (data-mood) : il dort pendant son réveil, ses yeux suivent la
// lecture quand il lit, il lève les yeux quand il réfléchit, les baisse quand il écrit, saute de joie quand il a fini.
const FACE = `<svg viewBox="0 0 32 32" aria-hidden="true"><g class="cf-body"><rect x="4" y="5" width="24" height="22" rx="7" fill="#7cc6f2"/>
<g class="cf-eyes"><circle cx="12" cy="15" r="2.6" fill="#0b0b10"/><circle cx="20" cy="15" r="2.6" fill="#0b0b10"/><circle cx="12.8" cy="14.1" r=".8" fill="#fff"/><circle cx="20.8" cy="14.1" r=".8" fill="#fff"/></g>
<g fill="none" stroke="#0b0b10" stroke-width="1.4" stroke-linecap="round"><path class="cf-lids" d="M9.6 15.2q2.4 1.8 4.8 0M17.6 15.2q2.4 1.8 4.8 0"/><path class="cf-joy" d="M9.8 16q2.2-2.8 4.4 0M17.8 16q2.2-2.8 4.4 0"/>
<path class="cf-smile" d="M14 20c1.2 1.1 2.8 1.1 4 0"/><path class="cf-flat" d="M14.5 20.6h3"/><path class="cf-sad" d="M14 21.2c1.2-1.1 2.8-1.1 4 0"/></g>
<circle cx="8.6" cy="19" r="1.6" fill="#f5a3b7"/><circle cx="23.4" cy="19" r="1.6" fill="#f5a3b7"/></g></svg>`;

// Les icônes des boutons garder / revenir : dessinées, nettes à toute taille (le caractère ✓ dépend de la police).
const ICON_OK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;
const ICON_NO = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7"/></svg>`;

// Un aperçu du Markdown ajouté (titres, gras, italique, code, listes), sans quitter la ligne : texte échappé d'abord.
function preview(text, esc) {
    return esc(text).split("\n").map((line) => {
        const head = /^(#{1,6})\s+(.*)$/.exec(line);
        let html = head ? head[2] : line.replace(/^(\s*)[-*+]\s+/, "$1• ");
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>");
        return head ? `<span class="cubi-h cubi-h${head[1].length}">${html}</span>` : html;
    }).join("\n");
}

const readPref = () => { try { return localStorage.getItem(UI_PREF) === "1"; } catch { return false; } };
const writePref = (on) => { try { localStorage.setItem(UI_PREF, on ? "1" : "0"); } catch { /* préférence perdue : sans gravité */ } };

export function setupCubi({ cm, getTitle, toast, esc }) {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "cubi-fab";
    fab.dataset.state = "off";
    fab.dataset.mood = "sleep";
    fab.title = "Cubi, l'IA locale : le réveiller";
    fab.setAttribute("aria-label", "Cubi, l'IA locale");
    // Tant qu'on ne l'a pas réveillé, il dort : de petits « z » montent au-dessus de lui.
    fab.innerHTML = `${FACE}<i class="cubi-z" aria-hidden="true">z</i><i class="cubi-z" aria-hidden="true">z</i><i class="cubi-z" aria-hidden="true">z</i><b class="cubi-count" hidden></b>`;
    const words = document.createElement("div");      // ses petites phrases, au-dessus du logo
    words.className = "cubi-say";
    words.setAttribute("role", "status");
    words.innerHTML = `<p></p><small hidden></small>`;

    let ui = readPref();    // avec le personnage (le site du modèle en entier) ou mode léger
    let base = null;        // l'adresse du modèle (à côté de TextEdit, ou la version publiée)
    let cubi = null;        // la connexion (sdk/cubi.js)
    let sdk = null;         // le module, pour isQuestion
    let box = null;         // le grand champ, au-dessus du logo
    let note = null;        // une réponse, au-dessus du logo
    const additions = new Set();    // les ajouts proposés : { widget, bookmark }
    let connecting = null;
    let phase = "off";      // off → loading → ready (ou error)
    let greeted = "";       // le titre pour lequel il a dit bonjour
    let shell = null;       // la fenêtre qui montre le site du modèle en entier
    let chip = null;        // la bulle de la sélection : « Que fait-on ? »
    let pop = null;         // une proposition ouverte
    let sayTimer = 0;
    let seq = 0;
    const tasks = new Map();    // id → { mark, original, sent, saved, rewrite, batch, state, text, instruction, outcome }
    const running = new Map();  // lot → AbortController

    // Derrière l'accueil (une fenêtre modale), comme le reste de la page : il apparaît quand on se met au travail.
    document.body.append(words, fab);

    // ---------------------------------------------------------------- ses petites phrases

    /** Une phrase au-dessus du logo. hint : une ligne plus discrète dessous ; stay : elle reste (il travaille). */
    function say(text, { hint = "", stay = false, error = false } = {}) {
        // Il se tait tant que le grand champ est ouvert : on lui parle, il écoute.
        if (box && !error) return;
        words.querySelector("p").textContent = text;
        const small = words.querySelector("small");
        small.textContent = hint.length > HINT_CHARS ? `…${hint.slice(-HINT_CHARS).trimStart()}` : hint;
        small.hidden = !hint;
        words.classList.toggle("error", error);
        words.classList.add("open");
        clearTimeout(sayTimer);
        if (!stay) sayTimer = setTimeout(hush, SAY_MS);
    }

    function hush() {
        clearTimeout(sayTimer);
        words.classList.remove("open");
    }

    // ---------------------------------------------------------------- la connexion

    function connectCubi() {
        if (cubi) return Promise.resolve(cubi);
        connecting ??= (async () => {
            setPhase("loading", 0);
            say("Je me réveille…", { hint: firstVisit() ? "La première fois, je télécharge mon modèle (429 Mo, une seule fois)." : "", stay: true });
            try {
                base ??= await findModel();
                sdk = await import(new URL("sdk/cubi.js", base).href);
                const { connect } = sdk;
                // Le personnage (le site du modèle en entier) ne s'ouvre que depuis le même site.
                if (new URL(base).origin !== location.origin) ui = false;
                if (ui) buildShell();
                cubi = connect({ ui, container: ui ? shell.querySelector(".cubi-window") : null, title: getTitle() });
            } catch {
                connecting = null;
                setPhase("error", 0, "modèle introuvable");
                say("Je ne trouve pas mon modèle.", { hint: navigator.onLine ? "Le site Web-Agentic-Model ne répond pas." : "Il faut Internet la première fois, pour le charger.", error: true });
                return null;
            }
            cubi.on("state", ({ phase: next, progress, message }) => {
                setPhase(next, progress, message);
                if (next === "loading") say(`Je me réveille… ${progress} %`, { hint: firstVisit() ? "La première fois, je télécharge mon modèle (429 Mo, une seule fois)." : "", stay: true });
                if (next === "error") say("Je ne peux pas démarrer.", { hint: message || "WebGPU est indisponible dans ce navigateur.", error: true });
            });
            cubi.on("greet", () => {
                if (greeted === getTitle() || running.size) return;
                greeted = getTitle();
                // Réveillé : le message du réveil s'efface, sans un mot de plus ; le logo ouvre désormais le grand champ.
                hush();
                if (cm.somethingSelected()) showChip();
            });
            return cubi;
        })();
        return connecting;
    }

    // Le modèle à côté de TextEdit (le même site, ou un dossier posé à côté en local), sinon la version publiée.
    async function findModel() {
        const near = new URL(MODEL_PATH, location.href).href;
        const ok = await fetch(new URL("sdk/cubi.js", near), { method: "HEAD", cache: "no-store" }).then((r) => r.ok).catch(() => false);
        return ok ? near : MODEL_SITE;
    }

    // Le modèle est déjà gardé par le navigateur : pas de téléchargement.
    function firstVisit() {
        try { return !localStorage.getItem("model-cached"); } catch { return true; }
    }

    function restart(nextUi) {
        if (running.size) { say("Je travaille encore : attendez que j'aie fini."); return false; }
        ui = nextUi;
        writePref(ui);
        cubi?.destroy();
        cubi = connecting = null;
        shell?.remove();
        shell = null;
        greeted = "";
        connectCubi();
        return true;
    }

    // Le logo : il se réveille et dit bonjour ; réveillé, il rappelle comment l'utiliser ; au travail, où il en est.
    // Le logo : il se réveille, et le grand champ s'ouvre pour lui demander quelque chose ; un second clic le referme.
    // Endormi ou en train de se réveiller : un clic le réveille, on suit son réveil (pas encore de champ pour écrire).
    // Réveillé : un clic ouvre le grand champ, un autre le referme.
    function wakeUp() {
        connectCubi().then((c) => { if (c && phase === "ready" && greeted !== getTitle()) c.hello(getTitle()); });
        if (box) { closeBox(); return; }
        if (phase !== "ready") { words.classList.add("open"); return; }
        hush();
        openBox();
    }

    // ---------------------------------------------------------------- le grand champ, au-dessus du logo

    function openBox() {
        hideChip();
        closeNote();
        const sel = cm.somethingSelected() && cm.getSelection().trim().length >= MIN_CHARS ? { from: cm.getCursor("from"), to: cm.getCursor("to") } : null;
        box = document.createElement("form");
        box.className = "cubi-ask";
        box.innerHTML = `<textarea rows="3" aria-label="Demande à Cubi" spellcheck="true" placeholder="${sel ? "Que fait-on de la sélection ?" : "Que dois-je écrire ou faire ?\n« ajoute une section sur… », « écris une conclusion », une question…"}"></textarea>
            <div class="cubi-ask-foot"><small>${sel ? "Sur la sélection" : "Je choisis où l'ajouter"} · Entrée pour envoyer</small><button type="submit">Envoyer</button></div>`;
        document.body.append(box);
        const input = box.querySelector("textarea");
        box.addEventListener("submit", (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            closeBox();
            demand(text, sel);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); box.requestSubmit(); }
            else if (e.key === "Escape") { e.stopPropagation(); closeBox(); cm.focus(); }
        });
        input.focus();
    }

    function closeBox() {
        box?.remove();
        box = null;
    }

    // Une demande du grand champ : sur la sélection, relire la page, une question, ou écrire quelque chose à ajouter.
    function demand(text, sel) {
        if (sel) { request("consigne", { instruction: text, from: sel.from, to: sel.to }); return; }
        if (READ_PAGE.test(text)) { request("corriger"); return; }
        connectCubi().then((c) => {
            if (!c) return;
            if (EDIT.test(text.trim())) edit(c, text);
            else if (sdk.isQuestion(text)) question(c, text);
            else compose(c, text);
        });
    }

    // Une question sur le document : il lit tout, puis répond dans une bulle au-dessus du logo.
    function question(c, text) {
        const batch = `q${++seq}`;
        track(batch, true);
        say("C'est noté.", { stay: true });
        c.ask(text, { document: cm.getValue(), title: getTitle(), signal: running.get(batch).signal, ...narrate() })
            .then(({ text: reply }) => {
                if (!reply.trim()) { say("Je n'ai pas réussi à répondre.", { hint: "Reformulez ou réessayez." }); return; }
                feel("joy");
                say("Voilà ma réponse.");
                showNote(text, reply);
            })
            .catch((error) => say(error.name === "AbortError" ? "D'accord, j'arrête." : "Je n'ai pas réussi à répondre.", { hint: error.name === "AbortError" ? "" : error.message }))
            .finally(() => track(batch, false));
    }

    function showNote(asked, reply) {
        closeNote();
        note = document.createElement("div");
        note.className = "menu cubi-pop cubi-note";
        note.innerHTML = `<p class="cubi-q">${esc(asked)}</p><p class="cubi-reply">${esc(reply)}</p>
            <div class="cubi-acts"><button type="button" data-a="insert" class="on">Insérer dans la page</button><button type="button" data-a="copy">Copier</button><button type="button" data-a="close">Fermer</button></div>`;
        document.body.append(note);
        note.addEventListener("mousedown", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            e.preventDefault();
            if (a === "insert") {
                const at = cm.getCursor("to");
                cm.replaceRange(`\n\n${reply}\n`, { line: at.line, ch: cm.getLine(at.line).length }, null, "+cubi");
                toast("Réponse insérée");
            } else if (a === "copy") { navigator.clipboard?.writeText(reply); toast("Réponse copiée"); return; }
            closeNote();
        });
    }

    function closeNote() {
        note?.remove();
        note = null;
    }

    // ---------------------------------------------------------------- modifier : il trouve la partie concernée

    // Les parties du document qu'on peut modifier : les blocs de code (leurs lignes, sans les ```) et les paragraphes.
    function blocks() {
        const units = [];
        let fence = null, start = -1;
        const last = cm.lastLine();
        const range = (from, to) => ({ from: { line: from, ch: 0 }, to: { line: to, ch: cm.getLine(to).length } });
        for (let n = 0; n <= last + 1; n++) {
            const line = n <= last ? cm.getLine(n) : "";
            const open = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
            if (fence) {
                if (/^\s*(```+|~~~+)\s*$/.test(line) || n > last) {
                    if (n - 1 >= fence.line + 1 && cm.getRange(range(fence.line + 1, n - 1).from, range(fence.line + 1, n - 1).to).trim()) units.push({ code: true, lang: fence.lang, ...range(fence.line + 1, n - 1) });
                    fence = null;
                }
                continue;
            }
            const blank = !line.trim() || /^#{1,6}\s/.test(line) || open || n > last;
            if (!blank && start < 0) start = n;
            if (blank && start >= 0) { units.push({ code: false, ...range(start, n - 1) }); start = -1; }
            if (open) fence = { line: n, lang: open[2] || "code" };
        }
        return units.map((u) => {
            const text = cm.getRange(u.from, u.to);
            const first = text.split("\n").find((l) => l.trim())?.trim() ?? "";
            const label = `${u.code ? `bloc ${u.lang}` : "paragraphe"} « ${first.slice(0, 60)}${first.length > 60 ? "…" : ""} »`;
            return { ...u, text, label };
        });
    }

    // Les mots de la demande qui désignent une partie (« print », « carre », « hadamard »).
    const cues = (text) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_.]{3,}/gu) ?? []).filter((w) => !STOP.has(w) && !EDIT.test(w)))];

    // Il trouve la partie : d'après les mots de la demande (du code si elle parle de code) ; s'il hésite, il demande au modèle.
    async function edit(c, text) {
        const units = blocks();
        if (!units.length) { compose(c, text); return; }
        const codeOnly = CODE_WORDS.test(text) && units.some((u) => u.code);
        const pool = codeOnly ? units.filter((u) => u.code) : units;
        const words = cues(text);
        const senses = CODE_SENSE.filter(([said]) => said.test(text.toLowerCase())).map(([, seen]) => seen);
        const score = (u) => words.filter((w) => u.text.toLowerCase().includes(w)).length + (u.code ? senses.filter((seen) => seen.test(u.text)).length : 0);
        const scored = pool.map((u) => ({ u, score: score(u) })).sort((a, b) => b.score - a.score);
        let target = scored.length === 1 || (scored[0].score > 0 && scored[0].score >= 2 * (scored[1]?.score ?? 0)) ? scored[0].u : null;
        if (!target) {
            const candidates = scored.slice(0, 15).map(({ u }) => u);
            say("Je cherche la partie à modifier…", { stay: true });
            const batch = `l${++seq}`;
            track(batch, true);
            try {
                const { place } = await c.locate(text, { outline: candidates.map(({ label }) => ({ label })), title: getTitle(), signal: running.get(batch).signal });
                target = candidates[place ?? 0];
            } catch (error) {
                say(error.name === "AbortError" ? "D'accord, j'arrête." : "Je n'ai pas trouvé quoi modifier.", { hint: error.name === "AbortError" ? "" : "Sélectionnez le passage, puis redemandez." });
                return;
            } finally {
                track(batch, false);
            }
        }
        cm.scrollIntoView({ from: target.from, to: target.to }, 120);
        request("consigne", { instruction: text, from: target.from, to: target.to, label: target.label });
    }

    // ---------------------------------------------------------------- ajouter : il choisit l'endroit

    // Le plan : les titres (## et plus, ou # s'il n'y a qu'eux), sinon les paragraphes ; le dernier endroit : la fin.
    // Chaque endroit : { label, text (ce qu'il contient, pour le contexte), end (sa dernière ligne non vide) }.
    function outline() {
        const last = cm.lastLine();
        const lastFilled = (from, to) => { let n = to; while (n > from && !cm.getLine(n).trim()) n--; return n; };
        const excerpt = (from, to) => cm.getRange({ line: from, ch: 0 }, { line: to, ch: cm.getLine(to).length }).split(/\s+/).slice(0, 400).join(" ");
        const heads = [], paras = [];
        let fence = false, start = -1;
        for (let n = 0; n <= last + 1; n++) {
            const line = n <= last ? cm.getLine(n) : "";
            if (/^\s*(```|~~~)/.test(line)) fence = !fence;
            const head = !fence && /^(#{1,6})\s+\S/.exec(line);
            if (head) heads.push({ n, level: head[1].length });
            // Les paragraphes (blocs séparés par une ligne vide), pour un document sans titres.
            if (line.trim() && !head && start < 0) start = n;
            if ((!line.trim() || head || n > last) && start >= 0 && !fence) { paras.push({ from: start, to: n - 1 }); start = -1; }
        }
        const deep = heads.some((h) => h.level > 1) ? heads.filter((h) => h.level > 1) : heads;
        let spots;
        if (deep.length) {
            spots = deep.map((h) => {
                const next = heads.find((o) => o.n > h.n && o.level <= h.level);
                const end = lastFilled(h.n, next ? next.n - 1 : last);
                return { label: cm.getLine(h.n).trim(), text: excerpt(h.n, end), end };
            });
        } else {
            spots = paras.map(({ from, to }) => {
                const first = cm.getLine(from).trim();
                return { label: `le paragraphe « ${first.slice(0, 60)}${first.length > 60 ? "…" : ""} »`, text: excerpt(from, to), end: to };
            });
        }
        const end = lastFilled(0, last);
        return [...spots.slice(0, 39), { label: "la fin du document", text: excerpt(Math.max(0, end - 12), end), end }];
    }

    function compose(c, text) {
        const spots = outline();
        const batch = `w${++seq}`;
        track(batch, true);
        say("C'est noté.", { stay: true });
        c.compose(text, { document: cm.getValue(), outline: spots.map(({ label, text: t }) => ({ label, text: t })), title: getTitle(), signal: running.get(batch).signal, ...narrate() })
            .then(({ text: written, place }) => {
                if (!written.trim()) { say("Je n'ai pas réussi à l'écrire.", { hint: "Reformulez ou réessayez." }); return; }
                const spot = spots[place] ?? spots[spots.length - 1];
                propose(spot, written);
                feel("joy");
                say(`Je l'ajoute après ${spot.label.startsWith("#") ? `« ${spot.label.replace(/^#+\s*/, "")} »` : spot.label}.`, { hint: "✓ pour le garder, ✕ pour l'annuler." });
            })
            .catch((error) => say(error.name === "AbortError" ? "D'accord, j'arrête." : "Je n'ai pas réussi à l'écrire.", { hint: error.name === "AbortError" ? "" : error.message }))
            .finally(() => track(batch, false));
    }

    // L'ajout, montré à sa place (sous la ligne choisie), en vert : ✓ l'écrit dans le document, ✕ l'oublie.
    function propose(spot, text) {
        const bookmark = cm.setBookmark({ line: spot.end, ch: cm.getLine(spot.end).length });
        const block = document.createElement("div");
        block.className = "cubi-ins cubi-ins-block cubi-new";
        block.innerHTML = `<div class="cubi-new-head"><span>Ajout proposé</span><span class="cubi-ok"><button type="button" data-a="apply" class="cubi-ok-text" title="Ajouter ce texte au document">${ICON_OK}Ajouter</button><button type="button" data-a="skip" title="Ne pas l'ajouter" aria-label="Ne pas l'ajouter">${ICON_NO}</button></span></div><div class="cubi-new-text">${preview(text, esc)}</div>`;
        const widget = cm.addLineWidget(spot.end, block);
        const addition = { widget, bookmark };
        additions.add(addition);
        updateCount();
        block.addEventListener("mousedown", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            e.preventDefault();
            e.stopPropagation();
            if (a === "apply") {
                const at = bookmark.find() ?? { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length };
                const next = at.line < cm.lastLine() ? cm.getLine(at.line + 1) : "";
                cm.replaceRange(`\n\n${text}${next.trim() ? "\n" : ""}`, at, null, "+cubi");
            }
            widget.clear();
            bookmark.clear();
            additions.delete(addition);
            updateCount();
            cm.focus();
        });
        cm.scrollIntoView({ line: spot.end, ch: 0 }, 160);
    }

    // L'expression du logo. Au repos, elle suit l'état : il dort pendant son réveil, il est triste s'il ne peut pas démarrer.
    let joyUntil = 0;
    function feel(mood) {
        if (mood === "joy") joyUntil = performance.now() + JOY_MS;
        else if (performance.now() < joyUntil) return;
        fab.dataset.mood = mood;
        if (mood === "joy") setTimeout(() => { if (fab.dataset.mood === "joy") feel(resting()); }, JOY_MS + 20);
    }
    const resting = () => (phase === "off" || phase === "loading" ? "sleep" : phase === "error" ? "sad" : running.size ? fab.dataset.mood : "idle");

    function setPhase(next, progress = 0, message = "") {
        phase = next;
        if (!running.size || next !== "ready") feel(resting());
        fab.dataset.state = next === "ready" && running.size ? "busy" : next;
        fab.style.setProperty("--p", `${progress}%`);
        const label = next === "loading" ? `se réveille… ${progress} %` : next === "error" ? message || "indisponible" : next === "ready" ? (running.size ? "travaille…" : "avec son personnage") : "";
        for (const el of document.querySelectorAll(".cubi-state")) el.textContent = label;
    }

    // ---------------------------------------------------------------- le site du modèle en entier, dans sa fenêtre

    function buildShell() {
        shell = document.createElement("div");
        shell.className = "cubi-shell";
        shell.innerHTML = `<div class="cubi-window" role="dialog" aria-label="Cubi">
            <header>${FACE}<b>Cubi</b><span class="cubi-state"></span>
                <button type="button" class="cubi-light" title="Le modèle seul, sans personnage : plus léger">Mode léger</button>
                <button type="button" class="cubi-close" aria-label="Fermer : il continue en arrière-plan" title="Fermer (il continue en arrière-plan)">×</button></header>
        </div>`;
        document.body.append(shell);
        shell.querySelector(".cubi-close").addEventListener("click", hideShell);
        shell.querySelector(".cubi-light").addEventListener("click", () => { if (restart(false)) { hideShell(); say("Je repasse en mode léger."); } });
        shell.addEventListener("mousedown", (e) => { if (e.target === shell) hideShell(); });
    }

    function showShell() {
        if (base && new URL(base).origin !== location.origin) {
            say("Mon personnage ne s'ouvre que sur le site publié.", { hint: "Ici, je travaille en mode léger." });
            return;
        }
        if (!ui) {
            if (!restart(true)) return;
            say("Je redémarre avec mon personnage.", { stay: true });
        }
        connectCubi().then(() => { shell?.classList.add("open"); closePop(); hideChip(); });
    }

    function hideShell() {
        shell?.classList.remove("open");
        cm.focus();
    }

    // ---------------------------------------------------------------- le travail en cours

    function track(batch, on) {
        if (on) running.set(batch, new AbortController());
        else running.delete(batch);
        setPhase(phase);
    }

    function stopAll() {
        for (const [batch, abort] of running) { abort.abort(); cubi?.cancel(batch); }
    }

    // Ce qu'il fait, dit au fil de l'eau : l'étape, sa réflexion (sa dernière ligne, en petit), puis il écrit.
    function narrate() {
        let writing = false;
        return {
            onStep: (text) => { feel("read"); if (!writing) say(text, { stay: true }); },
            onThought: (text) => {
                if (writing) return;
                feel("think");
                say("Je réfléchis…", { hint: text.trim().split("\n").filter(Boolean).at(-1) ?? "", stay: true });
            },
            onText: () => {
                feel("write");
                if (!writing) say("J'écris…", { stay: true });
                writing = true;
            },
        };
    }

    // ---------------------------------------------------------------- les passages à confier

    // Les paragraphes de texte entre from et to (le code, les formules en bloc et les commentaires sont sautés).
    function segments(from, to) {
        const parts = [];
        let fence = false, math = false, comment = false, current = null;
        const flush = () => { if (current) parts.push(current); current = null; };
        for (let n = 0; n <= Math.min(to.line, cm.lastLine()); n++) {
            const line = cm.getLine(n);
            const t = line.trim();
            if (/^(```|~~~)/.test(t)) { fence = !fence; flush(); continue; }
            if (t.startsWith("$$") && !(t.length > 2 && t.endsWith("$$"))) { math = !math; flush(); continue; }
            if (t.startsWith("<!--")) comment = !t.includes("-->");
            else if (comment) { if (t.includes("-->")) comment = false; continue; }
            if (fence || math || n < from.line || !t || t.startsWith("<!--") || t.startsWith("|") || /^\$\$.*\$\$$/.test(t)) { flush(); continue; }
            const prefix = (PREFIX.exec(line) || ["", ""])[1];
            const start = n === from.line ? Math.max(from.ch, prefix.length) : prefix.length;
            const end = n === to.line ? Math.min(to.ch, line.length) : line.length;
            if (end <= start) continue;
            // Un titre, un élément de liste ou une citation est un passage à lui seul.
            if (prefix || !current) { flush(); current = { from: { line: n, ch: start }, to: { line: n, ch: end }, prefix }; }
            else current.to = { line: n, ch: end };
            if (prefix) flush();
        }
        flush();
        return parts.filter((p) => cm.getRange(p.from, p.to).trim().length >= MIN_CHARS).slice(0, MAX_PARTS);
    }

    function protect(text) {
        const saved = [];
        // Les retours à la ligne d'un même paragraphe deviennent des espaces ; les paragraphes restent séparés.
        const sent = text.replace(PROTECT, (m) => { saved.push(m); return `⟦${saved.length}⟧`; })
            .split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).join("\n\n");
        return { sent, saved };
    }

    const restore = (text, saved) => text.replace(/⟦(\d+)⟧/g, (m, n) => saved[n - 1] ?? m);
    const markers = (text) => (text.match(/⟦\d+⟧/g) || []).sort().join(",");

    // La sélection est du code (dans un bloc ``` ou ~~~) : ses lignes de clôture sont laissées de côté.
    function codeRange(from, to) {
        let fence = false;
        for (let n = 0; n < from.line; n++) if (/^\s*(```|~~~)/.test(cm.getLine(n))) fence = !fence;
        const fenceLine = (n) => /^\s*(```|~~~)/.test(cm.getLine(n));
        if (!fence && !fenceLine(from.line)) return null;
        if (fenceLine(from.line)) from = { line: from.line + 1, ch: 0 };
        if (fenceLine(to.line) && to.line > from.line) to = { line: to.line - 1, ch: cm.getLine(to.line - 1).length };
        return cm.getRange(from, to).trim() ? { from, to } : null;
    }

    /**
     * Confie un passage à Cubi. Sans from : toute la page, paragraphe par paragraphe (une relecture).
     * action : corriger (relecture) · consigne (une demande libre sur la sélection : réécriture ou question).
     */
    function request(action, { instruction = "", from, to, label = "" } = {}) {
        const page = !from;
        if (page) { from = { line: 0, ch: 0 }; to = { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length }; }
        // Du code : envoyé tel quel, à un développeur. Du texte : ses formules, son code et ses liens sont protégés.
        let code = page ? null : codeRange(from, to);
        // Une sélection qui mêle du texte et un bloc de code : le bloc, si la demande parle de code ou s'il n'y a pas de texte.
        if (!page && !code) {
            const inside = blocks().filter((u) => u.code && u.from.line >= from.line && u.to.line <= to.line);
            if (inside.length && (CODE_WORDS.test(instruction) || !segments(from, to).length)) code = { from: inside[0].from, to: inside[0].to };
        }
        const parts = code ? [code] : segments(from, to);
        if (!parts.length) { say("Rien à réécrire ici.", { hint: "Sélectionnez du texte, ou du code dans un bloc." }); return; }
        // Une demande libre : un seul passage, toute la sélection.
        const units = page ? parts : [{ from: parts[0].from, to: parts[parts.length - 1].to }];
        const batch = `b${++seq}`;
        const outcome = { left: units.length, of: units.length, list: [] };
        track(batch, true);
        const signal = running.get(batch).signal;
        const story = narrate();
        say(page ? `Je relis toute la page (${units.length} paragraphe${units.length > 1 ? "s" : ""}).` : label ? `Je modifie le ${label}.` : "C'est noté.", { stay: true });

        units.forEach((part, i) => {
            const original = cm.getRange(part.from, part.to);
            const { sent, saved } = code ? { sent: original, saved: [] } : protect(original);
            // Il voit ce que cachent les marqueurs (le code, la formule), pour comprendre le passage.
            const id = `${batch}-${i}`;
            const mark = cm.markText(part.from, part.to, { className: "cubi-mark cubi-sent", inclusiveLeft: false, inclusiveRight: false });
            mark.cubi = id;
            const task = { id, batch, mark, original, sent, saved, state: "sent", text: "", rewrite: page, instruction, code: Boolean(code) };
            tasks.set(id, task);
            outcome.list.push(task);
            connectCubi().then((c) => {
                if (!c) { drop(task); finish(); return; }
                c.run({ id, batch, part: i + 1, of: units.length, action, instruction, text: sent, keep: saved, code: Boolean(code), document: page ? "" : cm.getValue(), think: !page }, {
                    signal,
                    onStart: () => { task.state = "working"; restyle(task); feel("read"); if (page) say(`Je relis le paragraphe ${i + 1} sur ${units.length}…`, { stay: true }); },
                    ...(page ? { onText: () => feel("write") } : story),
                }).then((result) => settle(task, result))
                    .catch((error) => { task.outcome = error.name === "AbortError" ? "stopped" : "error"; task.error = error.message; drop(task); })
                    .finally(finish);
            });
        });

        function finish() {
            if (--outcome.left > 0) return;
            track(batch, false);
            const ready = [...tasks.values()].filter((t) => t.batch === batch && t.state === "ready");
            if (ready.length) feel("joy");
            if (signal.aborted) { say("D'accord, j'arrête."); return; }
            if (page) {
                say(ready.length ? `J'ai changé ${ready.length} paragraphe${ready.length > 1 ? "s" : ""}.` : "J'ai tout relu : rien à changer.", { hint: ready.length ? "✓ pour garder, ✕ pour revenir, au bout de chaque paragraphe." : "" });
                return;
            }
            const [task] = outcome.list;
            if (task.state === "ready" && tasks.has(task.id)) {
                if (task.rewrite) {
                    say("Voilà, mes changements sont dans le texte.", { hint: "✓ pour les garder, ✕ pour revenir en arrière." });
                    const range = task.mark.find();
                    if (range) cm.scrollIntoView({ from: range.from, to: range.to }, 80);
                } else {
                    say("Voilà ma réponse.");
                    openPop(task);
                }
                return;
            }
            const why = {
                empty: ["Je n'ai pas réussi à finir.", "Reformulez ou réessayez."],
                broken: ["J'ai abîmé une formule ou un lien.", "Je préfère ne rien proposer."],
                error: ["Un problème m'a arrêté.", task.error || "Réessayez."],
                stopped: ["D'accord, j'arrête.", ""],
                same: [task.code ? "Je n'ai pas réussi à modifier ce code." : "Rien à changer.", task.code ? "Précisez la demande (quelle ligne, quoi remplacer), puis réessayez." : "Le passage me semble correct."],
            };
            const [text, hint] = why[task.outcome] ?? ["Rien à changer.", "Le passage me semble correct."];
            say(text, { hint });
        }
    }

    function settle(task, data) {
        // Pourquoi il n'y a rien à proposer : rien à changer, il n'a pas fini, ou il a abîmé une formule.
        const fail = (why) => { task.outcome = why; drop(task); };
        if (!data.text?.trim()) { fail("empty"); return; }
        // Une demande libre peut être une réécriture ou une question : c'est le modèle qui en a décidé.
        task.rewrite = data.rewrite;
        if (data.rewrite) {
            if (data.text.replace(/\s+/g, " ").trim() === task.sent.replace(/\s+/g, " ").trim()) { fail("same"); return; }
            // Une formule ou un lien abîmé : la proposition n'est pas gardée.
            if (markers(data.text) !== markers(task.sent)) { fail("broken"); return; }
            task.text = restore(data.text, task.saved);
        } else {
            task.text = data.text;
        }
        task.state = "ready";
        restyle(task);
        if (task.rewrite) decorate(task);
        updateCount();
    }

    // Les changements, sur les mots mêmes : ce qui part est barré, ce qui arrive est écrit en vert à sa place
    // (un paragraphe ajouté : sous la ligne). Au bout du passage : ✓ garder, ✕ revenir (et « tout garder » s'il y en a d'autres).
    function decorate(task) {
        undecorate(task);
        const range = task.mark.find();
        if (!range) return;
        const base = cm.indexFromPos(range.from);
        const at = (offset) => cm.posFromIndex(base + offset);
        let offset = 0;
        // Du code se compare ligne à ligne : une ligne changée est barrée, sa nouvelle version écrite à côté.
        for (const { kind, text } of diffOps(task.original, task.text, task.code ? /(\n)/ : undefined)) {
            if (kind === "same") { offset += text.length; continue; }
            if (kind === "del") {
                const lead = text.length - text.trimStart().length, core = text.trim().length;
                if (core) task.decor.push(cm.markText(at(offset + lead), at(offset + lead + core), { className: "cubi-del" }));
                offset += text.length;
                continue;
            }
            if (text.includes("\n")) {
                const block = document.createElement("div");
                block.className = `cubi-ins cubi-ins-block${task.code ? " cubi-ins-code" : ""}`;
                block.textContent = task.code ? text.replace(/^\n+|\n+$/g, "") : text.trim();
                task.decor.push(cm.addLineWidget(at(offset).line, block));
            } else {
                const span = document.createElement("span");
                span.className = "cubi-ins";
                span.textContent = text;
                task.decor.push(cm.setBookmark(at(offset), { widget: span, insertLeft: true }));
            }
        }
        const others = [...tasks.values()].filter((t) => t.batch === task.batch && t.state === "ready" && t.rewrite).length > 1;
        const bar = document.createElement("span");
        bar.className = "cubi-ok";
        bar.innerHTML = `<button type="button" data-a="apply" title="Garder ces changements" aria-label="Garder ces changements">${ICON_OK}</button><button type="button" data-a="skip" title="Revenir au texte d'origine" aria-label="Revenir au texte d'origine">${ICON_NO}</button>${others ? `<button type="button" data-a="all" class="cubi-ok-text" title="Garder tous les changements de cette relecture">Tout garder</button>` : ""}`;
        bar.addEventListener("mousedown", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            e.preventDefault();
            e.stopPropagation();
            if (a === "apply") apply(task);
            else if (a === "all") cm.operation(() => [...tasks.values()].filter((t) => t.batch === task.batch && t.state === "ready" && t.rewrite).forEach(apply));
            else drop(task);
            cm.focus();
        });
        task.decor.push(cm.setBookmark(range.to, { widget: bar, handleMouseEvents: true }));
    }

    function undecorate(task) {
        task.decor?.forEach((d) => d.clear());
        task.decor = [];
    }

    function restyle(task) {
        const range = task.mark.find();
        task.mark.clear();
        if (!range) { tasks.delete(task.id); return; }
        const cls = task.state === "ready" ? (task.rewrite ? "cubi-mark cubi-changed" : "cubi-mark cubi-answer") : `cubi-mark cubi-${task.state}`;
        const title = task.state !== "ready" ? "Cubi s'en occupe…" : task.rewrite ? "Changements de Cubi : ✓ pour garder, ✕ pour revenir" : "Réponse de Cubi : cliquez";
        task.mark = cm.markText(range.from, range.to, { className: cls, title });
        task.mark.cubi = task.id;
    }

    function drop(task) {
        undecorate(task);
        task.mark.clear();
        tasks.delete(task.id);
        updateCount();
    }

    function updateCount() {
        const n = [...tasks.values()].filter((t) => t.state === "ready").length + additions.size;
        const badge = fab.querySelector(".cubi-count");
        badge.hidden = !n;
        badge.textContent = n;
        setPhase(phase);
    }

    // ---------------------------------------------------------------- les propositions, à côté du passage

    function apply(task) {
        const range = task.mark.find();
        undecorate(task);
        if (!range || cm.getRange(range.from, range.to) !== task.original) {
            toast("Le passage a changé depuis : proposition ignorée");
        } else {
            cm.replaceRange(task.text, range.from, range.to, "+cubi");
        }
        drop(task);
    }

    function openPop(task) {
        closePop();
        const range = task.mark.find();
        if (!range) return;
        const ready = [...tasks.values()].filter((t) => t.state === "ready" && t.rewrite);
        pop = document.createElement("div");
        pop.className = "menu cubi-pop";
        pop.innerHTML = task.rewrite
            ? `<p class="cubi-diff">${diff(task.original, task.text, esc)}</p>
               <div class="cubi-acts"><button type="button" data-a="apply" class="on">Appliquer</button><button type="button" data-a="skip">Ignorer</button>${ready.length > 1 ? `<button type="button" data-a="all">Tout appliquer (${ready.length})</button>` : ""}</div>`
            : `<p class="cubi-q">${esc(task.instruction)}</p><p class="cubi-reply">${esc(task.text)}</p>
               <div class="cubi-acts"><button type="button" data-a="insert" class="on">Insérer en dessous</button><button type="button" data-a="copy">Copier</button><button type="button" data-a="skip">Fermer</button></div>`;
        document.body.append(pop);
        const at = cm.charCoords(range.to, "window");
        const h = pop.offsetHeight;
        Object.assign(pop.style, { left: `${Math.max(8, Math.min(at.left - 40, innerWidth - pop.offsetWidth - 8))}px`, top: `${at.bottom + h + 10 > innerHeight ? Math.max(8, at.top - h - 8) : at.bottom + 8}px` });
        pop.addEventListener("mousedown", (e) => {
            const a = e.target.closest("[data-a]")?.dataset.a;
            if (!a) return;
            e.preventDefault();
            if (a === "apply") apply(task);
            else if (a === "all") cm.operation(() => ready.forEach(apply));
            else if (a === "insert") { cm.replaceRange(`\n\n${task.text}`, { line: range.to.line, ch: cm.getLine(range.to.line).length }, null, "+cubi"); drop(task); }
            else if (a === "copy") { navigator.clipboard?.writeText(task.text); toast("Réponse copiée"); }
            else drop(task);
            closePop();
        });
    }

    function closePop() {
        pop?.remove();
        pop = null;
    }

    // ---------------------------------------------------------------- la sélection : « Que fait-on ? »

    // Seulement une fois réveillé : avant, une sélection reste une simple sélection.
    function showChip() {
        if (phase !== "ready" || !cm.somethingSelected() || cm.getSelection().trim().length < MIN_CHARS || shell?.classList.contains("open")) { hideChip(); return; }
        if (!chip) {
            chip = document.createElement("form");
            chip.className = "menu cubi-chip";
            chip.innerHTML = `${FACE}<input type="text" placeholder="Que fait-on ?" aria-label="Demande à Cubi sur la sélection" spellcheck="true">`;
            document.body.append(chip);
            chip.addEventListener("submit", (e) => {
                e.preventDefault();
                const instruction = chip.querySelector("input").value.trim();
                if (!instruction) return;
                const { from, to } = chip.range;
                hideChip();
                cm.focus();
                cm.setCursor(to);
                if (READ_PAGE.test(instruction)) request("corriger");
                else request("consigne", { instruction, from, to });
            });
            chip.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Escape") { hideChip(); cm.focus(); } });
        }
        // La sélection est gardée : en cliquant dans la bulle, l'éditeur perd le focus, pas la demande.
        chip.range = { from: cm.getCursor("from"), to: cm.getCursor("to") };
        const at = cm.charCoords(chip.range.to, "window");
        Object.assign(chip.style, { left: `${Math.max(8, Math.min(at.left - 40, innerWidth - chip.offsetWidth - 8))}px`, top: `${Math.min(at.bottom + 8, innerHeight - chip.offsetHeight - 40)}px` });
    }

    function hideChip() {
        chip?.remove();
        chip = null;
    }

    // ---------------------------------------------------------------- événements

    fab.addEventListener("click", wakeUp);
    // Au repos, ses yeux suivent la souris (un peu).
    let gaze = 0;
    addEventListener("pointermove", (e) => {
        if (gaze || fab.dataset.mood !== "idle") return;
        gaze = requestAnimationFrame(() => {
            gaze = 0;
            const box = fab.getBoundingClientRect();
            const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
            const d = Math.hypot(dx, dy) || 1;
            fab.style.setProperty("--lx", `${((dx / d) * Math.min(1.6, d / 60)).toFixed(2)}px`);
            fab.style.setProperty("--ly", `${((dy / d) * Math.min(1.2, d / 60)).toFixed(2)}px`);
        });
    }, { passive: true });
    cm.on("cursorActivity", () => {
        if (chip?.contains(document.activeElement)) return;
        if (chip || cm.somethingSelected()) requestAnimationFrame(showChip);
    });
    cm.on("mousedown", (_, e) => {
        closePop();
        const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, "window");
        const mark = cm.findMarksAt(pos).find((m) => m.cubi && tasks.get(m.cubi)?.state === "ready" && !tasks.get(m.cubi).rewrite);
        if (mark) { e.preventDefault(); openPop(tasks.get(mark.cubi)); }
    });
    cm.on("scroll", () => { closePop(); hideChip(); });
    addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (pop) closePop();
        else if (note) closeNote();
        else if (shell?.classList.contains("open")) hideShell();
        else if (running.size) stopAll();
        else hush();
    });

    return {
        open: wakeUp,
        /** Relit toute la page, paragraphe par paragraphe. */
        review: () => connectCubi().then((c) => c && request("corriger")),
        /** Le site du modèle en entier, avec son personnage. */
        watch: showShell,
    };
}

// Différences mot à mot (plus longue sous-suite commune) : [{ kind: same | del | ins, text }], les morceaux voisins
// de même sorte réunis. Les textes « same » et « del », mis bout à bout, redonnent exactement `before`.
// split : le découpage (ligne à ligne pour du code).
export function diffOps(before, after, split = /(\s+)/) {
    const a = before.split(split), b = after.split(split);
    const n = a.length, m = b.length;
    if (n * m > 400000) return [{ kind: "del", text: before }, { kind: "ins", text: after }];
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const ops = [];
    const push = (kind, text) => { const last = ops[ops.length - 1]; if (last?.kind === kind) last.text += text; else ops.push({ kind, text }); };
    let i = 0, j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { push("same", a[i]); i++; j++; }
        else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) { push("del", a[i]); i++; }
        else { push("ins", b[j]); j++; }
    }
    return ops;
}

// Les mêmes différences en HTML : ce qui est retiré barré, puis ce qui est ajouté en couleur.
export function diff(before, after, esc) {
    // Un changement : « ancien » barré puis « nouveau », les espaces de bord laissés dehors.
    return diffOps(before, after).map(({ kind, text }) => {
        if (kind === "same") return esc(text);
        const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
        return core ? `${lead}<${kind}>${esc(core)}</${kind}>${trail}` : (kind === "ins" ? text : "");
    }).join("").replace(/<\/del><ins>/g, "</del> <ins>");
}

// Le diagramme du projet (« /diagramme ») : un arbre de connaissance, des cellules reliées dans un espace libre. Le
// projet au centre ; d'un clic, une cellule déplie autour d'elle ce qu'elle contient — dossiers, pages, sections et
// sous-sections, blocs de code, puis ce que chaque bloc définit (fonctions, tables, variables). Les cellules se
// placent d'elles-mêmes (elles s'attirent par leurs liens, se repoussent sinon), et l'on peut les déplacer. Des
// courbes relient ce qui dépend de quoi (deps.js : qui fournit quelle variable à qui) et les liens entre pages
// ([[…]]). La fiche, à côté, dit tout ce qui relie la cellule choisie au reste ; un clic sur une relation y mène.
// Un bloc de code déplié montre son code, coloré et numéroté ; les noms qu'il donne à un autre bloc ou qu'il en reçoit
// y sont marqués, et une courbe va du nom, là où il est défini, au même nom, là où l'autre bloc s'en sert.
//
// Les concepts de la page (le modèle du document, modele/) s'y ajoutent, dans la section qui les définit : classes et
// leurs champs, tableaux, données, actions — avec leur sorte, ce dont ils sont une sorte, et les blocs qui les lisent.
//
// Gestes : glisser le fond pour se déplacer, la molette ou deux doigts pour zoomer, glisser une cellule pour la
// poser ailleurs, double clic pour l'ouvrir dans le document ; « / » cherche, Échap ferme.

import { highlightLines } from "./render.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const KIND = { root: "Projet", dir: "Dossier", page: "Page", sec: "Section", code: "Bloc de code", fn: "Fonction", table: "Table", var: "Variable",
    cls: "Classe", mdt: "Tableau", dat: "Donnée", act: "Action", fld: "Champ" };
const CONCEPT = new Set(["cls", "mdt", "dat", "act", "fld"]);
const plural = (n, one, many = one + "s") => `${n} ${n > 1 ? many : one}`;
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// d'une ouverture à l'autre (le temps de la session) : ce qui est déplié, où sont les cellules, où l'on regardait
const opened = new Set();
const place = new Map();
let camera = null;

/**
 * data : { pages: [{ k, name, dir, items: [{ kind: "h", level, text, line } | { kind: "code", lang, label, line, e }],
 *          links: [{ from: index d'item ou -1 (la page), to: k }] }],
 *          entries: [{ page, n, lang, line, defs: { fn: [], table: [], var: [] }, uses: [{ name, from }] }],
 *          deps: [{ from, to, names }] }
 * go(k, line) : ouvrir la page k à la ligne (le diagramme se ferme).
 */
let closeOpen = null;   // le diagramme ouvert (rouvert par-dessus : l'ancien se ferme vraiment, son écoute du clavier aussi)

export function openDiagram(data, { go, current = 0, title = "Projet" } = {}) {
    closeOpen?.();
    document.querySelector("#diagram")?.remove();

    // ---------------------------------------------------------------- l'arbre
    const nodes = new Map();
    const add = (node, parent) => {
        node.children = [];
        node.parent = parent?.id ?? null;
        node.depth = parent ? parent.depth + 1 : 0;
        nodes.set(node.id, node);
        parent?.children.push(node);
        return node;
    };
    const root = add({ id: "root", kind: "root", title }, null);
    const dirNode = (path) => {
        if (!path) return root;
        const id = "d:" + path;
        if (nodes.has(id)) return nodes.get(id);
        const cut = path.lastIndexOf("/");
        return add({ id, kind: "dir", title: path.slice(cut + 1) + "/", path }, dirNode(cut < 0 ? "" : path.slice(0, cut)));
    };
    const codeId = (e) => "c:" + e, pageId = (k) => "p:" + k;
    const itemNode = new Map();   // « k:index d'item » → nœud (pour les liens)
    for (const p of data.pages) {
        const page = add({ id: pageId(p.k), kind: "page", title: p.name, k: p.k, line: 0 }, dirNode(p.dir));
        const stack = [{ level: 1, node: page }];
        p.items.forEach((it, i) => {
            if (it.kind === "h") {
                while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
                const sec = add({ id: `s:${p.k}:${it.line}`, kind: "sec", title: it.text, k: p.k, line: it.line, level: it.level }, stack[stack.length - 1].node);
                stack.push({ level: it.level, node: sec });
                itemNode.set(`${p.k}:${i}`, sec);
                return;
            }
            const en = it.e != null ? data.entries[it.e] : null;
            const n = en?.n ?? (/bloc (\d+)/.exec(it.label)?.[1] || "");
            const code = add({ id: it.e != null ? codeId(it.e) : `x:${p.k}:${it.line}`, kind: "code", title: `bloc ${n}`, lang: it.lang || "texte", k: p.k, line: it.line, e: it.e, code: en?.code ?? "", sec: stack[stack.length - 1].node.kind === "sec" ? stack[stack.length - 1].node.title : "" }, stack[stack.length - 1].node);
            itemNode.set(`${p.k}:${i}`, code);
            if (!en) return;
            for (const [kind, list] of [["fn", en.defs.fn], ["table", en.defs.table], ["var", en.defs.var]]) {
                for (const name of list) add({ id: `n:${it.e}:${name}`, kind, title: name, k: p.k, line: it.line, e: it.e, name }, code);
            }
        });
    }

    // les concepts (data.concepts) : sous la section de la page qui les définit (la dernière au-dessus de leur ligne)
    const secOf = (k, line) => {
        let best = nodes.get(pageId(k));
        if (line != null) for (const n of nodes.values()) if (n.kind === "sec" && n.k === k && n.line <= line && (best.kind !== "sec" || n.line >= best.line)) best = n;
        return best;
    };
    const conceptId = (name) => "m:" + name;
    for (const c of data.concepts || []) {
        const at = secOf(c.k, c.line);
        if (!at) continue;
        const node = add({ id: conceptId(c.name), kind: c.kind, title: c.name.replace(/_/g, " "), k: c.k, line: c.line ?? 0, sum: c.sum }, at);
        for (const f of c.fields) add({ id: `${conceptId(c.name)}.${f.name}`, kind: "fld", title: f.name.replace(/_/g, " "), k: c.k, line: c.line ?? 0, sum: f.sum }, node);
    }

    // ---------------------------------------------------------------- les relations (dans les deux sens)
    const rel = new Map();
    const push = (a, r) => (rel.get(a) ?? rel.set(a, []).get(a)).push(r);
    const relate = (a, b, how, back, names = [], type = "dep") => {
        if (!nodes.has(a) || !nodes.has(b) || a === b) return;
        push(a, { id: b, how, names, type, out: true });
        push(b, { id: a, how: back, names, type, out: false });
    };
    for (const p of data.pages) for (const l of p.links) {
        const from = l.from >= 0 ? itemNode.get(`${p.k}:${l.from}`)?.id : pageId(p.k);
        if (from) relate(from, pageId(l.to), "lien vers", "lien depuis", [], "link");
    }
    for (const d of data.deps) {
        relate(codeId(d.from), codeId(d.to), "fournit à", "utilise", d.names);
        for (const name of d.names) {
            const def = `n:${d.from}:${name.replace(/^table:/, "")}`;
            if (nodes.has(def)) relate(def, codeId(d.to), "utilisé par", "lit", [], "use");
        }
    }
    // entre pages : ce qu'une page prend à une autre (par ses blocs)
    const pageDeps = new Map();
    for (const d of data.deps) {
        const a = data.entries[d.from].page, b = data.entries[d.to].page;
        if (a === b) continue;
        const key = `${a}>${b}`;
        if (!pageDeps.has(key)) pageDeps.set(key, { a, b, names: new Set() });
        d.names.forEach((n) => pageDeps.get(key).names.add(n));
    }
    for (const { a, b, names } of pageDeps.values()) relate(pageId(a), pageId(b), "fournit à", "dépend de", [...names], "pagedep");
    for (const c of data.concepts || []) {
        const id = conceptId(c.name);
        if (c.parent) relate(id, conceptId(c.parent), "est une sorte de", "a pour sorte", [], "isa");
        for (const e of c.useBlocks) relate(codeId(e), id, "lit", "lu par", [], "use");
        for (const e of c.defBlocks) relate(codeId(e), id, "définit", "défini par", [], "use");
    }

    const count = (n, acc = { sec: 0, code: 0, fn: 0, table: 0, var: 0, page: 0, dir: 0 }) => {
        for (const c of n.children) { acc[c.kind] = (acc[c.kind] || 0) + 1; count(c, acc); }
        return acc;
    };
    const summary = (n) => {
        const c = count(n);
        if (n.kind === "code") {
            return [c.fn && plural(c.fn, "fonction"), c.table && plural(c.table, "table"), c.var && plural(c.var, "variable")].filter(Boolean).join(" · ") || (n.e == null ? "" : "rien de défini");
        }
        if (CONCEPT.has(n.kind)) return n.sum || "";
        if (n.kind === "fn" || n.kind === "table" || n.kind === "var") {
            const users = (rel.get(n.id) || []).filter((r) => r.how === "utilisé par").length;
            return users ? `utilisé par ${plural(users, "bloc")}` : "";
        }
        return [c.dir && plural(c.dir, "dossier"), c.page && plural(c.page, "page"), c.sec && plural(c.sec, "section"), c.code && plural(c.code, "bloc")].filter(Boolean).join(" · ");
    };
    const label = (n) => (n.kind === "code" ? `${n.lang} · ${n.title}` : n.title);
    const pageOf = (n) => nodes.get(pageId(n.k));

    // ce qui est déplié : par défaut, le projet, ses dossiers, et le chemin de la page ouverte
    for (const id of [...opened]) if (!nodes.has(id)) opened.delete(id);
    if (!opened.size) {
        opened.add("root");
        for (const c of root.children) if (c.kind === "dir") opened.add(c.id);
        for (let n = nodes.get(nodes.get(pageId(current))?.parent); n; n = nodes.get(n.parent)) opened.add(n.id);
    }

    // ---------------------------------------------------------------- la fenêtre
    const box = document.createElement("div");
    box.id = "diagram";
    box.className = "dg";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Diagramme du projet");
    const all = count(root);
    box.innerHTML = `<header class="dg-head">
        <div class="dg-titles"><h2>Diagramme du projet</h2><p>${[all.dir && plural(all.dir, "dossier"), plural(all.page, "page"), plural(all.sec, "section"), plural(all.code, "bloc"), plural(data.deps.length, "dépendance")].filter(Boolean).join(" · ")}</p></div>
        <input type="search" class="dg-search" placeholder="Chercher (une page, une fonction, une table…)" aria-label="Chercher dans le diagramme">
        <div class="dg-tools"><button type="button" data-act="open" title="Déplier tout, jusqu'aux blocs">Tout déplier</button><button type="button" data-act="code" title="Déplier tous les blocs de code : leur code et les variables qui les relient">Tout le code</button><button type="button" data-act="fold">Replier</button><button type="button" data-act="fit" title="Tout voir">Recentrer</button></div>
        <button type="button" class="dg-close" aria-label="Fermer (Échap)">×</button></header>
        <div class="dg-main"><div class="dg-space"><div class="dg-world"><svg class="dg-links" aria-hidden="true"></svg><div class="dg-cells"></div><svg class="dg-links dg-names" aria-hidden="true"></svg></div>
          <p class="dg-hint">glisser : se déplacer · molette, deux doigts : zoomer · clic : déplier · double clic : ouvrir</p></div>
        <aside class="dg-card" aria-live="polite"></aside></div>`;
    const space = box.querySelector(".dg-space"), world = box.querySelector(".dg-world"), svg = box.querySelector(".dg-links");
    const layer = box.querySelector(".dg-cells"), card = box.querySelector(".dg-card"), search = box.querySelector(".dg-search");
    const over = box.querySelector(".dg-names");
    let selected = pageId(current), hits = new Set(), focusName = null;
    if (!nodes.has(selected)) selected = "root";

    // ---------------------------------------------------------------- les cellules visibles
    const isCard = (n) => n.kind === "code" && opened.has(n.id) && !!n.code;
    const isOpen = (n) => opened.has(n.id) && n.children.length && n.kind !== "code";
    const visibleList = () => {
        const out = [];
        const walk = (n) => { out.push(n); if (isOpen(n)) n.children.forEach(walk); };
        walk(root);
        return out;
    };
    // la cellule visible qui porte un nœud (lui, ou celle, repliée, qui le contient)
    const shown = (id) => {
        let n = nodes.get(id), best = n;
        for (; n; n = nodes.get(n.parent)) if (n.parent && !isOpen(nodes.get(n.parent))) best = nodes.get(n.parent);
        return best?.id;
    };
    const inside = (id, anc) => { for (let n = nodes.get(id); n; n = nodes.get(n.parent)) if (n.id === anc) return true; return false; };

    let vis = [], cells = new Map();
    // une cellule qui apparaît naît près de son parent, dans la direction qui s'éloigne du grand-parent
    function seed(n) {
        if (place.has(n.id)) return;
        const p = nodes.get(n.parent), pp = p && nodes.get(p.parent);
        if (!p) { place.set(n.id, { x: 0, y: 0, vx: 0, vy: 0 }); return; }
        const P = place.get(p.id) || { x: 0, y: 0 };
        const away = pp && place.has(pp.id) ? Math.atan2(P.y - place.get(pp.id).y, P.x - place.get(pp.id).x) : -Math.PI / 2;
        const i = p.children.indexOf(n), m = p.children.length;
        const spread = pp ? Math.min(Math.PI * 1.2, 0.5 + m * 0.32) : Math.PI * 2;
        const a = away + (m === 1 ? 0 : (i / (m - (pp ? 1 : 0)) - (pp ? .5 : 0)) * spread);
        const r = (p.kind === "root" ? 230 : 150) + (i % 2) * 34;
        place.set(n.id, { x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r, vx: 0, vy: 0 });
    }
    function build() {
        vis = visibleList();
        vis.forEach(seed);
        const keep = new Set(vis.map((n) => n.id));
        for (const [id, el] of cells) if (!keep.has(id)) { el.remove(); cells.delete(id); }
        for (const n of vis) {
            let el = cells.get(n.id);
            const fresh = !el;
            if (fresh) {
                el = document.createElement("div");
                el.dataset.id = n.id;
                layer.append(el);
                cells.set(n.id, el);
            }
            if (n.kind === "code" && isCard(n)) {
                el.className = `cell cl-code card${n.id === selected ? " sel" : ""}${hits.has(n.id) ? " hit" : ""}${fresh && !reduce() ? " born" : ""}`;
                el.innerHTML = codeCard(n);
                el.setAttribute("role", "group");
                el.setAttribute("aria-label", `${label(n)} : son code`);
                continue;
            }
            const more = n.kind === "code" ? 0 : n.children.length && !isOpen(n) ? n.children.length : 0;
            const quiet = (n.kind === "fn" || n.kind === "table" || n.kind === "var" || n.kind === "fld") && !rel.get(n.id)?.length;
            el.className = `cell cl-${n.kind}${isOpen(n) ? " open" : ""}${quiet ? " quiet" : ""}${hits.has(n.id) ? " hit" : ""}${fresh && !reduce() ? " born" : ""}`;
            const sum = summary(n);
            el.innerHTML = `<span class="bx-icon" aria-hidden="true"></span><span class="cl-text"><span class="cl-title">${n.kind === "code" ? `<em>${esc(n.lang)}</em> ` : ""}${esc(n.title)}</span>${sum ? `<span class="cl-sum">${esc(sum)}</span>` : ""}</span>${more ? `<span class="cl-more" title="${more} à déplier">+${more}</span>` : ""}${n.kind === "code" && n.code ? '<span class="cl-more cl-peek" title="Voir le code">{ }</span>' : ""}`;
            el.setAttribute("role", "button");
            el.setAttribute("tabindex", "0");
            el.setAttribute("aria-label", `${KIND[n.kind]} ${label(n)}${more ? `, ${more} à déplier` : ""}`);
        }
        for (const n of vis) { const el = cells.get(n.id); n.w = el.offsetWidth || 140; n.h = el.offsetHeight || 44; if (isCard(n)) anchors(n, el); }
        mark();
        heat(1);
    }

    // ---------------------------------------------------------------- un bloc déplié : son code, et ses noms reliés
    const MAX_LINES = 60;
    // les noms à marquer dans un bloc : ce qu'il donne à d'autres (défini ici), ce qu'il en reçoit (utilisé ici)
    function namesOf(n) {
        const give = new Set(), take = new Set();
        for (const d of data.deps) {
            if (d.from === n.e) d.names.forEach((x) => give.add(x));
            if (d.to === n.e) d.names.forEach((x) => take.add(x));
        }
        return { give, take };
    }
    function codeCard(n) {
        const lines = highlightLines(n.code, n.lang);
        const shownLines = lines.slice(0, MAX_LINES);
        const { give, take } = namesOf(n);
        const own = data.entries[n.e]?.defs || { fn: [], table: [], var: [] };
        const head = `<div class="cl-head"><span class="bx-icon" aria-hidden="true"></span><span class="cl-text"><span class="cl-title"><em>${esc(n.lang)}</em> ${esc(n.title)}</span>`
            + `<span class="cl-sum">${esc([pageOf(n)?.title, n.sec].filter(Boolean).join(" · "))}</span></span><button type="button" class="cl-fold" title="Replier">×</button></div>`;
        const legend = give.size || take.size ? `<div class="cl-legend">${take.size ? `<span class="nm nm-use">reçoit</span> ${[...take].map((x) => `<b class="nm nm-use" data-n="${esc(x)}">${esc(x.replace(/^table:/, "table "))}</b>`).join(" ")}` : ""}${give.size && take.size ? " &nbsp; " : ""}${give.size ? `<span class="nm nm-def">donne</span> ${[...give].map((x) => `<b class="nm nm-def" data-n="${esc(x)}">${esc(x.replace(/^table:/, "table "))}</b>`).join(" ")}` : ""}</div>` : "";
        const html = shownLines.map((l, i) => `<span class="ln">${i + 1}</span><span class="lc">${l || " "}</span>`).join("\n");
        const rest = lines.length > MAX_LINES ? `<div class="cl-rest">… ${lines.length - MAX_LINES} lignes de plus (double clic pour tout lire dans le document)</div>` : "";
        const sizes = [own.fn.length && plural(own.fn.length, "fonction"), own.table.length && plural(own.table.length, "table"), own.var.length && plural(own.var.length, "variable")].filter(Boolean).join(" · ");
        setTimeout(() => markNames(n), 0);
        return `${head}${legend}<pre class="cl-src cm-s-lumen"><code>${html}</code></pre>${rest}${sizes ? `<div class="cl-foot">${esc(sizes)}</div>` : ""}`;
    }
    // dans le code coloré, les noms reliés deviennent des repères (la première définition, le premier usage)
    function markNames(n) {
        const el = cells.get(n.id), codeEl = el?.querySelector(".cl-src code");
        if (!codeEl || codeEl.dataset.marked) return;
        codeEl.dataset.marked = "1";
        const { give, take } = namesOf(n);
        const keys = [...new Set([...give, ...take])];
        if (!keys.length) return;
        const bare = new Map(keys.map((k) => [k.replace(/^table:/, "").toLowerCase(), k]));
        const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${[...bare.keys()].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
        const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
        const texts = [];
        for (let t = walker.nextNode(); t; t = walker.nextNode()) if (!t.parentElement.closest(".ln")) texts.push(t);
        for (const t of texts) {
            const v = t.nodeValue;
            re.lastIndex = 0;
            if (!re.test(v)) continue;
            re.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let at = 0;
            for (const m of v.matchAll(re)) {
                frag.append(v.slice(at, m.index));
                const key = bare.get(m[1].toLowerCase());
                const span = document.createElement("span");
                span.className = `nm ${give.has(key) ? "nm-def" : "nm-use"}`;
                span.dataset.n = key;
                span.textContent = m[1];
                frag.append(span);
                at = m.index + m[1].length;
            }
            frag.append(v.slice(at));
            t.replaceWith(frag);
        }
        anchors(n, el);
        draw();
    }
    // où sont ces repères dans la carte (en coordonnées de la carte, indépendantes du zoom)
    // (mesurés dans la mise en page, pas à l'écran : ni le zoom ni l'animation d'apparition ne les faussent)
    function anchors(n, el) {
        n.anchors = new Map();
        const at = (e) => { let x = 0, y = 0; for (let t = e; t && t !== el; t = t.offsetParent) { x += t.offsetLeft; y += t.offsetTop; } return { x, y }; };
        for (const s of el.querySelectorAll(".cl-src .nm")) {
            const role = s.classList.contains("nm-def") ? "def" : "use";
            const key = `${role}:${s.dataset.n}`;
            if (n.anchors.has(key)) continue;
            const o = at(s);
            n.anchors.set(key, { x: o.x, y: o.y + s.offsetHeight / 2, w: s.offsetWidth });
        }
    }

    // ---------------------------------------------------------------- le placement (de petites forces, jusqu'au calme)
    let alpha = 0, raf = 0, dragging = null;
    const heat = (a) => { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(tick); };
    function tick() {
        raf = 0;
        const list = vis, P = list.map((n) => place.get(n.id));
        // se repousser (sans se chevaucher : selon la taille des cellules)
        for (let i = 0; i < list.length; i++) {
            const a = P[i], na = list[i];
            for (let j = i + 1; j < list.length; j++) {
                const b = P[j], nb = list[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                if (!dx && !dy) { dx = Math.random() - .5; dy = Math.random() - .5; }
                const d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
                const f = 2600 / Math.max(d2, 400);
                const fx = (dx / d) * f * alpha, fy = (dy / d) * f * alpha;
                a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
                // deux rectangles qui se chevauchent (une carte de code est grande) : écartés sur l'axe où c'est le plus court
                const ox = (na.w + nb.w) / 2 + 24 - Math.abs(dx), oy = (na.h + nb.h) / 2 + 20 - Math.abs(dy);
                if (ox > 0 && oy > 0) {
                    const push = Math.min(ox, oy) * .22 * Math.max(alpha, .3);
                    if (ox < oy) { const s2 = Math.sign(dx) || 1; a.vx -= s2 * push; b.vx += s2 * push; }
                    else { const s2 = Math.sign(dy) || 1; a.vy -= s2 * push; b.vy += s2 * push; }
                }
            }
        }
        // s'attirer : chaque cellule à son parent ; les cellules qui dépendent l'une de l'autre, un peu
        const idx = new Map(list.map((n, i) => [n.id, i]));
        const spring = (i, j, len, k) => {
            const a = P[i], b = P[j];
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            const f = (d - len) * k * alpha, fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        };
        list.forEach((n, i) => {
            if (n.parent && idx.has(n.parent)) {
                const p = nodes.get(n.parent);
                spring(i, idx.get(n.parent), (p.kind === "root" ? 210 : 110) + (n.w + p.w) / 4 + (isCard(n) ? n.h / 3 : 0), .05);
            }
        });
        for (const e of crossEdges) if (idx.has(e.a) && idx.has(e.b)) spring(idx.get(e.a), idx.get(e.b), 300, .004);
        // le projet reste au centre
        const r = place.get("root"); r.vx -= r.x * .02 * alpha; r.vy -= r.y * .02 * alpha;
        let moving = 0;
        list.forEach((n, i) => {
            const p = P[i];
            if (dragging === n.id) { p.vx = p.vy = 0; return; }
            p.vx *= .72; p.vy *= .72;
            p.x += p.vx; p.y += p.vy;
            moving = Math.max(moving, Math.abs(p.vx) + Math.abs(p.vy));
        });
        alpha *= .985;
        draw();
        if ((alpha > .02 && moving > .05) || dragging) raf = requestAnimationFrame(tick);
        else alpha = 0;
    }

    // ---------------------------------------------------------------- les liens dessinés
    let crossEdges = [], nameEdges = [];
    function edgesFor() {
        // dépendances et liens entre pages, portés par les cellules visibles (ou celles, repliées, qui les contiennent)
        const seen = new Map();
        for (const [a, list] of rel) for (const r of list) {
            if (!r.out || r.type === "use") continue;
            const sa = shown(a), sb = shown(r.id);
            if (!sa || !sb || sa === sb || inside(sa, sb) || inside(sb, sa)) continue;
            const key = `${sa}>${sb}`;
            if (r.type === "pagedep" && seen.has(key)) continue;
            if (!seen.has(key)) seen.set(key, { a: sa, b: sb, type: r.type, names: new Set(), from: a, to: r.id });
            r.names.forEach((x) => seen.get(key).names.add(x));
        }
        // la dépendance de page n'est utile que si les blocs ne la montrent pas déjà
        crossEdges = [...seen.values()].filter((e) => e.type !== "pagedep" || ![...seen.values()].some((x) => x !== e && x.type === "dep" && x.a === e.a && x.b === e.b));
        // un bloc déplié de chaque côté (ou d'un seul) : une courbe par nom, de sa définition à son usage
        // deux blocs dépliés : une courbe par nom ; un seul : une courbe vers la cellule repliée, qui porte tous les noms
        nameEdges = [];
        for (const d of data.deps) {
            const A = nodes.get(codeId(d.from)), B = nodes.get(codeId(d.to));
            if (!A || !B) continue;
            const ca = isCard(A) && shown(A.id) === A.id, cb = isCard(B) && shown(B.id) === B.id;
            if (!ca && !cb) continue;
            const sa = shown(A.id), sb = shown(B.id);
            if (sa === sb) continue;
            if (ca && cb) for (const name of d.names) nameEdges.push({ sa, sb, names: [name], both: true });
            else nameEdges.push({ sa, sb, names: d.names, both: false });
        }
        const carded = new Set(nameEdges.map((e) => `${e.sa}>${e.sb}`));
        crossEdges = crossEdges.filter((e) => !(e.type === "dep" && carded.has(`${e.a}>${e.b}`)));
    }
    function draw() {
        const lines = [];
        for (const n of vis) {
            if (!n.parent || !cells.has(n.parent)) continue;
            const a = place.get(n.parent), b = place.get(n.id);
            lines.push(`<line class="tl${n.parent === selected || n.id === selected ? " on" : ""}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`);
        }
        for (const e of crossEdges) {
            const a = place.get(e.a), b = place.get(e.b);
            if (!a || !b) continue;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
            const cx = mx - dy * .18, cy = my + dx * .18;
            const on = e.a === selected || e.b === selected || shown(selected) === e.a || shown(selected) === e.b;
            lines.push(`<path class="xl xl-${e.type}${on ? " on" : ""}" d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}" marker-end="url(#dg-arrow)"><title>${esc([...e.names].map((x) => x.replace(/^table:/, "table ")).join(", "))}</title></path>`);
        }
        svg.innerHTML = '<defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>' + lines.join("");
        // les noms : du bord de la carte, à la hauteur de la ligne où le nom est défini, au bord de l'autre carte, à la
        // hauteur de la ligne où il sert (ou au bord de la cellule repliée) ; les courbes ne traversent pas le code
        const frame = (id) => { const n = nodes.get(id), p = place.get(id); return n && p ? { n, l: p.x - n.w / 2, r: p.x + n.w / 2, t: p.y - n.h / 2, b: p.y + n.h / 2, x: p.x, y: p.y } : null; };
        const yOf = (f, role, name) => {
            const a = isCard(f.n) && f.n.anchors?.get(`${role}:${name}`);
            return a ? { y: f.t + a.y, tx: f.l + a.x + (role === "def" ? a.w : 0), mark: true } : { y: f.y, tx: null, mark: false };
        };
        const named = [], lab = new Map();
        for (const e of nameEdges) {
            const A = frame(e.sa), B = frame(e.sb);
            if (!A || !B) continue;
            const right = B.x >= A.x;                       // B à droite de A : on sort par la droite de A, on entre par la gauche de B
            const ax = right ? A.r : A.l, bx = right ? B.l : B.r, dir = right ? 1 : -1;
            const ya = yOf(A, "def", e.names[0]), yb = yOf(B, "use", e.names[0]);
            const ay = e.both || isCard(A.n) ? ya.y : A.y, by = e.both || isCard(B.n) ? yb.y : B.y;
            const on = e.names.includes(focusName) || e.sa === selected || e.sb === selected;
            const off = focusName && !e.names.includes(focusName);
            let d, mx, my = (ay + by) / 2, sx = ax;
            if (Math.abs(right ? B.l - A.r : A.l - B.r) < 140) {
                // l'une au-dessus de l'autre : une accolade par l'extérieur, du bord droit de l'une au bord droit de l'autre
                const edge = Math.max(A.r, B.r), reach = Math.min(170, 46 + Math.abs(by - ay) * .16);
                sx = A.r;
                d = `M${A.r.toFixed(1)},${ay.toFixed(1)} C${(edge + reach).toFixed(1)},${ay.toFixed(1)} ${(edge + reach).toFixed(1)},${by.toFixed(1)} ${B.r.toFixed(1)},${by.toFixed(1)}`;
                mx = edge + reach * .75 + 4;
                lab.set(`${e.sa}>${e.sb}>${e.names.join(",")}`, null);
            } else {
                const reach = Math.max(50, Math.abs(bx - ax) * .4);
                d = `M${ax.toFixed(1)},${ay.toFixed(1)} C${(ax + dir * reach).toFixed(1)},${ay.toFixed(1)} ${(bx - dir * reach).toFixed(1)},${by.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
                mx = (ax + 3 * (ax + dir * reach) + 3 * (bx - dir * reach) + bx) / 8;
            }
            named.push(`<path class="nl${on ? " on" : ""}${off ? " off" : ""}" d="${d}" marker-end="url(#dg-name-arrow)"/><circle class="nl-dot${off ? " off" : ""}" cx="${sx.toFixed(1)}" cy="${ay.toFixed(1)}" r="3.2"/>`);
            const text = e.names.length > 3 ? e.names.slice(0, 3).join(", ") + ` +${e.names.length - 3}` : e.names.join(", ");
            const k = `${e.sa}>${e.sb}>${text}`;
            if (!lab.get(k)) lab.set(k, `<text class="nl-label${on ? " on" : ""}${off ? " off" : ""}" x="${mx.toFixed(1)}" y="${(my - 5).toFixed(1)}" text-anchor="${mx > Math.max(A.r, B.r) ? "start" : "middle"}">${esc(text.replace(/table:/g, "table "))}</text>`);
        }
        named.unshift('<defs><marker id="dg-name-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>');
        over.innerHTML = named.join("") + [...lab.values()].filter(Boolean).join("");
        for (const n of vis) {
            const p = place.get(n.id), el = cells.get(n.id);
            el.style.transform = `translate(${(p.x - n.w / 2).toFixed(1)}px, ${(p.y - n.h / 2).toFixed(1)}px)`;
        }
    }

    // ---------------------------------------------------------------- la caméra
    const cam = camera || { x: 0, y: 0, k: 1 };
    const view = () => { world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`; space.style.setProperty("--k", cam.k); camera = cam; };
    function lookAt(id, { k = null, smooth = true } = {}) {
        const p = place.get(id);
        if (!p) return;
        const r = space.getBoundingClientRect();
        const to = { k: k ?? cam.k, x: 0, y: 0 };
        to.x = r.width / 2 - p.x * to.k; to.y = r.height / 2 - p.y * to.k;
        glide(to, smooth);
    }
    function fit(smooth = true) {
        const r = space.getBoundingClientRect();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const n of vis) { const p = place.get(n.id); x0 = Math.min(x0, p.x - n.w / 2); x1 = Math.max(x1, p.x + n.w / 2); y0 = Math.min(y0, p.y - n.h / 2); y1 = Math.max(y1, p.y + n.h / 2); }
        if (!isFinite(x0)) return;
        const k = Math.max(.25, Math.min(1.2, Math.min((r.width - 60) / (x1 - x0 || 1), (r.height - 60) / (y1 - y0 || 1))));
        glide({ k, x: r.width / 2 - (x0 + x1) / 2 * k, y: r.height / 2 - (y0 + y1) / 2 * k }, smooth);
    }
    let glideRaf = 0;
    function glide(to, smooth) {
        cancelAnimationFrame(glideRaf);
        if (!smooth || reduce()) { Object.assign(cam, to); view(); return; }
        const from = { ...cam }, t0 = performance.now(), dur = 420;
        const step = (t) => {
            const u = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - u, 3);
            cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e; cam.k = from.k + (to.k - from.k) * e;
            view();
            if (u < 1) glideRaf = requestAnimationFrame(step);
        };
        glideRaf = requestAnimationFrame(step);
    }
    const zoomAt = (px, py, f) => {
        const k = Math.max(.2, Math.min(2.5, cam.k * f));
        cam.x = px - (px - cam.x) * (k / cam.k); cam.y = py - (py - cam.y) * (k / cam.k); cam.k = k;
        view();
    };

    // ---------------------------------------------------------------- la cellule choisie, ses liées
    function mark() {
        const related = new Set();
        for (const r of rel.get(selected) || []) related.add(shown(r.id));
        const line = new Set();
        for (let n = nodes.get(selected); n; n = nodes.get(n.parent)) line.add(n.id);
        for (const [id, el] of cells) {
            el.classList.toggle("sel", id === selected);
            el.classList.toggle("rel", related.has(id) && id !== selected);
            el.classList.toggle("path", (line.has(id) && id !== selected) || nodes.get(id)?.parent === selected);
        }
        markHot();
        space.classList.toggle("focus", related.size > 0 || !!nodes.get(selected)?.children.length && opened.has(selected));
        edgesFor();
        draw();
        fiche();
    }

    function markHot() {
        for (const s of layer.querySelectorAll(".nm[data-n]")) s.classList.toggle("hot", s.dataset.n === focusName);
    }

    // ---------------------------------------------------------------- la fiche
    function fiche() {
        const n = nodes.get(selected) || root;
        const path = [];
        for (let x = nodes.get(n.parent); x; x = nodes.get(x.parent)) path.unshift(x);
        const chip = (id, extra = "") => {
            const x = nodes.get(id);
            if (!x) return "";
            const pg = x.k != null && x.kind !== "page" ? pageOf(x) : null;
            return `<button type="button" class="dg-chip ch-${x.kind}" data-go="${esc(id)}"><span class="bx-icon" aria-hidden="true"></span>${esc(label(x))}${pg && x.k !== n.k ? `<small>${esc(pg.title)}</small>` : ""}${extra}</button>`;
        };
        const groups = new Map();
        for (const r of rel.get(n.id) || []) {
            if (!groups.has(r.how)) groups.set(r.how, []);
            if (!groups.get(r.how).some((x) => x.id === r.id)) groups.get(r.how).push(r);
        }
        const ORDER = ["est une sorte de", "a pour sorte", "défini par", "dépend de", "utilise", "lit", "lu par", "définit", "fournit à", "utilisé par", "lien vers", "lien depuis"];
        const relHtml = [...groups].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])).map(([how, list]) =>
            `<section><h4>${esc(how)}</h4><div class="dg-chips">${list.map((r) => chip(r.id, r.names.length ? `<code>${esc(r.names.map((x) => x.replace(/^table:/, "table ")).join(", "))}</code>` : "")).join("")}</div></section>`).join("");
        const kids = n.children.length ? `<section><h4>contient</h4><div class="dg-chips">${n.children.slice(0, 40).map((c) => chip(c.id)).join("")}${n.children.length > 40 ? `<span class="dg-more">+ ${n.children.length - 40}</span>` : ""}</div></section>` : "";
        const en = n.kind === "code" && n.e != null ? data.entries[n.e] : null;
        card.innerHTML = `<nav class="dg-path">${path.map((x) => `<button type="button" data-go="${esc(x.id)}">${esc(label(x))}</button>`).join("<span>›</span>")}</nav>
            <div class="dg-kind ch-${n.kind}"><span class="bx-icon" aria-hidden="true"></span>${KIND[n.kind]}${n.kind === "code" ? ` · ${esc(n.lang)}` : ""}</div>
            <h3>${esc(n.title)}</h3>
            ${summary(n) ? `<p class="dg-sum">${esc(summary(n))}</p>` : ""}
            ${n.k != null ? `<button type="button" class="dg-open" data-k="${n.k}" data-line="${n.line || 0}">Ouvrir dans le document ↗</button>` : ""}
            ${relHtml}${kids}
            ${en && !en.uses.length && !(rel.get(n.id) || []).length ? '<p class="dg-none">Ce bloc ne dépend d\'aucun autre bloc, et aucun ne dépend de lui.</p>' : ""}`;
    }

    // ---------------------------------------------------------------- les gestes
    function choose(id, { toggle = false } = {}) {
        const n = nodes.get(id);
        let unfolded = false;
        if (toggle && (n.kind === "code" ? !!n.code : n.children.length)) { if (opened.has(id)) opened.delete(id); else { opened.add(id); unfolded = true; } }
        selected = id;
        build();
        // ce qui vient de se déplier reste en vue : la caméra suit la cellule
        if (unfolded) setTimeout(() => lookAt(id), 320);
    }
    function reveal(id) {
        for (let n = nodes.get(nodes.get(id)?.parent); n; n = nodes.get(n.parent)) opened.add(n.id);
        selected = id;
        build();
        setTimeout(() => lookAt(id), 260);
    }
    // glisser le fond, glisser une cellule, pincer pour zoomer
    const pointers = new Map();
    let press = null, pinch = null;
    space.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0 && ev.pointerType === "mouse") return;
        space.setPointerCapture(ev.pointerId);
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k };
            press = null;
            return;
        }
        const cell = ev.target.closest(".cell");
        press = { id: cell?.dataset.id ?? null, x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false, target: ev.target };
    });
    space.addEventListener("pointermove", (ev) => {
        if (!pointers.has(ev.pointerId)) return;
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()], r = space.getBoundingClientRect();
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.k * d / pinch.d) / cam.k);
            return;
        }
        if (!press) return;
        const dx = ev.clientX - press.x, dy = ev.clientY - press.y;
        if (!press.moved && Math.hypot(dx, dy) < 5) return;
        press.moved = true;
        if (press.id) {
            // la cellule suit le doigt ; les autres s'écartent
            dragging = press.id;
            const r = space.getBoundingClientRect(), p = place.get(press.id);
            p.x = (ev.clientX - r.left - cam.x) / cam.k; p.y = (ev.clientY - r.top - cam.y) / cam.k;
            heat(.35);
        } else {
            cam.x = press.cx + dx; cam.y = press.cy + dy;
            view();
        }
    });
    const release = (ev) => {
        pointers.delete(ev.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!press) return;
        const p = press;
        press = null;
        dragging = null;
        if (!p.moved && p.id) {
            const n = nodes.get(p.id), name = p.target.closest?.(".nm[data-n]")?.dataset.n;
            // dans une carte de code : un nom l'éclaire partout (ses courbes, ses autres repères) ; × replie ; le reste choisit
            if (name) { focusName = focusName === name ? null : name; selected = p.id; mark(); markHot(); }
            else if (isCard(n) && !p.target.closest(".cl-fold")) { selected = p.id; mark(); }
            else choose(p.id, { toggle: true });
        }
        else if (!p.moved && !p.id && ev.type === "pointerup") { /* un clic dans le vide : rien */ }
    };
    space.addEventListener("pointerup", release);
    space.addEventListener("pointercancel", release);
    space.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        const r = space.getBoundingClientRect();
        // pincer sur un pavé tactile (Ctrl) ou une molette de souris : zoomer ; deux doigts sur un pavé : se déplacer
        const wheel = ev.ctrlKey || (ev.deltaMode !== 0) || (Math.abs(ev.deltaY) >= 50 && !ev.deltaX && Number.isInteger(ev.deltaY));
        if (wheel) zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * (ev.ctrlKey ? .01 : .0015)));
        else { cam.x -= ev.deltaX; cam.y -= ev.deltaY; view(); }
    }, { passive: false });
    space.addEventListener("dblclick", (ev) => {
        const n = nodes.get(ev.target.closest(".cell")?.dataset.id);
        if (n?.k != null) { close(); go(n.k, n.line || 0); }
    });
    layer.addEventListener("keydown", (ev) => {
        const id = ev.target.closest(".cell")?.dataset.id;
        if (!id) return;
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(id, { toggle: true }); requestAnimationFrame(() => cells.get(id)?.focus()); }
    });
    card.addEventListener("click", (ev) => {
        const t = ev.target.closest("button");
        if (!t) return;
        if (t.dataset.go) reveal(t.dataset.go);
        else if (t.dataset.k != null) { close(); go(+t.dataset.k, +t.dataset.line || 0); }
    });
    box.querySelector(".dg-tools").addEventListener("click", (ev) => {
        const act = ev.target.closest("button")?.dataset.act;
        if (act === "open") { for (const n of nodes.values()) if (n.children.length && n.kind !== "code") opened.add(n.id); build(); setTimeout(() => fit(), 700); }
        if (act === "code") {
            for (const n of nodes.values()) if (n.kind === "code" && n.code) { opened.add(n.id); for (let x = nodes.get(n.parent); x; x = nodes.get(x.parent)) opened.add(x.id); }
            build(); setTimeout(() => fit(), 900);
        }
        if (act === "fold") { opened.clear(); opened.add("root"); selected = "root"; build(); setTimeout(() => fit(), 500); }
        if (act === "fit") fit();
    });
    search.addEventListener("input", () => {
        const q = fold(search.value.trim());
        hits = new Set();
        if (q) for (const n of nodes.values()) if (n.id !== "root" && fold(n.title).includes(q)) {
            hits.add(n.id);
            for (let x = nodes.get(n.parent); x; x = nodes.get(x.parent)) opened.add(x.id);
        }
        build();
        if (hits.size) setTimeout(() => lookAt([...hits][0]), 300);
    });
    search.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && hits.size) { ev.preventDefault(); reveal([...hits][0]); } });
    box.querySelector(".dg-close").addEventListener("click", () => close());
    const onKey = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); if (search.value) { search.value = ""; search.dispatchEvent(new Event("input")); } else close(); }
        else if (ev.key === "/" && document.activeElement !== search) { ev.preventDefault(); search.focus(); }
    };
    addEventListener("keydown", onKey, true);
    function close() { cancelAnimationFrame(raf); cancelAnimationFrame(glideRaf); removeEventListener("keydown", onKey, true); box.remove(); if (closeOpen === close) closeOpen = null; }
    closeOpen = close;

    document.body.append(box);
    build();
    view();
    // la première fois : laisser les cellules se placer, puis tout montrer
    if (!camera || camera === cam && cam.x === 0 && cam.y === 0) setTimeout(() => fit(false), 0), setTimeout(() => fit(), 900);
    return { close };
}

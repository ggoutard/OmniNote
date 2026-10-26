// render.js — Markdown (GFM, formules KaTeX, Mermaid, encadrés) et sorties des cellules.
// Les sorties suivent nbformat 4 : stream, display_data, execute_result, error.

/* global marked, katex, CodeMirror */

import { chartView } from "./chart.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---------------------------------------------------------------- coloration statique

const MODE_ALIAS = {
    py: "python", python: "python", js: "javascript", javascript: "javascript", ts: "javascript", json: "application/json",
    java: "text/x-java", c: "text/x-csrc", cpp: "text/x-c++src", sh: "shell", bash: "shell", shell: "shell", sql: "text/x-sqlite",
    tcl: "tcl", scheme: "scheme", scm: "scheme", lisp: "scheme", html: "htmlmixed", xml: "xml", css: "css", md: "gfm", markdown: "gfm",
    tex: "stex", latex: "stex", awk: "shell", rust: "text/x-rustsrc", rs: "text/x-rustsrc", go: "text/x-go", golang: "text/x-go", php: "text/x-php",
    cobol: "cobol",
};

export function highlight(code, lang) {
    const mode = MODE_ALIAS[(lang || "").toLowerCase()] || lang;
    if (!mode || !window.CodeMirror?.runMode) return esc(code);
    let out = "";
    CodeMirror.runMode(code, mode, (text, style) => {
        out += style ? `<span class="${style.split(" ").map((s) => "cm-" + s).join(" ")}">${esc(text)}</span>` : esc(text);
    });
    return out;
}

/** La même coloration, ligne par ligne (le mode présentation anime chaque ligne d'un code à l'autre). */
export function highlightLines(code, lang) {
    const mode = MODE_ALIAS[(lang || "").toLowerCase()] || lang;
    if (!mode || !window.CodeMirror?.runMode) return code.split("\n").map(esc);
    const lines = [""];
    CodeMirror.runMode(code, mode, (text, style) => {
        if (text === "\n") { lines.push(""); return; }
        lines[lines.length - 1] += style ? `<span class="${style.split(" ").map((s) => "cm-" + s).join(" ")}">${esc(text)}</span>` : esc(text);
    });
    return lines;
}

// ---------------------------------------------------------------- Markdown

const CALLOUTS = { NOTE: "Note", TIP: "Astuce", IMPORTANT: "Important", WARNING: "Attention", CAUTION: "Prudence" };
let slugCount = new Map();
const slug = (text) => {
    const base = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "section";
    const n = slugCount.get(base) || 0;
    slugCount.set(base, n + 1);
    return n ? `${base}-${n}` : base;
};

const renderer = {
    code(token) {
        const lang = (token.lang || "").trim().split(/\s+/)[0];
        if (lang === "mermaid") return `<div class="mermaid-src" data-src="${esc(token.text)}"></div>`;
        return `<pre class="md-code cm-s-lumen"><span class="md-lang">${esc(lang || "texte")}</span><code>${highlight(token.text, lang)}</code></pre>`;
    },
    heading(token) {
        const text = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${slug(text)}">${text}</h${token.depth}>`;
    },
    blockquote(token) {
        const body = this.parser.parse(token.tokens);
        const m = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(body);
        if (m) return `<div class="callout callout-${m[1].toLowerCase()}"><p class="callout-title">${CALLOUTS[m[1]]}</p>${body.replace(m[0], "<p>")}</div>`;
        return `<blockquote>${body}</blockquote>`;
    },
    link(token) {
        const text = this.parser.parseInline(token.tokens);
        return `<a href="${esc(token.href)}" target="_blank" rel="noopener">${text}</a>`;
    },
};
marked.use({ gfm: true, breaks: false, renderer });

export function renderMarkdown(src) {
    slugCount = new Map();
    // Les formules sont mises de côté avant marked (qui toucherait aux \\ et aux _)
    const math = [];
    const protectedSrc = src.replace(/(```[\s\S]*?```|`[^`\n]+`)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$/g, (all, code, d1, d2, inline) => {
        if (code) return code;
        const display = d1 ?? d2;
        math.push({ tex: display ?? inline, display: display != null });
        return display != null ? `\n\n@@MATH${math.length - 1}@@\n\n` : `@@MATH${math.length - 1}@@`;
    });
    let html = marked.parse(protectedSrc);
    html = html.replace(/<p>@@MATH(\d+)@@<\/p>|@@MATH(\d+)@@/g, (all, block, inline) => {
        const m = math[block ?? inline];
        const out = katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false, strict: "ignore" });
        return block != null ? `<div class="math-block">${out}</div>` : out;
    });
    return cleanHtml(html);
}

// Le HTML écrit dans le Markdown s'affiche dans la page même (texte, diapositives, PDF) : rien de ce qui y exécuterait
// du code ne passe (un document reçu par lien peut contenir n'importe quoi) — balises de script et de cadre,
// formulaires, attributs on…, adresses javascript:, styles qui recouvriraient la page. Le HTML qui doit vivre va
// dans un bloc ```html, rendu dans un cadre isolé.
const BAD_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form", "input", "textarea",
    "select", "option", "button", "style", "noscript", "template", "portal", "dialog"]);
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "data", "poster", "background", "srcset", "ping"]);
export function cleanHtml(html) {
    if (!/[<&]/.test(html)) return html;
    const t = document.createElement("template");
    t.innerHTML = html;
    for (const el of [...t.content.querySelectorAll("*")]) {
        const tag = el.localName;
        if (BAD_TAGS.has(tag) || ((tag === "animate" || tag === "set") && /href/i.test(el.getAttribute("attributeName") || ""))) { el.remove(); continue; }
        for (const a of [...el.attributes]) {
            const n = a.name.toLowerCase(), v = a.value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
            if (n.startsWith("on") || n === "srcdoc" || n === "formaction" || n === "action") el.removeAttribute(a.name);
            else if (URL_ATTRS.has(n) && /^(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp|svg\+xml|avif)))/.test(v)) el.removeAttribute(a.name);
            else if (n === "style" && /position:(fixed|sticky)|expression\(|javascript:|behavior:/.test(v)) el.removeAttribute(a.name);
        }
    }
    return t.innerHTML;
}

let mermaidLoading = null;
export async function renderMermaid(root, dark) {
    const blocks = [...root.querySelectorAll(".mermaid-src:not(.done)")];
    if (!blocks.length) return;
    mermaidLoading ??= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "vendor/mermaid/mermaid.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
    });
    await mermaidLoading;
    window.mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", fontFamily: "Inter, system-ui, sans-serif", securityLevel: "strict" });
    for (const b of blocks) {
        b.classList.add("done");
        try {
            const { svg } = await window.mermaid.render("mmd" + Math.random().toString(36).slice(2), b.dataset.src);
            b.innerHTML = svg;
        } catch (e) {
            b.innerHTML = `<pre class="mermaid-error">Mermaid : ${esc(e.message || e)}</pre>`;
        }
    }
}

// ---------------------------------------------------------------- sorties

const ANSI = /\x1b\[[0-9;]*m/g;

export function outputText(text) {
    return Array.isArray(text) ? text.join("") : String(text ?? "");
}

const PRIORITY = [
    "application/vnd.lumen.chart+json", "application/vnd.lumen.progress+json", "application/vnd.lumen.table+json", "text/html", "image/svg+xml",
    "image/png", "image/jpeg", "image/gif", "text/markdown", "text/latex", "application/json", "text/plain",
];

/** Crée l'élément d'une sortie nbformat. ctx = { dark, frameId } */
export function renderOutput(out, ctx = {}) {
    if (out.output_type === "stream") {
        const el = h(`<pre class="out-stream ${out.name === "stderr" ? "stderr" : ""}"></pre>`);
        el.textContent = outputText(out.text).replace(ANSI, "");
        return el;
    }
    if (out.output_type === "error") {
        const tb = (out.traceback || []).map((l) => String(l).replace(ANSI, ""));
        const el = h(`<div class="out-error"><div class="err-head"><span class="err-name"></span><span class="err-value"></span></div>${tb.length ? '<pre class="err-tb"></pre>' : ""}</div>`);
        el.querySelector(".err-name").textContent = out.ename;
        el.querySelector(".err-value").textContent = out.evalue;
        if (tb.length) el.querySelector(".err-tb").textContent = tb.join("\n");
        return el;
    }
    const data = out.data || {};
    const mime = PRIORITY.find((m) => data[m] != null) || Object.keys(data)[0];
    const value = data[mime];
    const wrap = h(`<div class="out-rich" data-mime="${esc(mime || "")}"></div>`);
    if (out.output_type === "execute_result" && mime === "text/plain") wrap.classList.add("out-result");
    switch (mime) {
        case "application/vnd.lumen.progress+json": wrap.append(progressView(value)); break;
        case "application/vnd.lumen.table+json": wrap.append(tableView(value)); break;
        case "application/vnd.lumen.chart+json": wrap.append(chartView(value, tableView)); break;
        case "text/html": wrap.append(ctx.live ? htmlFrame(outputText(value), ctx) : htmlStatic(outputText(value), ctx)); break;
        case "image/svg+xml": wrap.append(svgView(outputText(value))); break;
        case "image/png": case "image/jpeg": case "image/gif": {
            const img = new Image();
            img.src = `data:${mime};base64,${outputText(value).replace(/\s/g, "")}`;
            img.className = "out-img";
            wrap.append(img);
            break;
        }
        case "text/markdown": { const d = h('<div class="md out-md"></div>'); d.innerHTML = renderMarkdown(outputText(value)); wrap.append(d); renderMermaid(d, ctx.dark); break; }
        case "text/latex": {
            const d = h('<div class="out-latex"></div>');
            const tex = outputText(value).trim().replace(/^\$\$?|\$\$?$/g, "");
            d.innerHTML = katex.renderToString(tex, { displayMode: true, throwOnError: false });
            wrap.append(d);
            break;
        }
        case "application/json": wrap.append(jsonView(typeof value === "string" ? JSON.parse(value) : value)); break;
        default: {
            const pre = h('<pre class="out-text"></pre>');
            pre.textContent = outputText(value ?? "").replace(ANSI, "");
            wrap.append(pre);
        }
    }
    return wrap;
}

/**
 * Un SVG sûr à insérer dans la page : lu par le navigateur comme du XML, puis débarrassé de tout ce qui
 * exécute du code ou charge autre chose (scripts, <foreignObject>, <style> qui déborderait sur la page,
 * attributs on…, liens hors du document). Renvoie null si le texte n'est pas un SVG valide.
 */
export function safeSvg(text) {
    // Écrit à la main, un SVG oublie souvent son espace de noms : sans lui, rien ne se dessine
    const head = /<svg\b[^>]*>/i.exec(text)?.[0] || "";
    if (!/\sxmlns\s*=/.test(head)) text = text.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/\bxlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(head)) text = text.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.localName !== "svg" || doc.getElementsByTagName("parsererror").length) return null;
    for (const tag of ["script", "foreignObject", "style", "iframe", "object", "embed"]) [...svg.getElementsByTagName(tag)].forEach((e) => e.remove());
    for (const el of [svg, ...svg.getElementsByTagName("*")]) {
        for (const a of [...el.attributes]) {
            const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
            const link = n === "href" || n === "xlink:href" || n === "src";
            if (n.startsWith("on") || (link && !v.startsWith("#") && !v.startsWith("data:image/")) || (n === "attributename" && v.includes("href"))) el.removeAttribute(a.name);
        }
    }
    // Sans largeur, un SVG prend toute la page : on lui donne celle de son viewBox
    const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (!svg.hasAttribute("width") && vb?.length === 4 && vb[2] > 0) svg.setAttribute("width", vb[2]);
    return document.importNode(svg, true);
}

// SVG produit par le code
function svgView(text) {
    const d = h('<div class="out-svg"></div>');
    const svg = safeSvg(text);
    if (svg) d.append(svg);
    else d.textContent = "SVG illisible";
    d.querySelectorAll("polyline.lx-line").forEach((p, i) => p.style.setProperty("--i", i));
    return d;
}

// HTML : rendu dans un cadre isolé (scripts autorisés, sans accès à la page), à la hauteur de son contenu
let frameSeq = 0;
const frames = new Map();
addEventListener("message", (e) => {
    const d = e.data;
    if (d && d.lumenFrame && frames.has(d.lumenFrame)) frames.get(d.lumenFrame).style.height = `${Math.min(2000, Math.max(24, d.h))}px`;
});

/** Du HTML qui contient du code : un script, un attribut on…, une adresse javascript:, un cadre, un formulaire */
export const htmlHasCode = (html) => /<script\b|\son[a-z]+\s*=|javascript:|<iframe\b|<object\b|<embed\b|<form\b/i.test(html);

/**
 * Le HTML, par défaut : mis en forme dans la page, sans rien qui s'exécute (le filtre du Markdown). S'il contenait du
 * code, une ligne le dit, et ▶ l'exécute (ctx.runHtml : l'avertissement d'abord, puis le cadre isolé).
 */
function htmlStatic(html, ctx) {
    const box = h('<div class="out-html"></div>');
    const body = h('<div class="out-html-body"></div>');
    body.innerHTML = cleanHtml(html);
    box.append(body);
    if (htmlHasCode(html)) {
        const bar = h('<div class="out-html-bar"><span>Ce HTML contient du code, qui n\'a pas été exécuté.</span><button type="button">▶ Exécuter…</button></div>');
        bar.querySelector("button").addEventListener("click", () => ctx.runHtml?.());
        box.prepend(bar);
    }
    return box;
}

function htmlFrame(html, ctx) {
    const id = `f${++frameSeq}`;
    const f = document.createElement("iframe");
    f.className = "out-frame";
    // Reçu par lien (ctx.offline) : ni réseau (Content-Security-Policy), ni fenêtres, ni autre page dans le cadre ;
    // il ne lui reste que son propre contenu. Sinon : scripts et fenêtres permis, toujours sans accès à la page.
    f.setAttribute("sandbox", ctx.offline ? "allow-scripts" : "allow-scripts allow-popups");
    const csp = ctx.offline ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">` : "";
    if (ctx.offline) {
        // (le cadre qui chargerait une autre page, par un lien ou un script : remplacé par un avertissement)
        let loads = 0;
        f.addEventListener("load", () => {
            if (++loads < 2) return;
            const box = h('<div class="out-locked"><span>Ce contenu, reçu par lien, a voulu ouvrir une autre page dans son cadre : bloqué.</span></div>');
            f.replaceWith(box);
        });
    }
    f.setAttribute("loading", "lazy");
    const dark = ctx.dark;
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${csp}<style>
html,body{margin:0;background:transparent;color:${dark ? "#e8e8ea" : "#18181b"};font:14px/1.55 "Inter",-apple-system,system-ui,sans-serif}
body{padding:2px 0}table{border-collapse:collapse}td,th{padding:4px 10px;border-bottom:1px solid ${dark ? "#26262b" : "#e7e7ea"}}a{color:${dark ? "#6b9bff" : "#1f5eff"}}
</style></head><body>${html}<script>
const send=()=>parent.postMessage({lumenFrame:${JSON.stringify(id)},h:document.documentElement.scrollHeight},'*');
new ResizeObserver(send).observe(document.documentElement);addEventListener('load',send);send();
<\/script></body></html>`;
    frames.set(id, f);
    // (exécuté à la demande : il le dit)
    const box = h(`<div class="out-live"><div class="out-live-tag">HTML exécuté · cadre isolé${ctx.offline ? " · sans réseau" : ""}</div></div>`);
    box.append(f);
    return box;
}

function progressView(v) {
    const frac = v.total ? Math.min(1, v.value / v.total) : 0;
    const el = h(`<div class="out-progress ${v.done ? "done" : ""}" style="--p:${frac}">
        <span class="pg-label"></span><span class="pg-bar"><i></i></span><span class="pg-num"></span></div>`);
    el.querySelector(".pg-label").textContent = v.label || "";
    el.querySelector(".pg-num").textContent = v.total ? `${v.value}/${v.total} · ${Math.round(frac * 100)} %` : String(v.value);
    return el;
}

function jsonView(value, depth = 0) {
    const node = (v, key, d) => {
        const k = key != null ? `<span class="j-key">${esc(key)}</span>: ` : "";
        if (v === null || typeof v !== "object") {
            const cls = v === null ? "j-null" : typeof v === "string" ? "j-str" : typeof v === "number" ? "j-num" : "j-bool";
            return `<div class="j-leaf">${k}<span class="${cls}">${esc(typeof v === "string" ? JSON.stringify(v) : String(v))}</span></div>`;
        }
        const arr = Array.isArray(v);
        const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
        const summary = arr ? `Array(${v.length})` : `{${entries.length}}`;
        return `<details ${d < 1 ? "open" : ""}><summary>${k}<span class="j-sum">${summary}</span></summary>${entries.slice(0, 500).map(([kk, vv]) => node(vv, kk, d + 1)).join("")}</details>`;
    };
    const d = h('<div class="out-json"></div>');
    d.innerHTML = node(value, null, depth);
    return d;
}

function tableView(t) {
    const el = h(`<div class="out-table">
        <div class="tb-bar"><span class="tb-title"></span><input class="tb-filter" type="search" placeholder="Filtrer…" aria-label="Filtrer le tableau"><span class="tb-count"></span><button class="tb-copy" type="button" title="Copier en CSV">CSV</button></div>
        <div class="tb-scroll"><table><thead></thead><tbody></tbody></table></div><button class="tb-more" type="button" hidden>Afficher plus</button></div>`);
    el.querySelector(".tb-title").textContent = t.title || "";
    const cols = t.columns || [];
    let rows = (t.rows || []).map((r, i) => ({ r, i }));
    let sort = { col: -1, dir: 1 }, limit = 100, filter = "";
    const thead = el.querySelector("thead"), tbody = el.querySelector("tbody");
    const isNum = cols.map((_, c) => rows.length && rows.every(({ r }) => r[c] == null || typeof r[c] === "number"));
    const fmtCell = (v) => v == null ? '<span class="tb-null">NULL</span>' : typeof v === "number" ? esc(Number.isInteger(v) ? v : +v.toPrecision(8)) : esc(v);
    const draw = () => {
        thead.innerHTML = `<tr><th class="tb-idx">#</th>${cols.map((c, i) => `<th data-c="${i}" class="${isNum[i] ? "num" : ""} ${sort.col === i ? (sort.dir > 0 ? "asc" : "desc") : ""}">${esc(c)}</th>`).join("")}</tr>`;
        let view = filter ? rows.filter(({ r }) => r.some((v) => String(v ?? "").toLowerCase().includes(filter))) : rows;
        if (sort.col >= 0) {
            const c = sort.col;
            view = [...view].sort((a, b) => {
                const x = a.r[c], y = b.r[c];
                if (x == null) return 1;
                if (y == null) return -1;
                return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fr", { numeric: true })) * sort.dir;
            });
        }
        tbody.innerHTML = view.slice(0, limit).map(({ r, i }) => `<tr><td class="tb-idx">${i}</td>${r.map((v, c) => `<td class="${isNum[c] ? "num" : ""}">${fmtCell(v)}</td>`).join("")}</tr>`).join("");
        el.querySelector(".tb-count").textContent = `${view.length}${t.total > rows.length ? ` / ${t.total}` : ""} ligne${view.length > 1 ? "s" : ""} · ${cols.length} colonne${cols.length > 1 ? "s" : ""}`;
        el.querySelector(".tb-more").hidden = view.length <= limit;
    };
    thead.addEventListener("click", (e) => {
        const th = e.target.closest("th[data-c]");
        if (!th) return;
        const c = +th.dataset.c;
        sort = { col: c, dir: sort.col === c ? -sort.dir : 1 };
        draw();
    });
    el.querySelector(".tb-filter").addEventListener("input", (e) => { filter = e.target.value.toLowerCase(); draw(); });
    el.querySelector(".tb-more").addEventListener("click", () => { limit += 200; draw(); });
    el.querySelector(".tb-copy").addEventListener("click", async (e) => {
        const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        const csv = [cols.map(q).join(","), ...rows.map(({ r }) => r.map(q).join(","))].join("\n");
        try { await navigator.clipboard.writeText(csv); e.target.textContent = "Copié ✓"; } catch { e.target.textContent = "Échec"; }
        setTimeout(() => { e.target.textContent = "CSV"; }, 1400);
    });
    if (!t.title) el.querySelector(".tb-title").remove();
    draw();
    return el;
}

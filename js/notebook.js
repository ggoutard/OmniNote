// notebook.js — Modèle du notebook, format .ipynb (nbformat 4.5) et bibliothèque locale.
// Chaque cellule de code garde son langage dans metadata.lumen.language (et vscode.languageId,
// lu par les notebooks polyglottes de VS Code) ; à défaut, une magie %%sql… ou le langage du notebook.

import { LANGS } from "./languages.js";

const uid = () => Math.random().toString(36).slice(2, 10);
const STORE = "lumen.notebooks";
const CURRENT = "lumen.current";

export function newCell(type = "code", lang = "python", source = "") {
    return { id: uid(), type, lang, source, outputs: [], count: null, meta: {}, collapsed: false };
}

export function newNotebook(title = "Sans titre") {
    return { id: uid(), title, cells: [newCell("markdown", "markdown", `# ${title}\n`), newCell("code", "python", "")], meta: {}, updated: Date.now() };
}

const asText = (src) => (Array.isArray(src) ? src.join("") : String(src ?? ""));
const lines = (text) => {
    const parts = String(text).split(/(?<=\n)/);
    return parts.length === 1 && parts[0] === "" ? [] : parts;
};

// ---------------------------------------------------------------- .ipynb

export function fromIpynb(json, fallbackTitle = "Notebook importé") {
    const nb = typeof json === "string" ? JSON.parse(json) : json;
    const defLang = normLang(nb.metadata?.language_info?.name || nb.metadata?.kernelspec?.language || "python");
    const pageOf = [];
    const cells = (nb.cells || []).map((c, k) => {
        pageOf[k] = c.metadata?.lumen?.page | 0;
        const source = asText(c.source);
        if (c.cell_type === "markdown") return { ...newCell("markdown", "markdown", source), id: c.id || uid() };
        if (c.cell_type === "raw") return { ...newCell("raw", "markdown", source), id: c.id || uid() };
        const meta = c.metadata || {};
        let lang = normLang(meta.lumen?.language || meta.vscode?.languageId || defLang);
        const m = /^%%(\w+)/.exec(source);
        if (m && ["javascript", "js", "java", "html", "latex", "mermaid"].includes(m[1]) && !meta.lumen?.language) {
            lang = normLang(m[1]);
        }
        return {
            ...newCell("code", lang, source),
            id: c.id || uid(),
            count: c.execution_count ?? null,
            outputs: (c.outputs || []).map(normOutput),
            collapsed: !!meta.collapsed || !!meta.jupyter?.outputs_hidden,
        };
    });
    const out = {
        id: uid(),
        title: nb.metadata?.lumen?.title || nb.metadata?.title || fallbackTitle,
        cells: cells.length ? cells : [newCell()],
        meta: { imported: true },
        updated: Date.now(),
    };
    // les pages de TextEdit : chaque cellule porte le numéro de la sienne (metadata.lumen.page)
    const lumen = nb.metadata?.lumen || {}, names = lumen.pages;
    if (Array.isArray(names) && names.length) {
        out.pages = names.map((name, k) => ({ name: String(name || ""), path: lumen.paths?.[k] || null, cells: cells.filter((_, j) => pageOf[j] === k) }));
        out.page = Math.min(Math.max(0, lumen.page | 0), names.length - 1);
        out.cells = out.pages[out.page].cells;
        if (Array.isArray(lumen.dirs)) out.dirs = lumen.dirs.map(String);
    }
    return out;
}

function normLang(name) {
    const n = String(name || "").toLowerCase();
    const alias = { "c++": "cpp", cxx: "cpp", "c++17": "cpp", gnucobol: "cobol", cob: "cobol", python3: "python", ipython: "python", js: "javascript", node: "javascript", bash: "sh", shell: "sh", sqlite: "sql",
        md: "markdown", tex: "latex", lisp: "scheme", racket: "scheme", rs: "rust", golang: "go" };
    const v = alias[n] || n;
    return LANGS[v] ? v : "python";
}

function normOutput(o) {
    const out = { ...o };
    if (out.text != null) out.text = asText(out.text);
    if (out.data) out.data = Object.fromEntries(Object.entries(out.data).map(([k, v]) => [k, Array.isArray(v) ? v.join("") : v]));
    return out;
}

export function toIpynb(nb) {
    // plusieurs pages : toutes leurs cellules à la suite (Jupyter les montre toutes), chacune avec le numéro de sa page
    const paged = nb.pages?.length > 0;
    const all = paged ? nb.pages.flatMap((p, k) => p.cells.map((c) => [c, k])) : nb.cells.map((c) => [c, null]);
    const meta = (k, m = {}) => (k == null ? m : { ...m, lumen: { ...(m.lumen || {}), page: k } });
    return {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {
            kernelspec: { name: "lumen", display_name: "TextEdit (JarWeBox)", language: "python" },
            language_info: { name: "python", version: "3.7", file_extension: ".py", mimetype: "text/x-python" },
            lumen: { title: nb.title, version: 1, ...(paged ? { pages: nb.pages.map((p) => p.name || ""), paths: nb.pages.map((p) => p.path || null), page: nb.page | 0, ...(nb.dirs?.length ? { dirs: nb.dirs } : {}) } : {}) },
        },
        cells: all.map(([c, k]) => {
            if (c.type === "markdown" || (c.type === "code" && c.lang === "markdown")) {
                return { cell_type: "markdown", id: c.id, metadata: meta(k), source: lines(c.source) };
            }
            if (c.type === "raw") return { cell_type: "raw", id: c.id, metadata: meta(k), source: lines(c.source) };
            return {
                cell_type: "code",
                id: c.id,
                execution_count: c.count,
                metadata: meta(k, { lumen: { language: c.lang }, vscode: { languageId: c.lang }, collapsed: c.collapsed || undefined }),
                source: lines(c.source),
                outputs: c.outputs.map((o) => {
                    const out = { ...o };
                    delete out.display_id;
                    if (out.text != null) out.text = lines(out.text);
                    if (out.output_type !== "stream" && out.output_type !== "error") out.metadata ??= {};
                    if (out.data) out.data = Object.fromEntries(Object.entries(out.data).map(([k, v]) => [k, typeof v === "string" && k.startsWith("text/") ? lines(v) : v]));
                    return out;
                }),
            };
        }),
    };
}

/** Le notebook en script : les cellules de code d'un langage, les autres en commentaires. */
export function toScript(nb, lang) {
    const comment = { python: "#", sh: "#", tcl: "#", awk: "#", sql: "--", scheme: ";", javascript: "//", java: "//", cpp: "//", c: "//", rust: "//", go: "//", php: "//", cobol: "*>" }[lang] || "#";
    return nb.cells.map((c) => (c.type === "code" && c.lang === lang ? c.source : c.source.split("\n").map((l) => `${comment} ${l}`).join("\n"))).join("\n\n") + "\n";
}

// ---------------------------------------------------------------- bibliothèque locale

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const library = {
    list() {
        return safe(() => JSON.parse(localStorage.getItem(STORE)) || [], []);
    },
    save(nb) {
        nb.updated = Date.now();
        const all = library.list().filter((x) => x.id !== nb.id);
        all.unshift({ id: nb.id, title: nb.title, updated: nb.updated, cells: nb.cells.length });
        return safe(() => {
            localStorage.setItem(`${STORE}.${nb.id}`, JSON.stringify(toIpynb(nb)));
            localStorage.setItem(STORE, JSON.stringify(all.slice(0, 60)));
            localStorage.setItem(CURRENT, nb.id);
            return true;
        }, false);
    },
    load(id) {
        const raw = safe(() => localStorage.getItem(`${STORE}.${id}`), null);
        if (!raw) return null;
        const meta = library.list().find((x) => x.id === id);
        const nb = fromIpynb(raw, meta?.title);
        nb.id = id;
        return nb;
    },
    remove(id) {
        safe(() => {
            localStorage.removeItem(`${STORE}.${id}`);
            localStorage.setItem(STORE, JSON.stringify(library.list().filter((x) => x.id !== id)));
        });
    },
    current() {
        return safe(() => localStorage.getItem(CURRENT), null);
    },
};

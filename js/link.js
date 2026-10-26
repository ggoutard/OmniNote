// link.js — un document entier dans l'adresse de la page.
//
// Le texte, les résultats des blocs et les choix d'ouverture (lecture seule, mot d'accueil) sont mis en JSON,
// compressés (deflate) puis écrits en base64 après « #d= ». Ce qui suit le # ne quitte jamais le navigateur :
// le serveur (GitHub Pages) ne reçoit que la page, le document n'est enregistré nulle part.
//
//   { v: 1, title, cells: [[langage ou "", source, résultats?], …], ro: lecture seule, hello: mot d'accueil,
//     pages: [[nom, cellules, chemin], …], page (celle qui s'ouvre), dirs (les dossiers du terminal) }

const PREFIX = "#d=";
const VERSION = 1;

export const hasLink = (hash = location.hash) => hash.startsWith(PREFIX);

const toB64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** Les résultats gardés : sans les images si on n'en veut pas (une capture pèse vite des dizaines de Ko). */
function keepOutputs(outputs, images) {
    const heavy = (o) => Object.keys(o.data || {}).some((k) => k.startsWith("image/")) || o.metadata?.lumen?.window;
    return outputs.filter((o) => images || !heavy(o)).map((o) => {
        const { metadata, ...rest } = o;
        return metadata?.lumen?.window ? o : rest;
    });
}

/** Le document compressé (deflate), tel qu'il voyage dans un lien ou se range dans l'historique (versions.js). */
export async function pack(nb, { ro = false, hello = "", outputs = true, images = false } = {}) {
    const write = (cells) => cells.map((c) => {
        // (« python {2|3} » : le langage, et ce qui suit sur la ligne ``` — lignes surlignées, magic-move…)
        const lang = c.type === "code" && c.lang !== "markdown" ? c.lang + (c.meta?.fence ? " " + c.meta.fence : "") : "";
        const outs = lang && outputs && c.outputs?.length ? keepOutputs(c.outputs, images) : [];
        return outs.length ? [lang, c.source, outs] : [lang, c.source];
    });
    // plusieurs pages : toutes (cells reste la page ouverte, pour qui ne connaît pas les pages)
    const pages = nb.pages?.length ? nb.pages.map((p) => (p.path ? [p.name || "", write(p.cells || []), p.path] : [p.name || "", write(p.cells || [])])) : undefined;
    const json = JSON.stringify({ v: VERSION, title: nb.title, cells: write(nb.cells), pages, page: pages ? nb.page | 0 : undefined, dirs: nb.dirs?.length ? nb.dirs : undefined, ro: ro ? 1 : 0, hello: hello.trim() || undefined });
    return pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
}

/** L'adresse d'un document compressé (pack). */
export function linkOf(bytes) {
    return location.href.replace(/#.*$/, "").replace(/\?nb=[^#&]*/, "") + PREFIX + toB64(bytes);
}

/** nb : le document (toNotebook) ; opts : { ro, hello, outputs, images }. Rend l'adresse complète. */
export async function makeLink(nb, opts = {}) {
    return linkOf(await pack(nb, opts));
}

/** Le contraire de pack : { nb, ro, hello }. */
export async function unpack(bytes) {
    const data = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw"))));
    if (!data || data.v !== VERSION || !Array.isArray(data.cells)) throw new Error("ce lien vient d'une autre version de TextEdit");
    const read = (cells) => cells.map(([lang, source, outputs]) => (lang
        ? { type: "code", lang: String(lang).split(" ")[0], source: String(source), outputs: outputs || [], meta: String(lang).includes(" ") ? { fence: String(lang).slice(String(lang).indexOf(" ") + 1) } : {} }
        : { type: "markdown", lang: "markdown", source: String(source), outputs: [] }));
    const nb = { title: data.title || "Sans titre", cells: read(data.cells) };
    if (Array.isArray(data.pages) && data.pages.length) {
        nb.pages = data.pages.map(([name, cells, path]) => ({ name: String(name || ""), cells: read(cells || []), path: typeof path === "string" ? path : null }));
        nb.page = Math.min(Math.max(0, data.page | 0), nb.pages.length - 1);
        if (Array.isArray(data.dirs)) nb.dirs = data.dirs.map(String);
    }
    return { nb, ro: !!data.ro, hello: String(data.hello || "").slice(0, 40) };
}

/** Rend { nb, ro, hello } ou lève une erreur lisible. */
export async function readLink(hash = location.hash) {
    if (!hasLink(hash)) throw new Error("pas de document dans l'adresse");
    let bytes;
    try { bytes = fromB64(decodeURIComponent(hash.slice(PREFIX.length))); }
    catch { throw new Error("le lien est incomplet ou abîmé (a-t-il été coupé en le copiant ?)"); }
    try { return await unpack(bytes); }
    catch (e) { throw /autre version/.test(e.message) ? e : new Error("le lien est incomplet ou abîmé (a-t-il été coupé en le copiant ?)"); }
}

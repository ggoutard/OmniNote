// versions.js — l'historique du document, dans le navigateur (IndexedDB).
//
//   · des versions : le document compressé au format des liens (link.js, pack), une à chaque pause d'écriture qui
//     change vraiment quelque chose ; chacune se rouvre, se restaure, ou devient un lien à envoyer ;
//   · l'annulation (Ctrl Z) : l'historique de l'éditeur, compressé, rangé avec l'empreinte du texte auquel il
//     s'applique — il revient au rechargement de la page si le texte n'a pas changé entre-temps.
//
// Rangé en binaire (pas en base64 comme dans localStorage) : une version du tutoriel tient en 8 Ko environ.
// Sans IndexedDB (navigation privée, stockage refusé), tout se tait : l'éditeur marche comme avant.

const DB = "textedit", VERSIONS = "versions", UNDO = "undo";
const KEEP = 100;                // versions gardées par document
const SPACING = 60 * 1000;       // une version au plus par minute…
const BIG = 200;                 // … sauf un changement de plus de 200 caractères

let opening = null;
function open() {
    opening ??= new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                const v = db.createObjectStore(VERSIONS, { keyPath: "id", autoIncrement: true });
                v.createIndex("doc", "doc");
                db.createObjectStore(UNDO, { keyPath: "doc" });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch { resolve(null); }
    });
    return opening;
}

function tx(db, store, mode, fn) {
    return new Promise((resolve) => {
        try {
            const t = db.transaction(store, mode);
            const out = fn(t.objectStore(store));
            t.oncomplete = () => resolve(out?.result ?? out);
            t.onerror = t.onabort = () => resolve(null);
        } catch { resolve(null); }
    });
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** Une empreinte courte d'un texte (pour reconnaître le texte auquel s'applique un historique d'annulation). */
export async function digest(text) {
    if (!globalThis.crypto?.subtle) return String(text.length);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
    return [...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const last = new Map();   // doc -> { t, text } : la dernière version rangée pendant cette session

/**
 * Range une version si elle apporte quelque chose : pas deux fois le même texte, au plus une par minute sauf un
 * gros changement. force : à la fermeture de la page, ou avant une restauration. bytes : le document compressé.
 */
export async function remember(doc, text, title, makeBytes, { force = false } = {}) {
    const db = await open();
    if (!db) return false;
    let prev = last.get(doc);
    if (!prev) {
        const all = await list(doc);
        prev = all[0] ? { t: all[0].t, hash: all[0].hash } : { t: 0, hash: "" };
    }
    const hash = await digest(text);
    if (hash === prev.hash) return false;
    const changed = prev.text == null ? Infinity : Math.abs(text.length - prev.text.length) + diffSize(prev.text, text);
    if (!force && Date.now() - prev.t < SPACING && changed < BIG) return false;
    const bytes = await makeBytes();
    await tx(db, VERSIONS, "readwrite", (s) => s.add({ doc, t: Date.now(), title, hash, size: bytes.length, chars: text.length, bytes }));
    last.set(doc, { t: Date.now(), hash, text });
    // les plus anciennes s'en vont au-delà de KEEP
    const all = await list(doc);
    if (all.length > KEEP) await tx(db, VERSIONS, "readwrite", (s) => { for (const v of all.slice(KEEP)) s.delete(v.id); });
    return true;
}

/** Une mesure grossière de ce qui a changé : les caractères qui diffèrent hors du début et de la fin communs. */
function diffSize(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0;
    while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return Math.max(a.length, b.length) - i - j;
}

/** Les versions d'un document, de la plus récente à la plus ancienne (sans leur contenu). */
export async function list(doc) {
    const db = await open();
    if (!db) return [];
    const rows = await tx(db, VERSIONS, "readonly", (s) => s.index("doc").getAll(doc));
    return (rows || []).map(({ bytes, ...meta }) => meta).sort((a, b) => b.t - a.t);
}

/** Le contenu compressé d'une version (pour link.js : unpack, linkOf). */
export async function bytesOf(id) {
    const db = await open();
    if (!db) return null;
    const row = await tx(db, VERSIONS, "readonly", (s) => s.get(id));
    return row?.bytes || null;
}

/** Range l'historique d'annulation de l'éditeur (cm.getHistory()), compressé, avec l'empreinte du texte. */
export async function saveUndo(doc, text, history) {
    const db = await open();
    if (!db) return;
    const json = JSON.stringify(history);
    if (json.length > 4e6) return;   // une session énorme : on n'en garde rien plutôt que d'encombrer
    const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw"));
    // (tout est prêt avant la transaction : IndexedDB la referme dès qu'elle n'a plus de requête en cours)
    const hash = await digest(text);
    await tx(db, UNDO, "readwrite", (s) => s.put({ doc, hash, bytes }));
}

/** L'historique d'annulation rangé pour ce texte, ou null (un autre texte : il ne s'appliquerait pas). */
export async function loadUndo(doc, text) {
    const db = await open();
    if (!db) return null;
    const row = await tx(db, UNDO, "readonly", (s) => s.get(doc));
    if (!row || row.hash !== await digest(text)) return null;
    try { return JSON.parse(new TextDecoder().decode(await pipe(row.bytes, new DecompressionStream("deflate-raw")))); }
    catch { return null; }
}

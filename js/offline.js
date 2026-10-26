// Hors ligne et installation (PWA) : le Service Worker (sw.js) garde une copie du site, la machine comprise.
//
// Il n'est enregistré que sur le site publié (tools/publish.sh y ajoute offline.json) : sur le serveur de
// développement, les fichiers qu'on modifie ne restent pas figés dans un cache.

let installEvent = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; dispatchEvent(new Event("textedit-installable")); });

export const offline = {
    supported: "serviceWorker" in navigator && "caches" in window,
    list: null,

    /** Enregistre le Service Worker si le site est publié ; onUpdate : une nouvelle version attend */
    async register(onUpdate) {
        if (!this.supported) return false;
        // En local (localhost) : pas de copie hors ligne, chaque modification se voit au rechargement. Un Service
        // Worker installé avant est retiré, avec la copie de l'application (l'image de la machine, elle, est gardée).
        if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
            for (const reg of await navigator.serviceWorker.getRegistrations().catch(() => [])) await reg.unregister();
            for (const key of await caches.keys().catch(() => [])) if (key.startsWith("textedit-app-")) await caches.delete(key);
            return false;
        }
        const list = await fetch("offline.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
            ?? await caches.match("offline.json").then((r) => r?.json()).catch(() => null);
        if (!list) return false;
        this.list = list;
        const reg = await navigator.serviceWorker.register("sw.js").catch(() => null);
        if (!reg) return false;
        reg.addEventListener("updatefound", () => {
            const w = reg.installing;
            w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) onUpdate?.(); });
        });
        return true;
    },

    /** Ce qui est déjà gardé : { have, total, files, missing } (en octets) */
    async status() {
        if (!this.list) return null;
        let have = 0, n = 0;
        const missing = [];
        await Promise.all(this.list.files.map(async (f) => {
            if (await caches.match(f.p, { ignoreSearch: true })) { have += f.s; n++; } else missing.push(f);
        }));
        return { have, total: this.list.total, files: this.list.files.length, kept: n, missing };
    },

    /** Télécharge tout ce qui manque (la machine et ses compilateurs) ; onProgress(octets, total) */
    async downloadAll(onProgress, signal) {
        const st = await this.status();
        if (!st) throw new Error("hors ligne indisponible ici");
        // que le navigateur ne l'efface pas pour faire de la place
        await navigator.storage?.persist?.().catch(() => {});
        let done = st.have;
        onProgress?.(done, st.total);
        const queue = [...st.missing];
        const worker = async () => {
            while (queue.length && !signal?.aborted) {
                const f = queue.shift();
                const r = await fetch(f.p, { signal });   // le Service Worker le range au passage
                if (!r.ok) throw new Error(`${f.p} : HTTP ${r.status}`);
                await r.arrayBuffer();
                done += f.s;
                onProgress?.(done, st.total);
            }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
    },

    async storage() {
        const e = await navigator.storage?.estimate?.().catch(() => null);
        const persisted = await navigator.storage?.persisted?.().catch(() => false);
        return { quota: e?.quota ?? 0, usage: e?.usage ?? 0, persisted: !!persisted };
    },

    get installable() { return !!installEvent; },
    get installed() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; },
    async install() {
        if (!installEvent) return false;
        installEvent.prompt();
        const { outcome } = await installEvent.userChoice;
        installEvent = null;
        return outcome === "accepted";
    },
};

export const fmtBytes = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} Go` : n >= 2 ** 20 ? `${Math.round(n / 2 ** 20)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

// Le Service Worker de TextEdit : l'application s'installe et fonctionne hors ligne (train, avion).
//
// - L'application (HTML, JS, CSS, bibliothèques, exemples, noyau) : un cache par version du site, rempli à
//   l'installation ; la version suivante le remplace quand plus aucun onglet n'utilise l'ancienne.
// - L'image de la machine (jarwebox/image/) : un cache à part, durable. Ses fichiers portent leur empreinte dans leur
//   nom (state-<hash>, cdrom-<hash>/…) : ils ne changent jamais, on ne les télécharge qu'une fois. Les morceaux que
//   Linux lit s'y rangent au fil de l'usage ; « /hors ligne » les télécharge tous, compilateurs compris.
// - Les polices (Google Fonts) : gardées après la première visite.
// Rien ne part ailleurs : le Service Worker ne fait que garder une copie des fichiers du site.
const VERSION = "7b48fa641a7c";
const APP = `textedit-app-${VERSION}`, VM = "textedit-vm", EXT = "textedit-ext";
const scope = new URL(self.registration.scope);
// En local (localhost) : pas de copie hors ligne, pour voir chaque modification. Un Service Worker installé avant se
// retire de lui-même : il efface sa copie de l'application et recharge les pages ouvertes.
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(scope.hostname);
if (LOCAL) {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (e) => e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith("textedit-app-")) await caches.delete(k);
        await self.registration.unregister();
        for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })()));
}
const isVm = (url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname + "jarwebox/image/") && !url.pathname.endsWith("/image.json");
const fresh = (url) => url.origin === scope.origin && /\/(image\.json|offline\.json)$/.test(url.pathname);

self.addEventListener("install", (e) => {
    if (LOCAL) return;
    e.waitUntil((async () => {
        const list = await (await fetch("offline.json", { cache: "reload" })).json();
        const cache = await caches.open(APP);
        // l'application d'abord (quelques Mo) ; l'image de la machine se télécharge à part
        // (sauf sa description, image.json : sans elle, la machine ne démarre pas)
        const app = list.files.map((f) => f.p).filter((p) => !p.startsWith("jarwebox/image/") || p.endsWith("/image.json"));
        for (let i = 0; i < app.length; i += 16) await cache.addAll(app.slice(i, i + 16).map((p) => new Request(p, { cache: "reload" })));
        await cache.put("./", await cache.match("index.html"));
        await cache.put("offline.json", new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }));
    })());
});

self.addEventListener("activate", (e) => {
    if (LOCAL) return;
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k.startsWith("textedit-app-") && k !== APP) await caches.delete(k);
        // les morceaux d'une image de la machine qui n'est plus celle du site
        const list = await (await caches.open(APP)).match("offline.json").then((r) => r?.json()).catch(() => null);
        if (list) {
            const keep = new Set(list.files.map((f) => new URL(f.p, scope).href));
            const vm = await caches.open(VM);
            for (const req of await vm.keys()) if (!keep.has(req.url)) await vm.delete(req);
        }
        await self.clients.claim();
        // l'état enregistré de la machine (quelques dizaines de Mo) : gardé dès maintenant, pour qu'elle démarre hors
        // ligne même si la première visite l'a lu avant que le Service Worker ne soit en place ; le reste vient à l'usage
        const desc = await (await caches.open(APP)).match("jarwebox/image/image.json").then((r) => r?.json()).catch(() => null);
        if (desc?.state) {
            const vm = await caches.open(VM), url = new URL("jarwebox/" + desc.state, scope).href;
            if (!(await vm.match(url))) await fetch(url, { cache: "reload" }).then((r) => (r.ok ? vm.put(url, r) : null)).catch(() => {});
        }
    })());
});

self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
    if (LOCAL) return;
    const req = e.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    // la machine native (conteneur Docker) : toujours en direct
    if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname + "native/")) return;
    if (url.origin !== scope.origin) {
        // les polices : la copie gardée, rafraîchie en passant
        if (!/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;
        e.respondWith((async () => {
            const cache = await caches.open(EXT), hit = await cache.match(req);
            const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") cache.put(req, r.clone()); return r; }).catch(() => hit);
            return hit || net;
        })());
        return;
    }
    if (fresh(url)) {
        // la description de l'image et la liste du site : le réseau d'abord, la copie hors ligne — aussi quand le site
        // répond mais en erreur (un site retiré ou rendu privé : 404) ; sinon la machine ne démarrerait plus du tout
        const kept = async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match(url.pathname.endsWith("offline.json") ? "offline.json" : req));
        e.respondWith(fetch(req).then(async (r) => {
            if (r.ok) { (await caches.open(APP)).put(url.pathname.endsWith("offline.json") ? "offline.json" : req, r.clone()); return r; }
            return (await kept()) || r;
        }).catch(async () => (await kept()) || Response.error()));
        return;
    }
    e.respondWith((async () => {
        const name = isVm(url) ? VM : APP;
        const cache = await caches.open(name);
        // une page ouverte avec ?nb=… ou #… : la même application
        const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" || name === APP }) || (req.mode === "navigate" ? await cache.match("./") : null);
        if (hit) return hit;
        try {
            const r = await fetch(req);
            if (r.ok && r.status === 200) cache.put(req, r.clone());
            return r;
        } catch (err) {
            return Response.error();
        }
    })());
});

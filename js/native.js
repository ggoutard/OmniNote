// La machine native : la page est servie par le conteneur Docker d'OmniNote (tools/native/server.py), qui fait
// tourner la même machine sans émulateur. Cet objet remplace JarWeBox auprès du noyau (kernel.js) : les mêmes
// commandes du lanceur (SH, NEW, PUT, RUN…) partent par HTTP, les trames du noyau arrivent par Server-Sent Events.
// Pas d'écran : les fenêtres (tkinter, Swing) ne s'ouvrent que dans la machine émulée.

/** La page vient-elle du conteneur ? (une réponse de /native/info ; ailleurs, 404 tout de suite) */
export async function nativeInfo(base) {
    try {
        const r = await fetch(base + "native/info", { cache: "no-store" });
        if (!r.ok) return null;
        const info = await r.json();
        return info?.native ? info : null;
    } catch { return null; }
}

export class NativeBox extends EventTarget {
    constructor(base, info) {
        super();
        this.base = base;
        this.info = info;
        this.native = true;
        this.image = null;          // pas d'état enregistré : le noyau s'installe au démarrage (quelques secondes)
        this.canvas = null;
        this.viewport = null;
        this.screen = null;
        this.area = null;
    }

    async start() {
        await new Promise((resolve, reject) => {
            this.events = new EventSource(this.base + "native/events");
            this.events.onopen = () => resolve();
            this.events.onerror = () => reject(new Error("la machine native ne répond pas"));
        });
        // (une coupure : EventSource se reconnecte de lui-même)
        this.events.onerror = null;
        this.events.onmessage = (e) => this.onMessage(e.data);
    }

    /** Une trame « @@… » (sans les @@) ; le noyau intercepte LX et LP, le reste arrive ici */
    onMessage(msg) {
        if (msg.startsWith("TITLE ")) this.dispatchEvent(new CustomEvent("title", { detail: { title: msg.slice(6) } }));
    }

    async request(cmd, type, timeout = 15000) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeout);
        try {
            const r = await fetch(this.base + "native/cmd", { method: "POST", body: cmd, headers: { "Content-Type": "text/plain" }, signal: ctl.signal });
            const text = await r.text();
            if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
            const space = text.indexOf(" "), got = space < 0 ? text : text.slice(0, space), arg = space < 0 ? "" : text.slice(space + 1);
            if (got === "ERR") throw new Error(arg);
            if (got !== type) throw new Error(`réponse inattendue à ${cmd.split(" ")[0]} : ${text}`);
            return arg;
        } catch (e) {
            if (e.name === "AbortError") throw new Error(`pas de réponse à ${cmd.split(" ")[0]}`);
            throw e;
        } finally { clearTimeout(timer); }
    }

    send(cmd) { fetch(this.base + "native/cmd", { method: "POST", body: cmd, headers: { "Content-Type": "text/plain" } }).catch(() => {}); }
    ping() { return this.request("PING", "PONG", 5000); }
    // (l'écran de la machine : il n'y en a pas)
    layout() {}
    realKeys() { return false; }
    xLayout() { return "qwerty"; }
    show() {}
    hide() {}
}

// kernel.js — Le noyau de Lumen : la machine virtuelle JarWeBox (Linux x86 émulé dans la page).
//
//   · un noyau Python résident (kernel/lumen_kernel.py) sert python, sh, sql, tcl, scheme, awk, et les langages
//     compilés ou interprétés dans la machine : c, cpp, cobol, rust, go, php ;
//   · un module Java (kernel/lumen-java.jar), chargé dans la JVM déjà chaude du lanceur, sert
//     javascript (Nashorn) et java (compilateur ECJ, téléversé à la première cellule Java).
//
// La jonction (Junction) relie leurs variables : une variable écrite dans un langage se lit dans tous les autres,
// et dans les phrases du texte.
//
// Aller : requêtes JSON en base64 écrites dans /tmp/lumen/in (ou jin) par la commande SH du lanceur.
// Retour : lignes « @@LX <base64> » sur le port série, interceptées avant le lecteur JarWeBox.

import { JarWeBox } from "../jarwebox/jarwebox.js";
import { NativeBox, nativeInfo } from "./native.js";
import { diag } from "./diag.js";

const PY = "/usr/local/jarwebox/run-native /usr/local/native/python/bin/python3.7";
const JAVA_LANGS = new Set(["javascript", "java"]);
/** L'empreinte SHA-256 d'un fichier (null hors d'un contexte sûr : http:// sur une autre machine que localhost). */
async function sha256(bytes) {
    if (!globalThis.crypto?.subtle) return null;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CHUNK = 49152;          // base64 par PUT (téléversements binaires)
const SH_CHUNK = 100000;      // base64 par commande SH (limite d'un argument : 128 Kio)

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
};
const unb64 = (s) => dec.decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/**
 * La jonction : l'espace des variables communes à tous les langages (et aux phrases du texte, langage « gl »).
 * Chaque variable garde sa dernière valeur, la sorte de cette valeur (int, float, str, bool, int[], float[], str[],
 * bool[], list, fiche) et le langage qui l'a écrite. La dernière écriture l'emporte, quel que soit le langage.
 *
 * Avant une cellule, give(langage) rend les variables que ce langage n'a pas encore vues sous leur valeur actuelle ;
 * après, take(langage, valeurs) garde celles qu'il a changées. Un langage sans état d'une cellule à l'autre (C, Rust,
 * PHP…) reçoit toutes les variables à chaque fois : le noyau ne lui donne que celles que nomme la cellule.
 */
export class Junction extends EventTarget {
    static STATELESS = new Set(["c", "cpp", "cobol", "rust", "go", "php", "awk"]);

    constructor() {
        super();
        this.vars = new Map();      // nom -> { v, k, lang, n }
        this.reserved = new Set();  // les noms des formules du document (formulas.js) : ni reçus ni donnés
        this.seen = new Map();      // langage -> Map(nom -> valeur vue, en JSON)
        this.n = 0;
    }

    static key(x) { return JSON.stringify([x.v, x.k]); }

    give(lang) {
        const seen = Junction.STATELESS.has(lang) ? new Map() : this.seen.get(lang) || new Map();
        const out = {};
        for (const [name, x] of this.vars) {
            if (this.reserved.has(name)) continue;
            const key = Junction.key(x);
            if (seen.get(name) === key) continue;
            out[name] = { v: x.v, k: x.k };
            seen.set(name, key);
        }
        this.seen.set(lang, seen);
        return out;
    }

    take(lang, values = {}) {
        const seen = this.seen.get(lang) || new Map();
        let changed = false;
        for (const [name, x] of Object.entries(values)) {
            if (!x || !x.k || this.reserved.has(name)) continue;
            const key = Junction.key(x);
            if (seen.get(name) === key) continue;
            seen.set(name, key);
            const cur = this.vars.get(name);
            if (cur && Junction.key(cur) === key) continue;
            this.vars.set(name, { v: x.v, k: x.k, lang, n: ++this.n });
            changed = true;
        }
        this.seen.set(lang, seen);
        if (changed) this.dispatchEvent(new CustomEvent("change", { detail: { lang } }));
    }

    /** Ces langages ont perdu leurs variables (noyau redémarré) : ils recevront de nouveau toutes celles de la jonction. */
    forget(langs) { for (const l of langs) this.seen.delete(l); }

    /** Les variables écrites par d'autres que lang : { nom: valeur } (une fiche : { $fiche: … }, comme les données
     *  que boivent les phrases). */
    values(except) {
        const out = {};
        const conv = (v, k) => (k === "fiche" && v && typeof v === "object" && !Array.isArray(v) ? { $fiche: v } : v);
        for (const [name, x] of this.vars) if (x.lang !== except) out[name] = conv(x.v, x.k);
        return out;
    }

    /** Pour l'affichage : nom, valeur, sorte, langage d'origine. */
    list() { return [...this.vars].map(([name, x]) => ({ name, ...x })).sort((a, b) => a.name.localeCompare(b.name)); }
}

export class Kernel extends EventTarget {
    constructor(screen, { base = "./" } = {}) {
        super();
        this.screen = screen;
        this.base = base;
        this.state = "off";            // off | booting | starting | ready | busy | error
        this.seq = 0;
        this.handlers = new Map();     // id de cellule -> fonction(événement)
        this.pending = new Map();      // rid -> resolve
        this.parts = new Map();
        this.lock = Promise.resolve();
        this.jobs = [];            // exécutions en attente, une à la fois ; celles qu'on lance passent devant l'arrière-plan
        this.pumping = false;
        this.java = { state: "off", ecj: "off", warm: {} };
        this.current = null;
        this.junction = new Junction();
    }

    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

    setState(state, info = {}) {
        this.state = state;
        diag.state(state, info.label);
        this.emit("state", { state, ...info });
    }

    // ---------------------------------------------------------------- démarrage

    async start() {
        if (this.booting) return this.booting;
        this.booting = (async () => {
            this.setState("booting", { label: "Démarrage de la machine", progress: 0 });
            // servie par le conteneur Docker : la machine native (sans émulateur) ; sinon, la machine émulée
            const native = await nativeInfo(this.base);
            this.native = !!native;
            const jw = native ? new NativeBox(this.base, native) : new JarWeBox(this.screen, { ratio: "4:3", keyboard: "auto" });
            this.jw = jw;
            jw.addEventListener("progress", (e) => {
                const p = e.detail.total ? e.detail.loaded / e.detail.total : 0;
                this.setState("booting", { label: "Téléchargement de la machine", progress: p * 0.8 });
            });
            // Les trames du notebook passent avant le lecteur ; le reste lui revient.
            const original = jw.onMessage.bind(jw);
            jw.onMessage = (msg) => {
                if (msg.startsWith("LX ")) this.frame(msg.slice(3));
                else if (msg.startsWith("LP ")) this.part(msg.slice(3));
                else original(msg);
            };
            jw.addEventListener("title", (e) => this.emit("window-title", e.detail));
            await jw.start();
            this.setState("starting", { label: "Installation du noyau", progress: 0.85 });
            // Une application ouverte dans l'état enregistré se ferme (sans application, CLOSE ne répond rien : on n'attend pas)
            if (jw.image?.preloaded) await this.serial(() => jw.request("CLOSE", "CLOSED", 4000).catch(() => {}));
            await this.installKernel();
            return this;
        })().catch((e) => {
            this.setState("error", { label: String(e.message || e) });
            this.booting = null;
            throw e;
        });
        return this.booting;
    }

    async installKernel() {
        const src = await (await fetch(this.base + "kernel/lumen_kernel.py")).arrayBuffer();
        // L'état enregistré de la machine contient déjà le noyau, démarré (tools/build_snapshot.js) : s'il est de la
        // même version, il suffit de vérifier qu'il répond — rien à téléverser, Python est déjà chargé
        const pre = this.jw.image?.lumen;
        if (pre?.kernel && pre.kernel === await sha256(src)) {
            try {
                await this.ask("in", { op: "ping" }, 20000);
                await this.resync();
                this.info = pre.hello;
                this.setState("ready", { label: "Prêt", progress: 1, info: this.info });
                return;
            } catch { /* il ne répond pas : on l'installe */ }
        }
        // Un ordinateur lent, ou un onglet passé en arrière-plan (le navigateur le ralentit), peut laisser passer
        // le délai d'une commande : on vérifie que le lanceur répond, puis on recommence
        for (let k = 1; ; k++) {
            try { await this.upload("lumenk", new Uint8Array(src), "bin"); break; }
            catch (e) {
                if (k >= 4) throw e;
                this.setState("starting", { label: `Installation du noyau (nouvel essai ${k + 1})`, progress: 0.85 });
                await this.jw.ping().catch(() => {});
            }
        }
        const hello = this.waitFrame((m) => m.t === "hello", 180000);
        // (un noyau d'une autre version, démarré dans l'état enregistré, s'arrête d'abord : un seul lit la boîte)
        await this.sh("kill -9 $(cat /tmp/lumen/kernel.pid 2>/dev/null) 2>/dev/null; rm -rf /tmp/lumen/in; mkdir -p /tmp/lumen/in /tmp/lumen/jin && " +
            "cp /tmp/jarwebox/lumenk.bin /tmp/lumen/kernel.py && " +
            `(nohup ${PY} -u /tmp/lumen/kernel.py > /tmp/lumen/kernel.log 2>&1 < /dev/null &)`);
        this.info = await hello;
        await this.resync();
        this.setState("ready", { label: "Prêt", progress: 1, info: this.info });
    }

    /** La page repart de zéro : le noyau oubliera ce qu'il lui a déjà envoyé, et renverra tout au prochain envoi. */
    async resync() {
        this.glData = null;
        await this.ask("in", { op: "resync" }, 5000).catch(() => {});   // (un noyau d'avant ne connaît pas resync : sans réponse, rien ne change)
    }

    // ---------------------------------------------------------------- port série

    /** Un seul échange avec le lanceur à la fois (ses réponses ACK/SH ne sont pas numérotées). */
    serial(fn, bytes = 0) {
        // (chaque échange est mesuré : diag.js)
        const go = () => { const t = performance.now(); return Promise.resolve().then(fn).finally(() => diag.exchange(performance.now() - t, bytes)); };
        const run = this.lock.then(go, go);
        this.lock = run.catch(() => {});
        return run;
    }

    sh(cmd, timeout = 90000) {
        return this.serial(() => this.jw.request(`SH ${cmd}`, "SH", timeout), cmd.length);
    }

    /** Téléverse un fichier dans /tmp/jarwebox. Le port série est pris bloc par bloc : une cellule
     *  lancée pendant un long téléversement (le compilateur Java) passe entre deux blocs. */
    async upload(id, bytes, kind = "bin", onProgress) {
        const data = b64(bytes);
        const run = async () => {
            // Délais larges : une machine émulée sur un ordinateur lent, ou dans un onglet en arrière-plan, répond lentement
            await this.serial(() => this.jw.request(`NEW ${id} ${kind}`, "ACK", 60000));
            for (let i = 0; i < data.length; i += CHUNK) {
                await this.serial(() => this.jw.request(`PUT ${data.slice(i, i + CHUNK)}`, "ACK", 90000), Math.min(CHUNK, data.length - i));
                onProgress?.(Math.min(1, (i + CHUNK) / data.length));
            }
            // NEW referme le fichier en cours : il est alors complet sur le disque
            await this.serial(() => this.jw.request("NEW _lumen_close bin", "ACK", 60000));
        };
        // Un seul téléversement à la fois : le lanceur n'a qu'un fichier ouvert
        const p = (this.uploading || Promise.resolve()).then(run, run);
        this.uploading = p.catch(() => {});
        return p;
    }

    /** Dépose une requête JSON dans la boîte du noyau (in) ou du module Java (jin). */
    async post(box, obj) {
        const data = b64(enc.encode(JSON.stringify(obj)));
        const name = String(++this.seq).padStart(7, "0");
        const tmp = `/tmp/lumen/${box}/.${name}`, req = `/tmp/lumen/${box}/${name}.req`;
        // Une requête courte (le cas courant) : un seul aller-retour sur le port série
        if (data.length <= SH_CHUNK) { await this.sh(`printf %s '${data}' > ${tmp} && mv ${tmp} ${req}`); return; }
        for (let i = 0; i < data.length; i += SH_CHUNK) {
            await this.sh(`printf %s '${data.slice(i, i + SH_CHUNK)}' ${i ? ">>" : ">"} ${tmp}`);
        }
        await this.sh(`mv ${tmp} ${req}`);
    }

    frame(raw) {
        let msg;
        try {
            msg = JSON.parse(unb64(raw));
        } catch {
            return;
        }
        diag.received(msg.t, raw.length);
        this.dispatch(msg);
    }

    part(rest) {
        const [mid, i, n, chunk] = rest.split(" ");
        const list = this.parts.get(mid) || [];
        list[+i] = chunk;
        this.parts.set(mid, list);
        if (list.filter((x) => x !== undefined).length === +n) {
            this.parts.delete(mid);
            this.frame(list.join(""));
        }
    }

    dispatch(msg) {
        this.emit("message", msg);
        if (msg.rid && this.pending.has(msg.rid)) {
            this.pending.get(msg.rid)(msg);
            this.pending.delete(msg.rid);
        }
        for (const w of [...(this.frameWaiters || [])]) {
            if (w.pred(msg)) {
                this.frameWaiters.splice(this.frameWaiters.indexOf(w), 1);
                clearTimeout(w.timer);
                w.resolve(msg);
            }
        }
        if (msg.t === "hello-java") this.java.version = msg.java;
        if (msg.t === "vars") {
            if (msg.cost) diag.log("variables", msg.cost);
            // le noyau n'envoie que ce qui a changé (delta) : on recompose l'ensemble, que la page reçoit comme avant
            const g = (this.glData ??= { vars: [], values: {}, tables: {}, langs: {} });
            if (!msg.delta) Object.assign(g, { vars: msg.vars || [], values: msg.values || {}, tables: msg.tables || {}, langs: msg.langs || {} });
            else {
                if (msg.vars) g.vars = msg.vars;
                for (const k of ["values", "tables", "langs"]) {
                    if (msg[k]) g[k] = { ...g[k], ...msg[k] };
                    if (msg[`${k}_gone`]?.length) { g[k] = { ...g[k] }; for (const name of msg[`${k}_gone`]) delete g[k][name]; }
                }
            }
            this.emit("vars", g.vars);
            this.emit("gl-data", { values: g.values, tables: g.tables, langs: g.langs });
        }
        if (msg.t === "gl-vars") this.emit("gl-lang", { lang: msg.lang, values: msg.values || {} });
        if (msg.t === "share") this.junction.take(msg.lang, msg.values || {});
        if (msg.t === "warm") {
            this.java.warm[msg.lang] = msg.error ? "error" : "ready";
            this.emit("java", this.java);
        }
        if (msg.id && this.handlers.has(msg.id)) this.handlers.get(msg.id)(msg);
    }

    waitFrame(pred, timeout = 30000) {
        this.frameWaiters ??= [];
        return new Promise((resolve, reject) => {
            const w = { pred, resolve };
            w.timer = setTimeout(() => {
                this.frameWaiters.splice(this.frameWaiters.indexOf(w), 1);
                reject(new Error("le noyau ne répond pas"));
            }, timeout);
            this.frameWaiters.push(w);
        });
    }

    async ask(box, obj, timeout = 20000) {
        const rid = "r" + (++this.seq);
        const reply = new Promise((resolve, reject) => {
            this.pending.set(rid, resolve);
            setTimeout(() => { if (this.pending.delete(rid)) reject(new Error("pas de réponse")); }, timeout);
        });
        await this.post(box, { ...obj, rid });
        return reply;
    }

    // ---------------------------------------------------------------- module Java (JavaScript, Java)

    async ensureJava({ compiler = false } = {}) {
        await this.start();
        if (this.java.state === "off") {
            this.java.state = "loading";
            this.emit("java", this.java);
            this.javaReady = (async () => {
                const jar = new Uint8Array(await (await fetch(this.base + "kernel/lumen-java.jar")).arrayBuffer());
                // Le module tourne déjà dans l'état enregistré, préchauffé : de la même version, il suffit qu'il réponde
                const pre = this.jw.image?.lumen;
                if (pre?.java) {
                    const same = pre.java === await sha256(jar);
                    if (same) {
                        try {
                            await this.ask("jin", { op: "ping" }, 15000);
                            this.java.state = "ready";
                            this.java.warm = { javascript: "ready", java: "ready" };
                            this.emit("java", this.java);
                            return;
                        } catch { /* il ne répond pas : on le charge */ }
                    }
                    // une autre version : elle cesse de lire la boîte avant que la nouvelle ne démarre
                    await this.post("jin", { op: "quit" }).catch(() => {});
                    await new Promise((r) => setTimeout(r, 300));
                }
                await this.upload("lumenjava", jar, "jar");
                const hello = this.waitFrame((m) => m.t === "hello-java", 60000);
                await this.serial(() => this.jw.request("RUN lumenjava", "STARTED", 30000));
                await hello;
                this.java.state = "ready";
                this.emit("java", this.java);
            })().catch((e) => {
                this.java.state = "off";
                this.emit("java", this.java);
                throw e;
            });
        }
        await this.javaReady;
        // ECJ est dans l'image de la machine (lumen-java.tcz) : rien à téléverser
        if (compiler && this.java.ecj !== "ready" && this.jw.image?.lumen?.ecj) { this.java.ecj = "ready"; this.emit("java", this.java); }
        if (compiler && this.java.ecj !== "ready") {
            if (!this.ecjReady) {
                this.java.ecj = "loading";
                this.emit("java", this.java);
                this.ecjReady = (async () => {
                    const jar = new Uint8Array(await (await fetch(this.base + "vendor/ecj/ecj-4.6.1.jar")).arrayBuffer());
                    await this.upload("ecj", jar, "bin", (p) => this.emit("ecj-progress", p));
                    this.java.ecj = "ready";
                    this.emit("java", this.java);
                })().catch((e) => {
                    this.java.ecj = "off";
                    this.ecjReady = null;
                    this.emit("java", this.java);
                    throw e;
                });
            }
            await this.ecjReady;
        }
    }

    /** Charge à l'avance Nashorn et ECJ : la première cellule JavaScript ou Java est alors immédiate. */
    async warm(lang) {
        if (this.java.warm[lang]) return;
        this.java.warm[lang] = "warming";
        this.emit("java", this.java);
        try {
            // C, C++, COBOL : le noyau compile un programme minimal (compilateur et en-têtes en cache)
            if (!JAVA_LANGS.has(lang)) { await this.start(); await this.post("in", { op: "warm", lang }); return; }
            await this.ensureJava({ compiler: lang === "java" });
            // déjà chaud dans l'état enregistré de la machine : rien à faire (une cellule attendrait derrière)
            if (this.java.warm[lang] === "ready") return;
            await this.post("jin", { op: "warm", lang });
        } catch {
            this.java.warm[lang] = null;
            this.emit("java", this.java);
        }
    }

    // ---------------------------------------------------------------- exécution

    /**
     * Exécute une cellule ; on(événement) reçoit stream, display, result, error, input, clear.
     * extra.background (et extra.label) : une tâche d'arrière-plan (le programme C++ des phrases…) — une cellule
     * qu'on lance passe devant les tâches d'arrière-plan qui n'ont pas encore commencé.
     */
    execute(lang, code, on, extra = {}) {
        const id = "x" + (++this.seq);
        const { background = false, label = "", ...rest } = extra;
        diag.job(id, { lang, label, background, bytes: code.length });
        // le dernier moment où l'on a fait exécuter quelque chose (les tâches d'arrière-plan attendent qu'on s'arrête)
        if (!background) this.lastForeground = Date.now();
        const run = async () => {
            await this.start();
            const java = JAVA_LANGS.has(lang);
            if (java) await this.ensureJava({ compiler: lang === "java" });
            this.current = { id, lang, java, background, label };
            diag.mark(id, "started");
            this.setState("busy", { label: "Exécution" });
            const done = new Promise((resolve) => {
                this.handlers.set(id, (msg) => {
                    // cédée avant d'avoir commencé (encore en téléversement) : interrompue dès qu'elle démarre
                    if (msg.t === "status" && this.preempted === id) this.interrupt().catch(() => {});
                    if (msg.t === "status") diag.mark(id, "running");
                    if (msg.t === "stage") diag.stage(id, msg.text || "");
                    if (msg.t === "error") diag.find(id) && (diag.find(id).error = `${msg.ename} : ${msg.evalue}`);
                    if (msg.t === "done") {
                        this.handlers.delete(id);
                        resolve(msg);
                    } else on(msg);
                });
            });
            await this.post(java ? "jin" : "in", { op: "exec", id, lang, code, share: this.junction.give(lang), ...rest });
            diag.mark(id, "posted");
            const result = await done;
            if (this.preempted === id) { result.preempted = true; this.preempted = null; }
            diag.end(id, { ok: result.ok !== false, preempted: !!result.preempted, ms: result.ms, error: diag.find(id)?.error });
            if (!background) this.lastForeground = Date.now();
            this.current = null;
            this.setState("ready", { label: "Prêt" });
            return result;
        };
        return new Promise((resolve, reject) => {
            const job = { run, resolve, reject, background };
            const k = background ? -1 : this.jobs.findIndex((j) => j.background);
            if (k < 0) this.jobs.push(job); else this.jobs.splice(k, 0, job);
            // une tâche d'arrière-plan déjà lancée cède la place : interrompue, elle sera relancée par qui l'a demandée
            if (!background && this.current?.background && this.preempted !== this.current.id) {
                this.preempted = this.current.id;
                this.interrupt().catch(() => {});
            }
            this.pump();
        });
    }

    /** Ce que la machine exécute en ce moment ({ lang, background, label }), ou null. */
    get running() { return this.current; }

    async pump() {
        if (this.pumping) return;
        this.pumping = true;
        while (this.jobs.length) {
            const job = this.jobs.shift();
            try { job.resolve(await job.run()); } catch (e) { this.current = null; job.reject(e); }
        }
        this.pumping = false;
    }

    async interrupt() {
        if (!this.current) return;
        if (this.current.java) await this.sh("touch /tmp/lumen/jin/stop");
        else await this.sh("kill -INT $(cat /tmp/lumen/kernel.pid)");
    }

    async restart() {
        if (!this.jw) return this.start();
        this.setState("starting", { label: "Redémarrage du noyau", progress: 0.9 });
        for (const [id, h] of this.handlers) h({ t: "done", id, ok: false, ms: 0 });
        this.handlers.clear();
        await this.sh("kill -9 $(cat /tmp/lumen/kernel.pid) 2>/dev/null; rm -rf /tmp/lumen/in/* /tmp/lumen/jin/* /tmp/lumen/java/classes; " +
            "rm -f /tmp/lumen/notebook.db");
        if (this.java.state === "ready") await this.post("jin", { op: "reset" }).catch(() => {});
        // Les langages redémarrés n'ont plus leurs variables : ils recevront toutes celles de la jonction
        this.junction.forget(["python", "sh", "sql", "tcl", "scheme", "javascript", "java"]);
        const hello = this.waitFrame((m) => m.t === "hello", 180000);
        await this.sh(`(nohup ${PY} -u /tmp/lumen/kernel.py > /tmp/lumen/kernel.log 2>&1 < /dev/null &)`);
        this.info = await hello;
        this.glData = null;   // (un noyau neuf : il renverra tout)
        this.current = null;
        this.setState("ready", { label: "Prêt", info: this.info });
    }

    async reply(value) {
        const data = b64(enc.encode(JSON.stringify({ value })));
        await this.sh(`printf %s '${data}' > /tmp/lumen/in/.input && mv /tmp/lumen/in/.input /tmp/lumen/in/input.reply`);
    }

    // Requêtes « hors cellule » : servies entre deux exécutions
    complete(code, pos) { return this.ask("in", { op: "complete", code, pos }, 8000); }
    inspect(name) { return this.ask("in", { op: "inspect", name }, 8000); }
    files(path) { return this.ask("in", { op: "ls", path }, 10000); }
    readFile(path) { return this.ask("in", { op: "read", path }, 30000); }
    writeFile(path, bytes) { return this.ask("in", { op: "write", path, b64: b64(bytes) }, 60000); }
    vars() { return this.post("in", { op: "vars" }); }
}

// diag.js — le diagnostic de TextEdit : ce que fait la machine, mesuré, pour comprendre ce qui est lent ou ce qui
// casse sans deviner. Rien ne sort du navigateur : /diagnostic l'affiche, « Copier le rapport » le met dans le
// presse-papiers (pour le coller où l'on veut), et window.textedit le donne aux tests et à la console.
//
// Ce qui est noté : les étapes du démarrage (machine, noyau, Java), chaque exécution (attente dans la file, envoi
// du code, compilation, exécution, interruption), les échanges sur le port série (nombre, durée, volume), les
// erreurs de la page. ?debug dans l'adresse les écrit aussi dans la console, au fil de l'eau.

const MAX_EVENTS = 500, MAX_JOBS = 80;
const now = () => performance.now();
const verbose = /[?&]debug\b/.test(location.search);

export const diag = {
    events: [],
    jobs: [],
    serial: { count: 0, ms: 0, bytes: 0, slowest: 0 },
    incoming: {},   // ce que la machine renvoie, par sorte de message : { n, bytes, largest }
    boot: { start: null, phases: [] },
    errors: [],

    /** Un événement daté (ms depuis l'ouverture de la page). */
    log(kind, data = {}) {
        const e = { t: Math.round(now()), kind, ...data };
        this.events.push(e);
        if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
        if (verbose) console.debug(`[textedit ${(e.t / 1000).toFixed(2)} s] ${kind}`, data);
        return e;
    },

    /** L'état de la machine change (booting, starting, ready, busy, error) : les étapes du démarrage sont gardées. */
    state(state, label = "") {
        if (state === "busy" || state === "ready" && this.boot.phases.at(-1)?.state === "ready") return;
        if (state === "booting" && this.boot.start == null) this.boot.start = now();
        this.boot.phases.push({ t: Math.round(now()), state, label });
        this.log("machine", { state, label });
        if (state === "error") this.errors.push({ t: Math.round(now()), where: "machine", message: label });
    },

    /** Un échange sur le port série (une commande et sa réponse). */
    exchange(ms, bytes = 0) {
        const s = this.serial;
        s.count++; s.ms += ms; s.bytes += bytes; s.slowest = Math.max(s.slowest, ms);
    },

    /** Un message reçu de la machine (sa taille, en base64, telle qu'elle passe sur le port série). */
    received(type, bytes) {
        const r = (this.incoming[type || "?"] ??= { n: 0, bytes: 0, largest: 0 });
        r.n++; r.bytes += bytes; r.largest = Math.max(r.largest, bytes);
    },

    // ---- les exécutions : file d'attente → envoi → (compilation) → exécution → fin
    job(id, info) {
        const j = { id, ...info, queued: now(), started: null, posted: null, running: null, ended: null, stages: [] };
        this.jobs.push(j);
        if (this.jobs.length > MAX_JOBS) this.jobs.splice(0, this.jobs.length - MAX_JOBS);
        this.log("file", { id, label: info.label || info.lang, background: !!info.background });
        return j;
    },
    find(id) { return this.jobs.findLast?.((j) => j.id === id) ?? [...this.jobs].reverse().find((j) => j.id === id); },
    mark(id, step) { const j = this.find(id); if (j && j[step] == null) j[step] = now(); },
    stage(id, text) { const j = this.find(id); if (j) j.stages.push({ t: now(), text }); },
    end(id, { ok = true, preempted = false, ms = null, error = null } = {}) {
        const j = this.find(id);
        if (!j) return;
        Object.assign(j, { ended: now(), ok, preempted, kernelMs: ms, error });
        this.log("fin", { id, label: j.label || j.lang, ok, preempted, total: Math.round(j.ended - j.queued) });
        if (!ok && error) this.errors.push({ t: Math.round(now()), where: j.label || j.lang, message: error });
    },

    /** Les durées d'une exécution, en ms : attente, envoi, compilation, exécution, total. */
    timing(j) {
        const r = (a, b) => (a != null && b != null ? Math.max(0, Math.round(b - a)) : null);
        const comp = j.stages.find((s) => /compil/i.test(s.text));
        const after = comp ? j.stages.find((s) => s.t > comp.t && !/compil/i.test(s.text)) : null;
        return {
            wait: r(j.queued, j.started),
            send: r(j.started, j.posted),
            pickup: r(j.posted, j.running),
            compile: comp ? r(comp.t, after?.t ?? j.ended) : null,
            run: r(j.running ?? j.posted, j.ended),
            total: r(j.queued, j.ended),
        };
    },

    /** Le rapport en texte, à coller dans un message. */
    report(extra = {}) {
        const ms = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
        const lines = [`TextEdit — diagnostic, ${new Date().toLocaleString("fr-FR")}`, ""];
        for (const [k, v] of Object.entries(extra)) lines.push(`${k} : ${v}`);
        lines.push("", "Démarrage de la machine :");
        const b0 = this.boot.start ?? 0;
        this.boot.phases.forEach((p, i, all) => { if (all[i + 1]?.label !== p.label || all[i + 1]?.state !== p.state) lines.push(`  +${ms(Math.round(p.t - b0))}  ${p.state}  ${p.label}`); });
        const s = this.serial;
        lines.push("", `Port série : ${s.count} échanges, ${ms(Math.round(s.ms))} en tout (moyenne ${ms(s.count ? Math.round(s.ms / s.count) : null)}, le plus long ${ms(Math.round(s.slowest))}), ${(s.bytes / 1024).toFixed(0)} Ko envoyés`);
        const inc = Object.entries(this.incoming).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8);
        if (inc.length) lines.push(`Reçu de la machine : ${inc.map(([t, r]) => `${t} ${r.n}× ${(r.bytes / 1024).toFixed(0)} Ko (max ${(r.largest / 1024).toFixed(0)} Ko)`).join(" · ")}`);
        lines.push("", "Exécutions (attente · envoi · prise en main · compilation · exécution · total) :");
        for (const j of this.jobs.slice(-30)) {
            const t = this.timing(j);
            lines.push(`  ${(j.label || j.lang || "?").padEnd(34).slice(0, 34)} ${[t.wait, t.send, t.pickup, t.compile, t.run, t.total].map(ms).join(" · ")}${j.preempted ? "  (a cédé la place)" : j.ended == null ? "  (en cours)" : j.ok === false ? "  (erreur)" : ""}`);
        }
        if (this.errors.length) {
            lines.push("", "Erreurs :");
            for (const e of this.errors.slice(-15)) lines.push(`  +${ms(e.t)}  ${e.where} : ${String(e.message).slice(0, 200)}`);
        }
        return lines.join("\n");
    },
};

addEventListener("error", (e) => { diag.errors.push({ t: Math.round(now()), where: "page", message: `${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})` }); });
addEventListener("unhandledrejection", (e) => { diag.errors.push({ t: Math.round(now()), where: "page", message: String(e.reason?.message || e.reason) }); });

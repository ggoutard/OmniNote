// reactive.js — le document réactif : une valeur change, tout ce qui en dépend se recalcule, seul.
//
// Ce qui change : une donnée des phrases (« Le loyer vaut {650, de 400 à 1500}. » : un curseur qu'on fait glisser, ou
// la phrase qu'on réécrit), ou les noms qu'un bloc définit quand on l'exécute. Ce qui se recalcule : les blocs qui lisent
// ces noms, dans l'ordre du document (toutes les pages), puis ceux qui lisent ce que ceux-là redéfinissent, et ainsi de
// suite — rien d'autre. Les phrases et les formules suivent d'elles-mêmes (elles lisent la jonction).
//
// La machine émulée est lente : les changements rapprochés se regroupent (un instant après le dernier), un calcul en
// cours que rend caduc une nouvelle valeur est interrompu, et l'on repart avec elle. Un bloc lent ou à effets s'exclut
// par « #| réactif: non » (il est marqué « à relancer ») ; les fenêtres graphiques (tkinter, Swing…) et les langages
// compilés (C, C++, Rust, Go, Java, COBOL : des secondes de compilation) ne se relancent pas d'eux-mêmes, sauf
// « #| réactif: oui ». Le mode : « réactif: oui » ou « non » dans l'en-tête ; sans rien, il est actif dès qu'un curseur existe.

const NO = /^\s*(?:#|\/\/|--|%%|;|\*>)\|\s*r[ée]acti(?:f|ve)\s*:\s*(non|no|false|faux|0)\b/im;
const YES = /^\s*(?:#|\/\/|--|%%|;|\*>)\|\s*r[ée]acti(?:f|ve)\s*:\s*(oui|yes|true|vrai|1)\b/im;
// les langages compilés : une compilation dans la machine émulée prend des secondes (Rust : une minute) — ils ne se
// recalculent d'eux-mêmes que si le bloc le demande (« #| réactif: oui ») ; sinon, marqués « à relancer »
const COMPILED = new Set(["c", "cpp", "rust", "go", "java", "cobol"]);
const word = (n) => new RegExp(`(?<![\\p{L}\\p{N}_$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u");

/**
 * app : { depEntries(), symbols(lang, code), DEP_LANGS, kernel, isGui(code), isPage(lang),
 *         run(entry) → Promise<boolean> (le bloc exécuté, sans ses dépendances), stale(entry, why),
 *         status(text | null), enabled() → boolean, diag }
 */
export function createReactive(app) {
    const R = { pending: new Set(), after: -1, timer: 0, gen: 0, running: null };

    /** Ce que lit un bloc, ce qu'il définit (deps.js pour Python, JavaScript, SQL ; un nom cité, pour les autres). */
    function io(e, names) {
        if (app.DEP_LANGS.has(e.lang)) {
            const s = app.symbols(e.lang, e.code);
            return { reads: [...names].filter((n) => s.uses.has(n) || s.uses.has(`table:${n}`)), defs: [...s.defs].map((n) => n.replace(/^table:/, "")) };
        }
        return { reads: [...names].filter((n) => word(n).test(e.code)), defs: [] };
    }

    /** Les blocs à recalculer, dans l'ordre : ceux qui lisent un nom changé, puis par contagion. */
    function plan(entries, names, after) {
        const changed = new Set(names), out = [], skipped = [];
        entries.forEach((e, i) => {
            if (i <= after || app.isPage(e.lang)) return;
            const { reads, defs } = io(e, changed);
            if (!reads.length) return;
            if (NO.test(e.code) || app.isGui(e.code) || (COMPILED.has(e.lang) && !YES.test(e.code))) { skipped.push({ e, why: reads }); return; }
            out.push({ e, i, why: reads });
            defs.forEach((d) => changed.add(d));
        });
        return { out, skipped };
    }

    async function flush() {
        R.timer = 0;
        if (!app.enabled() || !R.pending.size) { R.pending.clear(); return; }
        const names = [...R.pending], after = R.after;
        R.pending.clear(); R.after = -1;
        const gen = ++R.gen;
        // le recalcul précédent, interrompu, finit de s'arrêter (son bloc serait encore « en cours »)
        while (R.running) await new Promise((r) => setTimeout(r, 100));
        if (gen !== R.gen) return;
        const entries = app.depEntries();
        const { out, skipped } = plan(entries, names, after);
        for (const s of skipped) app.stale(s.e, `${s.why.join(", ")} a changé`);
        if (!out.length) return;
        app.diag?.log("réactif", { names, blocks: out.length });
        for (const [k, { e, why }] of out.entries()) {
            if (gen !== R.gen) return;                        // une nouvelle valeur est arrivée : ce calcul est caduc
            app.status(`réactif : ${why.join(", ")} → ${k + 1}/${out.length}`);
            R.running = e;
            let ok = false;
            try { ok = await app.run(e); } catch { ok = false; }
            R.running = null;
            if (gen !== R.gen) return;
            if (!ok) { app.status(null); return; }            // une erreur arrête la cascade (elle est sous le bloc)
        }
        app.status(null);
    }

    return {
        /** Des noms ont changé ; after : l'indice (depEntries) du bloc qui les a définis (on recalcule ce qui le suit). */
        changed(names, { after = -1 } = {}) {
            if (!app.enabled()) return;
            names = [...names].filter(Boolean);
            if (!names.length) return;
            names.forEach((n) => R.pending.add(n));
            R.after = R.after < 0 ? after : Math.min(R.after, after);
            // un recalcul en cours devient caduc : interrompu (s'il exécute un de nos blocs), on repartira
            if (R.running) { R.gen++; if (app.kernel.running && !app.kernel.running.background) app.kernel.interrupt().catch(() => {}); }
            clearTimeout(R.timer);
            R.timer = setTimeout(flush, 450);
        },
        get busy() { return !!R.running || !!R.timer; },
        plan: (names, after = -1) => plan(app.depEntries(), names, after),
    };
}

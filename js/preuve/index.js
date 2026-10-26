// preuve/ — les mathématiques vérifiées du document : un énoncé en français est démontré, réfuté (contre-exemple),
// ou laissé « à démontrer » ; une preuve écrite en français est vérifiée pas à pas. Sans serveur, sans LLM : de la
// logique et du calcul exact, dans la page.
//
// Dans le document, ce sont les encadrés du mode scientifique (science.js) :
//
//   > [!THÉORÈME] Somme des entiers
//   > Pour tout entier naturel n, la somme des entiers de 1 à n vaut n × (n + 1) / 2.
//
//   > [!PREUVE]
//   > Par récurrence sur n.
//   > Pour n = 0, la somme est vide : elle vaut 0.
//   > Supposons la propriété vraie au rang n.
//   > Alors la somme jusqu'à n + 1 vaut n × (n + 1) / 2 + (n + 1), donc elle vaut (n + 1) × (n + 2) / 2.
//
// Théorème, proposition, lemme, corollaire, propriété : un énoncé ; preuve, démonstration : la preuve de l'énoncé
// d'au-dessus. Les lettres libres d'un énoncé (« Si n est impair, alors n² est impair. ») sont des entiers naturels.
//
//   lecture.js    le français mathématique → formules (une seule lecture, ou refusé)
//   nombres.js    rationnels exacts, polynômes, sommes (Faulhaber)
//   decision.js   démontrer un énoncé seul, trouver un contre-exemple, vérifier qu'un pas découle des faits
//   preuve.js     les mots d'une preuve (soit, supposons, par récurrence, cas, absurde…) et leurs obligations

import { Parser, Unclear, fold, ftext } from "./lecture.js";
import { decide, setActions } from "./decision.js";
import { checkProof } from "./preuve.js";

const STATEMENTS = new Set(["theoreme", "proposition", "lemme", "corollaire", "propriete"]);
const PROOFS = new Set(["preuve", "demonstration"]);
const HEAD = /^\s*>\s*\[!([\p{L}]+)\]\s*(.*?)\s*(?:\{#[\w:.-]+\})?\s*$/u;
const cache = new Map();
const NAMES = { theoreme: "Théorème", proposition: "Proposition", lemme: "Lemme", corollaire: "Corollaire", propriete: "Propriété", preuve: "Preuve", demonstration: "Démonstration" };

/** Les encadrés du document : [{ kind, head, title, lines: [{ n, col }], text, map(pos) → { line, ch } }]. */
function callouts(lines, skip) {
    const out = [];
    for (let n = 0; n < lines.length; n++) {
        if (skip?.has(n)) continue;
        const m = HEAD.exec(lines[n]);
        if (!m) continue;
        const kind = fold(m[1]);
        if (!STATEMENTS.has(kind) && !PROOFS.has(kind)) continue;
        const parts = [];
        let k = n + 1;
        while (k < lines.length && /^\s*>/.test(lines[k]) && !HEAD.test(lines[k])) {
            const col = /^\s*>\s?/.exec(lines[k])[0].length;
            parts.push({ n: k, col, text: lines[k].slice(col) });
            k++;
        }
        let text = "";
        const starts = [];
        for (const p of parts) { if (text) text += " "; starts.push(text.length); text += p.text; }
        const map = (pos) => {
            let i = starts.length - 1;
            while (i > 0 && starts[i] > pos) i--;
            const p = parts[i];
            if (!p) return { line: n, ch: lines[n].length };
            return { line: p.n, ch: p.col + Math.min(Math.max(0, pos - starts[i]), p.text.length) };
        };
        out.push({ kind, proof: PROOFS.has(kind), head: n, end: k - 1, title: m[2], text, map, parts });
        n = k - 1;
    }
    return out;
}

/** L'énoncé : sa formule fermée (les lettres libres : « pour tout entier naturel »), ou l'erreur de lecture. */
function statement(text) {
    const body = text.replace(/\$/g, " ").replace(/\s*[.!]\s*$/, "");
    const p = new Parser(body, new Map(), { auto: true });
    let f = p.formula();
    if (!p.done) p.fail(`je ne comprends pas la suite : « ${body.slice(p.pos()).trim()} »`, p.pos(), body.length);
    const free = [...p.auto.keys()];
    if (free.length) f = { t: "all", vars: free.map((name) => ({ name, dom: "N" })), cond: null, body: f, implicit: true };
    return f;
}

/**
 * Vérifier les mathématiques du document.
 * lines : les lignes du texte ; skip : les lignes des blocs de code
 * → [{ head, end, kind, title, status: "proved" | "false" | "unknown" | "incomplete" | "error", badge, detail,
 *      marks: [{ from: { line, ch }, to: { line, ch }, status, msg }], proof: { head, end, status, msg } | null }]
 */
export function checkMath(lines, skip, opts = {}) {
    const boxes = callouts(lines, skip);
    const out = [];
    const known = [];
    // les actions du document (opts.actions : nom → { arity, call, min, max, why, key }) : un énoncé peut les nommer
    const acts = opts.actions || new Map();
    setActions(acts);
    Parser.actions = new Map([...acts].map(([n, a]) => [fold(n), a.arity]));
    const actKey = [...acts].map(([n, a]) => `${n}:${a.key ?? ""}`).join(";");
    for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.proof) continue;
        const pr = boxes[i + 1]?.proof && boxes[i + 1].head <= b.end + 3 ? boxes[i + 1] : null;
        const key = `${b.text}\u0001${pr?.text ?? ""}\u0001${known.map(ftext).join("\u0002")}\u0001${actKey}`;
        let r = cache.get(key);
        if (!r) {
            r = verify(b, pr, known);
            cache.set(key, r);
            if (cache.size > 300) cache.delete(cache.keys().next().value);
        }
        // les positions changent avec le texte autour : recalculées à chaque fois
        const marks = [];
        const place = (box, s) => marks.push({ from: box.map(s.at), to: box.map(s.end), status: s.status, msg: s.msg });
        r.marksOn.forEach((s) => place(s.proof ? pr : b, s));
        out.push({ head: b.head, end: b.end, kind: b.kind, name: NAMES[b.kind], title: b.title, status: r.status, badge: r.badge, detail: r.detail, marks,
            proof: pr ? { head: pr.head, end: pr.end, name: NAMES[pr.kind], status: r.proofStatus, msg: r.proofMsg } : null, formula: r.formula });
        if (r.formula && (r.status === "proved")) known.push(r.formula);
    }
    return out;
}

function verify(b, pr, known) {
    const res = { marksOn: [], status: "error", badge: "", detail: "", formula: null, proofStatus: null, proofMsg: "" };
    if (!b.text.trim()) { res.badge = "énoncé vide"; res.detail = "écrire l'énoncé sous le titre, dans l'encadré (« > Pour tout entier n, … »)"; return res; }
    let f;
    try { f = statement(b.text); }
    catch (e) {
        if (!(e instanceof Unclear)) throw e;
        // des mathématiques écrites librement (LaTeX, ε…) : rien n'est faux, la machine ne vérifie simplement pas
        res.status = "skip";
        res.badge = "non vérifié par la machine";
        res.detail = `L'énoncé sort du français mathématique qu'elle lit (${e.message}).`;
        return res;
    }
    res.formula = f;
    const auto = decide(f);
    const implicit = f.implicit ? ` (pour tout entier naturel ${f.vars.map((v) => v.name).join(", ")})` : "";
    if (pr) {
        const p = checkProof({ formula: f, text: b.text }, pr.text.replace(/\$/g, " "), known);
        for (const s of p.steps) res.marksOn.push({ ...s, proof: true });
        res.proofStatus = p.status;
        res.proofMsg = p.msg;
        if (auto.status === "false") {
            res.status = "false"; res.badge = auto.counter ? "faux — contre-exemple" : "faux";
            res.detail = `L'énoncé est faux${implicit} — contre-exemple : ${auto.counter?.text || auto.how}. La preuve ne peut donc pas être juste.`;
        } else if (p.status === "proved") {
            res.status = "proved"; res.badge = `démontré — ${p.msg}`;
            res.detail = p.steps.some((s) => s.status === "unread")
                ? `Le but est atteint${implicit} par les pas lus, chacun justifié ; les phrases soulignées en pointillé n'ont pas été lues et n'y ont pas servi.`
                : `Chaque pas de la preuve découle des précédents, et le but est atteint${implicit}.`;
        } else {
            res.status = p.status === "false" ? "false" : "incomplete";
            res.badge = p.status === "false" ? `preuve fausse — ${p.msg}` : p.msg;
            res.detail = auto.status === "proved" ? `L'énoncé, lui, est vrai (la machine le démontre seule : ${auto.how}).` : "";
        }
        return res;
    }
    res.status = auto.status;
    res.badge = auto.status === "proved" ? "vrai — démontré par la machine" : auto.status === "false" ? (auto.counter ? "faux — contre-exemple" : "faux") : "à démontrer";
    res.detail = `${auto.status === "proved" ? "Démonstration : " : auto.status === "false" && auto.counter ? "Contre-exemple : " : ""}${auto.status === "false" ? (auto.counter?.text || auto.how) : auto.how}${implicit}.`;
    return res;
}

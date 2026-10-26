// preuve.js — vérifier une preuve écrite en français, pas à pas.
//
// Chaque proposition de la preuve est un pas : la machine vérifie qu'il découle de ce qui précède (decision.js :
// entails) — elle calcule, développe, réduit, remplace ; elle ne connaît pas les formules qu'on démontre. Les mots
// de la preuve ont un sens logique précis :
//
//   Soit n un entier (naturel) [tel que …]   introduit la variable du « pour tout » (ou une nouvelle, si elle existe)
//   Supposons que P.                        l'hypothèse d'un « si … alors », celle de récurrence, ou de l'absurde
//   Par récurrence sur n.                   deux parties : le cas de base (« Pour n = 0, … »), puis l'hérédité
//                                           (« Supposons la propriété vraie au rang n » … jusqu'au rang n + 1)
//   Par l'absurde, supposons que P.         … jusqu'à « C'est absurde. » / « Contradiction. »
//   Il existe un entier k tel que n = 2k.   un témoin (justifié : n est pair) — k devient une variable
//   Cas 1 : n est pair. … Cas 2 : … Dans tous les cas, P.     une disjonction de cas, qui doit être complète
//   Alors / Donc / Ainsi / D'où / Or / On a … P.              un pas à vérifier ; « car Q » : Q d'abord
//   … = … = …                                chaque égalité de la chaîne ; « elle vaut », « cela fait » : le sujet d'avant
//   Montrons que P. / Il suffit de montrer que P.             le but, reformulé
//
// À la fin, le but (l'énoncé du théorème) doit avoir été atteint. Les théorèmes déjà démontrés plus haut servent :
// la machine essaie de les appliquer (à une somme, à une sous-expression) quand un pas en a besoin.

import { Parser, Unclear, fold, ftext, etext, num } from "./lecture.js";
import { entails, substF, substE, decide, toPoly } from "./decision.js";
import { pconstOf } from "./nombres.js";

const CMP = ["=", "!=", "<", "<=", ">", ">="];
const CONNECTORS = /^(?:(?:et\s+)?(?:alors|donc|ainsi|d'ou|or|on\s+a(?:\s+donc|\s+alors|\s+bien)?|on\s+obtient|il\s+vient|par\s+consequent|de\s+plus|de\s+meme|en\s+effet|en\s+particulier|finalement|enfin|mais|on\s+en\s+deduit\s+que|on\s+en\s+deduit|on\s+sait\s+que|on\s+remarque\s+que|remarquons\s+que|notons\s+que|c'est-a-dire\s+que|c'est\s+a\s+dire\s+que|c'est\s+a\s+dire|autrement\s+dit|soit\s+encore|en\s+developpant|en\s+factorisant|en\s+simplifiant|en\s+reduisant|d'apres\s+l'hypothese\s+de\s+recurrence|d'apres\s+l'hypothese|par\s+hypothese(?:\s+de\s+recurrence)?|d'apres\s+(?:le|la|l')\s*[\p{L}]+(?:\s+\d+)?|par\s+(?:le|la)\s+(?:theoreme|lemme|propriete|proposition|corollaire)(?:\s+\d+)?|grace\s+a\s+(?:l'hypothese(?:\s+de\s+recurrence)?|(?:le|la)\s+\p{L}+(?:\s+\d+)?)|par\s+recurrence|on\s+conclut\s+que|on\s+conclut|ce\s+qui\s+prouve\s+que|ce\s+qui\s+montre\s+que)\b\s*,?\s*)+/u;
const PRONOUN = /^(?:elle|il|cela|ceci|ca|ce\s+nombre|ce\s+dernier|cette\s+derniere|celle\s+ci|celui\s+ci|ce\s+qui|cette\s+somme|cette\s+expression|le\s+tout)\b\s*/u;
const TRAILING = /\s*,?\s*(?:d'apres|par\s+hypothese|par\s+definition|par\s+recurrence|grace\s+a|selon|en\s+utilisant)\b.*$/u;
const CONCLUDE = /^(?:ce\s+qui\s+conclut|ce\s+qui\s+acheve|ce\s+qu'il\s+fallait\s+demontrer|cqfd|c\.q\.f\.d|d'ou\s+le\s+resultat|le\s+resultat\s+est\s+demontre|la\s+propriete\s+est\s+donc\s+vraie|ce\s+qui\s+demontre|ce\s+qui\s+prouve\s+le|∎)/u;

/** La preuve en propositions : { text, at, sep } (sep : ce qui la termine : « . », « : », « , donc »…). */
export function clauses(text) {
    const out = [];
    let start = 0;
    const push = (end, sep) => {
        const raw = text.slice(start, end);
        const lead = raw.length - raw.trimStart().length;
        const t = raw.trim();
        if (t) out.push({ text: t, at: start + lead, sep });
        start = end + sep.length;
    };
    const re = /(\.(?=\s|$)(?<!\d\.)|\.(?=\s|$)|[;:](?!=)|!(?=\s|$)|∎)|(,\s*(?=(?:et\s+)?(?:donc|d['’]o[uù]|ainsi|c['’]est-à-dire|c['’]est à dire|ce qui|par conséquent)\b))|(\s+car\s+)/giu;
    let m;
    const cars = [];
    while ((m = re.exec(text))) {
        if (m[1]) {
            // un point dans « c.q.f.d », entre deux chiffres : pas une fin
            if (m[1] === "." && /\d$/.test(text.slice(0, m.index)) && /^\.\d/.test(text.slice(m.index))) continue;
            push(m.index, m[1]);
        } else if (m[2]) push(m.index, m[2]);
        else if (m[3]) { cars.push(out.length); push(m.index, m[3]); }
    }
    push(text.length, "");
    // « P car Q » : Q se vérifie d'abord
    for (const i of cars) if (out[i + 1]) { const q = out[i + 1]; out[i + 1] = out[i]; out[i] = { ...q, because: true }; }
    // « comme P, Q », « puisque P, Q » : P, puis Q
    for (let i = 0; i < out.length; i++) {
        const m2 = /^(comme|puisque|puisqu['’])\s*/iu.exec(out[i].text);
        if (!m2) continue;
        const rest = out[i].text.slice(m2[0].length), cut = rest.indexOf(",");
        if (cut < 0) continue;
        const a = { text: rest.slice(0, cut).trim(), at: out[i].at + m2[0].length, sep: ",", because: true };
        const btext = rest.slice(cut + 1), lead = btext.length - btext.trimStart().length;
        out.splice(i, 1, a, { text: btext.trim(), at: out[i].at + m2[0].length + cut + 1 + lead, sep: out[i].sep });
    }
    return out;
}

/**
 * Vérifier une preuve.
 * theorem : { formula (fermée, après les « pour tout » implicites), text }
 * proof : le texte de la preuve ; known : les théorèmes déjà démontrés (leurs formules)
 * → { status: "proved" | "false" | "incomplete", steps: [{ at, end, status: "ok" | "false" | "unknown" | "note", msg }], msg }
 */
export function checkProof(theorem, proof, known = []) {
    const steps = [];
    const S = {
        vars: new Map(), facts: [], goal: theorem.formula, subject: null, lastSum: null,
        ind: null,            // la récurrence : { v, n0, P, phase: "base" | "step", baseAt, any }
        cases: null,          // les cas : { saved, hyps: [], ends: [], current }
        absurd: false, pendingCase: false, reached: false,
    };
    const mark = (c, status, msg, at = 0, end = c.text.length) => steps.push({ at: c.at + at, end: c.at + end, status, msg });
    const ctx = (extra = []) => ({ vars: S.vars, facts: [...S.facts, ...extra] });
    const check = (claim, extra = []) => {
        let r = entails(ctx(extra), claim);
        if (r.ok !== true && known.length) {
            const inst = instances(known, claim, S);
            if (inst.length) { const r2 = entails(ctx([...extra, ...inst]), claim); if (r2.ok === true) r = { ...r2, how: `${r2.how}, d'après un théorème démontré plus haut` }; else if (r.ok == null) r = r2; }
        }
        return r;
    };
    const verdict = (c, r, what, at, end) => {
        if (r.ok === true) mark(c, "ok", `✓ ${r.how}`, at, end);
        else if (r.ok === false) mark(c, "false", `✗ faux${r.counter ? ` : ${r.counter.text}` : r.why ? ` : ${r.why}` : ""}`, at, end);
        else if (steps.some((x) => x.status === "false")) mark(c, "unknown", "? à revoir : le pas faux d'avant le fausse aussi", at, end);
        else mark(c, "unknown", `? non justifié : la machine ne voit pas pourquoi ${what}`, at, end);
    };
    const parse = (c, text, offset, auto = false) => {
        const p = new Parser(text, new Map(S.vars), { lastSum: S.lastSum, auto });
        p.subject = S.subject;
        return p;
    };
    // le but, une fois les « pour tout » en tête ouverts par « Soit » (ou par la récurrence)
    const openGoal = () => S.goal;

    // « la somme » seule, « elle » sans sujet : la somme de l'énoncé
    S.lastSum = firstBig(theorem.formula);
    S.subject = S.lastSum;
    const list = clauses(proof);
    for (let ci = 0; ci < list.length; ci++) {
        const c = list[ci];
        let text = c.text, off = 0;
        const strip = (re) => { const m = re.exec(fold(text)); if (m && m[0]) { off += m[0].length; text = text.slice(m[0].length); return m; } return null; };
        // les étiquettes : « Initialisation : », « Hérédité : », « Conclusion : »
        const label = /^(initialisation|cas\s+de\s+base|heredite|conclusion|etape\s+\d+|preuve|demonstration)$/u.exec(fold(text));
        if (label) {
            if (/heredite/.test(label[1]) && S.ind?.phase === "base") endBase(c);
            if (/conclusion/.test(label[1]) && S.ind?.phase === "step") endStep(c);
            continue;
        }
        if (CONCLUDE.test(fold(text))) { finish(c); continue; }
        try {
            // ---- les cas
            const caseOpen = /^(?:(?:\d+(?:er|e|eme)?|premier|deuxieme|second|troisieme|dernier)\s+cas|cas\s+\d+|cas\s+n°\s*\d+)$/u.exec(fold(text));
            if (caseOpen) { S.pendingCase = true; continue; }
            if (S.pendingCase || (/^si\b/u.test(fold(text)) && c.sep === ":")) {
                if (!S.pendingCase) strip(/^si\s*/u);
                S.pendingCase = false;
                const p = parse(c, text);
                const h = p.formula();
                openCase(c, h);
                mark(c, "note", `cas : ${ftext(h)}`, off);
                continue;
            }
            const all = /^dans\s+(?:tous\s+les|les\s+deux|chaque)\s+cas\s*,?\s*/u.exec(fold(text));
            if (all) {
                off += all[0].length; text = text.slice(all[0].length);
                closeCases(c, text.trim() ? parse(c, text).formula() : null, off);
                continue;
            }
            // ---- la récurrence
            const rec = /^(?:montrons\s+(?:le\s+|la\s+propriete\s+|cela\s+)?|procedons\s+|raisonnons\s+)?par\s+recurrence(?:\s+sur\s+([\p{L}]))?/u.exec(fold(text));
            if (rec && !/,\s*\S/.test(text.slice(rec[0].length))) { startInduction(c, rec[1] ? text.slice(rec[0].length - 1, rec[0].length) : null); continue; }
            // « Par récurrence, P » : la conclusion
            if (/^par\s+recurrence\s*,/u.test(fold(text)) && S.ind) { if (S.ind.phase === "step") endStep(c); continue; }
            // « Pour n = 0, … » : le cas de base
            const base = /^(?:pour|au\s+rang|si)\s+([\p{L}])\s*=\s*(-?\d+)\s*,?\s*/u.exec(fold(text));
            if (base && S.ind) {
                if (S.ind.phase !== "base") { mark(c, "false", "✗ le cas de base vient avant l'hérédité"); continue; }
                if (base[1] !== fold(S.ind.v) || BigInt(base[2]) !== S.ind.n0) mark(c, "false", `✗ le cas de base est ${S.ind.v} = ${S.ind.n0}`, 0, base[0].length);
                off += base[0].length; text = text.slice(base[0].length);
                if (!text.trim()) continue;
            }
            // ---- l'absurde
            const abs = /^par\s+l'absurde\s*,?\s*/u.exec(fold(text));
            if (abs) { off += abs[0].length; text = text.slice(abs[0].length); S.absurd = true; if (!text.trim()) continue; }
            // ---- Supposons
            const sup = /^(?:supposons|on\s+suppose|supposons\s+donc)\s+(?:que\s+|qu'|d'abord\s+que\s+)?/u.exec(fold(text));
            if (sup) { off += sup[0].length; text = text.slice(sup[0].length); suppose(c, text, off); continue; }
            // ---- Soit / Soient
            const soit = /^(?:soit|soient|prenons|fixons)\s+/u.exec(fold(text));
            if (soit) { off += soit[0].length; text = text.slice(soit[0].length); introduce(c, text, off); continue; }
            // ---- Il existe … tel que (un témoin)
            if (/^il\s+existe\s+/u.test(fold(text))) { obtain(c, text, off); continue; }
            // ---- Montrons que / Il suffit de montrer que
            const goal = /^(?:montrons|demontrons|prouvons|il\s+reste\s+a\s+montrer|il\s+suffit\s+de\s+montrer|il\s+faut\s+montrer|on\s+veut\s+montrer)\s+(?:que\s+|qu')?/u.exec(fold(text));
            if (goal) {
                off += goal[0].length; text = text.slice(goal[0].length);
                if (/^(?:la\s+propriete|elle|qu'elle|le\s+resultat|l'heredite|cela)/u.test(fold(text))) continue;   // « montrons qu'elle est vraie au rang n + 1 »
                const p = parse(c, text);
                const f = p.formula();
                const g = openGoal();
                if (g && g.t !== "bool") {
                    const r = entails(ctx([f]), g);
                    if (r.ok === true) { mark(c, "note", `but : ${ftext(f)}`, off); S.goal = f; }
                    else mark(c, "unknown", `? ce n'est pas ce qu'il faut montrer : le but est ${ftext(g)}`, off);
                }
                continue;
            }
            // ---- un pas
            claim(c, text, off);
        } catch (e) {
            if (!(e instanceof Unclear)) throw e;
            // un pas que la machine ne lit pas n'est pas faux : il n'ajoute rien à ce qu'elle sait (« non lu »)
            mark(c, "unread", `· non lu : ${e.message}`, off + e.at, off + Math.max(e.end, e.at + 1));
        }
    }
    finish(list.at(-1) || { text: "", at: proof.length }, true);

    // ---------------------------------------------------------------- les pas
    function claim(c, text, off) {
        text = text.slice(0, text.length - (TRAILING.exec(fold(text))?.[0].length || 0));
        const m = CONNECTORS.exec(fold(text));
        if (m) { off += m[0].length; text = text.slice(m[0].length); }
        if (!text.trim()) return;
        // « la propriété est vraie au rang n + 1 » : P(n + 1) ; « le résultat est démontré » : le but
        const rank = /^(?:la\s+propriete|elle|la\s+formule|l'egalite)\s+est\s+(?:donc\s+|bien\s+|aussi\s+)?vraie\s+(?:au\s+rang|pour)\s+/u.exec(fold(text));
        if (rank && S.ind) {
            const at = rank[0].length;
            const p = parse(c, text.slice(at).replace(/^\s*([\p{L}])\s*=\s*/u, ""));
            const x = p.expr();
            const g = substF(S.ind.P, S.ind.v, x);
            const r = check(g);
            verdict(c, r, ftext(g), off, off + text.length);
            S.facts.push(g);
            if (r.ok === true) S.ind.user = true;
            return;
        }
        const p = parse(c, text);
        // « elle vaut … », « = … » : le sujet de la proposition d'avant
        const pr = PRONOUN.exec(fold(text));
        if (pr && S.subject) { p.i = p.t.findIndex((t) => t.at >= pr[0].length); if (p.i < 0) p.i = p.t.length; p.subject = S.subject; }
        else if (p.is(CMP) && S.subject) p.subject = S.subject;
        let f;
        if (p.subject && (pr || p.is(CMP))) f = p.predicate(p.subject, 0);
        else f = p.formula();
        // une chaîne : a = b = c, a ≤ b < c
        const links = [f];
        while (p.is(CMP) && f.t === "cmp") {
            const op = p.t[p.i++].v, prev = links.at(-1);
            links.push({ t: "cmp", op, a: prev.b, b: p.expr(), at: p.t[p.i - 1].at, end: p.t[p.i - 1].end });
        }
        if (!p.done) p.fail(`je ne comprends pas la suite : « ${text.slice(p.pos()).trim()} »`, p.pos(), text.length);
        S.lastSum = p.lastSum;
        // le sujet : le côté gauche (« elle » dans la proposition suivante)
        if (f.t === "cmp") S.subject = f.a;
        else if (f.t === "dvd" || f.t === "prime") S.subject = f.a;
        if (f.t === "bool" && !f.v) {
            const r = check(f);
            if (r.ok === true) { mark(c, "ok", `✓ contradiction : ${r.how}`, off); S.facts.push(f); if (S.absurd) S.reached = true; }
            else verdict(c, r, "c'est contradictoire", off);
            return;
        }
        let bad = false;
        links.forEach((l, i) => {
            // un maillon : de ce qui précède (et des maillons d'avant)
            const r = check(l);
            if (r.ok !== true) bad = true;
            if (links.length === 1) verdict(c, r, "c'est vrai", off, off + text.length);
            else if (r.ok !== true) verdict(c, r, `${ftext(l)}`, off, off + text.length);
            void i;
            S.facts.push(l);
        });
        if (links.length > 1) {
            const ops = links.map((l) => l.op);
            const total = chainTotal(links[0].a, links.at(-1).b, ops);
            if (total) S.facts.push(total);
            if (!bad) mark(c, "ok", `✓ ${links.length} égalités${ops.some((o) => o !== "=") ? " et inégalités" : ""}, chacune vérifiée`, off, off + text.length);
        }
    }
    function chainTotal(a, b, ops) {
        if (ops.every((o) => o === "=")) return { t: "cmp", op: "=", a, b };
        const up = ops.every((o) => ["=", "<", "<="].includes(o)), down = ops.every((o) => ["=", ">", ">="].includes(o));
        if (!up && !down) return null;
        const strict = ops.some((o) => o === "<" || o === ">");
        return { t: "cmp", op: up ? (strict ? "<" : "<=") : strict ? ">" : ">=", a, b };
    }

    function suppose(c, text, off) {
        // l'hérédité : « Supposons la propriété vraie au rang n » / « Supposons que P(n) »
        if (S.ind) {
            if (S.ind.phase === "base") endBase(c);
            if (S.ind.phase !== "step") return;
            const t = fold(text).replace(/^(?:que\s+)?(?:pour\s+un\s+(?:certain\s+)?entier\s+(?:naturel\s+)?[\p{L}]\s*(?:(?:>=|≥|au moins)\s*-?\d+)?\s*(?:fixe)?\s*,\s*)/u, (m) => { off += m.length; return ""; });
            text = text.slice(fold(text).length - t.length);
            if (/^(?:la\s+propriete|qu'elle|elle|la\s+formule|l'egalite|le\s+resultat|p\s*\()/u.test(t) || /vraie\s+(?:au\s+rang|pour)/u.test(t)) {
                mark(c, "note", `hypothèse de récurrence : ${ftext(S.ind.P)}`, off);
                S.facts.push(S.ind.P);
                return;
            }
            const f = parse(c, text).formula();
            const r = entails({ vars: S.vars, facts: [...S.facts, S.ind.P] }, f);
            if (r.ok !== true) { mark(c, "false", `✗ on ne peut supposer que la propriété au rang ${S.ind.v} : ${ftext(S.ind.P)}`, off); return; }
            mark(c, "note", `hypothèse de récurrence : ${ftext(f)}`, off);
            S.facts.push(S.ind.P, f);
            return;
        }
        const p = parse(c, text);
        const h = p.formula();
        if (!p.done) p.fail(`je ne comprends pas la suite : « ${text.slice(p.pos()).trim()} »`, p.pos(), text.length);
        S.lastSum = p.lastSum;
        // par l'absurde : supposer le contraire du but
        if (S.absurd) {
            const g = openGoal();
            const r = entails(ctx([{ t: "not", p: h }]), g);
            if (r.ok !== true) { mark(c, "false", `✗ par l'absurde, on suppose le contraire du but (${ftext(g)})`, off); return; }
            S.facts.push(h);
            S.goal = { t: "bool", v: false };
            mark(c, "note", `hypothèse (à contredire) : ${ftext(h)}`, off);
            return;
        }
        // le « si » du but
        let g = openGoal();
        if (g?.t === "all") g = autoIntro(g);
        if (g?.t === "imp") {
            const r = entails(ctx([g.p]), h);
            if (r.ok !== true) { mark(c, "false", `✗ on ne peut supposer que ${ftext(g.p)}`, off); return; }
            S.facts.push(g.p, h);
            S.goal = g.q;
            mark(c, "note", `hypothèse : ${ftext(h)}`, off);
            return;
        }
        mark(c, "false", `✗ rien à supposer ici : le but est ${g ? ftext(g) : "atteint"} (« Par l'absurde, supposons… » pour raisonner par l'absurde)`, off);
    }
    /** Le « pour tout » du but, ouvert avec ses propres lettres (quand la preuve commence par « Supposons »). */
    function autoIntro(g) {
        for (const v of g.vars) if (!S.vars.has(v.name)) S.vars.set(v.name, v.dom);
        let body = g.body;
        if (g.cond) body = { t: "imp", p: g.cond, q: body };
        S.goal = body;
        return body;
    }

    function introduce(c, text, off) {
        // « n un entier (naturel) [impair] [tel que P] », « a et b deux entiers », « n ∈ ℕ »
        const m = /^(\p{L}[\p{L}\p{Nd}]*(?:\s*(?:,|et)\s*\p{L}[\p{L}\p{Nd}]*)*)\s*(?:un|une|deux|trois|des)?\s*(.*)$/su.exec(text);
        if (!m) throw new Unclear("« Soit n un entier. »", off);
        const names = m[1].split(/\s*(?:,|et)\s*/u);
        let rest = m[2];
        const restAt = off + text.indexOf(rest, m[1].length);
        // le domaine
        const fr = fold(rest);
        let dom = null, domLen = 0;
        const d = /^(?:entiers?\s+naturels?(?:\s+non\s+nuls?)?|entiers?(?:\s+relatifs?)?|reels?|nombres?\s+entiers?|(?:∈|dans)\s*(?:ℕ\*?|ℤ|ℝ|n\*?|z|r)\b\*?)/u.exec(fr);
        if (d) { domLen = d[0].length; dom = /naturel|ℕ|\bn\b/.test(d[0]) ? "N" : /reel|ℝ|\br\b/.test(d[0]) ? "R" : "Z"; }
        rest = rest.slice(domLen);
        // la condition (« impair », « ≥ 1 », « tel que … ») : lue comme dans un « pour tout »
        let cond = null;
        const vs = names.map((n) => ({ name: n, dom: dom || "Z" }));
        const scope = new Map(S.vars);
        for (const v of vs) scope.set(v.name, v.dom);
        if (/non\s+nuls?/.test(d?.[0] || "")) cond = { t: "cmp", op: ">=", a: { t: "var", name: names[0] }, b: num(1) };
        if (rest.trim()) {
            const q = new Parser(`${names[0]} ${rest.replace(/^\s*(?:tel|telle|tels|telles)\s+(?:que|qu')\s*/iu, "est tel que ")}`, scope, { lastSum: S.lastSum });
            cond = and(cond, condAfter(q, names[0], restAt - names[0].length - 1));
        }
        const g = openGoal();
        // l'introduction du « pour tout » du but
        if (g?.t === "all" && !names.some((n) => S.vars.has(n))) {
            if (g.vars.length < names.length) throw new Unclear(`le but n'a que ${g.vars.length} variable${g.vars.length > 1 ? "s" : ""}`, off);
            let body = g.body, gcond = g.cond;
            names.forEach((n, i) => {
                body = substF(body, g.vars[i].name, { t: "var", name: n });
                if (gcond) gcond = substF(gcond, g.vars[i].name, { t: "var", name: n });
            });
            const gdom = g.vars[0].dom;
            if (dom === "N" && gdom === "Z") { mark(c, "false", `✗ le but porte sur tous les entiers (relatifs), pas seulement les naturels`, off); }
            for (let i = 0; i < names.length; i++) S.vars.set(names[i], g.vars[i].dom);
            const leftover = g.vars.slice(names.length);
            if (leftover.length) body = { t: "all", vars: leftover, cond: null, body };
            // « Soit n un entier impair » pour « si n est impair, alors … » : la condition est l'hypothèse du « si »
            if (cond && !gcond && body.t === "imp") {
                const r = entails(ctx([body.p]), cond);
                if (r.ok === true) { gcond = body.p; body = body.q; }
            }
            // la condition dite ici doit découler de celle du but
            if (cond) {
                const r = entails(ctx(gcond ? [gcond] : []), cond);
                if (r.ok !== true) { mark(c, "false", `✗ le but ne dit pas que ${ftext(cond)}${gcond ? ` (seulement : ${ftext(gcond)})` : ""}`, off); return; }
                S.facts.push(cond);
            }
            if (gcond) S.facts.push(gcond);
            S.goal = body;
            mark(c, "note", `${names.join(", ")} : ${dom === "N" || gdom === "N" ? "entier naturel" : gdom === "R" ? "réel" : "entier"}${cond ? `, ${ftext(cond)}` : ""}`, off);
            return;
        }
        // sinon : un nouvel objet, qui doit exister (« Soit k un entier tel que n = 2k »)
        for (const v of vs) S.vars.set(v.name, v.dom);
        if (!cond) { mark(c, "note", `${names.join(", ")} : ${dom === "N" ? "entier naturel" : "entier"}`, off); return; }
        witness(c, vs, cond, off);
    }
    function condAfter(q, name, at) {
        q.eat(q.peek()?.v);   // le nom
        if (q.eats("est", "tel", "que") || q.eats("est", "tel", "qu'")) return q.formula();
        // « n impair », « n ≥ 1 », « n pair et positif »
        const subject = { t: "var", name };
        q.subject = subject;
        if (q.is(["pair", "impair", "premier", "divisible"])) return q.predicate(subject, 0);
        if (q.is([">=", "<=", ">", "<", "!="])) return q.predicate(subject, 0);
        if (q.eats("non", "nul")) return { t: "cmp", op: "!=", a: subject, b: num(0) };
        if (q.eats("strictement", "positif")) return { t: "cmp", op: ">", a: subject, b: num(0) };
        if (q.eat("positif")) return { t: "cmp", op: ">=", a: subject, b: num(0) };
        throw new Unclear("« Soit n un entier tel que … »", at);
    }
    function and(a, b) { return a && b ? { t: "and", ps: [a, b] } : a || b; }

    /** « Il existe un entier k tel que n = 2k + 1 » : k existe-t-il ? Puis k est une variable, et le fait est acquis. */
    function obtain(c, text, off) {
        const p = parse(c, text);
        const f = p.formula();
        if (f.t !== "ex") { claim(c, text, off); return; }
        for (const v of f.vars) S.vars.set(v.name, v.dom);
        const cond = f.cond ? { t: "and", ps: [f.cond, f.body] } : f.body;
        witness(c, f.vars, cond, off);
    }
    function witness(c, vs, cond, off) {
        const k = vs[0].name;
        // n = c·k + d : k existe si c divise n − d ; k = … : toujours
        const eq = cond.t === "cmp" && cond.op === "=" ? cond : cond.t === "and" ? cond.ps.find((x) => x.t === "cmp" && x.op === "=") : null;
        let r = null;
        if (eq && vs.length === 1) {
            const side = mentions(eq.b, k) && !mentions(eq.a, k) ? [eq.a, eq.b] : mentions(eq.a, k) && !mentions(eq.b, k) ? [eq.b, eq.a] : null;
            if (side) {
                const [x, e] = side;
                const lin = linearIn(e, k);
                if (lin) {
                    const need = { t: "dvd", m: lin.c, a: { t: "sub", a: x, b: lin.d } };
                    r = check(need);
                    if (r.ok === true) r.how = `${etext(x)} − ${etext(lin.d)} est divisible par ${etext(lin.c)}`;
                }
            }
        }
        if (r?.ok === true) {
            S.facts.push(cond);
            mark(c, "ok", `✓ un tel ${k} existe : ${r.how}`, off);
            return;
        }
        S.facts.push(cond);
        mark(c, r?.ok === false ? "false" : "unknown", r?.ok === false ? `✗ un tel ${k} n'existe pas toujours${r.counter ? ` : ${r.counter.text}` : ""}` : `? la machine ne sait pas qu'un tel ${k} existe (écrire « n = 2k + 1 », k entier, quand n est impair)`, off);
    }
    function mentions(e, k) { if (!e) return false; if (e.t === "var") return e.name === k; return ["a", "b", "f"].some((x) => e[x] && mentions(e[x], k)); }
    /** e = c·k + d, c et d sans k (c une constante) ? */
    function linearIn(e, k) {
        const zero = substE(e, k, num(0)), one = substE(e, k, num(1));
        const c = { t: "sub", a: one, b: zero };
        // vérifier la linéarité : e(2) = d + 2c
        const two = substE(e, k, num(2));
        const r = entails({ vars: S.vars, facts: [] }, { t: "cmp", op: "=", a: two, b: { t: "add", a: zero, b: { t: "mul", a: num(2), b: c } } });
        const r3 = entails({ vars: S.vars, facts: [] }, { t: "cmp", op: "=", a: substE(e, k, num(3)), b: { t: "add", a: zero, b: { t: "mul", a: num(3), b: c } } });
        if (r.ok !== true || r3.ok !== true) return null;
        return { c: simplify(c), d: simplify(zero) };
    }
    function simplify(e) { try { const v = pconstOf(toPoly(e)); return v ? { t: "num", v } : e; } catch { return e; } }

    // ---------------------------------------------------------------- la récurrence
    function startInduction(c, name) {
        let g = openGoal();
        if (g?.t !== "all") { mark(c, "false", "✗ une récurrence démontre un « pour tout entier n, … »"); return; }
        const v = g.vars.find((x) => !name || x.name === name) || g.vars[0];
        if (v.dom === "R") { mark(c, "false", "✗ pas de récurrence sur un réel"); return; }
        // le premier rang : 0 (naturels), ou la condition « n ≥ c »
        let n0 = v.dom === "N" ? 0n : null, P = g.body;
        const conds = !g.cond ? [] : g.cond.t === "and" ? g.cond.ps : [g.cond];
        const rest = [];
        for (const k of conds) {
            const low = k.t === "cmp" && k.a.t === "var" && k.a.name === v.name && k.b.t === "num" && k.b.v.d === 1n && (k.op === ">=" || k.op === ">") ? k.b.v.n + (k.op === ">" ? 1n : 0n) : null;
            if (low != null && (n0 == null || low > n0)) n0 = low; else rest.push(k);
        }
        if (n0 == null) { mark(c, "false", `✗ une récurrence part d'un premier rang : « pour tout entier naturel ${v.name} » ou « pour tout entier ${v.name} ≥ 1 »`); return; }
        if (rest.length) P = { t: "imp", p: rest.length > 1 ? { t: "and", ps: rest } : rest[0], q: P };
        if (g.vars.length > 1) P = { t: "all", vars: g.vars.filter((x) => x !== v), cond: null, body: P };
        S.vars.set(v.name, "Z");
        S.ind = { v: v.name, n0, P, phase: "base", base: [], any: false, at: c };
        S.saved = [...S.facts];
        S.facts.push({ t: "cmp", op: "=", a: { t: "var", name: v.name }, b: num(n0) });
        S.goal = substF(P, v.name, num(n0));
        mark(c, "note", `récurrence sur ${v.name}, à partir de ${v.name} = ${n0} — la propriété : ${ftext(P)}`);
    }
    function endBase(c) {
        const I = S.ind;
        const r = entails({ vars: S.vars, facts: S.facts }, S.goal);
        if (r.ok === true) mark(c, "note", `cas de base (${I.v} = ${I.n0}) : ✓ ${r.how}`);
        else mark(c, r.ok === false ? "false" : "unknown", `${r.ok === false ? "✗" : "?"} le cas de base ${I.v} = ${I.n0} n'est pas établi : ${ftext(S.goal)}${r.counter ? ` (${r.counter.text})` : ""}`);
        if (r.ok !== true) I.failed = true;
        // l'hérédité : n ≥ n0 quelconque, P(n) à supposer, P(n + 1) à montrer
        I.phase = "step";
        I.stepAt = c.at;
        S.facts = [...S.saved, { t: "cmp", op: ">=", a: { t: "var", name: I.v }, b: num(I.n0) }];
        S.subject = S.lastSum = firstBig(theorem.formula);
        S.goal = substF(I.P, I.v, { t: "add", a: { t: "var", name: I.v }, b: num(1) });
    }
    function endStep(c) {
        const I = S.ind;
        const r = check(S.goal);
        const by = steps.some((x) => x.status === "ok" && x.at >= I.stepAt) ? "" : " (la machine a fait le calcul : défaire la somme, appliquer l'hypothèse, développer)";
        if (r.ok === true) { mark(c, "note", `hérédité : ✓ ${ftext(S.goal)}${by}`); if (!I.failed) S.reached = true; }
        else { mark(c, r.ok === false ? "false" : "unknown", `${r.ok === false ? "✗" : "?"} l'hérédité n'est pas établie : il reste à montrer ${ftext(S.goal)}`); }
        I.phase = "done";
        S.goal = null;
    }

    // ---------------------------------------------------------------- les cas
    function openCase(c, h) {
        if (!S.cases) S.cases = { saved: [...S.facts], vars: new Map(S.vars), hyps: [], ends: [] };
        else S.cases.ends.push(S.facts);
        S.cases.hyps.push(h);
        S.facts = [...S.cases.saved, h];
        S.subject = null;
    }
    function closeCases(c, conclusion, off) {
        const K = S.cases;
        if (!K) { mark(c, "false", "✗ quels cas ? (« Cas 1 : … », « Si n est pair : … »)", off); return; }
        K.ends.push(S.facts);
        const target = conclusion || S.goal;
        // complets : l'un des cas a toujours lieu
        const full = entails({ vars: S.vars, facts: K.saved }, K.hyps.length > 1 ? { t: "or", ps: K.hyps } : K.hyps[0]);
        S.facts = K.saved;
        S.cases = null;
        if (full.ok !== true) { mark(c, "false", `✗ les cas ne couvrent pas tout : ${K.hyps.map(ftext).join(" ou ")}${full.counter ? ` (${full.counter.text})` : ""}`, off); return; }
        const fails = K.ends.map((facts, i) => [i, entails({ vars: S.vars, facts }, target)]).filter(([, r]) => r.ok !== true);
        if (fails.length) { mark(c, "false", `✗ le cas ${fails[0][0] + 1} (${ftext(K.hyps[fails[0][0]])}) ne donne pas ${ftext(target)}`, off); return; }
        mark(c, "ok", `✓ ${K.hyps.length} cas, qui couvrent tout, donnent chacun ${ftext(target)}`, off);
        S.facts.push(target);
    }

    // ---------------------------------------------------------------- la fin
    function finish(c, last = false) {
        if (S.done) return;
        if (S.ind?.phase === "base") endBase(c);
        if (S.ind?.phase === "step") endStep(c);
        if (S.cases) closeCases(c, null, 0);
        if (!S.ind) {
            const g = openGoal();
            if (g && !(g.t === "bool" && !g.v && S.reached)) {
                const r = check(g);
                if (r.ok === true) S.reached = true;
                else if (!last || steps.every((s) => s.status !== "false")) mark(c, r.ok === false ? "false" : "unknown", g.t === "bool" ? "? il reste à trouver une contradiction" : `? il reste à montrer : ${ftext(g)}`);
            } else S.reached = true;
        }
        S.done = true;
    }

    // (un pas non lu ne compte ni pour ni contre : la conclusion, si elle est atteinte, l'est sans lui)
    const bad = steps.some((s) => s.status === "false"), unknown = steps.some((s) => s.status === "unknown");
    const unread = steps.filter((s) => s.status === "unread").length;
    const status = bad ? "false" : unknown || !S.reached ? "incomplete" : "proved";
    const nsteps = steps.filter((s) => s.status === "ok").length;
    return {
        status, steps,
        msg: status === "proved" ? `preuve vérifiée${nsteps ? ` (${nsteps} pas)` : ""}${S.ind ? ", par récurrence" : ""}${unread ? ` — ${unread} phrase${unread > 1 ? "s" : ""} non lue${unread > 1 ? "s" : ""}, sans effet sur la conclusion` : ""}`
            : status === "false" ? `${steps.filter((s) => s.status === "false").length} pas faux`
            : `preuve incomplète : ${steps.filter((s) => s.status === "unknown").length || 1} pas à justifier`,
    };
}

/** Des théorèmes démontrés, appliqués à ce qu'un pas mentionne (une somme jusqu'à b, une sous-expression). */
function instances(known, claim, S) {
    const subs = [];
    const seen = new Set();
    const walk = (e) => {
        if (!e || typeof e !== "object") return;
        if (e.t === "big") { const k = `b:${etext(e.b)}`; if (!seen.has(k)) { seen.add(k); subs.push(e.b); } }
        if (["var", "add", "sub", "mul", "pow", "neg"].includes(e.t)) { const k = etext(e); if (!seen.has(k) && size(e) <= 9) { seen.add(k); subs.push(e); } }
        for (const x of ["a", "b", "f", "p", "q", "m"]) if (e[x]) walk(e[x]);
        if (e.ps) e.ps.forEach(walk);
    };
    walk(claim);
    for (const f of S.facts.slice(-6)) walk(f);
    const out = [];
    for (const T of known) {
        let f = T;
        if (f.t !== "all" || f.vars.length !== 1) continue;
        const v = f.vars[0].name;
        for (const e of subs.slice(0, 20)) {
            const body = substF(f.body, v, e);
            const cond = f.cond ? substF(f.cond, v, e) : null;
            if (cond) {
                const r = entails({ vars: S.vars, facts: S.facts }, cond);
                if (r.ok !== true) continue;
            }
            if (f.vars[0].dom === "N") {
                const r = entails({ vars: S.vars, facts: S.facts }, { t: "cmp", op: ">=", a: e, b: num(0) });
                if (r.ok !== true) continue;
            }
            out.push(body);
        }
    }
    return out;
}
function firstBig(f) {
    if (!f || typeof f !== "object") return null;
    if (f.t === "big" && f.kind === "sum") return f;
    for (const k of ["a", "b", "f", "p", "q", "m", "body", "cond"]) { const r = firstBig(f[k]); if (r) return r; }
    for (const x of f.ps || []) { const r = firstBig(x); if (r) return r; }
    return null;
}
const size = (e) => (!e || typeof e !== "object" ? 0 : 1 + ["a", "b", "f"].reduce((s, k) => s + size(e[k]), 0));
export { decide };

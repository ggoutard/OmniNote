// modele.js — le modèle du document : ce qui existe, ce que c'est, d'où ça vient. Il ne relit rien lui-même : il
// réunit ce que les autres modules savent déjà (les sortes des phrases — gramalectica/sens.js —, les tableaux, les
// blocs de code — deps.js —, les valeurs de la jonction, les théorèmes — preuve/), en un seul graphe :
//
//   concept   un nom du document : une donnée, une classe (fiche ou tableau), un champ, une action, un théorème
//   sorte     ce qu'il est (sortes.js) : « notes » est une liste d'entiers ; ? tant qu'un bloc Python n'a pas tourné
//   relations a un (classe → champ), est une sorte de (classe → parente), définit / lit (phrase ou bloc → concept)
//   sources   d'où vient chaque fait : la phrase, le tableau, le bloc (et son langage), la valeur reçue
//
// Les sortes, les unités, les classes viennent du document ; il n'y a pas de connaissance du monde écrite à la main.

import * as S from "./sortes.js";

const label = (n) => String(n).replace(/_/g, " ");

/**
 * Construire le modèle.
 *   typing   : typeDocument (gramalectica/sens.js)
 *   phrases  : pour chaque phrase typée, où elle est : { line, page? } (pour dire « la phrase de la ligne 12 »)
 *   tables   : tablesIn (avec line)
 *   blocks   : [{ lang, where (« bloc 2 »), defs: Set, uses: Set }] (deps.symbols)
 *   theorems : checkMath (preuve/index.js)
 */
export function buildModel({ typing, phrases = [], tables = new Map(), blocks = [], theorems = [] } = {}) {
    const concepts = new Map();
    const at = (k) => (phrases[k] ? { kind: "phrase", k, line: phrases[k].line, page: phrases[k].page } : { kind: "phrase", k });
    const add = (name, kind, sort, source) => {
        if (!concepts.has(name)) concepts.set(name, { name, kind, sort: sort ?? S.BOT, sources: [], defs: [], uses: [], fields: null, parent: null });
        const c = concepts.get(name);
        if (sort && (c.sort.k === "⊥" || c.sort.k === "?")) c.sort = sort;
        if (source) c.sources.push(source);
        return c;
    };
    if (typing) {
        for (const [n, x] of typing.classes) {
            const t = tables.get(n);
            const c = add(n, x.table ? "tableau" : "classe", S.fiche(n), x.table ? { kind: "tableau", line: t?.line } : null);
            c.fields = new Map(x.fields);
            c.parent = x.parent;
            if (x.table) c.sort = S.liste(S.fiche(n));
        }
        for (const [n, x] of typing.fns) add(n, "action", S.action(x.params.map((p) => x.locals.get(p) ?? S.BOT), x.rend));
        for (const [n, s] of typing.globals) add(n, "donnée", s, typing.origin.get(n) === "externe" ? { kind: "valeur", via: "la jonction" } : null);
        for (const [n, ks] of typing.defs) if (concepts.has(n)) concepts.get(n).defs.push(...[...ks].map(at));
        for (const [n, ks] of typing.uses) if (concepts.has(n)) concepts.get(n).uses.push(...[...ks].map(at));
    }
    // un nom d'un bloc de code : il existe dès qu'il est écrit, de sorte ? jusqu'à ce que sa valeur arrive
    for (const b of blocks) {
        for (const d of b.defs) {
            const table = d.startsWith("table:"), n = table ? d.slice(6) : d;
            const c = add(n, table ? "tableau" : "donnée", S.DYN, { kind: "bloc", lang: b.lang, where: b.where, e: b.e });
            c.defs.push({ kind: "bloc", lang: b.lang, where: b.where, e: b.e });
        }
        for (const u of b.uses) { const n = u.replace(/^table:/, ""); if (concepts.has(n)) concepts.get(n).uses.push({ kind: "bloc", lang: b.lang, where: b.where, e: b.e }); }
    }
    for (const t of theorems) {
        if (!t.formula) continue;
        const dom = t.formula.t === "all" ? t.formula.vars.map((v) => ({ name: v.name, sort: v.dom === "N" ? S.nombre({ entier: true, min: 0 }) : v.dom === "Z" ? S.nombre({ entier: true }) : S.NOMBRE })) : [];
        add(`${t.name} ${t.title || ""}`.trim(), "théorème", null, { kind: "théorème", line: t.head, status: t.status }).domain = dom;
    }
    return new Model(concepts);
}

class Model {
    constructor(concepts) { this.concepts = concepts; }

    /** La sorte d'un nom (⊥ s'il n'existe pas). */
    sort(name) { return this.concepts.get(name)?.sort ?? S.BOT; }

    /** Les champs d'une classe, avec ceux de ses parentes : Map champ → sorte. */
    fields(cls) {
        const out = new Map();
        const chain = [];
        for (let c = cls; c && this.concepts.get(c); c = this.concepts.get(c).parent) chain.unshift(c);
        for (const c of chain) for (const [f, s] of this.concepts.get(c).fields || []) out.set(f, s);
        return out;
    }

    /** a est-elle une sorte de b ? (classes : « un studio est une sorte d'appartement ») */
    isA(a, b) {
        for (let c = a; c; c = this.concepts.get(c)?.parent) if (c === b) return true;
        return false;
    }

    /** Ce que le modèle sait d'un nom, en français : sa sorte, d'où il vient, qui le lit. */
    why(name) {
        const c = this.concepts.get(name);
        if (!c) return `« ${label(name)} » n'existe pas encore dans le document`;
        const where = (s) => (s.kind === "phrase" ? (s.line != null ? `la phrase de la ligne ${s.line + 1}` : "une phrase") : s.kind === "bloc" ? `le ${s.where} (${s.lang})` : s.kind === "tableau" ? (s.line != null ? `le tableau de la ligne ${s.line + 1}` : "un tableau") : s.via ? `une valeur reçue par ${s.via}` : s.kind);
        const uniq = (xs) => [...new Set(xs.map(where))];
        let out = `« ${label(name)} » : ${c.kind === "action" ? describeAction(c.sort) : c.kind === "tableau" ? `un tableau (${[...this.fields(name)].map(([f, s]) => `${label(f)} : ${S.text(s)}`).join(" ; ")})` : c.kind === "classe" ? `une classe${c.parent ? `, une sorte de ${label(c.parent)}` : ""} (${[...this.fields(name)].map(([f, s]) => `${label(f)} : ${S.text(s)}`).join(" ; ")})` : S.text(c.sort)}`;
        const from = uniq([...c.sources, ...c.defs]);
        if (from.length) out += ` — défini par ${from.slice(0, 3).join(", ")}${from.length > 3 ? "…" : ""}`;
        const by = uniq(c.uses);
        if (by.length) out += ` ; lu par ${by.slice(0, 3).join(", ")}${by.length > 3 ? "…" : ""}`;
        return out;
    }

    /** Tous les concepts, par genre : pour le diagramme et la vue du modèle. */
    list() { return [...this.concepts.values()]; }

    /** Une ligne courte : pour la signature (deux modèles de même clé lisent les phrases pareil). */
    key() { return [...this.concepts.values()].map((c) => `${c.name}:${S.key(c.sort)}`).join(";"); }
}

function describeAction(s) {
    if (s.k !== "action") return "une action";
    const ps = s.params.map((p) => (p.k === "⊥" ? "une valeur" : S.text(p))).join(", ");
    return `une action ${ps ? `(${ps})` : "sans valeur"}${s.rend && s.rend.k !== "⊥" ? ` qui renvoie ${S.text(s.rend)}` : ""}`;
}

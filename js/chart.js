// Visualisation de données (CSV, ou un tableau venu de Python) : le graphique se choisit selon les colonnes.
//
//   une colonne de dates (ou nommée date, mois, année…)   -> courbes dans le temps
//   une colonne de libellés + des nombres                -> barres (les libellés répétés s'additionnent)
//   seulement des nombres                                -> nuage de points (ou courbe si x croît), histogramme s'il n'y en a qu'un
//
// L'en-tête donne aussi l'unité (« Loyer (€) », « Taux % ») et écarte les identifiants (« id », « n° »).
// Les couleurs viennent du thème (séries --s0… et couleur du texte) : le graphique va avec le fond.
// Une barre d'outils change le type, l'axe horizontal et les séries ; « Tableau » montre les données.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

// ---------------------------------------------------------------- lecture

/** Découpe un CSV : séparateur deviné (, ; tabulation), guillemets, virgule décimale si le séparateur est « ; ». */
export function parseCSV(text) {
    const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    const first = lines.split("\n")[0] || "";
    const sep = [";", "\t", ",", "|"].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i <= lines.length; i++) {
        const c = lines[i];
        if (q) {
            if (c === '"' && lines[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c ?? "";
        } else if (c === '"' && !cell.trim()) q = true;
        else if (c === sep) { row.push(cell); cell = ""; }
        else if (c === "\n" || c === undefined) { row.push(cell); rows.push(row); row = []; cell = ""; }
        else cell += c;
    }
    const [head = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
    return { columns: head.map((x) => x.trim()), rows: body.map((r) => head.map((_, k) => typed(r[k], sep))) };
}

function typed(v, sep) {
    if (v == null) return null;
    const t = v.trim();
    if (!t) return null;
    let n = t.replace(/[\s  ]/g, "").replace(/[€$%]$/, "").replace(/^[€$]/, "");
    if (sep !== "," && /^-?\d+(,\d+)?$/.test(n)) n = n.replace(",", ".");
    if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(n)) return Number(n);
    return t;
}

const DATE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ](\d{1,2}):(\d{2}))?|^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function asDate(v) {
    if (typeof v !== "string") return null;
    const m = DATE.exec(v.trim());
    if (!m) return null;
    return m[1] ? Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0)) : Date.UTC(+m[8], +m[7] - 1, +m[6]);
}

// ---------------------------------------------------------------- les colonnes, d'après leurs valeurs et leur en-tête

const TIME_NAME = /\b(date|jour|mois|ann[ée]e|semaine|heure|trimestre|p[ée]riode|day|month|year|week|time|quarter)s?\b/i;
const ID_NAME = /^(id|n°|no|num(é|e)ro|index|#|code|r[ée]f)\b/i;

function describe(columns, rows) {
    return columns.map((name, k) => {
        const vals = rows.map((r) => r[k]).filter((v) => v != null);
        const nums = vals.filter((v) => typeof v === "number").length;
        const dates = vals.filter((v) => asDate(v) != null).length;
        const unit = /\(([^)]{1,8})\)\s*$/.exec(name)?.[1] || (/[€%$]\s*$/.exec(name)?.[0].trim() ?? "");
        const label = name.replace(/\s*\([^)]*\)\s*$/, "");
        const kind = vals.length && dates >= vals.length * 0.8 ? "date" : vals.length && nums >= vals.length * 0.8 ? "num" : "text";
        const integers = kind === "num" && vals.every((v) => typeof v !== "number" || Number.isInteger(v));
        // Une colonne nommée « année » faite d'entiers est du temps ; « id », « n° » ne se tracent pas
        const time = kind === "date" || (TIME_NAME.test(name) && (kind === "text" || integers));
        return { k, name, label, unit, kind, time, id: ID_NAME.test(name.trim()), distinct: new Set(vals).size };
    });
}

/** Le graphique qui convient : { type, x, ys } */
export function choose(cols, rows) {
    const nums = cols.filter((c) => c.kind === "num" && !c.id);
    const time = cols.find((c) => c.time);
    const label = cols.find((c) => c.kind === "text" && !c.time);
    if (time) return { type: "line", x: time.k, ys: nums.filter((c) => c !== time).slice(0, 6).map((c) => c.k) };
    if (label && nums.length) return { type: "bar", x: label.k, ys: nums.slice(0, 4).map((c) => c.k) };
    if (nums.length >= 2) {
        const [a, b] = nums;
        const xs = rows.map((r) => r[a.k]);
        const increasing = xs.every((v, i) => i === 0 || v == null || xs[i - 1] == null || v >= xs[i - 1]);
        return { type: increasing ? "line" : "scatter", x: a.k, ys: nums.slice(1, increasing ? 6 : 2).map((c) => c.k) };
    }
    if (nums.length === 1) return { type: "hist", x: nums[0].k, ys: [nums[0].k] };
    return { type: "table", x: 0, ys: [] };
}

// ---------------------------------------------------------------- dessin

const fmt = (v, unit = "") => {
    const a = Math.abs(v);
    const s = a >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : a >= 1e4 ? `${(v / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`
        : v.toLocaleString("fr-FR", { maximumFractionDigits: a < 1 ? 3 : 2 });
    return unit ? (unit === "%" ? `${s} %` : `${s} ${unit}`) : s;
};

function ticks(lo, hi, n = 5) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const step0 = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(step0)), m = step0 / p;
    const step = (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
}

/** Graduations de temps calées sur le calendrier : années, mois (1, 2, 3, 6) ou jours (1, 2, 7, 14) */
function timeTicks(lo, hi, n) {
    const day = 864e5, span = hi - lo, out = [];
    const d = new Date(lo);
    if (span > 2 * 365 * day) {
        const years = Math.ceil(span / (365 * day) / n) || 1;
        for (let y = d.getUTCFullYear() + (d.getUTCMonth() || d.getUTCDate() > 1 ? 1 : 0); Date.UTC(y, 0) <= hi; y += years) out.push(Date.UTC(y, 0));
    } else if (span > 60 * day) {
        const months = [1, 2, 3, 6, 12].find((m) => span / (30.4 * day * m) <= n) || 12;
        for (let y = d.getUTCFullYear(), m = d.getUTCMonth() + (d.getUTCDate() > 1 ? 1 : 0); Date.UTC(y, m) <= hi; m += months) out.push(Date.UTC(y, m));
    } else {
        const days = [1, 2, 7, 14].find((k) => span / (day * k) <= n) || 14;
        for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); t <= hi; t += days * day) if (t >= lo) out.push(t);
    }
    return out.length ? out : [lo];
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fmtDate = (t, span) => {
    const d = new Date(t);
    return span > 2 * 365 * 864e5 ? String(d.getUTCFullYear()) : span > 60 * 864e5 ? `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`
        : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

function draw(svgBox, cols, rows, plan, width) {
    const H = 300, W = Math.max(280, width);
    const X = cols[plan.x], Ys = plan.ys.map((k) => cols[k]);
    const unit = Ys.length && Ys.every((c) => c.unit === Ys[0].unit) ? Ys[0].unit : "";
    const ML = 56, MR = 16, MT = 14, MB = 34;
    const iw = W - ML - MR, ih = H - MT - MB;
    const parts = [];
    let xTicks = [], yLo = 0, yHi = 1, series = [];
    const color = (i) => `var(--s${i % 6})`;

    if (plan.type === "hist") {
        const vals = rows.map((r) => r[plan.x]).filter((v) => typeof v === "number");
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const bins = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
        const w = (hi - lo) / bins || 1;
        const counts = Array(bins).fill(0);
        for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
        yHi = Math.max(...counts, 1);
        const yt = ticks(0, yHi);
        yHi = yt[yt.length - 1];
        const y = (v) => MT + ih - (v / yHi) * ih;
        for (const t of yt) parts.push(`<line class="ch-grid" x1="${ML}" x2="${W - MR}" y1="${y(t)}" y2="${y(t)}"/><text class="ch-tick" x="${ML - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`);
        counts.forEach((c, i) => {
            const x0 = ML + (i / bins) * iw;
            parts.push(`<rect x="${x0 + 1}" y="${y(c)}" width="${Math.max(1, iw / bins - 2)}" height="${MT + ih - y(c)}" rx="2" fill="${color(0)}"><title>${fmt(lo + i * w, X.unit)} – ${fmt(lo + (i + 1) * w, X.unit)} : ${c}</title></rect>`);
        });
        for (const t of ticks(lo, hi, 6)) if (t >= lo && t <= hi) parts.push(`<text class="ch-tick" x="${ML + ((t - lo) / (hi - lo || 1)) * iw}" y="${H - MB + 18}" text-anchor="middle">${fmt(t, X.unit)}</text>`);
        parts.push(`<text class="ch-axis" x="${ML + iw / 2}" y="${H - 2}" text-anchor="middle">${esc(X.label)} · répartition</text>`);
        svgBox.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ch-svg">${parts.join("")}</svg>`;
        return [];
    }

    // Barres : libellés en x (les répétitions s'additionnent), au plus 30, les plus grands d'abord s'il y en a trop
    if (plan.type === "bar") {
        const order = [], sums = new Map();
        for (const r of rows) {
            const key = String(r[plan.x] ?? "—");
            if (!sums.has(key)) { sums.set(key, plan.ys.map(() => 0)); order.push(key); }
            plan.ys.forEach((k, i) => { if (typeof r[k] === "number") sums.get(key)[i] += r[k]; });
        }
        let keys = order;
        if (keys.length > 30) keys = [...keys].sort((a, b) => sums.get(b)[0] - sums.get(a)[0]).slice(0, 30);
        const all = keys.flatMap((k) => sums.get(k));
        yLo = Math.min(0, ...all); yHi = Math.max(0, ...all);
        const yt = ticks(yLo, yHi);
        yLo = Math.min(yLo, yt[0]); yHi = Math.max(yHi, yt[yt.length - 1]);
        const y = (v) => MT + ih - ((v - yLo) / (yHi - yLo || 1)) * ih;
        for (const t of yt) parts.push(`<line class="ch-grid" x1="${ML}" x2="${W - MR}" y1="${y(t)}" y2="${y(t)}"/><text class="ch-tick" x="${ML - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t, unit)}</text>`);
        const band = iw / keys.length, bw = Math.min(46, (band * 0.75) / plan.ys.length);
        keys.forEach((key, i) => {
            const cx = ML + band * (i + 0.5);
            sums.get(key).forEach((v, s) => {
                const x0 = cx - (bw * plan.ys.length) / 2 + s * bw;
                parts.push(`<rect x="${x0}" y="${Math.min(y(v), y(0))}" width="${bw - 2}" height="${Math.abs(y(v) - y(0))}" rx="2" fill="${color(s)}"><title>${esc(key)} · ${esc(Ys[s].label)} : ${fmt(v, Ys[s].unit)}</title></rect>`);
            });
            const every = Math.ceil(keys.length / Math.max(1, Math.floor(iw / 70)));
            if (i % every === 0) {
                const t = key.length > 14 ? `${key.slice(0, 13)}…` : key;
                parts.push(`<text class="ch-tick" x="${cx}" y="${H - MB + 18}" text-anchor="middle">${esc(t)}<title>${esc(key)}</title></text>`);
            }
        });
        parts.push(`<line class="ch-base" x1="${ML}" x2="${W - MR}" y1="${y(0)}" y2="${y(0)}"/>`);
        svgBox.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ch-svg">${parts.join("")}</svg>`;
        return Ys;
    }

    // Courbes et nuages : x numérique ou temporel
    const xv = (r) => (X.kind === "date" || (X.time && X.kind === "text") ? asDate(r[plan.x]) : typeof r[plan.x] === "number" ? r[plan.x] : null);
    const pts = rows.map((r) => [xv(r), r]).filter(([x]) => x != null).sort((a, b) => (plan.type === "line" ? a[0] - b[0] : 0));
    const xs = pts.map(([x]) => x);
    const xLo = Math.min(...xs), xHi = Math.max(...xs);
    series = plan.ys.map((k) => pts.map(([x, r]) => [x, r[k]]).filter(([, v]) => typeof v === "number"));
    const allY = series.flat().map(([, v]) => v);
    if (!allY.length) { svgBox.innerHTML = `<p class="ch-empty">Pas de valeurs numériques à tracer.</p>`; return []; }
    yLo = Math.min(...allY); yHi = Math.max(...allY);
    if (yLo > 0 && yLo < yHi * 0.3) yLo = 0;
    const yt = ticks(yLo, yHi);
    yLo = Math.min(yLo, yt[0]); yHi = Math.max(yHi, yt[yt.length - 1]);
    const x = (v) => ML + ((v - xLo) / (xHi - xLo || 1)) * iw, y = (v) => MT + ih - ((v - yLo) / (yHi - yLo || 1)) * ih;
    for (const t of yt) parts.push(`<line class="ch-grid" x1="${ML}" x2="${W - MR}" y1="${y(t)}" y2="${y(t)}"/><text class="ch-tick" x="${ML - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t, unit)}</text>`);
    const isTime = X.kind === "date" || (X.time && X.kind === "text");
    xTicks = isTime ? timeTicks(xLo, xHi, Math.max(2, Math.floor(iw / 90))) : ticks(xLo, xHi, Math.max(2, Math.floor(iw / 80)));
    for (const t of xTicks) if (t >= xLo && t <= xHi) {
        parts.push(`<text class="ch-tick" x="${x(t)}" y="${H - MB + 18}" text-anchor="middle">${isTime ? fmtDate(t, xHi - xLo) : X.time ? String(t) : fmt(t, X.unit)}</text>`);
    }
    parts.push(`<line class="ch-base" x1="${ML}" x2="${W - MR}" y1="${MT + ih}" y2="${MT + ih}"/>`);
    const xName = (v) => (isTime ? new Date(v).toISOString().slice(0, 10) : X.time ? String(v) : fmt(v, X.unit));
    series.forEach((ser, s) => {
        if (plan.type === "line") {
            parts.push(`<polyline class="ch-line" fill="none" stroke="${color(s)}" points="${ser.map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(" ")}"/>`);
            if (ser.length <= 60) for (const [a, b] of ser) parts.push(`<circle cx="${x(a)}" cy="${y(b)}" r="3" fill="${color(s)}"><title>${esc(xName(a))} · ${esc(Ys[s].label)} : ${fmt(b, Ys[s].unit)}</title></circle>`);
        } else for (const [a, b] of ser) parts.push(`<circle cx="${x(a)}" cy="${y(b)}" r="3.5" fill="${color(s)}" fill-opacity=".75"><title>${esc(X.label)} ${esc(xName(a))} · ${esc(Ys[s].label)} : ${fmt(b, Ys[s].unit)}</title></circle>`);
    });
    if (!isTime) parts.push(`<text class="ch-axis" x="${ML + iw / 2}" y="${H - 2}" text-anchor="middle">${esc(X.label)}</text>`);
    svgBox.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ch-svg">${parts.join("")}</svg>`;
    return Ys;
}

// ---------------------------------------------------------------- la vue : graphique, barre d'outils, tableau

const TYPES = [["auto", "Auto"], ["bar", "Barres"], ["line", "Courbes"], ["scatter", "Points"], ["hist", "Histogramme"], ["table", "Tableau"]];

/** data : { csv } ou { columns, rows, title } ; tableView : la vue des tableaux du rendu (pour « Tableau ») */
export function chartView(data, tableView) {
    const parsed = data.csv != null ? parseCSV(String(data.csv)) : { columns: data.columns || [], rows: data.rows || [] };
    const { columns, rows } = parsed;
    const cols = describe(columns, rows);
    const auto = choose(cols, rows);
    let plan = { ...auto, type: auto.type }, mode = "auto";
    const el = h(`<div class="out-chart">
        <div class="ch-bar">
          <span class="ch-title"></span>
          <select class="ch-type" aria-label="Type de graphique">${TYPES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
          <label class="ch-xl">x <select class="ch-x" aria-label="Axe horizontal">${cols.map((c) => `<option value="${c.k}">${esc(c.label)}</option>`).join("")}</select></label>
          <span class="ch-count"></span>
        </div>
        <div class="ch-legend"></div>
        <div class="ch-plot"></div>
      </div>`);
    el.querySelector(".ch-title").textContent = data.title || "";
    el.querySelector(".ch-count").textContent = `${rows.length} ligne${rows.length > 1 ? "s" : ""} · ${columns.length} colonne${columns.length > 1 ? "s" : ""}`;
    const plot = el.querySelector(".ch-plot"), legend = el.querySelector(".ch-legend");
    const typeSel = el.querySelector(".ch-type"), xSel = el.querySelector(".ch-x");
    const numeric = cols.filter((c) => c.kind === "num" && !c.id);

    const render = () => {
        typeSel.value = mode;
        xSel.value = String(plan.x);
        el.querySelector(".ch-xl").hidden = plan.type === "table" || plan.type === "hist";
        if (plan.type === "table") {
            legend.innerHTML = "";
            plot.replaceChildren(tableView({ columns, rows }));
            return;
        }
        if (!plan.ys.length && plan.type !== "hist") { plot.innerHTML = `<p class="ch-empty">Aucune colonne de nombres à tracer : « Tableau » montre les données.</p>`; legend.innerHTML = ""; return; }
        draw(plot, cols, rows, plan, plot.clientWidth || el.clientWidth || 720);
        // Les séries : cliquer en ajoute ou en retire (barres, courbes)
        legend.innerHTML = plan.type === "hist" ? "" : numeric.filter((c) => c.k !== plan.x).map((c) => {
            const i = plan.ys.indexOf(c.k);
            return `<button type="button" data-k="${c.k}" class="${i >= 0 ? "on" : ""}" ${i >= 0 ? `style="--c: var(--s${i % 6})"` : ""}><i></i>${esc(c.label)}${c.unit ? ` <small>${esc(c.unit)}</small>` : ""}</button>`;
        }).join("");
    };
    typeSel.addEventListener("change", () => {
        mode = typeSel.value;
        if (mode === "auto") plan = { ...auto };
        else if (mode === "hist") plan = { ...plan, type: "hist", x: (numeric.find((c) => c.k === plan.ys[0]) || numeric[0] || cols[0]).k, ys: [] };
        else {
            let x = plan.x;
            if (mode !== "bar" && cols[x].kind === "text" && !cols[x].time) x = (cols.find((c) => c.time) || numeric[0] || cols[x]).k;
            if (mode === "bar" && !(cols[x].kind === "text" || cols[x].time)) x = (cols.find((c) => c.kind === "text") || cols[x]).k;
            const ys = plan.ys.filter((k) => k !== x);
            plan = { type: mode, x, ys: ys.length ? ys : numeric.filter((c) => c.k !== x).slice(0, mode === "scatter" ? 1 : 4).map((c) => c.k) };
        }
        render();
    });
    xSel.addEventListener("change", () => { const x = +xSel.value; plan = { ...plan, x, ys: plan.ys.filter((k) => k !== x) }; render(); });
    legend.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-k]");
        if (!b) return;
        const k = +b.dataset.k;
        plan = { ...plan, ys: plan.ys.includes(k) ? plan.ys.filter((y) => y !== k) : [...plan.ys, k] };
        render();
    });
    // À la largeur de la colonne : redessiné quand la fenêtre change
    let last = 0;
    new ResizeObserver(() => { const w = plot.clientWidth; if (w && Math.abs(w - last) > 8) { last = w; render(); } }).observe(plot);
    requestAnimationFrame(render);
    return el;
}

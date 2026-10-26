"""Lumen — noyau résident de la machine virtuelle JarWeBox (Python 3.7, bibliothèque standard).

La page dépose les requêtes dans /tmp/lumen/in/ (fichiers <seq>.req : JSON encodé en base64,
écrits par la commande SH du lanceur). Le noyau les traite une à une, dans l'ordre, et renvoie
chaque événement sur le port série sous la forme d'une ligne « @@LX <base64 du JSON> »
(« @@LP <msg> <i> <n> <morceau> » quand le message est long).

Langages servis ici, chacun avec un état qui persiste d'une cellule à l'autre :
  python   espace de noms partagé, magies %/%%, commandes !shell, affichage riche
  sh       busybox ash ; le dossier courant et les variables exportées persistent
  sql      SQLite 3 (/tmp/lumen/notebook.db), partagé avec Python (sql(), db)
  tcl      interpréteur Tcl 8.6 persistant
  scheme   interpréteur Scheme écrit ici
  awk      busybox awk (« # input: fichier » en première ligne pour lire un fichier)
JavaScript et Java sont servis par lumen-java.jar, dans la JVM du lanceur.
"""
import ast
import base64
import builtins
import html
import io
import json
import keyword
import math
import os
import pprint
import re
import hashlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import traceback

ROOT = "/tmp/lumen"
INBOX = ROOT + "/in"
WORK = ROOT + "/work"
VERSION = "1.0"

for d in (ROOT, INBOX, WORK):
    os.makedirs(d, exist_ok=True)
os.chdir(WORK)

# ---------------------------------------------------------------- port série

_tty = os.open("/dev/ttyS0", os.O_WRONLY | os.O_NOCTTY)
_msg_seq = [0]


def emit(msg):
    """Envoie un événement à la page : une ligne par écriture, pour ne pas se mêler au lanceur."""
    raw = base64.b64encode(json.dumps(msg, ensure_ascii=False, default=str).encode("utf-8")).decode("ascii")
    if len(raw) <= 6000:
        os.write(_tty, ("\n@@LX " + raw + "\n").encode("ascii"))
        return
    _msg_seq[0] += 1
    mid = "m%d" % _msg_seq[0]
    parts = [raw[i:i + 6000] for i in range(0, len(raw), 6000)]
    for i, p in enumerate(parts):
        os.write(_tty, ("\n@@LP %s %d %d %s\n" % (mid, i, len(parts), p)).encode("ascii"))


class Interrupted(Exception):
    pass


def _on_sigint(signum, frame):
    raise KeyboardInterrupt()


signal.signal(signal.SIGINT, _on_sigint)

# ---------------------------------------------------------------- flux de sortie

CURRENT = {"id": None}
MAX_STREAM = 400000


class Stream(io.TextIOBase):
    """stdout / stderr d'une cellule : regroupés par lignes et envoyés au fil de l'eau."""

    def __init__(self, name):
        self.name = name
        self.buf = []
        self.last = time.time()
        self.sent = 0

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        self.buf.append(s)
        if "\n" in s or time.time() - self.last > 0.08 or sum(map(len, self.buf)) > 4000:
            self.flush()
        return len(s)

    def flush(self):
        if not self.buf:
            return
        text = "".join(self.buf)
        self.buf = []
        self.last = time.time()
        if self.sent > MAX_STREAM:
            return
        self.sent += len(text)
        if self.sent > MAX_STREAM:
            text += "\n… sortie tronquée (plus de %d caractères)\n" % MAX_STREAM
        emit({"t": "stream", "id": CURRENT["id"], "name": self.name, "text": text})


OUT, ERR = Stream("stdout"), Stream("stderr")


def flush_streams():
    OUT.flush()
    ERR.flush()


# ---------------------------------------------------------------- affichage riche

def mimebundle(obj):
    """Représentations d'un objet, comme IPython : texte, HTML, SVG, Markdown, LaTeX, JSON…"""
    data = {}
    meth = getattr(obj, "_repr_mimebundle_", None)
    if callable(meth):
        try:
            data.update(meth() or {})
        except Exception:
            pass
    for key, name in (("text/html", "_repr_html_"), ("image/svg+xml", "_repr_svg_"),
                      ("text/markdown", "_repr_markdown_"), ("text/latex", "_repr_latex_"),
                      ("application/json", "_repr_json_")):
        meth = getattr(obj, name, None)
        if callable(meth) and key not in data:
            try:
                v = meth()
                if v is not None:
                    data[key] = v
            except Exception:
                pass
    if "text/plain" not in data:
        try:
            if isinstance(obj, (dict, list, tuple, set)) and len(repr(obj)) > 78:
                data["text/plain"] = pprint.pformat(obj, width=88, compact=True)
            else:
                data["text/plain"] = repr(obj)
        except Exception as e:
            data["text/plain"] = "<repr impossible : %s>" % e
    return data


def display(*objs, display_id=None, update=False, **kw):
    """Affiche des objets sous la cellule (display_id : pour les mettre à jour ensuite)."""
    flush_streams()
    for obj in objs:
        data = obj if kw.get("raw") else mimebundle(obj)
        emit({"t": "display", "id": CURRENT["id"], "data": data, "display_id": display_id, "update": update})


class _Rich:
    mime = "text/plain"

    def __init__(self, data):
        self.data = data

    def _repr_mimebundle_(self):
        return {self.mime: self.data, "text/plain": "<%s>" % type(self).__name__}


class HTML(_Rich):
    mime = "text/html"


class Markdown(_Rich):
    mime = "text/markdown"


class Latex(_Rich):
    mime = "text/latex"


class SVG(_Rich):
    mime = "image/svg+xml"


class JSON(_Rich):
    mime = "application/json"


class Chart:
    """Graphique de données, choisi selon les colonnes (dates, libellés, nombres, unités des en-têtes) :
    Chart("ventes.csv"), Chart(texte_csv), Chart([{"mois": …, "ventes": …}, …]), Chart({"x": [...], "y": [...]}),
    Chart(lignes, colonnes=[...]). Une barre d'outils change le type, l'axe, les séries ; « Tableau » montre les données."""

    def __init__(self, data, columns=None, title=None):
        self.title = title
        self.csv = None
        self.columns, self.rows = None, None
        if isinstance(data, str):
            if "\n" not in data and os.path.exists(os.path.expanduser(data)):
                with open(os.path.expanduser(data), encoding="utf-8", errors="replace") as f:
                    self.csv = f.read()
                self.title = title or os.path.basename(data)
            else:
                self.csv = data
            return
        if isinstance(data, dict):   # colonnes : {"x": [...], "y": [...]} (listes, tableaux numpy…)
            cols = list(data)
            values = [list(data[c]) for c in cols]
            data = [list(r) for r in zip(*values)]
            columns = cols
        rows = list(data)
        if rows and isinstance(rows[0], dict):
            columns = columns or list(rows[0])
            rows = [[r.get(c) for c in columns] for r in rows]
        else:
            rows = [list(r) if isinstance(r, (list, tuple)) else [r] for r in rows]
            columns = columns or ["colonne %d" % (i + 1) for i in range(max((len(r) for r in rows), default=0))]

        def plain(v):
            if hasattr(v, "item"):   # nombres numpy
                v = v.item()
            if isinstance(v, float) and v != v:
                return None
            return v if v is None or isinstance(v, (int, float, str)) else str(v)
        self.columns = [str(c) for c in columns]
        self.rows = [[plain(v) for v in r] for r in rows]

    def _repr_mimebundle_(self):
        value = {"csv": self.csv} if self.csv is not None else {"columns": self.columns, "rows": self.rows}
        if self.title:
            value["title"] = self.title
        return {"application/vnd.lumen.chart+json": value, "text/plain": "<Chart>"}


class Table:
    """Tableau interactif (tri, filtre) : Table(lignes, colonnes=None)."""

    def __init__(self, rows, columns=None, title=None):
        rows = list(rows)
        if rows and isinstance(rows[0], dict):
            columns = columns or list(rows[0].keys())
            rows = [[r.get(c) for c in columns] for r in rows]
        self.columns = list(columns or ["c%d" % i for i in range(len(rows[0]) if rows else 0)])
        self.rows = [list(r) for r in rows]
        self.title = title

    def _repr_mimebundle_(self):
        def cell(v):
            return v if isinstance(v, (int, float, str, bool)) or v is None else repr(v)
        body = [[cell(v) for v in r] for r in self.rows[:5000]]
        text = "\t".join(self.columns) + "\n" + "\n".join("\t".join(str(v) for v in r) for r in self.rows[:20])
        return {"application/vnd.lumen.table+json": {"columns": self.columns, "rows": body,
                                                     "total": len(self.rows), "title": self.title},
                "text/plain": text}

    def __len__(self):
        return len(self.rows)

    def __iter__(self):
        return iter(self.rows)


# ---- graphiques SVG (pas de matplotlib dans la machine : on dessine nous-mêmes)

def _nice_ticks(lo, hi, n=5):
    if hi - lo < 1e-12:
        lo, hi = lo - 1, hi + 1
    raw = (hi - lo) / n
    mag = 10 ** math.floor(math.log10(raw))
    step = min((s * mag for s in (1, 2, 2.5, 5, 10) if s * mag >= raw), default=raw)
    start = math.floor(lo / step) * step
    ticks = []
    v = start
    while v <= hi + step * 0.5:
        ticks.append(round(v, 12))
        v += step
    return ticks


def _fmt(v):
    """Graduation lisible : 12 000, 0,25, 1,5e-05."""
    if v == 0:
        return "0"
    if abs(v) >= 1e9 or abs(v) < 1e-3:
        return ("%.1e" % v).replace(".", ",")
    if abs(v) >= 1000:
        return "{:,.0f}".format(v).replace(",", "\u202f")
    return ("%.4g" % v).replace(".", ",")


class Figure:
    """Figure SVG : fig = Figure("Titre"); fig.line(x, y, "nom"); fig.scatter(...); fig.bar(...); fig.hist(...)."""

    def __init__(self, title=None, xlabel=None, ylabel=None, width=640, height=340):
        self.title, self.xlabel, self.ylabel = title, xlabel, ylabel
        self.width, self.height = width, height
        self.series = []

    def line(self, x, y=None, label=None):
        if y is None:
            x, y = list(range(len(x))), x
        self.series.append(("line", list(x), [float(v) for v in y], label))
        return self

    def scatter(self, x, y=None, label=None):
        if y is None:
            x, y = list(range(len(x))), x
        self.series.append(("scatter", list(x), [float(v) for v in y], label))
        return self

    def bar(self, labels, values=None, label=None):
        if values is None:
            labels, values = [str(i) for i in range(len(labels))], labels
        self.series.append(("bar", [str(l) for l in labels], [float(v) for v in values], label))
        return self

    def hist(self, data, bins=12, label=None):
        data = [float(v) for v in data]
        lo, hi = min(data), max(data)
        w = (hi - lo) / bins or 1
        counts = [0] * bins
        for v in data:
            counts[min(bins - 1, int((v - lo) / w))] += 1
        labels = [_fmt(lo + w * (i + 0.5)) for i in range(bins)]
        return self.bar(labels, counts, label)

    def _repr_svg_(self):
        W, H = self.width, self.height
        L, R, T, B = 56, 18, 36 if self.title else 16, 44
        pw, ph = W - L - R, H - T - B
        out = ['<svg class="lx-plot" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">' % (W, H, W, H)]
        if self.title:
            out.append('<text class="lx-title" x="%d" y="22">%s</text>' % (L, html.escape(str(self.title))))
        bars = [s for s in self.series if s[0] == "bar"]
        others = [s for s in self.series if s[0] != "bar"]
        ys = [v for s in self.series for v in s[2]] or [0, 1]
        ylo, yhi = min(ys + ([0] if bars else [])), max(ys + ([0] if bars else []))
        yt = _nice_ticks(ylo, yhi)
        ylo, yhi = min(yt[0], ylo), max(yt[-1], yhi)
        Y = lambda v: T + ph - (v - ylo) / ((yhi - ylo) or 1) * ph
        for t in yt:
            out.append('<line class="lx-grid" x1="%d" x2="%d" y1="%.1f" y2="%.1f"/>' % (L, L + pw, Y(t), Y(t)))
            out.append('<text class="lx-tick" x="%d" y="%.1f" text-anchor="end">%s</text>' % (L - 8, Y(t) + 4, _fmt(t)))
        if bars:
            labels = bars[0][1]
            n, k = len(labels), len(bars)
            slot = pw / max(n, 1)
            bw = slot * 0.72 / k
            for si, (_, lab, vals, name) in enumerate(bars):
                for i, v in enumerate(vals):
                    x = L + slot * i + slot * 0.14 + bw * si
                    y0, y1 = Y(max(v, 0)), Y(min(v, 0))
                    out.append('<rect class="lx-bar s%d" style="--i:%d" x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3"><title>%s : %s</title></rect>'
                               % (si % 8, i, x, y0, max(bw - 2, 1), max(y1 - y0, 0.5), html.escape(str(lab[i])), _fmt(v)))
            step = max(1, int(n / 12) + 1)
            for i in range(0, n, step):
                out.append('<text class="lx-tick" x="%.1f" y="%d" text-anchor="middle">%s</text>' % (L + slot * (i + 0.5), T + ph + 18, html.escape(labels[i][:10])))
        if others:
            xs = [float(v) for s in others for v in s[1]]
            xlo, xhi = min(xs), max(xs)
            xt = _nice_ticks(xlo, xhi, 6)
            X = lambda v: L + (float(v) - xlo) / ((xhi - xlo) or 1) * pw
            if not bars:
                for t in xt:
                    if xlo - 1e-9 <= t <= xhi + 1e-9:
                        out.append('<text class="lx-tick" x="%.1f" y="%d" text-anchor="middle">%s</text>' % (X(t), T + ph + 18, _fmt(t)))
            for si, (kind, x, y, name) in enumerate(others):
                cls = "s%d" % ((si + len(bars)) % 8)
                pts = " ".join("%.1f,%.1f" % (X(a), Y(b)) for a, b in zip(x, y) if b == b)
                if kind == "line":
                    out.append('<polyline class="lx-line %s" pathLength="1" points="%s"/>' % (cls, pts))
                else:
                    for a, b in zip(x, y):
                        out.append('<circle class="lx-dot %s" cx="%.1f" cy="%.1f" r="3.2"/>' % (cls, X(a), Y(b)))
        out.append('<line class="lx-axis" x1="%d" x2="%d" y1="%d" y2="%d"/>' % (L, L + pw, T + ph, T + ph))
        if self.xlabel:
            out.append('<text class="lx-label" x="%d" y="%d" text-anchor="middle">%s</text>' % (L + pw / 2, H - 6, html.escape(self.xlabel)))
        if self.ylabel:
            out.append('<text class="lx-label" transform="translate(14 %d) rotate(-90)" text-anchor="middle">%s</text>' % (T + ph / 2, html.escape(self.ylabel)))
        named = [(i, s[3]) for i, s in enumerate(bars + others) if s[3]]
        lx = L + pw
        for i, name in reversed(named):
            lx -= 26 + 6.6 * len(str(name))
            out.append('<g class="lx-legend s%d"><rect x="%d" y="%d" width="10" height="10" rx="2"/><text x="%d" y="%d">%s</text></g>'
                       % (i % 8, lx, T - 22 if self.title else 4, lx + 14, (T - 22 if self.title else 4) + 9, html.escape(str(name))))
        out.append("</svg>")
        return "".join(out)

    def _repr_mimebundle_(self):
        return {"image/svg+xml": self._repr_svg_(), "text/plain": "<Figure %s>" % (self.title or "")}


def plot(x, y=None, *more, title=None, xlabel=None, ylabel=None, label=None, kind="line"):
    """plot(y) · plot(x, y) · plot(x, [y1, y2], label=["a", "b"]) · kind="scatter" | "bar"."""
    fig = Figure(title, xlabel, ylabel)
    if y is not None and y and isinstance(y[0], (list, tuple)):
        labels = label or [None] * len(y)
        for yy, lab in zip(y, labels):
            getattr(fig, kind)(x, yy, lab)
    else:
        getattr(fig, kind)(x, y, label)
    return fig


def scatter(x, y=None, **kw):
    return plot(x, y, kind="scatter", **kw)


def bar(labels, values=None, **kw):
    return plot(labels, values, kind="bar", **kw)


def hist(data, bins=12, title=None, label=None):
    return Figure(title).hist(data, bins, label)


class progress:
    """Barre de progression : for x in progress(range(100)): ..."""

    def __init__(self, iterable, label="", total=None):
        self.it = iterable
        self.total = total or (len(iterable) if hasattr(iterable, "__len__") else None)
        self.label = label
        self.did = "p%d" % id(self)

    def _show(self, n, done=False):
        frac = n / self.total if self.total else 0
        bundle = {"application/vnd.lumen.progress+json": {"value": n, "total": self.total, "label": self.label, "done": done},
                  "text/plain": "%s %d/%s" % (self.label, n, self.total)}
        flush_streams()
        emit({"t": "display", "id": CURRENT["id"], "data": bundle, "display_id": self.did, "update": n > 0 or done})

    def __iter__(self):
        last = 0
        self._show(0)
        n = 0
        for x in self.it:
            yield x
            n += 1
            if time.time() - last > 0.15:
                last = time.time()
                self._show(n)
        self._show(n, True)


def clear_output():
    flush_streams()
    emit({"t": "clear", "id": CURRENT["id"]})


# ---------------------------------------------------------------- saisie (input)

def lx_input(prompt="", password=False):
    flush_streams()
    emit({"t": "input", "id": CURRENT["id"], "prompt": str(prompt), "password": password})
    path = INBOX + "/input.reply"
    while True:
        if os.path.exists(path):
            with open(path) as f:
                raw = f.read().strip()
            os.remove(path)
            return json.loads(base64.b64decode(raw).decode("utf-8")).get("value", "")
        time.sleep(0.03)


# ---------------------------------------------------------------- SQL

DB = sqlite3.connect(ROOT + "/notebook.db", isolation_level=None, check_same_thread=False)


def sql(query, *params):
    """Exécute une requête SQL ; renvoie un Table pour un SELECT."""
    cur = DB.execute(query, params)
    if cur.description:
        return Table(cur.fetchall(), [d[0] for d in cur.description])
    return cur.rowcount


def run_sql(code):
    results = []
    statement = ""
    for line in code.splitlines(True):
        statement += line
        if sqlite3.complete_statement(statement):
            results.append(statement.strip())
            statement = ""
    if statement.strip():
        results.append(statement.strip())
    shown = 0
    for st in results:
        if not st or st.startswith("--") and "\n" not in st:
            continue
        t0 = time.time()
        cur = DB.execute(st)
        if cur.description:
            rows = cur.fetchall()
            table = Table(rows, [d[0] for d in cur.description])
            NS["sql_result"] = table
            display(table)
            shown += 1
        else:
            verb = st.split(None, 1)[0].upper()
            n = cur.rowcount
            OUT.write("%s · %s%s\n" % (verb, "%d ligne(s)" % n if n >= 0 else "ok", " · %.0f ms" % ((time.time() - t0) * 1000)))
    return shown


# ---------------------------------------------------------------- shell (persistant : dossier, exports)

SH_STATE = {"cwd": WORK, "env": dict(os.environ)}
CHILD = {"p": None}


def run_process(args, stdin_data=None, cwd=None, env=None, mark=None):
    """Lance un processus et diffuse sa sortie ; renvoie son code de retour. Avec mark, les lignes qui commencent
    par mark ne s'affichent pas : elles sont rendues avec le code de retour, (code, [lignes sans la marque])."""
    p = subprocess.Popen(args, stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=cwd, env=env, start_new_session=True)
    CHILD["p"] = p
    try:
        if stdin_data is not None:
            p.stdin.write(stdin_data.encode("utf-8"))
            p.stdin.close()
        fd = p.stdout.fileno()
        dec = __import__("codecs").getincrementaldecoder("utf-8")("replace")
        marked, held = [], ""
        while True:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            text = dec.decode(chunk)
            if mark is None:
                OUT.write(text)
                continue
            held += text
            while held:
                k = held.find(mark)
                if k < 0:
                    # une marque peut commencer à la fin du morceau : on garde ce qui pourrait en être le début
                    keep = next((n for n in range(min(len(mark) - 1, len(held)), 0, -1) if mark.startswith(held[-n:])), 0)
                    OUT.write(held[:len(held) - keep])
                    held = held[len(held) - keep:]
                    break
                OUT.write(held[:k])
                end = held.find("\n", k)
                if end < 0:
                    held = held[k:]
                    break
                marked.append(held[k + len(mark):end])
                held = held[end + 1:]
        if held:
            OUT.write(held)
        rc = p.wait()
        return (rc, marked) if mark is not None else rc
    except KeyboardInterrupt:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            p.kill()
        raise
    finally:
        CHILD["p"] = None


def run_sh(code, capture=False):
    marker = ROOT + "/sh.state"
    script = "%s\n__lx_rc=$?\n{ pwd; echo; env; } > %s\nexit $__lx_rc\n" % (code, marker)
    if capture:
        r = subprocess.run(["sh", "-c", script], cwd=SH_STATE["cwd"], env=SH_STATE["env"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        rc, out = r.returncode, r.stdout.decode("utf-8", "replace")
    else:
        rc, out = run_process(["sh", "-c", script], cwd=SH_STATE["cwd"], env=SH_STATE["env"]), None
    try:
        with open(marker) as f:
            cwd, _, env = f.read().partition("\n\n")
        SH_STATE["cwd"] = cwd.strip() or SH_STATE["cwd"]
        newenv = {}
        for line in env.splitlines():
            k, sep, v = line.partition("=")
            if sep and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", k):
                newenv[k] = v
        if newenv:
            SH_STATE["env"] = newenv
    except OSError:
        pass
    return (rc, out) if capture else rc


class SList(list):
    """Résultat de x = !commande : la liste des lignes, avec .s (texte) et .n (lignes jointes)."""

    @property
    def s(self):
        return " ".join(self)

    @property
    def n(self):
        return "\n".join(self)


def __lx_sh(cmd, capture=False):
    flush_streams()
    if capture:
        rc, out = run_sh(cmd, capture=True)
        return SList(out.splitlines())
    rc = run_sh(cmd)
    if rc:
        ERR.write("(code de retour %d)\n" % rc)


# ---------------------------------------------------------------- Tcl

TCL = {"interp": None}


def tcl_interp():
    if TCL["interp"] is None:
        import tkinter
        t = tkinter.Tcl()

        def puts(text, nl):
            OUT.write(text + ("\n" if nl == "1" else ""))
            return ""
        t.createcommand("__lx_puts", puts)
        t.eval("""
rename puts __lx_orig_puts
proc puts {args} {
    set nl 1
    if {[lindex $args 0] eq "-nonewline"} { set nl 0; set args [lrange $args 1 end] }
    if {[llength $args] == 2} {
        set chan [lindex $args 0]
        if {$chan ne "stdout" && $chan ne "stderr"} { return [uplevel 1 [list __lx_orig_puts {*}[expr {$nl ? {} : {-nonewline}}] {*}$args]] }
        set args [lrange $args 1 end]
    }
    __lx_puts [lindex $args 0] $nl
}
""")
        TCL["interp"] = t
    return TCL["interp"]


def run_tcl(code):
    t = tcl_interp()
    try:
        res = t.eval(code)
    except Exception as e:
        info = t.eval("set errorInfo")
        raise LangError("TclError", str(e), info.splitlines())
    return res


# ---------------------------------------------------------------- Scheme

class LangError(Exception):
    def __init__(self, ename, evalue, tb=None):
        Exception.__init__(self, evalue)
        self.ename, self.evalue, self.tb = ename, evalue, tb or []


class Sym(str):
    pass


class Proc:
    def __init__(self, params, body, env, name="lambda"):
        self.params, self.body, self.env, self.name = params, body, env, name

    def __repr__(self):
        return "#<procedure %s>" % self.name


class Env(dict):
    def __init__(self, params=(), args=(), outer=None):
        dict.__init__(self)
        if isinstance(params, Sym):
            self[params] = list(args)
        else:
            if len(params) != len(args) and "." not in params:
                raise LangError("ArityError", "%d argument(s) attendu(s), %d reçu(s)" % (len(params), len(args)))
            if "." in params:
                i = params.index(".")
                self.update(zip(params[:i], args[:i]))
                self[params[i + 1]] = list(args[i:])
            else:
                self.update(zip(params, args))
        self.outer = outer

    def find(self, var):
        e = self
        while e is not None:
            if var in e:
                return e
            e = e.outer
        raise LangError("UnboundVariable", "variable inconnue : %s" % var)


def scm_tokenize(s):
    s = re.sub(r";[^\n]*", "", s)
    return re.findall(r'"(?:\\.|[^"\\])*"|[()\']|[^\s()\']+', s)


def scm_read(tokens):
    if not tokens:
        raise LangError("SyntaxError", "fin de programme inattendue")
    tok = tokens.pop(0)
    if tok == "(":
        lst = []
        while tokens and tokens[0] != ")":
            lst.append(scm_read(tokens))
        if not tokens:
            raise LangError("SyntaxError", "parenthèse fermante manquante")
        tokens.pop(0)
        return lst
    if tok == ")":
        raise LangError("SyntaxError", "parenthèse fermante en trop")
    if tok == "'":
        return [Sym("quote"), scm_read(tokens)]
    if tok.startswith('"'):
        return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), tok[1:-1])
    if tok in ("#t", "#true"):
        return True
    if tok in ("#f", "#false"):
        return False
    try:
        return int(tok)
    except ValueError:
        try:
            return float(tok)
        except ValueError:
            return Sym(tok)


def scm_str(x, display=False):
    if x is True:
        return "#t"
    if x is False:
        return "#f"
    if isinstance(x, Sym):
        return x
    if isinstance(x, str):
        return x if display else json.dumps(x, ensure_ascii=False)
    if isinstance(x, list):
        return "(" + " ".join(scm_str(v, display) for v in x) + ")"
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
        return "%.1f" % x
    if x is None:
        return ""
    return str(x)


def scm_global():
    import operator as op
    env = Env()

    def num_chain(f):
        return lambda *a: all(f(a[i], a[i + 1]) for i in range(len(a) - 1))

    def sub(*a):
        return -a[0] if len(a) == 1 else a[0] - sum(a[1:])

    def div(*a):
        r = a[0]
        for v in a[1:]:
            r = r / v
        return r if not (isinstance(r, float) and r.is_integer() and all(isinstance(v, int) for v in a)) else int(r)

    def disp(x):
        OUT.write(scm_str(x, True))

    env.update({
        "+": lambda *a: sum(a), "-": sub, "*": lambda *a: math.prod(a) if hasattr(math, "prod") else __import__("functools").reduce(op.mul, a, 1),
        "/": div, "quotient": lambda a, b: int(a / b), "remainder": lambda a, b: math.fmod(a, b), "modulo": op.mod,
        "=": num_chain(op.eq), "<": num_chain(op.lt), ">": num_chain(op.gt), "<=": num_chain(op.le), ">=": num_chain(op.ge),
        "abs": abs, "min": min, "max": max, "sqrt": math.sqrt, "expt": pow, "exp": math.exp, "log": math.log,
        "sin": math.sin, "cos": math.cos, "floor": math.floor, "ceiling": math.ceil, "round": round,
        "number?": lambda x: isinstance(x, (int, float)) and not isinstance(x, bool),
        "even?": lambda x: x % 2 == 0, "odd?": lambda x: x % 2 == 1, "zero?": lambda x: x == 0,
        "not": lambda x: x is False, "eq?": lambda a, b: a is b or a == b, "equal?": op.eq, "eqv?": op.eq,
        "car": lambda x: x[0], "cdr": lambda x: x[1:], "cons": lambda a, b: [a] + (b if isinstance(b, list) else [b]),
        "cadr": lambda x: x[1], "cddr": lambda x: x[2:], "list": lambda *a: list(a), "length": len,
        "null?": lambda x: x == [], "pair?": lambda x: isinstance(x, list) and x != [], "list?": lambda x: isinstance(x, list),
        "append": lambda *a: sum((list(x) for x in a), []), "reverse": lambda x: x[::-1],
        "symbol?": lambda x: isinstance(x, Sym), "string?": lambda x: isinstance(x, str) and not isinstance(x, Sym),
        "procedure?": callable, "apply": lambda f, args: scm_call(f, list(args)),
        "map": lambda f, *ls: [scm_call(f, list(a)) for a in zip(*ls)],
        "for-each": lambda f, *ls: [scm_call(f, list(a)) for a in zip(*ls)] and None,
        "filter": lambda f, l: [x for x in l if scm_call(f, [x]) is not False],
        "reduce": lambda f, init, l: __import__("functools").reduce(lambda a, b: scm_call(f, [a, b]), l, init),
        "range": lambda a, b=None: list(range(a)) if b is None else list(range(a, b)),
        "string-append": lambda *a: "".join(a), "number->string": lambda n: scm_str(n), "string-length": len,
        "display": disp, "newline": lambda: OUT.write("\n"), "write": lambda x: OUT.write(scm_str(x)),
        "error": lambda *a: (_ for _ in ()).throw(LangError("SchemeError", " ".join(scm_str(x, True) for x in a))),
    })
    return env


def scm_call(f, args):
    if isinstance(f, Proc):
        return scm_eval(f.body, Env(f.params, args, f.env))
    return f(*args)


def scm_eval(x, env):
    while True:
        if isinstance(x, Sym):
            return env.find(x)[x]
        if not isinstance(x, list):
            return x
        if not x:
            return []
        op_, *args = x
        if op_ == "quote":
            return args[0]
        if op_ == "if":
            test = scm_eval(args[0], env)
            if test is not False:
                x = args[1]
            elif len(args) > 2:
                x = args[2]
            else:
                return None
            continue
        if op_ == "define":
            if isinstance(args[0], list):
                name, params = args[0][0], args[0][1:]
                env[name] = Proc(params, [Sym("begin")] + args[1:], env, name)
            else:
                env[args[0]] = scm_eval(args[1], env)
            return None
        if op_ == "set!":
            env.find(args[0])[args[0]] = scm_eval(args[1], env)
            return None
        if op_ == "lambda":
            return Proc(args[0], [Sym("begin")] + args[1:], env)
        if op_ == "begin":
            for e in args[:-1]:
                scm_eval(e, env)
            x = args[-1] if args else None
            continue
        if op_ in ("let", "let*"):
            if isinstance(args[0], Sym):  # let nommé
                name, binds, body = args[0], args[1], args[2:]
                loop_env = Env(outer=env)
                proc = Proc([b[0] for b in binds], [Sym("begin")] + body, loop_env, name)
                loop_env[name] = proc
                x, env = proc.body, Env(proc.params, [scm_eval(b[1], env) for b in binds], loop_env)
                continue
            new = Env(outer=env)
            for name, val in args[0]:
                new[name] = scm_eval(val, new if op_ == "let*" else env)
            x, env = [Sym("begin")] + args[1:], new
            continue
        if op_ == "cond":
            for clause in args:
                if clause[0] == "else" or scm_eval(clause[0], env) is not False:
                    x = [Sym("begin")] + clause[1:]
                    break
            else:
                return None
            continue
        if op_ == "and":
            v = True
            for e in args:
                v = scm_eval(e, env)
                if v is False:
                    return False
            return v
        if op_ == "or":
            for e in args:
                v = scm_eval(e, env)
                if v is not False:
                    return v
            return False
        f = scm_eval(op_, env)
        vals = [scm_eval(a, env) for a in args]
        if isinstance(f, Proc):
            x, env = f.body, Env(f.params, vals, f.env)
            continue
        if not callable(f):
            raise LangError("SchemeError", "%s n'est pas une procédure" % scm_str(f))
        return f(*vals)


SCHEME = {"env": None}
SCHEME_BUILTINS = set()   # les noms prédéfinis de Scheme (ils ne s'exportent pas)


def run_scheme(code):
    if SCHEME["env"] is None:
        SCHEME["env"] = scm_global()
        SCHEME_BUILTINS.update(str(k) for k in SCHEME["env"])
    tokens = scm_tokenize(code)
    result = None
    sys.setrecursionlimit(20000)
    while tokens:
        result = scm_eval(scm_read(tokens), SCHEME["env"])
    return None if result is None else scm_str(result)


# ---------------------------------------------------------------- AWK

def run_awk(code):
    m = re.match(r"^\s*#\s*input:\s*(\S+)\s*\n", code)
    # Les variables partagées que nomme le programme : des variables AWK (-v)
    args = ["awk"] + ["-v%s=%s" % (n, ("1" if v else "0") if k == "bool" else num_literal(v, k) if k == "float" else v)
                      for n, v, k in share_items("sh", code) if k in SCALAR_KINDS] + ["-f", ROOT + "/cell.awk"]
    with open(ROOT + "/cell.awk", "w") as f:
        f.write(code)
    if m:
        args.append(m.group(1))
    rc = run_process(args, cwd=SH_STATE["cwd"], env=SH_STATE["env"], stdin_data=None if m else "")
    if rc:
        ERR.write("(code de retour %d)\n" % rc)


# ---------------------------------------------------------------- C, C++, COBOL (compilés dans la machine)

TC_LINK = "/usr/local/lumen-tc"


def _real_toolchain():
    """Chemin réel de la chaîne de compilation : Tiny Core monte l'extension dans /tmp/tcloop et n'en
    met que des liens dans /usr/local. ld n'applique --sysroot qu'aux fichiers vraiment situés dessous."""
    gcc = os.path.realpath(TC_LINK + "/usr/bin/gcc")
    return gcc[:-len("/usr/bin/gcc")] if gcc.endswith("/usr/bin/gcc") else TC_LINK


TC = _real_toolchain()
RUN_NATIVE = "/usr/local/jarwebox/run-native"
BUILDS = ROOT + "/build"
CXX_HEADERS = ["iostream", "iomanip", "string", "vector", "map", "set", "unordered_map", "algorithm", "numeric",
               "cmath", "sstream", "memory", "functional", "utility", "array", "deque", "chrono"]
C_HEADERS = ["stdio.h", "stdlib.h", "string.h", "math.h", "stdbool.h", "stdint.h", "time.h"]


def toolchain_env():
    env = dict(SH_STATE["env"])
    env["PATH"] = TC + "/usr/bin:" + env.get("PATH", "/usr/bin:/bin")
    env["LD_LIBRARY_PATH"] = TC + "/hostlib"
    env.update({
        "COB_CC": "gcc --sysroot=" + TC,
        "COB_CFLAGS": "-pipe -I" + TC + "/usr/local/include -Wno-unused -fsigned-char -Wno-pointer-sign",
        "COB_LIBS": "-L" + TC + "/usr/local/lib -lcob",
        "COB_CONFIG_DIR": TC + "/usr/local/share/gnucobol/config",
        "COB_COPY_DIR": TC + "/usr/local/share/gnucobol/copy",
    })
    return env


def wrap_c_family(lang, code):
    """Une cellule sans main() devient le corps d'un main ; ses #include et using restent en tête."""
    if re.search(r"\bmain\s*\(", code):
        return code, 0
    head, body = [], []
    for line in code.split("\n"):
        (head if re.match(r"^\s*(#|using\s+namespace\b)", line) and not body else body).append(line)
    headers = CXX_HEADERS if lang == "cpp" else C_HEADERS
    prelude = ["#include <%s>" % h for h in headers] + (["using namespace std;"] if lang == "cpp" else [])
    top = prelude + head + ["int main(void) {" if lang == "c" else "int main() {"]
    return "\n".join(top + body + ["return 0;", "}"]) + "\n", len(top) - len(head)


def wrap_cobol(code):
    """Format libre par défaut ; une cellule sans PROCEDURE DIVISION devient un programme complet."""
    fixed = any(len(l) > 6 and l[6] in "*/" and l[:6].strip(" 0123456789") == "" for l in code.split("\n"))
    if re.search(r"PROCEDURE\s+DIVISION", code, re.I):
        return code, 0, fixed
    if fixed:
        code = "\n".join(l[7:] if len(l) > 7 else "" for l in code.split("\n"))
    data = re.search(r"WORKING-STORAGE\s+SECTION\.", code, re.I)
    if data:
        # « WORKING-STORAGE SECTION. … » suivi d'instructions : on sépare données et procédure
        lines = code.split("\n")
        k = 0
        for k, l in enumerate(lines):
            if k > 0 and l.strip() and not re.match(r"^\s*(\d\d|66|77|88|WORKING|LOCAL|FD|SD|COPY|\*>)", l, re.I):
                break
        # PROCEDURE DIVISION. est ajouté au bout de la dernière déclaration : les numéros de ligne restent justes
        decl = lines[:k]
        decl[-1] = decl[-1] + (" PROCEDURE DIVISION." if "*>" not in decl[-1] else "")
        if "*>" in decl[-1]:
            decl.append("PROCEDURE DIVISION.")
        prog = "IDENTIFICATION DIVISION.\nPROGRAM-ID. CELLULE.\nDATA DIVISION.\n%s\n%s\n    STOP RUN.\n" % ("\n".join(decl), "\n".join(lines[k:]))
        return prog, 3, False
    prog = "IDENTIFICATION DIVISION.\nPROGRAM-ID. CELLULE.\nPROCEDURE DIVISION.\n%s\n    STOP RUN.\n" % code
    return prog, 3, False


WARM_LOCK = __import__("threading").Lock()


def _low_priority():
    os.nice(19)


def warm(lang):
    """Compile un programme minimal en tâche de fond : le compilateur et l'en-tête précompilé passent
    dans le cache disque, sans bloquer les cellules exécutées pendant ce temps. Un seul préchauffage à la fois,
    en priorité minimale : une cellule lancée pendant ce temps a le processeur (la machine n'en a qu'un)."""
    def job():
        with WARM_LOCK:
            job_now()

    def job_now():
        t0 = time.time()
        error = None
        try:
            work = os.path.join(BUILDS, "warm-" + lang)
            os.makedirs(work, exist_ok=True)
            if lang == "go":
                # le serveur Go démarre (et charge la bibliothèque standard) avant la première cellule
                if os.path.exists(LUMEN_GO):
                    go_server()
                emit({"t": "warm", "lang": lang, "ms": int((time.time() - t0) * 1000), "error": None})
                return
            if lang in ("go", "php"):
                # l'interpréteur passe dans le cache disque
                cmd = [LUMEN_GO, "/dev/null", "/dev/null", os.path.join(work, "o.json")] if lang == "go" else [PHP, "-c", LANG_DIR + "/php/php.ini", "-r", "echo 1;"]
                r = subprocess.run(cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=_low_priority)
                emit({"t": "warm", "lang": lang, "ms": int((time.time() - t0) * 1000), "error": r.stdout.decode("utf-8", "replace")[-300:] if r.returncode else None})
                return
            if lang == "rust":
                src, cmd = "fn main() {}\n", [RUSTC, "--edition", "2018", "-C", "debuginfo=0", "-C", "prefer-dynamic", "-C", "linker=gcc",
                                                "-C", "link-arg=--sysroot=" + TC, "-C", "link-arg=-L" + glibc_links(),
                                                "-C", "link-arg=-Wl,-rpath," + LANG_DIR + "/rust/lib", "-o", "p", "w.rs"]
                name = "w.rs"
            elif lang == "cobol":
                src, cmd = "PROCEDURE DIVISION.\n    STOP RUN.\n", ["cobc", "-x", "-free", "-o", "p", "w.cob"]
                name = "w.cob"
            else:
                src, _ = wrap_c_family(lang, "")
                name = "w.cpp" if lang == "cpp" else "w.c"
                pch = ["-include", TC + "/usr/local/lumen/lumen.hpp"] if lang == "cpp" and os.path.exists(TC + "/usr/local/lumen/lumen.hpp.gch") else []
                cmd = ["g++" if lang == "cpp" else "gcc", "--sysroot=" + TC, "-O0", "-pipe"] + (["-std=gnu++17"] + pch if lang == "cpp" else []) + ["-o", "p", name]
            with open(os.path.join(work, name), "w") as f:
                f.write(src)
            r = subprocess.run(cmd, cwd=work, env=toolchain_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=_low_priority)
            if r.returncode:
                error = r.stdout.decode("utf-8", "replace")[-300:]
        except Exception as e:
            error = str(e)
        emit({"t": "warm", "lang": lang, "ms": int((time.time() - t0) * 1000), "error": error})
    import threading
    threading.Thread(target=job, daemon=True).start()


def compile_errors(text, src_name, offset, compiler):
    """Diagnostics de gcc / cobc ramenés aux lignes de la cellule."""
    lines, first = [], None
    for m in re.finditer(r"^[^\s:]*%s:(\d+):(?:(\d+):)?\s*(error|erreur|warning|note|fatal error)?(?:\[\w+\])?:?\s*(.*)$" % re.escape(src_name), text, re.M):
        n = max(1, int(m.group(1)) - offset)
        kind = (m.group(3) or "error").replace("fatal error", "error")
        msg = m.group(4).strip()
        if kind == "error" and first is None:
            first = msg
        if kind in ("error", "warning"):
            lines.append("ligne %d%s · %s%s" % (n, (", colonne " + m.group(2)) if m.group(2) else "", "" if kind == "error" else "avertissement : ", msg))
    if first is None and not lines:
        tail = [l for l in text.strip().splitlines() if l.strip()]
        first = tail[-1] if tail else "échec de la compilation"
        lines = tail[-12:]
    return LangError("CompilationError", first, lines)


def gl_runtime(source):
    """Grama Lectica : compile une fois le moteur C++ (gl_runtime.cpp) avec la chaîne des cellules C++ ;
    les programmes générés à partir des phrases s'y lient (« // flags: <ce .o> »). Rend le chemin du .o."""
    key = hashlib.sha1(source.encode("utf-8")).hexdigest()[:16]
    work = os.path.join(BUILDS, "gl-" + key)
    obj = os.path.join(work, "gl_runtime.o")
    if os.path.exists(obj):
        return obj
    os.makedirs(work, exist_ok=True)
    src = os.path.join(work, "gl_runtime.cpp")
    with open(src, "w") as f:
        f.write(source)
    flush_streams()
    emit({"t": "stage", "id": CURRENT["id"], "text": "Compilation du moteur Grama Lectica"})
    r = subprocess.run(["g++", "--sysroot=" + TC, "-std=gnu++17", "-O1", "-pipe", "-c", "-o", obj, src],
                       cwd=work, env=toolchain_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0 or not os.path.exists(obj):
        shutil.rmtree(work, ignore_errors=True)
        raise LangError("CompilationError", "le moteur Grama Lectica ne compile pas", r.stdout.decode("utf-8", "replace").splitlines()[-12:])
    return obj


# ---------------------------------------------------------------- Jonction : les variables communes à tous les langages
#
# La page tient l'espace commun (js/kernel.js, Junction). Avant une cellule, elle envoie dans « share » les variables
# que les autres langages (et les phrases du texte) ont écrites depuis ; après, le noyau lui renvoie celles du
# langage de la cellule (message « share »). Chaque valeur a sa sorte, pour que les langages typés la déclarent :
#   int, float, str, bool ; int[], float[], str[], bool[] (listes homogènes) ; list (les autres) ; fiche (un
#   dictionnaire de noms). Un langage reçoit ce qu'il sait déclarer. Un nom qu'il ne sait pas écrire (« durée » en C)
#   y prend sa forme sans accents (duree), et revient sous son nom d'origine.

SHARE = {"in": {}, "out": None, "alias": {}}
SHARE_FILE = ROOT + "/share.out"
SCALAR_KINDS = ("int", "float", "str", "bool")

KEYWORDS = {
    "c": "auto break case char const continue default do double else enum extern float for goto if inline int long "
         "register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while "
         "bool true false main printf",
    "cpp": "alignas alignof and asm auto bool break case catch char class const constexpr const_cast continue decltype "
           "default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline "
           "int long mutable namespace new noexcept not nullptr operator or private protected public register "
           "reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this "
           "throw true try typedef typeid typename union unsigned using virtual void volatile while xor main std cout cin "
           "endl string vector map",
    "rust": "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref "
            "return self Self static struct super trait true type unsafe use where while async await dyn abstract "
            "become box do final macro override priv typeof unsized virtual yield try main",
    "go": "break case chan const continue default defer else fallthrough for func go goto if import interface map "
          "package range return select struct switch type var bool int string float64 len cap append make new nil "
          "true false iota print println main",
    "java": "abstract assert boolean break byte case catch char class const continue default do double else enum "
            "extends final finally float for goto if implements import instanceof int interface long native new "
            "package private protected public return short static strictfp super switch synchronized this throw "
            "throws transient try void volatile while true false null var String System Math",
    "php": "this GLOBALS _SERVER _GET _POST _FILES _COOKIE _SESSION _REQUEST _ENV argv argc",
}
KEYWORDS = {k: set(v.split()) for k, v in KEYWORDS.items()}


def share_kind(v):
    """La sorte d'une valeur de la jonction (voir plus haut), ou None si elle n'en a pas."""
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        kinds = {share_kind(x) for x in v}
        if not v or None in kinds:
            return "list"
        if kinds == {"int"}:
            return "int[]"
        if kinds <= {"int", "float"}:
            return "float[]"
        if len(kinds) == 1 and kinds <= {"str", "bool"}:
            return kinds.pop() + "[]"
        return "list"
    if isinstance(v, dict):
        return "fiche"
    return None


def share_plain(v, depth=0):
    """Une valeur Python en donnée de la jonction (JSON : les entiers restent entiers), ou None."""
    if depth > 6 or callable(v) or type(v).__name__ == "module":
        return None
    if hasattr(v, "tolist") and type(v).__module__.split(".")[0] == "numpy":
        v = v.tolist()
    if isinstance(v, bool) or isinstance(v, str):
        return v if not isinstance(v, str) or len(v) <= 100000 else None
    if isinstance(v, int):
        return v if abs(v) < 2 ** 63 else None
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None
    if isinstance(v, (set, frozenset)):
        try:
            v = sorted(v)
        except TypeError:
            v = list(v)
    if isinstance(v, (list, tuple, range)):
        if len(v) > GL_LIMIT:
            return None
        out = [share_plain(x, depth + 1) for x in v]
        return None if any(x is None for x in out) else out
    if isinstance(v, dict) and len(v) <= 200 and all(isinstance(k, str) for k in v):
        out = {k: share_plain(x, depth + 1) for k, x in v.items()}
        return {k: x for k, x in out.items() if x is not None}
    return None


def _share_sized(v):
    e = share_entry(v)
    return (e, len(json.dumps(e["v"]))) if e is not None else (None, 0)


def share_entry(v):
    p = share_plain(v)
    k = share_kind(p) if p is not None else None
    return {"v": p, "k": k} if k else None


def share_name(name, lang):
    """Le nom d'une variable partagée dans un langage : tel quel s'il s'y écrit, sinon sans accents, sinon None."""
    if lang not in ("python", "php", "go", "java", "javascript", "scheme", "tcl") or not re.match(r"^\w+$", name):
        import unicodedata
        name2 = "".join(c for c in unicodedata.normalize("NFD", name) if unicodedata.category(c) != "Mn")
        name2 = re.sub(r"\W", "_", name2, flags=re.ASCII)
        if name2 != name:
            SHARE["alias"][name2] = name
        name = name2
    if lang == "cobol":
        if not re.match(r"^[A-Za-z][A-Za-z0-9_]*[A-Za-z0-9]$", name):
            return None
        SHARE["alias"][name.upper().replace("_", "-")] = share_original(name)
        return name.upper().replace("_", "-")
    if not re.match(r"^[A-Za-z_]\w*$" if lang not in ("python", "php", "go", "java") else r"^[^\W\d]\w*$", name):
        return None
    if name in KEYWORDS.get(lang, ()) or (lang == "python" and keyword.iskeyword(name)):
        return None
    return name


def share_original(name):
    return SHARE["alias"].get(name, name)


def share_fiche_kind(v):
    """Une fiche dont toutes les valeurs ont la même sorte simple : cette sorte (les entiers et décimaux mêlés : float)."""
    kinds = {share_kind(x) for x in v.values()}
    if not v or not kinds <= set(SCALAR_KINDS):
        return None
    if kinds <= {"int", "float"}:
        return "float" if "float" in kinds else "int"
    return kinds.pop() if len(kinds) == 1 else None


def share_items(lang, code=None, skip=()):
    """Les variables à donner à la cellule : (nom dans le langage, valeur, sorte). Avec code : celles qu'il nomme
    (un programme compilé n'est pas recompilé quand change une variable dont il ne se sert pas), sauf skip."""
    for name, e in SHARE["in"].items():
        n = share_name(name, lang)
        if n is not None and n not in skip and (code is None or used(n, code, lang)):
            yield n, share_value(e.get("v"), e.get("k")), e.get("k")


def share_value(v, k):
    """La valeur selon sa sorte : JSON (et JavaScript) ne distinguent pas 20 de 20.0, la sorte le dit."""
    try:
        if k == "float":
            return float(v)
        if k == "int":
            return int(v)
        if k == "float[]":
            return [float(x) for x in v]
        if k == "int[]":
            return [int(x) for x in v]
    except (TypeError, ValueError):
        pass
    return v


def share_read(path=SHARE_FILE):
    """Les variables exportées par un programme : une ligne « nom<TAB>sorte<TAB>JSON » par variable."""
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                name, _, rest = line.rstrip("\n").partition("\t")
                kind, _, raw = rest.partition("\t")
                try:
                    v = json.loads(raw)
                except ValueError:
                    continue
                out[share_original(name)] = {"v": v, "k": kind if kind != "list" or not isinstance(v, list) else share_kind(v) or "list"}
    except OSError:
        pass
    return out


def share_reset():
    try:
        os.unlink(SHARE_FILE)
    except OSError:
        pass


def c_string(s):
    """Un littéral de chaîne C, C++ (octal pour les caractères de contrôle : pas d'échappement \\u en C)."""
    out = []
    for ch in s:
        o = ord(ch)
        out.append({'"': '\\"', "\\": "\\\\", "\n": "\\n", "\t": "\\t", "\r": "\\r"}.get(ch) or ("\\%03o" % o if o < 32 else ch))
    return '"' + "".join(out) + '"'


def num_literal(v, kind):
    if kind == "int" or (isinstance(v, int) and not isinstance(v, bool) and kind != "float"):
        return str(int(v))
    r = repr(float(v))
    return r if ("." in r or "e" in r or "inf" in r or "nan" in r) else r + ".0"


# ---- C et C++ : variables globales en tête du programme ; à la fin du main, les variables de la cellule

CPP_TYPES = {"int": "long long", "float": "double", "str": "std::string", "bool": "bool"}
C_TYPES = {"int": "long long", "float": "double", "str": "const char *", "bool": "int"}


def cpp_literal(v, kind):
    if kind == "str":
        return c_string(v)
    if kind == "bool":
        return "true" if v else "false"
    return num_literal(v, kind)


def share_cpp_prelude(code, skip=()):
    lines = []
    add = lambda n, k, d: lines.append((n, k, d))   # (nom, sorte, déclaration)
    for name, v, k in share_items("cpp", code, skip):
        if k in CPP_TYPES:
            add(name, k, "%s %s = %s;" % (CPP_TYPES[k], name, cpp_literal(v, k)))
        elif k in ("int[]", "float[]", "str[]", "bool[]"):
            e = k[:-2]
            add(name, k, "std::vector<%s> %s = {%s};" % (CPP_TYPES[e], name, ", ".join(cpp_literal(x, e) for x in v)))
        elif k == "fiche" and share_fiche_kind(v):
            e = share_fiche_kind(v)
            add(name, k, "std::map<std::string, %s> %s = {%s};" % (CPP_TYPES[e], name, ", ".join(
                "{%s, %s}" % (c_string(a), cpp_literal(x, e)) for a, x in v.items())))
    return lines


def share_c_prelude(code, skip=()):
    lines = []
    add = lambda n, k, d: lines.append((n, k, d))   # (nom, sorte, déclaration)
    for name, v, k in share_items("c", code, skip):
        if k in C_TYPES:
            add(name, k, "%s %s = %s;" % (C_TYPES[k], name, c_string(v) if k == "str" else ("1" if v else "0") if k == "bool" else num_literal(v, k)))
        elif k in ("int[]", "float[]", "str[]") and v:
            e = k[:-2]
            lit = ", ".join(c_string(x) if e == "str" else num_literal(x, e) for x in v)
            add(name, k, "%s %s[] = {%s};" % (C_TYPES[e], name, lit))
    return lines


# L'export : une fonction par sorte de valeur. Une variable d'un type inconnu de la jonction est ignorée, sans erreur.
CPP_EXPORT = r"""
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <map>
#include <array>
#include <type_traits>
namespace lx_share {
template <class T, class = void> struct E { static bool f(std::string &, const T &, std::string &) { return false; } };
template <class T> struct E<T, typename std::enable_if<std::is_integral<T>::value && !std::is_same<T, bool>::value && !std::is_same<T, char>::value>::type> {
    static bool f(std::string &o, const T &v, std::string &k) { o += std::to_string(v); k = "int"; return true; } };
template <class T> struct E<T, typename std::enable_if<std::is_floating_point<T>::value>::type> {
    static bool f(std::string &o, const T &v, std::string &k) { if (v != v || v - v != 0) return false; char b[40]; std::snprintf(b, sizeof b, "%.17g", (double)v); std::string s = b; if (s.find_first_of(".en") == std::string::npos) s += ".0"; o += s; k = "float"; return true; } };
inline bool str(std::string &o, const std::string &s, std::string &k) {
    o += '"'; for (unsigned char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += (char)c; } else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; } else o += (char)c; }
    o += '"'; k = "str"; return true; }
template <> struct E<bool> { static bool f(std::string &o, const bool &v, std::string &k) { o += v ? "true" : "false"; k = "bool"; return true; } };
template <> struct E<char> { static bool f(std::string &o, const char &v, std::string &k) { return str(o, std::string(1, v), k); } };
template <> struct E<std::string> { static bool f(std::string &o, const std::string &v, std::string &k) { return str(o, v, k); } };
template <> struct E<const char *> { static bool f(std::string &o, const char *const &v, std::string &k) { return v && str(o, v, k); } };
template <> struct E<char *> { static bool f(std::string &o, char *const &v, std::string &k) { return v && str(o, v, k); } };
template <class It> bool seq(std::string &o, It a, It b, std::string &k) {
    o += '['; std::string kind; bool same = true, first = true;
    for (; a != b; ++a) { if (!first) o += ','; first = false; std::string k1; typename std::decay<decltype(*a)>::type x = *a;
        if (!E<decltype(x)>::f(o, x, k1)) return false; if (!kind.empty() && kind != k1) same = false; kind = k1; }
    o += ']'; k = (same && !kind.empty() && kind.find('[') == std::string::npos && kind != "list" && kind != "fiche") ? kind + "[]" : "list"; return true; }
template <class T, class A> struct E<std::vector<T, A>> { static bool f(std::string &o, const std::vector<T, A> &v, std::string &k) { return seq(o, v.begin(), v.end(), k); } };
template <class T, std::size_t N> struct E<std::array<T, N>> { static bool f(std::string &o, const std::array<T, N> &v, std::string &k) { return seq(o, v.begin(), v.end(), k); } };
template <std::size_t N> struct E<char[N]> { static bool f(std::string &o, const char (&v)[N], std::string &k) { return str(o, std::string(v), k); } };
template <class T, std::size_t N> struct E<T[N]> { static bool f(std::string &o, const T (&v)[N], std::string &k) { return seq(o, v, v + N, k); } };
template <class V, class C, class A> struct E<std::map<std::string, V, C, A>> {
    static bool f(std::string &o, const std::map<std::string, V, C, A> &m, std::string &k) {
        o += '{'; bool first = true; std::string k1;
        for (auto &p : m) { if (!first) o += ','; first = false; str(o, p.first, k1); o += ':'; if (!E<V>::f(o, p.second, k1)) return false; }
        o += '}'; k = "fiche"; return true; } };
template <class T> void put(const char *n, const T &v) {
    std::string o, k; if (!E<T>::f(o, v, k)) return;
    const char *p = std::getenv("LX_SHARE"); if (!p) return;
    if (std::FILE *f = std::fopen(p, "a")) { std::fprintf(f, "%s\t%s\t%s\n", n, k.c_str(), o.c_str()); std::fclose(f); }
}
}
""".strip("\n")

C_EXPORT = r"""
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static FILE *lx_open(void) { const char *p = getenv("LX_SHARE"); return p ? fopen(p, "a") : NULL; }
static void lx_fs(FILE *f, const char *s) { fputc('"', f); for (; *s; s++) { unsigned char c = (unsigned char)*s; if (c == '"' || c == '\\') { fputc('\\', f); fputc(c, f); } else if (c < 0x20) fprintf(f, "\\u%04x", c); else fputc(c, f); } fputc('"', f); }
static void lx_fll(FILE *f, long long v) { fprintf(f, "%lld", v); }
static void lx_fd(FILE *f, double v) { char b[40]; snprintf(b, sizeof b, "%.17g", v); fputs(b, f); if (!strpbrk(b, ".en")) fputs(".0", f); }
static void lx_put_s(const char *n, const char *v) { FILE *f = lx_open(); if (f) { fprintf(f, "%s\tstr\t", n); lx_fs(f, v); fputc('\n', f); fclose(f); } }
static void lx_put_ll(const char *n, long long v) { FILE *f = lx_open(); if (f) { fprintf(f, "%s\tint\t%lld\n", n, v); fclose(f); } }
static void lx_put_d(const char *n, double v) { FILE *f = lx_open(); if (f && v == v && v - v == 0) { fprintf(f, "%s\tfloat\t", n); lx_fd(f, v); fputc('\n', f); } if (f) fclose(f); }
static void lx_put_b(const char *n, _Bool v) { FILE *f = lx_open(); if (f) { fprintf(f, "%s\tbool\t%s\n", n, v ? "true" : "false"); fclose(f); } }
#define LX_PUT(n, x) _Generic((x), char *: lx_put_s, const char *: lx_put_s, _Bool: lx_put_b, float: lx_put_d, double: lx_put_d, long double: lx_put_d, default: lx_put_ll)(n, x)
static void lx_fe_s(FILE *f, const char *s) { lx_fs(f, s ? s : ""); }
#define LX_PUT_ARR(n, x) do { FILE *lx_f = lx_open(); if (lx_f) { size_t lx_n = sizeof(x) / sizeof((x)[0]); \
    fprintf(lx_f, "%s\t%s\t", n, _Generic((x)[0], char: "str", float: "float[]", double: "float[]", char *: "str[]", const char *: "str[]", default: "int[]")); \
    if (_Generic((x)[0], char: 1, default: 0)) lx_fs(lx_f, (const char *)(void *)(x)); else { fputc('[', lx_f); \
    for (size_t lx_i = 0; lx_i < lx_n; lx_i++) { if (lx_i) fputc(',', lx_f); _Generic((x)[0], char: lx_fll, float: lx_fd, double: lx_fd, char *: lx_fe_s, const char *: lx_fe_s, default: lx_fll)(lx_f, (x)[lx_i]); } \
    fputc(']', lx_f); } fputs("\n", lx_f); fclose(lx_f); } } while (0)
""".strip("\n")


def top_statements(body):
    """Les instructions de premier niveau d'un corps de fonction (C, C++, Java, Rust) : (texte, ligne de fin).
    Chaînes, caractères et commentaires sont sautés ; une instruction finit à « ; » ou à l'accolade qui ferme un bloc."""
    out, depth, start, i, n, line = [], 0, 0, 0, len(body), 1
    paren = 0
    while i < n:
        c = body[i]
        if c == "\n":
            line += 1
        if body.startswith("//", i):
            j = body.find("\n", i)
            i = n if j < 0 else j
            continue
        if body.startswith("/*", i):
            j = body.find("*/", i + 2)
            line += body[i:(n if j < 0 else j)].count("\n")
            i = n if j < 0 else j + 2
            continue
        if c in "\"'" and not (c == "'" and re.match(r"'[A-Za-z_]\w*(?!')", body[i:i + 40])):
            j = i + 1
            while j < n and body[j] != c:
                j += 2 if body[j] == "\\" else 1
            line += body[i:j].count("\n")
            i = j + 1
            continue
        if c in "([":
            paren += 1
        elif c in ")]":
            paren -= 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and paren == 0:
                out.append((body[start:i + 1], line))
                start = i + 1
        elif c == ";" and depth == 0 and paren == 0:
            out.append((body[start:i], line))
            start = i + 1
        i += 1
    return out


NOT_TYPES = {"return", "delete", "throw", "goto", "case", "else", "do", "new", "using", "typedef", "namespace", "if",
             "for", "while", "switch", "break", "continue", "struct", "class", "enum", "union", "template", "public",
             "private", "protected", "friend", "operator", "co_return", "co_yield", "yield", "assert", "throws", "import",
             "package", "try", "catch", "finally", "synchronized", "default"}


def split_top(text, sep=","):
    parts, depth, cur = [], 0, ""
    for ch in text:
        if ch in "([{<":
            depth += 1
        elif ch in ")]}>":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def declared_names(body, lang):
    """Les variables déclarées au premier niveau d'une cellule : [(nom, est un tableau C)]."""
    names = []
    for stmt, _ in top_statements(body):
        s = re.sub(r"//[^\n]*|/\*.*?\*/", " ", stmt, flags=re.S).strip()
        if not s:
            continue
        if lang == "rust":
            m = re.match(r"^let\s+(?:mut\s+)?([A-Za-z_]\w*)\b", s)
            if m:
                names.append((m.group(1), False))
            continue
        m = re.match(r"^((?:(?:const|static|final|volatile|unsigned|signed|long|short|constexpr|register)\s+)*)"
                     r"((?:std::|java\.util\.)?[A-Za-z_]\w*(?:\s*<[^;=(){}]*>)?(?:\s*\[\s*\])*(?:\s*::\s*\w+)*)"
                     r"((?:\s*[*&]+\s*|\s+))([A-Za-z_]\w*)(.*)$", s, re.S)
        if not m or m.group(2).split("<")[0].strip() in NOT_TYPES or m.group(4) in NOT_TYPES:
            continue
        rest = m.group(4) + m.group(5)
        if lang in ("c", "cpp") and "*" in m.group(3) and not re.match(r"^(const\s+)?char$", (m.group(1) + m.group(2)).replace("const ", "").strip()):
            continue   # un pointeur (autre qu'une chaîne C) n'est pas une donnée
        for d in split_top(rest):
            dm = re.match(r"^\s*[*&]*\s*([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(=|\{|\(|$)", d, re.S)
            if dm and (dm.group(3) != "(" or lang == "cpp"):
                if dm.group(3) == "(" and re.match(r"^\s*\)", d[dm.end():]):
                    continue   # « T f(); » : une déclaration de fonction
                names.append((dm.group(1), bool(dm.group(2))))
    seen, out = set(), []
    for n, arr in names:
        if n not in seen:
            seen.add(n)
            out.append((n, arr))
    return out


def export_lines(body, lang, given):
    """Les lignes ajoutées à la fin de la cellule : chaque variable de premier niveau, plus les variables données."""
    names = declared_names(body, lang)
    known = {n for n, _ in names}
    names += [(n, lang == "c" and arr) for n, arr in given if n not in known]
    lines = []
    for n, arr in names:
        if lang == "cpp":
            lines.append('lx_share::put("%s", %s);' % (n, n))
        elif lang == "c":
            lines.append(('LX_PUT_ARR("%s", %s);' if arr else 'LX_PUT("%s", %s);') % (n, n))
        elif lang == "rust":
            lines.append('(&&&__lx::W(&%s)).lx_put("%s");' % (n, n))
        elif lang == "java":
            lines.append('System.getProperties().put("lx.share.%s", (Object) %s);' % (n, n))
    return lines


def epilogue_errors(text, src_name, first, last):
    """Les lignes ajoutées (first..last, dans le fichier compilé) où le compilateur signale une erreur."""
    bad = set()
    for m in re.finditer(r"%s:(\d+):(?:\d+:)?\s*(?:error|erreur|fatal error)" % re.escape(src_name), text):
        k = int(m.group(1))
        if first <= k <= last:
            bad.add(k)
    for m in re.finditer(r"-->\s*%s:(\d+):" % re.escape(src_name), text):
        k = int(m.group(1))
        if first <= k <= last:
            bad.add(k)
    return bad


# ---- Rust

RUST_PRELUDE = r"""
#![allow(unused)]
mod __lx {
    use std::io::Write;
    pub trait Share { fn lx(&self, o: &mut String) -> Option<String>; }
    macro_rules! ints { ($($t:ty)*) => { $(impl Share for $t { fn lx(&self, o: &mut String) -> Option<String> { o.push_str(&self.to_string()); Some("int".into()) } })* } }
    ints!(i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize);
    impl Share for f64 { fn lx(&self, o: &mut String) -> Option<String> { if !self.is_finite() { return None; } o.push_str(&format!("{:?}", self)); Some("float".into()) } }
    impl Share for f32 { fn lx(&self, o: &mut String) -> Option<String> { (*self as f64).lx(o) } }
    impl Share for bool { fn lx(&self, o: &mut String) -> Option<String> { o.push_str(if *self { "true" } else { "false" }); Some("bool".into()) } }
    impl Share for char { fn lx(&self, o: &mut String) -> Option<String> { self.to_string().lx(o) } }
    impl Share for str { fn lx(&self, o: &mut String) -> Option<String> { o.push('"'); for c in self.chars() { match c { '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)), c => o.push(c) } } o.push('"'); Some("str".into()) } }
    impl Share for String { fn lx(&self, o: &mut String) -> Option<String> { self.as_str().lx(o) } }
    impl<'a, T: Share + ?Sized> Share for &'a T { fn lx(&self, o: &mut String) -> Option<String> { (**self).lx(o) } }
    impl<T: Share> Share for [T] {
        fn lx(&self, o: &mut String) -> Option<String> {
            o.push('['); let mut kind: Option<String> = None; let mut same = true;
            for (i, x) in self.iter().enumerate() { if i > 0 { o.push(','); } let k = x.lx(o)?; if kind.as_ref().map_or(false, |p| *p != k) { same = false; } kind = Some(k); }
            o.push(']');
            Some(match kind { Some(k) if same && !k.ends_with(']') && k != "list" && k != "fiche" => k + "[]", _ => "list".into() })
        }
    }
    impl<T: Share> Share for Vec<T> { fn lx(&self, o: &mut String) -> Option<String> { self.as_slice().lx(o) } }
    macro_rules! maps { ($($m:ident)*) => { $(impl<V: Share> Share for std::collections::$m<String, V> {
        fn lx(&self, o: &mut String) -> Option<String> { o.push('{'); for (i, (k, v)) in self.iter().enumerate() { if i > 0 { o.push(','); } k.lx(o)?; o.push(':'); v.lx(o)?; } o.push('}'); Some("fiche".into()) } })* } }
    maps!(HashMap BTreeMap);
    pub fn put<T: Share + ?Sized>(n: &str, v: &T) {
        let mut o = String::new();
        if let Some(k) = v.lx(&mut o) {
            if let Ok(p) = std::env::var("LX_SHARE") {
                if let Ok(mut f) = std::fs::OpenOptions::new().append(true).create(true).open(p) { let _ = writeln!(f, "{}\t{}\t{}", n, k, o); }
            }
        }
    }
    pub struct W<'a, T: ?Sized>(pub &'a T);
    pub trait Yes { fn lx_put(&self, n: &str); }
    impl<'a, T: Share + ?Sized> Yes for &&W<'a, T> { fn lx_put(&self, n: &str) { put(n, self.0) } }
    pub trait No { fn lx_put(&self, n: &str); }
    impl<'a, T: ?Sized> No for &W<'a, T> { fn lx_put(&self, _: &str) {} }
}
use __lx::{Yes as _, No as _};
""".strip("\n")

RUST_TYPES = {"int": "i64", "float": "f64", "str": "String", "bool": "bool"}


def rust_string(s):
    out = []
    for ch in s:
        o = ord(ch)
        out.append({'"': '\\"', "\\": "\\\\", "\n": "\\n", "\t": "\\t", "\r": "\\r"}.get(ch) or ("\\u{%x}" % o if o < 32 else ch))
    return '"' + "".join(out) + '"'


def rust_literal(v, kind):
    if kind == "str":
        return "String::from(%s)" % rust_string(v)
    if kind == "bool":
        return "true" if v else "false"
    return num_literal(v, kind)


def share_rust_lets(code, skip=()):
    lines = []
    add = lambda n, k, d: lines.append((n, k, d))   # (nom, sorte, déclaration)
    for name, v, k in share_items("rust", code, skip):
        if k in RUST_TYPES:
            add(name, k, "let mut %s: %s = %s;" % (name, RUST_TYPES[k], rust_literal(v, k)))
        elif k in ("int[]", "float[]", "str[]", "bool[]"):
            e = k[:-2]
            add(name, k, "let mut %s: Vec<%s> = vec![%s];" % (name, RUST_TYPES[e], ", ".join(rust_literal(x, e) for x in v)))
        elif k == "fiche" and share_fiche_kind(v):
            e = share_fiche_kind(v)
            add(name, k, "let mut %s: std::collections::HashMap<String, %s> = vec![%s].into_iter().collect();" % (
                name, RUST_TYPES[e], ", ".join("(String::from(%s), %s)" % (rust_string(a), rust_literal(x, e)) for a, x in v.items())))
    return lines


# ---- Go (lumen-go) : les variables partagées deviennent des variables globales de la console Go

GO_TYPES = {"int": "int", "float": "float64", "str": "string", "bool": "bool"}


def go_literal(v, kind):
    if kind == "str":
        return json.dumps(v, ensure_ascii=False)
    if kind == "bool":
        return "true" if v else "false"
    return num_literal(v, kind)


def go_value(v, depth=0):
    """Une valeur quelconque (liste mêlée, fiche) en littéral Go de type interface{}."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return num_literal(v, "int" if isinstance(v, int) else "float")
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[]interface{}{%s}" % ", ".join(go_value(x, depth + 1) for x in v)
    if isinstance(v, dict):
        return "map[string]interface{}{%s}" % ", ".join("%s: %s" % (json.dumps(k, ensure_ascii=False), go_value(x, depth + 1)) for k, x in v.items())
    return "nil"


def share_go_prelude(code):
    lines = []
    for name, v, k in share_items("go", code):
        if k in GO_TYPES:
            t = "int64" if k == "int" and abs(v) >= 2 ** 31 else GO_TYPES[k]
            lines.append("var %s %s = %s" % (name, t, go_literal(v, k)))
        elif k in ("int[]", "float[]", "str[]", "bool[]"):
            e = k[:-2]
            t = "int64" if e == "int" and any(abs(x) >= 2 ** 31 for x in v) else GO_TYPES[e]
            lines.append("var %s = []%s{%s}" % (name, t, ", ".join(go_literal(x, e) for x in v)))
        elif k == "fiche" and share_fiche_kind(v):
            e = share_fiche_kind(v)
            lines.append("var %s = map[string]%s{%s}" % (name, GO_TYPES[e], ", ".join(
                "%s: %s" % (json.dumps(a, ensure_ascii=False), go_literal(x, e)) for a, x in v.items())))
        else:
            lines.append("var %s interface{} = %s" % (name, go_value(v)))
    return lines


# ---- PHP : les variables partagées en tête du script (sur la première ligne : les numéros de ligne restent justes)

def php_quote(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def share_php_prelude(code):
    """Les variables partagées que nomme la cellule, déclarées dans le lanceur (variables globales)."""
    parts = []
    for name, v, k in share_items("php", code):
        raw = num_literal(v, "float") if k == "float" else json.dumps(v, ensure_ascii=False)
        parts.append("$%s = json_decode(%s, true);" % (name, php_quote(raw)))
    return "\n".join(parts)


def share_from_json(path):
    """Les variables écrites en un seul objet JSON (PHP, Go) : {nom: valeur} ou {nom: {"v", "k"}}."""
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    for name, v in data.items():
        if isinstance(v, dict) and set(v) == {"v", "k"}:
            if v["k"]:
                out[share_original(name)] = v
            continue
        if isinstance(v, dict) and v and all(isinstance(i, str) and i.isdigit() for i in v):
            v = [v[i] for i in sorted(v, key=int)]   # un tableau PHP aux clés numériques : une liste
        e = share_entry(v)
        if e:
            out[share_original(name)] = e
    return out


# ---- COBOL : des données de WORKING-STORAGE (sur une ligne, format libre) ; à la fin, un DISPLAY marqué par variable

COBOL_RESERVED = set()


def cobol_reserved():
    if not COBOL_RESERVED:
        try:
            r = subprocess.run(["cobc", "--list-reserved"], env=toolchain_env(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            for line in r.stdout.decode("utf-8", "replace").splitlines():
                w = line.split()
                if w and re.match(r"^[A-Z][A-Z0-9-]*$", w[0]):
                    COBOL_RESERVED.add(w[0])
        except Exception:
            pass
        COBOL_RESERVED.add("-")
    return COBOL_RESERVED


def cobol_items(code):
    """Les données élémentaires de niveau 01 ou 77 déclarées par la cellule : [(nom, sorte)]."""
    out = []
    for m in re.finditer(r"(?im)^\s*(?:01|77)\s+([A-Z0-9][A-Z0-9-]*)\s+PIC(?:TURE)?\s+(?:IS\s+)?(\S+)", code):
        pic = m.group(2).upper().rstrip(".")
        kind = "str" if "X" in pic or "A" in pic else "float" if "V" in pic else "int"
        out.append((m.group(1).upper(), kind))
    return out


def share_cobol_items(code):
    declared = {n for n, _ in cobol_items(code)}
    reserved = cobol_reserved()
    parts, given = [], []
    for name, v, k in share_items("cobol", code):
        if name in declared or name in reserved:
            continue
        if k == "int" and abs(v) < 10 ** 18:
            parts.append("01 %s PIC S9(18) VALUE %d." % (name, v))
        elif k == "float" and abs(v) < 10 ** 12:
            parts.append("01 %s PIC S9(12)V9(6) VALUE %s." % (name, ("%.6f" % v).rstrip("0").rstrip(".")))
        elif k == "str" and '"' not in v and "\n" not in v:
            b = len(v.encode("utf-8"))
            parts.append('01 %s PIC X(%d) VALUE "%s".' % (name, max(1, b), v) if v else "01 %s PIC X(1) VALUE SPACE." % name)
        else:
            continue
        given.append((name, k))
    return " ".join(parts), given


COBOL_MARK = "\x01LXS\t"


def cobol_export(items):
    return "\n".join('DISPLAY X"01" "LXS" X"09" "%s" X"09" "%s" X"09" %s' % (n, k, n) for n, k in items)


def cobol_value(raw, kind):
    t = raw.strip()
    if kind == "str":
        return raw.rstrip()
    try:
        x = float(t.replace(",", "."))
    except ValueError:
        return None
    return int(x) if kind == "int" else x


def used(name, code, lang):
    """La cellule nomme-t-elle cette variable ? Seules celles-là lui sont données (moins de recompilations)."""
    if lang == "cobol":
        return re.search(r"(?<![\w-])%s(?![\w-])" % re.escape(name), code, re.I) is not None
    if lang == "php":
        return re.search(r"\$%s(?!\w)" % re.escape(name), code) is not None
    return re.search(r"(?<![\w$])%s(?!\w)" % re.escape(name), code) is not None


def share_used(code, lang):
    """Les variables partagées que nomme la cellule, sous leur nom dans le langage."""
    return {n for n, _, _ in share_items(lang) if used(n, code, lang)}


# ---- Langages à état (Python, Tcl, Scheme, shell) : les variables partagées entrent dans leur espace de noms

def tcl_text(v):
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, float):
        return num_literal(v, "float")
    if isinstance(v, list):
        return tuple(tcl_text(x) for x in v)
    return str(v)


def share_into(lang, code):
    if not SHARE["in"]:
        return
    if lang == "python":
        for name, v, k in share_items("python"):
            NS[name] = v
    elif lang == "tcl":
        t = tcl_interp()
        for name, v, k in share_items("tcl"):
            try:
                if k == "fiche":
                    t.eval("unset -nocomplain %s" % name)
                    flat = []
                    for a, x in v.items():
                        flat += [a, tcl_text(x)]
                    t.call("array", "set", name, tuple(flat))
                else:
                    t.call("set", name, tcl_text(v))
            except Exception:
                pass
    elif lang == "scheme":
        if SCHEME["env"] is None:
            SCHEME["env"] = scm_global()
            SCHEME_BUILTINS.update(str(k) for k in SCHEME["env"])
        for name, v, k in share_items("scheme"):
            if k != "fiche" and name not in SCHEME_BUILTINS:
                SCHEME["env"][Sym(name)] = v
    elif lang in ("sh", "awk"):
        for name, v, k in share_items("sh"):
            if k in SCALAR_KINDS:
                SH_STATE["env"][name] = ("true" if v else "false") if k == "bool" else num_literal(v, k) if k == "float" else str(v)
            elif k.endswith("[]"):
                SH_STATE["env"][name] = " ".join(num_literal(x, "float") if isinstance(x, float) else str(x) for x in v)


def text_entry(text):
    """Une valeur venue d'un langage où tout est texte (Tcl, shell) : nombre entier, décimal, ou texte."""
    t = text.strip()
    if re.match(r"^-?\d+$", t) and abs(int(t)) < 2 ** 63:
        return {"v": int(t), "k": "int"}
    if re.match(r"^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$", t):
        return {"v": float(t), "k": "float"}
    return {"v": text, "k": "str"}


def share_out(lang):
    """Les variables du langage de la cellule, pour la jonction."""
    out = {}
    if lang == "python":
        size = 0
        for k in user_vars():
            v = NS[k]
            if callable(v) or type(v).__name__ == "module":
                continue
            e, n = converted("share", k, v, _share_sized)
            if e is None:
                continue
            if size + n > GL_BUDGET:
                continue
            out[k], size = e, size + n
    elif lang == "tcl" and TCL["interp"] is not None:
        t = TCL["interp"]
        for name, v in gl_langs().get("tcl", {}).items():
            try:
                if isinstance(v, dict) and "$fiche" in v:
                    kv = t.splitlist(t.eval("array get %s" % name))
                    out[name] = {"v": {kv[i]: text_entry(kv[i + 1])["v"] for i in range(0, len(kv) - 1, 2)}, "k": "fiche"}
                    continue
                raw = t.getvar(name)
                raw = raw if isinstance(raw, str) else str(raw)
                items = t.splitlist(raw)
                es = [text_entry(x) for x in items]
                if len(items) > 1 and all(e["k"] in ("int", "float") for e in es):
                    vals = [e["v"] for e in es]
                    out[name] = {"v": vals, "k": share_kind(vals)}
                else:
                    out[name] = text_entry(raw)
            except Exception:
                pass
    elif lang == "scheme" and SCHEME["env"] is not None:
        for k, v in SCHEME["env"].items():
            name = str(k)
            if name in SCHEME_BUILTINS or callable(v) or isinstance(v, Proc):
                continue
            e = share_entry(scm_plain(v))
            if e:
                out[name] = e
    elif lang in ("sh", "awk"):
        for k, v in SH_STATE["env"].items():
            if k not in ENV0 and re.match(r"^[A-Za-z_]\w*$", k):
                out[share_original(k)] = text_entry(v)
    elif SHARE["out"]:
        out = SHARE["out"]
    return out


# ---- Les programmes compilés : la source avec les variables reçues et l'export, puis la compilation

STD_NAMES = set("count max min distance size data begin end find sort swap move copy fill next prev list set array pair "
                "tuple function hash less greater plus minus abs sqrt pow exp log floor ceil round accumulate reverse "
                "transform remove unique merge partition rotate search equal any_of all_of none_of iota left right "
                "hex dec oct fixed ws ref bind arg real imag norm polar".split())


def c_family_source(lang, code, share, drop):
    """Source C ou C++ d'une cellule : (texte, décalage des lignes, lignes des variables reçues, lignes de l'export).
    Sans main(), la cellule devient le corps d'un main : les variables reçues y sont déclarées en premier (des
    variables locales : pas de conflit avec std::count…), et ses variables de premier niveau exportées à la fin."""
    if re.search(r"\bmain\s*\(", code):
        skip = STD_NAMES if lang == "cpp" else ()
        pre = [d for _, _, d in ((share_cpp_prelude(code, skip) if lang == "cpp" else share_c_prelude(code, skip)) if share else [])]
        # les en-têtes que demandent les variables reçues, et seulement eux : <string>, <vector> et <map> pèsent
        # près d'un Mo une fois développés, des dizaines de secondes de compilation dans la machine émulée
        need = [h for h in ("string", "vector", "map") if any(re.search(r"\b%s\b" % h, d) for d in pre)] if lang == "cpp" else []
        head = ["#include <%s>" % h for h in need] + pre
        return "\n".join(head + [code]) + "\n", len(head), (1, len(head)) if head else None, None
    head, body = [], []
    for line in code.split("\n"):
        (head if re.match(r"^\s*(#|using\s+namespace\b)", line) and not body else body).append(line)
    text = "\n".join(body)
    own = {n for n, _ in declared_names(text, lang)}
    decl = ((share_cpp_prelude(code, own) if lang == "cpp" else share_c_prelude(code, own)) if share else [])
    pre = [d for _, _, d in decl]
    given = [(n, k.endswith("[]")) for n, k, _ in decl]
    kept = [(i, l) for i, l in enumerate(export_lines(text, lang, given)) if i not in drop] if share else []
    exports = [l for _, l in kept]
    headers = CXX_HEADERS if lang == "cpp" else C_HEADERS
    top = ["#include <%s>" % h for h in headers] + (["using namespace std;"] if lang == "cpp" else []) + head
    if exports:
        top += (CPP_EXPORT if lang == "cpp" else C_EXPORT).split("\n")
    top.append("int main(void) {" if lang == "c" else "int main() {")
    if pre:
        top.append(" ".join(pre))
    lines = top + body
    epi = (len(lines) + 1, len(lines) + len(exports), [i for i, _ in kept]) if exports else None
    src = "\n".join(lines + exports + ["return 0;", "}"]) + "\n"
    return src, len(top) - len(head), (len(top), len(top)) if pre else None, epi


def rust_source(code, share, drop):
    pre = RUST_PRELUDE.split("\n")
    m = re.search(r"\bfn\s+main\s*\(\s*\)\s*(?:->\s*[^{]+)?\{", code)
    if m:
        lets = [d for _, _, d in share_rust_lets(code)] if share else []
        src = code[:m.end()] + (" " + " ".join(lets) if lets else "") + code[m.end():]
        k = len(pre) + code[:m.end()].count("\n") + 1
        return "\n".join(pre + [src]) + "\n", len(pre), (k, k) if lets else None, None
    own = {n for n, _ in declared_names(code, "rust")}
    decl = share_rust_lets(code, own) if share else []
    lets = [d for _, _, d in decl]
    given = [(n, False) for n, _, _ in decl]
    kept = [(i, l) for i, l in enumerate(export_lines(code, "rust", given)) if i not in drop] if share else []
    exports = [l for _, l in kept]
    top = pre + ["fn main() {"] + ([" ".join(lets)] if lets else [])
    body = code.split("\n")
    epi = (len(top) + len(body) + 1, len(top) + len(body) + len(exports), [i for i, _ in kept]) if exports else None
    return "\n".join(top + body + exports + ["}"]) + "\n", len(top), (len(top), len(top)) if lets else None, epi


def compile_cell(lang, code, flags):
    """Compile une cellule (C, C++, COBOL, Rust) dans son dossier de travail ; rend le chemin de l'exécutable.
    Une ligne ajoutée par la jonction qui ne compile pas (une variable déplacée en Rust…) est retirée, puis
    toute la jonction si la cellule ne compile toujours pas : seules les erreurs de la cellule s'affichent."""
    share, drop, cobol_given = True, set(), []
    for attempt in range(4):
        fixed = False
        if lang == "cobol":
            src, offset, fixed = wrap_cobol(code)
            pre_r = epi = None
            if share and not fixed:
                src, offset, pre_r, epi, cobol_given = cobol_share(src, offset, code)
            ext = "cob"
        elif lang == "rust":
            src, offset, pre_r, epi = rust_source(code, share, drop)
            ext = "rs"
        else:
            src, offset, pre_r, epi = c_family_source(lang, code, share, drop)
            ext = "cpp" if lang == "cpp" else "c"
        key = hashlib.sha1((lang + "\0" + " ".join(flags) + "\0" + src).encode("utf-8")).hexdigest()[:16]
        work = os.path.join(BUILDS, key)
        exe = os.path.join(work, "programme")
        name = "cellule." + ext
        if os.path.exists(exe):
            emit({"t": "stage", "id": CURRENT["id"], "text": "Déjà compilé"})
            SHARE["cobol"] = cobol_given
            return exe
        os.makedirs(work, exist_ok=True)
        with open(os.path.join(work, name), "w") as f:
            f.write(src if src.endswith("\n") else src + "\n")
        if lang == "cpp":
            # En-tête précompilé (iostream, vector, map…) : la bibliothèque standard n'est pas relue à chaque cellule
            pch = TC + "/usr/local/lumen/lumen.hpp"
            pre = ["-include", pch] if os.path.exists(pch + ".gch") and not any(f.startswith("-std") or f.startswith("-O") for f in flags) else []
            cmd = ["g++", "--sysroot=" + TC, "-std=gnu++17", "-O0", "-pipe"] + pre + ["-o", "programme", name] + flags
        elif lang == "c":
            cmd = ["gcc", "--sysroot=" + TC, "-std=gnu11", "-O0", "-pipe", "-o", "programme", name, "-lm"] + flags
        elif lang == "rust":
            # Liée dynamiquement à la bibliothèque standard (libstd-….so de lumen-lang) : l'édition des liens est
            # bien plus légère qu'avec la bibliothèque statique, en temps comme en mémoire
            # Une seule unité de compilation (la machine n'a qu'un processeur), et la compilation incrémentale : les
            # cellules s'appellent toutes « cellule », rustc reprend ce qui n'a pas changé (la jonction, les
            # fonctions inchangées) — une cellule modifiée se recompile deux fois plus vite
            cmd = [RUSTC, "--edition", "2018", "--error-format=short", "-C", "opt-level=0", "-C", "debuginfo=0", "-C", "prefer-dynamic",
                   "-C", "codegen-units=1", "-C", "incremental=" + os.path.join(BUILDS, "rust-incremental"),
                   "-C", "linker=gcc", "-C", "link-arg=--sysroot=" + TC, "-C", "link-arg=-L" + glibc_links(),
                   "-C", "link-arg=-Wl,-rpath," + LANG_DIR + "/rust/lib", "-o", "programme", name] + flags
        else:
            cmd = ["cobc", "-x", "-fixed" if fixed else "-free", "-o", "programme", name] + flags
        t0 = time.time()
        flush_streams()
        emit({"t": "stage", "id": CURRENT["id"], "text": "Compilation"})
        env = toolchain_env()
        if lang == "rust":
            env["PATH"] = LANG_DIR + "/rust/bin:" + env["PATH"]
        r = subprocess.run(cmd, cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        out = r.stdout.decode("utf-8", "replace")
        if r.returncode != 0 or not os.path.exists(exe):
            shutil.rmtree(work, ignore_errors=True)
            bad = epilogue_errors(out, name, epi[0], epi[1]) if epi else set()
            if bad:
                drop |= {epi[2][k - epi[0]] for k in bad}
                if lang == "cobol":
                    share = False
                continue
            if share and (pre_r or epi):
                share = False
                continue
            raise compile_errors(out, name, offset, cmd[0])
        if "warning" in out:
            # les avertissements des lignes de la cellule (pas de celles qu'ajoute la jonction)
            last = code.count("\n") + 1
            notes = [l for l in compile_errors(out, name, offset, cmd[0]).tb
                     if (lambda m: m and 1 <= int(m.group(1)) <= last)(re.match(r"^ligne (\d+)", l))]
            if notes:
                ERR.write("\n".join(notes) + "\n")
        emit({"t": "stage", "id": CURRENT["id"], "text": "Compilé en %.1f s" % (time.time() - t0)})
        SHARE["cobol"] = cobol_given
        return exe
    raise LangError("CompilationError", "échec de la compilation")


def cobol_share(src, offset, code):
    """Les variables reçues entrent dans WORKING-STORAGE (sur une ligne existante : les numéros restent justes) ;
    avant le STOP RUN ajouté à la cellule, un DISPLAY marqué par donnée l'exporte."""
    items, given = share_cobol_items(code)
    lines = src.split("\n")
    pre_r = epi = None
    if items:
        for k, l in enumerate(lines):
            m = re.search(r"WORKING-STORAGE\s+SECTION\.", l, re.I)
            if m:
                lines[k] = l[:m.end()] + " " + items + l[m.end():]
                pre_r = (k + 1, k + 1)
                break
            m = re.search(r"PROCEDURE\s+DIVISION", l, re.I)
            if m:
                data = "" if any(re.search(r"DATA\s+DIVISION\.", x, re.I) for x in lines[:k]) else "DATA DIVISION. "
                lines[k] = l[:m.start()] + data + "WORKING-STORAGE SECTION. " + items + " " + l[m.start():]
                pre_r = (k + 1, k + 1)
                break
    export = [(n, k) for n, k in cobol_items(code)] + given
    seen, ex = set(), []
    for n, k in export:
        if n not in seen:
            seen.add(n)
            ex.append((n, k))
    if ex and lines and re.match(r"^\s*STOP RUN\.\s*$", lines[-2] if lines[-1] == "" else lines[-1]):
        at = len(lines) - (2 if lines[-1] == "" else 1)
        lines.insert(at, cobol_export(ex))
        epi = (at + 1, at + 1, [0])
    return "\n".join(lines), offset, pre_r, epi, ex


LANG_DIR = "/usr/local/lumen-lang"


def glibc_links():
    """Les liens de développement libdl.so, librt.so, libpthread.so de la racine de compilation pointent vers
    /lib/i386-linux-gnu (le chemin de Debian), absent de la machine ; rustc les demande. Ce dossier les refait,
    vers les bibliothèques de la chaîne de compilation. Rend son chemin (pour -L)."""
    d = ROOT + "/glibc-links"
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
        for name, so in (("libdl.so", "libdl.so.2"), ("librt.so", "librt.so.1"), ("libpthread.so", "libpthread.so.0"),
                         ("libutil.so", "libutil.so.1"), ("libm.so", "libm.so.6")):
            target = os.path.join(TC, "lib/i386-linux-gnu", so)
            if os.path.exists(target):
                try:
                    os.symlink(target, os.path.join(d, name))
                except OSError:
                    pass
    return d
RUSTC = LANG_DIR + "/rust/bin/rustc"
PHP = LANG_DIR + "/php/bin/php"
LUMEN_GO = LANG_DIR + "/go/lumen-go"


def run_compiled(lang, code):
    if not os.path.isdir(TC):
        raise LangError("CompilerMissing", "les compilateurs ne sont pas dans cette image de la machine")
    if lang == "rust" and not os.path.exists(RUSTC):
        raise LangError("CompilerMissing", "Rust n'est pas dans cette image de la machine")
    os.makedirs(BUILDS, exist_ok=True)
    flags = []
    m = re.match(r"^\s*(?://|\*>)\s*flags?\s*:\s*(.*)\n", code)
    if m:
        flags = m.group(1).split()
    SHARE["cobol"] = []
    exe = compile_cell(lang, code, flags)
    share_reset()
    env = dict(SH_STATE["env"], LX_SHARE=SHARE_FILE)
    if lang == "cobol" and SHARE["cobol"]:
        rc, marked = run_process([RUN_NATIVE, exe], cwd=SH_STATE["cwd"], env=env, mark=COBOL_MARK)
        out = {}
        for line in marked:
            name, _, rest = line.partition("\t")
            kind, _, raw = rest.partition("\t")
            v = cobol_value(raw, kind)
            if v is not None:
                out[SHARE["alias"].get(name, name.lower().replace("-", "_"))] = {"v": v, "k": kind}
        SHARE["out"] = out
    else:
        rc = run_process([RUN_NATIVE, exe], cwd=SH_STATE["cwd"], env=env)
        SHARE["out"] = share_read()
    if rc:
        ERR.write("(code de retour %d)\n" % rc)


# Go : lumen-go reste en marche (la bibliothèque standard, des milliers de symboles, ne se charge qu'une fois ; chaque
# cellule a son propre interpréteur). Les requêtes passent par un tube à part, les sorties par sa sortie standard.
GO = {"p": None, "w": None, "lock": __import__("threading").Lock()}
GO_END = b"\x01LXGOEND\t"


def go_server():
    with GO["lock"]:
        p = GO["p"]
        if p is None or p.poll() is not None:
            r, w = os.pipe()
            p = subprocess.Popen([LUMEN_GO, "--serve", str(r)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, cwd=WORK, env=SH_STATE["env"], pass_fds=(r,), start_new_session=True)
            os.close(r)
            GO["p"], GO["w"] = p, os.fdopen(w, "wb", buffering=0)
        return p


def go_stop():
    p = GO["p"]
    GO["p"] = None
    if p is not None:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except Exception:
            p.kill()


def go_cell(req):
    """Exécute une cellule dans lumen-go résident ; diffuse sa sortie ; rend son code de retour."""
    p = go_server()
    CHILD["p"] = p
    try:
        GO["w"].write((json.dumps(req) + "\n").encode("utf-8"))
        fd = p.stdout.fileno()
        dec = __import__("codecs").getincrementaldecoder("utf-8")("replace")
        held = b""
        while True:
            chunk = os.read(fd, 4096)
            if not chunk:
                # le serveur s'est arrêté (os.Exit dans la cellule) : il redémarrera à la prochaine
                OUT.write(dec.decode(held, final=True))
                GO["p"] = None
                return p.wait() or 1
            held += chunk
            k = held.find(GO_END)
            if k >= 0:
                OUT.write(dec.decode(held[:k], final=True))
                rest = held[k + len(GO_END):]
                while b"\n" not in rest:
                    more = os.read(fd, 64)
                    if not more:
                        break
                    rest += more
                try:
                    return int(rest.split(b"\n")[0])
                except ValueError:
                    return 1
            # une marque peut commencer à la fin du morceau : on garde ce qui pourrait en être le début
            keep = next((n for n in range(min(len(GO_END) - 1, len(held)), 0, -1) if GO_END.startswith(held[-n:])), 0)
            OUT.write(dec.decode(held[:len(held) - keep]))
            held = held[len(held) - keep:]
    except (KeyboardInterrupt, BrokenPipeError, OSError):
        go_stop()
        raise
    finally:
        CHILD["p"] = None


def run_go(code):
    if not os.path.exists(LUMEN_GO):
        raise LangError("CompilerMissing", "Go n'est pas dans cette image de la machine")
    work = os.path.join(BUILDS, "go")
    os.makedirs(work, exist_ok=True)
    cell, prelude, errf = (os.path.join(work, n) for n in ("cellule.go", "prelude.go", "erreur.txt"))
    with open(cell, "w") as f:
        f.write(code)
    with open(prelude, "w") as f:
        f.write("\n".join(share_go_prelude(code)) + "\n")
    for p in (errf, SHARE_FILE):
        try:
            os.unlink(p)
        except OSError:
            pass
    rc = go_cell({"cell": cell, "prelude": prelude, "out": SHARE_FILE, "err": errf, "cwd": SH_STATE["cwd"]})
    SHARE["out"] = share_from_json(SHARE_FILE)
    try:
        with open(errf, encoding="utf-8", errors="replace") as f:
            err = f.read().strip()
    except OSError:
        err = ""
    if err:
        m = re.match(r"^(?:[^\s:]*\.go:)?(\d+):(\d+):\s*(.*)$", err, re.S)
        if m:
            raise LangError("GoError", m.group(3).strip(), ["ligne %s, colonne %s" % (m.group(1), m.group(2))])
        raise LangError("GoPanic" if err.startswith("panic") else "GoError", err.splitlines()[0][:400], err.splitlines()[1:12])
    if rc:
        ERR.write("(code de retour %d)\n" % rc)


PHP_MARK = "\x01LXE\t"

# Le lanceur des cellules PHP : les variables reçues, puis la cellule incluse dans un try (PHP 7 y lève une ParseError
# qu'on attrape : les numéros de ligne de la cellule restent les siens). Erreurs et avertissements sortent sur une
# ligne marquée que le noyau met à part ; à la fin, les variables globales partent dans la jonction.
PHP_RUNNER = r"""<?php
function __lx_say($kind, $line, $msg) { echo "\x01LXE\t", $kind, "\t", $line, "\t", str_replace("\n", " ", $msg), "\n"; }
set_error_handler(function ($no, $msg, $file, $line) {
    if (!(error_reporting() & $no)) return false;
    $kinds = [E_WARNING => 'Warning', E_NOTICE => 'Notice', E_USER_WARNING => 'Warning', E_USER_NOTICE => 'Notice', E_DEPRECATED => 'Deprecated', E_USER_DEPRECATED => 'Deprecated', E_USER_ERROR => 'Fatal error'];
    __lx_say($kinds[$no] ?? 'Warning', basename($file) === 'cellule.php' ? $line : '', $msg);
    return true;
});
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR])) __lx_say('Fatal error', basename($e['file']) === 'cellule.php' ? $e['line'] : '', $e['message']);
    $o = [];
    foreach ($GLOBALS as $k => $v) {
        if (in_array($k, ['GLOBALS', '_GET', '_POST', '_COOKIE', '_FILES', '_SERVER', '_ENV', '_REQUEST', '_SESSION', 'argv', 'argc', '__lx_e'])) continue;
        if (is_object($v) || is_resource($v)) continue;
        $o[$k] = $v;
    }
    $p = getenv('LX_SHARE');
    if ($p) @file_put_contents($p, json_encode($o, JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR));
});
"""


def run_php(code):
    if not os.path.exists(PHP):
        raise LangError("CompilerMissing", "PHP n'est pas dans cette image de la machine")
    work = os.path.join(ROOT, "php")
    os.makedirs(work, exist_ok=True)
    cell, runner = os.path.join(work, "cellule.php"), os.path.join(work, "lanceur.php")
    # Sans « <?php », la cellule est du PHP (et pas un gabarit HTML) : la balise s'ajoute sur sa première ligne
    with open(cell, "w") as f:
        f.write(code if re.search(r"<\?(php|=)", code) else "<?php " + code)
    with open(runner, "w") as f:
        f.write(PHP_RUNNER + share_php_prelude(code) + "\ntry { include %s; } catch (Throwable $__lx_e) {\n"
                "    __lx_say($__lx_e instanceof ParseError ? 'Parse error' : 'Fatal error', basename($__lx_e->getFile()) === 'cellule.php' ? $__lx_e->getLine() : '',\n"
                "        ($__lx_e instanceof ParseError || $__lx_e instanceof Error ? '' : 'Uncaught ' . get_class($__lx_e) . ': ') . $__lx_e->getMessage());\n"
                "    exit(255);\n}\n" % php_quote(cell))
    share_reset()
    env = dict(SH_STATE["env"], LX_SHARE=SHARE_FILE)
    rc, marked = run_process([PHP, "-c", LANG_DIR + "/php/php.ini", "-d", "display_errors=0", "-d", "log_errors=0", runner],
                             cwd=SH_STATE["cwd"], env=env, mark=PHP_MARK)
    SHARE["out"] = share_from_json(SHARE_FILE)
    flush_streams()
    fatal = None
    for text in marked:
        kind, _, rest = text.partition("\t")
        line, _, msg = rest.partition("\t")
        where = "ligne %s · " % line if line else ""
        if kind in ("Parse error", "Fatal error"):
            fatal = fatal or LangError("PHP " + kind, msg, [where + msg] if where else [])
        else:
            ERR.write("%s%s : %s\n" % (where, kind, msg))
    if fatal:
        raise fatal
    if rc:
        ERR.write("(code de retour %d)\n" % rc)


# ---------------------------------------------------------------- Python : magies et exécution

NS = {"__name__": "__main__", "__builtins__": builtins, "_lx_gl_runtime": gl_runtime}
COUNTER = {"n": 0}
HISTORY = {}


def magic_time(code, ns):
    t0 = time.time()
    r = exec_python(code, ns)
    OUT.write("Durée : %s\n" % fmt_dur(time.time() - t0))
    return r


def fmt_dur(s):
    if s < 1e-3:
        return "%.1f µs" % (s * 1e6)
    if s < 1:
        return "%.1f ms" % (s * 1e3)
    return "%.2f s" % s


def magic_timeit(code, ns):
    code_obj = compile(code, "<timeit>", "exec")
    n, t = 1, 0.0
    while True:
        t0 = time.perf_counter()
        for _ in range(n):
            exec(code_obj, ns)
        t = time.perf_counter() - t0
        if t > 0.4 or n >= 1000000:
            break
        n *= 10
    best = [t / n]
    for _ in range(2):
        t0 = time.perf_counter()
        for _ in range(n):
            exec(code_obj, ns)
        best.append((time.perf_counter() - t0) / n)
    OUT.write("%s par boucle (meilleur de 3, %d boucles chacun)\n" % (fmt_dur(min(best)), n))


LINE_MAGICS = {}


def line_magic(name):
    def deco(f):
        LINE_MAGICS[name] = f
        return f
    return deco


@line_magic("matplotlib")
def _m_matplotlib(arg):
    """%matplotlib inline : les figures s'affichent déjà sous les cellules."""
    return None


@line_magic("time")
def _m_time(arg):
    t0 = time.time()
    r = eval_or_exec(arg)
    OUT.write("Durée : %s\n" % fmt_dur(time.time() - t0))
    return r


@line_magic("timeit")
def _m_timeit(arg):
    magic_timeit(arg, NS)


@line_magic("who")
def _m_who(arg):
    OUT.write("  ".join(sorted(user_vars())) + "\n")


@line_magic("whos")
def _m_whos(arg):
    display(Table([[v["name"], v["type"], v["repr"]] for v in variables()], ["Nom", "Type", "Valeur"]))


@line_magic("reset")
def _m_reset(arg):
    for k in list(user_vars()):
        del NS[k]
    OUT.write("Espace de noms vidé.\n")


@line_magic("pwd")
def _m_pwd(arg):
    return SH_STATE["cwd"]


@line_magic("cd")
def _m_cd(arg):
    path = os.path.abspath(os.path.join(SH_STATE["cwd"], os.path.expanduser(arg.strip() or "~")))
    if not os.path.isdir(path):
        raise LangError("NotADirectory", path)
    SH_STATE["cwd"] = path
    os.chdir(path)
    OUT.write(path + "\n")


@line_magic("env")
def _m_env(arg):
    if "=" in arg:
        k, v = arg.split("=", 1)
        SH_STATE["env"][k.strip()] = v.strip()
        os.environ[k.strip()] = v.strip()
    else:
        return dict(SH_STATE["env"])


@line_magic("lsmagic")
def _m_lsmagic(arg):
    display(Markdown("**Magies de ligne** : " + " ".join("`%" + k + "`" for k in sorted(LINE_MAGICS)) +
                     "\n\n**Magies de cellule** : " + " ".join("`%%" + k + "`" for k in sorted(CELL_MAGICS)) +
                     "\n\n`!commande` lance une commande shell ; `x = !commande` récupère ses lignes."))


@line_magic("pip")
def _m_pip(arg):
    ERR.write("pip n'est pas disponible : la machine virtuelle n'a pas de réseau. "
              "La bibliothèque standard de Python 3.7 est complète (json, sqlite3, statistics, decimal, fractions…).\n")


@line_magic("history")
def _m_history(arg):
    for n in sorted(HISTORY):
        OUT.write("[%d] %s\n" % (n, HISTORY[n].splitlines()[0][:80] if HISTORY[n] else ""))


def cm_lang(lang):
    def f(code, arg):
        return run_lang(lang, code)
    return f


CELL_MAGICS = {
    "time": lambda code, arg: magic_time(code, NS),
    "timeit": lambda code, arg: magic_timeit(code, NS),
    "sh": lambda code, arg: __lx_sh(code), "bash": lambda code, arg: __lx_sh(code),
    "sql": cm_lang("sql"), "tcl": cm_lang("tcl"), "scheme": cm_lang("scheme"),
    "awk": cm_lang("awk"), "c": cm_lang("c"), "cpp": cm_lang("cpp"), "cobol": cm_lang("cobol"),
    "html": lambda code, arg: display(HTML(code)),
    "markdown": lambda code, arg: display(Markdown(code)), "md": lambda code, arg: display(Markdown(code)),
    "latex": lambda code, arg: display(Latex(code)),
    "svg": lambda code, arg: display(SVG(code)),
    "writefile": None, "capture": None,
}


def _cm_writefile(code, arg):
    path = os.path.join(SH_STATE["cwd"], arg.strip())
    mode = "a" if arg.strip().startswith("-a ") else "w"
    if mode == "a":
        path = os.path.join(SH_STATE["cwd"], arg.strip()[3:].strip())
    with open(path, mode) as f:
        f.write(code)
    OUT.write("%s %s\n" % ("Ajouté à" if mode == "a" else "Écrit :", path))


def _cm_capture(code, arg):
    name = arg.strip() or "_captured"
    buf = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buf
    try:
        exec_python(code, NS, show=False)
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    NS[name] = buf.getvalue()


CELL_MAGICS["writefile"] = _cm_writefile
CELL_MAGICS["capture"] = _cm_capture


def transform(code):
    """!commande, x = !commande et %magie -> appels Python (comme IPython)."""
    out = []
    for line in code.split("\n"):
        m = re.match(r"^(\s*)([A-Za-z_][\w.]*)\s*=\s*!(.*)$", line)
        if m:
            out.append("%s%s = __lx_sh(%r, capture=True)" % (m.group(1), m.group(2), m.group(3)))
            continue
        m = re.match(r"^(\s*)!(.*)$", line)
        if m:
            out.append("%s__lx_sh(%r)" % (m.group(1), m.group(2)))
            continue
        m = re.match(r"^(\s*)%(\w+)\s?(.*)$", line)
        if m and m.group(2) in LINE_MAGICS:
            out.append("%s__lx_magic(%r, %r)" % (m.group(1), m.group(2), m.group(3)))
            continue
        out.append(line)
    return "\n".join(out)


def __lx_magic(name, arg):
    return LINE_MAGICS[name](arg)


def eval_or_exec(src):
    try:
        return eval(compile(transform(src), "<magie>", "eval"), NS)
    except SyntaxError:
        exec(compile(transform(src), "<magie>", "exec"), NS)


def exec_python(code, ns, show=True):
    """Exécute le code ; renvoie la valeur de la dernière expression (affichée comme Out[n])."""
    src = transform(code)
    tree = ast.parse(src, "<cellule>", "exec")
    last = None
    if show and tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, "<cellule>", "exec"), ns)
    if last is not None:
        return eval(compile(last, "<cellule>", "eval"), ns)
    return None


def run_python(code):
    m = re.match(r"^%%(\w+)[ \t]*(.*)\n?", code)
    if m:
        name, arg = m.group(1), m.group(2)
        body = code[m.end():]
        if name not in CELL_MAGICS:
            raise LangError("UsageError", "magie de cellule inconnue : %%" + name + " (voir %lsmagic)")
        return CELL_MAGICS[name](body, arg)
    return exec_python(code, NS)


def run_lang(lang, code):
    if lang == "python":
        return run_python(code)
    if lang == "sh":
        rc = run_sh(code)
        if rc:
            ERR.write("(code de retour %d)\n" % rc)
        return None
    if lang == "sql":
        run_sql(code)
        return None
    if lang == "tcl":
        r = run_tcl(code)
        return r if r not in ("", None) else None
    if lang == "scheme":
        r = run_scheme(code)
        return r if r not in ("", None) else None
    if lang == "awk":
        run_awk(code)
        return None
    if lang in ("c", "cpp", "cobol", "rust"):
        run_compiled(lang, code)
        return None
    if lang == "go":
        run_go(code)
        return None
    if lang == "php":
        run_php(code)
        return None
    raise LangError("UnknownLanguage", "langage inconnu : %s" % lang)


class Raw:
    """Résultat déjà sous forme de texte (Tcl, Scheme) : affiché tel quel."""

    def __init__(self, text):
        self.text = text

    def __repr__(self):
        return self.text


def user_vars():
    hidden = set(BUILTIN_NAMES)
    return [k for k in NS if not k.startswith("_") and k not in hidden]


import reprlib

_SHORT = reprlib.Repr()
_SHORT.maxstring, _SHORT.maxother, _SHORT.maxlist, _SHORT.maxtuple, _SHORT.maxdict, _SHORT.maxset, _SHORT.maxlevel = 100, 100, 8, 8, 6, 6, 3


def preview(v):
    """L'aperçu d'une valeur pour le panneau des variables (120 caractères), sans la formater entièrement : repr()
    d'un tableau numpy ou d'une longue liste formate chaque élément, des secondes dans la machine émulée."""
    mod = type(v).__module__.split(".")[0]
    if mod == "numpy" and hasattr(v, "shape"):
        if not v.shape:
            return repr(v)
        flat = v.ravel()[:6]
        head = ", ".join(_SHORT.repr(x.item() if hasattr(x, "item") else x) for x in flat)
        return "array%s %s [%s%s]" % (tuple(v.shape), v.dtype, head, ", …" if v.size > 6 else "")
    if mod == "pandas" and hasattr(v, "shape"):
        cols = list(getattr(v, "columns", []))[:6]
        return "%s %s%s" % (type(v).__name__, "×".join(str(n) for n in v.shape), (" : " + ", ".join(map(str, cols))) if cols else "")
    return _SHORT.repr(v)


def variables():
    out = []
    for k in user_vars():
        v = NS[k]
        if type(v).__name__ == "module":
            continue
        try:
            r = preview(v)
        except Exception:
            r = "?"
        try:
            size = len(v) if hasattr(v, "__len__") and not isinstance(v, (str, bytes)) else None
        except Exception:
            size = None
        out.append({"name": k, "type": type(v).__name__, "repr": r[:120], "size": size})
    return out


# Les données que les phrases du texte peuvent « boire » : valeurs simples de Python, tables SQLite
GL_LIMIT = 5000          # éléments au plus par liste, lignes par table
GL_BUDGET = 1 << 20      # octets de JSON au plus pour l'ensemble


def gl_value(v, depth=0):
    """Une valeur Python en données pour Grama Lectica (JSON), ou None si elle n'en a pas l'équivalent.
    Un dictionnaire devient une fiche : {"$fiche": {clé: valeur}} ; un objet aussi, par ses attributs, avec le nom
    de sa classe ({"$class": …}) ; le reste passe par sa forme texte (str()). Fonctions, classes, modules : rien."""
    if depth > 6:
        return None
    if callable(v) or type(v).__name__ == "module":
        return None
    if isinstance(v, bool) or v is None:
        return v
    if hasattr(v, "tolist") and type(v).__module__.split(".")[0] == "numpy":
        v = v.tolist()
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return float(v) if abs(v) < 2 ** 53 else None
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None
    if isinstance(v, str):
        return v if len(v) <= 100000 else None
    if isinstance(v, (set, frozenset)):
        try:
            v = sorted(v)
        except TypeError:
            v = list(v)
    if isinstance(v, (list, tuple, range)):
        if len(v) > GL_LIMIT:
            return None
        out = [gl_value(x, depth + 1) for x in v]
        return None if any(x is None for x in out) else out
    if isinstance(v, dict) and len(v) <= 200:
        out = {str(k): gl_value(x, depth + 1) for k, x in v.items()}
        return {"$fiche": {k: x for k, x in out.items() if x is not None}}
    attrs = getattr(v, "__dict__", None)
    if isinstance(attrs, dict) and attrs and len(attrs) <= 200:
        out = {k: gl_value(x, depth + 1) for k, x in attrs.items() if not k.startswith("_")}
        return {"$fiche": {k: x for k, x in out.items() if x is not None}, "$class": type(v).__name__}
    try:
        text = str(v)
    except Exception:
        return None
    return text if len(text) <= 100000 else None


def gl_scalar(text):
    """Un texte venu d'un langage où tout est texte (Tcl, shell) : un nombre s'il en a la forme."""
    t = text.strip()
    if re.match(r"^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$", t):
        return float(t)
    return text


ENV0 = set(os.environ)          # l'environnement de départ : seules les variables ajoutées par le shell s'exportent


def gl_langs():
    """Les variables des autres langages du noyau : Tcl, Scheme, shell."""
    out = {}
    t = TCL["interp"]
    if t is not None:
        vals = {}
        try:
            skip = {"env", "errorInfo", "errorCode", "argv", "argv0", "argc", "auto_path", "auto_index", "tcl_platform",
                    "tcl_library", "tcl_patchLevel", "tcl_version", "tcl_pkgPath", "tcl_interactive", "tcl_rcFileName", "tk_library", "tk_version", "tk_patchLevel", "tk_strictMotif"}
            for name in t.splitlist(t.eval("info globals")):
                if name in skip or name.startswith("__lx"):
                    continue
                if t.eval("array exists %s" % name) == "1":
                    kv = t.splitlist(t.eval("array get %s" % name))
                    vals[name] = {"$fiche": {kv[i]: gl_scalar(kv[i + 1]) for i in range(0, len(kv) - 1, 2)}}
                    continue
                raw = t.getvar(name)
                raw = raw if isinstance(raw, str) else str(raw)
                items = t.splitlist(raw)
                nums = [gl_scalar(x) for x in items]
                vals[name] = nums if len(items) > 1 and all(isinstance(x, float) for x in nums) else gl_scalar(raw)
        except Exception:
            pass
        out["tcl"] = vals
    env = SCHEME["env"]
    if env is not None:
        vals = {}
        for k, v in env.items():
            name = str(k)
            if name in SCHEME_BUILTINS or callable(v):
                continue
            g = gl_value(scm_plain(v))
            if g is not None:
                vals[name] = g
        out["scheme"] = vals
    vals = {}
    for k, v in SH_STATE["env"].items():
        if k not in ENV0 and re.match(r"^[A-Za-z_]\w*$", k):
            vals[k] = gl_scalar(v)
    out["sh"] = vals
    return out


def scm_plain(v):
    """Une valeur Scheme en Python simple : symboles en textes, listes récursivement."""
    if isinstance(v, list):
        return [scm_plain(x) for x in v]
    if isinstance(v, Sym):
        return str(v)
    return v


# Convertir un tableau numpy en liste (puis en JSON) coûte cher dans la machine émulée, et se refaisait après chaque
# cellule : la conversion est gardée, avec l'empreinte du tableau (forme, type, octets), et refaite s'il a changé.
# (Les listes ordinaires, modifiables sur place sans que rien ne le signale à peu de frais, sont toujours reconverties.)
_CONVERTED = {}


def converted(kind, name, v, make):
    if type(v).__module__.split(".")[0] == "numpy" and hasattr(v, "tobytes") and getattr(v, "nbytes", 1 << 30) < 64 << 20:
        try:
            print_ = (v.shape, str(v.dtype), hashlib.md5(v.tobytes()).digest())
        except Exception:
            return make(v)
        hit = _CONVERTED.get((kind, name))
        if hit and hit[0] == print_:
            return hit[1]
        out = make(v)
        _CONVERTED[(kind, name)] = (print_, out)
        return out
    return make(v)


def _gl_sized(v):
    g = gl_value(v)
    return (g, len(json.dumps(g))) if g is not None else (None, 0)


def gl_values():
    out, size = {}, 0
    for k in user_vars():
        v = NS[k]
        if callable(v) or type(v).__name__ == "module":
            continue
        try:
            g, n = converted("gl", k, v, _gl_sized)
            if g is None:
                continue
        except Exception:
            continue
        if size + n > GL_BUDGET:
            continue
        out[k], size = g, size + n
    return out


def gl_tables():
    out = {}
    try:
        names = [r[0] for r in DB.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")]
        for t in names[:50]:
            cur = DB.execute('SELECT * FROM "%s" LIMIT %d' % (t.replace('"', '""'), GL_LIMIT))
            cols = [d[0] for d in cur.description]
            rows = [[x if isinstance(x, (int, float, str)) and not isinstance(x, bool) else (None if x is None else str(x)) for x in r] for r in cur.fetchall()]
            out[t] = {"columns": cols, "rows": rows}
    except Exception:
        pass
    return out


# Ce que la page a déjà reçu (une empreinte par entrée) : après chaque cellule, on ne renvoie que ce qui a changé.
# Le port série de la machine émulée est lent (quelques centaines de Ko par seconde) : renvoyer chaque fois toutes les
# variables et toutes les tables (des centaines de Ko avec numpy) retardait la cellule suivante d'une à trois secondes.
SENT = {"vars": None, "values": {}, "tables": {}, "langs": {}, "share": {}}


def _print(v):
    return hashlib.md5(json.dumps(v, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).digest()


def forget_sent():
    """La page repart de zéro (rechargée, noyau remis à zéro) : au prochain envoi, tout est renvoyé."""
    SENT.update({"vars": None, "values": {}, "tables": {}, "langs": {}, "share": {}})


def delta(kind, current):
    """Les entrées de current qui ont changé depuis le dernier envoi, et les noms disparus : (changées, disparues)."""
    old = SENT[kind]
    changed = {}
    for k, v in current.items():
        h = _print(v)
        if old.get(k) != h:
            changed[k] = v
            old[k] = h
    gone = [k for k in old if k not in current]
    for k in gone:
        del old[k]
    return changed, gone


def send_vars():
    """Les variables (le panneau), les valeurs, tables et variables par langage (les phrases) : seulement ce qui a
    changé ; la page (kernel.js) recompose l'ensemble."""
    try:
        msg = {"t": "vars", "delta": True}
        t0 = time.time()
        listing = variables()
        t1 = time.time()
        h = _print(listing)
        if SENT["vars"] != h:
            msg["vars"], SENT["vars"] = listing, h
        cost = {"vars": int((t1 - t0) * 1000)}
        for kind, make in (("values", gl_values), ("tables", gl_tables), ("langs", gl_langs)):
            t = time.time()
            current = make()
            cost[kind] = int((time.time() - t) * 1000)
            changed, gone = delta(kind, current)
            if changed:
                msg[kind] = changed
            if gone:
                msg[kind + "_gone"] = gone
        msg["cost"] = cost   # (le temps de calcul de chaque partie, en ms : /diagnostic)
        emit(msg)
    except Exception:
        pass


def error_payload(e, lang):
    if isinstance(e, LangError):
        return {"ename": e.ename, "evalue": e.evalue, "traceback": e.tb}
    if isinstance(e, KeyboardInterrupt):
        return {"ename": "Interruption", "evalue": "exécution interrompue", "traceback": []}
    tb = traceback.extract_tb(e.__traceback__)
    frames = [f for f in tb if f.filename in ("<cellule>", "<magie>", "<timeit>")]
    lines = []
    for f in frames:
        lines.append("ligne %d%s" % (f.lineno, " · " + f.line if f.line else ""))
    if isinstance(e, SyntaxError):
        lines = ["ligne %s · %s" % (e.lineno, (e.text or "").rstrip())]
        if e.offset:
            lines.append(" " * (len(str(e.lineno)) + 9 + (e.offset or 1)) + "^")
    if lang == "sql" and isinstance(e, sqlite3.Error):
        return {"ename": type(e).__name__, "evalue": str(e), "traceback": []}
    return {"ename": type(e).__name__, "evalue": str(e), "traceback": lines}


def execute(req):
    cid, lang, code = req["id"], req.get("lang", "python"), req.get("code", "")
    CURRENT["id"] = cid
    OUT.sent = ERR.sent = 0
    COUNTER["n"] += 1
    n = COUNTER["n"]
    HISTORY[n] = code
    emit({"t": "status", "id": cid, "state": "busy", "count": n})
    t0 = time.time()
    ok = True
    old = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = OUT, ERR
    SHARE.update({"in": req.get("share") or {}, "out": None, "alias": {}})
    try:
        try:
            share_into(lang, code)
        except Exception:
            pass
        result = run_lang(lang, code)
        if lang == "python":
            mpl_flush()
        flush_streams()
        if result is not None:
            if isinstance(result, str) and lang in ("tcl", "scheme"):
                result = Raw(result)
            NS["_"] = result
            NS["_%d" % n] = result
            emit({"t": "result", "id": cid, "count": n, "data": mimebundle(result)})
    except BaseException as e:  # noqa — y compris KeyboardInterrupt
        ok = False
        flush_streams()
        payload = error_payload(e, lang)
        payload.update({"t": "error", "id": cid})
        emit(payload)
        if isinstance(e, SystemExit):
            pass
    finally:
        sys.stdout, sys.stderr = old
    try:
        # (la jonction de la page fusionne : seules les variables qui ont changé lui sont envoyées)
        SENT["share"].setdefault(lang, {})
        old, values, changed = SENT["share"][lang], share_out(lang), {}
        for k, v in values.items():
            h = _print(v)
            if old.get(k) != h:
                changed[k], old[k] = v, h
        emit({"t": "share", "id": cid, "lang": lang, "values": changed})
    except Exception:
        pass
    done = {"t": "done", "id": cid, "ok": ok, "ms": int((time.time() - t0) * 1000), "count": n}
    if "tkinter" in sys.modules:
        done["win"] = tk_rect()
    emit(done)
    if lang in ("python", "sql", "tcl", "scheme", "sh", "awk"):
        send_vars()
    CURRENT["id"] = None


# ---------------------------------------------------------------- complétion et inspection

def complete(req):
    code, pos = req.get("code", ""), req.get("pos", 0)
    before = code[:pos]
    m = re.search(r"[A-Za-z_][\w.]*$", before)
    token = m.group(0) if m else ""
    matches = []
    if "." in token:
        base, _, attr = token.rpartition(".")
        try:
            obj = eval(base, NS)
            matches = [base + "." + a for a in dir(obj) if a.startswith(attr) and (attr.startswith("_") or not a.startswith("_"))]
        except Exception:
            matches = []
    else:
        names = set(NS) | set(dir(builtins)) | set(keyword.kwlist)
        matches = sorted(n for n in names if n.startswith(token) and not n.startswith("__"))
    emit({"t": "complete", "rid": req.get("rid"), "matches": matches[:200], "start": pos - len(token), "end": pos})


def inspect_obj(req):
    name = req.get("name", "")
    text = ""
    try:
        obj = eval(name, NS)
        sig = ""
        try:
            import inspect
            sig = str(inspect.signature(obj))
        except Exception:
            pass
        doc = (getattr(obj, "__doc__", "") or "").strip()
        text = "%s%s\n%s\n\n%s" % (name, sig, type(obj).__name__, doc[:1500])
    except Exception as e:
        text = "%s : %s" % (name, e)
    emit({"t": "inspect", "rid": req.get("rid"), "text": text})


def list_files(req):
    path = req.get("path") or SH_STATE["cwd"]
    entries = []
    try:
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            st = os.stat(full)
            entries.append({"name": name, "dir": os.path.isdir(full), "size": st.st_size, "mtime": int(st.st_mtime)})
    except OSError as e:
        emit({"t": "files", "rid": req.get("rid"), "path": path, "error": str(e), "entries": []})
        return
    emit({"t": "files", "rid": req.get("rid"), "path": path, "entries": entries})


def read_file(req):
    path = os.path.join(SH_STATE["cwd"], req.get("path", ""))
    try:
        with open(path, "rb") as f:
            data = f.read(2000000)
        emit({"t": "file", "rid": req.get("rid"), "path": path, "b64": base64.b64encode(data).decode("ascii")})
    except OSError as e:
        emit({"t": "file", "rid": req.get("rid"), "path": path, "error": str(e)})


def write_file(req):
    path = os.path.join(SH_STATE["cwd"], req.get("path", ""))
    with open(path, "wb") as f:
        f.write(base64.b64decode(req.get("b64", "")))
    emit({"t": "written", "rid": req.get("rid"), "path": path})


# ---------------------------------------------------------------- boucle principale

NS.update({
    "display": display, "HTML": HTML, "Markdown": Markdown, "Latex": Latex, "SVG": SVG, "JSON": JSON,
    "Table": Table, "Chart": Chart, "Figure": Figure, "plot": plot, "scatter": scatter, "bar": bar, "hist": hist,
    "progress": progress, "clear_output": clear_output, "sql": sql, "db": DB,
    "input": lx_input, "__lx_sh": __lx_sh, "__lx_magic": __lx_magic,
})
BUILTIN_NAMES = list(NS.keys()) + ["sql_result", "In", "Out"]


def handle(req):
    op = req.get("op")
    if op == "exec":
        execute(req)
    elif op == "complete":
        complete(req)
    elif op == "inspect":
        inspect_obj(req)
    elif op == "vars":
        send_vars()
    elif op == "ls":
        list_files(req)
    elif op == "read":
        read_file(req)
    elif op == "write":
        write_file(req)
    elif op == "resync":
        forget_sent()
        emit({"t": "resynced", "rid": req.get("rid")})
    elif op == "reset":
        forget_sent()
        for k in list(user_vars()):
            del NS[k]
        SCHEME["env"] = None
        TCL["interp"] = None
        send_vars()
        emit({"t": "reset", "rid": req.get("rid")})
    elif op == "warm":
        warm(req.get("lang", "cpp"))
    elif op == "ping":
        emit({"t": "pong", "rid": req.get("rid")})


def tk_rect():
    """Rectangle [x, y, largeur, hauteur] des fenêtres tkinter affichées, à l'écran de la machine, ou None."""
    tk = sys.modules.get("tkinter")
    root = getattr(tk, "_default_root", None) if tk else None
    if root is None:
        return None
    try:
        root.update_idletasks()
        wins = [root] + [w for w in root.winfo_children() if isinstance(w, tk.Toplevel)]
        boxes = [(w.winfo_rootx(), w.winfo_rooty(), w.winfo_width(), w.winfo_height()) for w in wins if w.winfo_ismapped()]
        # La barre de menus (root.config(menu=…)) est une copie à part, « .#… », posée au-dessus de la fenêtre
        call = root.tk.call
        for top in ["."] + [str(w) for w in wins[1:]]:
            for path in root.tk.splitlist(call("winfo", "children", top)):
                if "#" in path and call("winfo", "class", path) == "Menu" and int(call("winfo", "ismapped", path)):
                    boxes.append(tuple(int(call("winfo", k, path)) for k in ("rootx", "rooty", "width", "height")))
        if not boxes:
            return None
        x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        x1, y1 = max(b[0] + b[2] for b in boxes), max(b[1] + b[3] for b in boxes)
        x0, y0 = max(0, x0), max(0, y0)
        return [x0, y0, x1 - x0, y1 - y0] if x1 > x0 and y1 > y0 else None
    except Exception:
        return None


class _TkHook:
    """À l'import de tkinter, mainloop() annonce d'abord la fenêtre : la page la cadre pendant qu'elle tourne."""

    def find_spec(self, name, path=None, target=None):
        if name != "tkinter":
            return None
        sys.meta_path.remove(self)
        import importlib.util
        spec = importlib.util.find_spec(name)
        if spec is None or spec.loader is None:
            return spec
        run = spec.loader.exec_module

        def exec_module(module):
            run(module)
            loop, init = module.Misc.mainloop, module.Tk.__init__

            def mainloop(self, n=0):
                rect = tk_rect()
                if rect and CURRENT.get("id"):
                    emit({"t": "window", "id": CURRENT["id"], "rect": rect})
                return loop(self, n)

            # La machine n'a pas de gestionnaire de fenêtres : personne ne donne le clavier à la fenêtre.
            # Un clic le lui donne (et au widget cliqué), comme sur un bureau ; la fenêtre l'a dès qu'elle s'affiche.
            def tk_init(self, *a, **k):
                init(self, *a, **k)
                # tkinter.Tcl() passe aussi par ici, sans Tk (useTk=False) : ni fenêtre ni bind
                if not k.get("useTk", True) or (len(a) >= 4 and not a[3]):
                    return

                def grab(ev):
                    try:
                        ev.widget.focus_force()
                    except Exception:
                        pass

                self.bind_all("<ButtonPress>", grab, add="+")
                self.bind("<Map>", lambda ev: ev.widget is self and self.after_idle(self.focus_force), add="+")

            module.Misc.mainloop = mainloop
            module.Tk.__init__ = tk_init

        spec.loader.exec_module = exec_module
        return spec


sys.meta_path.insert(0, _TkHook())


# ---------------------------------------------------------------- numpy, matplotlib (extension lumen-py)

PYLIBS = "/usr/local/lumen-py/site-packages"
if os.path.isdir(PYLIBS):
    sys.path.append(PYLIBS)
    os.environ.setdefault("MATPLOTLIBDATA", PYLIBS + "/matplotlib/mpl-data")
    # Le matplotlib de Debian cherche sa configuration dans /etc/matplotlibrc, absent de la machine : pylibs.sh l'a
    # copiée dans mpl-data (moteur de rendu Agg)
    os.environ.setdefault("MATPLOTLIBRC", PYLIBS + "/matplotlib/mpl-data/matplotlibrc")
    os.environ.setdefault("MPLCONFIGDIR", ROOT + "/mpl")
    os.environ.setdefault("MPLBACKEND", "Agg")


def mpl_svg(fig):
    """Une figure en SVG qui va avec le fond de la page : fond transparent, texte et axes de la couleur du texte."""
    buf = io.StringIO()
    fig.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
    svg = buf.getvalue()
    svg = svg[svg.find("<svg"):]
    svg = re.sub(r"#000000\b", "currentColor", svg)
    return svg.replace("font-family:DejaVu Sans", "font-family:Inter,DejaVu Sans,sans-serif")


def mpl_flush():
    """Les figures ouvertes s'affichent sous la cellule (plt.show(), ou à la fin de la cellule), puis se ferment."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for num in plt.get_fignums():
        display(SVG(mpl_svg(plt.figure(num))))
    plt.close("all")


class _MplHook:
    """À l'import de matplotlib.pyplot : plt.show() affiche dans la page, le texte reste du texte dans le SVG."""

    def find_spec(self, name, path=None, target=None):
        if name != "matplotlib.pyplot":
            return None
        sys.meta_path.remove(self)
        import importlib.util
        spec = importlib.util.find_spec(name)
        if spec is None or spec.loader is None:
            return spec
        run = spec.loader.exec_module

        def exec_module(module):
            run(module)
            module.show = lambda *a, **k: mpl_flush()
            rc = module.rcParams
            rc["svg.fonttype"] = "none"
            rc["figure.figsize"] = (6.4, 3.6)
            rc["axes.spines.top"] = rc["axes.spines.right"] = False

        spec.loader.exec_module = exec_module
        return spec


sys.meta_path.insert(0, _MplHook())


def tk_pump():
    """Fenêtres tkinter / turtle encore ouvertes : leurs événements sont traités entre deux cellules."""
    tk = sys.modules.get("tkinter")
    root = getattr(tk, "_default_root", None) if tk else None
    if root is not None:
        try:
            root.update()
        except Exception:
            pass


def main():
    with open(ROOT + "/kernel.pid", "w") as f:
        f.write(str(os.getpid()))
    emit({"t": "hello", "version": VERSION, "pid": os.getpid(), "python": sys.version.split()[0],
          "sqlite": sqlite3.sqlite_version, "langs": ["python", "sh", "sql", "tcl", "scheme", "awk"] + (["c", "cpp", "cobol"] if os.path.isdir(TC) else []) +
          [l for l, p in (("rust", RUSTC), ("go", LUMEN_GO), ("php", PHP)) if os.path.exists(p)]})
    while True:
        try:
            names = sorted(n for n in os.listdir(INBOX) if n.endswith(".req"))
        except OSError:
            names = []
        if not names:
            try:
                tk_pump()
                time.sleep(0.02)
            except KeyboardInterrupt:
                pass
            continue
        for name in names:
            path = os.path.join(INBOX, name)
            try:
                with open(path) as f:
                    raw = f.read().strip()
                os.remove(path)
                req = json.loads(base64.b64decode(raw).decode("utf-8"))
            except Exception as e:  # requête illisible : signalée, puis ignorée
                emit({"t": "log", "text": "requête %s illisible : %s" % (name, e)})
                continue
            try:
                handle(req)
            except KeyboardInterrupt:
                pass
            except Exception as e:
                emit({"t": "log", "text": "erreur interne : %s" % traceback.format_exc()})


if __name__ == "__main__":
    main()

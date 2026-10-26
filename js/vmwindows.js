// vmwindows.js — les fenêtres des programmes graphiques de la machine (tkinter, Swing, pygame…). L'écran de la machine
// est unique : hors de la vue, dans le résultat d'un bloc (en direct), ou dans une fenêtre flottante ; partout
// ailleurs, une fenêtre est une image (l'instantané pris quand elle a quitté l'écran).
//
// setupVmWindows(app) reçoit ce qu'il emprunte à l'application ; il rend l'état (VM) et les gestes sur l'écran.

export function setupVmWindows({ $, kernel, persist, renderOutputs, toast }) {
    const VM_SCREEN = $("#vm-screen");
    const VM = { owner: null, mode: null, float: null, last: null, timer: 0, native: false };

    /** Image de l'écran de la machine, réduite à la fenêtre du bloc quand on connaît son rectangle. */
    function snapshot(rect = VM.owner?.win) {
        const jw = kernel.jw;
        if (!jw?.canvas?.width || !jw.area) return null;
        showScreen();
        const [x, y, w, h] = clipRect(rect) || [0, 0, ...jw.area];
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        try {
            c.getContext("2d").drawImage(jw.canvas, x, y, w, h, 0, 0, w, h);
            return c.toDataURL("image/png").split(",")[1];
        } catch { return null; }
    }

    function clipRect(r) {
        const jw = kernel.jw;
        if (!r || !jw?.canvas?.width) return null;
        const x = Math.max(0, Math.min(r[0], jw.canvas.width - 1)), y = Math.max(0, Math.min(r[1], jw.canvas.height - 1));
        const w = Math.min(r[2], jw.canvas.width - x), h = Math.min(r[3], jw.canvas.height - y);
        return w > 8 && h > 8 ? [x, y, w, h] : null;
    }

    /**
     * La vue en direct se cadre sur la fenêtre du bloc : seule sa surface s'affiche, à l'échelle, sans les bandes
     * noires du reste de l'écran. Le pointeur reste juste : JarWeBox le calcule d'après la place réelle du canevas.
     */
    function fitVm() {
        const jw = kernel.jw;
        if (!jw?.viewport) return;
        const host = VM_SCREEN;
        const r = VM.owner ? clipRect(VM.owner.win) : null;
        host.style.aspectRatio = r && VM.mode === "inline" ? `${r[2]} / ${r[3]}` : "";
        host.style.maxWidth = r && VM.mode === "inline" ? `${r[2]}px` : "";
        if (!r) { Object.assign(jw.screen.style, { left: "0px", top: "0px" }); return; }
        const cw = host.clientWidth, ch = host.clientHeight;
        if (!cw || !ch) return;
        const [x, y, w, h] = r;
        const k = Math.min(cw / w, ch / h);
        Object.assign(jw.viewport.style, { width: `${w * k}px`, height: `${h * k}px`, left: `${(cw - w * k) / 2}px`, top: `${(ch - h * k) / 2}px` });
        Object.assign(jw.screen.style, { width: `${jw.width * k}px`, height: `${jw.height * k}px`, left: `${-x * k}px`, top: `${-y * k}px` });
    }

    /**
     * Une fenêtre Python (tkinter, turtle) reçoit de vraies touches, par X ; une fenêtre Java les reçoit de la JVM.
     * JarWeBox choisit d'après l'application qu'il a lancée : ici c'est le bloc affiché qui décide.
     */
    function vmKeys(st) {
        const jw = kernel.jw;
        if (!jw) return;
        if (!jw.lxHooked) {
            const layout = jw.layout.bind(jw), real = jw.realKeys.bind(jw);
            jw.layout = () => { layout(); fitVm(); };
            jw.realKeys = () => VM.native || real();
            jw.lxHooked = true;
        }
        const native = !!st && st.lang !== "java" && st.lang !== "javascript";
        if (native && !VM.native) jw.send(`KMAP ${jw.xLayout()}`);
        VM.native = native;
    }

    function windowImage(st, b64 = snapshot(st.win)) {
        if (!b64) return;
        const out = { output_type: "display_data", data: { "image/png": b64 }, metadata: { lumen: { window: true } } };
        const i = st.outputs.findIndex((o) => o.metadata?.lumen?.window);
        if (i >= 0) st.outputs[i] = out; else st.outputs.push(out);
        renderOutputs(st);
        persist();
    }

    function windowFrame(st, out) {
        const live = VM.owner === st && VM.mode === "inline";
        const away = VM.owner === st && VM.mode === "float";
        const el = document.createElement("div");
        el.className = `lx-win${live ? " live" : ""}`;
        const btn = (w, label) => `<button type="button" data-w="${w}">${label}</button>`;
        el.innerHTML = `<div class="lx-win-bar"><span>${live ? "fenêtre · en direct" : away ? "fenêtre · détachée" : "fenêtre"}</span><span class="spacer"></span>${
            away ? btn("attach", "Rattacher") : `${live ? btn("freeze", "Figer") : btn("live", "Reprendre")}${btn("detach", "Détacher")}`}${btn("full", "Plein écran")}</div><div class="lx-win-body"></div>`;
        const body = $(".lx-win-body", el);
        if (live) body.append(VM_SCREEN);
        else if (out) {
            const img = document.createElement("img");
            img.src = `data:image/png;base64,${out.data["image/png"]}`;
            img.alt = "Image de la fenêtre";
            img.addEventListener("load", () => st.widget?.changed());
            body.append(img);
        }
        el.addEventListener("click", (e) => {
            const act = e.target.closest("[data-w]")?.dataset.w;
            if (act === "live") vmInline(st);
            else if (act === "freeze" || act === "attach") vmFreeze(st);
            else if (act === "detach") vmFloat(st);
            else if (act === "full") { if (VM.owner !== st) vmInline(st); requestAnimationFrame(() => VM_SCREEN.requestFullscreen?.()); }
        });
        return el;
    }

    /** JarWeBox masque sa surface après le démarrage : les fenêtres de la machine s'y dessinent. */
    function showScreen() {
        if (kernel.jw?.viewport?.hidden) { kernel.jw.viewport.hidden = false; kernel.jw.layout(); }
    }

    function vmTake(st) {
        showScreen();
        if (VM.owner && VM.owner !== st) vmFreeze(VM.owner);
        VM.owner = st;
        vmKeys(st);
        clearInterval(VM.timer);
        // Une image récente sert si la fenêtre se ferme avant qu'on la fige
        VM.timer = setInterval(() => { const s = snapshot(); if (s) VM.last = s; }, 1500);
    }

    function vmInline(st) {
        if (!kernel.jw) { toast("La machine n'est pas encore démarrée"); return; }
        vmTake(st);
        VM.mode = "inline";
        VM.float?.remove();
        VM.float = null;
        renderOutputs(st);
        requestAnimationFrame(() => { kernel.jw?.layout(); kernel.jw?.canvas?.focus({ preventScroll: true }); st.widget?.changed(); });
    }

    function vmFloat(st) {
        if (!kernel.jw) { toast("La machine n'est pas encore démarrée"); return; }
        vmTake(st);
        VM.mode = "float";
        if (!VM.float) {
            const win = document.createElement("div");
            win.className = "lx-float";
            win.innerHTML = '<div class="lx-win-bar lx-drag"><span>fenêtre</span><span class="spacer"></span><button type="button" data-w="attach">Rattacher</button><button type="button" data-w="full">Plein écran</button></div><div class="lx-win-body"></div>';
            document.body.append(win);
            VM.float = win;
            win.addEventListener("click", (e) => {
                const act = e.target.closest("[data-w]")?.dataset.w;
                if (act === "attach") vmFreeze(VM.owner);
                else if (act === "full") VM_SCREEN.requestFullscreen?.();
            });
            win.addEventListener("pointerdown", (e) => {
                if (!e.target.closest(".lx-drag") || e.target.closest("button")) return;
                e.preventDefault();
                const r = win.getBoundingClientRect();
                const dx = e.clientX - r.left, dy = e.clientY - r.top;
                const move = (ev) => Object.assign(win.style, { left: `${Math.max(0, ev.clientX - dx)}px`, top: `${Math.max(0, ev.clientY - dy)}px`, right: "auto", bottom: "auto" });
                const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
                addEventListener("pointermove", move);
                addEventListener("pointerup", up);
            });
            new ResizeObserver(() => kernel.jw?.layout()).observe(win);
        }
        const r = clipRect(st.win);
        if (r) {
            const k = Math.min(1, (innerWidth - 48) / r[2], (innerHeight - 120) / r[3]);
            Object.assign(VM.float.style, { width: `${Math.round(r[2] * k)}px`, height: `${Math.round(r[3] * k) + 30}px` });
        }
        $(".lx-win-body", VM.float).append(VM_SCREEN);
        renderOutputs(st);
        requestAnimationFrame(() => kernel.jw?.layout());
    }

    /** Figer, rattacher : l'image de la fenêtre remplace l'écran en direct dans le résultat. */
    function vmFreeze(st, { last = false } = {}) {
        if (!st || VM.owner !== st) return;
        const shot = (last && VM.last) || snapshot(st.win) || VM.last;
        vmRelease();
        if (shot) windowImage(st, shot); else renderOutputs(st);
    }

    function vmRelease() {
        const st = VM.owner;
        clearInterval(VM.timer);
        VM.owner = null;
        VM.mode = null;
        VM.last = null;
        vmKeys(null);
        fitVm();
        $(".vm-host").append(VM_SCREEN);
        VM.float?.remove();
        VM.float = null;
        if (st) renderOutputs(st);
    }

    return { VM, fitVm, windowImage, windowFrame, vmInline, vmFloat, vmFreeze, vmRelease };
}

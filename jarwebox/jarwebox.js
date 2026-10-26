// JarWeBox — runs Java, C++ (Qt), COBOL and Python (tkinter) applications in the browser,
// 100 % client side.
//
// An x86 machine (v86, WebAssembly) restores a snapshot in which Linux, X and a
// resident OpenJDK 8 launcher are already running. Apps are sent to that launcher
// over the serial port (protocol: tools/guest/Launcher.java):
//   - "window" apps (Java Swing/AWT, .jar) are shown as a borderless surface, sized to `ratio`;
//   - "native" apps (`exe`: C++/Qt program, or Python .pyz/.py with tkinter) likewise, with real keys;
//   - "terminal" apps (.jar, or console `exe`: C++, COBOL, Python) run in a real X terminal
//     of the VM (rxvt-unicode).
//
//   const jw = new JarWeBox(element, { ratio: "auto", keyboard: "auto" });
//   await jw.start();
//   await jw.run({ id: "notepad", jar: "apps/notepad/notepad.jar", mode: "window" });
//   await jw.run({ id: "calculator", exe: "apps/calculator/calculator", mode: "native" });
//
// Options:
//   ratio     "auto" (follow the container's shape), "4:3", "16:9", "16:10", "1:1"
//   keyboard  "auto" (characters as typed on the computer), "azerty", "qwerty"
//             (map physical keys with that layout, whatever the system layout is)
// Events: progress, ready, started, window, title, terminal, closed, error.

const BASE = new URL(".", import.meta.url).href;

export const RATIOS = ["auto", "4:3", "16:9", "16:10", "1:1"];
export const KEYBOARDS = ["auto", "azerty", "qwerty"];

const CURSORS = ["default", "crosshair", "text", "wait", "sw-resize", "se-resize", "nw-resize",
    "ne-resize", "n-resize", "s-resize", "w-resize", "e-resize", "pointer", "move"];

// KeyboardEvent.code -> PS/2 scancode (set 1), for the X terminal and native apps; 0xE0xx = extended key.
const SCANCODES = {
    Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06, Digit6: 0x07,
    Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e,
    Tab: 0x0f, KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16,
    KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a, BracketRight: 0x1b, Enter: 0x1c,
    ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f, KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23,
    KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a,
    Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30, KeyN: 0x31, KeyM: 0x32,
    Comma: 0x33, Period: 0x34, Slash: 0x35, ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38,
    Space: 0x39, CapsLock: 0x3a, F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41,
    F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49,
    NumpadSubtract: 0x4a, Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e, Numpad1: 0x4f,
    Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53, IntlBackslash: 0x56, F11: 0x57,
    F12: 0x58, NumpadEnter: 0xe01c, ControlRight: 0xe01d, NumpadDivide: 0xe035, AltRight: 0xe038,
    Home: 0xe047, ArrowUp: 0xe048, PageUp: 0xe049, ArrowLeft: 0xe04b, ArrowRight: 0xe04d, End: 0xe04f,
    ArrowDown: 0xe050, PageDown: 0xe051, Insert: 0xe052, Delete: 0xe053, ContextMenu: 0xe05d,
};

// KeyboardEvent.key -> java.awt.event.KeyEvent.VK_*
const VK = {
    Enter: 10, Backspace: 8, Tab: 9, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35,
    Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 127, Insert: 155,
    ",": 44, "-": 45, ".": 46, "/": 47, ";": 59, "=": 61, "[": 91, "\\": 92, "]": 93,
    F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121,
    F11: 122, F12: 123,
};
const CONTROL_CHARS = { Enter: 10, Backspace: 8, Tab: 9, Escape: 27, Delete: 127 };

// Physical key (KeyboardEvent.code) -> [normal, shift, AltGr] characters.
const LAYOUTS = {
    azerty: {
        Backquote: "²", Digit1: "&1", Digit2: "é2~", Digit3: '"3#', Digit4: "'4{", Digit5: "(5[",
        Digit6: "-6|", Digit7: "è7`", Digit8: "_8\\", Digit9: "ç9^", Digit0: "à0@", Minus: ")°]",
        Equal: "=+}", KeyQ: "aA", KeyW: "zZ", KeyE: "eE€", KeyR: "rR", KeyT: "tT", KeyY: "yY",
        KeyU: "uU", KeyI: "iI", KeyO: "oO", KeyP: "pP", BracketLeft: "^¨", BracketRight: "$£¤",
        KeyA: "qQ", KeyS: "sS", KeyD: "dD", KeyF: "fF", KeyG: "gG", KeyH: "hH", KeyJ: "jJ",
        KeyK: "kK", KeyL: "lL", Semicolon: "mM", Quote: "ù%", Backslash: "*µ", IntlBackslash: "<>",
        KeyZ: "wW", KeyX: "xX", KeyC: "cC", KeyV: "vV", KeyB: "bB", KeyN: "nN", KeyM: ",?",
        Comma: ";.", Period: ":/", Slash: "!§", Space: "  ",
    },
    qwerty: {
        Backquote: "`~", Digit1: "1!", Digit2: "2@", Digit3: "3#", Digit4: "4$", Digit5: "5%",
        Digit6: "6^", Digit7: "7&", Digit8: "8*", Digit9: "9(", Digit0: "0)", Minus: "-_",
        Equal: "=+", KeyQ: "qQ", KeyW: "wW", KeyE: "eE", KeyR: "rR", KeyT: "tT", KeyY: "yY",
        KeyU: "uU", KeyI: "iI", KeyO: "oO", KeyP: "pP", BracketLeft: "[{", BracketRight: "]}",
        KeyA: "aA", KeyS: "sS", KeyD: "dD", KeyF: "fF", KeyG: "gG", KeyH: "hH", KeyJ: "jJ",
        KeyK: "kK", KeyL: "lL", Semicolon: ";:", Quote: "'\"", Backslash: "\\|", IntlBackslash: "\\|",
        KeyZ: "zZ", KeyX: "xX", KeyC: "cC", KeyV: "vV", KeyB: "bB", KeyN: "nN", KeyM: "mM",
        Comma: ",<", Period: ".>", Slash: "/?", Space: "  ",
    },
};

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`impossible de charger ${src}`));
        document.head.appendChild(s);
    });
}

function loadStyle(href) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
}

function toBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export class JarWeBox extends EventTarget {
    constructor(container, { ratio = "auto", keyboard = "auto", debug = false } = {}) {
        super();
        this.container = container;
        this.ratio = RATIOS.includes(ratio) ? ratio : "auto";
        this.keyboard = KEYBOARDS.includes(keyboard) ? keyboard : "auto";
        this.debug = debug; // emits "debug" events: input received, commands sent, replies
        this.emulator = null;
        this.image = null;
        this.app = null;
        this.waiters = [];
        this.decoder = new TextDecoder();

        container.classList.add("jw");
        container.innerHTML =
            '<div class="jw-viewport"><div class="jw-screen"><div style="display:none"></div><canvas></canvas></div></div>';
        this.viewport = container.querySelector(".jw-viewport");
        this.screen = container.querySelector(".jw-screen");
        this.canvas = container.querySelector("canvas");
        new ResizeObserver(() => this.layout()).observe(container);
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    // ------------------------------------------------------------------ boot

    async start() {
        loadStyle(BASE + "jarwebox.css");
        const [image] = await Promise.all([
            fetch(BASE + "image/image.json", { cache: "no-cache" }).then((r) => r.json()),
            window.V86 ? null : loadScript(BASE + "v86/libv86.js"),
        ]);
        this.image = image;
        this.width = image.screen.width;
        this.height = image.screen.height;
        this.area = [this.width, this.height];

        // No network card, whatever the image says: programs in the machine reach nothing outside the browser
        // (the CD-ROM chunks are fetched by the page, not by the machine).
        const { net_device, network_relay_url, network_adapter, ...hardware } = image.hardware || {};
        this.emulator = new window.V86({
            ...hardware,
            wasm_path: BASE + "v86/v86.wasm",
            bios: { url: BASE + "v86/seabios.bin" },
            vga_bios: { url: BASE + "v86/vgabios.bin" },
            initial_state: { url: BASE + image.state, size: image.state_size },
            // Only the 1 MiB chunks Linux actually reads are downloaded.
            cdrom: {
                url: BASE + image.cdrom.url, size: image.cdrom.size,
                async: true, use_parts: true, fixed_chunk_size: image.cdrom.chunk,
            },
            screen_container: this.screen,
            disable_keyboard: true, // input goes through the launcher instead:
            disable_mouse: true,    // absolute pointer, any keyboard layout
            disable_speaker: true,
            autostart: true,
        });

        this.emulator.add_listener("download-progress", (e) => {
            if (e.file_name.includes("state") && e.lengthComputable) {
                this.emit("progress", { loaded: e.loaded, total: e.total });
            }
        });
        this.listenSerial();
        await new Promise((r) => this.emulator.add_listener("emulator-started", r));
        await this.ping();
        this.bindInput();
        await this.detectLayout();
        this.layout();
        // An app already open in the snapshot is the current app.
        if (image.preloaded) this.app = { id: image.preloaded, mode: "window", preloaded: true };
        this.emit("ready", { preloaded: image.preloaded });
    }

    async ping() {
        for (let i = 0; i < 20; i++) {
            try {
                return await this.request("PING", "PONG", 1500);
            } catch {
                // the launcher may still be catching up right after the restore
            }
        }
        throw new Error("le lanceur Java ne répond pas");
    }

    // ------------------------------------------------------------------ options

    setRatio(ratio) {
        if (!RATIOS.includes(ratio)) return;
        this.ratio = ratio;
        this.layout();
    }

    setKeyboard(keyboard) {
        if (!KEYBOARDS.includes(keyboard)) return;
        this.keyboard = keyboard;
        if (this.realKeys()) this.send(`KMAP ${this.xLayout()}`);
    }

    /** Size of the app window in screen pixels for the current ratio. */
    targetArea() {
        let r;
        if (this.ratio === "auto") {
            const { clientWidth: w, clientHeight: h } = this.container;
            r = w && h ? w / h : this.width / this.height;
        } else {
            const [a, b] = this.ratio.split(":").map(Number);
            r = a / b;
        }
        return r >= this.width / this.height
            ? [this.width, Math.round(this.width / r / 2) * 2]
            : [Math.round(this.height * r / 2) * 2, this.height];
    }

    /** Fits the visible area (top-left part of the screen) into the container, letterboxed. */
    layout() {
        if (!this.emulator || !this.width) return;
        const [aw, ah] = this.targetArea();
        if (aw !== this.area[0] || ah !== this.area[1] || !this.areaSent) {
            this.area = [aw, ah];
            clearTimeout(this.areaTimer);
            // Debounced: re-laying out a Swing window is not free on the emulated CPU.
            this.areaTimer = setTimeout(() => {
                this.areaSent = true;
                this.send(`AREA ${aw} ${ah}`);
            }, this.areaSent ? 250 : 0);
        }
        const { clientWidth: cw, clientHeight: ch } = this.container;
        const scale = Math.min(cw / aw, ch / ah);
        Object.assign(this.viewport.style, {
            width: `${aw * scale}px`,
            height: `${ah * scale}px`,
            left: `${(cw - aw * scale) / 2}px`,
            top: `${(ch - ah * scale) / 2}px`,
        });
        Object.assign(this.screen.style, { width: `${this.width * scale}px`, height: `${this.height * scale}px` });
    }

    // ------------------------------------------------------------------ serial protocol

    listenSerial() {
        let line = [];
        this.emulator.add_listener("serial0-output-byte", (byte) => {
            if (byte !== 10) {
                line.push(byte);
                return;
            }
            const text = this.decoder.decode(new Uint8Array(line));
            line = [];
            if (text.startsWith("@@")) this.onMessage(text.slice(2));
        });
    }

    trace(text) {
        if (this.debug) this.emit("debug", { text });
    }

    onMessage(msg) {
        if (!msg.startsWith("CURSOR")) this.trace(`← ${msg.slice(0, 60)}`);
        const space = msg.indexOf(" ");
        const type = space < 0 ? msg : msg.slice(0, space);
        const arg = space < 0 ? "" : msg.slice(space + 1);
        const w = this.waiters.find((x) => x.type === type);
        if (w) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            clearTimeout(w.timer);
            w.resolve(arg);
        }
        switch (type) {
            case "STARTED": this.emit("started", { id: arg }); break;
            case "WINDOW": this.show("window"); this.emit("window"); break;
            case "TITLE": this.emit("title", { title: arg }); break;
            case "CURSOR": // Java's cursor: only meaningful over Java windows
                if (this.app?.mode === "window") this.canvas.style.cursor = CURSORS[Number(arg)] || "default";
                break;
            case "CLOSED":
                if (this.app?.mode !== "terminal") this.ended();
                break;
            case "TERMEXIT":
                if (this.app?.mode === "terminal") this.ended();
                break;
            case "ERR": this.emit("error", { message: arg }); break;
        }
    }

    ended() {
        this.app = null;
        if (this.onEnded) this.onEnded(); // closed on purpose by close()
        else this.emit("closed");
    }

    send(cmd) {
        if (!cmd.startsWith("M ") && !cmd.startsWith("PUT ")) this.trace(`→ ${cmd.slice(0, 60)}`);
        this.emulator.serial0_send(cmd + "\n");
    }

    request(cmd, type, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const w = { type, resolve };
            w.timer = setTimeout(() => {
                this.waiters.splice(this.waiters.indexOf(w), 1);
                reject(new Error(`pas de réponse à ${cmd.split(" ")[0]}`));
            }, timeout);
            this.waiters.push(w);
            this.send(cmd);
        });
    }

    // ------------------------------------------------------------------ apps

    /** Uploads and launches an app ({id, jar | exe, mode}); returns once it has started. */
    async run(app) {
        app = { mode: "window", ...app };
        if (this.app?.preloaded && this.app.id === app.id && app.mode === "window") {
            this.app = app; // already open in the snapshot
            this.emit("started", { id: app.id });
            this.show("window");
            this.emit("window");
            return;
        }
        if (this.app) await this.close();
        this.app = app;
        const file = app.exe ?? app.jar;
        const response = await fetch(new URL(file, document.baseURI));
        if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
        const b64 = toBase64(new Uint8Array(await response.arrayBuffer()));
        const kind = app.jar ? "jar" : /\.pyz?$/i.test(app.exe) ? "py" : "bin";
        await this.request(`NEW ${app.id} ${kind}`, "ACK");
        for (let i = 0; i < b64.length; i += 3072) {
            await this.request(`PUT ${b64.slice(i, i + 3072)}`, "ACK");
        }
        if (app.mode === "terminal") {
            this.send(`KMAP ${this.xLayout()}`);
            await this.request(`TERM ${app.id}`, "STARTED", 30000);
            this.show("terminal");
            this.emit("terminal");
        } else if (app.mode === "native") {
            this.send(`KMAP ${this.xLayout()}`);
            await this.request(`EXEC ${app.id}`, "STARTED", 30000);
            this.canvas.style.cursor = "default";
        } else {
            await this.request(`RUN ${app.id}`, "STARTED", 30000);
        }
    }

    /** Closes the current app without emitting "closed". */
    async close() {
        if (!this.app) return;
        const terminal = this.app.mode === "terminal";
        const closed = new Promise((r) => (this.onEnded = r));
        this.send("CLOSE");
        // A terminal session is killed at once; a window app confirms with CLOSED.
        if (!terminal) await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
        this.onEnded = null;
        this.app = null;
    }

    show(view) {
        this.viewport.hidden = false;
        // The X terminal draws no pointer of its own: show a text cursor over it.
        if (view === "terminal") this.canvas.style.cursor = "text";
        this.canvas.focus({ preventScroll: true });
    }

    // ------------------------------------------------------------------ X keyboard (terminal, native apps)

    /** Terminal and native apps get real keys (scancodes), laid out by X; Java windows get AWT events. */
    realKeys() {
        return this.app?.mode === "terminal" || this.app?.mode === "native";
    }

    /** X keyboard layout for real keys: the forced one, else the computer's. */
    xLayout() {
        if (this.keyboard !== "auto") return this.keyboard;
        return this.detectedLayout || (/^fr\b/i.test(navigator.language) ? "azerty" : "qwerty");
    }

    async detectLayout() {
        try {
            const map = await navigator.keyboard?.getLayoutMap?.();
            if (map) this.detectedLayout = map.get("KeyQ") === "a" ? "azerty" : "qwerty";
        } catch {
            // not available (Firefox, Safari, insecure context): navigator.language is used
        }
    }

    sendScancode(code, up) {
        const sc = SCANCODES[code];
        if (sc === undefined) return false;
        const bytes = sc > 0xff ? [0xe0, (sc & 0xff) | (up ? 0x80 : 0)] : [sc | (up ? 0x80 : 0)];
        this.emulator.keyboard_send_scancodes(bytes);
        return true;
    }

    /** Pastes text into the X terminal or native app: X selection, then Shift+Insert. */
    async pasteToX(text) {
        const bytes = new TextEncoder().encode(text);
        await this.request(`SEL ${toBase64(bytes)}`, "ACK");
        this.emulator.keyboard_send_scancodes([0x2a, 0xe0, 0x52, 0xe0, 0xd2, 0xaa]);
    }

    // ------------------------------------------------------------------ window input

    toScreen(e) {
        const r = this.canvas.getBoundingClientRect();
        return [
            Math.max(0, Math.min(this.area[0] - 1, Math.round((e.clientX - r.left) * this.width / r.width))),
            Math.max(0, Math.min(this.area[1] - 1, Math.round((e.clientY - r.top) * this.height / r.height))),
        ];
    }

    /** Character produced by a key with the forced layout, or null. */
    layoutChar(e) {
        const keys = LAYOUTS[this.keyboard]?.[e.code];
        if (!keys) return null;
        const altGr = e.getModifierState("AltGraph") || (e.ctrlKey && e.altKey);
        let ch = altGr ? keys[2] : e.shiftKey ? keys[1] : keys[0];
        if (ch && !altGr && e.getModifierState("CapsLock") && keys[0] !== keys[1]) {
            ch = e.shiftKey ? keys[0] : keys[1];
        }
        return ch || null;
    }

    bindInput() {
        const c = this.canvas;
        c.tabIndex = 0;
        let pending = null;
        let last = "";
        const flushMove = () => {
            if (pending) {
                const cmd = `M ${pending[0]} ${pending[1]}`;
                if (cmd !== last) this.send((last = cmd));
                pending = null;
            }
        };
        c.addEventListener("pointermove", (e) => {
            if (!pending) requestAnimationFrame(flushMove);
            pending = this.toScreen(e);
        });
        c.addEventListener("pointerdown", (e) => {
            this.trace(`pointerdown ${e.button} (focus page: ${document.hasFocus()})`);
            // No scroll on focus: the window must not move under the pointer mid-click.
            c.focus({ preventScroll: true });
            c.setPointerCapture(e.pointerId);
            // Always send the exact position first (the pointer may have entered the
            // canvas without a move event, e.g. while the loading overlay covered it).
            const [x, y] = this.toScreen(e);
            pending = null;
            this.send((last = `M ${x} ${y}`));
            this.send(`D ${e.button + 1}`);
            e.preventDefault();
        });
        c.addEventListener("pointerup", (e) => {
            pending = this.toScreen(e);
            flushMove();
            this.send(`U ${e.button + 1}`);
        });
        c.addEventListener("contextmenu", (e) => e.preventDefault());
        c.addEventListener("wheel", (e) => {
            this.send(`W ${Math.sign(e.deltaY)}`);
            e.preventDefault();
        }, { passive: false });

        const mac = /Mac|iPhone|iPad/.test(navigator.platform);
        const mods = (e) => (e.shiftKey ? 64 : 0) | (e.ctrlKey || (mac && e.metaKey) ? 128 : 0) |
            (e.altKey ? 512 : 0) | (e.getModifierState("AltGraph") ? 8192 : 0);
        const vkOf = (e, key) => {
            if (VK[key] !== undefined) return VK[key];
            if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
            if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
            const m = /^(Key|Digit)(.)$/.exec(e.code);
            return m ? m[2].charCodeAt(0) : 0;
        };
        const keyOf = (e) => (this.keyboard === "auto" ? e.key : this.layoutChar(e) ?? e.key);

        c.addEventListener("keydown", (e) => {
            this.trace(`keydown ${e.code}`);
            if (this.realKeys()) {
                // Ctrl+V / Ctrl+Shift+V / Shift+Insert: the browser fires "paste" (computer's clipboard).
                const paste = ((e.ctrlKey || e.metaKey) && e.code === "KeyV") || (e.shiftKey && e.code === "Insert");
                if (!paste && this.sendScancode(e.code, false)) e.preventDefault();
                return;
            }
            if (["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return;
            const key = keyOf(e);
            const m = mods(e);
            const altGr = e.getModifierState("AltGraph") || (this.keyboard !== "auto" && e.ctrlKey && e.altKey);
            const shortcut = (e.ctrlKey || e.metaKey) && !altGr;
            if (shortcut && key.toLowerCase() === "v") return; // handled by the paste event
            if ([...key].length === 1 && !shortcut) {
                this.send(`KP ${vkOf(e, key)} ${m} ${key.codePointAt(0)}`);
                for (const unit of key.split("")) this.send(`KT ${unit.charCodeAt(0)} ${m}`);
            } else {
                const vk = vkOf(e, key);
                if (!vk) return;
                this.send(`KP ${vk} ${m} ${CONTROL_CHARS[key] ?? -1}`);
            }
            e.preventDefault();
        });
        c.addEventListener("keyup", (e) => {
            if (this.realKeys()) {
                this.sendScancode(e.code, true);
                return;
            }
            const vk = vkOf(e, keyOf(e));
            if (vk) this.send(`KR ${vk} ${mods(e)}`);
        });
        // Text pasted from the computer's clipboard is typed into the app.
        c.addEventListener("paste", (e) => {
            const text = e.clipboardData.getData("text/plain").replace(/\r\n/g, "\n");
            if (this.realKeys()) {
                this.pasteToX(text);
                e.preventDefault();
                return;
            }
            for (const ch of text) {
                if (ch === "\n") this.send("KP 10 0 10");
                else for (const unit of ch.split("")) this.send(`KT ${unit.charCodeAt(0)} 0`);
            }
            e.preventDefault();
        });
    }
}

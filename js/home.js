// home.js — l'accueil (le menu plein écran du démarrage) : écrire, ouvrir un lien ou un fichier .ted, le hors-ligne
// (PWA : offline.js), la machine native (Docker), et ce que contient un lien reçu, avec ses avertissements.
//
// Tout ce dont il a besoin de l'application lui est passé par setupHome(app) : rien d'autre n'est partagé, ce qui
// dit d'un coup d'œil de quoi l'accueil dépend.

import { offline, fmtBytes } from "./offline.js";

/**
 * app : { S, cm, kernel, prefs, $, toast, snapPage, pageName, dirOf, cellsText, frontMatter, isDeck, LANGS, htmlHasCode,
 *         replaceDocument, loadText, loadNotebook, examples: { welcome, iris, presentation, article }, openLink, hasLink, openFile }
 * Rend { open(focus) } : focus "link" (un lien reçu), "offline" (la carte hors ligne), ou rien.
 */
export function setupHome(app) {
    const { S, cm, kernel, prefs, $, toast, snapPage, pageName, dirOf, cellsText, frontMatter, isDeck, LANGS, htmlHasCode,
        replaceDocument, loadText, loadNotebook, examples, openLink, hasLink, openFile } = app;
    // Les exemples de l'accueil : la visite, le projet Iris (deep learning), un diaporama, un article scientifique.

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    async function homeOffline() {
        const text = $("#hm-off-text"), badge = $("#hm-off-badge"), dl = $("#hm-off-dl");
        $("#hm-install").hidden = !offline.installable;
        $("#hm-install-ios").hidden = !(isIOS && !offline.installed);
        if (offline.installed) { badge.textContent = "application installée"; badge.className = "hm-badge ok"; }
        if (kernel.native) {
            text.textContent = "Rien à télécharger : TextEdit et sa machine tournent déjà sur votre ordinateur, dans le conteneur Docker.";
            badge.textContent = "sur cet ordinateur"; badge.className = "hm-badge ok";
            dl.hidden = true;
            return;
        }
        if (!offline.list) {
            text.textContent = offline.supported ? "Disponible sur le site publié : ici (serveur de développement), rien n'est gardé, pour que les fichiers modifiés ne restent pas figés." : "Ce navigateur ne sait pas garder un site hors ligne.";
            dl.disabled = true;
            return;
        }
        const st = await offline.status();
        const full = st.have >= st.total;
        if (!offline.installed) { badge.textContent = full ? "prêt hors ligne" : `${Math.floor((st.have / st.total) * 100)} %`; badge.className = `hm-badge${full ? " ok" : ""}`; }
        text.textContent = full ? `Tout est gardé dans ce navigateur (${fmtBytes(st.total)}) : TextEdit, la machine et ses compilateurs fonctionnent sans réseau.`
            : `${fmtBytes(st.have)} gardés sur ${fmtBytes(st.total)}. Téléchargez le reste pour travailler sans réseau, compilateurs compris.`;
        dl.textContent = full ? "Tout est téléchargé" : `Tout télécharger (${fmtBytes(st.total - st.have)})`;
        dl.disabled = full;
    }

    /** Ce que contient le document reçu par lien : ce que l'accueil en dit avant qu'on l'ouvre */
    function linkSummary() {
        snapPage();
        const langs = new Map();
        let blocks = 0, htmlCode = 0, outCode = 0, phrases = 0, formulas = 0, words = 0, outputs = 0, autoRun = 0;
        const text = (x) => (Array.isArray(x) ? x.join("") : String(x ?? ""));
        for (const p of S.pages) for (const c of p.cells || []) {
            if (c.type === "code" && c.lang && c.lang !== "markdown") {
                blocks++;
                langs.set(c.lang, (langs.get(c.lang) || 0) + 1);
                if (c.lang === "html" && htmlHasCode(c.source)) htmlCode++;
                if (/^\s*#\|\s*ex[ée]cuter\s*:\s*auto/im.test(c.source)) autoRun++;
                // (un bloc que la page affiche — HTML, Mermaid… — a pour résultat son propre rendu : déjà compté)
                if (LANGS[c.lang]?.engine !== "page") for (const o of c.outputs || []) { outputs++; const h = o.data?.["text/html"]; if (h && htmlHasCode(text(h))) outCode++; }
            } else {
                const t = c.source || "";
                words += (t.match(/[\p{L}\p{N}]+/gu) || []).length;
                phrases += (t.match(/(^|[^\p{L}\p{N}_])_[^_\n]{3,}?_(?![\p{L}\p{N}_])/gu) || []).length;
                formulas += Math.floor((t.match(/\$\$/g) || []).length / 2);
            }
        }
        const dirs = new Set(S.pages.map((p) => dirOf(p.path || "")).filter(Boolean));
        return { pages: S.pages.length, dirs: dirs.size, words, blocks, langs, htmlCode, outCode, phrases, formulas, outputs, autoRun,
            deck: S.pages.some((p) => isDeck(frontMatter(cellsText(p.cells || []).split("\n", 61)))) };
    }

    function showReceived() {
        const sum = linkSummary();
        const plural = (n, one, many = one + "s") => `<b>${n}</b> ${n > 1 ? many : one}`;
        $("#hm-r-title").textContent = S.title && S.title !== "Sans titre" ? S.title : pageName(0);
        $("#hm-r-hello").hidden = !S.link?.hello;
        $("#hm-r-hello").textContent = S.link?.hello ? `« ${S.link.hello} »` : "";
        const facts = [plural(sum.pages, "page") + (sum.dirs ? ` dans ${plural(sum.dirs, "dossier")}` : ""), plural(sum.words, "mot") + " de texte"];
        if (sum.blocks) facts.push(plural(sum.blocks, "bloc") + " de code : " + [...sum.langs].map(([l, n]) => `${LANGS[l]?.label || l}${n > 1 ? ` ×${n}` : ""}`).join(", "));
        else facts.push("aucun bloc de code");
        if (sum.phrases) facts.push(plural(sum.phrases, "phrase") + " exécutable" + (sum.phrases > 1 ? "s" : ""));
        if (sum.formulas) facts.push(plural(sum.formulas, "formule"));
        if (sum.outputs) facts.push(plural(sum.outputs, "résultat") + " déjà calculé" + (sum.outputs > 1 ? "s" : "") + " (affichés, rien n'est réexécuté)");
        if (sum.deck) facts.push("un <b>diaporama</b>");
        if (S.link?.ro) facts.push("en <b>lecture seule</b>");
        $("#hm-r-facts").innerHTML = facts.map((f) => `<li>${f}</li>`).join("");
        const warn = $("#hm-r-warn"), risky = sum.htmlCode + sum.outCode;
        warn.hidden = !risky && !sum.autoRun;
        warn.innerHTML = (risky ? `<b>Attention : ce lien contient ${sum.htmlCode ? `${sum.htmlCode} bloc${sum.htmlCode > 1 ? "s" : ""} HTML` : ""}${sum.htmlCode && sum.outCode ? " et " : ""}${sum.outCode ? `${sum.outCode} résultat${sum.outCode > 1 ? "s" : ""} HTML` : ""} avec du JavaScript.</b> Ne l'exécutez jamais sans être sûr de ce qu'il fait : un script peut imiter un vrai site, afficher un faux formulaire de connexion ou vous pousser à saisir des informations personnelles. TextEdit l'affiche sans l'exécuter ; même si vous l'exécutez, il n'aura aucun accès au réseau.` : "")
            + (sum.autoRun ? `${risky ? "<br>" : ""}<b>Ce diaporama demande à exécuter ${sum.autoRun} bloc${sum.autoRun > 1 ? "s" : ""} de lui-même.</b> Il ne le fera que si vous l'y autorisez, dans le bandeau du document.` : "");
    }

    function openHome(focus) {
        const dlg = $("#home");
        const link = focus === "link" && !!S.link;
        dlg.classList.toggle("received", link);
        $("#hm-received").hidden = !link;
        if (link) showReceived();
        $("#hm-skip").checked = prefs.get("home", true) === false;
        $("#hm-nat-badge").textContent = kernel.native ? "connectée" : "";
        $("#hm-nat-badge").className = `hm-badge${kernel.native ? " ok" : ""}`;
        $("#hm-nat-cmd").hidden = $("#hm-nat-copy").hidden = $("#hm-nat-open").hidden = !!kernel.native;
        $("#hm-nat-text").textContent = kernel.native ? "Cette page utilise la machine native du conteneur Docker : tous les langages et compilateurs, sans émulation (Rust compile en moins d'une seconde)." : "La même machine, sans émulation : tous les langages et compilateurs dans un conteneur Docker, sur votre ordinateur. Rien ne sort de chez vous.";
        homeOffline();
        if (!dlg.open) dlg.showModal();
        if (focus === "offline") $("#hm-offline").scrollIntoView({ block: "center" });
        if (link) { dlg.scrollTop = 0; $("#hm-r-open").focus(); }
    }
    const homeAct = (fn) => () => { $("#home").close(); fn(); };
    $("#hm-continue").addEventListener("click", homeAct(() => cm.focus()));
    $("#hm-r-open").addEventListener("click", homeAct(() => cm.focus()));
    $("#hm-r-mine").addEventListener("click", homeAct(() => $("#st-mine").click()));
    $("#hm-close").addEventListener("click", homeAct(() => cm.focus()));
    $("#hm-new").addEventListener("click", homeAct(() => replaceDocument(() => loadText("# Sans titre\n\n"))));
    $("#home").querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", homeAct(() => replaceDocument(() => loadNotebook((examples[b.dataset.ex] ?? examples.welcome)())))));
    $("#hm-file").addEventListener("click", homeAct(() => $("#open-file").click()));
    $("#hm-skip").addEventListener("change", (e) => prefs.set("home", !e.target.checked));
    $("#hm-link-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const raw = $("#hm-link").value.trim();
        let url;
        try { url = new URL(raw, location.href); } catch { toast("Ce n'est pas un lien"); return; }
        if (hasLink(url.hash)) {
            $("#home").close();
            history.replaceState(null, "", url.hash);
            $("#hm-link").value = "";
            if (await openLink()) openHome("link");
            return;
        }
        const nb = url.searchParams.get("nb");
        if (nb) { location.assign(`?nb=${encodeURIComponent(nb)}`); return; }
        toast("Ce n'est pas un lien TextEdit (il commence par …#d= ou …?nb=)");
    });
    $("#hm-off-dl").addEventListener("click", async () => {
        const bar = $("#hm-off-bar"), dl = $("#hm-off-dl");
        bar.hidden = false;
        dl.disabled = true;
        try {
            await offline.downloadAll((done, total) => { bar.style.setProperty("--p", `${(done / total) * 100}%`); dl.textContent = `${fmtBytes(done)} / ${fmtBytes(total)}…`; });
            toast("TextEdit est disponible hors ligne, machine et compilateurs compris");
        } catch (err) { toast(`Téléchargement interrompu : ${err.message}`); dl.disabled = false; }
        homeOffline();
    });
    $("#hm-install").addEventListener("click", async () => { if (await offline.install()) toast("TextEdit est installé"); homeOffline(); });
    addEventListener("textedit-installable", () => { if ($("#home").open) homeOffline(); });
    $("#hm-nat-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText($("#hm-nat-cmd").textContent); toast("Commande copiée"); } catch { toast("Copie refusée par le navigateur"); }
    });
    // Un .ted ouvert depuis le système (application installée : double-clic, « Ouvrir avec »)
    if ("launchQueue" in window) window.launchQueue.setConsumer(async (params) => { for (const h of params.files || []) openFile(await h.getFile()); });
    offline.register(() => toast("Une nouvelle version de TextEdit est prête : elle s'ouvrira au prochain démarrage", { ms: 6000 })).then(() => { if ($("#home").open) homeOffline(); });

    return { open: openHome };
}

# TextEdit

Un éditeur de texte Markdown où **le français s'exécute** et où **chaque bloc de code tourne dans une vraie machine Linux x86**, émulée dans le navigateur ([JarWeBox](https://github.com/ggoutard/JarWeBox), v86 en WebAssembly). Aucun serveur d'exécution, aucune installation : ce dépôt est un site statique, publié tel quel par GitHub Pages.

## Ce qu'on y fait

- **Écrire en français qui s'exécute** (Grama Lectica) : une phrase entre deux `_` est un ordre donné à la machine. `_Le loyer vaut 650._` puis `_Affiche le loyer plus 320._` affiche 970, pendant qu'on écrit.
- **Exécuter du code** dans 16 langages : Python 3.7 (numpy, matplotlib), SQL, JavaScript, Java, C, C++, Rust, Go, PHP, COBOL, Shell, AWK, Tcl, Scheme…
- **Passer les variables d'un langage à l'autre** (la jonction) : une variable écrite en Python se lit en C++, Rust, Java, JavaScript… et dans les phrases.
- **Ouvrir de vraies fenêtres** : tkinter, turtle et Swing s'affichent sous le bloc et se reprennent en direct.
- **Partager une page par un lien** (`/lien`) : tout le document tient dans l'adresse, après le `#`, qui n'est jamais envoyé au serveur. On choisit le mot d'accueil tapé à l'ouverture (« Bonjour Lucas »). Le destinataire peut modifier la page sans toucher à ses propres documents.
- **Exporter** : `/pdf` (le livre de toutes les pages), `/copier`, `/enregistrer` (un `.ted` : tout le projet), `/télécharger` (`.ipynb`), `/markdown`.
- **Voir le projet d'un coup d'œil** : `/diagramme` montre les pages, leurs sections, leurs blocs, les liens et les dépendances entre blocs ; un clic décompose un bloc.
- **Travailler hors ligne** : TextEdit s'installe comme une application (bureau, Android, iPhone) ; « Tout télécharger », dans l'accueil, garde aussi la machine et ses compilateurs dans le navigateur — train, avion.
- **Plus de puissance** : la même machine, sans émulation, dans un conteneur Docker (`docker run --rm -p 127.0.0.1:8780:8780 ghcr.io/ggoutard/textedit`, puis http://localhost:8780/).

Le tutoriel complet s'ouvre à la première visite (ou avec `/visite`).

## Contenu

| Dossier | Rôle |
|---|---|
| `index.html`, `css/`, `js/` | l'éditeur |
| `js/gramalectica/` | le moteur Grama Lectica (lecture des phrases, interprète, traduction en C++) |
| `kernel/` | le noyau qui tourne dans la machine (Python), le module Java (JavaScript, Java) |
| `examples/` | le tutoriel et l'exemple d'analyse de données |
| `vendor/` | bibliothèques tierces (CodeMirror, marked, KaTeX, Mermaid, Bublé, ECJ) |
| `jarwebox/` | la machine virtuelle et son image (lue par blocs, à la demande) |
| `licenses/`, `THIRD_PARTY.md`, `LICENSE` | les licences |

## Licences

Les composants tiers gardent leur licence : le tableau complet est dans [`THIRD_PARTY.md`](THIRD_PARTY.md), les textes dans [`licenses/`](licenses/), et les sources des composants GPL et LGPL dans [`licenses/SOURCES.txt`](licenses/SOURCES.txt).

Auteur : ggoutard — contact : contact.ggoutard@gmail.com

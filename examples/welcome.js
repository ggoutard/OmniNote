// welcome.js — Notebooks d'exemple : la visite de TextEdit, une analyse de données polyglotte, un article, un diaporama.
import { newCell } from "../js/notebook.js";

const md = (s) => newCell("markdown", "markdown", s.trim() + "\n");
const code = (lang, s) => newCell("code", lang, s.trim());

export function welcome() {
    return {
        id: "bienvenue",
        title: "Bienvenue dans TextEdit",
        meta: { example: true },
        updated: Date.now(),
        cells: [
            md(`
# Bienvenue dans TextEdit

Un éditeur de documents où **le code s'exécute entièrement dans votre navigateur** : quatorze langages, dans une vraie machine Linux x86 émulée en WebAssembly. Aucun serveur, aucune installation, rien qui sorte de chez vous. Le même fichier sert à **calculer**, à **présenter** et à **publier** : notebook, diaporama et article scientifique.

Ce document est une visite. Lisez-le de haut en bas, exécutez les blocs (**Maj + Entrée**), modifiez tout : c'est un document comme un autre.

> [!TIP]
> **Tout passe par \`/\`** : en début de ligne, \`/python\`, \`/rust\`… insère un bloc ; \`/exécuter\` l'exécute ; \`/présenter\` en fait un diaporama ; \`/science\` un article ; \`/pdf\`, \`/lien\` l'exportent ou le partagent. Dans un bloc, \`/\` propose les modèles de code du langage (\`/for\`, \`/fn\`, \`/select\`…).

**Au sommaire** : 1. une variable, tous les langages · 2. les quatorze langages · 3. les données en graphiques · 4. les interfaces graphiques · 5. formules, diagrammes et HTML · 6. le diaporama · 7. l'article scientifique · 8. le deep learning · 9. Cubi, l'IA locale · 10. partager · 11. raccourcis.
`),
            md(`
## 1. Une variable, tous les langages

Une variable écrite dans un langage se lit dans **tous** les autres, sous le même nom : c'est la **jonction**. La dernière écriture l'emporte. Exécutez ces blocs dans l'ordre : chacun reprend ce que les précédents ont calculé.
`),
            code("python", `
prix = 2.5
quantite = 4
noms = ["Ada", "Bob"]
stock = {"pommes": 3, "poires": 5}
`),
            code("cpp", `
double total = prix * quantite;             // prix et quantite viennent de Python
cout << total << " " << noms[1] << " " << stock["poires"] << endl;
`),
            code("rust", `
let total_ttc = total * 1.2;                // total vient de C++
let majuscules: Vec<String> = noms.iter().map(|n| n.to_uppercase()).collect();
println!("{} {:?}", total_ttc, majuscules);
`),
            code("go", `
parArticle := total_ttc / float64(quantite)
fmt.Println(parArticle, len(majuscules))
`),
            code("php", `
$etiquette = implode(" et ", $majuscules) . " : " . $parArticle . " € l'article";
echo $etiquette, "\\n";
`),
            code("javascript", `
var resume = etiquette.toUpperCase();
console.log(resume, stock.pommes + stock.poires);
`),
            code("java", `
String fin = resume + " (" + noms.size() + " clients)";
System.out.println(fin);
`),
            md(`
- Chaque valeur a sa **sorte** (entier, décimal, texte, vrai/faux, liste, dictionnaire) : un langage typé la déclare avec le bon type (\`std::vector<std::string>\` en C++, \`Vec<String>\` en Rust, \`[]string\` en Go, \`ArrayList<String>\` en Java…).
- Un nom qu'un langage ne sait pas écrire y prend sa forme sans accents (« durée » devient \`duree\` en C, Rust, shell ; \`DUREE\` en COBOL).
- Un langage compilé ne reçoit que les variables que nomme le bloc : il n'est pas recompilé quand une autre change.
`),
            md(`
## 2. Les quatorze langages

| Langage | Dans la machine | D'un bloc à l'autre |
|---|---|---|
| Python 3.7 (numpy, matplotlib) | interpréteur résident | tout l'espace de noms |
| SQL | SQLite 3.27 | la base, partagée avec Python |
| JavaScript | Nashorn, dans la JVM | les variables globales |
| Java 8 | compilé par ECJ | les classes déclarées |
| C, C++ 17, COBOL | GCC 8, GnuCOBOL 3.2 | par la jonction |
| Rust 1.41 | rustc | par la jonction |
| Go | yaegi (Go 1.22, interprété) | par la jonction |
| PHP 7.3 | interpréteur | par la jonction |
| Shell, AWK | busybox | dossier et variables exportées |
| Tcl 8.6, Scheme | interpréteurs résidents | tout l'interpréteur |

La première compilation d'une session charge le compilateur depuis l'image (C++ : environ 20 s, Rust : environ une minute) ; ensuite, un bloc modifié se recompile en 5 s environ en C++ et en C, 20 s en Rust, et un bloc inchangé n'est pas recompilé. JavaScript et Java sont prêts dès l'ouverture.

### SQL, partagé avec Python
`),
            code("sql", `
CREATE TABLE IF NOT EXISTS planetes (nom TEXT, distance_ua REAL, lunes INT);
DELETE FROM planetes;
INSERT INTO planetes VALUES ('Mercure', 0.39, 0), ('Vénus', 0.72, 0), ('Terre', 1.0, 1),
  ('Mars', 1.52, 2), ('Jupiter', 5.2, 95), ('Saturne', 9.58, 146);
SELECT nom, distance_ua, lunes FROM planetes ORDER BY lunes DESC;
`),
            code("python", `
lunes = sql("SELECT nom, lunes FROM planetes WHERE lunes > 0")   # la même base, lue depuis Python
bar([n for n, _ in lunes], [k for _, k in lunes], title="Lunes des planètes")
`),
            md(`
### JavaScript et Java
`),
            code("javascript", `
class Vecteur {
  constructor(x, y) { this.x = x; this.y = y; }
  get norme() { return Math.hypot(this.x, this.y); }
}
const v = new Vecteur(3, 4);
console.table([1, 2, 3].map((n) => ({ n, carré: n ** 2 })));
\`norme \${v.norme}\`
`),
            code("java", `
public class Fibonacci {
    public static long fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
}
`),
            code("java", `
List<Long> suite = new ArrayList<>();
for (int i = 0; i < 15; i++) suite.add(Fibonacci.fib(i));
System.out.println("Fibonacci : " + suite);
`),
            md(`
### C, C++, Rust, Go, PHP

Sans \`main\`, un bloc C, C++ ou Rust devient le corps d'un \`main\` ; un bloc Go peut être des instructions, comme dans une console ; \`<?php\` est facultatif.
`),
            code("c", `
int carres[5];
for (int i = 0; i < 5; i++) carres[i] = i * i;
printf("%d %d\\n", carres[3], carres[4]);
`),
            code("cpp", `
map<string, int> lettres;
for (char ch : string("compilateur dans le navigateur")) if (isalpha(ch)) lettres[string(1, ch)]++;
for (auto& [l, n] : lettres) if (n > 1) cout << l << " ×" << n << "  ";
cout << endl;
`),
            code("rust", `
fn fact(n: u64) -> u64 { if n <= 1 { 1 } else { n * fact(n - 1) } }
let facts: Vec<u64> = (1..=10).map(fact).collect();
println!("{:?}", facts);
`),
            code("go", `
mots := strings.Fields("quatorze langages dans une machine qui tourne dans la page")
sort.Strings(mots)
fmt.Println(len(mots), mots)
`),
            code("php", `
$villes = ["Lyon" => 690, "Nantes" => 560, "Paris" => 1120];
arsort($villes);
foreach ($villes as $v => $loyer) printf("%-8s %5d €\\n", $v, $loyer);
`),
            md(`
### COBOL, shell, AWK, Tcl, Scheme
`),
            code("cobol", `
IDENTIFICATION DIVISION.
PROGRAM-ID. INTERETS.
DATA DIVISION.
WORKING-STORAGE SECTION.
01 CAPITAL     PIC 9(7)V99 VALUE 10000.
01 TAUX        PIC 9V9999  VALUE 0.0350.
01 ANNEE       PIC 99.
01 AFFICHE     PIC Z,ZZZ,ZZ9.99.
PROCEDURE DIVISION.
    PERFORM VARYING ANNEE FROM 1 BY 1 UNTIL ANNEE > 5
        COMPUTE CAPITAL ROUNDED = CAPITAL * (1 + TAUX)
        MOVE CAPITAL TO AFFICHE
        DISPLAY "Année " ANNEE " : " AFFICHE " €"
    END-PERFORM
    STOP RUN.
`),
            code("sh", `
mkdir -p donnees && cd donnees
printf "nom,score\\nAda,92\\nAlan,88\\nGrace,95\\nLinus,79\\n" > scores.csv
export SEUIL=85
cat scores.csv
`),
            code("awk", `
# input: scores.csv
BEGIN { FS = "," }
NR > 1 && $2 >= SEUIL { printf "%-6s %3d  %s\\n", $1, $2, substr("##########", 1, $2 / 10) }
`),
            code("tcl", `
proc factorielle {n} { expr {$n <= 1 ? 1 : $n * [factorielle [expr {$n - 1}]]} }
foreach n {5 10 20} { puts "$n! = [factorielle $n]" }
`),
            code("scheme", `
(define (carre x) (* x x))
(display (map carre '(1 2 3 4 5)))
`),
            md(`
## 3. Les données en graphiques

Un bloc \`csv\` devient un graphique choisi d'après les colonnes (dates, libellés, nombres, unités) ; la barre d'outils change le type, et « Tableau » montre les données.
`),
            code("csv", `
mois,Loyer (€),Courses (€)
2026-01,650,310
2026-02,650,295
2026-03,670,340
2026-04,670,320
2026-05,670,355
`),
            md(`
En Python, la dernière expression s'affiche ; \`plot\`, \`bar\`, \`hist\`, \`Table\`, \`Chart\` et \`display\` s'affichent dans la page, et **matplotlib** aussi.
`),
            code("python", `
import math
xs = [i / 10 for i in range(0, 63)]
plot(xs, [[math.sin(x) for x in xs], [math.cos(x) * 0.6 for x in xs]], label=["sin x", "0,6 · cos x"], title="Deux ondes", xlabel="x")
`),
            code("python", `
import numpy as np
import matplotlib.pyplot as plt          # le premier import prend une minute (chargé depuis l'image)
x = np.linspace(0, 4 * np.pi, 200)
plt.plot(x, np.sin(x) * np.exp(-x / 8), label="oscillation amortie")
plt.legend(); plt.title("matplotlib dans la machine")
plt.show()
`),
            code("python", `
Table([{"langage": "Python", "année": 1991}, {"langage": "Java", "année": 1995},
       {"langage": "Rust", "année": 2015}, {"langage": "Go", "année": 2009}], title="Cliquez sur une colonne pour trier")
`),
            md(`
Une analyse complète, d'un langage à l'autre (Python, shell, SQL, JavaScript) : **\`/exemple\`**.

## 4. Les interfaces graphiques

Les fenêtres **tkinter**, **turtle** et **Swing** s'ouvrent sur l'écran de la machine : leur image s'affiche sous le bloc. **Reprendre** la montre en direct (clavier et souris passent à la fenêtre), **Détacher** l'ouvre dans une fenêtre flottante, **Plein écran** l'agrandit.
`),
            code("python", `
import tkinter as tk
fen = tk.Tk()
fen.title("Compteur")
n = tk.IntVar(value=0)
tk.Label(fen, textvariable=n, font=("Inter", 32)).pack(padx=40, pady=10)
tk.Button(fen, text="Ajouter 1", command=lambda: n.set(n.get() + 1)).pack(pady=10)
fen.update()
"Cliquez sur « Reprendre » pour utiliser la fenêtre"
`),
            code("python", `
import turtle
t = turtle.Turtle()
t.speed(0)
for i in range(36):
    t.forward(120)
    t.left(170)
turtle.update()
`),
            code("java", `
javax.swing.JFrame f = new javax.swing.JFrame("Swing dans la machine");
f.add(new javax.swing.JLabel("  Bonjour depuis Java Swing  "));
f.pack();
f.setVisible(true);
`),
            md(`
Et une interface en **HTML**, dans la page : elle s'affiche sans ses scripts ; ▶ l'exécute, dans un cadre isolé, après un avertissement.
`),
            code("html", `
<div style="display:flex;gap:10px;align-items:center;font:600 15px Inter,system-ui">
  <button onclick="this.textContent = 'Cliqué ' + (++window.n || (window.n = 1)) + ' fois'"
          style="padding:8px 16px;border-radius:999px;border:0;background:#0a84ff;color:#fff;font:inherit">Cliquez-moi</button>
  <span>Une interface en HTML, dans le document.</span>
</div>
`),
            md(`
## 5. Formules, diagrammes et HTML

Les formules s'écrivent en LaTeX, en ligne comme $e^{i\\pi} + 1 = 0$, ou en bloc. Et une équation écrite entre \`$$\` est aussi **une fonction** : les blocs Python, JavaScript, C, C++ et Rust l'appellent sans la recopier. Sous chaque formule, sa signature dit ce que les blocs peuvent appeler.

$$ f(x, y) = \\frac{x^2 + \\sqrt{y}}{2} $$

$$ \\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i $$

$$ \\sigma(x) = \\sqrt{\\frac{1}{n} \\sum_{i=1}^{n} (x_i - \\bar{x})^2} $$

$$ \\Phi(z) = \\int_{-\\infty}^{z} \\frac{e^{-t^2/2}}{\\sqrt{2\\pi}} \\, dt $$

Dans une somme, $x_i$ est le i-ième élément de la liste \`x\`, et $n$ sa longueur. La lecture comprend aussi les intégrales, les limites, les dérivées (calculées exactement), les nombres complexes, les vecteurs et les matrices.
`),
            code("python", `
notes = [12, 15, 9, 17, 14]
print(f(10, 16), x_bar(notes), sigma(notes))
print(round(Phi(1.96), 4))
`),
            code("cpp", `
vector<double> notes = {12, 15, 9, 17, 14};
cout << x_bar(notes) << " ± " << sigma(notes) << endl;
`),
            md(`
Les diagrammes **Mermaid** se dessinent dans la page :

\`\`\`mermaid
flowchart LR
  D[Document] -- jonction --> V[Machine x86 émulée]
  V --> Py[Python, SQL, shell…] & C[C, C++, Rust, COBOL] & G[Go, PHP] & J[JVM : JS, Java]
  Py & C & G & J -- variables --> D
\`\`\`

- [x] Tableaux, listes de tâches, encadrés \`> [!NOTE]\`
- [ ] Votre prochain document
`),
            md(`
## 6. Le diaporama

**\`/présenter\`** (ou **F5**) fait du document un diaporama, sans rien régler : les diapositives se séparent par \`---\`, la disposition se devine (couverture, citation, chiffre, image à côté du texte, code et résultat côte à côte), et **le code s'exécute sur la diapositive**. Les conventions de Slidev marchent telles quelles :

- \`---\` : une nouvelle diapositive ;
- \`<!-- clics -->\` avant une liste : la liste apparaît point par point ;
- \`{1|2|3-4}\` après le nom du langage d'un bloc : ses lignes se surlignent clic après clic ;
- un bloc \`md magic-move\` (quatre accents graves) : un code qui se transforme, ligne à ligne ;
- \`<span v-mark.circle.red="2">\` : un mot entouré à la main, au deuxième clic ;
- \`#| exécuter: clic\` en tête d'un bloc : il s'exécute sur la diapositive ;
- \`thème: latex\` dans l'en-tête : le style Beamer (aussi \`minuit\`, \`terminal\`, \`pop\`).

Au clavier : **O** la vue d'ensemble, **P** la vue présentateur (chronomètre, notes), **D** le crayon, **L** le laser. \`/pdf\` donne une diapositive par page.

**Un diaporama complet** : le bouton « Diaporama » de l'accueil, ou **\`/exemple présentation\`** — puis **F5**.

## 7. L'article scientifique

**\`/science\`** met le document en article, à la manière de LaTeX : la police de LaTeX (Computer Modern), le texte justifié, les sections numérotées, un bloc de titre (auteurs, date, résumé), et un PDF d'article (\`/pdf\`).

| Écrire | Pour obtenir |
|---|---|
| \`## Méthode {#sec:methode}\` | une section numérotée, que l'on cite par \`@sec:methode\` |
| \`$$ E = mc^2 $$ {#eq:energie}\` | une équation numérotée (1), citée par \`@eq:energie\` |
| \`![Légende](image.png){#fig:schema}\` | une figure numérotée et légendée |
| \`Table : Légende\` sous un tableau | un tableau numéroté, à filets dans le PDF |
| \`> [!DÉFINITION] Titre\`, \`[!THÉORÈME]\`, \`[!LEMME]\`… | des énoncés numérotés |
| \`[@einstein1905]\`, et un bloc \`bib\` (BibTeX) | une citation [1] et la liste des références |
| \`{{moyenne}}\` | **une valeur calculée** : celle d'une variable de n'importe quel langage |

En tête d'un bloc de code, \`#| fig-cap: Légende\` fait de sa sortie (un graphique) une figure numérotée, \`#| tbl-cap: Légende\` un tableau numéroté, et \`#| echo: false\` cache le code dans le PDF.

Ce que LaTeX ne sait pas faire : **les nombres du texte sont reliés au calcul qui les produit**. Relancez la simulation, et le résumé, les résultats, la figure et le tableau suivent.

**Un article complet** (la loi des grands nombres, vérifiée par simulation) : le bouton « Article scientifique » de l'accueil, ou **\`/exemple article\`**.

## 8. Le deep learning

Un réseau de neurones s'écrit, s'entraîne et se mesure ici, en numpy, sans serveur. Un perceptron à une couche cachée apprend le **ou exclusif** (XOR), qu'aucune droite ne sait séparer :
`),
            code("python", `
import numpy as np
rng = np.random.RandomState(0)
X = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)
y = np.array([[0], [1], [1], [0]], dtype=float)
W1, b1 = rng.randn(2, 8), np.zeros(8)
W2, b2 = rng.randn(8, 1), np.zeros(1)
sig = lambda z: 1 / (1 + np.exp(-z))
pertes = []
for epoque in range(2000):
    h = np.tanh(X @ W1 + b1)                  # couche cachée
    p = sig(h @ W2 + b2)                      # probabilité de 1
    pertes.append(float(np.mean((p - y) ** 2)))
    g2 = (p - y) * p * (1 - p)                # rétropropagation
    g1 = (g2 @ W2.T) * (1 - h ** 2)
    W2 -= 0.5 * h.T @ g2; b2 -= 0.5 * g2.sum(0)
    W1 -= 0.5 * X.T @ g1; b1 -= 0.5 * g1.sum(0)
print("prédictions :", p.round(2).ravel(), "· attendu :", y.ravel())
plot(list(range(len(pertes))), pertes, title="La perte descend", xlabel="époque")
`),
            md(`
**Un projet complet** : le bouton « Deep learning (projet Iris) » de l'accueil, ou **\`/exemple iris\`** — les données en SQL, une règle d'expert de référence, un perceptron écrit à la main, ses courbes d'apprentissage, ses frontières de décision, une validation croisée, puis l'article et le cours en diapositives, **dans un seul document** rangé en dossiers.

## 9. Cubi, l'IA locale

Le logo en bas à droite : **Cubi**, un modèle de langage qui tourne **dans votre navigateur** (WebGPU), sans serveur. Un clic le réveille (la première fois, il télécharge son modèle, une seule fois). Ensuite :

- **Sélectionnez un passage** et dites-lui quoi en faire : « corrige les fautes », « plus sobrement », « développe », une question. Il lit aussi le code : « remplace le print par un return ».
- **Un clic sur le logo** ouvre un grand champ : « ajoute une section sur les résultats » — il lit le plan du document et choisit lui-même où l'ajouter.
- Ses changements s'affichent **sur les mots mêmes** (barrés en rouge, ajoutés en vert), avec ✓ pour les garder et ✕ pour revenir.

## 10. Partager

- **\`/lien\`** : le document entier dans une adresse, à envoyer tel quel (rien n'est enregistré sur un serveur). On choisit le **mot d'accueil** tapé à l'ouverture à la place de « TextEdit », si les résultats des blocs voyagent avec, et s'il s'ouvre **en lecture seule**.
- **\`/pdf\`** : le document tel qu'on le lit, résultats compris ; **\`/copier\`** : le document et ses résultats dans le presse-papiers, en Markdown et mis en forme.
- **\`/télécharger\`** : un \`.ipynb\` standard (Jupyter, VS Code, GitHub) ; **\`/markdown\`** : un \`.md\` ; **\`/ouvrir\`** : un \`.ipynb\` ou un \`.md\`.
- Le document s'enregistre tout seul dans le navigateur ; **\`/hors ligne\`** garde TextEdit et sa machine pour travailler sans réseau.

## 11. Raccourcis

| Touche | Effet |
|---|---|
| \`/\` en début de ligne | le menu : blocs, commandes, mise en forme |
| Maj + Entrée | exécuter le bloc et passer à la suite |
| Ctrl + Entrée | exécuter le bloc et y rester |
| Ctrl + Espace | proposer la suite du code |
| F5 | présenter le document |
| Alt + ↓ / Alt + ↑ | titre suivant / précédent |
| Ctrl + Z | annuler |
`),
        ],
    };
}

export function article() {
    return {
        id: "article",
        title: "La loi des grands nombres, vérifiée par simulation",
        meta: { example: true },
        updated: Date.now(),
        cells: [
            md(`
---
mode: scientifique
auteurs: Xxxxx Xxxxx, Yyyyy Yyyyy
affiliation: Atelier TextEdit
date: 16 octobre 2026
résumé: Nous vérifions par simulation la loi faible des grands nombres [@bernoulli1713] : la fréquence des piles dans {{n}} lancers d'une pièce équilibrée vaut {{frequence}}, à {{ecart}} de la probabilité théorique. Les nombres de ce résumé ne sont pas recopiés : ils sont calculés par le document lui-même, et changent si l'on relance la simulation.
mots-clés: probabilités, simulation, reproductibilité
---
# La loi des grands nombres, vérifiée par simulation

## Introduction {#sec:intro}

Lancer une pièce mille fois donne-t-il à peu près cinq cents piles ? La loi des grands nombres l'affirme, et c'est l'un des plus anciens résultats des probabilités [@bernoulli1713; @feller1968]. Ce document la met à l'épreuve : les calculs sont faits par le document (section @sec:methode), et les nombres du texte en viennent directement.

> [!DÉFINITION] Fréquence empirique {#def:freq}
> Pour $n$ lancers $X_1, \\dots, X_n$ valant 1 (pile) ou 0 (face), la fréquence empirique est $\\bar X_n = \\frac{1}{n}\\sum_{i=1}^{n} X_i$.

> [!THÉORÈME] Loi faible des grands nombres {#thm:lgn}
> Si les $X_i$ sont indépendants, de même loi et d'espérance $p$, alors pour tout $\\varepsilon > 0$ :

$$ \\lim_{n \\to \\infty} \\mathbb{P}\\left(\\left|\\bar X_n - p\\right| > \\varepsilon\\right) = 0 $$ {#eq:lgn}

## Méthode {#sec:methode}

La simulation tire {{n}} lancers d'une pièce équilibrée ($p = 0{,}5$), avec une graine fixée : le résultat se reproduit à l'identique. La figure @fig:convergence suit la fréquence au fil des lancers ; le tableau @tbl:etapes en donne quelques valeurs.
`),
            code("python", `
#| fig-cap: Fréquence des piles au fil des lancers ; elle se rapproche de 0,5, comme l'annonce l'équation (1).
#| label: fig-convergence
#| echo: false
import random
random.seed(1713)
n = 2000
tirages = [random.randint(0, 1) for _ in range(n)]
piles = 0
frequences = []
for i, x in enumerate(tirages, 1):
    piles += x
    frequences.append(piles / i)
frequence = round(frequences[-1], 4)
ecart = round(abs(frequence - 0.5), 4)
etapes = [10, 100, 500, 1000, 2000]
plot(list(range(1, n + 1)), [frequences, [0.5] * n], label=["fréquence des piles", "probabilité 0,5"], xlabel="nombre de lancers")
`),
            code("python", `
#| tbl-cap: Fréquence des piles à quelques étapes de la simulation.
#| label: tbl-etapes
#| echo: false
Table([(k, round(frequences[k - 1], 4)) for k in etapes], columns=["lancers", "fréquence"])
`),
            md(`
## Résultats

Après {{n}} lancers, la fréquence vaut {{frequence}}, soit un écart de {{ecart}} à la valeur théorique : bien moins que l'ordre de grandeur $1/\\sqrt{n}$ des fluctuations attendues [@feller1968].

## Conclusion

La simulation confirme le théorème (@def:freq, équation @eq:lgn). Chaque nombre de ce texte est relié au calcul qui le produit : relancez le premier bloc avec une autre graine, et le résumé, les résultats et la figure suivent.
`),
            code("bib", `
@book{bernoulli1713, author = {Bernoulli, Jacob}, title = {Ars Conjectandi}, publisher = {Thurneysen}, year = {1713}}
@book{feller1968, author = {Feller, William}, title = {An Introduction to Probability Theory and Its Applications}, publisher = {Wiley}, volume = {1}, year = {1968}}
`),
        ],
    };
}

export function dataTour() {
    return {
        id: "analyse",
        title: "Analyse de données polyglotte",
        meta: { example: true },
        updated: Date.now(),
        cells: [
            md(`
# Analyse de données polyglotte

Un même jeu de données traverse quatre langages : généré en **Python**, nettoyé en **shell**, interrogé en **SQL**, résumé en **JavaScript**.
`),
            code("python", `
import random, csv
random.seed(42)
villes = ["Paris", "Lyon", "Nantes", "Lille", "Bordeaux"]
with open("ventes.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["jour", "ville", "montant"])
    for jour in range(1, 91):
        for v in villes:
            w.writerow([jour, v, round(random.gauss(1000 + 200 * villes.index(v), 180), 2)])
print("ventes.csv écrit")
`),
            code("sh", `
cd /tmp/lumen/work
head -4 ventes.csv
echo "…"
wc -l ventes.csv
`),
            code("python", `
import csv
with open("ventes.csv") as f:
    rows = list(csv.DictReader(f))
db.execute("DROP TABLE IF EXISTS ventes")
db.execute("CREATE TABLE ventes (jour INT, ville TEXT, montant REAL)")
db.executemany("INSERT INTO ventes VALUES (?, ?, ?)", [(int(r["jour"]), r["ville"], float(r["montant"])) for r in rows])
f"{len(rows)} lignes chargées dans SQLite"
`),
            code("sql", `
SELECT ville, COUNT(*) AS jours, ROUND(AVG(montant), 1) AS moyenne, ROUND(MAX(montant), 1) AS record
FROM ventes GROUP BY ville ORDER BY moyenne DESC;
`),
            code("python", `
par_semaine = sql("SELECT (jour - 1) / 7 AS semaine, ville, SUM(montant) FROM ventes GROUP BY semaine, ville")
fig = Figure("Chiffre d'affaires hebdomadaire", xlabel="semaine", ylabel="€")
for v in villes:
    pts = [(r[0], r[2]) for r in par_semaine if r[1] == v]
    fig.line([p[0] for p in pts], [p[1] for p in pts], v)
fig
`),
            code("javascript", `
// La JVM de la machine lit le même fichier
const Files = Java.type("java.nio.file.Files"), Paths = Java.type("java.nio.file.Paths");
const lignes = Array.from(Files.readAllLines(Paths.get("/tmp/lumen/work/ventes.csv"))).slice(1);
const total = lignes.map((l) => +l.split(",")[2]).reduce((a, b) => a + b, 0);
display.markdown(\`**Total sur 90 jours : \${Math.round(total).toLocaleString()} €** (\${lignes.length} lignes, lues par JavaScript)\`);
`),
        ],
    };
}

// ---------------------------------------------------------------- /exemple présentation

// Un petit schéma, en SVG dans le document (pas de fichier à côté)
const SCHEMA = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">
<rect width="640" height="420" rx="16" fill="#18181B"/>
<g font-family="Inter, sans-serif" font-size="22" font-weight="600" fill="#EDEDEF" text-anchor="middle">
<rect x="40" y="60" width="170" height="80" rx="8" fill="#2C2C32"/><text x="125" y="108">Texte</text>
<rect x="235" y="60" width="170" height="80" rx="8" fill="#2C2C32"/><text x="320" y="108">Formules</text>
<rect x="430" y="60" width="170" height="80" rx="8" fill="#2C2C32"/><text x="515" y="108">Code</text>
<path d="M125 140v60h390v-60M320 140v60" stroke="#6E6E78" stroke-width="2" fill="none"/>
<rect x="150" y="230" width="340" height="90" rx="8" fill="none" stroke="#6B9BFF" stroke-width="2"/>
<text x="320" y="285" fill="#6B9BFF">Machine Linux dans la page</text></g></svg>`).replace(/[()'!*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function presentation() {
    return {
        id: "presentation",
        title: "TextEdit en dix diapositives",
        meta: { example: true },
        updated: Date.now(),
        cells: [
            md(`
---
mode: présentation
auteur: Xxxxx Xxxxx
date: 16 octobre 2026
---
# TextEdit, un document qui calcule

Du texte, des formules et du code qui s'exécutent : présentés tels quels.

<!--
Ceci est une note de l'orateur : elle ne s'affiche pas sur la diapositive.
N pour la voir dessous, P pour la vue présentateur (chronomètre, diapositive suivante).
Pour changer de style : « thème: minuit » (ou classique, latex, terminal, pop) dans l'en-tête ci-dessus ;
pour les apparitions : « apparition: mots » (cascade, mots, douce, zoom, glisse, machine, aucune).
-->

---

## Ce qu'on va voir

<!-- clics -->
- Un **diaporama** écrit en Markdown, sans rien régler
- Des **formules** qui deviennent des fonctions
- Du **code** qui tourne sur la diapositive, et qu'on modifie en direct
- Des **animations** qui suivent ce qui change

<!-- La liste apparaît point par point : → ou clic. -->

---

Écrire, calculer et **présenter** dans le même fichier.

---

**12** langages qui s'exécutent dans la page, sans serveur.

---
layout: image-droite
---

## Tout est dans la page

Le texte, les formules et le code partagent leurs variables.

Une machine Linux tourne dans le navigateur : Python, Java, C, COBOL… sans serveur.

[Voir le code →](#le-code-qui-change)

![Schéma](${SCHEMA})

---

## Des formules qui calculent

$$ \\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i $$

<!-- clic -->

L'équation est aussi une fonction : le code appelle \`x_bar(notes)\` sans la recopier.

---

## Le code qui change
`),
            code("python", `
#| exécuter: auto
notes = [12, 7, 15, 9]
print("moyenne :", sum(notes) / len(notes))`),
            md(`
<!-- La diapositive suivante reprend ce code : les lignes gardées glissent, les nouvelles apparaissent. -->

---

## Le code qui change
`),
            code("python", `
#| exécuter: clic
notes = [12, 7, 15, 9]
admis = [n for n in notes if n >= 10]
print("moyenne :", sum(notes) / len(notes))
print("admis :", len(admis), "sur", len(notes))`),
            md(`
Cliquez : le bloc s'exécute. On peut aussi modifier le code ici même, puis **Maj Entrée**.

---

## Pas à pas

\`\`\`python {1|2|3-4|all}
notes = [12, 7, 15, 9]
admis = [n for n in notes if n >= 10]
print("moyenne :", sum(notes) / len(notes))
print("admis :", len(admis))
\`\`\`

<!-- Chaque clic surligne les lignes suivantes : {1|2|3-4|all}, comme dans Slidev. -->

---

## Le code se transforme

\`\`\`\`md magic-move
\`\`\`python
total = 0
for n in notes:
    total += n
\`\`\`
\`\`\`python
total = sum(notes)
\`\`\`
\`\`\`python
total = sum(notes)
moyenne = total / len(notes)
print(f"moyenne : {moyenne}")
\`\`\`
\`\`\`\`

---

## Les clics, au choix

Le code <span v-mark.underline.orange="1">s'exécute</span> sur la diapositive.

<v-click at="2">

On le <span v-mark.circle.red="3">modifie</span> en direct.

</v-click>

<v-click at="[2, 4]">

(cette ligne ne reste que deux clics)

</v-click>

<v-click at="4">

Et tout part dans un <span v-mark.box.blue>lien</span>.

</v-click>

---

## Même en COBOL
`),
            code("cobol", `
IDENTIFICATION DIVISION.
PROGRAM-ID. INTERETS.
DATA DIVISION.
WORKING-STORAGE SECTION.
01 CAPITAL     PIC 9(7)V99 VALUE 10000.
01 TAUX        PIC 9V9999  VALUE 0.0350.
01 ANNEE       PIC 99.
01 AFFICHE     PIC Z,ZZZ,ZZ9.99.
PROCEDURE DIVISION.
    PERFORM VARYING ANNEE FROM 1 BY 1 UNTIL ANNEE > 5
        COMPUTE CAPITAL ROUNDED = CAPITAL * (1 + TAUX)
        MOVE CAPITAL TO AFFICHE
        DISPLAY "Année " ANNEE " : " AFFICHE " €"
    END-PERFORM
    STOP RUN.`),
            md(`
---

## Deux colonnes

**À gauche**, ce qu'on dit.

<v-click>

Puis, au clic, ce qu'on ajoute.

</v-click>

::droite::

| Langage | Exécution |
|---|---|
| Python | machine |
| Java | machine |
| HTML | page |

---

> Le meilleur moyen de prédire l'avenir, c'est de l'inventer.
>
> Alan Kay

---

## Merci !

[Recommencer](#1) [Revenir au code](#le-code-qui-change)
`),
        ],
    };
}

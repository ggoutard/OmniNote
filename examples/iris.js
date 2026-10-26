// iris.js — le projet Iris : un projet complet, rangé en dossiers (exemple : /exemple iris, ?nb=iris).
// Données en SQL, règle d'expert de référence, formules en LaTeX appelées par Python, réseau de neurones écrit à la main
// (courbes d'apprentissage, frontières de décision, validation croisée), article scientifique et cours en diapositives. Les mesures : les iris de Fisher (1936), domaine public.
import { newCell } from "../js/notebook.js";

const md = (s) => newCell("markdown", "markdown", s.trim() + "\n");
const code = (lang, s) => newCell("code", lang, s.trim());

export function irisProject() {
    const pages = [
        { path: "Projet-Iris.md", cells: [
            md(`
# Projet Iris

Un projet complet, du début à la fin, **dans un seul document** : des données en SQL, une règle de botaniste comme référence, un réseau de neurones écrit à la main en Python — entraîné, mesuré, validé —, un article scientifique et un cours — rangés comme un vrai projet. Le jeu de données est celui des iris de Fisher (1936) : 150 fleurs, 4 mesures, 3 espèces. Petit, classique, et suffisant pour montrer chaque étape du travail sans attendre.

> [!NOTE] Pourquoi ce projet
> Un projet de *deep learning* se disperse d'habitude entre une base de données, un notebook, un éditeur LaTeX, un logiciel de diapositives et un explorateur de fichiers — et la même formule y est réécrite trois fois. Ici, tout se tient : la formule de l'article **est** la fonction qu'appelle le code, le nombre cité dans l'article **est** la variable calculée par Python, et chaque figure se redessine quand on relance l'apprentissage.

## L'arborescence

Ouvrez le terminal (\`/terminal\`, ou **>_** dans la barre d'état) et tapez \`tree\` :

\`\`\`text
/
├── Projet-Iris.md                   ce plan
├── donnees/
│   ├── Iris-en-SQL.md               les 150 fleurs, en SQL
│   └── Exploration.md               statistiques et premiers graphiques (Python)
├── connaissances/
│   └── Le-botaniste.md              une règle d'expert, la référence à battre (Python)
├── modele/
│   ├── Les-formules.md              les formules en LaTeX, appelables depuis le code
│   ├── Le-réseau-de-neurones.md     un perceptron multicouche, écrit à la main (numpy)
│   └── Frontières-et-validation.md  frontières de décision, taille du réseau, validation croisée
├── article/
│   └── Classer-les-iris.md          l'article scientifique (mode scientifique, /pdf)
├── cours/
│   └── Reconnaître-un-iris.md       le cours en diapositives (F5)
└── outils/
    └── Atelier.md                   le projet au terminal
\`\`\`

## Dans quel ordre

1. [[Iris en SQL]] — exécutez le bloc SQL : la table \`iris\` existe dans la machine, pour SQL **et** Python.
2. [[Exploration]] — Python lit la table et la décrit ; on voit déjà que les pétales séparent les espèces.
3. [[Le botaniste]] — une règle de deux seuils, sans apprentissage : elle sert de **référence**.
4. [[Les formules]] — la perte, l'entropie et le pas d'apprentissage, écrits une fois, en LaTeX.
5. [[Le réseau de neurones]] — l'apprentissage, ses courbes, l'évaluation, et la comparaison avec le botaniste.
6. [[Frontières et validation]] — ce que le réseau a appris (ses frontières), sa bonne taille, et une validation croisée à 5 plis.
7. [[Classer les iris avec un réseau de neurones|Classer les iris]] — l'article : ses nombres viennent du calcul ; \`/pdf\` le met en page.
8. [[Reconnaître un iris]] — le cours : **F5** pour le présenter.

\`/tout exécuter\` sur chaque page, dans cet ordre, suffit. **\`/pdf\` depuis n'importe quelle page** donne le livre du projet : couverture, sommaire, toutes les pages.

## Ce que montre chaque page

| Page | Langages | Ce qui s'y voit |
|---|---|---|
| Iris en SQL | SQL | une table créée, remplie et interrogée |
| Exploration | Python, SQL | \`sql()\` depuis Python, un tableau triable, un nuage de points |
| Le botaniste | Python, SQL | une règle d'expert, sa précision, ce qu'elle ne voit pas |
| Les formules | LaTeX | trois fonctions sans une ligne de code |
| Le réseau de neurones | Python | rétropropagation à la main, courbes de perte et de précision, matrice de confusion |
| Frontières et validation | Python | frontières de décision, taille du réseau, validation croisée à 5 plis |
| Classer les iris | Python, LaTeX | équations numérotées, figure et tableau légendés, références |
| Reconnaître un iris | tout | diapositives, code surligné pas à pas, exécution sur la diapositive |
`),
        ] },
        { path: "donnees/Iris-en-SQL.md", cells: [
            md(`
# Iris en SQL

Les mesures d'Edgar Anderson (1935), publiées par Ronald Fisher (1936) : pour chaque fleur, la longueur et la largeur du sépale et du pétale, en centimètres, et son espèce. La table vit dans la base SQLite de la machine : **Python la lit avec \`sql()\`** — une seule source de vérité pour tout le projet.
`),
            code("sql", `
DROP TABLE IF EXISTS iris;
CREATE TABLE iris (
  longueur_sepale REAL,
  largeur_sepale  REAL,
  longueur_petale REAL,
  largeur_petale  REAL,
  espece          TEXT
);
INSERT INTO iris VALUES
(5.1, 3.5, 1.4, 0.2, 'setosa'),
(4.9, 3.0, 1.4, 0.2, 'setosa'),
(4.7, 3.2, 1.3, 0.2, 'setosa'),
(4.6, 3.1, 1.5, 0.2, 'setosa'),
(5.0, 3.6, 1.4, 0.2, 'setosa'),
(5.4, 3.9, 1.7, 0.4, 'setosa'),
(4.6, 3.4, 1.4, 0.3, 'setosa'),
(5.0, 3.4, 1.5, 0.2, 'setosa'),
(4.4, 2.9, 1.4, 0.2, 'setosa'),
(4.9, 3.1, 1.5, 0.1, 'setosa'),
(5.4, 3.7, 1.5, 0.2, 'setosa'),
(4.8, 3.4, 1.6, 0.2, 'setosa'),
(4.8, 3.0, 1.4, 0.1, 'setosa'),
(4.3, 3.0, 1.1, 0.1, 'setosa'),
(5.8, 4.0, 1.2, 0.2, 'setosa'),
(5.7, 4.4, 1.5, 0.4, 'setosa'),
(5.4, 3.9, 1.3, 0.4, 'setosa'),
(5.1, 3.5, 1.4, 0.3, 'setosa'),
(5.7, 3.8, 1.7, 0.3, 'setosa'),
(5.1, 3.8, 1.5, 0.3, 'setosa'),
(5.4, 3.4, 1.7, 0.2, 'setosa'),
(5.1, 3.7, 1.5, 0.4, 'setosa'),
(4.6, 3.6, 1.0, 0.2, 'setosa'),
(5.1, 3.3, 1.7, 0.5, 'setosa'),
(4.8, 3.4, 1.9, 0.2, 'setosa'),
(5.0, 3.0, 1.6, 0.2, 'setosa'),
(5.0, 3.4, 1.6, 0.4, 'setosa'),
(5.2, 3.5, 1.5, 0.2, 'setosa'),
(5.2, 3.4, 1.4, 0.2, 'setosa'),
(4.7, 3.2, 1.6, 0.2, 'setosa'),
(4.8, 3.1, 1.6, 0.2, 'setosa'),
(5.4, 3.4, 1.5, 0.4, 'setosa'),
(5.2, 4.1, 1.5, 0.1, 'setosa'),
(5.5, 4.2, 1.4, 0.2, 'setosa'),
(4.9, 3.1, 1.5, 0.2, 'setosa'),
(5.0, 3.2, 1.2, 0.2, 'setosa'),
(5.5, 3.5, 1.3, 0.2, 'setosa'),
(4.9, 3.6, 1.4, 0.1, 'setosa'),
(4.4, 3.0, 1.3, 0.2, 'setosa'),
(5.1, 3.4, 1.5, 0.2, 'setosa'),
(5.0, 3.5, 1.3, 0.3, 'setosa'),
(4.5, 2.3, 1.3, 0.3, 'setosa'),
(4.4, 3.2, 1.3, 0.2, 'setosa'),
(5.0, 3.5, 1.6, 0.6, 'setosa'),
(5.1, 3.8, 1.9, 0.4, 'setosa'),
(4.8, 3.0, 1.4, 0.3, 'setosa'),
(5.1, 3.8, 1.6, 0.2, 'setosa'),
(4.6, 3.2, 1.4, 0.2, 'setosa'),
(5.3, 3.7, 1.5, 0.2, 'setosa'),
(5.0, 3.3, 1.4, 0.2, 'setosa'),
(7.0, 3.2, 4.7, 1.4, 'versicolor'),
(6.4, 3.2, 4.5, 1.5, 'versicolor'),
(6.9, 3.1, 4.9, 1.5, 'versicolor'),
(5.5, 2.3, 4.0, 1.3, 'versicolor'),
(6.5, 2.8, 4.6, 1.5, 'versicolor'),
(5.7, 2.8, 4.5, 1.3, 'versicolor'),
(6.3, 3.3, 4.7, 1.6, 'versicolor'),
(4.9, 2.4, 3.3, 1.0, 'versicolor'),
(6.6, 2.9, 4.6, 1.3, 'versicolor'),
(5.2, 2.7, 3.9, 1.4, 'versicolor'),
(5.0, 2.0, 3.5, 1.0, 'versicolor'),
(5.9, 3.0, 4.2, 1.5, 'versicolor'),
(6.0, 2.2, 4.0, 1.0, 'versicolor'),
(6.1, 2.9, 4.7, 1.4, 'versicolor'),
(5.6, 2.9, 3.6, 1.3, 'versicolor'),
(6.7, 3.1, 4.4, 1.4, 'versicolor'),
(5.6, 3.0, 4.5, 1.5, 'versicolor'),
(5.8, 2.7, 4.1, 1.0, 'versicolor'),
(6.2, 2.2, 4.5, 1.5, 'versicolor'),
(5.6, 2.5, 3.9, 1.1, 'versicolor'),
(5.9, 3.2, 4.8, 1.8, 'versicolor'),
(6.1, 2.8, 4.0, 1.3, 'versicolor'),
(6.3, 2.5, 4.9, 1.5, 'versicolor'),
(6.1, 2.8, 4.7, 1.2, 'versicolor'),
(6.4, 2.9, 4.3, 1.3, 'versicolor'),
(6.6, 3.0, 4.4, 1.4, 'versicolor'),
(6.8, 2.8, 4.8, 1.4, 'versicolor'),
(6.7, 3.0, 5.0, 1.7, 'versicolor'),
(6.0, 2.9, 4.5, 1.5, 'versicolor'),
(5.7, 2.6, 3.5, 1.0, 'versicolor'),
(5.5, 2.4, 3.8, 1.1, 'versicolor'),
(5.5, 2.4, 3.7, 1.0, 'versicolor'),
(5.8, 2.7, 3.9, 1.2, 'versicolor'),
(6.0, 2.7, 5.1, 1.6, 'versicolor'),
(5.4, 3.0, 4.5, 1.5, 'versicolor'),
(6.0, 3.4, 4.5, 1.6, 'versicolor'),
(6.7, 3.1, 4.7, 1.5, 'versicolor'),
(6.3, 2.3, 4.4, 1.3, 'versicolor'),
(5.6, 3.0, 4.1, 1.3, 'versicolor'),
(5.5, 2.5, 4.0, 1.3, 'versicolor'),
(5.5, 2.6, 4.4, 1.2, 'versicolor'),
(6.1, 3.0, 4.6, 1.4, 'versicolor'),
(5.8, 2.6, 4.0, 1.2, 'versicolor'),
(5.0, 2.3, 3.3, 1.0, 'versicolor'),
(5.6, 2.7, 4.2, 1.3, 'versicolor'),
(5.7, 3.0, 4.2, 1.2, 'versicolor'),
(5.7, 2.9, 4.2, 1.3, 'versicolor'),
(6.2, 2.9, 4.3, 1.3, 'versicolor'),
(5.1, 2.5, 3.0, 1.1, 'versicolor'),
(5.7, 2.8, 4.1, 1.3, 'versicolor'),
(6.3, 3.3, 6.0, 2.5, 'virginica'),
(5.8, 2.7, 5.1, 1.9, 'virginica'),
(7.1, 3.0, 5.9, 2.1, 'virginica'),
(6.3, 2.9, 5.6, 1.8, 'virginica'),
(6.5, 3.0, 5.8, 2.2, 'virginica'),
(7.6, 3.0, 6.6, 2.1, 'virginica'),
(4.9, 2.5, 4.5, 1.7, 'virginica'),
(7.3, 2.9, 6.3, 1.8, 'virginica'),
(6.7, 2.5, 5.8, 1.8, 'virginica'),
(7.2, 3.6, 6.1, 2.5, 'virginica'),
(6.5, 3.2, 5.1, 2.0, 'virginica'),
(6.4, 2.7, 5.3, 1.9, 'virginica'),
(6.8, 3.0, 5.5, 2.1, 'virginica'),
(5.7, 2.5, 5.0, 2.0, 'virginica'),
(5.8, 2.8, 5.1, 2.4, 'virginica'),
(6.4, 3.2, 5.3, 2.3, 'virginica'),
(6.5, 3.0, 5.5, 1.8, 'virginica'),
(7.7, 3.8, 6.7, 2.2, 'virginica'),
(7.7, 2.6, 6.9, 2.3, 'virginica'),
(6.0, 2.2, 5.0, 1.5, 'virginica'),
(6.9, 3.2, 5.7, 2.3, 'virginica'),
(5.6, 2.8, 4.9, 2.0, 'virginica'),
(7.7, 2.8, 6.7, 2.0, 'virginica'),
(6.3, 2.7, 4.9, 1.8, 'virginica'),
(6.7, 3.3, 5.7, 2.1, 'virginica'),
(7.2, 3.2, 6.0, 1.8, 'virginica'),
(6.2, 2.8, 4.8, 1.8, 'virginica'),
(6.1, 3.0, 4.9, 1.8, 'virginica'),
(6.4, 2.8, 5.6, 2.1, 'virginica'),
(7.2, 3.0, 5.8, 1.6, 'virginica'),
(7.4, 2.8, 6.1, 1.9, 'virginica'),
(7.9, 3.8, 6.4, 2.0, 'virginica'),
(6.4, 2.8, 5.6, 2.2, 'virginica'),
(6.3, 2.8, 5.1, 1.5, 'virginica'),
(6.1, 2.6, 5.6, 1.4, 'virginica'),
(7.7, 3.0, 6.1, 2.3, 'virginica'),
(6.3, 3.4, 5.6, 2.4, 'virginica'),
(6.4, 3.1, 5.5, 1.8, 'virginica'),
(6.0, 3.0, 4.8, 1.8, 'virginica'),
(6.9, 3.1, 5.4, 2.1, 'virginica'),
(6.7, 3.1, 5.6, 2.4, 'virginica'),
(6.9, 3.1, 5.1, 2.3, 'virginica'),
(5.8, 2.7, 5.1, 1.9, 'virginica'),
(6.8, 3.2, 5.9, 2.3, 'virginica'),
(6.7, 3.3, 5.7, 2.5, 'virginica'),
(6.7, 3.0, 5.2, 2.3, 'virginica'),
(6.3, 2.5, 5.0, 1.9, 'virginica'),
(6.5, 3.0, 5.2, 2.0, 'virginica'),
(6.2, 3.4, 5.4, 2.3, 'virginica'),
(5.9, 3.0, 5.1, 1.8, 'virginica');
SELECT espece, COUNT(*) AS fleurs FROM iris GROUP BY espece;
`),
            md(`
## Trois questions à la table

Le pétale le plus long de chaque espèce, et l'écart entre les espèces : un premier indice que les pétales suffiront presque à les distinguer.
`),
            code("sql", `
SELECT espece,
       ROUND(AVG(longueur_petale), 2) AS petale_moyen,
       MIN(longueur_petale)           AS petale_min,
       MAX(longueur_petale)           AS petale_max
FROM iris GROUP BY espece ORDER BY petale_moyen;
`),
            code("sql", `
SELECT COUNT(*) AS fleurs_a_petale_court FROM iris WHERE longueur_petale < 2.5;
`),
        ] },
        { path: "donnees/Exploration.md", cells: [
            md(`
# Exploration

Python lit la table SQL de la page [[Iris en SQL]] (exécutez-la d'abord), en fait des tableaux numpy, et la décrit. Les variables créées ici (\`X\`, \`y\`, \`especes\`) restent dans la machine : la page [[Le réseau de neurones]] s'en sert.
`),
            code("python", `
import numpy as np

iris = sql("SELECT longueur_sepale, largeur_sepale, longueur_petale, largeur_petale, espece FROM iris")
especes = sorted(set(r[4] for r in iris))
X = np.array([r[:4] for r in iris], dtype=float)
y = np.array([especes.index(r[4]) for r in iris])
mesures = ["sépale L", "sépale l", "pétale L", "pétale l"]

print(len(X), "fleurs,", len(especes), "espèces :", ", ".join(especes))
Table([[e] + [round(float(v), 2) for v in X[y == k].mean(axis=0)] for k, e in enumerate(especes)],
      columns=["espèce (moyennes, cm)"] + mesures)
`),
            md(`
Les pétales de *setosa* sont trois fois plus courts que les autres ; *versicolor* et *virginica* se recouvrent un peu. Les deux droites en pointillés sont la règle du botaniste de la page [[Le botaniste]].
`),
            code("python", `
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6.4, 4))
for k, e in enumerate(especes):
    ax.scatter(X[y == k, 2], X[y == k, 3], s=16, label=e)
ax.axvline(2.5, ls="--", lw=1, color="gray")   # longueur du pétale ≤ 2,5 : setosa
ax.axhline(1.7, ls=":", lw=1, color="gray")    # largeur du pétale ≤ 1,7 : versicolor
ax.set_xlabel("longueur du pétale (cm)")
ax.set_ylabel("largeur du pétale (cm)")
ax.set_title("Les pétales séparent presque les trois espèces")
ax.legend()
plt.show()
`),
        ] },
        { path: "connaissances/Le-botaniste.md", cells: [
            md(`
# Le botaniste

Avant tout apprentissage, ce qu'un botaniste dirait : *un iris à pétale court est un setosa ; sinon, un pétale étroit fait un versicolor ; sinon c'est un virginica*. Deux seuils, aucun apprentissage : cette règle donne la **référence** que le réseau devra battre. Elle s'applique à chaque fleur de la table SQL (exécutez d'abord [[Iris en SQL]]).
`),
            code("python", `
def botaniste(longueur_petale, largeur_petale):
    if longueur_petale <= 2.5:
        return "setosa"
    if largeur_petale <= 1.7:
        return "versicolor"
    return "virginica"

fleurs = sql("SELECT longueur_petale, largeur_petale, espece FROM iris")
bonnes = sum(botaniste(l, w) == espece for l, w, espece in fleurs)
precision_botaniste = round(bonnes / len(fleurs), 3)
print("Le botaniste reconnaît", bonnes, "fleurs sur", len(fleurs), "soit", precision_botaniste)
`),
            md(`
## Ce que la règle ne voit pas

Les fleurs à long pétale étroit : la règle les dit *versicolor*, certaines sont des *virginica*.
`),
            code("sql", `
SELECT espece, COUNT(*) AS fleurs
FROM iris WHERE longueur_petale > 4.8 AND largeur_petale <= 1.7
GROUP BY espece;
`),
            md(`
Une frontière droite ne suffit pas tout à fait ; un réseau de neurones trace des frontières courbes (page [[Frontières et validation]]). La précision du botaniste, \`precision_botaniste\`, reste dans la machine : le réseau, l'article et le cours la reprennent.
`),
        ] },
        { path: "modele/Les-formules.md", cells: [
            md(`
# Les formules

Chaque formule est écrite **une seule fois**, en LaTeX, et devient une fonction que le code appelle sans la recopier (la signature s'affiche sous l'équation). Ce sont aussi celles de l'article : il n'y a pas de seconde version à tenir à jour.

Le pas d'apprentissage décroît avec les époques $t$ :

$$ \\eta(t) = \\frac{0{,}5}{1 + 0{,}005\\, t} $$

L'entropie croisée entre la prédiction $p$ (des probabilités) et la vraie classe $y$ (un vecteur « un parmi trois ») — la perte que le réseau minimise :

$$ \\mathrm{perte}(p, y) = -\\sum_{i} y_i \\ln p_i $$

L'entropie d'une prédiction : 0 quand le réseau est certain, $\\ln 3 \\approx 1{,}1$ quand il hésite entre les trois espèces :

$$ \\mathrm{entropie}(p) = -\\sum_{i} p_i \\ln p_i $$

Dans une somme, $y_i$ est le i-ième élément de la liste $y$ : les fonctions prennent des listes (ou des tableaux numpy). Une vérification immédiate, dans le texte : une prédiction qui hésite entre trois espèces a une entropie de $\\ln 3$.
`),
            code("python", `
print("η(0) =", eta(0), "· η(200) =", eta(200))
print("perte d'une prédiction juste à 70 % :", round(perte([0.7, 0.2, 0.1], [1, 0, 0]), 4))
print("entropie d'une hésitation complète :", round(entropie([1/3, 1/3, 1/3]), 4))
`),
        ] },
        { path: "modele/Le-réseau-de-neurones.md", cells: [
            md(`
# Le réseau de neurones

Un perceptron à une couche cachée — 4 entrées, 8 neurones \`tanh\`, 3 sorties \`softmax\` : 67 paramètres. Pas de bibliothèque d'apprentissage : la propagation, la rétropropagation et la descente de gradient sont écrites à la main avec numpy, pour qu'on voie tout. Les variables \`X\`, \`y\`, \`especes\` viennent de [[Exploration]] ; le pas d'apprentissage \`eta\`, la \`perte\` et l'\`entropie\` viennent de [[Les formules]].

## Préparer les données

Les mesures sont centrées et réduites (un réseau apprend mal quand les entrées n'ont pas la même échelle) ; 45 fleurs, tirées au hasard avec une graine fixée, sont mises de côté pour le test.
`),
            code("python", `
import numpy as np

rng = np.random.RandomState(42)
mu, sd = X.mean(axis=0), X.std(axis=0)
Xn = (X - mu) / sd
Y = np.eye(3)[y]                       # une classe = un vecteur « un parmi trois »
ordre = rng.permutation(len(X))
test, apprentissage = ordre[:45], ordre[45:]
print(len(apprentissage), "fleurs pour apprendre,", len(test), "pour le test")
`),
            md(`
## Apprendre

À chaque époque : la propagation calcule les probabilités, la perte mesure l'erreur, la rétropropagation donne la pente de la perte pour chaque paramètre, et chaque paramètre descend la pente d'un pas $\\eta(t)$. L'apprentissage est une fonction, \`entrainer\` : la page [[Frontières et validation]] la reprend pour d'autres tailles de réseau et d'autres découpages des données. Toutes les 5 époques, elle note la précision sur les fleurs d'apprentissage **et** sur celles du test, que le réseau ne voit jamais : c'est ainsi qu'on voit s'il apprend ou s'il récite.
`),
            code("python", `
def softmax(z):
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)

def propager(P, X):
    h = np.tanh(X @ P["W1"] + P["b1"])
    return h, softmax(h @ P["W2"] + P["b2"])

def precision(P, X, y):
    return float((propager(P, X)[1].argmax(axis=1) == y).mean())

def entrainer(Xa, ya, n_caches=8, epoques=400, graine=42, suivi=None):
    """Un perceptron à une couche cachée, appris par descente de gradient. Rend (paramètres, pertes)."""
    r = np.random.RandomState(graine)
    Ya = np.eye(3)[ya]
    P = {"W1": r.randn(Xa.shape[1], n_caches) * 0.5, "b1": np.zeros(n_caches),
         "W2": r.randn(n_caches, 3) * 0.5, "b2": np.zeros(3)}
    pertes = []
    for t in range(epoques):
        h, p = propager(P, Xa)
        pertes.append(float(-np.mean(np.sum(Ya * np.log(p + 1e-12), axis=1))))   # la formule perte, en moyenne
        g2 = (p - Ya) / len(Xa)                  # pente de la perte par rapport aux scores de sortie
        g1 = (g2 @ P["W2"].T) * (1 - h ** 2)     # rétropropagée à travers tanh
        pas = eta(t)
        P["W2"] -= pas * h.T @ g2
        P["b2"] -= pas * g2.sum(axis=0)
        P["W1"] -= pas * Xa.T @ g1
        P["b1"] -= pas * g1.sum(axis=0)
        if suivi and t % 5 == 0:
            suivi(t, P)
    return P, pertes

courbes = {"époque": [], "apprentissage": [], "test": []}
def noter(t, P):
    courbes["époque"].append(t)
    courbes["apprentissage"].append(precision(P, Xn[apprentissage], y[apprentissage]))
    courbes["test"].append(precision(P, Xn[test], y[test]))

P, historique = entrainer(Xn[apprentissage], y[apprentissage], suivi=noter)
print("perte : %.3f au départ, %.3f après %d époques" % (historique[0], historique[-1], len(historique)))
`),
            code("python", `
import matplotlib.pyplot as plt

fig, (a, b) = plt.subplots(1, 2, figsize=(9, 3.2))
a.plot(historique)
a.set_yscale("log")
a.set_xlabel("époque")
a.set_title("La perte descend, puis se stabilise")
b.plot(courbes["époque"], courbes["apprentissage"], label="apprentissage")
b.plot(courbes["époque"], courbes["test"], label="test (jamais vu)")
b.set_ylim(0.3, 1.02)
b.set_xlabel("époque")
b.set_title("Précision : il apprend, sans réciter")
b.legend()
plt.tight_layout()
plt.show()
`),
            md(`
Les deux courbes de précision montent ensemble et restent proches : le réseau **généralise**. Si celle de l'apprentissage montait seule pendant que celle du test baissait, il apprendrait les fleurs par cœur (le *surapprentissage*).
`),
            md(`
## Évaluer, et comparer au botaniste

Sur les 45 fleurs que le réseau n'a jamais vues. La perte moyenne est calculée avec la formule \`perte\` — celle de l'article — et l'incertitude avec la formule \`entropie\`.
`),
            code("python", `
_, p_test = propager(P, Xn[test])
prediction = p_test.argmax(axis=1)
acc_test = round(float((prediction == y[test]).mean()), 3)
perte_test = round(float(np.mean([perte(p_test[k], Y[test][k]) for k in range(len(test))])), 3)
incertitude = round(float(np.mean([entropie(q) for q in p_test])), 3)
erreurs = int((prediction != y[test]).sum())

print("précision sur le test :", acc_test, "(", erreurs, "erreurs sur", len(test), ")")
print("perte moyenne :", perte_test, "· entropie moyenne :", incertitude)
try:
    print("le botaniste, sur les 150 fleurs :", precision_botaniste)
except NameError:
    print("(exécutez la page Le botaniste pour la comparaison)")

confusion = np.zeros((3, 3), dtype=int)
for vrai, predit in zip(y[test], prediction):
    confusion[vrai, predit] += 1
Table([[especes[i]] + [int(v) for v in confusion[i]] for i in range(3)], columns=["réel \\\\ prédit"] + especes)
`),
        ] },
        { path: "modele/Frontières-et-validation.md", cells: [
            md(`
# Frontières et validation

Trois questions qu'on se pose devant tout réseau : **qu'a-t-il appris ?** (ses frontières), **quelle taille lui faut-il ?**, et **sa précision tient-elle** si l'on change les fleurs du test ? La fonction \`entrainer\` vient de [[Le réseau de neurones]] (exécutez-la d'abord).

## Ce que le réseau a appris

Un réseau appris sur les deux mesures du pétale seulement, pour pouvoir tout dessiner : chaque point du plan est coloré selon l'espèce qu'il prédit. Les frontières sont **courbes**, là où le botaniste trace deux droites (en pointillés).
`),
            code("python", `
import matplotlib.pyplot as plt

P2, _ = entrainer(Xn[apprentissage][:, 2:], y[apprentissage], n_caches=8)
gx, gy = np.meshgrid(np.linspace(-1.8, 1.9, 160), np.linspace(-1.7, 1.9, 160))
grille = np.c_[gx.ravel(), gy.ravel()]
zone = propager(P2, grille)[1].argmax(axis=1).reshape(gx.shape)

plt.figure(figsize=(6.4, 4.4))
plt.contourf(gx * sd[2] + mu[2], gy * sd[3] + mu[3], zone, levels=[-0.5, 0.5, 1.5, 2.5], alpha=0.25)
for k, e in enumerate(especes):
    plt.scatter(X[y == k, 2], X[y == k, 3], s=14, label=e)
plt.axvline(2.5, ls="--", lw=1, color="gray")
plt.axhline(1.7, ls=":", lw=1, color="gray")
plt.xlabel("longueur du pétale (cm)")
plt.ylabel("largeur du pétale (cm)")
plt.title("Frontières du réseau (couleurs) et du botaniste (pointillés)")
plt.legend()
plt.show()
`),
            md(`
## Quelle taille de réseau ?

Le même apprentissage avec 2, 4, 8 et 16 neurones cachés. Sur un problème aussi simple, quelques neurones suffisent déjà : davantage fait encore baisser la perte, mais coûte des paramètres sans gagner en précision. Sur un problème plus dur, c'est ce tableau qui dit où s'arrêter.
`),
            code("python", `
tailles = []
for n_caches in [2, 4, 8, 16]:
    Pn, pn = entrainer(Xn[apprentissage], y[apprentissage], n_caches=n_caches)
    parametres = 4 * n_caches + n_caches + n_caches * 3 + 3
    tailles.append([n_caches, parametres, round(pn[-1], 3), round(precision(Pn, Xn[test], y[test]), 3)])
Table(tailles, columns=["neurones cachés", "paramètres", "perte finale", "précision (test)"])
`),
            md(`
## Validation croisée à 5 plis

Une seule séparation apprentissage / test laisse une part de hasard : 45 fleurs, c'est peu, et une erreur de plus pèse deux points de précision. La **validation croisée** découpe les 150 fleurs en 5 parts ; chacune sert de test une fois, pendant que le réseau apprend sur les 4 autres. La précision annoncée est la moyenne des 5, avec son écart.
`),
            code("python", `
plis = np.array_split(np.random.RandomState(7).permutation(len(X)), 5)
scores = []
for k, test_k in enumerate(plis):
    appr_k = np.concatenate([plis[j] for j in range(5) if j != k])
    Pk, _ = entrainer(Xn[appr_k], y[appr_k], graine=k)
    scores.append(precision(Pk, Xn[test_k], y[test_k]))
cv_moyenne = round(float(np.mean(scores)), 3)
cv_ecart = round(float(np.std(scores)), 3)
print("précision par pli :", [round(s, 3) for s in scores])
print("validation croisée : %.3f ± %.3f" % (cv_moyenne, cv_ecart))
bar(["pli %d" % (k + 1) for k in range(5)], scores, title="Précision sur chaque pli")
`),
        ] },
        { path: "article/Classer-les-iris.md", cells: [
            md(`
---
mode: scientifique
auteurs: Projet Iris
affiliation: Atelier OmniNote
date: 17 octobre 2026
résumé: Nous comparons une règle de botaniste à deux seuils à un perceptron multicouche de 67 paramètres appris par descente de gradient sur les iris de Fisher [@fisher1936]. Le réseau atteint une précision de {{acc_test}} sur 45 fleurs de test, et de {{cv_moyenne}} ± {{cv_ecart}} en validation croisée à 5 plis, pour une entropie moyenne de {{incertitude}} ; la règle obtient {{precision_botaniste}} sur les 150 fleurs.
mots-clés: réseau de neurones, rétropropagation, iris, reproductibilité
---
# Classer les iris avec un réseau de neurones

## Introduction {#sec:intro}

Les mesures de 150 iris recueillies par Anderson [@anderson1935] et analysées par Fisher [@fisher1936] sont le premier banc d'essai de la classification. Nous y comparons une règle d'expert à un réseau de neurones appris par rétropropagation du gradient [@rumelhart1986]. Tout ce texte est relié au calcul : chaque nombre cité vient du code qui l'a produit.

## Données {#sec:donnees}

Chaque fleur est décrite par quatre mesures (longueur et largeur du sépale et du pétale) et appartient à l'une de trois espèces, à raison de 50 par espèce. Les mesures sont centrées et réduites ; 45 fleurs tirées au hasard (graine 42) forment le jeu de test.

## Méthode {#sec:methode}

> [!DÉFINITION] Perceptron à une couche cachée {#def:mlp}
> Pour une fleur $x \\in \\mathbb{R}^4$, la couche cachée calcule $h^{(1)} = \\tanh(W_1 x + b_1)$ avec 8 neurones, et la sortie des probabilités par la fonction softmax.

$$ \\mathrm{softmax}(z)_k = \\frac{e^{z_k}}{\\sum_{j} e^{z_j}} $$ {#eq:softmax}

Le réseau minimise l'entropie croisée moyenne entre ses prédictions $p$ et les classes vraies $y$ :

$$ \\mathrm{perte}(p, y) = -\\sum_{i} y_i \\ln p_i $$ {#eq:perte}

par descente de gradient, avec un pas décroissant :

$$ \\eta(t) = \\frac{0{,}5}{1 + 0{,}005\\, t} $$ {#eq:pas}

L'incertitude d'une prédiction est mesurée par son entropie, nulle quand le réseau est certain :

$$ \\mathrm{entropie}(p) = -\\sum_{i} p_i \\ln p_i $$ {#eq:entropie}

Les équations @eq:perte, @eq:pas et @eq:entropie ne sont pas recopiées dans le code : ce sont les fonctions qu'il appelle.

## Résultats {#sec:resultats}

Après 400 époques, la perte d'apprentissage (figure @fig:perte) est stabilisée. Sur le jeu de test, le réseau atteint une précision de {{acc_test}}, une perte moyenne de {{perte_test}} (équation @eq:perte) et une entropie moyenne de {{incertitude}} (équation @eq:entropie). En validation croisée à 5 plis, la précision vaut {{cv_moyenne}} ± {{cv_ecart}}. La règle du botaniste, sans aucun apprentissage, obtient {{precision_botaniste}} sur l'ensemble des 150 fleurs.
`),
            code("python", `
#| fig-cap: Perte d'apprentissage (entropie croisée, échelle logarithmique) au fil des époques.
#| label: fig-perte
#| echo: false
import matplotlib.pyplot as plt
plt.figure(figsize=(6, 2.8))
plt.plot(historique)
plt.yscale("log")
plt.xlabel("époque")
plt.ylabel("perte")
plt.show()
`),
            code("python", `
#| tbl-cap: Matrice de confusion du réseau sur les 45 fleurs de test (lignes : espèce réelle).
#| label: tbl-confusion
#| echo: false
Table([[especes[i]] + [int(v) for v in confusion[i]] for i in range(3)], columns=["réel \\\\ prédit"] + especes)
`),
            md(`
## Discussion {#sec:discussion}

*Setosa* est séparé sans erreur par les deux méthodes. Les six erreurs de la règle opposent toutes *versicolor* et *virginica*, dont les pétales se recouvrent ; le réseau commet {{erreurs}} erreur(s) sur les 45 fleurs de test (tableau @tbl:confusion). Sur si peu de fleurs, une erreur pèse plus de deux points de précision : c'est pourquoi la validation croisée, qui fait passer chaque fleur une fois dans le test, donne une estimation plus sûre ({{cv_moyenne}} ± {{cv_ecart}}). L'écart entre les deux méthodes reste faible. Qu'une règle de deux seuils rivalise avec le réseau rappelle que, sur un problème aussi simple, la connaissance du domaine vaut un apprentissage [@goodfellow2016] ; le réseau apporte des frontières courbes et une mesure de son incertitude.

## Conclusion

Données, règle de référence, formules, code et texte forment ici un seul objet : relancer l'apprentissage avec une autre graine met à jour le résumé, les résultats, la figure et le tableau.
`),
            code("bib", `
@article{fisher1936, author = {Fisher, Ronald A.}, title = {The Use of Multiple Measurements in Taxonomic Problems}, journal = {Annals of Eugenics}, volume = {7}, pages = {179--188}, year = {1936}}
@article{anderson1935, author = {Anderson, Edgar}, title = {The Irises of the Gaspé Peninsula}, journal = {Bulletin of the American Iris Society}, volume = {59}, pages = {2--5}, year = {1935}}
@article{rumelhart1986, author = {Rumelhart, David E. and Hinton, Geoffrey E. and Williams, Ronald J.}, title = {Learning Representations by Back-Propagating Errors}, journal = {Nature}, volume = {323}, pages = {533--536}, year = {1986}}
@book{goodfellow2016, author = {Goodfellow, Ian and Bengio, Yoshua and Courville, Aaron}, title = {Deep Learning}, publisher = {MIT Press}, year = {2016}}
`),
        ] },
        { path: "cours/Reconnaître-un-iris.md", cells: [
            md(`
---
mode: présentation
thème: classique
---

# Reconnaître un iris

Un réseau de neurones, de la donnée au résultat

---

## Le problème

<!-- clics -->
- 150 fleurs, mesurées en 1935
- 4 mesures : sépale et pétale, longueur et largeur
- 3 espèces : *setosa*, *versicolor*, *virginica*
- La question : **à partir des mesures, quelle espèce ?**

---

## D'abord, un botaniste

Une règle de deux seuils, sans apprentissage :

\`\`\`python
#| exécuter: clic
print("précision du botaniste :", precision_botaniste)
\`\`\`

<!-- La variable vient de la page « Le botaniste » : elle vaut pour tout le projet. -->

---

## Un neurone

Une somme pondérée des mesures, puis une courbe qui la « tasse » entre −1 et 1 :

$$ h^{(1)} = \\tanh(W_1 x + b_1) $$

Huit neurones en parallèle forment une **couche cachée**.

---

## Le réseau

\`\`\`mermaid
flowchart LR
  M[4 mesures] --> C[8 neurones tanh] --> S[3 probabilités softmax]
\`\`\`

67 paramètres à régler : c'est l'**apprentissage**.

---

## Apprendre, c'est descendre la pente

\`\`\`python {1|2|3-4|5-6|all}
h, p = propager(P, Xa)            # 1. prédire
g2 = (p - Ya) / len(Xa)           # 2. mesurer l'erreur
g1 = (g2 @ P["W2"].T) * (1 - h ** 2)   # 3. la remonter
pas = eta(t)                      #    jusqu'à chaque poids
P["W2"] -= pas * h.T @ g2         # 4. corriger d'un pas
P["W1"] -= pas * Xa.T @ g1        #    dans le bon sens
\`\`\`

---

## Le résultat

\`\`\`python
#| exécuter: clic
print("réseau :", acc_test, "sur des fleurs jamais vues")
print("validation croisée :", cv_moyenne, "±", cv_ecart)
print("botaniste :", precision_botaniste)
\`\`\`

---

## À retenir

- Une **règle d'expert** est une excellente référence
- Le réseau apprend des frontières **courbes**, et dit quand il **hésite** (entropie)
- Une **validation croisée** dit si la précision tient
- Données, formules, code, article et cours : **un seul document**

[Recommencer](#1)
`),
        ] },
        { path: "outils/Atelier.md", cells: [
            md(`
# Atelier

Le projet se range et se fouille au **terminal** (\`/terminal\`, ou **>_** dans la barre d'état), avec les commandes de Linux : les pages sont des fichiers, rangés dans des dossiers.

## À essayer au terminal

\`\`\`text
tree                                       l'arborescence du projet
grep -n perte *                            où la perte apparaît (un clic ouvre la ligne)
open modele/Le-réseau-de-neurones.md       ouvrir une page
mkdir publication && cp article/Classer-les-iris.md publication/
mv cours/Reconnaître-un-iris.md cours/Le-cours.md      le titre et les liens suivent
\`\`\`

## Le livre

\`/pdf\` met tout le projet dans un livre : une couverture, un sommaire par dossiers, puis chaque page — l'article en article, le cours en diapositives.
`),
        ] },
    ];
    return { id: "iris", title: "Projet Iris", meta: { example: true }, updated: Date.now(), cells: pages[0].cells, pages, page: 0,
        dirs: ["donnees", "connaissances", "modele", "article", "cours", "outils"] };
}

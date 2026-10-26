// langue.js — l'article « Programmer en français » : ce que Grama Lectica sait faire, démontré par l'article lui-même.
// Chaque phrase _…_ s'exécute pendant qu'on lit ; les nombres du texte ({{…}}) sont ceux qu'elles calculent.
import { newCell } from "../js/notebook.js";

const md = (s) => newCell("markdown", "markdown", s.trim() + "\n");
const code = (lang, s) => newCell("code", lang, s.trim());

export function langueArticle() {
    return {
        id: "article-langue",
        title: "Programmer en français",
        meta: { example: true },
        updated: Date.now(),
        cells: [
            md(`
---
mode: scientifique
auteurs: Atelier TextEdit
affiliation: TextEdit, dans votre navigateur
date: 18 octobre 2026
résumé: Nous montrons qu'un fragment du français, lu sans ambiguïté, suffit à programmer, et surtout qu'un document écrit ainsi **sait ce que sont ses données** — sans rien exécuter, sans modèle de langage, sans serveur. De ses seules phrases, de ses tableaux et de leurs unités, il déduit que « les opérations » sont une liste de sommes, qu'un loyer et une surface ne s'additionnent pas, à quoi renvoie un pronom, quelle faute de frappe a du sens. Ce savoir, un treillis de sortes inféré dans les deux sens, devient le juge de tout le reste : il répare, tranche, apprend et vérifie. Cet article en est la preuve par l'exemple : chacune de ses phrases soulignées est un programme, exécuté pendant votre lecture. La suite de Collatz partant de 27 y atteint 1 en {{compte}} étapes : ce nombre n'a pas été écrit par l'auteur, il est calculé par une phrase de la section @sec:langue.
mots-clés: langue naturelle contrôlée, inférence de types, interprétation abstraite, typage graduel, anti-unification, vérification de preuves
---

# Le document qui sait ce qu'il dit : programmer en français, et comprendre ce qu'on écrit

## Introduction {#sec:intro}

En 1970, Richard Montague écrivait qu'il n'y a pas de différence théorique importante entre les langues naturelles et les langages formels des logiciens [@montague1970]. On a depuis appris à faire *exécuter* une phrase. Ce qui manquait, c'est qu'une machine sache *de quoi parle* un texte : qu'une note est un nombre, qu'un élève est une fiche qui a une note, qu'un loyer se compte en euros. Sans ce savoir, une phrase ambiguë se tranche au hasard, une faute se corrige au plus près des lettres, et un pronom renvoie au dernier nom venu.

Nous montrons que ce savoir se **déduit du document lui-même** : de ses phrases, de ses tableaux, de leurs unités, de ses blocs de code. Pas de dictionnaire du monde écrit à la main, pas de statistique : un petit treillis de sortes, et une inférence qui va dans les deux sens, jusqu'à ce que plus rien ne change. Cet article est un document vivant : les phrases en couleur s'exécutent, leurs résultats s'affichent dessous, et **survoler une donnée dit ce qu'elle est**.

## Une phrase est un programme {#sec:langue}

La suite de Collatz, écrite comme dans un manuel :

_Le nombre vaut 27 et le compte vaut 0._

_Tant que le nombre est différent de 1, s'il est pair, on le divise par 2 ; s'il est impair, on le multiplie par 3 et l'on ajoute 1 ; puis on ajoute 1 au compte._

_On affiche le compte._

Une boucle, deux conditions, des pronoms, une conjugaison libre : le compte vaut {{compte}}. Le document définit ses propres verbes :

_Pour compter les diviseurs d'un nombre, la quantité vaut 0 ; pour chaque entier de 1 à 100, si le nombre est divisible par cet entier, on ajoute 1 à la quantité ; on renvoie la quantité._

_On affiche compter les diviseurs de 36._ _On affiche compter les diviseurs de 97._

Il décrit des objets, sans une accolade :

_Un compte bancaire a un titulaire, un solde de 0 et des opérations._

_Pour déposer un compte bancaire et une somme, ajoute la somme au solde du compte bancaire et ajoute la somme aux opérations du compte bancaire._

_Le mien vaut un compte bancaire avec un titulaire «Alex»._

_Déposer le mien et 100._ _Déposer le mien et 25._

_Affiche le solde du mien et les opérations du mien._

Et il interroge ses tableaux, qui sont des tables :

### Logements

| Nom | Ville | Loyer (€) | Surface (m²) |
|---|---|---|---|
| Studio Lyon | Lyon | 480 | 22 |
| Villa des Pins | Biarritz | 1450 | 120 |
| Loft Canal | Paris | 980 | 65 |
| T2 Croix-Rousse | Lyon | 720 | 48 |

Table : Le tableau qu'interrogent les phrases suivantes {#tbl:logements}

_Affiche les noms du tableau Logements dont la ville est «Lyon»._

_Affiche le loyer le plus haut du tableau Logements dont la surface est moins de 100._

## Le document sait ce que sont ses données {#sec:modele}

Relisez la définition de « déposer » : rien n'y dit ce qu'est « une somme », et elle n'a pas encore été appelée quand la machine la lit. Pourtant, survolez « somme » : **un nombre**. Survolez « opérations » : **une liste de nombres** — alors que la classe ne leur donne qu'une liste vide. Survolez « entier » dans « compter les diviseurs » : **un entier entre 1 et 100** ; et ce qu'elle renvoie, la quantité, est **un entier entre 0 et 100** — cent tours de boucle, au plus 1 de plus par tour. Rien de tout cela n'a été exécuté.

La machine fait sur des *sortes* ce que l'exécution fait sur des valeurs — une interprétation abstraite [@cousot1977] —, et l'inférence va dans les deux sens, comme celle des types de ML [@milner1978] :

- **de bas en haut**, ce qu'on écrit donne sa sorte : 0 est un entier, « 12, 8 et 15 » une liste d'entiers, la colonne « Loyer (€) » des entiers en euros ;
- **de haut en bas**, ce qu'on en fait la contraint : « ajoute la somme au solde » — un nombre — fait de « somme » un nombre ; « le solde du compte bancaire » fait du compte une fiche qui a un solde ; et la liste vide des opérations, la sorte « rien encore » au bas du treillis, devient une liste de nombres au premier ajout.

Une donnée d'un bloc Python qui n'a pas encore tourné existe aussi, avec sa provenance, mais sa sorte est « connue à l'exécution » : elle s'accorde avec tout et ne bloque jamais le juge — c'est le typage graduel [@siek2006] —, puis se précise dès que la valeur arrive. La commande \`/modèle\` montre tout ce que le document sait : ses classes et leurs champs, ses tableaux et leurs unités, ses données, ses actions et leur signature, et pour chacun la phrase, le tableau ou le bloc qui le définit. Le \`/diagramme\` du projet les dessine dans la section qui les définit, reliés à ce dont ils sont une sorte et aux blocs de code qui les lisent : ce sont les mêmes concepts, vus par tout l'éditeur.

### Les unités viennent du texte

Une unité n'est pas une sorte à part : c'est un raffinement du nombre, lu dans un en-tête (« Loyer (€) ») ou après un nombre (« 650 € », « 30 m² »).

_Le loyer vaut 650 €._ _Les charges valent 80 €._ _La surface vaut 30 m²._

_Affiche le loyer plus les charges._

_Affiche le loyer plus la surface._

La seconde phrase s'exécute — elle affiche un nombre —, mais elle est soulignée d'une vague : *additionner des € et des m² n'a pas de sens*. La machine le sait avant d'exécuter, et le dit plutôt que de laisser passer un résultat absurde. Il en va de même pour une moyenne de fiches, une racine de texte, un champ qu'une classe n'a pas.

## Le sens choisit avant d'exécuter {#sec:sens}

Ce savoir devient un juge, qui passe **avant** l'exécution. Le français ne dit pas toujours ce qui va avec quoi ; la machine cherche les lectures voisines d'une phrase — en groupant des mots, comme avec des parenthèses, ou en lisant un pronom comme un autre nom du document — et le juge écarte celles qui n'ont pas de sens. Il n'y a là aucune liste de constructions ambiguës : une seule recherche, générale, et un seul critère.

### Classe

| nom | note |
|---|---|
| Ana | 12 |
| Bob | 8 |
| Cy | 15 |

_Affiche la moyenne des notes du tableau Classe qui sont au moins 10._

Telle qu'écrite, « qui sont au moins 10 » porterait sur les lignes du tableau : *comparer une ligne du tableau Classe et un entier n'a pas de sens*. La machine l'a lue « la moyenne des (notes du tableau Classe) qui sont au moins 10 » — survolez **◆** : la modification *est* l'explication.

Un pronom renvoie à ce qui a la bonne sorte :

_Le budget vaut 100._ _Le libellé vaut «Courses»._ _On le divise par 4._

« On le divise » renverrait, par la grammaire seule, au dernier nom — le libellé, un texte. Un texte ne se divise pas : « le » est donc **le budget** (◆), et ce choix vaut aussi dans le corps d'une action que rien n'exécute encore.

Quand deux lectures ont *chacune* un sens et donnent deux résultats, la machine ne choisit pas en silence. « La racine de 2 fois 8 » vaut-elle $\\sqrt{16} = 4$ ou $8\\sqrt{2}$ ? Placez le curseur au bout de la phrase et retapez son point : les deux lectures vous sont proposées.

_Affiche la racine de 2 fois 8._

## Les fautes se réparent — par le sens {#sec:fautes}

Une phrase qui ne se lit pas est lue comme la phrase correcte la plus proche, par coût croissant, à la manière d'Aho et Peterson [@aho1972] : équivalents, fautes de frappe, mot manquant, mot de trop — chaque réparation signalée en pointillé.

_Les notes valent 12, 8, 15, 9 et 17._

_Afiche la moyenne des notes._

Mais la plus proche par les lettres n'est pas toujours la bonne. Ici, « poix » est à une lettre de « pois » comme de « prix » :

_Le pois vaut «vert»._ _Le prix vaut 16._ _Affiche la racine du poix._

La racine d'un texte n'a pas de sens : la réparation qui en produit une coûte plus cher, et « poix » se lit « prix ». Sans le juge, la machine aurait choisi « pois ».

## Le français libre, traduit {#sec:libre}

Une phrase écrite librement est rapprochée, mot à mot, d'un modèle de tournure, et traduite si la ressemblance est forte ; le signe **≈** dit d'après quel modèle.

_Quelle est la plus grande note ?_

_Combien y a-t-il de notes supérieures à 10 ?_

_Peux-tu afficher le double de la moyenne des notes ?_

## Le document apprend — des sortes, pas des mots {#sec:apprendre}

Quand vous tranchez une ambiguïté, votre réponse s'apprend. Elle s'écrit, en clair, dans le **lexique** du document — un commentaire à sa fin, ouvrez \`/lexique\` — sous la forme de la phrase, chaque donnée remplacée par **sa sorte**. Deux réponses semblables se fondent par anti-unification [@plotkin1970] : ce qu'elles ont en commun reste, et deux sortes différentes remontent à la sorte qui les contient — deux sommes en € restent des €, un nombre en € et un nombre sans unité deviennent un nombre.

Ce document a appris que « a plus b fois n », quand a et b sont des sommes en euros, se lit « (a plus b) fois n » — un loyer et des charges, sur un an. La phrase suivante, qu'il n'a jamais vue, se lit donc ainsi (◆) :

_Affiche les charges plus le loyer fois 12._

Mais la règle porte sur des €, pas sur des mots : des surfaces ne sont pas concernées. La machine garde la lecture ordinaire, et, si vous retapez le point, vous pose la question au lieu d'appliquer une règle qui ne vaut pas ici.

_Affiche la surface plus la surface fois 2._

Une tournure s'enseigne aussi par un seul exemple, avec \`/apprendre\` (« Balance-moi le loyer direct » veut dire « Affiche le loyer. »), et se généralise d'elle-même :

_Balance-moi la moyenne des notes direct._

Effacez une ligne du lexique : la phrase change de sens sous vos yeux. Rien n'est caché, rien n'est statistique, et ce que le document a appris voyage avec lui.

## Le document démontre {#sec:preuve}

Un énoncé en français est une formule, si sa lecture est unique ; une phrase vraie est alors démontrable [@godel1930], et une preuve est un programme dont la machine vérifie chaque pas [@massot2024]. Les encadrés ci-dessous sont vérifiés pendant que vous lisez.

> [!THÉORÈME] Somme des entiers {#thm:gauss}
> Pour tout entier naturel n, la somme des entiers de 1 à n vaut n × (n + 1) / 2.

> [!PREUVE]
> Par récurrence sur n.
> Pour n = 0, la somme est vide : elle vaut 0.
> Supposons la propriété vraie au rang n.
> Alors la somme jusqu'à n + 1 vaut n × (n + 1) / 2 + (n + 1), donc elle vaut (n + 1) × (n + 2) / 2.

> [!PROPOSITION] Le carré d'un nombre impair
> Si n est impair, alors n² est impair.

> [!PREUVE]
> Soit n un entier impair.
> Il existe un entier k tel que n = 2k + 1.
> Alors n² = 4k² + 4k + 1 = 2(2k² + 2k) + 1.
> Donc n² est impair.

> [!PROPRIÉTÉ] Le polynôme d'Euler
> Pour tout entier naturel n, n² + n + 41 est premier.

Le polynôme d'Euler donne un nombre premier pour n = 0, 1, …, 39 ; la machine trouve seule où il cesse de le faire. Une identité à une variable entière est même tranchée sans preuve : au-delà d'une borne de Cauchy, plus rien ne dépend que du reste modulo un nombre, et la machine vérifie tous les cas jusque-là.

> [!LEMME] Divisibilité
> Pour tout entier n, n⁵ − n est divisible par 30.

### Les verbes de l'auteur sont des lemmes

Un énoncé peut nommer une action du document. Le modèle sait que « compter les diviseurs » rend un entier entre 0 et 100 : il l'a déduit de sa définition (au plus 100 tours de boucle, 1 de plus par tour), sans l'exécuter. Cette sorte *est* une démonstration :

> [!PROPRIÉTÉ] Une borne déduite
> Pour tout entier naturel n, compter les diviseurs de n est au plus 100.

Une borne trop optimiste, elle, est réfutée en exécutant l'action — et la machine trouve le cas auquel on ne pense pas : tout entier divise 0.

> [!PROPRIÉTÉ] Trop optimiste
> Pour tout entier naturel n, compter les diviseurs de n est au plus 8.

Une action qui n'est qu'une formule est une définition : elle se déplie dans l'énoncé, qui se démontre alors comme tout autre.

_Pour doubler un nombre, renvoie le nombre fois 2._

> [!LEMME] Le double
> Pour tout entier n, doubler n est pair.

## Deux moteurs, un même sens {#sec:moteurs}

Chaque phrase est exécutée deux fois : dans la page, pendant la frappe, puis par un programme C++ engendré depuis le document, compilé et exécuté dans une machine Linux émulée par le navigateur. Les deux moteurs donnent le même résultat sur les 879 programmes de nos tests. Ce que calculent les phrases passe dans tous les langages : le bloc suivant lit, en Python, les données nommées en français — et, avant qu'il ne tourne, \`/modèle\` sait déjà qu'il les lit.
`),
            code("python", `
print("Collatz depuis 27 :", compte, "étapes ; notes :", notes)
`),
            md(`
## Résultats {#sec:resultats}

| Mesure | Résultat |
|---|---|
| Cas de test de la langue (lecture et exécution) | 393 / 393 |
| Programmes C++ identiques à l'interprète de la page | 879 / 879 |
| Questions et demandes en français libre, traduites justes | 26 / 26 |
| Phrases d'un corpus écrit sans consigne, comprises | 156 / 165 |
| Phrases signalées sans exécution qui s'exécutaient pourtant sans erreur (fausses alertes) | 0 / 558 |
| Sortes, unités, pronoms, réparations, règles apprises et lemmes de l'auteur | 25 / 25 |
| Preuves vérifiées : récurrence, cas, absurde, témoin, théorème réutilisé | 12 / 12 |

Table : Ce que mesurent les tests du dépôt {#tbl:mesures}

Le juge par les sortes ne déclare jamais faux sur une sorte incertaine : sur les 558 phrases de nos corpus, chacune de celles qu'il signale échoue aussi à l'exécution. Il coûte environ une milliseconde par document, et répond là où l'exécution ne passe pas — dans le corps d'une action que rien n'appelle encore.

## Limites {#sec:limites}

La langue reste un fragment : un corpus écrit sans consigne est compris à 95 %, et une phrase incomprise le dit plutôt que de deviner. Une action de l'auteur entre dans une preuve par sa sorte ou, si elle n'est qu'une formule, par sa définition ; une action plus complexe est exécutée pour chercher un contre-exemple, pas démontrée. Le modèle ne connaît que ce que le document définit : il ne sait pas qu'un loyer est une dépense si rien ne le dit — c'est voulu. L'inférence ignore l'ordre des phrases : une donnée qui change de sorte en cours de route devient « de plusieurs sortes », et le juge se tait plutôt que de se tromper. Ce qui est appris ne l'est que par confirmation explicite de l'auteur.

## Conclusion {#sec:conclusion}

Un texte peut être à la fois un document, un programme, une requête et une démonstration. Il suffit que chaque phrase ait un seul sens — et que le document sache de quoi il parle. Ce savoir n'a pas besoin d'être appris d'un corpus : il est déjà dans le texte, dans ses tableaux, ses unités, ses verbes. Le rendre explicite suffit à ce que la machine répare, tranche, apprend et vérifie comme le ferait un lecteur attentif — en disant toujours pourquoi.

<!-- lexique — ce que ce document a appris (TextEdit) :
lecture : affiche ({nombre:€} plus {nombre:€}) fois {n}
tournure : balance moi {X} direct → Affiche {X}.
-->
`),
            code("bib", `
@article{montague1970, author = {Montague, Richard}, title = {English as a Formal Language}, journal = {Linguaggi nella Società e nella Tecnica}, publisher = {Edizioni di Comunità}, year = {1970}}
@article{aho1972, author = {Aho, Alfred V. and Peterson, Thomas G.}, title = {A Minimum Distance Error-Correcting Parser for Context-Free Languages}, journal = {SIAM Journal on Computing}, volume = {1}, number = {4}, year = {1972}}
@article{plotkin1970, author = {Plotkin, Gordon D.}, title = {A Note on Inductive Generalization}, journal = {Machine Intelligence}, volume = {5}, year = {1970}}
@article{godel1930, author = {Gödel, Kurt}, title = {Die Vollständigkeit der Axiome des logischen Funktionenkalküls}, journal = {Monatshefte für Mathematik und Physik}, volume = {37}, year = {1930}}
@inproceedings{cousot1977, author = {Cousot, Patrick and Cousot, Radhia}, title = {Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints}, booktitle = {POPL 1977}, year = {1977}}
@article{milner1978, author = {Milner, Robin}, title = {A Theory of Type Polymorphism in Programming}, journal = {Journal of Computer and System Sciences}, volume = {17}, number = {3}, year = {1978}}
@inproceedings{siek2006, author = {Siek, Jeremy G. and Taha, Walid}, title = {Gradual Typing for Functional Languages}, booktitle = {Scheme and Functional Programming Workshop}, year = {2006}}
@inproceedings{massot2024, author = {Massot, Patrick}, title = {Teaching Mathematics Using Lean and Controlled Natural Language}, booktitle = {Interactive Theorem Proving (ITP 2024)}, series = {LIPIcs}, volume = {309}, year = {2024}}
`),
        ],
    };
}

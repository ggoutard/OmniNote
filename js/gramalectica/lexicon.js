// Grama Lectica — lexique de la couche haute : le thésaurus de programmation.
//
// Chaque instruction a plusieurs façons de se dire, en français et en anglais. La lecture prend toujours la
// forme la plus longue (« est plus grand que » avant « est »), puis le sens est unique : le thésaurus accueille
// la variété de la langue, la grammaire en fait une seule lecture.

import { IRREGULAR as IRREGULAR_VERBS } from "./verbs.js";

export const LEXICON = {
    // actions
    show: ["affiche", "afficher", "montre", "montrer", "écris", "écrire", "imprime", "dis", "print", "show", "display", "say"],
    set: ["mets", "mettre", "range", "place", "stocke", "set", "put", "store"],
    add: ["ajoute", "ajouter", "rajoute", "append", "add"],
    remove: ["retire", "retirer", "enlève", "enlever", "supprime", "remove", "subtract"],
    repeat: ["répète", "répéter", "refais", "recommence", "repeat"],
    return: ["renvoie", "retourne", "rends", "donne", "return", "give back", "gives back"],
    define: ["pour", "to"],
    // « calcule la moyenne des notes », « compte combien… » : le résultat prend le nom de ce qu'on calcule
    compute: ["calculer", "compter", "déterminer", "évaluer", "compute", "count"],
    foreach: ["pour chaque", "pour tout", "pour toute", "for each", "for every"],
    while: ["tant que", "while", "as long as"],
    // primitives qui transforment une donnée : un verbe-tête chacune (à l'infinitif). Ses conjugaisons viennent de la
    // morphologie (verbKey), ses synonymes du Wiktionnaire (synonyms.js, tools/build_lexicon.py), pas d'une liste
    replace: ["remplacer", "replace"],
    multiply: ["multiplier", "multiply"],
    divide: ["diviser", "divide"],
    increase: ["augmenter", "increase"],
    decrease: ["diminuer", "decrease"],
    // rôles portés par les prépositions et les tournures, communs à tous les verbes d'une classe
    by: ["par", "by"],
    each: ["chaque", "each"],
    whenever: ["chaque fois que", "chaque fois qu'", "dès que", "dès qu'", "whenever"],
    // propriétés et résultats des opérations, nommés par leur nom
    divisible: ["est divisible par", "est un multiple de", "is divisible by"],
    remainder: ["le reste de la division de", "the remainder of"],
    quotient: ["le quotient de", "the quotient of"],
    // liaisons
    if: ["si", "lorsque", "quand", "if", "when"],
    then: ["alors", "then"],
    else: ["sinon", "else", "otherwise"],
    seq: ["puis", "ensuite", "et puis", "and then", "after that", ";"],
    and: ["et", "and"],
    or: ["ou", "or"],
    not: ["pas", "non", "not"],
    in: ["dans", "à", "au", "aux", "into", "to", "in"],
    from: ["de", "des", "du", "d'", "from", "of"],
    times: ["fois", "times"],
    be: [":=", "prend la valeur de", "reçoit la valeur de", "vaut", "valent", "est", "sont", "devient", "deviennent", "égale", "égalent", "is", "are", "becomes", "equals", "be"],
    // opérations
    plus: ["plus", "+"],
    minus: ["moins", "-"],
    mul: ["multiplié par", "multipliée par", "×", "*"],
    div: ["divisé par", "divisée par", "÷", "/"],
    mod: ["modulo", "%"],
    square: ["au carré", "le carré de", "squared"],
    cube: ["au cube", "le cube de", "cubed"],
    concat: ["suivi de", "suivie de", "followed by"],
    sorted: ["dans l'ordre", "triée", "trié", "triés", "triées", "sorted"],
    reversed: ["à l'envers", "inversée", "inversé", "reversed"],
    // comparaisons
    gt: ["est plus grand que", "est supérieur à", "est plus que", "est plus de", "vaut plus de", "dépasse", "dépassent", "is greater than", "is more than", "is bigger than", ">"],
    lt: ["est plus petit que", "est inférieur à", "est moins que", "est moins de", "vaut moins de", "is less than", "is smaller than", "<"],
    ge: ["est au moins", "is at least", ">=", "≥"],
    le: ["est au plus", "is at most", "<=", "≤"],
    eq: ["est égal à", "is equal to", "==", "="],
    ne: ["est différent de", "est différente de", "n'est pas", "ne sont pas", "is not", "!=", "≠"],
    even: ["est pair", "est paire", "is even"],
    odd: ["est impair", "est impaire", "is odd"],
    empty: ["est vide", "is empty"],
    positive: ["est positif", "est positive", "is positive"],
    negative: ["est négatif", "est négative", "is negative"],
    contains: ["contient", "contiennent", "contains", "contain"],
    // fonctions sur les nombres et les listes
    sum: ["la somme de", "le total de", "the sum of", "the total of"],
    mean: ["la moyenne de", "moyenne de", "the average of", "the mean of"],
    max: ["le maximum de", "le plus grand de", "le plus haut de", "le plus élevé de", "maximum de", "the maximum of", "the largest of", "the highest of"],
    min: ["le minimum de", "le plus petit de", "le plus bas de", "le moins élevé de", "minimum de", "the minimum of", "the smallest of", "the lowest of"],
    len: ["la longueur de", "la taille de", "le nombre de", "the length of", "the size of", "the number of"],
    sqrt: ["la racine de", "la racine carrée de", "the square root of"],
    abs: ["la valeur absolue de", "the absolute value of"],
    round: ["l'arrondi de", "the rounded value of"],
    first: ["le premier de", "la première de", "premier de", "première de", "the first of"],
    last: ["le dernier de", "la dernière de", "dernier de", "dernière de", "the last of"],
    list: ["la liste", "une liste", "the list", "a list"],
    range: ["les nombres de", "les entiers de", "nombres de", "entiers de", "the numbers from", "the integers from", "numbers from"],
    // classes : « un appartement a un loyer », « un studio est une sorte d'appartement », « … avec un loyer de 650 »
    has: ["possède", "possèdent", "ont", "has", "have"],
    kind: ["une sorte de", "un genre de", "un type de", "une espèce de", "a kind of", "a sort of", "a type of"],
    with: ["avec", "with"],
    // tableaux du document : « le tableau Logements » (nommé par le titre au-dessus), « … dont le loyer est moins de 700 »
    table: ["les lignes du tableau", "les lignes de tableau", "les lignes du", "le tableau", "tableau", "the rows of the table", "the table"],
    where: ["dont", "whose", "where"],
    // « combien de notes sont au moins 10 » : le nombre d'éléments qui passent le test
    howmany: ["combien de", "combien d'", "combien", "how many"],
    true: ["vrai", "true"],
    false: ["faux", "false"],
};

// Les fonctions « … de » se disent aussi « … des », « … du », « … d' »
const variants = (w) => (/ de$/.test(w) ? [w, w.replace(/ de$/, " des"), w.replace(/ de$/, " du"), w.replace(/ de$/, " d'")] : [w]);

// ---------------------------------------------------------------- morphologie
// Le lexique donne une forme par sens ; les accords en découlent. Deux mots s'accordent s'ils ont la même forme
// de base : « les jours sont au plus 0 » se lit comme « est au plus », « la plus haute des notes » comme « le plus
// haut de », « sont supérieures à » comme « est supérieur à ». Règles du français courant, pas un dictionnaire :
// elles ne servent qu'à rapprocher un mot du texte d'une forme du lexique, jamais à reconnaître un nom.

const IRREGULAR = {
    sont: "est", valent: "vaut", deviennent: "devient", égalent: "égale", contiennent: "contient", possèdent: "possède",
    ont: "a", font: "fait", égaux: "égal", la: "le", les: "le", "l'": "le", une: "un",
    are: "is", have: "has", contain: "contains",
};

/** La forme de base d'un mot : « supérieures » -> supérieur, « grandes » -> grand, « élevée » -> élevé, « basse » -> bas. */
export function lemma(w) {
    w = w.toLowerCase();
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (w.length <= 3) return w;
    return w.replace(/eaux$/, "eau").replace(/aux$/, "al").replace(/(?<=\p{L}{3})[sx]$/u, "")   // pluriel
        .replace(/ive$/, "if").replace(/ère$/, "er").replace(/sse$/, "s")   // féminin
        .replace(/(?<=[^aeiouyàâäéèêëîïôöùûü]|é)e$/u, "");
}

/**
 * Toutes les formes, découpées comme le texte, des plus longues aux plus courtes ; « lemmas » : leurs formes de base
 * (une forme de plusieurs mots se reconnaît aussi accordée).
 */
export const FORMS = Object.entries(LEXICON)
    .flatMap(([key, ws]) => ws.flatMap(variants).map((w) => ({ key, words: w.toLowerCase().replace(/'(?=\p{L})/gu, "' ").split(/\s+/) })))
    .sort((a, b) => b.words.length - a.words.length)
    .map((f) => ({ ...f, lemmas: f.words.map(lemma) }));

/** Les formes d'un seul mot (« fois », « dépasse », « dont ») et leur sens : pour corriger une faute de frappe. */
export const WORD_KEYS = new Map();
for (const f of FORMS) if (f.words.length === 1 && /^\p{L}{3,}$/u.test(f.words[0]) && !WORD_KEYS.has(f.words[0])) WORD_KEYS.set(f.words[0], f.key);

/** Les articles : ils introduisent un nom et ne comptent pas dans son identité (« le loyer » = loyer). */
// « mes notes », « nos clients » : un possessif de la première ou deuxième personne nomme la donnée comme l'article
export const ARTICLES = new Set(["le", "la", "les", "l'", "un", "une", "ce", "cet", "cette", "ces", "mon", "ma", "mes", "notre", "nos", "votre", "vos", "the", "a", "an", "my", "our", "your"]);

/**
 * Les mots de liaison que la grammaire n'emploie pas : on peut les écrire, ils sont lus et ignorés
 * (« affiche donc le total », « mets simplement 5 dans x », « please show the total »).
 * Un mot que la syntaxe définit (alors, puis, et…) garde son sens : il n'est jamais dans cette liste.
 */
export const FILLERS = new Set([
    "donc", "bien", "juste", "simplement", "seulement", "maintenant", "enfin", "aussi", "d'abord", "abord", "voilà", "voila",
    "qui", "which", "svp", "stp", "moi", "nous", "on", "je", "j'", "successivement", "s'", "il", "te", "plaît", "plait", "vous", "ok", "bon", "hop", "ici", "là",
    "please", "just", "simply", "now", "also", "so", "well", "first", "finally", "here",
]);

/** Le rôle de chaque instruction, pour la coloration. */
export const ROLE = {
    show: "action", set: "action", add: "action", remove: "action", repeat: "action", return: "action", define: "action",
    foreach: "link", while: "link", if: "link", then: "link", else: "link", seq: "link", and: "link", or: "link", not: "link",
    in: "link", from: "link", times: "link", be: "action",
    plus: "op", minus: "op", mul: "op", div: "op", mod: "op", square: "op", cube: "op", concat: "op", sorted: "action", reversed: "action",
    gt: "cond", lt: "cond", ge: "cond", le: "cond", eq: "cond", ne: "cond", even: "cond", odd: "cond", empty: "cond",
    positive: "cond", negative: "cond", contains: "cond",
    sum: "action", mean: "action", max: "action", min: "action", len: "action", sqrt: "action", abs: "action", round: "action",
    first: "action", last: "action", list: "action", range: "action", true: "num", false: "num",
    has: "action", kind: "link", with: "link", table: "link", where: "link", compute: "action", howmany: "action",
    replace: "action", multiply: "action", divide: "action", increase: "action", decrease: "action", by: "link", each: "link", whenever: "link",
    divisible: "cond", remainder: "op", quotient: "op",
};

/** Les articles indéfinis : « un appartement » désigne une classe (le créer, le déclarer, le tester). */
export const INDEFINITE = new Set(["un", "une", "a", "an"]);

/** Les formes d'un mot seul, pour proposer la plus proche d'un mot inconnu. */
export const SINGLE_WORDS = [...new Set(Object.values(LEXICON).flat().filter((f) => /^[\p{L}]+$/u.test(f)))];

/**
 * Les équivalences : quand une phrase bloque sur un mot, ce mot peut se lire comme une forme de la langue.
 * « affiche «Total : » avec la somme des cartons » bloque sur « avec » (qui sert à créer un objet) : il se relit
 * comme « et », la phrase marche, et la lecture est signalée (« « avec » lu comme « et » »).
 * Chaque entrée : les mots écrits, puis les sens à essayer, dans l'ordre. Ils ne servent qu'en cas de blocage :
 * une phrase qui se lit déjà n'est jamais réinterprétée.
 */
export const EQUIVALENTS = [
    ["avec", ["and", "concat"]],
    ["ainsi que", ["and"]],
    ["et aussi", ["and"]],
    ["along with", ["and"]],
    ["together with", ["and"]],
    ["accompagné de", ["concat"]],
    ["accompagnée de", ["concat"]],
    ["additionné à", ["plus"]],
    ["additionnée à", ["plus"]],
    ["ajouté à", ["plus"]],
    ["ajoutée à", ["plus"]],
    ["auquel on ajoute", ["plus"]],
    ["auquel on retire", ["minus"]],
    ["enlevé à", ["minus"]],
    ["sur", ["div"]],
    ["égal à", ["eq"]],
    ["égale à", ["eq"]],
    ["est", ["be"]],
].map(([w, keys]) => ({ words: w.split(" "), keys }));

// ---------------------------------------------------------------- énonciation
// Une description de traitement se dit de bien des façons (« on ajoute », « ajouter », « nous ajoutons ») ; seul le
// verbe porte l'action. Ces données servent à ramener l'énonciation à la langue (parse.js, terms).

/** Des tournures qui situent sans agir : lues et ignorées (« le résultat vaut 1 au départ », « à la fin, … »). */
export const FILLER_PHRASES = ["au départ", "au début", "à la fin", "pour finir", "pour commencer", "pour terminer", "de suite", "d'affilée", "en tout", "au final"]
    .map((p) => p.replace(/'/g, "' ").split(/\s+/));

/** Des unités, ignorées après un nombre (« 87 euros », « 15 ans ») : la valeur seule compte. */
export const UNITS = new Set(["euro", "euros", "centimes", "an", "ans", "année", "années", "mois", "jour", "jours", "heure", "heures", "minute", "minutes",
    "seconde", "secondes", "mètre", "mètres", "km", "kg", "g", "cm", "mm", "litre", "litres", "points", "personnes", "élèves", "m²", "m2", "km²", "cm²"]);

/** Les nombres en lettres (« dix fois de suite », « un total nul ») ; « un » reste un article. */
export const NUMBER_WORDS = { zéro: 0, nul: 0, nulle: 0, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11,
    douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, cent: 100, mille: 1000 };

/** Les pronoms qui renvoient à une donnée déjà nommée : sujets (« il augmente ») et compléments (« on l'ajoute »). */
export const SUBJECTS = new Set(["il", "elle", "ils", "elles", "it", "they"]);
export const OBJECTS = new Set(["le", "la", "l'", "les"]);
/** Les pronoms indirects : « on lui ajoute 1 » ajoute 1 à la donnée dont on parle. */
export const DATIVES = new Set(["lui", "leur"]);
/** Les possessifs : « son carré » est le carré de la donnée dont on parle. */
export const POSSESSIVES = new Set(["son", "sa", "ses", "leur", "leurs", "its", "their"]);

/**
 * Le radical d'un verbe conjugué, pour reconnaître une action définie par l'utilisateur sous toutes ses formes :
 * « pour doubler… » se dit « on double », « doublons », « doublé » ; « pour finir… », « on finit », « finissons ».
 * Grammaire seulement : le sens d'un verbe est celui que lui donne sa définition.
 */
// Les terminaisons de tous les temps (1er et 2e groupes), sur les mots sans accents : les mêmes que tools/build_lexicon.py
const ENDINGS = `erai eras era erons erez eront erais erait erions eriez eraient
irai iras ira irons irez iront irais irait irions iriez iraient
issions issons issez issent issant issait issais issaient issiez isse isses
ions iez aient ais ait ons ez ent ant ai as a ames ates erent asse asses assent assions assiez at
is it imes ites irent er ir re ees es ee e s i`.split(/\s+/).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
export function verbRoot(w) {
    let f = fold(w);
    if (IRREGULAR_VERBS[f]) f = fold(IRREGULAR_VERBS[f]);   // « prenons », « prendra » -> prendre (verbs.js, d'après le Wiktionnaire)
    for (const e of ENDINGS) if (f.length - e.length >= 3 && f.endsWith(e)) return f.slice(0, -e.length);
    return f;
}
/** Deux formes du même verbe ? (« double » et « doubler », « prenons » et « prendre » ; l'infinitif finit en -er, -ir, -re) */
export const sameVerb = (w, inf) => /(er|ir|re)$/.test(inf) && (w.length > 2 || !!IRREGULAR_VERBS[fold(w)]) && verbRoot(w) === verbRoot(inf);

const fold = (w) => w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Le radical d'un verbe : « affichons », « afficher », « affiche » -> affich ; sans terminaison verbale, null (« stock »). */
export const verbStem = (w) => { const f = fold(w); const m = /^(.{4,}?)(ions|ons|ez|ent|er|es|e)$/.exec(f); return m ? m[1] : null; };
/** Les verbes d'action, par radical : un verbe conjugué autrement que dans le lexique est reconnu (« ajoutons »). */
export const VERBS = new Map();
for (const key of ["show", "add", "remove", "repeat", "return", "replace", "multiply", "divide", "increase", "decrease", "compute"]) {
    for (const f of LEXICON[key]) { const st = /^\p{L}{4,}$/u.test(f) && verbStem(f); if (st && !VERBS.has(st)) VERBS.set(st, key); }
}

/** Le verbe d'action d'un mot conjugué (« multiplions », « afficher », « augmentez »), ou null. */
export function verbKey(w) {
    const f = fold(w);
    for (const end of ["ions", "ons", "ees", "ez", "ent", "er", "ee", "es", "e"]) {
        if (f.length - end.length >= 4 && f.endsWith(end) && VERBS.has(f.slice(0, -end.length))) return VERBS.get(f.slice(0, -end.length));
    }
    return null;
}

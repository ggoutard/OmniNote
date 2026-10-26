# Composants tiers

Le code de TextEdit (éditeur, noyaux, Grama Lectica) est sous licence MIT (voir `LICENSE`), **sauf**
les éléments ci-dessous, qui gardent leur propre licence. Ils sont distribués à côté de notre code,
sans modification, et ne changent pas sa licence. Les textes complets sont dans `licenses/`.

## Dans la page

| Composant | Dossier | Licence | Texte |
|---|---|---|---|
| CodeMirror 5.65 (cœur, modes, extensions) | `vendor/codemirror/` | MIT | `vendor/codemirror/LICENSE` |
| Bublé 0.20 (avec acorn, magic-string) | `vendor/buble/` | MIT | `vendor/buble/LICENSE` |
| Mermaid 10.9 | `vendor/mermaid/` | MIT | `vendor/mermaid/LICENSE` |
| DOMPurify 3.1.6, inclus dans Mermaid | `vendor/mermaid/mermaid.min.js` | Apache-2.0 ou MPL-2.0 (Apache-2.0 retenue) | `licenses/texts/Apache-2.0.txt` |
| marked 15 | `vendor/marked/` | MIT | `vendor/marked/LICENSE.md` |
| KaTeX 0.16 et ses polices | `vendor/katex/` | MIT | `vendor/katex/LICENSE` |
| Formes des verbes irréguliers français (≈ 7 700 formes de 1 000 verbes), pluriels irréguliers des noms (≈ 1 500) et accords irréguliers des adjectifs (≈ 2 900), tirés du Wiktionnaire par wiktextract (https://fr.wiktionary.org, https://kaikki.org/frwiktionary/) | `js/gramalectica/verbs.js`, `js/gramalectica/forms.js` | CC BY-SA 4.0 | `licenses/texts/CC-BY-SA-4.0.txt` |
| Polices CMU Serif et CMU Typewriter (Computer Modern Unicode, d'après le paquet npm computer-modern 0.1.3), réduites aux caractères latins | `vendor/cmu/` | SIL Open Font License 1.1 (polices) ; MIT (paquet) | `vendor/cmu/OFL.txt` |
| Polices Inter et JetBrains Mono (chargées depuis Google Fonts, non copiées) | — | SIL Open Font License 1.1 | — |

## Dans la machine virtuelle

| Composant | Où | Licence | Textes, versions, sources |
|---|---|---|---|
| **JarWeBox** : émulateur v86, SeaBIOS, image Linux Tiny Core 11 (noyau, BusyBox, glibc), X11, rxvt-unicode, OpenJDK 8 JRE (Liberica), environnement natif (Qt 5.11, libcob, Python 3.7, Tcl/Tk 8.6…), polices DejaVu | `jarwebox/` | MIT (JarWeBox), BSD-2-Clause (v86), LGPL-3.0 (SeaBIOS), GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, GPL-2.0 + Classpath Exception, PSF-2.0, X11/MIT, FTL… | `licenses/jarwebox/` : `LICENSE`, `THIRD_PARTY.md`, `NOTICE.txt` (composant par composant), `SOURCES.txt`, `texts/`, `openjdk/`, `debian/`, `tcz-info/` |
| ECJ 4.6.1, compilateur Java d'Eclipse (envoyé tel quel dans la machine à la première cellule Java) | `vendor/ecj/` | EPL-1.0 | `vendor/ecj/LICENSE-EPL-1.0.html` ; sources : https://repo1.maven.org/maven2/org/eclipse/jdt/core/compiler/ecj/4.6.1/ |
| **Compilateurs C, C++ et COBOL** : GCC 8.3 (gcc, g++, cpp, libstdc++), binutils 2.31, en-têtes et objets de glibc 2.28, GMP, MPFR, MPC, ISL, zlib, ncurses (Debian 10 i386) ; GnuCOBOL 3.2 (cobc, libcob) | image, `lumen-tc.tcz` | GPL-3.0+ avec exception GCC 3.1 (GCC, libstdc++), GPL-3.0+ (binutils, cobc), LGPL-2.1+ (glibc), LGPL-3.0+ (GMP, MPFR, MPC, libcob), MIT (ISL, ncurses), zlib | `licenses/lumen-tc/` (textes Debian, `PACKAGES`, `gnucobol`) ; GPL et LGPL : `licenses/jarwebox/texts/` ; sources : `licenses/SOURCES.txt` |
| **numpy 1.16, matplotlib 3.0** et leurs dépendances (cycler, python-dateutil, kiwisolver, pyparsing, six), BLAS et LAPACK de référence, libgfortran, libquadmath, freetype, libpng, zlib, distutils | image, `lumen-py.tcz` | BSD (numpy, kiwisolver, cycler, dateutil), licence matplotlib (type PSF), MIT (pyparsing, six), BSD modifiée (BLAS, LAPACK), GPL-3.0 avec exception GCC (libgfortran, libquadmath), FTL, libpng, zlib, PSF | `licenses/lumen-py/` ; sources : `licenses/SOURCES.txt` |
| **PHP 7.3** (CLI et ses modules json, mbstring, ctype…) et ses dépendances (ICU, libxml2, OpenSSL, libsodium, argon2, PCRE2, libedit…) | image, `lumen-lang.tcz` | PHP License 3.01 ; ICU, libxml2 : type MIT ; OpenSSL : OpenSSL/SSLeay ; libsodium : ISC ; libedit, PCRE2 : BSD ; argon2 : CC0 ou Apache-2.0 | `licenses/lumen-lang/` |
| **Rust 1.41** : rustc, sa bibliothèque standard, LLVM 7 | image, `lumen-lang.tcz` | MIT ou Apache-2.0 (Rust) ; Apache-2.0 avec exception LLVM | `licenses/rust/` (`LICENSE-MIT`, `LICENSE-APACHE`, `COPYRIGHT`), `licenses/lumen-lang/rustc`, `licenses/lumen-lang/libllvm7` |
| **Go** : interpréteur yaegi 0.16.1 et bibliothèque standard de Go 1.22, compilés dans `lumen-go` | image, `lumen-lang.tcz` | Apache-2.0 (yaegi), BSD-3-Clause (Go) | `licenses/go/` (`LICENSE`, `yaegi-LICENSE`) ; sources : https://github.com/traefik/yaegi, https://go.dev |
| **Kotlin 2.0.21** : compilateur (avec ses composants tiers), bibliothèque standard, kotlinx.coroutines, trove4j | prévu, pas encore dans l'image | Apache-2.0 (Kotlin, kotlinx.coroutines) ; LGPL-2.1 (trove4j) ; composants tiers du compilateur : voir `licenses/kotlin/README.md` | `licenses/kotlin/` (`LICENSE.txt`, `NOTICE.txt`, `README.md`, `third_party/`, `trove4j-LICENSE.txt`, `kotlinx-coroutines-LICENSE.txt`) |

## Sources des composants GPL et LGPL

Ils sont redistribués sans modification. Les sources correspondantes, aux versions exactes des
binaires, sont indiquées dans `licenses/SOURCES.txt` (composants ajoutés par TextEdit) et dans
`licenses/jarwebox/SOURCES.txt` (image de JarWeBox), avec une offre écrite valable trois ans.

## Marques

Java et OpenJDK sont des marques d'Oracle et/ou de ses filiales ; Kotlin, de JetBrains ; Rust, de la
Rust Foundation ; Go, de Google ; PHP, du PHP Group ; Python, de la Python Software Foundation ;
Linux, de Linus Torvalds ; Debian, de Software in the Public Interest ; GNU, de la Free Software
Foundation. TextEdit est un projet indépendant : il n'est ni affilié à ces titulaires, ni approuvé
ou soutenu par eux. Ces noms ne servent qu'à désigner les logiciels utilisés.

Auteur : ggoutard — contact : contact.ggoutard@gmail.com

# Composants tiers

Le code de ce dépôt est sous licence MIT (voir `LICENSE`), **sauf** les éléments
ci-dessous, qui gardent leur propre licence. Ils sont distribués à côté de notre code,
sans modification, et ne changent pas sa licence.

| Emplacement | Contenu | Licence |
|---|---|---|
| `jarwebox/v86/libv86.js`, `v86.wasm` | émulateur x86 [v86](https://github.com/copy/v86) | BSD-2-Clause |
| `jarwebox/v86/seabios.bin`, `vgabios.bin` | [SeaBIOS](https://www.seabios.org) 1.16.2 | LGPL-3.0 |
| `jarwebox/image/` | image de la machine virtuelle : Linux Tiny Core 11 (noyau, BusyBox, glibc), X11 (TinyX, bibliothèques X.Org), terminal rxvt-unicode, OpenJDK 8 JRE, environnement natif (Qt 5.11, libcob de GnuCOBOL 3.2, Python 3.7, Tcl/Tk 8.6 et leurs dépendances Debian 10), polices DejaVu | GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, PSF-2.0, GPL-2.0 + Classpath Exception, X11/MIT, FTL… |
| `tools/base/TinyCore-Java.iso` | image de départ (Tiny Core Linux 11 + OpenJDK 8) | idem |

Le détail composant par composant (version, licence, origine) est dans
[`licenses/NOTICE.txt`](licenses/NOTICE.txt), les textes complets dans `licenses/texts/` et
`licenses/openjdk/`, et l'emplacement des sources correspondantes dans
[`licenses/SOURCES.txt`](licenses/SOURCES.txt). Ces fichiers sont générés par
`tools/build_notice.py` à partir du contenu réel de l'image.

**Programmes C++ / Qt** : Qt est utilisé sous LGPL-3.0, par liaison dynamique (les
bibliothèques Qt sont des fichiers séparés de l'image, remplaçables en la reconstruisant).
Un programme compilé avec `build.sh` peut donc garder la licence de son choix, y compris
propriétaire, tant que la page publiée garde `licenses/` (texte de la LGPL, sources de Qt).
N'utilisez pas les modules Qt sous GPL seule (Qt Charts, Data Visualization…), qui ne
sont d'ailleurs pas dans l'image. `Qt` est une marque de The Qt Company ; ce projet n'est
ni affilié ni approuvé par elle. La chaîne de compilation (`tools/cpp/`, GCC, Debian) ne
fait pas partie de ce qui est publié.

**Programmes COBOL et Python** : libcob (GnuCOBOL) est sous LGPL-3.0 et liée
dynamiquement, comme Qt ; Python (PSF-2.0) et Tcl/Tk (type BSD) sont permissifs. Un
programme COBOL ou Python garde donc la licence de son choix. Les bibliothèques qui
changeraient cela ont été écartées : Berkeley DB (licence Sleepycat), readline et gdbm
(GPL). Le compilateur `cobc` (GPL) sert seulement à compiler : il n'est pas publié.

**Sources des composants GPL/LGPL** : elles sont publiées, aux versions exactes des
binaires, avec chaque version dans les Releases GitHub du projet (archives
`jarwebox-sources-*.tar`, `SHA256SUMS.txt`, `MANIFEST.txt`, produites par
`tools/fetch_sources.py`). L'offre écrite de `licenses/SOURCES.txt` les complète pendant
trois ans. Quiconque republie l'image (fork, démo produite avec `build.sh`) doit en faire
autant : publier ces archives à côté, ou renvoyer vers celles de la Release
correspondante.

Notre code, le lanceur Java et `xwin` compris, est sous MIT. Le lanceur n'utilise que
les API publiques d'OpenJDK et relève de son exception Classpath : il reste sous MIT.

**Marques** : Java et OpenJDK sont des marques d'Oracle et/ou de ses filiales ; Liberica,
de BellSoft ; Qt, de The Qt Company ; Python, de la Python Software Foundation ; Linux,
de Linus Torvalds ; Debian, de Software in the Public Interest ; GNU, de la Free Software
Foundation. JarWeBox est un projet indépendant : il n'est ni affilié à ces titulaires, ni
approuvé, parrainé ou soutenu par eux. Ces noms ne servent qu'à désigner les logiciels
utilisés, jamais dans le nom ou le logo du projet.

Auteur : ggoutard — contact : contact.ggoutard@gmail.com

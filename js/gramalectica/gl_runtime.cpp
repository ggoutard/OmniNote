// Grama Lectica — moteur C++17 de la couche haute (compilé une fois, lié à chaque programme).
//
// Interface : gl.hpp. Le comportement reproduit exactement l'interpréteur de la page (run.js) : mêmes valeurs,
// mêmes affichages, mêmes erreurs à la même place du texte — vérifié par tests/gramalectica.cpp.test.mjs.
// Une valeur est un nombre, un texte, vrai/faux, une liste (immuable : la modifier en crée une nouvelle)
// ou une fiche : un objet d'une classe, partagé (une action qui le reçoit peut changer ses champs).
//
// Protocole de sortie, lu par la page :
//   \x1eP<k>                 début de la phrase k
//   <ligne>                  une ligne affichée
//   \x1eF<début> <fin> <msg> la phrase s'est arrêtée sur une erreur, à cet endroit de son texte

#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <algorithm>
#include "gl.hpp"

namespace glrt {

struct Value;
struct Fiche;
using List = std::vector<Value>;
using ListP = std::shared_ptr<const List>;
using FicheP = std::shared_ptr<Fiche>;

struct Value {
    std::variant<std::monostate, double, std::string, bool, ListP, FicheP> v;
    Value() = default;
    Value(double d) : v(d) {}
    Value(int d) : v(double(d)) {}
    Value(long long d) : v(double(d)) {}
    Value(const char* s) : v(std::string(s)) {}
    Value(std::string s) : v(std::move(s)) {}
    Value(bool b) : v(b) {}
    Value(List l) : v(std::make_shared<const List>(std::move(l))) {}
    Value(ListP l) : v(std::move(l)) {}
    Value(FicheP f) : v(std::move(f)) {}
    bool none() const { return v.index() == 0; }
    bool isNum() const { return v.index() == 1; }
    bool isStr() const { return v.index() == 2; }
    bool isBool() const { return v.index() == 3; }
    bool isList() const { return v.index() == 4; }
    bool isFiche() const { return v.index() == 5; }
    double num() const { return std::get<1>(v); }
    const std::string& str() const { return std::get<2>(v); }
    bool boolean() const { return std::get<3>(v); }
    const List& list() const { return *std::get<4>(v); }
    Fiche& fiche() const { return *std::get<5>(v); }
};

/** Une classe : ses champs (ceux du parent d'abord) et leurs valeurs par défaut. */
struct Class {
    std::string name, art;
    std::shared_ptr<const Class> parent;
    std::vector<std::string> fields;
    std::unordered_map<std::string, Value> defaults;
    bool has(const std::string& f) const { return std::find(fields.begin(), fields.end(), f) != fields.end(); }
};
using ClassP = std::shared_ptr<const Class>;

struct Fiche {
    ClassP cls;
    std::unordered_map<std::string, Value> vals;   // les champs qui ont une valeur
};

inline std::string label(std::string n) { for (auto& c : n) if (c == '_') c = ' '; return n; }

// ---------------------------------------------------------------- erreurs

struct Fault : std::runtime_error {
    int at, end;
    Fault(const std::string& m, int a = -1, int e = -1) : std::runtime_error(m), at(a), end(e) {}
};

inline long long steps = 0;
constexpr long long LIMIT = 200000;   // comme run.js : un tour de boucle ou un appel d'action est un pas
constexpr int MAX_LINES = 1000;
inline int lines = 0, dropped = 0;
inline void tick() {
    if (++steps > LIMIT) throw Fault("trop long : la phrase tourne sans fin ?");
}

// ---------------------------------------------------------------- texte (UTF-8)

inline std::vector<std::string> chars(const std::string& s) {
    std::vector<std::string> out;
    for (size_t i = 0; i < s.size();) {
        unsigned char c = s[i];
        size_t n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : (c >> 3) == 30 ? 4 : 1;
        out.push_back(s.substr(i, n));
        i += n;
    }
    return out;
}

inline std::string kindOf(const Value& v) {
    if (v.isFiche()) return v.fiche().cls->art + " " + label(v.fiche().cls->name);
    return v.isNum() ? "un nombre" : v.isStr() ? "un texte" : v.isBool() ? "vrai ou faux" : v.isList() ? "une liste" : "une action";
}

// ---------------------------------------------------------------- affichage, comme la page

inline std::string fmtNum(double d) {
    if (std::isnan(d)) return "indéfini";
    if (std::isinf(d)) return d > 0 ? "l'infini" : "moins l'infini";
    if (d == std::floor(d) && std::fabs(d) < 1e15) {
        char b[32];
        std::snprintf(b, sizeof b, "%lld", (long long)d);
        return b;
    }
    double r = std::round(d * 1e6) / 1e6;
    char b[64];
    std::snprintf(b, sizeof b, "%.6f", r);
    std::string s = b;
    while (!s.empty() && s.back() == '0') s.pop_back();
    if (!s.empty() && s.back() == '.') s.pop_back();
    for (auto& c : s) if (c == '.') c = ',';
    return s;
}

constexpr int DEEP = 16;   // une fiche peut se contenir elle-même : au-delà, « … »

inline std::string show(const Value& v, int d = 0) {
    if (d > DEEP) return "…";
    auto inner = [d](const Value& x) { return x.isStr() ? "«" + x.str() + "»" : show(x, d + 1); };
    if (v.isNum()) return fmtNum(v.num());
    if (v.isBool()) return v.boolean() ? "vrai" : "faux";
    if (v.isStr()) return v.str();
    if (v.isList()) {
        std::string s = "[";
        bool first = true;
        for (auto& x : v.list()) {
            if (!first) s += " ; ";
            first = false;
            s += inner(x);
        }
        return s + "]";
    }
    if (v.isFiche()) {
        auto& f = v.fiche();
        std::string s = label(f.cls->name) + " (";
        bool first = true;
        for (auto& k : f.cls->fields) {
            auto it = f.vals.find(k);
            if (it == f.vals.end()) continue;
            if (!first) s += " ; ";
            first = false;
            s += label(k) + " : " + inner(it->second);
        }
        return s + ")";
    }
    return "undefined";
}

// ---------------------------------------------------------------- conversions

inline double num(const Value& v, const std::string& what, int at = -1, int end = -1) {
    if (!v.isNum()) throw Fault(what + " : il faut un nombre, pas " + kindOf(v), at, end);
    return v.num();
}

inline List list(const Value& v, const std::string& what, int at = -1, int end = -1) {
    if (v.isStr()) { List l; for (auto& c : chars(v.str())) l.push_back(Value(c)); return l; }
    if (!v.isList()) throw Fault(what + " : il faut une liste, pas " + kindOf(v), at, end);
    return v.list();
}

inline bool truth(const Value& v) {
    if (v.isBool()) return v.boolean();
    if (v.isNum()) return v.num() != 0;
    if (v.isStr()) return !v.str().empty();
    if (v.isList()) return !v.list().empty();
    return v.isFiche();
}

inline bool same(const Value& a, const Value& b) {
    if (a.v.index() != b.v.index()) return false;
    if (a.isNum()) return a.num() == b.num();
    if (a.isStr()) return a.str() == b.str();
    if (a.isBool()) return a.boolean() == b.boolean();
    if (a.isList()) {
        auto &x = a.list(), &y = b.list();
        if (x.size() != y.size()) return false;
        for (size_t i = 0; i < x.size(); i++) if (!same(x[i], y[i])) return false;
        return true;
    }
    if (a.isFiche()) return &a.fiche() == &b.fiche();   // le même objet
    return true;
}

// ---------------------------------------------------------------- données

}  // namespace glrt

struct gl::Scope {
    std::unordered_map<std::string, glrt::Value> vars;
    gl::Scope* parent = nullptr;
};

namespace glrt {
using Scope = gl::Scope;
inline Scope globals;

/** Les caractères d'un texte UTF-8 (pour une distance qui compte « é » pour une lettre, comme la page). */
inline std::vector<char32_t> codepoints(const std::string& s) {
    std::vector<char32_t> out;
    for (size_t i = 0; i < s.size();) {
        unsigned char c = s[i];
        int n = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : 4;
        char32_t cp = n == 1 ? c : c & (0x3F >> (n - 1));
        for (int k = 1; k < n && i + k < s.size(); k++) cp = (cp << 6) | (s[i + k] & 0x3F);
        out.push_back(cp);
        i += n;
    }
    return out;
}

inline size_t editDistance(const std::vector<char32_t>& a, const std::vector<char32_t>& b) {
    std::vector<size_t> row(b.size() + 1);
    for (size_t j = 0; j <= b.size(); j++) row[j] = j;
    for (size_t i = 1; i <= a.size(); i++) {
        size_t diag = row[0];
        row[0] = i;
        for (size_t j = 1; j <= b.size(); j++) {
            size_t up = row[j];
            row[j] = std::min({row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] == b[j - 1] ? 0 : 1)});
            diag = up;
        }
    }
    return row[b.size()];
}

inline Value lookup(Scope& s, const std::string& name, const std::string& label, int at, int end) {
    for (Scope* p = &s; p; p = p->parent) {
        auto it = p->vars.find(name);
        if (it != p->vars.end()) return it->second;
    }
    auto it = globals.vars.find(name);
    if (it != globals.vars.end()) return it->second;
    // « le balcon du studio » : si « studio » est une fiche, c'est un champ qu'elle n'a pas
    for (size_t k = name.find("_de_"); k != std::string::npos && k > 0; k = name.find("_de_", k + 1)) {
        const std::string rest = name.substr(k + 4);
        const Value* o = nullptr;
        for (Scope* p = &s; p && !o; p = p->parent) { auto j = p->vars.find(rest); if (j != p->vars.end()) o = &j->second; }
        if (!o) { auto j = globals.vars.find(rest); if (j != globals.vars.end()) o = &j->second; }
        if (o && o->isFiche()) throw Fault(kindOf(*o) + " n'a pas de « " + glrt::label(name.substr(0, k)) + " »", at, end);
    }
    // Le nom connu le plus proche (« loyre » -> loyer), comme dans la page
    std::string best;
    size_t bd = SIZE_MAX;
    const auto a = codepoints(name);
    const size_t lim = std::max<size_t>(1, a.size() / 3);
    auto consider = [&](const std::string& n, const Value& v) {  // les actions sont ailleurs (actions)
        (void)v;
        if (n == name) return;
        size_t d = editDistance(a, codepoints(n));
        if (d <= lim && (d < bd || (d == bd && n < best))) { best = n; bd = d; }
    };
    for (Scope* p = &s; p; p = p->parent) for (auto& [n, v] : p->vars) consider(n, v);
    for (auto& [n, v] : globals.vars) consider(n, v);
    throw Fault("« " + label + " » n'a pas encore de valeur" + (best.empty() ? "" : " — « " + glrt::label(best) + " » ?"), at, end);
}

inline bool has(Scope& s, const std::string& name) {
    for (Scope* p = &s; p; p = p->parent) if (p->vars.count(name)) return true;
    return globals.vars.count(name) > 0;
}

inline void assign(Scope& s, const std::string& name, Value v) {
    for (Scope* p = &s; p; p = p->parent) {
        auto it = p->vars.find(name);
        if (it != p->vars.end()) { it->second = std::move(v); return; }
    }
    (globals.vars.count(name) ? globals : s).vars[name] = std::move(v);
}

// ---------------------------------------------------------------- opérations

inline Value add(const Value& a, const Value& b, int at, int end) {
    if (a.isList()) { List l = a.list(); if (b.isList()) l.insert(l.end(), b.list().begin(), b.list().end()); else l.push_back(b); return l; }
    if (a.isStr() || b.isStr()) return show(a) + show(b);
    return num(a, "plus", at, end) + num(b, "plus", at, end);
}
inline Value concat(const Value& a, const Value& b) { return show(a) + show(b); }
inline Value sub(const Value& a, const Value& b, int at, int end) { return num(a, "moins", at, end) - num(b, "moins", at, end); }
inline Value mul(const Value& a, const Value& b, int at, int end) { return num(a, "fois", at, end) * num(b, "fois", at, end); }
inline Value div(const Value& a, const Value& b, int at, int end) {
    if (num(b, "divisé par", at, end) == 0) throw Fault("division par zéro", at, end);
    return num(a, "divisé par", at, end) / b.num();
}
inline Value mod(const Value& a, const Value& b, int at, int end) { return std::fmod(num(a, "modulo", at, end), num(b, "modulo", at, end)); }
inline Value pow(const Value& a, const Value& b, int at, int end) { return std::pow(num(a, "puissance", at, end), b.num()); }
inline Value neg(const Value& a) { return -num(a, "moins"); }

inline int order(const Value& a, const Value& b, int at, int end) {
    if (a.isNum() && b.isNum()) return a.num() < b.num() ? -1 : a.num() > b.num() ? 1 : 0;
    if (a.isStr() && b.isStr()) return a.str().compare(b.str()) < 0 ? -1 : a.str() == b.str() ? 0 : 1;
    throw Fault("comparer " + kindOf(a) + " et " + kindOf(b) + " n'a pas de sens", at, end);
}

inline Value contains(const Value& a, const Value& b) {
    if (a.isList()) { for (auto& x : a.list()) if (same(x, b)) return true; return false; }
    return show(a).find(show(b)) != std::string::npos;
}

inline Value test(const std::string& t, const Value& v) {
    if (t == "even") return std::fmod(num(v, "pair"), 2) == 0;
    if (t == "odd") return std::fabs(std::fmod(num(v, "impair"), 2)) == 1;
    if (t == "empty") return v.isStr() ? v.str().empty() : v.isList() ? v.list().empty() : (v.isNum() && v.num() == 0);
    if (t == "positive") return num(v, "positif") > 0;
    if (t == "negative") return num(v, "négatif") < 0;
    return false;
}

inline Value range(const Value& a0, const Value& b0) {
    double a = num(a0, "les nombres de"), b = num(b0, "les nombres jusqu'à");
    if (std::fabs(b - a) > 100000) throw Fault("liste trop grande (plus de 100 000 nombres)");
    List l;
    for (double x = a; a <= b ? x <= b : x >= b; x += a <= b ? 1 : -1) l.push_back(x);
    return l;
}

inline std::vector<double> nums(const Value& v, const std::string& what, int at, int end) {
    std::vector<double> out;
    for (auto& x : list(v, what, at, end)) out.push_back(num(x, what, at, end));
    return out;
}

inline Value builtin(const std::string& fn, const Value& v, int at, int end) {
    if (fn == "sum") { double s = 0; for (double x : nums(v, "la somme", at, end)) s += x; return s; }
    if (fn == "mean") {
        auto xs = nums(v, "la moyenne", at, end);
        if (xs.empty()) throw Fault("la moyenne d'une liste vide n'existe pas", at, end);
        double s = 0; for (double x : xs) s += x; return s / xs.size();
    }
    if (fn == "max" || fn == "min") {
        auto xs = nums(v, fn == "max" ? "le maximum" : "le minimum", at, end);
        if (xs.empty()) throw Fault("liste vide", at, end);
        double m = xs[0];
        for (double x : xs) m = fn == "max" ? std::max(m, x) : std::min(m, x);
        return m;
    }
    if (fn == "len") return v.isStr() ? double(chars(v.str()).size()) : double(list(v, "la longueur", at, end).size());
    // « combien de chats » : les éléments d'une liste, ou le nombre lui-même (« il y a 4 chats »)
    if (fn == "count") return v.isNum() ? v : v.isStr() ? Value(double(chars(v.str()).size())) : Value(double(list(v, "le nombre", at, end).size()));
    if (fn == "sqrt") { double x = num(v, "la racine", at, end); if (x < 0) throw Fault("pas de racine d'un nombre négatif", at, end); return std::sqrt(x); }
    if (fn == "abs") return std::fabs(num(v, "la valeur absolue", at, end));
    if (fn == "round") return std::floor(num(v, "l'arrondi", at, end) + 0.5);
    if (fn == "first" || fn == "last") {
        List l = list(v, fn == "first" ? "le premier" : "le dernier", at, end);
        if (l.empty()) throw Fault("liste vide", at, end);
        return fn == "first" ? l.front() : l.back();
    }
    if (fn == "sorted") {
        List l = list(v, "trier", at, end);
        std::stable_sort(l.begin(), l.end(), [](const Value& a, const Value& b) {
            if (a.isNum() && b.isNum()) return a.num() < b.num();
            return show(a) < show(b);
        });
        return l;
    }
    if (fn == "reversed") { List l = list(v, "inverser", at, end); return List(l.rbegin(), l.rend()); }
    throw Fault("fonction inconnue", at, end);
}

inline Value addTo(const Value& cur, const Value& v, int at, int end) {
    if (cur.none()) return v.isNum() ? v : Value(List{v});
    if (cur.isList()) { List l = cur.list(); if (v.isList()) l.insert(l.end(), v.list().begin(), v.list().end()); else l.push_back(v); return l; }
    if (cur.isStr()) return cur.str() + show(v);
    return num(cur, "ajouter", at, end) + num(v, "ajouter", at, end);
}

inline Value removeFrom(const Value& cur, const Value& v, const std::string& label, int at, int end) {
    if (cur.isList()) {
        List l = cur.list();
        for (size_t i = 0; i < l.size(); i++) if (same(l[i], v)) { l.erase(l.begin() + i); return l; }
        throw Fault(show(v) + " n'est pas dans « " + label + " »", at, end);
    }
    return num(cur, "retirer", at, end) - num(v, "retirer", at, end);
}

// ---------------------------------------------------------------- classes et fiches

inline std::unordered_map<std::string, ClassP> classes;

inline ClassP needClass(const std::string& name, int at, int end) {
    auto it = classes.find(name);
    if (it == classes.end()) throw Fault("« " + label(name) + " » n'est pas encore défini", at, end);
    return it->second;
}

/** « un studio est une sorte d'appartement qui a une mezzanine » : les champs du parent d'abord. */
inline void defineClass(const std::string& name, const std::string& art, const char* parent, std::vector<std::pair<std::string, Value>> own) {
    auto c = std::make_shared<Class>();
    c->name = name;
    c->art = art;
    if (parent) {
        c->parent = classes.at(parent);
        c->fields = c->parent->fields;
        c->defaults = c->parent->defaults;
    }
    for (auto& [f, d] : own) {
        if (!c->has(f)) c->fields.push_back(f);
        if (!d.none()) c->defaults[f] = d;
    }
    classes[name] = c;
}

inline Value make(const std::string& cls, const std::vector<std::string>& names, const List& vals, int at, int end) {
    auto it = classes.find(cls);
    if (it == classes.end()) throw Fault("« " + label(cls) + " » n'est pas encore défini (« un " + label(cls) + " a … »)", at, end);
    auto f = std::make_shared<Fiche>();
    f->cls = it->second;
    f->vals = f->cls->defaults;
    Value r(f);
    for (size_t i = 0; i < names.size(); i++) {
        if (!f->cls->has(names[i])) throw Fault(kindOf(r) + " n'a pas de « " + label(names[i]) + " »", at, end);
        f->vals[names[i]] = vals[i];
    }
    return r;
}

inline Fiche& owner(const Value& o, const std::string& f, int at, int end) {
    if (!o.isFiche()) throw Fault("« " + label(f) + " » : il faut une fiche, pas " + kindOf(o), at, end);
    if (!o.fiche().cls->has(f)) throw Fault(kindOf(o) + " n'a pas de « " + label(f) + " »", at, end);
    return o.fiche();
}

/** Le champ d'une fiche ; sur une liste, le champ de chaque élément (« les loyers des apparts »). */
inline Value field(const Value& o, const std::string& f, int at, int end) {
    if (o.isList()) { List l; for (auto& x : o.list()) l.push_back(field(x, f, at, end)); return l; }
    auto& r = owner(o, f, at, end);
    auto it = r.vals.find(f);
    if (it == r.vals.end()) throw Fault("« " + label(f) + " » n'a pas encore de valeur (" + kindOf(o) + ")", at, end);
    return it->second;
}

inline bool isa(const Value& v, const std::string& cls) {
    if (!v.isFiche()) return false;
    for (const Class* c = v.fiche().cls.get(); c; c = c->parent.get()) if (c->name == cls) return true;
    return false;
}

// ---------------------------------------------------------------- actions définies

struct Action {
    std::vector<std::string> params;
    gl::Body body;
};
inline std::unordered_map<std::string, Action> actions;
inline int depth = 0;
struct Returned { Value value; };

inline Value unwrap(const gl::V& v);

inline Value call(const std::string& name, std::vector<Value> args, int at, int end) {
    auto it = actions.find(name);
    if (it == actions.end()) throw Fault("« " + name + " » n'est pas encore défini (« pour " + name + " …, renvoie … »)", at, end);
    auto& f = it->second;
    if (f.params.size() != args.size()) throw Fault(name + " attend " + std::to_string(f.params.size()) + " valeurs", at, end);
    if (++depth > 200) { depth = 0; throw Fault("trop d'appels imbriqués", at, end); }
    tick();
    Scope local;   // une action ne voit que ses paramètres et le document
    for (size_t i = 0; i < args.size(); i++) local.vars[f.params[i]] = std::move(args[i]);
    struct Leave { ~Leave() { depth--; } } leave;
    try { return unwrap(f.body(local)); }
    catch (gl::Returned& r) { return unwrap(r.value); }
}

// ---------------------------------------------------------------- une phrase

inline void phrase(int k, void (*run)()) {
    std::cout << "\x1eP" << k << "\n";
    steps = 0;
    lines = dropped = 0;
    auto close = [] { if (dropped) std::cout << "… " << dropped << " lignes de plus\n"; dropped = 0; };
    try { run(); close(); }
    catch (Fault& f) { close(); std::cout << "\x1e" "F" << f.at << " " << f.end << " " << f.what() << "\n"; }
    catch (gl::Returned&) { close(); /* « renvoie » hors d'une action : la phrase s'arrête là */ }
    std::cout.flush();
}

inline void print(const std::vector<Value>& xs) {
    std::string s;
    // Une espace entre deux valeurs, sauf si l'une l'a déjà (comme dans la page)
    auto blank = [](char c) { return c == ' ' || c == '\t' || c == '\n'; };
    for (size_t i = 0; i < xs.size(); i++) {
        std::string p = show(xs[i]);
        if (i && !(!s.empty() && blank(s.back())) && !(!p.empty() && blank(p.front()))) s += " ";
        s += p;
    }
    if (lines < MAX_LINES) { lines++; std::cout << s << "\n"; } else dropped++;
}

}  // namespace glrt

// ---------------------------------------------------------------- interface (gl.hpp)

struct gl::Rep {
    int refs;
    glrt::Value val;
};

namespace glrt {
inline Value unwrap(const gl::V& v) { return v.rep() ? v.rep()->val : Value(); }
inline gl::V wrap(Value v) { return gl::V(new gl::Rep{1, std::move(v)}); }
inline const Value& val(const gl::V& v) { static const Value none; return v.rep() ? v.rep()->val : none; }
inline List items(const gl::V* xs, int n) { List l; for (int i = 0; i < n; i++) l.push_back(val(xs[i])); return l; }
}  // namespace glrt

using glrt::val;
using glrt::wrap;

gl::V::V() : r_(nullptr) {}
gl::V::V(double d) : r_(new Rep{1, glrt::Value(d)}) {}
gl::V::V(int d) : r_(new Rep{1, glrt::Value(d)}) {}
gl::V::V(bool b) : r_(new Rep{1, glrt::Value(b)}) {}
gl::V::V(const char* s) : r_(new Rep{1, glrt::Value(std::string(s))}) {}
gl::V::V(const V& o) : r_(o.r_) { if (r_) r_->refs++; }
gl::V& gl::V::operator=(const V& o) { if (o.r_) o.r_->refs++; this->~V(); r_ = o.r_; return *this; }
gl::V& gl::V::operator=(V&& o) noexcept { if (this != &o) { this->~V(); r_ = o.r_; o.r_ = nullptr; } return *this; }
gl::V::~V() { if (r_ && --r_->refs == 0) delete r_; r_ = nullptr; }

gl::Scope& gl::globals() { return glrt::globals; }
void gl::tick() { glrt::tick(); }
gl::V gl::lookup(Scope& s, const char* name, const char* label, int at, int end) { return wrap(glrt::lookup(s, name, label, at, end)); }
bool gl::has(Scope& s, const char* name) { return glrt::has(s, name); }
void gl::assign(Scope& s, const char* name, const V& v) { glrt::assign(s, name, val(v)); }
void gl::set(Scope& s, const char* name, const V& v) { s.vars[name] = val(v); }
bool gl::truth(const V& v) { return glrt::truth(val(v)); }
double gl::num(const V& v, const char* what) { return glrt::num(val(v), what); }
gl::V gl::list(const V* xs, int n) { return wrap(glrt::items(xs, n)); }
gl::V gl::aslist(const V& v, const char* what) { return wrap(glrt::list(val(v), what)); }
int gl::count(const V& l) { return int(val(l).list().size()); }
gl::V gl::item(const V& l, int i) { return wrap(val(l).list()[i]); }
gl::V gl::range(const V& a, const V& b) { return wrap(glrt::range(val(a), val(b))); }
gl::V gl::neg(const V& v) { return wrap(glrt::neg(val(v))); }
gl::V gl::test(const char* t, const V& v) { return wrap(glrt::test(t, val(v))); }
gl::V gl::builtin(const char* fn, const V& v, int at, int end) { return wrap(glrt::builtin(fn, val(v), at, end)); }

gl::V gl::binop(const char* op0, const V& A, const V& B, int at, int end) {
    const std::string op = op0;
    const glrt::Value &a = val(A), &b = val(B);
    if (op == "add") return wrap(glrt::add(a, b, at, end));
    if (op == "sub") return wrap(glrt::sub(a, b, at, end));
    if (op == "mul") return wrap(glrt::mul(a, b, at, end));
    if (op == "div") return wrap(glrt::div(a, b, at, end));
    if (op == "mod") return wrap(glrt::mod(a, b, at, end));
    if (op == "pow") return wrap(glrt::pow(a, b, at, end));
    if (op == "concat") return wrap(glrt::concat(a, b));
    if (op == "eq") return wrap(glrt::same(a, b));
    if (op == "ne") return wrap(!glrt::same(a, b));
    if (op == "gt") return wrap(glrt::order(a, b, at, end) > 0);
    if (op == "lt") return wrap(glrt::order(a, b, at, end) < 0);
    if (op == "ge") return wrap(glrt::order(a, b, at, end) >= 0);
    if (op == "le") return wrap(glrt::order(a, b, at, end) <= 0);
    if (op == "contains") return wrap(glrt::contains(a, b));
    throw glrt::Fault("opération inconnue", at, end);
}

gl::V gl::addTo(Scope& s, const char* name, const char* label, const V& v, int at, int end) {
    glrt::Value cur = glrt::has(s, name) ? glrt::lookup(s, name, label, at, end) : glrt::Value();
    glrt::Value next = glrt::addTo(cur, val(v), at, end);
    glrt::assign(s, name, next);
    return wrap(next);
}

gl::V gl::removeFrom(Scope& s, const char* name, const char* label, const V& v, int at, int end) {
    glrt::Value next = glrt::removeFrom(glrt::lookup(s, name, label, at, end), val(v), label, at, end);
    glrt::assign(s, name, next);
    return wrap(next);
}

void gl::needClass(const char* name, int at, int end) { glrt::needClass(name, at, end); }

void gl::defineClass(const char* name, const char* art, const char* parent, const char* const* fields, const V* defaults, int n) {
    std::vector<std::pair<std::string, glrt::Value>> own;
    for (int i = 0; i < n; i++) own.emplace_back(fields[i], val(defaults[i]));
    glrt::defineClass(name, art, parent, std::move(own));
}

gl::V gl::make(const char* cls, const char* const* fields, const V* vals, int n, int at, int end) {
    return wrap(glrt::make(cls, std::vector<std::string>(fields, fields + n), glrt::items(vals, n), at, end));
}

gl::V gl::field(const V& o, const char* f, int at, int end) { return wrap(glrt::field(val(o), f, at, end)); }
gl::V gl::isa(const V& v, const char* cls, bool neg) { return wrap(glrt::isa(val(v), cls) != neg); }

void gl::setField(const V& o, const char* f, const V& v, int at, int end) { glrt::owner(val(o), f, at, end).vals[f] = val(v); }

gl::V gl::addToField(const V& o, const char* f, const V& v, int at, int end) {
    auto& r = glrt::owner(val(o), f, at, end);
    auto it = r.vals.find(f);
    glrt::Value next = glrt::addTo(it == r.vals.end() ? glrt::Value() : it->second, val(v), at, end);
    r.vals[f] = next;
    return wrap(next);
}

gl::V gl::removeFromField(const V& o, const char* f, const V& v, int at, int end) {
    glrt::Value next = glrt::removeFrom(glrt::field(val(o), f, at, end), val(v), glrt::label(f), at, end);
    glrt::owner(val(o), f, at, end).vals[f] = next;
    return wrap(next);
}

gl::V gl::table(const char* name, const char* const* columns, int ncols, const V* cells, int nrows) {
    auto c = std::make_shared<glrt::Class>();
    c->name = name;
    c->art = "une ligne de";
    c->fields.assign(columns, columns + ncols);
    glrt::List rows;
    for (int r = 0; r < nrows; r++) {
        auto f = std::make_shared<glrt::Fiche>();
        f->cls = c;
        for (int k = 0; k < ncols; k++) if (!val(cells[r * ncols + k]).none()) f->vals[columns[k]] = val(cells[r * ncols + k]);
        rows.push_back(glrt::Value(f));
    }
    return wrap(std::move(rows));
}

gl::V gl::record(const char* cls, const char* const* fields, const V* vals, int n) {
    auto c = std::make_shared<glrt::Class>();
    c->name = cls;
    c->art = "une fiche";
    c->fields.assign(fields, fields + n);
    auto f = std::make_shared<glrt::Fiche>();
    f->cls = c;
    for (int k = 0; k < n; k++) f->vals[fields[k]] = val(vals[k]);
    return wrap(glrt::Value(f));
}

gl::V gl::where(const V& list, const char* field, const char* op, const V& rhs, int at, int end) {
    const std::string o = op;
    glrt::List out;
    for (auto& x : glrt::list(val(list), "dont", at, end)) {
        // « les notes qui sont au moins 10 » : sans champ, le test porte sur l'élément lui-même
        if (!*field) {
            bool keep = o.compare(0, 5, "test:") == 0 ? glrt::truth(glrt::test(o.substr(5), x)) : gl::truth(gl::binop(op, wrap(x), rhs, at, end));
            if (keep) out.push_back(x);
            continue;
        }
        auto& r = glrt::owner(x, field, at, end);
        auto it = r.vals.find(field);
        if (it == r.vals.end()) continue;   // une case vide ne passe aucun test
        bool keep = o.compare(0, 5, "test:") == 0 ? glrt::truth(glrt::test(o.substr(5), it->second))
                                                  : gl::truth(gl::binop(op, wrap(it->second), rhs, at, end));
        if (keep) out.push_back(x);
    }
    return wrap(std::move(out));
}

void gl::define(const char* name, const char* const* params, int n, Body body) {
    glrt::actions[name] = glrt::Action{std::vector<std::string>(params, params + n), body};
}

gl::V gl::call(const char* name, const V* args, int n, int at, int end) {
    return wrap(glrt::call(name, glrt::items(args, n), at, end));
}

void gl::print(const V* xs, int n) { glrt::print(glrt::items(xs, n)); }
void gl::phrase(int k, void (*run)()) { glrt::phrase(k, run); }

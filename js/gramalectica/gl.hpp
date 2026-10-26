// Grama Lectica — interface du moteur C++ (gl_runtime.cpp).
//
// Le programme généré à partir des phrases n'inclut que ce fichier : une valeur y est un pointeur opaque,
// sans modèle de la bibliothèque standard. Le moteur, lui, est compilé une seule fois (gl_runtime.o) puis lié
// à chaque programme : dans la machine émulée, seule la petite partie propre au document se recompile.

#pragma once

namespace gl {

struct Rep;

/** Une valeur : nombre, texte, vrai/faux, liste ou fiche. Copier une valeur est gratuit (compteur de références). */
class V {
    Rep* r_;
public:
    V();
    V(double d);
    V(int d);
    V(bool b);
    V(const char* utf8);
    explicit V(Rep* adopt) : r_(adopt) {}
    V(const V& o);
    V(V&& o) noexcept : r_(o.r_) { o.r_ = nullptr; }
    V& operator=(const V& o);
    V& operator=(V&& o) noexcept;
    ~V();
    Rep* rep() const { return r_; }
};

struct Scope;
Scope& globals();
struct Returned { V value; };

void tick();
V lookup(Scope& s, const char* name, const char* label, int at, int end);
bool has(Scope& s, const char* name);
void assign(Scope& s, const char* name, const V& v);
void set(Scope& s, const char* name, const V& v);

bool truth(const V& v);
double num(const V& v, const char* what);
V list(const V* items, int n);
V aslist(const V& v, const char* what);
int count(const V& list);
V item(const V& list, int i);
V range(const V& from, const V& to);
V neg(const V& v);
V test(const char* t, const V& v);
V builtin(const char* fn, const V& v, int at, int end);
/** add sub mul div mod pow concat eq ne gt lt ge le contains */
V binop(const char* op, const V& a, const V& b, int at, int end);
V addTo(Scope& s, const char* name, const char* label, const V& v, int at, int end);
V removeFrom(Scope& s, const char* name, const char* label, const V& v, int at, int end);

/** Classes et fiches : « un appartement a un loyer… », « … avec un loyer de 650 », « le loyer de … » */
void needClass(const char* name, int at, int end);
/** defaults[i] vide : le champ n'a pas de valeur par défaut */
void defineClass(const char* name, const char* art, const char* parent, const char* const* fields, const V* defaults, int n);
V make(const char* cls, const char* const* fields, const V* vals, int n, int at, int end);
V field(const V& obj, const char* field, int at, int end);
V isa(const V& v, const char* cls, bool neg);
void setField(const V& obj, const char* field, const V& v, int at, int end);
V addToField(const V& obj, const char* field, const V& v, int at, int end);
V removeFromField(const V& obj, const char* field, const V& v, int at, int end);
/** Une fiche venue de Python (un dictionnaire) : « une fiche <cls> » */
V record(const char* cls, const char* const* fields, const V* vals, int n);
/** Un tableau du document : une fiche par ligne (cells : ligne après ligne, vide = case vide) */
V table(const char* name, const char* const* columns, int ncols, const V* cells, int nrows);
/** « … dont le loyer est moins de 700 » ; op : eq ne gt lt ge le contains, ou test:even… (rhs ignoré) */
V where(const V& list, const char* field, const char* op, const V& rhs, int at, int end);

typedef V (*Body)(Scope&);
void define(const char* name, const char* const* params, int n, Body body);
V call(const char* name, const V* args, int n, int at, int end);

void print(const V* xs, int n);
void phrase(int k, void (*run)());

}  // namespace gl

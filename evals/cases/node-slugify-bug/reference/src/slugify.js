/** Turns a title into a URL slug: "Árbol de Navidad" → "arbol-de-navidad". */
export function slugify(title) {
  return String(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

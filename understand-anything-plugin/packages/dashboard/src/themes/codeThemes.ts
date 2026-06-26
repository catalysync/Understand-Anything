import type { PrismTheme } from "prism-react-renderer";

/**
 * Zed Light (Atom One Light) syntax theme for prism-react-renderer.
 * Used on light presets so code reads dark-on-light (the vsDark theme
 * renders near-invisible on a light background).
 *
 * One Light tokens: bg #fafafa, fg #383a42, keyword #a626a4,
 * string #50a14f, func #4078f2, class #c18401, number #986801,
 * variable/tag #e45649, operator #0184bc, comment #a0a1a7.
 */
export const zedLightPrism: PrismTheme = {
  plain: {
    color: "#383a42",
    backgroundColor: "#fafafa",
  },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "#a0a1a7", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "#383a42" } },
    { types: ["keyword", "boolean", "keyword-control"], style: { color: "#a626a4" } },
    { types: ["string", "char", "attr-value"], style: { color: "#50a14f" } },
    { types: ["function", "function-variable"], style: { color: "#4078f2" } },
    { types: ["class-name", "builtin", "maybe-class-name"], style: { color: "#c18401" } },
    { types: ["number", "constant", "symbol"], style: { color: "#986801" } },
    { types: ["variable", "tag", "property", "attr-name", "deleted"], style: { color: "#e45649" } },
    { types: ["operator", "url", "regex", "inserted", "entity"], style: { color: "#0184bc" } },
    { types: ["selector", "namespace", "important"], style: { color: "#383a42" } },
  ],
};

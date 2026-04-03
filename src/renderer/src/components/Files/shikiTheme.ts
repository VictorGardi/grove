import type { ThemeRegistration } from "shiki";

/**
 * Custom Shiki theme derived from the Grove app palette (variables.css).
 * Shiki requires concrete hex values, not CSS variables.
 */
export const groveTheme: ThemeRegistration = {
  name: "grove-dark",
  type: "dark",
  colors: {
    "editor.background": "#101012",
    "editor.foreground": "#e2e2e6",
    "editorLineNumber.foreground": "#44444e",
  },
  tokenColors: [
    // Keywords: accent purple
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "keyword.control",
        "keyword.operator.new",
      ],
      settings: { foreground: "#7b68ee" },
    },
    // Strings: status green
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#3ecf8e" },
    },
    // Comments: text-lo italic
    {
      scope: ["comment", "comment.line", "comment.block"],
      settings: { foreground: "#44444e", fontStyle: "italic" },
    },
    // Numbers / constants: status amber
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#e8a44a" },
    },
    // Functions: status blue
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#5ba3f5" },
    },
    // Types / classes: amber
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "#e8a44a" },
    },
    // Variables: foreground
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#e2e2e6" },
    },
    // Properties
    {
      scope: ["variable.other.property", "support.variable.property"],
      settings: { foreground: "#b0b0ba" },
    },
    // Operators
    {
      scope: ["keyword.operator", "punctuation"],
      settings: { foreground: "#8b8b96" },
    },
    // Tags (HTML/JSX)
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#e05c5c" },
    },
    // Attributes
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#e8a44a" },
    },
    // Template expression punctuation
    {
      scope: ["punctuation.definition.template-expression"],
      settings: { foreground: "#7b68ee" },
    },
    // Regex
    {
      scope: ["string.regexp"],
      settings: { foreground: "#e05c5c" },
    },
    // Markdown headings
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#7b68ee", fontStyle: "bold" },
    },
    // Markdown bold
    {
      scope: ["markup.bold"],
      settings: { fontStyle: "bold" },
    },
    // Markdown italic
    {
      scope: ["markup.italic"],
      settings: { fontStyle: "italic" },
    },
    // Markdown links
    {
      scope: ["markup.underline.link"],
      settings: { foreground: "#5ba3f5" },
    },
    // JSON keys
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#5ba3f5" },
    },
    // CSS properties
    {
      scope: ["support.type.property-name.css"],
      settings: { foreground: "#5ba3f5" },
    },
    // CSS values
    {
      scope: ["support.constant.property-value.css"],
      settings: { foreground: "#e8a44a" },
    },
  ],
};

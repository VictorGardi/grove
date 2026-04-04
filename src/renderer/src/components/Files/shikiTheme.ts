import type { ThemeRegistration } from "shiki";

/**
 * Custom Shiki themes derived from the Grove app palettes.
 * Shiki requires concrete hex values, not CSS variables.
 */

// ── Default (dark) ─────────────────────────────────────────────

export const groveTheme: ThemeRegistration = {
  name: "grove-dark",
  type: "dark",
  colors: {
    "editor.background": "#101012",
    "editor.foreground": "#e2e2e6",
    "editorLineNumber.foreground": "#44444e",
  },
  tokenColors: [
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
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#3ecf8e" },
    },
    {
      scope: ["comment", "comment.line", "comment.block"],
      settings: { foreground: "#44444e", fontStyle: "italic" },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#e8a44a" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#5ba3f5" },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "#e8a44a" },
    },
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#e2e2e6" },
    },
    {
      scope: ["variable.other.property", "support.variable.property"],
      settings: { foreground: "#b0b0ba" },
    },
    {
      scope: ["keyword.operator", "punctuation"],
      settings: { foreground: "#8b8b96" },
    },
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#e05c5c" },
    },
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#e8a44a" },
    },
    {
      scope: ["punctuation.definition.template-expression"],
      settings: { foreground: "#7b68ee" },
    },
    { scope: ["string.regexp"], settings: { foreground: "#e05c5c" } },
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#7b68ee", fontStyle: "bold" },
    },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link"], settings: { foreground: "#5ba3f5" } },
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#5ba3f5" },
    },
    {
      scope: ["support.type.property-name.css"],
      settings: { foreground: "#5ba3f5" },
    },
    {
      scope: ["support.constant.property-value.css"],
      settings: { foreground: "#e8a44a" },
    },
  ],
};

// ── Catppuccin Mocha (dark) ─────────────────────────────────────

export const groveThemeMocha: ThemeRegistration = {
  name: "grove-catppuccin-mocha",
  type: "dark",
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "editorLineNumber.foreground": "#585b70",
  },
  tokenColors: [
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "keyword.control",
        "keyword.operator.new",
      ],
      settings: { foreground: "#cba6f7" },
    }, // Mauve
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#a6e3a1" },
    }, // Green
    {
      scope: ["comment", "comment.line", "comment.block"],
      settings: { foreground: "#585b70", fontStyle: "italic" },
    }, // Surface2
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#fab387" },
    }, // Peach
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#89b4fa" },
    }, // Blue
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "#f9e2af" },
    }, // Yellow
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#cdd6f4" },
    }, // Text
    {
      scope: ["variable.other.property", "support.variable.property"],
      settings: { foreground: "#bac2de" },
    }, // Subtext1
    {
      scope: ["keyword.operator", "punctuation"],
      settings: { foreground: "#9399b2" },
    }, // Overlay2
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#f38ba8" },
    }, // Red
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#fab387" },
    }, // Peach
    {
      scope: ["punctuation.definition.template-expression"],
      settings: { foreground: "#cba6f7" },
    }, // Mauve
    { scope: ["string.regexp"], settings: { foreground: "#f38ba8" } }, // Red
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#cba6f7", fontStyle: "bold" },
    },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link"], settings: { foreground: "#89b4fa" } }, // Blue
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#74c7ec" },
    }, // Sapphire
    {
      scope: ["support.type.property-name.css"],
      settings: { foreground: "#74c7ec" },
    },
    {
      scope: ["support.constant.property-value.css"],
      settings: { foreground: "#fab387" },
    }, // Peach
  ],
};

// ── Catppuccin Latte (light) ────────────────────────────────────

export const groveThemeLatte: ThemeRegistration = {
  name: "grove-catppuccin-latte",
  type: "light",
  colors: {
    "editor.background": "#eff1f5",
    "editor.foreground": "#4c4f69",
    "editorLineNumber.foreground": "#9ca0b0",
  },
  tokenColors: [
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "keyword.control",
        "keyword.operator.new",
      ],
      settings: { foreground: "#8839ef" },
    }, // Mauve
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "#40a02b" },
    }, // Green
    {
      scope: ["comment", "comment.line", "comment.block"],
      settings: { foreground: "#9ca0b0", fontStyle: "italic" },
    }, // Overlay0
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#fe640b" },
    }, // Peach
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#1e66f5" },
    }, // Blue
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class",
      ],
      settings: { foreground: "#df8e1d" },
    }, // Yellow
    {
      scope: ["variable", "variable.other"],
      settings: { foreground: "#4c4f69" },
    }, // Text
    {
      scope: ["variable.other.property", "support.variable.property"],
      settings: { foreground: "#5c5f77" },
    }, // Subtext1
    {
      scope: ["keyword.operator", "punctuation"],
      settings: { foreground: "#6c6f85" },
    }, // Subtext0
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#d20f39" },
    }, // Red
    {
      scope: ["entity.other.attribute-name"],
      settings: { foreground: "#fe640b" },
    }, // Peach
    {
      scope: ["punctuation.definition.template-expression"],
      settings: { foreground: "#8839ef" },
    }, // Mauve
    { scope: ["string.regexp"], settings: { foreground: "#d20f39" } }, // Red
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#8839ef", fontStyle: "bold" },
    },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.underline.link"], settings: { foreground: "#1e66f5" } }, // Blue
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#209fb5" },
    }, // Sapphire
    {
      scope: ["support.type.property-name.css"],
      settings: { foreground: "#209fb5" },
    },
    {
      scope: ["support.constant.property-value.css"],
      settings: { foreground: "#fe640b" },
    }, // Peach
  ],
};

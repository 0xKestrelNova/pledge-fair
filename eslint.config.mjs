// Configuration ESLint (flat config). Quatre environnements distincts :
//   - scripts/          : Node.js, modules ES, exécuté en CI (globals Node).
//   - docs/**/*.js      : navigateur, modules ES chargés via
//                         <script type="module"> (globals navigateur).
//                         data.json est généré, donc ignoré.
//   - docs/**/*.test.mjs : tests node --test de la logique pure de core.js
//                         (globals Node, sans navigateur).
//   - extension/**/*.js : extension de navigateur (globals navigateur +
//                         `chrome`). Ses tests et son adaptateur de fixtures
//                         (extension/**/*.mjs) tournent sous Node.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "docs/data.json"] },

  {
    files: ["scripts/**/*.mjs", "*.mjs", "docs/**/*.test.mjs", "extension/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Les catch vides volontaires (JSON illisible, fichier absent) sont
      // commentés et intentionnels.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  {
    files: ["docs/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, chrome: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
];

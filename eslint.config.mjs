import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Underscore-prefixed args/vars are intentionally unused (stubs, destructure).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node.js runtime scripts (docker/, packaging/, tools/) use Node globals.
    files: ["docker/**/*.mjs", "packaging/**/*.mjs", "tools/**/*.mjs", "**/*.test.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser, // fetch/URL/Headers/Request are global in Node 18+
      },
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/.wrangler/"],
  },
);
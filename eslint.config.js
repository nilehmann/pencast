import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs["flat/recommended"],

  // Global ignores
  {
    ignores: ["dist/**", "node_modules/**"],
  },

  // Server-side TypeScript
  {
    files: ["server.ts", "shared/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.server.json",
      },
    },
  },

  // Client-side TypeScript & Svelte
  {
    files: [
      "client/src/**/*.ts",
      "client/src/**/*.svelte",
      "client/src/**/*.svelte.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        project: "./client/tsconfig.json",
        extraFileExtensions: [".svelte"],
      },
    },
  },

  // Svelte-specific parser setup for actual .svelte components
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: sveltePlugin.parser,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // .svelte.ts files use runes but are plain TypeScript — override the svelte
  // plugin's broad file matcher and parse them with the TS parser directly.
  {
    files: ["**/*.svelte.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },

  // Rules applied everywhere
  {
    rules: {
      // Unused variables & imports
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off", // Disabled in favour of the TS-aware rule above

      // Catch other common issues
      "svelte/prefer-svelte-reactivity": "off", // Too coarse — fires on non-reactive locals too
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      // "no-console": "warn",
    },
  },
);

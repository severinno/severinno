import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — start with the most impactful
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "warn",

    // React hooks — catch stale closures and missing deps
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/rules-of-hooks": "error",
    "react/display-name": "warn",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    "react/no-unescaped-entities": "off",

    // Next.js — prefer next/image for performance
    "@next/next/no-img-element": "warn",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript — basic code quality
    "prefer-const": "warn",
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-debugger": "warn",
    "no-irregular-whitespace": "error",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-empty": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "warn",
  },
},
// ── Overrides for scripts, e2e tests, seed, and mini-services ──
// These files intentionally use console.log for operational logging
// and may have looser TypeScript conventions.
{
  files: [
    "scripts/**/*.{ts,mjs,js}",
    "e2e/**/*.ts",
    "prisma/seed.ts",
    "prisma/populate.ts",
    "mini-services/**/*.ts",
    "src/queue/**/*.ts",
  ],
  rules: {
    "no-console": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/rules-of-hooks": "off",
    "@next/next/no-img-element": "off",
    "react/display-name": "off",
  },
},
// ── Override for generated Prisma files ──
{
  files: ["src/generated/**/*.ts"],
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
    "no-console": "off",
    "prefer-const": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
},
{
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;

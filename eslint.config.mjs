import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"
import reactHooks from "eslint-plugin-react-hooks"
import react from "eslint-plugin-react"
import { dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Plugin declarado explicitamente — sem isso, arquivos fora do padrão
    // do eslint-config-next (ex.: scripts/*.mjs) falham com
    // "The 'react-hooks' plugin is not defined in your configuration file".
    plugins: {
      "react-hooks": reactHooks,
      react,
    },
    rules: {
      // TypeScript rules — start with the most impactful
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
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
      "no-console": ["warn", { allow: ["warn", "error"] }],
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
  {
    // Arquivos de teste — `as any` em mocks é idiomático; console/log em
    // testes e e2e é esperado (reporting, debug). Manter o lint de
    // produção estrito sem penalizar os testes.
    // Escopado a arquivos de código: `**/*.test.*` casaria YAML/JSON/etc.
    // (ex.: docker-compose.test.yml) e quebraria o parser.
    files: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/__tests__/**/*.{ts,tsx,js,jsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
    },
  },
  {
    // Scripts CLI/benchmark, seeds Prisma e mini-services — o console é o
    // mecanismo de output correto (não há logger/browser) e `any` em dados
    // dinâmicos de CLI é idiomático. no-console/no-explicit-any só fazem
    // sentido no código da aplicação (src/).
    files: ["scripts/**", "prisma/**", "mini-services/**", "test-prisma7.mjs"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills",
    ],
  },
]

export default eslintConfig

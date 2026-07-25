import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // ── TypeScript (all active) ──
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/prefer-as-const": "error",
    "@typescript-eslint/no-unused-vars": ["warn", { "varsIgnorePattern": "^_", "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],

    // ── React (selective relaxations) ──
    // set-state-in-effect: ERROR — banir setState() síncrono no corpo do useEffect.
    // A regra NÃO flagra setState dentro de callbacks assíncronos legítimos:
    //   • requestAnimationFrame / setInterval / setTimeout
    //   • IntersectionObserver / ResizeObserver / MutationObserver
    //   • addEventListener / removeEventListener
    //   • fetch().then() / async / await
    "react-hooks/set-state-in-effect": "error",
    "react-hooks/exhaustive-deps": "error",
    "react/no-unescaped-entities": "error",
    "react/display-name": "error",
    "react/prop-types": "off", // TypeScript cobre validação de props

    // ── Next.js ──
    "@next/next/no-img-element": "warn",      // TODO: upgrade to 'error' after migrating 12 <img> to <Image>
    "@next/next/no-html-link-for-pages": "error",

    // ── General JS ──
    "no-console": "warn",
    "no-debugger": "warn",
    "no-useless-escape": "error",
    "no-case-declarations": "error",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "mini-services", "prisma"]
}];

export default eslintConfig;

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Playwright's output. The HTML report embeds the trace viewer, whose
      // bundles are large enough that Babel gives up on styling them and the
      // run appears to hang — several minutes of work on files nobody wrote.
      // Flat config does not read .gitignore, so these need saying twice.
      "playwright-report/**",
      "test-results/**",
      // Standalone design prototype runtimes, not application source. They ship
      // deprecated React 17 helpers so the handoff HTML can open by itself.
      "docs/design_handoff_admin_products_taxonomy/**",
      "docs/admin-products-page-redesign-handoff/**",
    ],
  },
];

export default eslintConfig;

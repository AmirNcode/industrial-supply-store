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
      // Local-only folders (see .gitignore). The design prototypes in them ship
      // deprecated React 17 runtimes so the handoff HTML can open by itself.
      ".archive/**",
      ".superpowers/**",
      "other_ignore/**",
      "docs/design_handoff_*/**",
      "docs/*-handoff/**",
    ],
  },
];

export default eslintConfig;

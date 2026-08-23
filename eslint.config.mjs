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
      // Standalone design prototype runtime, not application source. It ships
      // deprecated React 17 helpers so the handoff HTML can open by itself.
      "docs/design_handoff_admin_products_taxonomy/**",
    ],
  },
];

export default eslintConfig;

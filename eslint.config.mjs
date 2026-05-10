import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "import/no-anonymous-default-export": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "tailwind.config.ts",
    ],
  },
];

export default config;

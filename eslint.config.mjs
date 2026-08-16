import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Trust boundary (AGENTS.md §4.10/§4.14): privileged server modules must never be
  // reachable from UI or engine code. `server-only` catches this at build time too;
  // this rule catches it at edit time with a clearer message.
  {
    files: ["src/components/**", "src/engine/**", "src/lib/firebase.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/firebaseAdmin", "@/server/*", "firebase-admin", "firebase-admin/*"],
              message:
                "Admin SDK and server modules are server-only. Call the /api/runs routes instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lanefoundry/gatelane-sdk": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/index.ts",
      ),
      "@lanefoundry/gatelane-sdk/gate": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/gate.ts",
      ),
      "@lanefoundry/gatelane-sdk/dataset": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/dataset.ts",
      ),
      "@lanefoundry/gatelane-sdk/promotion": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/promotion.ts",
      ),
      "@lanefoundry/gatelane-sdk/candidate": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/candidate.ts",
      ),
      "@lanefoundry/gatelane-sdk/capture": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/capture.ts",
      ),
      "@lanefoundry/gatelane-sdk/storage": resolve(
        import.meta.dirname,
        "packages/gatelane-sdk/src/storage.ts",
      ),
      "@lanefoundry/gatelane-engine": resolve(
        import.meta.dirname,
        "packages/gatelane-engine/src/index.ts",
      ),
      "@lanefoundry/gatelane-engine/attack": resolve(
        import.meta.dirname,
        "packages/gatelane-engine/src/attack.ts",
      ),
      "@lanefoundry/gatelane-engine/redteam": resolve(
        import.meta.dirname,
        "packages/gatelane-engine/src/redteam.ts",
      ),
      "@lanefoundry/source-prod-slice": resolve(
        import.meta.dirname,
        "packages/source-prod-slice/src/index.ts",
      ),
    },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});

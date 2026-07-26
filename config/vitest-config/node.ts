import {
  defineConfig,
  type TestUserConfig,
  type ViteUserConfig,
} from "vitest/config";

type VitestConfig = ViteUserConfig & { test?: TestUserConfig };

export function createNodeVitestConfig(config: VitestConfig = {}) {
  return defineConfig({
    ...config,
    test: {
      environment: "node",
      globals: true,
      ...config.test,
    },
  });
}

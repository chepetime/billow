import { fileURLToPath } from "node:url";

import { createNodeVitestConfig } from "@billow/vitest-config/node";

export default createNodeVitestConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

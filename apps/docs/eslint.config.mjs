import base from "@billow/eslint-config/next";

// Fumadocs generates `.source/` during dev/build. It is machine-written and
// gitignored, so it is not ours to lint.
const config = [{ ignores: [".source/**"] }, ...base];

export default config;

// `server-only` throws when imported outside a server bundle, which is exactly
// what it is for — but it makes server modules untestable under Vitest. Tests
// run in Node, so aliasing it to this empty module is safe and lets the pure
// helpers inside server modules be tested directly.
export {};

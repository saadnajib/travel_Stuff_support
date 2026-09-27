// Preloaded via `node --import ./test/setup.ts` so it runs before any test module (and its imports) is evaluated.
// Works on Windows too, where a `NODE_ENV=test cmd` prefix does not.
process.env.NODE_ENV = 'test';

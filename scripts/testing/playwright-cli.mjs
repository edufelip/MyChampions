import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve from the client package, just as its configs/specs do. Yarn may put
// a parent workspace's binary first on PATH when both module copies exist.
// Importing the resolved CLI preserves argv, exit codes and signal ownership
// without introducing another child process.
const require = createRequire(new URL('../../package.json', import.meta.url));
await import(pathToFileURL(require.resolve('@playwright/test/cli')).href);

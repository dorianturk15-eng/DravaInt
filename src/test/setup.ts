import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Testing Library auto-registers cleanup only when Vitest runs with
// `globals: true`, which this project does not. Without it every render()
// stays in document.body for the rest of the file, so a second render makes
// getByRole find duplicates. Register it explicitly.
afterEach(cleanup);


Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
});

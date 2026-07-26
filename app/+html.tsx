import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

const browserStyles = `
html, body, #root { min-height: 100%; min-width: 0; }
body { margin: 0; }
*:focus { outline: none; }
:root { --focus-ring: #167a42; }
@media (prefers-color-scheme: dark) { :root { --focus-ring: #4ade80; } }
*:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 3px; }
[role="button"], [role="link"], button, a { cursor: pointer; }
@media (hover: hover) {
  [role="button"]:hover, [role="link"]:hover, button:hover, a:hover { filter: brightness(0.97); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
`;

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en-US">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: browserStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

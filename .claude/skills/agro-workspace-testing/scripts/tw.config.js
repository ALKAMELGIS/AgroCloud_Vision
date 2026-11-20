// Tailwind build for offline tests. REPO = repo root.
const R = process.env.REPO || '.';
module.exports = {
  content: [`${R}/*.html`, `${R}/js/*.js`],
  theme: { extend: {
    colors: { brand: { 50: '#eafbf0', 100: '#d2f3df', 600: '#16a34a', 700: '#0f3d22', 800: '#0a2e18', 900: '#052e16' } },
    fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
  } },
};

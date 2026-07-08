/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // TOODOOH brand palette (per brand guidelines). Semantic token names —
        // see docs/superpowers/plans/2026-05-18-step-12-brand-token.md §1 (D-A).
        brand: {
          primary: '#76E6AB', // Algae Green — primary accent
          deep: '#204B43', // Plantation — dark forest green
          accent: '#9195F8', // Portage — periwinkle accent
        },
        // "Mes performances" mockup palette (the design HTMLs' FINAL :root overrides).
        // Page-scoped: only the performance page binds to these.
        perf: {
          page: '#F5F6F8',
          line: '#E9EBEF',
          soft: '#F0F1F4',
          ink: '#10251A',
          grey: '#5B6E63',
          mist: '#8A9E92',
          green: '#1D9E75', // the mockups' --c-accent
          lavender: '#ECEDFD', // the mockups' --c-amber-bg (portage wash)
        },
      },
    },
  },
  plugins: [],
};

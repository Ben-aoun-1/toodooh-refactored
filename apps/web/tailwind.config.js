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
      },
    },
  },
  plugins: [],
};

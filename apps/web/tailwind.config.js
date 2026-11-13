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
        // « Je me positionne » Foot palette (Mariem 04/11, Toodooh_Je_me_positionne_Foot.html).
        // Page-scoped: only the Foot positioning parcours binds to these.
        pitch: {
          ink: '#0D2B1F', // the ticket's night green, the clock
          deep: '#14523A',
          field: '#1C7A4A',
          leaf: '#1D9E75', // icon tiles, the slider's fill
          grass: '#3FCB86',
          wash: '#E9F8F0',
          line: '#DDEBE3', // the cards' border
          grey: '#5B6E66',
          mist: '#93A49D',
          track: '#E3E9E6', // the slider's empty track
          violet: '#5A5EDC',
        },
      },
      // The same mockup's stadium: the stands' light over mown stripes, the match ticket, the
      // gradient tiles. Page-scoped like the palette above.
      backgroundImage: {
        'stadium-hero':
          'linear-gradient(180deg,rgba(6,36,22,.55),rgba(6,36,22,0) 70px),radial-gradient(700px 260px at 18% -60px,rgba(255,255,255,.4),transparent 70%),radial-gradient(700px 260px at 82% -60px,rgba(255,255,255,.4),transparent 70%),repeating-linear-gradient(90deg,#1F8A53 0 80px,#1B7C4A 80px 160px)',
        'stadium-stage':
          'radial-gradient(600px 300px at 10% 380px,rgba(118,230,171,.22),transparent 70%),radial-gradient(600px 300px at 95% 700px,rgba(90,94,220,.1),transparent 70%),repeating-linear-gradient(90deg,#EDF7F1 0 80px,#E6F3EB 80px 160px)',
        'stadium-crowd':
          'radial-gradient(circle,rgba(255,255,255,.55) 1.2px,transparent 1.8px),radial-gradient(circle,rgba(118,230,171,.7) 1.2px,transparent 1.8px),radial-gradient(circle,rgba(243,198,75,.6) 1.1px,transparent 1.7px)',
        'stadium-flood': 'radial-gradient(rgba(255,255,255,.45),transparent 70%)',
        'stadium-ticket': 'linear-gradient(110deg,#0D2B1F 0%,#14523A 55%,#1C7A4A 100%)',
        'stadium-stub': 'linear-gradient(180deg,#76E6AB,#4FD596)',
        'stadium-stripe': 'repeating-linear-gradient(180deg,#76E6AB 0 10px,#F3C64B 10px 20px)',
        'stadium-card-head': 'linear-gradient(90deg,#F2FBF6,#FFFFFF 60%)',
        'stadium-tile': 'linear-gradient(135deg,#76E6AB,#1D9E75)',
        'stadium-cta': 'linear-gradient(135deg,#76E6AB,#3FCB86)',
        'stadium-violet': 'linear-gradient(135deg,#8F93FF,#5A5EDC)',
        'stadium-wash': 'linear-gradient(90deg,#E9F8F0,#FFFFFF)',
        'stadium-spec': 'linear-gradient(135deg,#F3F4FF,#F2FBF6)',
        'stadium-tv': 'linear-gradient(135deg,#14523A,#0D2B1F)',
        'stadium-drop':
          'repeating-linear-gradient(45deg,rgba(29,158,117,.05) 0 1px,transparent 1px 14px),repeating-linear-gradient(-45deg,rgba(29,158,117,.05) 0 1px,transparent 1px 14px),linear-gradient(180deg,#F4FCF8,#FFFFFF)',
        // The minutes slider's thumb: the mockup's ball.
        'stadium-ball':
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='11' fill='%23fff' stroke='%230D2B1F' stroke-width='1.2'/%3E%3Cpath d='M12 6.5l3.6 2.6-1.4 4.2H9.8L8.4 9.1z' fill='%230D2B1F'/%3E%3Cpath d='M12 1v5.5M2.3 9l6.1.1M21.7 9l-6.1.1M6 20l3.8-6.7M18 20l-3.8-6.7' stroke='%230D2B1F' stroke-width='1.1' fill='none'/%3E%3C/svg%3E\")",
      },
      backgroundSize: {
        crowd: '9px 7px, 13px 9px, 17px 11px',
      },
      backgroundPosition: {
        'crowd-offset': '0 0, 4px 3px, 7px 2px',
      },
      keyframes: {
        flood: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'pin-pulse': {
          '0%': { transform: 'scale(0.6)', opacity: '0.9' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        flood: 'flood 5s ease-in-out infinite',
        'pin-pulse': 'pin-pulse 2.4s ease-out infinite',
        'spin-slow': 'spin 5s linear infinite',
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        leviosaYellow: '#FFE259',
        leviosaBlue: '#2E3192',
        leviosaPurple: '#662D8C',
        leviosaPink: '#FF4E7B',
        leviosaCyan: '#00B6C9',
      },
      backgroundImage: {
        'leviosa-gradient': 'linear-gradient(135deg, #FFE259 0%, #2E3192 50%, #662D8C 100%)',
      },
    },
  },
  plugins: [],
};

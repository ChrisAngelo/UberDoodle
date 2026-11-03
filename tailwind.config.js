/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.{ts,tsx}', './services/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        highlight: '#D66A3A', // Golpo orange
        secondary: '#0D9488',
        paper: '#FEFEFD', // Golpo paper
        ink: '#1B1009',
        tan: '#CFAF8A',
        accent: '#D66A3A',
        umber: '#7A5A3F',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        doodle: ['Comic Sans MS', 'Chalkboard SE', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

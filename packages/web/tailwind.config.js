/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        lula: '#CC0000',
        flavio: '#003580',
        zema: '#F4801A',
        caiado: '#5B7B9A',
      },
    },
  },
  plugins: [],
};

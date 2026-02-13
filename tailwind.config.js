/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          light: '#E8F5F0',
          DEFAULT: '#0F4D3A',
          dark: '#0A3528',
        },
        gold: {
          light: '#F5ECD7',
          DEFAULT: '#CBA135',
          dark: '#A67F2A',
        },
        charcoal: {
          DEFAULT: '#2B2B2B',
          light: '#4A4A4A',
        },
        neutral: {
          50: '#F8F8F8',
          100: '#F0F0F0',
          200: '#E0E0E0',
          300: '#C8C8C8',
          400: '#A0A0A0',
          500: '#787878',
          600: '#5F5F5F',
          700: '#474747',
          800: '#2F2F2F',
          900: '#1A1A1A',
        },
      },
    },
  },
  plugins: [],
};

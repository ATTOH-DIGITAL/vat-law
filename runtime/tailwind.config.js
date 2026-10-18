/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4338ca',
          dark: '#312e81',
          mid: '#6366f1',
          light: '#eef2ff',
          border: '#a5b4fc',
        },
      },
    },
  },
  plugins: [],
}

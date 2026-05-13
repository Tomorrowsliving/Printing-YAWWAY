/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          750: '#1e293b', // Custom color for better contrast in dark mode
        }
      }
    },
  },
  plugins: [],
}

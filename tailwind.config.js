/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
  ],
  theme: {
    extend: {
      container: { center: true, padding: { DEFAULT: '1rem', lg: '2rem' } },
      colors: {
        brand: {
          50: '#f5f7ff', 100: '#e8edff', 200: '#d2dbff', 300: '#aebeff', 400: '#7f95ff',
          500: '#5b73ff', 600: '#3a52ff', 700: '#2d40d6', 800: '#2636ad', 900: '#202e8c'
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Ubuntu", "Cantarell", "Noto Sans", "Helvetica Neue", "Arial", "sans-serif"],
        heading: ["Inter", "ui-sans-serif", "system-ui"]
      },
      boxShadow: {
        soft: '0 10px 30px rgba(0,0,0,0.08)'
      }
    }
  }
};


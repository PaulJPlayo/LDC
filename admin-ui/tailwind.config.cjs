/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ldc: {
          plum: "#5b2d6f",
          mauve: "#d8b4fe",
          pink: "#f6a7d8",
          peach: "#ffd3c4",
          cream: "#fff7ef",
          ink: "#1f1028",
          midnight: "#120816"
        }
      },
      fontFamily: {
        heading: ["Cormorant Garamond", "Georgia", "Times New Roman", "serif"],
        body: ["Montserrat", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"]
      },
      boxShadow: {
        soft: "0 20px 45px rgba(24, 8, 33, 0.22)",
        glow: "0 0 0 1px rgba(255, 255, 255, 0.45), 0 12px 28px rgba(91, 45, 111, 0.25)"
      }
    }
  },
  plugins: []
};

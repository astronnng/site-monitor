/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./templates/**/*.html", "./static/js/**/*.js"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        shell: {
          50: "#f7f8fc",
          100: "#eef1f8",
          200: "#dbe1ef",
          500: "#64748b",
          700: "#334155",
          900: "#0f172a",
        },
        brand: {
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
        },
      },
      boxShadow: {
        shell: "0 20px 50px rgba(15, 23, 42, 0.12)",
        card: "0 10px 28px rgba(15, 23, 42, 0.08)",
      },
    },
  },
};

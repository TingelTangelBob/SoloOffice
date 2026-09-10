/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        tablet: '768px',
      },
      fontFamily: {
        // Inter liegt selbst gehostet unter `public/fonts`. Bewusst kein
        // Google-Fonts-CDN: Das wäre eine externe Laufzeitabhängigkeit im
        // Self-Hosting und datenschutzrechtlich heikel.
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

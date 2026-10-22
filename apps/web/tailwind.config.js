/** @type {import('tailwindcss').Config} */
const ink = {
  50: 'rgb(var(--ink-50) / <alpha-value>)',
  100: 'rgb(var(--ink-100) / <alpha-value>)',
  200: 'rgb(var(--ink-200) / <alpha-value>)',
  300: 'rgb(var(--ink-300) / <alpha-value>)',
  400: 'rgb(var(--ink-400) / <alpha-value>)',
  500: 'rgb(var(--ink-500) / <alpha-value>)',
  600: 'rgb(var(--ink-600) / <alpha-value>)',
  700: 'rgb(var(--ink-700) / <alpha-value>)',
  800: 'rgb(var(--ink-800) / <alpha-value>)',
  900: 'rgb(var(--ink-900) / <alpha-value>)',
  950: 'rgb(var(--ink-950) / <alpha-value>)',
};

const signal = {
  50: 'rgb(var(--signal-50) / <alpha-value>)',
  100: 'rgb(var(--signal-100) / <alpha-value>)',
  200: 'rgb(var(--signal-200) / <alpha-value>)',
  300: 'rgb(var(--signal-300) / <alpha-value>)',
  400: 'rgb(var(--signal-400) / <alpha-value>)',
  500: 'rgb(var(--signal-500) / <alpha-value>)',
  600: 'rgb(var(--signal-600) / <alpha-value>)',
  700: 'rgb(var(--signal-700) / <alpha-value>)',
  800: 'rgb(var(--signal-800) / <alpha-value>)',
  900: 'rgb(var(--signal-900) / <alpha-value>)',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink,
        signal,
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.05), 0 12px 32px -18px rgb(var(--shadow) / 0.35)',
        lift: '0 2px 6px rgb(var(--shadow) / 0.08), 0 24px 48px -24px rgb(var(--shadow) / 0.45)',
      },
      borderRadius: {
        xl: '0.85rem',
        '2xl': '1.15rem',
        '3xl': '1.6rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.2s ease-out both',
        'slide-up': 'slide-up 0.24s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

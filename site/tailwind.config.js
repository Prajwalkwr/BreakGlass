/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0a0a',
          900: '#121212',
          800: '#1c1c1c',
          700: '#2b2b2b',
          600: '#3d3d3d',
          500: '#5c5c5c',
          400: '#7a7a7a',
          300: '#a3a3a3',
          200: '#c9c9c9',
          100: '#e6e6e4',
        },
        paper: {
          DEFAULT: '#fbfbf9',
          50: '#ffffff',
          100: '#f5f5f2',
          200: '#eeede8',
          300: '#e2e1da',
          400: '#d3d2c9',
        },
        clay: '#8a7f72',
      },
      fontFamily: {
        display: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"SFMono-Regular"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter2: '-0.02em',
        wide2: '0.18em',
        wide3: '0.32em',
      },
      fontSize: {
        'display-xl': ['clamp(3.2rem, 8.4vw, 8.5rem)', { lineHeight: '0.88', letterSpacing: '-0.04em' }],
        'display-lg': ['clamp(2.5rem, 5.2vw, 5rem)', { lineHeight: '0.94', letterSpacing: '-0.035em' }],
        'display-md': ['clamp(1.9rem, 3.4vw, 3.1rem)', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
        'display-sm': ['clamp(1.4rem, 2.1vw, 1.9rem)', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.22em' }],
      },
      maxWidth: { page: '1440px' },
      transitionTimingFunction: { smooth: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(18px)' }, '100%': { opacity: '1', transform: 'none' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        'line-in': { '0%': { transform: 'scaleX(0)' }, '100%': { transform: 'scaleX(1)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 1.1s ease both',
        marquee: 'marquee 38s linear infinite',
        'line-in': 'line-in 1.1s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};

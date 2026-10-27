/** Brand tokens shared with the website (`apps/web/src/index.css`). */
export const colors = {
  ink900: '#151c28',
  ink700: '#2c3444',
  ink500: '#5a6478',
  line: '#e3e7ee',
  canvas: '#f6f7fa',
  surface: '#ffffff',
  brand: '#0a57ff',
  brandDark: '#0039b8',
  navy: '#0a1730',
  accent: '#e8b33c',
  success: '#1b7a4b',
  successBg: '#e7f4ec',
  danger: '#b3261e',
  dangerBg: '#fdecea',
  warn: '#8a5a00',
  warnBg: '#fdf3dc',
  white: '#ffffff',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, huge: 36 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const font = {
  regular: 'TitilliumWeb_400Regular',
  semibold: 'TitilliumWeb_600SemiBold',
  bold: 'TitilliumWeb_700Bold',
} as const;

export const type = {
  display: { fontFamily: font.bold, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  subheading: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.8 },
  button: { fontFamily: font.semibold, fontSize: 16, lineHeight: 20 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0a1730',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;

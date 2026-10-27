/** Brand tokens shared with the website (`apps/web/src/index.css`). */
export const colors = {
  ink900: '#101828',
  ink800: '#1d2939',
  ink700: '#344054',
  ink500: '#667085',
  ink300: '#98a2b3',
  ink100: '#eaecf0',
  line: '#e4e7ec',
  canvas: '#f5f7fb',
  canvasAlt: '#eef2f8',
  surface: '#ffffff',
  brand: '#0a57ff',
  brandDark: '#0039b8',
  brandSoft: '#eaf1ff',
  brandTint: '#f4f8ff',
  navy: '#0a1730',
  navySoft: '#16294a',
  accent: '#e8b33c',
  accentSoft: '#fdf4dd',
  success: '#1b7a4b',
  successBg: '#e7f4ec',
  danger: '#b3261e',
  dangerBg: '#fdecea',
  warn: '#8a5a00',
  warnBg: '#fdf3dc',
  white: '#ffffff',
  // Map illustration palette — deliberately muted so the route line is the loudest thing.
  mapBg: '#eef3ec',
  mapBlock: '#e2ebdf',
  mapBlockAlt: '#e7edf6',
  mapRoad: '#ffffff',
  mapRoadEdge: '#dfe6dc',
  mapWater: '#d9e9f4',
  mapPark: '#dcebd7',
  // Partner (traveller) accent — a warm counterpoint to the sender blue.
  partner: '#0f7a5c',
  partnerSoft: '#e6f4ef',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, huge: 36 } as const;

export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, xxl: 28, pill: 999 } as const;

export const font = {
  regular: 'TitilliumWeb_400Regular',
  semibold: 'TitilliumWeb_600SemiBold',
  bold: 'TitilliumWeb_700Bold',
} as const;

export const type = {
  hero: { fontFamily: font.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.4 },
  display: { fontFamily: font.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.3 },
  title: { fontFamily: font.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  heading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  subheading: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.regular, fontSize: 13, lineHeight: 19 },
  micro: { fontFamily: font.semibold, fontSize: 11, lineHeight: 15 },
  label: { fontFamily: font.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.8 },
  button: { fontFamily: font.semibold, fontSize: 16, lineHeight: 20 },
  price: { fontFamily: font.bold, fontSize: 22, lineHeight: 26, letterSpacing: -0.3 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0a1730',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  soft: {
    shadowColor: '#0a1730',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  floating: {
    shadowColor: '#0a1730',
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheet: {
    shadowColor: '#0a1730',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -6 },
    elevation: 14,
  },
} as const;

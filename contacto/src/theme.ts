export const theme = {
  colors: {
    background: "#0D0F14",
    surface: "#171A22",
    surfaceRaised: "#20242E",
    border: "#2D323D",
    text: "#F4F6FA",
    muted: "#9AA3B2",
    red: "#FF4458",
    redDark: "#B92438",
    green: "#48D597",
    amber: "#F2B84B",
    white: "#FFFFFF",
  },
  typography: {
    title: 25,
    heading: 18,
    body: 14,
    caption: 12,
    micro: 10,
  },
  radii: { card: 20, control: 14, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 16, lg: 22, xl: 30 },
  shadows: {
    card: {
      shadowColor: "#000000",
      shadowOpacity: 0.24,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 5,
    },
  },
} as const;

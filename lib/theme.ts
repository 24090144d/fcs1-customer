export type AppThemeName = 'vintage' | 'modern' | 'executive';

export type AppThemeTokens = {
  name: AppThemeName;
  label: string;
  appBg: string;
  pageBg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderSoft: string;
  text: string;
  textMuted: string;
  textSoft: string;
  accent: string;
  accentAlt: string;
  accentTertiary: string;
  accentTint: string;
  accentAltTint: string;
  sidebar: {
    bg: string;
    band: string;
    border: string;
    rule: string;
    hoverBg: string;
    text: string;
    nav: string;
    dim: string;
    chrome: string;
    menuBg: string;
    menuBorder: string;
    menuHover: string;
    menuSelectedBg: string;
  };
  header: {
    bg: string;
    border: string;
    crumb: string;
    crumbActive: string;
    icon: string;
  };
  dashboard: {
    bg: string;
    toolbarBg: string;
    toolbarBorder: string;
    metaTitle: string;
    metaSub: string;
    inputBg: string;
    inputBorder: string;
    inputText: string;
    footerText: string;
    footerBorder: string;
    naText: string;
    sectionLabel: string;
    sectionRule: string;
    tableHeadBg: string;
    tableHeadText: string;
    tableCellBorder: string;
    tableMuted: string;
  };
  card: {
    bg: string;
    border: string;
    label: string;
    value: string;
    naValue: string;
    sub: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipText: string;
  };
  chart: {
    palette: string[];
    text: string;
    muted: string;
    grid: string;
    tooltipBg: string;
    tooltipBorder: string;
    menuHoverBg: string;
    cardBg: string;
    cardBorder: string;
    cardAccent: string;
    titleText: string;
    footerMuted: string;
    footerBorder: string;
    codeBg: string;
    alertBg: string;
    alertText: string;
    alertBorder: string;
    noteLabel: string;
  };
};

const VINTAGE_LIGHT: AppThemeTokens = {
  name: 'vintage',
  label: 'Vintage',
  appBg: '#F5F0E8',
  pageBg: '#FAF7F2',
  surface: '#FAF7F2',
  surfaceAlt: '#F5F0E8',
  border: '#D9C8A8',
  borderSoft: '#EFE3CF',
  text: '#1A1714',
  textMuted: '#6B6560',
  textSoft: '#8A857E',
  accent: '#0E7470',
  accentAlt: '#C55A10',
  accentTertiary: '#C4922A',
  accentTint: 'rgba(14,116,112,0.07)',
  accentAltTint: 'rgba(197,90,16,0.08)',
  sidebar: {
    bg: '#2F2924',
    band: '#29231F',
    border: '#1F1A16',
    rule: '#4A4238',
    hoverBg: '#332D28',
    text: '#F3EBDF',
    nav: '#E0D6C2',
    dim: '#9A9083',
    chrome: '#B9AE9F',
    menuBg: '#302923',
    menuBorder: '#5B5147',
    menuHover: '#3A332D',
    menuSelectedBg: 'rgba(14,116,112,0.16)',
  },
  header: {
    bg: '#FAF7F2',
    border: '#D9C8A8',
    crumb: '#8A857E',
    crumbActive: '#1A1714',
    icon: '#6B6560',
  },
  dashboard: {
    bg: '#F5F0E8',
    toolbarBg: '#FAF7F2',
    toolbarBorder: '#D9C8A8',
    metaTitle: '#1A1714',
    metaSub: '#8A857E',
    inputBg: '#FAF7F2',
    inputBorder: '#C4B090',
    inputText: '#1A1714',
    footerText: '#A89070',
    footerBorder: '#D9C8A8',
    naText: '#A89070',
    sectionLabel: '#8A857E',
    sectionRule: '#D9C8A8',
    tableHeadBg: '#F5F0E8',
    tableHeadText: '#4A4540',
    tableCellBorder: '#EFE3CF',
    tableMuted: '#6B6560',
  },
  card: {
    bg: '#FAF7F2',
    border: '#B9A88A',
    label: '#6B6560',
    value: '#1A1714',
    naValue: '#C4B090',
    sub: '#8A857E',
    tooltipBg: '#FAF7F2',
    tooltipBorder: '#D9C8A8',
    tooltipText: '#4A4540',
  },
  chart: {
    palette: ['#C55A10', '#0E7470', '#7B3F28', '#1A6E6A', '#D4774A', '#3A9E9A', '#9B6A3A', '#5A8A6A'],
    text: '#1A1714',
    muted: '#6B6560',
    grid: '#D9C8A8',
    tooltipBg: '#FAF7F2',
    tooltipBorder: '#C4B090',
    menuHoverBg: '#EDE8E0',
    cardBg: '#FAF7F2',
    cardBorder: '#B9A88A',
    cardAccent: '#0E7470',
    titleText: '#1A1714',
    footerMuted: '#8A857E',
    footerBorder: '#D9C8A8',
    codeBg: 'rgba(14,116,112,0.07)',
    alertBg: 'rgba(197,90,16,0.08)',
    alertText: '#C55A10',
    alertBorder: 'rgba(197,90,16,0.2)',
    noteLabel: '#4A4540',
  },
};

const VINTAGE_DARK: AppThemeTokens = {
  name: 'vintage',
  label: 'Vintage',
  appBg: '#1A1916',
  pageBg: '#1F1D1A',
  surface: '#252220',
  surfaceAlt: '#1F1D1A',
  border: '#302D2A',
  borderSoft: '#3A3530',
  text: '#EDE8E0',
  textMuted: '#8A857E',
  textSoft: '#6B6560',
  accent: '#14A89E',
  accentAlt: '#E87030',
  accentTertiary: '#E8C078',
  accentTint: 'rgba(20,168,158,0.10)',
  accentAltTint: 'rgba(232,112,48,0.12)',
  sidebar: {
    bg: '#252220',
    band: '#1F1D1A',
    border: '#141210',
    rule: '#302D2A',
    hoverBg: '#332D28',
    text: '#F3EBDF',
    nav: '#E0D6C2',
    dim: '#9A9083',
    chrome: '#B9AE9F',
    menuBg: '#211E1B',
    menuBorder: '#3D3A36',
    menuHover: '#302D2A',
    menuSelectedBg: 'rgba(20,168,158,0.16)',
  },
  header: {
    bg: '#1F1D1A',
    border: '#302D2A',
    crumb: '#8A857E',
    crumbActive: '#EDE8E0',
    icon: '#C4B8A8',
  },
  dashboard: {
    bg: '#1A1916',
    toolbarBg: '#1F1D1A',
    toolbarBorder: '#302D2A',
    metaTitle: '#C4B8A8',
    metaSub: '#6B6560',
    inputBg: '#252220',
    inputBorder: '#3D3A36',
    inputText: '#EDE8E0',
    footerText: '#4E4A46',
    footerBorder: '#252220',
    naText: '#4E4A46',
    sectionLabel: '#6B6560',
    sectionRule: '#302D2A',
    tableHeadBg: '#1F1D1A',
    tableHeadText: '#C4B8A8',
    tableCellBorder: '#302D2A',
    tableMuted: '#8A857E',
  },
  card: {
    bg: '#252220',
    border: '#3A3530',
    label: '#8A857E',
    value: '#EDE8E0',
    naValue: '#4E4A46',
    sub: '#6B6560',
    tooltipBg: '#1F1D1A',
    tooltipBorder: '#302D2A',
    tooltipText: '#C4B8A8',
  },
  chart: {
    palette: ['#E87030', '#14A89E', '#C07050', '#20C4B8', '#F5A060', '#45D8CC', '#E8C078', '#88C098'],
    text: '#EDE8E0',
    muted: '#8A857E',
    grid: '#302D2A',
    tooltipBg: '#1F1D1A',
    tooltipBorder: '#302D2A',
    menuHoverBg: '#302D2A',
    cardBg: '#252220',
    cardBorder: '#3A3530',
    cardAccent: '#14A89E',
    titleText: '#EDE8E0',
    footerMuted: '#6B6560',
    footerBorder: '#302D2A',
    codeBg: 'rgba(20,168,158,0.10)',
    alertBg: 'rgba(232,112,48,0.12)',
    alertText: '#E87030',
    alertBorder: 'rgba(232,112,48,0.25)',
    noteLabel: '#C4B8A8',
  },
};

const MODERN_LIGHT: AppThemeTokens = {
  name: 'modern',
  label: 'Modern',
  appBg: '#F7F9FB',
  pageBg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2F7',
  border: '#DBE1E8',
  borderSoft: '#E8EDF3',
  text: '#1B1F23',
  textMuted: '#64748B',
  textSoft: '#94A3B8',
  accent: '#2563EB',
  accentAlt: '#EF4444',
  accentTertiary: '#7C3AED',
  accentTint: 'rgba(37,99,235,0.08)',
  accentAltTint: 'rgba(239,68,68,0.08)',
  sidebar: {
    bg: '#E6ECF2',
    band: '#DDE5EE',
    border: '#C8D2DC',
    rule: '#C3CFDA',
    hoverBg: '#D9E2EC',
    text: '#15202B',
    nav: '#334155',
    dim: '#64748B',
    chrome: '#475569',
    menuBg: '#FFFFFF',
    menuBorder: '#DBE1E8',
    menuHover: '#EEF2F7',
    menuSelectedBg: 'rgba(37,99,235,0.12)',
  },
  header: {
    bg: '#FFFFFF',
    border: '#DBE1E8',
    crumb: '#64748B',
    crumbActive: '#1B1F23',
    icon: '#475569',
  },
  dashboard: {
    bg: '#F7F9FB',
    toolbarBg: '#FFFFFF',
    toolbarBorder: '#DBE1E8',
    metaTitle: '#1B1F23',
    metaSub: '#64748B',
    inputBg: '#FFFFFF',
    inputBorder: '#CBD5E1',
    inputText: '#1B1F23',
    footerText: '#94A3B8',
    footerBorder: '#DBE1E8',
    naText: '#94A3B8',
    sectionLabel: '#64748B',
    sectionRule: '#DBE1E8',
    tableHeadBg: '#F8FAFC',
    tableHeadText: '#334155',
    tableCellBorder: '#E8EDF3',
    tableMuted: '#64748B',
  },
  card: {
    bg: '#FFFFFF',
    border: '#DBE1E8',
    label: '#64748B',
    value: '#111827',
    naValue: '#CBD5E1',
    sub: '#94A3B8',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#DBE1E8',
    tooltipText: '#334155',
  },
  chart: {
    palette: ['#2563EB', '#0891B2', '#7C3AED', '#16A34A', '#F97316', '#DC2626', '#0F766E', '#64748B'],
    text: '#111827',
    muted: '#64748B',
    grid: '#DBE1E8',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#CBD5E1',
    menuHoverBg: '#EEF2F7',
    cardBg: '#FFFFFF',
    cardBorder: '#DBE1E8',
    cardAccent: '#2563EB',
    titleText: '#111827',
    footerMuted: '#64748B',
    footerBorder: '#DBE1E8',
    codeBg: 'rgba(37,99,235,0.08)',
    alertBg: 'rgba(239,68,68,0.08)',
    alertText: '#EF4444',
    alertBorder: 'rgba(239,68,68,0.2)',
    noteLabel: '#334155',
  },
};

const MODERN_DARK: AppThemeTokens = {
  name: 'modern',
  label: 'Modern',
  appBg: '#10161F',
  pageBg: '#111B27',
  surface: '#16202D',
  surfaceAlt: '#101A26',
  border: '#233143',
  borderSoft: '#2D3E52',
  text: '#E6EDF5',
  textMuted: '#A4B3C2',
  textSoft: '#6F8297',
  accent: '#4F8CFF',
  accentAlt: '#FF5B5B',
  accentTertiary: '#9B7BFF',
  accentTint: 'rgba(79,140,255,0.14)',
  accentAltTint: 'rgba(255,91,91,0.12)',
  sidebar: {
    bg: '#0F1724',
    band: '#131D2B',
    border: '#1D2A3A',
    rule: '#243447',
    hoverBg: '#182538',
    text: '#E6EDF5',
    nav: '#C3D0DD',
    dim: '#7D91A7',
    chrome: '#A4B3C2',
    menuBg: '#16202D',
    menuBorder: '#233143',
    menuHover: '#1C2A3B',
    menuSelectedBg: 'rgba(79,140,255,0.18)',
  },
  header: {
    bg: '#111B27',
    border: '#233143',
    crumb: '#7D91A7',
    crumbActive: '#E6EDF5',
    icon: '#C3D0DD',
  },
  dashboard: {
    bg: '#10161F',
    toolbarBg: '#111B27',
    toolbarBorder: '#233143',
    metaTitle: '#E6EDF5',
    metaSub: '#7D91A7',
    inputBg: '#16202D',
    inputBorder: '#2D3E52',
    inputText: '#E6EDF5',
    footerText: '#6F8297',
    footerBorder: '#233143',
    naText: '#6F8297',
    sectionLabel: '#A4B3C2',
    sectionRule: '#233143',
    tableHeadBg: '#131D2B',
    tableHeadText: '#D7E1EB',
    tableCellBorder: '#233143',
    tableMuted: '#A4B3C2',
  },
  card: {
    bg: '#16202D',
    border: '#2D3E52',
    label: '#A4B3C2',
    value: '#E6EDF5',
    naValue: '#6F8297',
    sub: '#7D91A7',
    tooltipBg: '#111B27',
    tooltipBorder: '#233143',
    tooltipText: '#D7E1EB',
  },
  chart: {
    palette: ['#4F8CFF', '#22C5E5', '#9B7BFF', '#22C55E', '#FB923C', '#F87171', '#14B8A6', '#94A3B8'],
    text: '#E6EDF5',
    muted: '#A4B3C2',
    grid: '#233143',
    tooltipBg: '#111B27',
    tooltipBorder: '#233143',
    menuHoverBg: '#1C2A3B',
    cardBg: '#16202D',
    cardBorder: '#2D3E52',
    cardAccent: '#4F8CFF',
    titleText: '#E6EDF5',
    footerMuted: '#7D91A7',
    footerBorder: '#233143',
    codeBg: 'rgba(79,140,255,0.14)',
    alertBg: 'rgba(255,91,91,0.12)',
    alertText: '#FF7A7A',
    alertBorder: 'rgba(255,91,91,0.22)',
    noteLabel: '#D7E1EB',
  },
};

const EXECUTIVE_LIGHT: AppThemeTokens = {
  name: 'executive',
  label: 'Executive',
  appBg: '#0F172A',
  pageBg: '#111827',
  surface: '#172033',
  surfaceAlt: '#0F172A',
  border: '#334155',
  borderSoft: '#263041',
  text: '#F8FAFC',
  textMuted: '#CBD5E1',
  textSoft: '#94A3B8',
  accent: '#22D3C5',
  accentAlt: '#F59E0B',
  accentTertiary: '#A78BFA',
  accentTint: 'rgba(34,211,197,0.14)',
  accentAltTint: 'rgba(245,158,11,0.14)',
  sidebar: {
    bg: '#0B1220',
    band: '#101827',
    border: '#1F2A3B',
    rule: '#243041',
    hoverBg: '#162235',
    text: '#F8FAFC',
    nav: '#D5DEE8',
    dim: '#94A3B8',
    chrome: '#CBD5E1',
    menuBg: '#172033',
    menuBorder: '#334155',
    menuHover: '#1C2940',
    menuSelectedBg: 'rgba(34,211,197,0.18)',
  },
  header: {
    bg: '#111827',
    border: '#334155',
    crumb: '#94A3B8',
    crumbActive: '#F8FAFC',
    icon: '#CBD5E1',
  },
  dashboard: {
    bg: '#0F172A',
    toolbarBg: '#111827',
    toolbarBorder: '#334155',
    metaTitle: '#F8FAFC',
    metaSub: '#94A3B8',
    inputBg: '#172033',
    inputBorder: '#334155',
    inputText: '#F8FAFC',
    footerText: '#64748B',
    footerBorder: '#1E293B',
    naText: '#64748B',
    sectionLabel: '#CBD5E1',
    sectionRule: '#334155',
    tableHeadBg: '#101827',
    tableHeadText: '#E2E8F0',
    tableCellBorder: '#263041',
    tableMuted: '#A7B4C3',
  },
  card: {
    bg: '#172033',
    border: '#334155',
    label: '#CBD5E1',
    value: '#F8FAFC',
    naValue: '#64748B',
    sub: '#94A3B8',
    tooltipBg: '#101827',
    tooltipBorder: '#334155',
    tooltipText: '#E2E8F0',
  },
  chart: {
    palette: ['#22D3C5', '#F59E0B', '#A78BFA', '#22C55E', '#38BDF8', '#F97316', '#F472B6', '#94A3B8'],
    text: '#F8FAFC',
    muted: '#CBD5E1',
    grid: '#334155',
    tooltipBg: '#101827',
    tooltipBorder: '#334155',
    menuHoverBg: '#1C2940',
    cardBg: '#172033',
    cardBorder: '#334155',
    cardAccent: '#22D3C5',
    titleText: '#F8FAFC',
    footerMuted: '#94A3B8',
    footerBorder: '#334155',
    codeBg: 'rgba(34,211,197,0.14)',
    alertBg: 'rgba(245,158,11,0.14)',
    alertText: '#FBBF24',
    alertBorder: 'rgba(245,158,11,0.26)',
    noteLabel: '#E2E8F0',
  },
};

const EXECUTIVE_DARK: AppThemeTokens = {
  ...EXECUTIVE_LIGHT,
  appBg: '#09111E',
  pageBg: '#0B1220',
  surface: '#121B2B',
  surfaceAlt: '#09111E',
  border: '#2A3A52',
  borderSoft: '#223047',
  text: '#F8FAFC',
  textMuted: '#D8E1EA',
  textSoft: '#8394A8',
  accent: '#2CE4D5',
  accentAlt: '#FFB020',
  accentTertiary: '#B69CFF',
  accentTint: 'rgba(44,228,213,0.15)',
  accentAltTint: 'rgba(255,176,32,0.15)',
  sidebar: {
    bg: '#08101C',
    band: '#0C1422',
    border: '#172233',
    rule: '#223047',
    hoverBg: '#132033',
    text: '#F8FAFC',
    nav: '#DCE5EF',
    dim: '#8394A8',
    chrome: '#D8E1EA',
    menuBg: '#121B2B',
    menuBorder: '#2A3A52',
    menuHover: '#18253A',
    menuSelectedBg: 'rgba(44,228,213,0.18)',
  },
  header: {
    bg: '#0B1220',
    border: '#223047',
    crumb: '#8394A8',
    crumbActive: '#F8FAFC',
    icon: '#D8E1EA',
  },
  dashboard: {
    bg: '#09111E',
    toolbarBg: '#0B1220',
    toolbarBorder: '#223047',
    metaTitle: '#F8FAFC',
    metaSub: '#8394A8',
    inputBg: '#121B2B',
    inputBorder: '#2A3A52',
    inputText: '#F8FAFC',
    footerText: '#5F738A',
    footerBorder: '#172233',
    naText: '#5F738A',
    sectionLabel: '#D8E1EA',
    sectionRule: '#223047',
    tableHeadBg: '#0C1422',
    tableHeadText: '#EAF0F6',
    tableCellBorder: '#223047',
    tableMuted: '#B5C2D0',
  },
  card: {
    bg: '#121B2B',
    border: '#2A3A52',
    label: '#D8E1EA',
    value: '#F8FAFC',
    naValue: '#5F738A',
    sub: '#8394A8',
    tooltipBg: '#0C1422',
    tooltipBorder: '#223047',
    tooltipText: '#EAF0F6',
  },
  chart: {
    palette: ['#2CE4D5', '#FFB020', '#B69CFF', '#38D874', '#53C8FF', '#FF8A3D', '#FF84C1', '#A8B4C2'],
    text: '#F8FAFC',
    muted: '#D8E1EA',
    grid: '#223047',
    tooltipBg: '#0C1422',
    tooltipBorder: '#223047',
    menuHoverBg: '#18253A',
    cardBg: '#121B2B',
    cardBorder: '#2A3A52',
    cardAccent: '#2CE4D5',
    titleText: '#F8FAFC',
    footerMuted: '#8394A8',
    footerBorder: '#223047',
    codeBg: 'rgba(44,228,213,0.15)',
    alertBg: 'rgba(255,176,32,0.15)',
    alertText: '#FFB020',
    alertBorder: 'rgba(255,176,32,0.28)',
    noteLabel: '#EAF0F6',
  },
};

export const APP_THEME_OPTIONS: Array<{ value: AppThemeName; label: string }> = [
  { value: 'vintage', label: 'Vintage' },
  { value: 'modern', label: 'Modern' },
  { value: 'executive', label: 'Executive' },
];

export function getAppThemeTokens(theme: AppThemeName, dark: boolean): AppThemeTokens {
  if (theme === 'modern') return dark ? MODERN_DARK : MODERN_LIGHT;
  if (theme === 'executive') return dark ? EXECUTIVE_DARK : EXECUTIVE_LIGHT;
  return dark ? VINTAGE_DARK : VINTAGE_LIGHT;
}

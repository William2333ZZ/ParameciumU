/**
 * TUI 主题：深色暖色，与 OpenClaw 风格一致
 */
import chalk from "chalk";

const palette = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#F6C453",
  accentSoft: "#F2A65A",
  border: "#3C414B",
  userBg: "#2B2F36",
  userText: "#F3EEE0",
  systemText: "#9BA3B2",
  toolTitle: "#F6C453",
  error: "#F97066",
  success: "#7DD3A5",
};

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);
const dimFg = fg(palette.dim);
const accentFg = fg(palette.accent);
const accentSoftFg = fg(palette.accentSoft);

export const theme = {
  fg: fg(palette.text),
  dim: dimFg,
  accent: accentFg,
  accentSoft: accentSoftFg,
  border: fg(palette.border),
  userBg: bg(palette.userBg),
  userText: fg(palette.userText),
  system: fg(palette.systemText),
  toolTitle: fg(palette.toolTitle),
  error: fg(palette.error),
  success: fg(palette.success),
  bold: (text: string) => chalk.bold(text),
  header: (text: string) => chalk.bold(accentFg(text)),
  separatorLine: (width: number, char = "─") =>
    fg(palette.border)(char.repeat(Math.max(1, Math.min(width, 256)))),
  footerHint: (text: string) => dimFg(text),
  userLabel: () => dimFg("│ ") + accentSoftFg("我 "),
  assistantLabel: () => dimFg("│ ") + accentFg("助手 "),
  statusIdle: () => dimFg("● 就绪"),
  statusRunning: () => accentFg("◐ 思考中…"),
};

export const selectListTheme = {
  selectedPrefix: (t: string) => theme.accent(t),
  selectedText: (t: string) => theme.accent(t),
  description: (t: string) => theme.dim(t),
  scrollInfo: (t: string) => theme.dim(t),
  noMatch: (t: string) => theme.dim(t),
};

export const editorTheme = {
  borderColor: (str: string) => theme.border(str),
  selectList: selectListTheme,
};

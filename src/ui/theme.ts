export type FgRole =
  | "accent"
  | "borderAccent"
  | "borderMuted"
  | "muted"
  | "dim"
  | "text"
  | "warning"
  | "error"
  | "success"
  | "toolDiffAdded"
  | "toolDiffRemoved"
  | "toolDiffContext";

export type BgRole = "selectedBg";

export interface Styler {
  fg(role: FgRole, text: string): string;
  bg(role: BgRole, text: string): string;
  bold(text: string): string;
}

export const plainStyler: Styler = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
  bold: (text) => text,
};

export function stylerFromTheme(theme: {
  fg(c: any, t: string): string;
  bg(c: any, t: string): string;
  bold(t: string): string;
}): Styler {
  return {
    fg: (role, text) => theme.fg(role, text),
    bg: (role, text) => theme.bg(role, text),
    bold: (text) => theme.bold(text),
  };
}

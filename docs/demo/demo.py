#!/usr/bin/env python3
"""Fake-data terminal prototype for a VS Code-style Pi `/diff` command.

No Git commands are run and no files are modified.

Run:
    python3 pi_source_control_terminal_demo.py

Controls:
    Mouse            Click a source/commit or changed file; wheel scrolls diff
    Tab / Shift-Tab  Focus sources -> files -> diff
    Up / Down        Move in focused list or scroll focused diff
    Enter            Advance focus
    v                Side-by-side / unified
    n / p            Next / previous hunk
    Space            Mark selected file reviewed
    PageUp/PageDown  Scroll diff
    q                Quit
"""
from __future__ import annotations

import curses
import locale
from dataclasses import dataclass
from typing import Callable, Optional

locale.setlocale(locale.LC_ALL, "")


@dataclass(frozen=True)
class Row:
    old_no: Optional[int]
    old: str
    old_kind: str
    new_no: Optional[int]
    new: str
    new_kind: str
    hunk: int = 0


@dataclass
class File:
    path: str
    status: str
    plus: int
    minus: int
    rows: list[Row]
    reviewed: bool = False

    @property
    def name(self) -> str:
        return self.path.rsplit("/", 1)[-1]

    @property
    def directory(self) -> str:
        return self.path.rsplit("/", 1)[0] if "/" in self.path else ""


@dataclass
class Source:
    kind: str  # working | staged | commit
    icon: str
    label: str
    detail: str
    files: list[File]
    oid: str = ""


@dataclass
class Hit:
    y: int
    x1: int
    x2: int
    action: Callable[[], None]


def r(old_no, old, old_kind, new_no, new, new_kind, hunk=0) -> Row:
    return Row(old_no, old, old_kind, new_no, new, new_kind, hunk)


SESSION = [
    r(None, "@@ -24,8 +24,14 @@", "meta", None, "@@ -24,8 +24,14 @@", "meta", 0),
    r(24, "export async function createSession(userId: string) {", "context", 24, "export async function createSession(userId: string) {", "context", 0),
    r(25, "  const token = await issueToken(userId);", "context", 25, "  const token = await issueToken(userId);", "context", 0),
    r(26, "", "context", 26, "", "context", 0),
    r(27, "  return token;", "deletion", 27, "  if (!token) {", "addition", 0),
    r(None, "", "empty", 28, '    throw new SessionError("Token issuance failed");', "addition", 0),
    r(None, "", "empty", 29, "  }", "addition", 0),
    r(None, "", "empty", 30, "", "addition", 0),
    r(None, "", "empty", 31, '  audit.log({ userId, event: "session.created" });', "addition", 0),
    r(None, "", "empty", 32, "  return token;", "addition", 0),
    r(28, "}", "context", 33, "}", "context", 0),
    r(None, "@@ -52,5 +58,7 @@", "meta", None, "@@ -52,5 +58,7 @@", "meta", 1),
    r(52, "export function revokeSession(id: string) {", "context", 58, "export function revokeSession(id: string) {", "context", 1),
    r(53, "  sessionStore.delete(id);", "deletion", 59, "  const revoked = sessionStore.delete(id);", "addition", 1),
    r(None, "", "empty", 60, "  if (!revoked) return false;", "addition", 1),
    r(54, "  return true;", "context", 61, "  return true;", "context", 1),
    r(55, "}", "context", 62, "}", "context", 1),
]
LOGIN = [
    r(None, "@@ -8,10 +8,12 @@", "meta", None, "@@ -8,10 +8,12 @@", "meta", 0),
    r(8, "export async function login(email: string, password: string) {", "context", 8, "export async function login(email: string, password: string) {", "context", 0),
    r(9, "  const user = await users.findByEmail(email);", "context", 9, "  const user = await users.findByEmail(email);", "context", 0),
    r(10, "  if (!user) return null;", "deletion", 10, "  if (!user) throw new InvalidCredentialsError();", "addition", 0),
    r(11, "", "context", 11, "", "context", 0),
    r(12, "  const valid = await compare(password, user.password);", "context", 12, "  const valid = await compare(password, user.password);", "context", 0),
    r(13, "  if (!valid) return null;", "deletion", 13, "  if (!valid) throw new InvalidCredentialsError();", "addition", 0),
    r(14, "", "context", 14, "", "context", 0),
    r(15, "  return createSession(user.id);", "deletion", 15, "  rateLimit.reset(email);", "addition", 0),
    r(None, "", "empty", 16, "  return createSession(user.id);", "addition", 0),
    r(16, "}", "context", 17, "}", "context", 0),
]
TESTS = [
    r(None, "@@ -0,0 +1,9 @@", "meta", None, "@@ -0,0 +1,9 @@", "meta", 0),
    r(None, "", "empty", 1, 'import { describe, expect, it } from "vitest";', "addition", 0),
    r(None, "", "empty", 2, 'import { login } from "../src/auth/login";', "addition", 0),
    r(None, "", "empty", 3, "", "addition", 0),
    r(None, "", "empty", 4, 'describe("login", () => {', "addition", 0),
    r(None, "", "empty", 5, '  it("rejects unknown users", async () => {', "addition", 0),
    r(None, "", "empty", 6, '    await expect(login("missing@example.com", "x"))', "addition", 0),
    r(None, "", "empty", 7, '      .rejects.toThrow("Invalid credentials");', "addition", 0),
    r(None, "", "empty", 8, "  });", "addition", 0),
    r(None, "", "empty", 9, "});", "addition", 0),
]
PACKAGE = [
    r(None, "@@ -7,7 +7,8 @@", "meta", None, "@@ -7,7 +7,8 @@", "meta", 0),
    r(7, '    "test": "vitest"', "deletion", 7, '    "test": "vitest run",', "addition", 0),
    r(None, "", "empty", 8, '    "test:watch": "vitest"', "addition", 0),
    r(8, "  },", "context", 9, "  },", "context", 0),
]
SERVICE = [
    r(None, "@@ -0,0 +1,8 @@", "meta", None, "@@ -0,0 +1,8 @@", "meta", 0),
    r(None, "", "empty", 1, 'import { sessionStore } from "./store";', "addition", 0),
    r(None, "", "empty", 2, "", "addition", 0),
    r(None, "", "empty", 3, "export class SessionService {", "addition", 0),
    r(None, "", "empty", 4, "  async create(userId: string) {", "addition", 0),
    r(None, "", "empty", 5, "    const session = await sessionStore.create(userId);", "addition", 0),
    r(None, "", "empty", 6, "    return session.token;", "addition", 0),
    r(None, "", "empty", 7, "  }", "addition", 0),
    r(None, "", "empty", 8, "}", "addition", 0),
]
SERVER = [
    r(None, "@@ -0,0 +1,7 @@", "meta", None, "@@ -0,0 +1,7 @@", "meta", 0),
    r(None, "", "empty", 1, 'import Fastify from "fastify";', "addition", 0),
    r(None, "", "empty", 2, "", "addition", 0),
    r(None, "", "empty", 3, "const app = Fastify({ logger: true });", "addition", 0),
    r(None, "", "empty", 4, "", "addition", 0),
    r(None, "", "empty", 5, 'app.get("/health", async () => ({ ok: true }));', "addition", 0),
    r(None, "", "empty", 6, "", "addition", 0),
    r(None, "", "empty", 7, "await app.listen({ port: 3000 });", "addition", 0),
]


def f(path, status, plus, minus, rows) -> File:
    return File(path, status, plus, minus, list(rows))


SOURCES = [
    Source("working", "W", "Working Tree", "unstaged + untracked", [f("src/api/session.ts", "M", 8, 2, SESSION), f("src/auth/login.ts", "M", 5, 3, LOGIN), f("tests/auth.test.ts", "A", 28, 0, TESTS)]),
    Source("staged", "S", "Staged Changes", "index vs HEAD", [f("package.json", "M", 2, 1, PACKAGE)]),
    Source("commit", "●", "Add token validation", "Lucas · Aug 25 · HEAD", [f("src/api/session.ts", "M", 8, 2, SESSION), f("src/auth/login.ts", "M", 5, 3, LOGIN), f("tests/auth.test.ts", "A", 28, 0, TESTS)], "8f3c2a1"),
    Source("commit", "●", "Refactor session service", "Lucas · Aug 24", [f("src/api/session-service.ts", "A", 34, 0, SERVICE), f("src/api/session.ts", "M", 6, 19, SESSION)], "2ab91c0"),
    Source("commit", "●", "Add login regression tests", "Maya · Aug 24", [f("tests/login-regression.test.ts", "A", 42, 0, TESTS)], "f8ee441"),
    Source("commit", "◆", "Merge feature/auth into main", "Lucas · Aug 23 · parent 1/2", [f("src/api/session.ts", "M", 8, 2, SESSION), f("src/auth/login.ts", "M", 5, 3, LOGIN)], "a19bc0e"),
    Source("commit", "●", "Bootstrap API server", "Lucas · Aug 22", [f("src/server.ts", "A", 31, 0, SERVER), f("package.json", "M", 4, 1, PACKAGE)], "31ce90a"),
]


class Demo:
    def __init__(self, stdscr) -> None:
        self.s = stdscr
        self.source_i = 0
        self.file_i = 0
        self.focus = "sources"  # sources | files | diff
        self.view = "side"
        self.scroll = 0
        self.hscroll = 0
        self.message = "Fake data only — no Git commands are run."
        self.hits: list[Hit] = []
        self._setup()

    def _setup(self) -> None:
        curses.curs_set(0)
        self.s.keypad(True)
        try:
            curses.use_default_colors()
        except curses.error:
            pass
        if curses.has_colors():
            curses.start_color()
            for i, fg in enumerate([curses.COLOR_WHITE, curses.COLOR_CYAN, curses.COLOR_GREEN, curses.COLOR_RED, curses.COLOR_YELLOW, curses.COLOR_BLUE, curses.COLOR_MAGENTA], 1):
                curses.init_pair(i, fg, -1)
            curses.init_pair(8, curses.COLOR_BLACK, curses.COLOR_CYAN)
            curses.init_pair(9, curses.COLOR_BLACK, curses.COLOR_GREEN)
        try:
            curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
            curses.mouseinterval(0)
        except curses.error:
            pass

    @property
    def source(self) -> Source:
        return SOURCES[self.source_i]

    @property
    def file(self) -> File:
        return self.source.files[self.file_i]

    def color(self, pair: int, extra: int = 0) -> int:
        return (curses.color_pair(pair) if curses.has_colors() else 0) | extra

    def add(self, y: int, x: int, text: str, attr: int = 0, width: Optional[int] = None) -> None:
        h, w = self.s.getmaxyx()
        if not (0 <= y < h and 0 <= x < w):
            return
        width = min(width if width is not None else w - x, w - x - (1 if y == h - 1 else 0))
        if width <= 0:
            return
        try:
            self.s.addnstr(y, x, text, width, attr)
        except curses.error:
            pass

    def fill(self, y: int, x: int, width: int, attr: int = 0) -> None:
        self.add(y, x, " " * max(0, width), attr, width)

    def box(self, top: int, left: int, bottom: int, right: int, active: bool) -> None:
        a = self.color(2 if active else 6)
        self.add(top, left, "┌", a); self.add(top, left + 1, "─" * max(0, right - left - 1), a); self.add(top, right, "┐", a)
        for y in range(top + 1, bottom):
            self.add(y, left, "│", a); self.add(y, right, "│", a)
        self.add(bottom, left, "└", a); self.add(bottom, left + 1, "─" * max(0, right - left - 1), a); self.add(bottom, right, "┘", a)

    def hit(self, y: int, x1: int, x2: int, action: Callable[[], None]) -> None:
        self.hits.append(Hit(y, x1, x2, action))

    def select_source(self, i: int) -> None:
        self.source_i = max(0, min(i, len(SOURCES) - 1))
        self.file_i = 0
        self.scroll = self.hscroll = 0
        self.focus = "sources"
        label = f"commit {self.source.oid}" if self.source.kind == "commit" else self.source.label
        self.message = f"Selected {label}; loaded {len(self.source.files)} changed file(s)."

    def select_file(self, i: int) -> None:
        self.file_i = max(0, min(i, len(self.source.files) - 1))
        self.scroll = self.hscroll = 0
        self.focus = "files"
        self.message = f"Selected {self.file.path}; diff updated immediately."

    def render(self) -> None:
        self.s.erase(); self.hits = []
        h, w = self.s.getmaxyx()
        if h < 22 or w < 100:
            self.add(2, 3, "Resize terminal to at least 100×22. Press q to quit.", self.color(5, curses.A_BOLD)); self.s.refresh(); return
        self.fill(0, 0, w, self.color(1, curses.A_BOLD))
        self.add(0, 1, "PI SOURCE CONTROL", self.color(1, curses.A_BOLD))
        scope = f"{self.source.oid} · {self.source.label}" if self.source.kind == "commit" else self.source.label
        self.add(0, 22, scope, self.color(2, curses.A_BOLD), max(0, w - 45))
        self.add(0, max(1, w - 18), "DEMO · FAKE DATA", self.color(5, curses.A_BOLD), 16)
        self.add(1, 0, "─" * w, self.color(6), w)
        top, bottom = 2, h - 3
        left_w = max(36, min(50, int(w * .32)))
        self.draw_left(top, 0, bottom, left_w)
        self.draw_diff(top, left_w + 1, bottom, w - 1)
        self.add(h - 2, 0, "─" * w, self.color(6), w)
        reviewed = sum(x.reviewed for x in self.source.files)
        foot = f"{reviewed}/{len(self.source.files)} reviewed  Tab source/files/diff  ↑↓ select/scroll  v view  Space reviewed  n/p hunk  q"
        self.add(h - 1, 1, foot, self.color(1), w - 2)
        self.add(h - 2, 1, self.message, self.color(6), w - 2)
        self.s.refresh()

    def draw_left(self, top: int, left: int, bottom: int, right: int) -> None:
        self.box(top, left, bottom, right, self.focus in {"sources", "files"})
        self.add(top, left + 2, " SOURCE CONTROL ", self.color(2 if self.focus in {"sources", "files"} else 1, curses.A_BOLD), right - left - 3)
        y = top + 2
        self.add(y, left + 2, "WORKSPACE", self.color(1, curses.A_BOLD)); y += 1
        for i in range(2):
            self.draw_source_row(y, left + 1, right - 1, i); y += 1
        y += 1; self.add(y, left + 2, "RECENT COMMITS", self.color(1, curses.A_BOLD)); y += 1
        for i in range(2, len(SOURCES)):
            self.draw_source_row(y, left + 1, right - 1, i); y += 1
        y += 1
        self.add(y, left + 2, f"FILES CHANGED ({len(self.source.files)})", self.color(1, curses.A_BOLD)); y += 1
        if self.source.kind == "commit":
            text = f"{self.source.oid} · read-only · {self.source.detail}"
            self.add(y, left + 2, text, self.color(6), right - left - 3); y += 1
        for i, file in enumerate(self.source.files):
            if y >= bottom:
                break
            self.draw_file_row(y, left + 1, right - 1, i, file); y += 1

    def draw_source_row(self, y: int, left: int, right: int, i: int) -> None:
        src = SOURCES[i]; selected = i == self.source_i
        a = self.color(8, curses.A_BOLD) if selected else self.color(1)
        self.fill(y, left, right - left + 1, a)
        icon_a = a if selected else self.color(7 if src.kind == "commit" else 2, curses.A_BOLD)
        self.add(y, left + 1, src.icon, icon_a, 1)
        label = f"{src.oid} {src.label}" if src.kind == "commit" else src.label
        self.add(y, left + 4, label, a | curses.A_BOLD, max(1, right - left - 11))
        self.add(y, right - 2, str(len(src.files)), a, 2)
        self.hit(y, left, right, lambda idx=i: self.select_source(idx))

    def draw_file_row(self, y: int, left: int, right: int, i: int, file: File) -> None:
        selected = i == self.file_i
        a = self.color(9 if selected and file.reviewed else 8, curses.A_BOLD) if selected else self.color(1)
        self.fill(y, left, right - left + 1, a)
        self.add(y, left + 1, "✓" if file.reviewed else " ", a, 1)
        status_a = a if selected else self.color({"M": 5, "A": 3, "D": 4}.get(file.status, 2), curses.A_BOLD)
        self.add(y, left + 3, file.status, status_a, 1)
        self.add(y, left + 6, file.name, a | curses.A_BOLD, max(1, right - left - 20))
        stat = f"+{file.plus} -{file.minus}"
        self.add(y, right - len(stat), stat, a if selected else self.color(6), len(stat))
        self.hit(y, left, right, lambda idx=i: self.select_file(idx))

    def diff_lines(self, width: int) -> list[tuple[str, int]]:
        return self.side_lines(width) if self.view == "side" and width >= 82 else self.unified_lines(width)

    def side_lines(self, width: int) -> list[tuple[str, int]]:
        divider = " │ "; col = max(10, (width - len(divider)) // 2); out = [(" ORIGINAL ".center(col, "─") + divider + " MODIFIED ".center(col, "─"), self.color(6, curses.A_BOLD))]
        for row in self.file.rows:
            if row.old_kind == "meta":
                out.append(((row.new or row.old).ljust(width)[:width], self.color(2, curses.A_BOLD))); continue
            old_no = "" if row.old_no is None else str(row.old_no); new_no = "" if row.new_no is None else str(row.new_no)
            old_mark = "-" if row.old_kind == "deletion" else " "; new_mark = "+" if row.new_kind == "addition" else " "
            text_w = max(1, col - 7)
            old = row.old[self.hscroll:self.hscroll + text_w]; new = row.new[self.hscroll:self.hscroll + text_w]
            left = f"{old_no:>4} {old_mark} {old}".ljust(col); right = f"{new_no:>4} {new_mark} {new}".ljust(col)
            attr = self.color(5 if row.old_kind == "deletion" and row.new_kind == "addition" else 4 if row.old_kind == "deletion" else 3 if row.new_kind == "addition" else 1)
            out.append(((left + divider + right)[:width], attr))
        return out

    def unified_lines(self, width: int) -> list[tuple[str, int]]:
        out: list[tuple[str, int]] = []
        for row in self.file.rows:
            if row.old_kind == "meta": out.append(((row.new or row.old)[:width], self.color(2, curses.A_BOLD))); continue
            if row.old_kind == "deletion": out.append((f"{str(row.old_no or ''):>4}      - {row.old[self.hscroll:]}"[:width], self.color(4)))
            if row.new_kind == "addition": out.append((f"     {str(row.new_no or ''):>4} + {row.new[self.hscroll:]}"[:width], self.color(3)))
            if row.old_kind == row.new_kind == "context": out.append((f"{str(row.old_no or ''):>4} {str(row.new_no or ''):>4}   {row.new[self.hscroll:]}"[:width], self.color(1)))
        return out

    def draw_diff(self, top: int, left: int, bottom: int, right: int) -> None:
        self.box(top, left, bottom, right, self.focus == "diff")
        mode = "SIDE-BY-SIDE" if self.view == "side" and right - left - 1 >= 82 else "UNIFIED"
        prefix = f"{self.source.oid} · " if self.source.kind == "commit" else ""
        title = f" {prefix}{self.file.path} · {mode} "
        self.add(top, left + 2, title, self.color(2 if self.focus == "diff" else 1, curses.A_BOLD), right - left - 3)
        width = right - left - 1; height = bottom - top - 1
        lines = self.diff_lines(width); self.scroll = max(0, min(self.scroll, max(0, len(lines) - height)))
        for i, (text, attr) in enumerate(lines[self.scroll:self.scroll + height]):
            self.add(top + 1 + i, left + 1, text, attr, width)

    def scroll_diff(self, amount: int) -> None:
        self.scroll = max(0, self.scroll + amount)

    def next_hunk(self, delta: int) -> None:
        offsets = []; seen = None
        for i, row in enumerate(self.file.rows):
            if row.hunk != seen: offsets.append(i); seen = row.hunk
        if not offsets: return
        current = max((i for i, off in enumerate(offsets) if off <= self.scroll), default=0)
        current = max(0, min(len(offsets) - 1, current + delta)); self.scroll = offsets[current]
        self.message = f"Hunk {current + 1}/{len(offsets)}"

    def mouse(self) -> None:
        try: _, x, y, _, state = curses.getmouse()
        except curses.error: return
        if state & getattr(curses, "BUTTON4_PRESSED", 0): self.scroll_diff(-3); return
        if state & getattr(curses, "BUTTON5_PRESSED", 0): self.scroll_diff(3); return
        masks = [getattr(curses, n, 0) for n in ("BUTTON1_CLICKED", "BUTTON1_PRESSED", "BUTTON1_RELEASED")]
        if not any(state & m for m in masks): return
        for hit in reversed(self.hits):
            if hit.y == y and hit.x1 <= x <= hit.x2: hit.action(); return

    def key(self, ch: int) -> None:
        if ch == curses.KEY_MOUSE: self.mouse(); return
        if ch == curses.KEY_RESIZE: return
        if ch in (ord("q"), ord("Q"), 3, 27): raise KeyboardInterrupt
        if ch == 9:
            self.focus = {"sources": "files", "files": "diff", "diff": "sources"}[self.focus]; return
        if ch == curses.KEY_BTAB:
            self.focus = {"sources": "diff", "files": "sources", "diff": "files"}[self.focus]; return
        if ch in (curses.KEY_UP, ord("k")):
            if self.focus == "sources": self.select_source(self.source_i - 1)
            elif self.focus == "files": self.select_file(self.file_i - 1)
            else: self.scroll_diff(-1)
            return
        if ch in (curses.KEY_DOWN, ord("j")):
            if self.focus == "sources": self.select_source(self.source_i + 1)
            elif self.focus == "files": self.select_file(self.file_i + 1)
            else: self.scroll_diff(1)
            return
        if ch in (10, 13, curses.KEY_ENTER):
            self.focus = "files" if self.focus == "sources" else "diff"; return
        if ch == ord("v"): self.view = "unified" if self.view == "side" else "side"; self.scroll = 0; return
        if ch == ord(" "): self.file.reviewed = not self.file.reviewed; self.message = f"{'Reviewed' if self.file.reviewed else 'Unreviewed'}: {self.file.path}"; return
        if ch == ord("n"): self.next_hunk(1); return
        if ch == ord("p"): self.next_hunk(-1); return
        if ch == curses.KEY_PPAGE: self.scroll_diff(-8); return
        if ch == curses.KEY_NPAGE: self.scroll_diff(8); return
        if ch == curses.KEY_LEFT: self.hscroll = max(0, self.hscroll - 4); return
        if ch == curses.KEY_RIGHT: self.hscroll += 4; return

    def run(self) -> None:
        while True:
            self.render(); self.key(self.s.getch())


def main() -> None:
    try:
        curses.wrapper(lambda stdscr: Demo(stdscr).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

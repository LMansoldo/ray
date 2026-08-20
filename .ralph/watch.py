#!/usr/bin/env python3
"""ralph-watch — live TUI for ralph-loop runs.

Usage:
  python .ralph/watch.py                          # auto-detect events.jsonl in sibling dirs
  python .ralph/watch.py /path/to/events.jsonl   # explicit path
"""

import sys
import json
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone

try:
    from rich.live import Live
    from rich.text import Text
    from rich.panel import Panel
    from rich.table import Table
    from rich.console import Console
    RICH = True
except ImportError:
    RICH = False


# ── State model ───────────────────────────────────────────────────────────────

STEP_LABELS = {
    "red":         "writing tests",
    "judge_red":   "judging tests",
    "green":       "implementing",
    "judge_green": "judging impl",
    "commit":      "committing",
}

PHASE_DISPLAY = {
    "contract":    "Phase 1: Contract",
    "implement":   "Phase 2: Implement",
    "integration": "Phase 2.5: Integration",
    "report":      "Phase 3: Report",
}


class ItemState:
    def __init__(self, item_id, title):
        self.id = item_id
        self.title = title
        self.status = "PENDING"   # PENDING RUNNING COMPLETED BLOCKED SKIPPED
        self.attempt = 0
        self.max_attempts = 5
        self.current_step = None  # red judge_red green judge_green commit
        self.last_verdict = None  # {step, verdict, summary}

    def apply(self, ev):
        t = ev["event"]
        if t == "item_start":
            self.status = "RUNNING"
            self.attempt = int(ev.get("attempt", 1))
            self.current_step = None
        elif t == "step_start":
            self.current_step = ev.get("step")
        elif t == "judge_verdict":
            self.last_verdict = {
                "step": ev.get("step"),
                "verdict": ev.get("verdict"),
                "summary": ev.get("summary", ""),
            }
        elif t == "item_done":
            self.status = ev.get("status", "COMPLETED")
            self.attempt = int(ev.get("attempts", self.attempt))
            self.current_step = None


class PhaseState:
    def __init__(self, name, label):
        self.name = name
        self.label = label
        self.status = "running"  # running done
        self.summary = ""

    def apply(self, ev):
        if ev["event"] == "phase_end" and ev.get("phase") == self.name:
            self.status = "done"
            self.summary = ev.get("summary", "")


class RunState:
    def __init__(self):
        self.branch = "—"
        self.max_attempts = 5
        self.budget_usd = 20.0
        self.start_ts = None
        self.phases = []          # list[PhaseState] in order seen
        self.phase_index = {}     # name -> PhaseState
        self.items = {}           # id -> ItemState
        self.item_order = []
        self.cost_usd = 0.0
        self.last_event_label = ""
        self.done = False
        self.done_status = None

    def apply(self, ev):
        t = ev.get("event")

        if t == "run_start":
            self.branch = ev.get("branch", "—")
            self.max_attempts = int(ev.get("max_attempts", 5))
            self.budget_usd = float(ev.get("budget_usd", 20))
            self.start_ts = ev.get("ts")
            return

        if t == "phase_start":
            name = ev.get("phase", "")
            label = ev.get("label", PHASE_DISPLAY.get(name, name))
            if name not in self.phase_index:
                phase = PhaseState(name, label)
                self.phases.append(phase)
                self.phase_index[name] = phase
            return

        if t == "phase_end":
            name = ev.get("phase", "")
            if name in self.phase_index:
                self.phase_index[name].apply(ev)
            return

        if t == "items_loaded":
            ids = ev.get("ids", [])
            titles = ev.get("titles", {})
            for item_id in ids:
                if item_id not in self.items:
                    item = ItemState(item_id, titles.get(item_id, item_id))
                    item.max_attempts = self.max_attempts
                    self.items[item_id] = item
                    self.item_order.append(item_id)
            return

        if t in ("item_start", "step_start", "judge_verdict", "item_done"):
            item_id = ev.get("id", "")
            if item_id not in self.items:
                item = ItemState(item_id, item_id)
                item.max_attempts = self.max_attempts
                self.items[item_id] = item
                self.item_order.append(item_id)
            self.items[item_id].apply(ev)

            if t == "item_start":
                self.last_event_label = f"started {item_id} (attempt {ev.get('attempt', 1)})"
            elif t == "step_start":
                step = ev.get("step", "")
                self.last_event_label = f"{item_id}  {STEP_LABELS.get(step, step)}..."
            elif t == "judge_verdict":
                verdict = ev.get("verdict", "?")
                summary = ev.get("summary", "")[:70]
                self.last_event_label = f"judge {item_id} {ev.get('step', '')} -> {verdict}  {summary}"
            elif t == "item_done":
                self.last_event_label = f"{item_id}  {ev.get('status', '?')}"
            return

        if t == "cost_update":
            self.cost_usd = float(ev.get("total_usd", self.cost_usd))
            return

        if t == "run_done":
            self.done = True
            self.done_status = ev.get("status", "done")
            self.cost_usd = float(ev.get("cost_usd", self.cost_usd))
            for phase in self.phases:
                if phase.status == "running":
                    phase.status = "done"
            return


# ── Rendering ─────────────────────────────────────────────────────────────────

def elapsed_str(start_ts):
    if not start_ts:
        return "--:--"
    try:
        start = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
        delta = int((datetime.now(timezone.utc) - start).total_seconds())
        m, s = divmod(delta, 60)
        return f"{m:02d}:{s:02d}"
    except Exception:
        return "--:--"


def item_icon(status):
    table = {
        "COMPLETED": ("✓", "bold green"),
        "BLOCKED":   ("✗", "bold red"),
        "SKIPPED":   ("—", "dim"),
        "RUNNING":   ("⟳", "bold yellow"),
        "PENDING":   ("○", "dim"),
    }
    char, style = table.get(status, ("?", "dim"))
    return Text(char, style=style)


def phase_icon(status):
    if status == "done":
        return Text("✓", style="bold green")
    if status == "running":
        return Text("⟳", style="bold yellow")
    return Text("○", style="dim")


def render(state: RunState) -> Panel:
    grid = Table.grid(padding=(0, 1))
    grid.add_column(width=3, no_wrap=True)
    grid.add_column()

    for phase in state.phases:
        label = Text(phase.label, style="bold")
        if phase.summary:
            label.append(f"  {phase.summary}", style="dim")
        grid.add_row(phase_icon(phase.status), label)

        if phase.name == "implement":
            for item_id in state.item_order:
                item = state.items[item_id]
                row = Text()
                row.append(f"  {item.id}", style="bold cyan")
                row.append(f"  {item.title}")
                if item.attempt:
                    row.append(f"  attempt {item.attempt}/{item.max_attempts}", style="dim")
                if item.status == "RUNNING" and item.current_step:
                    row.append(
                        f"  — {STEP_LABELS.get(item.current_step, item.current_step)}...",
                        style="italic yellow",
                    )
                grid.add_row(item_icon(item.status), row)

    if state.last_event_label:
        grid.add_row(Text(""), Text(""))
        grid.add_row(Text(""), Text(state.last_event_label, style="dim italic"))

    el = elapsed_str(state.start_ts)
    cost = f"${state.cost_usd:.2f} / ${state.budget_usd:.2f}"
    title = f"Ralph Loop  [dim]branch: {state.branch}[/dim]"
    subtitle = f"[dim]elapsed: {el}   cost: {cost}[/dim]"

    if state.done:
        border = "green" if state.done_status == "success" else "red"
    else:
        border = "yellow"

    return Panel(grid, title=title, subtitle=subtitle, border_style=border, padding=(0, 1))


# ── Event file tailing ────────────────────────────────────────────────────────

class EventTailer:
    def __init__(self, path: Path):
        self.path = path
        self._pos = 0

    def read_new(self):
        if not self.path.exists():
            return []
        with open(self.path, "r", encoding="utf-8") as f:
            f.seek(self._pos)
            lines = f.readlines()
            self._pos = f.tell()
        events = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return events


# ── Main ──────────────────────────────────────────────────────────────────────

def find_events_file():
    cwd = Path.cwd()
    candidates = []
    for sibling in sorted(cwd.parent.iterdir()):
        candidate = sibling / ".ralph-run" / "events.jsonl"
        if candidate.exists():
            candidates.append(candidate)
    local = cwd / ".ralph-run" / "events.jsonl"
    if local.exists() and local not in candidates:
        candidates.append(local)
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    print("Multiple runs found (newest first):")
    for i, c in enumerate(candidates):
        print(f"  [{i}] {c}")
    try:
        choice = input("Select [0]: ").strip()
        return candidates[int(choice) if choice else 0]
    except (ValueError, IndexError, EOFError):
        return candidates[0]


def plain_watch(tailer, state):
    print("(install rich for live TUI: pip install rich)")
    print("Streaming events...")
    while True:
        for ev in tailer.read_new():
            state.apply(ev)
            print(json.dumps(ev, ensure_ascii=False))
        if state.done:
            print("\nRun complete.")
            break
        time.sleep(0.5)


def rich_watch(tailer, state):
    console = Console()
    with Live(render(state), console=console, refresh_per_second=4) as live:
        while True:
            for ev in tailer.read_new():
                state.apply(ev)
            live.update(render(state))
            if state.done:
                time.sleep(0.3)
                live.update(render(state))
                break
            time.sleep(0.25)

    status = state.done_status or "done"
    style = "bold green" if status == "success" else "bold red"
    console.print(f"\nRun {status}.", style=style)
    console.print(f"Cost: ${state.cost_usd:.4f}")


def main():
    parser = argparse.ArgumentParser(description="Live TUI for ralph-loop runs.")
    parser.add_argument("events_file", nargs="?", help="Path to events.jsonl")
    args = parser.parse_args()

    if args.events_file:
        events_path = Path(args.events_file)
    else:
        events_path = find_events_file()

    if events_path is None:
        print("No events.jsonl found. Pass the path explicitly:")
        print("  python .ralph/watch.py /path/to/worktree/.ralph-run/events.jsonl")
        sys.exit(1)

    if not events_path.exists():
        print(f"Watching: {events_path}")
        print("Waiting for run to start...")
        while not events_path.exists():
            time.sleep(0.5)
    else:
        print(f"Watching: {events_path}")

    tailer = EventTailer(events_path)
    state = RunState()

    if RICH:
        rich_watch(tailer, state)
    else:
        plain_watch(tailer, state)


if __name__ == "__main__":
    main()

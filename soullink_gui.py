#!/usr/bin/env python3
"""Simple GUI for building a Soul Link team and generating the graphic.

    python3 soullink_gui.py

The current team is saved to team.json next to this script, so it's still
there the next time you open the app.
"""

import json
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

import retro
import soullink

STATE_FILE = Path(__file__).resolve().parent / "team.json"
THEME_LABELS = {"modern": "Modern", **{k: st.name for k, st in retro.STYLES.items()}}


class SearchBox(ttk.Frame):
    """Entry with a filtered list of Pokémon names underneath it.

    Any text is accepted, so forms not in the list ("Raichu-Alola",
    "Alolan Vulpix", "Charizard-Mega-X") can just be typed.
    """

    def __init__(self, master, names_getter, **kw):
        super().__init__(master, **kw)
        self.names_getter = names_getter
        self.var = tk.StringVar()
        self.entry = ttk.Entry(self, textvariable=self.var, width=26)
        self.entry.pack(fill="x")
        self.listbox = tk.Listbox(self, height=6, exportselection=False, activestyle="none")
        self.listbox.pack(fill="both", expand=True, pady=(2, 0))
        self.var.trace_add("write", lambda *_: self.refresh())
        self.listbox.bind("<<ListboxSelect>>", self._on_select)
        self.entry.bind("<Down>", self._focus_list)
        self._selecting = False

    def refresh(self):
        if self._selecting:
            return
        q = self.var.get().strip().lower()
        names = self.names_getter()
        if q:
            starts = [n for n in names if n.lower().startswith(q)]
            contains = [n for n in names if q in n.lower() and n not in starts]
            names = starts + contains
        self.listbox.delete(0, "end")
        for n in names[:200]:
            self.listbox.insert("end", n)

    def _on_select(self, _event):
        sel = self.listbox.curselection()
        if sel:
            self._selecting = True
            self.var.set(self.listbox.get(sel[0]))
            self._selecting = False

    def _focus_list(self, _event):
        if self.listbox.size():
            self.listbox.focus_set()
            self.listbox.selection_clear(0, "end")
            self.listbox.selection_set(0)
            self._on_select(None)

    def get(self) -> str:
        return self.var.get().strip()

    def clear(self):
        self.var.set("")


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Soul Link Team Graphic")
        self.minsize(640, 600)
        self.species: list[str] = []
        self.pairs: list[dict] = []

        pad = dict(padx=8, pady=4)

        # --- Title and trainer names -------------------------------------
        top = ttk.Frame(self)
        top.pack(fill="x", **pad)
        self.title_var = tk.StringVar(value="Soul Link")
        self.p1_var = tk.StringVar(value="Player 1")
        self.p2_var = tk.StringVar(value="Player 2")
        for col, (label, var) in enumerate([("Title", self.title_var),
                                            ("Trainer 1", self.p1_var),
                                            ("Trainer 2", self.p2_var)]):
            ttk.Label(top, text=label).grid(row=0, column=col, sticky="w", padx=4)
            ttk.Entry(top, textvariable=var, width=22).grid(row=1, column=col, sticky="ew", padx=4)
            top.columnconfigure(col, weight=1)
            var.trace_add("write", lambda *_: self.save_state())

        # --- Style --------------------------------------------------------
        style = ttk.LabelFrame(self, text="Style")
        style.pack(fill="x", **pad)
        self.theme_var = tk.StringVar(value=THEME_LABELS["modern"])
        self.sprites_var = tk.BooleanVar(value=False)
        self.sprite_game_var = tk.StringVar(value=retro.STYLES["b2w2"].name)
        ttk.Label(style, text="Theme").grid(row=0, column=0, sticky="w", padx=6, pady=4)
        ttk.Combobox(style, textvariable=self.theme_var, state="readonly", width=22,
                     values=list(THEME_LABELS.values())).grid(row=0, column=1, sticky="w")
        ttk.Checkbutton(style, text="Pixel sprites", variable=self.sprites_var).grid(
            row=0, column=2, sticky="w", padx=6)
        # the modern theme has no game, so it picks which game's sprites to use
        self.sprite_game_box = ttk.Combobox(
            style, textvariable=self.sprite_game_var, state="readonly", width=20,
            values=[st.name for st in retro.STYLES.values()])
        self.sprite_game_box.grid(row=0, column=3, sticky="w")
        self.link_var = tk.StringVar(value="Heart")
        # Game-theme options: trainer sprite and PC box wallpaper per trainer
        self.trainer_vars = [tk.StringVar(), tk.StringVar()]
        self.wallpaper_vars = [tk.StringVar(), tk.StringVar()]
        self.trainer_boxes, self.wallpaper_boxes = [], []
        self.game_widgets = []        # (widget, state when enabled) for any game theme
        self.wallpaper_widgets = []   # only for games with box wallpapers
        for row, (who, tvar, wvar) in enumerate(zip(("Trainer 1", "Trainer 2"),
                                                    self.trainer_vars, self.wallpaper_vars), 1):
            tlabel = ttk.Label(style, text=f"{who} sprite")
            tbox = ttk.Combobox(style, textvariable=tvar, width=22)
            wlabel = ttk.Label(style, text="Wallpaper")
            wbox = ttk.Combobox(style, textvariable=wvar, state="readonly", width=18)
            for col, w in enumerate((tlabel, tbox, wlabel, wbox)):
                w.grid(row=row, column=col, sticky="w", padx=6 if col % 2 == 0 else 0, pady=2)
            self.trainer_boxes.append(tbox)
            self.wallpaper_boxes.append(wbox)
            self.game_widgets += [(tlabel, "normal"), (tbox, "normal")]
            self.wallpaper_widgets += [(wlabel, "normal"), (wbox, "readonly")]
        link_widgets = [ttk.Label(style, text="Link icon"),
                        ttk.Combobox(style, textvariable=self.link_var, state="readonly", width=22,
                                     values=["Heart", "DNA Splicers"])]
        for col, w in enumerate(link_widgets):
            w.grid(row=3, column=col, sticky="w", padx=6 if col == 0 else 0, pady=(2, 6))
        self.game_widgets += zip(link_widgets, ["normal", "readonly"])
        for var in (self.theme_var, self.sprites_var, self.sprite_game_var, self.link_var,
                    *self.trainer_vars, *self.wallpaper_vars):
            var.trace_add("write", lambda *_: self.save_state())
        self.theme_var.trace_add("write", lambda *_: self.theme_changed())

        # --- Add a pair ---------------------------------------------------
        add = ttk.LabelFrame(self, text="Add a pair")
        add.pack(fill="x", **pad)
        self.search, self.nick_vars, self.side_labels = [], [], []
        for col in range(2):
            side = ttk.Frame(add)
            side.grid(row=0, column=col, sticky="nsew", padx=6, pady=4)
            add.columnconfigure(col, weight=1)
            lbl = ttk.Label(side, font=("TkDefaultFont", 0, "bold"))
            lbl.pack(anchor="w")
            self.side_labels.append(lbl)
            box = SearchBox(side, lambda: self.species)
            box.pack(fill="both", expand=True)
            self.search.append(box)
            ttk.Label(side, text="Nickname (optional)").pack(anchor="w", pady=(4, 0))
            nick = tk.StringVar()
            ttk.Entry(side, textvariable=nick).pack(fill="x")
            self.nick_vars.append(nick)
        ttk.Button(add, text="Add pair", command=self.add_pair).grid(
            row=1, column=0, columnspan=2, pady=(2, 8))
        for var in (self.p1_var, self.p2_var):
            var.trace_add("write", lambda *_: self.update_side_labels())
        self.update_side_labels()

        # --- Current team -------------------------------------------------
        team = ttk.LabelFrame(self, text="Team")
        team.pack(fill="both", expand=True, **pad)
        self.tree = ttk.Treeview(team, columns=("a", "b"), show="headings", height=6)
        self.tree.pack(side="left", fill="both", expand=True, padx=(6, 0), pady=6)
        buttons = ttk.Frame(team)
        buttons.pack(side="left", fill="y", padx=6, pady=6)
        ttk.Button(buttons, text="Move up", command=lambda: self.move(-1)).pack(fill="x")
        ttk.Button(buttons, text="Move down", command=lambda: self.move(1)).pack(fill="x", pady=4)
        ttk.Button(buttons, text="Remove", command=self.remove).pack(fill="x")
        ttk.Button(buttons, text="Clear all", command=self.clear_all).pack(fill="x", pady=4)
        ttk.Separator(buttons).pack(fill="x", pady=4)
        ttk.Button(buttons, text="Load team…", command=self.load_team).pack(fill="x")
        ttk.Button(buttons, text="Save team…", command=self.save_team).pack(fill="x", pady=4)

        # --- Generate -----------------------------------------------------
        bottom = ttk.Frame(self)
        bottom.pack(fill="x", **pad)
        self.gen_button = ttk.Button(bottom, text="Generate image…", command=self.generate)
        self.gen_button.pack(side="left")
        self.status = tk.StringVar(value="Loading Pokémon list…")
        ttk.Label(bottom, textvariable=self.status, foreground="gray").pack(side="left", padx=10)

        self.theme_changed()  # fill in the default theme's options
        self.load_state()
        self.update_style_widgets()
        self.run_in_background(soullink.species_names, self._species_loaded)

    def run_in_background(self, fn, on_done):
        """Run fn() in a thread, then call on_done(result, error) on the Tk thread."""
        results = queue.Queue()

        def work():
            try:
                results.put((fn(), None))
            except Exception as e:
                results.put((None, e))

        def poll():
            try:
                on_done(*results.get_nowait())
            except queue.Empty:
                self.after(100, poll)

        threading.Thread(target=work, daemon=True).start()
        poll()

    # --- State -------------------------------------------------------------

    def theme(self) -> str:
        return next(k for k, v in THEME_LABELS.items() if v == self.theme_var.get())

    def game(self) -> retro.GameStyle | None:
        return retro.STYLES.get(self.theme())

    def sprite_game(self) -> str:
        return next(k for k, st in retro.STYLES.items() if st.name == self.sprite_game_var.get())

    def link(self) -> str:
        return "splicers" if self.link_var.get() == "DNA Splicers" else "heart"

    def theme_changed(self):
        """New theme: reset trainers and wallpapers to that game's defaults."""
        game = self.game()
        if game:
            for var, trainer in zip(self.trainer_vars, game.default_trainers):
                var.set(trainer)
            for var, wall in zip(self.wallpaper_vars, game.default_wallpapers or ("", "")):
                var.set(wall)
        self.update_style_widgets()

    def update_style_widgets(self):
        """Enable the options the theme uses and fill in the game's choices."""
        game = self.game()
        has_walls = bool(game and game.wallpaper_category)
        for widget, on_state in self.game_widgets:
            widget.config(state=on_state if game else "disabled")
        for widget, on_state in self.wallpaper_widgets:
            widget.config(state=on_state if has_walls else "disabled")
        self.sprite_game_box.config(state="disabled" if game else "readonly")
        if not game:
            return
        for box in self.trainer_boxes:
            box.config(values=["None", *game.default_trainers])
        if has_walls:  # the wallpaper list comes from the Archives (cached after once)
            def filled(walls, error, game=game):
                if error or self.game() is not game:
                    return
                for box, var, default in zip(self.wallpaper_boxes, self.wallpaper_vars,
                                             game.default_wallpapers):
                    box.config(values=sorted(walls))
                    if var.get() not in walls:
                        var.set(default)
            self.run_in_background(lambda: retro.wallpapers(game), filled)

    def load_state(self):
        if not STATE_FILE.exists():
            return
        try:
            state = json.loads(STATE_FILE.read_text())
        except (OSError, json.JSONDecodeError):
            return
        self.title_var.set(state.get("title", "Soul Link"))
        self.p1_var.set(state.get("players", ["Player 1", "Player 2"])[0])
        self.p2_var.set(state.get("players", ["Player 1", "Player 2"])[1])
        self.pairs = state.get("pairs", [])
        style = state.get("style", {})
        self.theme_var.set(THEME_LABELS.get(style.get("theme"), THEME_LABELS["modern"]))
        self.sprites_var.set(style.get("sprites", False))
        if style.get("sprite_game") in retro.STYLES:
            self.sprite_game_var.set(retro.STYLES[style["sprite_game"]].name)
        for var, value in zip(self.trainer_vars, style.get("trainers", [])):
            var.set(value)
        self.link_var.set("DNA Splicers" if style.get("link") == "splicers" else "Heart")
        for var, value in zip(self.wallpaper_vars, style.get("wallpapers", [])):
            var.set(value)  # checked against the game's list once it loads
        self.refresh_tree()

    def save_state(self):
        if not hasattr(self, "tree"):  # still building the window
            return
        STATE_FILE.write_text(json.dumps({
            "title": self.title_var.get(),
            "players": [self.p1_var.get(), self.p2_var.get()],
            "pairs": self.pairs,
            "style": {
                "theme": self.theme(),
                "sprites": self.sprites_var.get(),
                "sprite_game": self.sprite_game(),
                "trainers": [v.get() for v in self.trainer_vars],
                "wallpapers": [v.get() for v in self.wallpaper_vars],
                "link": self.link(),
            },
        }, indent=2, ensure_ascii=False))

    def _species_loaded(self, names, error):
        if error:  # network trouble: free typing still works
            self.status.set(f"Couldn't load Pokémon list ({error}); type names manually.")
            return
        self.species = names
        for box in self.search:
            box.refresh()
        self.status.set(f"{len(names)} Pokémon loaded.")

    # --- Team editing ------------------------------------------------------

    def update_side_labels(self):
        names = [self.p1_var.get() or "Trainer 1", self.p2_var.get() or "Trainer 2"]
        for lbl, name in zip(self.side_labels, names):
            lbl.config(text=f"{name}'s Pokémon")
        if hasattr(self, "tree"):
            self.tree.heading("a", text=names[0])
            self.tree.heading("b", text=names[1])

    @staticmethod
    def describe(mon: dict) -> str:
        return f"{mon['nickname']} ({mon['name']})" if mon.get("nickname") else mon["name"]

    @staticmethod
    def to_mon(mon: dict) -> soullink.Mon:
        nick = mon.get("nickname")
        return soullink.Mon(f"{mon['name']} ({nick})" if nick else mon["name"])

    def refresh_tree(self):
        self.update_side_labels()
        self.tree.delete(*self.tree.get_children())
        for i, (a, b) in enumerate(self.pairs):
            self.tree.insert("", "end", iid=str(i), values=(self.describe(a), self.describe(b)))

    def add_pair(self):
        names = [box.get() for box in self.search]
        if not all(names):
            messagebox.showwarning("Missing Pokémon", "Pick a Pokémon for both trainers.")
            return
        if len(self.pairs) >= 6 and not messagebox.askyesno(
                "Team is full", "There are already 6 pairs. Add another anyway?"):
            return
        nicks = [v.get().strip().replace("(", "").replace(")", "") for v in self.nick_vars]
        self.pairs.append([{"name": n, "nickname": k} for n, k in zip(names, nicks)])
        for box in self.search:
            box.clear()
        for v in self.nick_vars:
            v.set("")
        self.refresh_tree()
        self.save_state()
        self.search[0].entry.focus_set()

    def selected_index(self) -> int | None:
        sel = self.tree.selection()
        return int(sel[0]) if sel else None

    def move(self, delta):
        i = self.selected_index()
        if i is None or not 0 <= i + delta < len(self.pairs):
            return
        self.pairs[i], self.pairs[i + delta] = self.pairs[i + delta], self.pairs[i]
        self.refresh_tree()
        self.tree.selection_set(str(i + delta))
        self.save_state()

    def remove(self):
        i = self.selected_index()
        if i is not None:
            del self.pairs[i]
            self.refresh_tree()
            self.save_state()

    def load_team(self):
        path = filedialog.askopenfilename(
            title="Load team", filetypes=[("Team file", "*.txt"), ("All files", "*")])
        if not path:
            return
        try:
            title, players, lines = soullink.read_team_file(Path(path))
            pairs = [soullink.parse_pair(line) for line in lines]
        except (OSError, UnicodeDecodeError, ValueError) as e:
            messagebox.showerror("Couldn't load team", str(e))
            return
        if self.pairs and not messagebox.askyesno(
                "Replace team", "Replace the current team with the loaded one?"):
            return
        self.pairs = [[{"name": m.name, "nickname": m.nickname or ""} for m in pair]
                      for pair in pairs]
        if title is not None:
            self.title_var.set(title)
        if players:
            self.p1_var.set(players[0])
            self.p2_var.set(players[1] if len(players) > 1 else "")
        self.refresh_tree()
        self.save_state()
        self.status.set(f"Loaded {len(pairs)} pairs from {Path(path).name}")

    def save_team(self):
        if not self.pairs:
            messagebox.showwarning("No pairs", "Add at least one pair first.")
            return
        path = filedialog.asksaveasfilename(
            title="Save team", defaultextension=".txt", initialfile="team.txt",
            filetypes=[("Team file", "*.txt")])
        if not path:
            return
        lines = [" / ".join(soullink.format_mon(m["name"], m.get("nickname")) for m in pair)
                 for pair in self.pairs]
        soullink.write_team_file(Path(path), self.title_var.get().strip(),
                                 [self.p1_var.get().strip(), self.p2_var.get().strip()], lines)
        self.status.set(f"Saved team to {Path(path).name}")

    def clear_all(self):
        if self.pairs and messagebox.askyesno("Clear team", "Remove all pairs?"):
            self.pairs = []
            self.refresh_tree()
            self.save_state()

    # --- Generate ----------------------------------------------------------

    def generate(self):
        if not self.pairs:
            messagebox.showwarning("No pairs", "Add at least one pair first.")
            return
        out = filedialog.asksaveasfilename(
            title="Save team graphic", defaultextension=".png",
            initialfile="soul_link_team.png", filetypes=[("PNG image", "*.png")])
        if not out:
            return
        pairs = [tuple(self.to_mon(m) for m in pair) for pair in self.pairs]
        players = [self.p1_var.get().strip(), self.p2_var.get().strip()]
        players = players if any(players) else []
        title = self.title_var.get().strip()
        options = {}
        game = self.game()
        if game:
            options = {"trainers": [v.get() for v in self.trainer_vars], "link": self.link()}
            if game.wallpaper_category:
                options["wallpapers"] = [v.get() for v in self.wallpaper_vars]
        theme, sprites, sprite_game = self.theme(), self.sprites_var.get(), self.sprite_game()

        self.gen_button.config(state="disabled")
        self.status.set("Fetching artwork from Bulbapedia…")

        self.run_in_background(
            lambda: soullink.make_graphic(pairs, players, title, Path(out), theme=theme,
                                          sprites=sprites, sprite_game=sprite_game, **options),
            lambda _result, error: self._generated(out, error))

    def _generated(self, out, error):
        self.gen_button.config(state="normal")
        if error:
            self.status.set("Failed.")
            messagebox.showerror("Couldn't generate image", str(error))
            return
        self.status.set(f"Saved {out}")
        self.show_preview(out)

    def show_preview(self, path):
        win = tk.Toplevel(self)
        win.title(Path(path).name)
        img = Image.open(path)
        max_w = min(1400, self.winfo_screenwidth() - 100)
        max_h = self.winfo_screenheight() - 150
        scale = min(1, max_w / img.width, max_h / img.height)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
        photo = ImageTk.PhotoImage(img)
        label = ttk.Label(win, image=photo)
        label.image = photo  # keep a reference so Tk doesn't drop it
        label.pack()


if __name__ == "__main__":
    App().mainloop()

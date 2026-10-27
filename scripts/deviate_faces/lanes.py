"""Deviate Lanes: the one Ableton-native face. Live theme colours only (theme-bound section panels, native live.* widgets without colour
attributes, one `live_control_selection` accent), a 250 x 159 ignoreclick canvas of three scrolling level lanes (Transient / Body / Long)
and the meta cells in three rows that line up with the lanes. Device: `Deviate Lanes`."""
from . import _blocks as b  # noqa: F401  (kept for the contract; this face lays its cells out by hand)

NAME = "Lanes"

W = 548.0
LANE_Y0 = 19.0      # first lane top, device coordinates (canvas y 5 + 14)
LANE_PITCH = 47.0   # lane height 44 + 3 gap, canvas and meta rows share it
CELL_PITCH = 65.0
CELL_W = 62.0

# rows: lane T (transient), B (body), L (long); each cell is one meta (or Sens)
ROWS = [["snap", "grit", "sens"], ["pitch", "body", "motion"], ["space", "echo", "ring"]]
LABELS = {"snap": "Snap", "grit": "Grit", "sens": "Sens", "pitch": "Pitch", "body": "Body", "motion": "Motion", "space": "Space", "echo": "Echo",
          "ring": "Ring"}


def _rename(box, new_id):
    box["box"]["id"] = new_id
    box["box"]["varname"] = new_id
    return box


def layout(h):
    sc = h.sc
    controls, extra, panels, ptheme = [], [], [], []

    def theme_panel(pid, x, y, w, hh, name):
        p = sc.make_theme_panel(pid, x, y, w, hh, name)
        panels.append(p)
        ptheme.append([pid, name, list(sc.LIVE_THEME[name])])

    def section(sid, x, y, w, hh, title):
        panel, parts = sc.make_section(sid, x, y, w, hh, title)
        panels.append(panel)
        ptheme.append([f"obj-panel-{sid}", "live_desktop", list(sc.LIVE_THEME["live_desktop"])])
        _rename(parts[0], f"obj-lay-title-{sid}")
        _rename(parts[1], f"obj-lay-rule-{sid}")
        extra.extend(parts)

    def label(oid, text, x, y, w, size=8.5, name="live_lcd_title", align=0):
        extra.append(sc.make_theme_comment(oid, text, x, y, w, 12.0, size=size, name=name, align=align))

    # ---- sections (small panels first, body panel last)
    section("meta", 260, 4, 200, 161, "Draw")
    section("globals", 462, 4, 82, 161, "Globals")
    theme_panel("obj-panel-lanes", 4, 4, 254, 161, "live_desktop")  # the lanes canvas sits on it, no title (the canvas has its own header)
    panels.append(sc.make_body_panel(W))
    ptheme.append(["obj-panel-body", "live_surface_bg", list(sc.LIVE_THEME["live_surface_bg"])])

    # ---- meta cells: one row per lane, aligned with the canvas lanes
    for r, row in enumerate(ROWS):
        y0 = LANE_Y0 + r * LANE_PITCH
        for c, k in enumerate(row):
            x = 264.0 + c * CELL_PITCH
            label(f"obj-lay-lbl-{k}", LABELS[k], x, y0, 36.0)
            if k == "sens":
                controls.append(h.numbox("sens", x, y0 + 13.0, CELL_W, 15.0))
                continue
            controls.append(h.toggle(f"l_{k}", x + 36.0, y0, 26.0, 12.0, text="Lk"))
            label(f"obj-lay-v-{k}", "V", x, y0 + 15.0, 10.0, size=8.0)
            label(f"obj-lay-r-{k}", "R", x, y0 + 31.0, 10.0, size=8.0)
            controls.append(h.numbox(f"v_{k}", x + 11.0, y0 + 13.0, CELL_W - 11.0, 15.0, appearance=3 if k == "pitch" else 2))
            controls.append(h.numbox(f"r_{k}", x + 11.0, y0 + 29.0, CELL_W - 11.0, 15.0))

    # ---- globals
    gx = 466.0
    controls.append(h.dial("chance", gx, 23.0, 33.0, 42.0))
    controls.append(h.dial("mix", gx + 40.0, 23.0, 33.0, 42.0))
    controls.append(h.dial("drift", gx, 70.0, 33.0, 42.0))
    controls.append(h.button("reroll", gx + 40.0, 70.0, 33.0, 22.0, text="Reroll"))
    controls.append(h.menu("split", gx, 118.0, 73.0, 15.0))
    controls.append(h.menu("midi_in", gx, 137.0, 73.0, 15.0))
    controls.append(h.park(h.dial("thresh", 0, 0)))
    controls.append(h.park(h.dial("seed", 0, 0)))

    canvas = {"id": "obj-lay-lanes-viz", "files": ["deviate_face_lanes.js"], "rect": [6.0, 5.0, 250.0, 159.0], "role": "display", "ignoreclick": True,
              "keys": ["v_snap", "v_pitch", "v_body", "v_motion", "v_space", "v_echo", "v_grit", "v_ring", "chance", "split"]}
    return {"width": W, "controls": controls, "canvases": [canvas], "panels": panels, "panel_theme": ptheme, "theme": "ableton",
            "extra_boxes": extra, "extra_lines": [],
            "off_face": {"thresh": "detection threshold is set rarely; the panel has no room (automatable, in Live's parameter list)",
                         "seed": "the seed is a set-up choice; no room on the face (automatable, in Live's parameter list)"}}

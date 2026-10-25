#!/usr/bin/env python3
"""Render one preview per Amp+ face. The shipped device stays on Head."""

import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_ampplus
import render_preview
import spectral_common as sc


def main():
    paths = []
    for index in range(5):
        folder = tempfile.mkdtemp()
        path = os.path.join(folder, "Amp+.amxd")
        sc.write_amxd(build_ampplus.build_patcher(index), path)
        name = build_ampplus.look_layout(index)["name"].lower()
        paths.append(render_preview.render_device(path, out_suffix="_" + name))
        shutil.rmtree(folder)
    for path in paths:
        print(path)


if __name__ == "__main__":
    main()

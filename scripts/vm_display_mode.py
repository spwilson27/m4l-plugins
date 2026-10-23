#!/usr/bin/env python3
"""List / set the main display mode of the tart VM macos-1 (run IN the VM over ssh; AGENTS.md 1a).

  /usr/bin/python3 scripts/vm_display_mode.py            list modes (points x points, pixels, refresh), * = current
  /usr/bin/python3 scripts/vm_display_mode.py 1920 1080  switch to the mode with that point size (permanent: stays after reboot)

`tart set macos-1 --display WxH` only changes the virtual monitor; macOS keeps its chosen mode, so after
a resize the guest must be switched with this (CoreGraphics through ctypes, no extra tools needed).
"""
import ctypes
import ctypes.util
import sys

cg = ctypes.CDLL(ctypes.util.find_library("CoreGraphics"))
cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
vp = ctypes.c_void_p
cg.CGMainDisplayID.restype = ctypes.c_uint32
cg.CGDisplayCopyAllDisplayModes.restype = vp
cg.CGDisplayCopyAllDisplayModes.argtypes = [ctypes.c_uint32, vp]
cg.CGDisplayCopyDisplayMode.restype = vp
cg.CGDisplayCopyDisplayMode.argtypes = [ctypes.c_uint32]
for f in ("CGDisplayModeGetWidth", "CGDisplayModeGetHeight", "CGDisplayModeGetPixelWidth", "CGDisplayModeGetPixelHeight"):
    getattr(cg, f).restype = ctypes.c_size_t
    getattr(cg, f).argtypes = [vp]
cg.CGDisplayModeGetRefreshRate.restype = ctypes.c_double
cg.CGDisplayModeGetRefreshRate.argtypes = [vp]
cg.CGBeginDisplayConfiguration.argtypes = [ctypes.POINTER(vp)]
cg.CGConfigureDisplayWithDisplayMode.argtypes = [vp, ctypes.c_uint32, vp, vp]
cg.CGCompleteDisplayConfiguration.argtypes = [vp, ctypes.c_uint32]
cf.CFArrayGetCount.restype = ctypes.c_long
cf.CFArrayGetCount.argtypes = [vp]
cf.CFArrayGetValueAtIndex.restype = vp
cf.CFArrayGetValueAtIndex.argtypes = [vp, ctypes.c_long]


def desc(m):
    return (cg.CGDisplayModeGetWidth(m), cg.CGDisplayModeGetHeight(m), cg.CGDisplayModeGetPixelWidth(m),
            cg.CGDisplayModeGetPixelHeight(m), cg.CGDisplayModeGetRefreshRate(m))


def main(argv):
    d = cg.CGMainDisplayID()
    cur = desc(cg.CGDisplayCopyDisplayMode(d))
    arr = cg.CGDisplayCopyAllDisplayModes(d, None)
    modes = [cf.CFArrayGetValueAtIndex(arr, i) for i in range(cf.CFArrayGetCount(arr))]
    if len(argv) < 2:
        for m in modes:
            x = desc(m)
            print("%s %dx%d pt  %dx%d px  %.0f Hz" % ("*" if x == cur else " ", *x))
        return 0
    w, h = int(argv[0]), int(argv[1])
    hit = [m for m in modes if desc(m)[:2] == (w, h)]
    if not hit:
        print("no %dx%d mode; available:" % (w, h))
        return main([]) or 1
    hit.sort(key=lambda m: -desc(m)[2])  # prefer the HiDPI (largest pixel) variant
    cfg = vp()
    cg.CGBeginDisplayConfiguration(ctypes.byref(cfg))
    cg.CGConfigureDisplayWithDisplayMode(cfg, d, hit[0], None)
    rc = cg.CGCompleteDisplayConfiguration(cfg, 2)  # kCGConfigurePermanently
    print("set %dx%d pt (%dx%d px): rc %d" % (desc(hit[0])[:4] + (rc,)))
    return 1 if rc else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Live's Info View reads parameter_info. The Max annotation is a separate string.

Every live dial, number, slider, tab, menu, text button and gain control gets one
sentence in both places. A name alone is not a help string.
"""

LIVE_CONTROLS = {
    "live.dial",
    "live.numbox",
    "live.slider",
    "live.tab",
    "live.menu",
    "live.text",
    "live.gain~",
}

MIN_INFO = 12


def _boxes(doc):
    patcher = doc.get("patcher", doc)
    return patcher.get("boxes") or []


def stamp_parameter_info(doc):
    """Copy the longer of annotation and parameter_info into both. Raise if a control still has no sentence."""
    missing = []
    for wrap in _boxes(doc):
        box = wrap.get("box", wrap)
        if box.get("maxclass") not in LIVE_CONTROLS:
            continue
        attrs = box.get("saved_attribute_attributes") or {}
        valueof = attrs.get("valueof") if isinstance(attrs, dict) else None
        is_param = isinstance(valueof, dict) and "parameter_longname" in valueof
        info = (valueof.get("parameter_info") if is_param else "") or ""
        ann = box.get("annotation") or ""
        text = info.strip() if len(info.strip()) >= len(ann.strip()) else ann.strip()
        if is_param:
            if text:
                valueof["parameter_info"] = text
                box["annotation"] = text
            final = (valueof.get("parameter_info") or "").strip()
            name = (valueof.get("parameter_longname") or "").strip()
            if len(final) < MIN_INFO or final.lower() == name.lower():
                missing.append((box.get("id"), name, final))
        elif box.get("presentation") == 1 and not box.get("hidden"):
            if text:
                box["annotation"] = text
            final = (box.get("annotation") or "").strip()
            label = (box.get("text") or box.get("id") or "").strip()
            if len(final) < MIN_INFO or final.lower() == label.lower():
                missing.append((box.get("id"), label, final))
    if missing:
        lines = "\n".join("  %s %r %r" % row for row in missing)
        raise SystemExit("Live Info View text missing or shorter than a sentence:\n" + lines)
    return doc

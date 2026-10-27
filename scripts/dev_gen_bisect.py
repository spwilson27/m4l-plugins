#!/usr/bin/env python3
"""Developer tool: bisect a gen~ compile failure of the Deviate core in the VM (a gen that fails to compile outputs zeros).
Builds variants of the gen text (the first K top-level statements of the main body, then `out1 = in1; out2 = in2;`), runs the
mix0_null case in the VM with DEVIATE_GEN_FILE and reports whether the output has signal.   python3 scripts/dev_gen_bisect.py [lo hi]"""
import os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_deviate as b

def split_top(text):
    """(declarations/functions, [top-level statements of the main body])"""
    lines = text.split("\n")
    # main body starts at the first line `sr = max(samplerate, 1);`
    i0 = next(i for i, l in enumerate(lines) if l.startswith("sr = max(samplerate"))
    head = "\n".join(lines[:i0]); body = lines[i0:]
    chunks, cur, depth = [], [], 0
    for l in body:
        cur.append(l)
        depth += l.count("{") - l.count("}")
        if depth == 0 and l.strip() and not l.strip().startswith("//") and (l.rstrip().endswith(";") or l.rstrip().endswith("}")):
            chunks.append("\n".join(cur)); cur = []
    if cur: chunks.append("\n".join(cur))
    return head, chunks

def variant(k, head, chunks):
    return head + "\n" + "\n".join(chunks[:k]) + "\nout1 = in1;\nout2 = in2;\n"

def run(text, tag):
    path = os.path.join(ROOT, "build_cache", "variant.genexpr")
    open(path, "w").write(text)
    env = dict(os.environ, M4L_VM_DIR="deviate/bisect")
    subprocess.run([os.path.join(ROOT, "scripts", "vm_deviate.sh"), "sync"], env=env, check=True, capture_output=True)
    ip = subprocess.check_output("tart ip macos-1", shell=True, text=True).strip()
    cmd = ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", f"admin@{ip}",
           "cd ~/deviate/bisect && DEVIATE_GEN_FILE=build_cache/variant.genexpr /usr/bin/python3 scripts/run_deviate_audio_tests.py mix0_null"]
    out = subprocess.run(cmd, env=dict(os.environ, SSHPASS="admin"), capture_output=True, text=True).stdout
    m = re.search(r"mix0_null_w1 ---\n\s+nan=\S+ maxL=(\S+)", out)
    ml = float(m.group(1)) if m else -1
    print(f"{tag}: maxL={ml}", flush=True)
    return ml

if __name__ == "__main__":
    text = b.gen_code()
    head, chunks = split_top(text)
    print(len(chunks), "chunks")
    lo, hi = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (0, len(chunks))
    if run(variant(0, head, chunks), "k=0 (declarations only)") <= 0:
        print("even the declarations fail to compile"); sys.exit(1)
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if run(variant(mid, head, chunks), f"k={mid}") > 0: lo = mid
        else: hi = mid
    print(f"first failing chunk index {lo} (k={hi}):\n" + chunks[lo])

#!/usr/bin/env python3
import argparse, json, os, re, subprocess, sys
from typing import List, Dict, Any, Optional, Tuple

BAR_RE = re.compile(r"\bLOWER\b.*\bAVERAGE\b.*\bHIGHER\b", re.IGNORECASE)
GENRE_RE = re.compile(r"^\s*Genre\s*:\s*(.+)\s*$", re.IGNORECASE)
MFR_DATE_RE = re.compile(r"^\s*([^,]{2,80})\s*,\s*(.+?)\s*$")
YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")

def prev_nonempty_idx(lines, start, max_scan=30):
    j = start - 1
    scanned = 0
    while j >= 0 and scanned < max_scan:
        if lines[j].strip():
            return j
        j -= 1
        scanned += 1
    return None

def next_nonempty_lines(lines, start, max_needed=12, max_scan=60):
    out = []
    j = start + 1
    scanned = 0
    while j < len(lines) and scanned < max_scan and len(out) < max_needed:
        t = lines[j].strip()
        if t:
            out.append(t)
        j += 1
        scanned += 1
    return out

def find_prices_forward(lines, start_idx, max_scan=60):
    """
    Look forward from start_idx for the first occurrence of 3 integers.
    Works whether the "LOWER AVERAGE HIGHER" line is present or not.
    """
    j = start_idx + 1
    scanned = 0
    while j < len(lines) and scanned < max_scan:
        t = lines[j].strip()
        if t:
            nums = re.findall(r"\b\d{2,5}\b", t)
            if len(nums) >= 3:
                lo, av, hi = map(int, nums[:3])
                return lo, av, hi
        j += 1
        scanned += 1
    return None, None, None

def run_tesseract_text(image_path: str, psm: int = 6) -> str:
    # preprocess to help digits
    tmp = f"/tmp/ocr_pre_{os.getpid()}.png"
    subprocess.run([
        "convert", image_path,
        "-colorspace", "Gray",
        "-contrast-stretch", "0.5%x0.5%",
        "-sharpen", "0x1",
        tmp
    ], check=True)

    cmd = ["tesseract", tmp, "stdout", "--oem", "1", "--psm", str(psm)]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        return out.decode("utf-8", errors="replace")
    finally:
        try: os.remove(tmp)
        except: pass

def normalize_lines(text: str) -> List[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # keep blanks (for debugging), but also make a stripped version
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    return lines

def get_prev_nonempty(lines: List[str], idx: int, count: int, max_scan: int = 20) -> List[str]:
    """Collect up to `count` non-empty lines above idx, scanning up to max_scan lines."""
    out = []
    i = idx - 1
    scanned = 0
    while i >= 0 and scanned < max_scan and len(out) < count:
        if lines[i].strip():
            out.append(lines[i].strip())
        i -= 1
        scanned += 1
    out.reverse()
    return out

def get_next_nonempty(lines: List[str], idx: int, count: int, max_scan: int = 20) -> List[str]:
    out = []
    i = idx + 1
    scanned = 0
    while i < len(lines) and scanned < max_scan and len(out) < count:
        if lines[i].strip():
            out.append(lines[i].strip())
        i += 1
        scanned += 1
    return out

def parse_entry(header_lines: List[str]) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """
    Expected (typical):
      title
      manufacturer, date
      type
      Genre: ...
    But OCR can drop/insert a line. We'll be flexible:
      - title = first line
      - manufacturer/date = first line that matches "X, Y" with a year somewhere in Y
      - type = line between mfr/date and genre (if any)
      - genre = from "Genre:" line
    """
    title = header_lines[0] if header_lines else None
    manufacturer = None
    date = None
    type_ = None
    genre = None

    # genre
    for ln in header_lines:
        m = GENRE_RE.match(ln)
        if m:
            genre = m.group(1).strip()

    # manufacturer/date
    mfr_idx = None
    for i, ln in enumerate(header_lines):
        m = MFR_DATE_RE.match(ln)
        if m and YEAR_RE.search(m.group(2)):
            manufacturer = m.group(1).strip()
            date = m.group(2).strip()
            mfr_idx = i
            break

    # type: line after mfr/date up to genre line
    if mfr_idx is not None:
        for j in range(mfr_idx + 1, len(header_lines)):
            if GENRE_RE.match(header_lines[j]):
                break
            # pick the first non-genre line after mfr/date as type
            if header_lines[j].strip():
                type_ = header_lines[j].strip()
                break

    return title, manufacturer, date, type_, genre

def parse_prices(after_lines: List[str]) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    # Search a few lines for 3 integers (prices)
    for ln in after_lines:
        nums = re.findall(r"\b\d{2,5}\b", ln)
        if len(nums) >= 3:
            lo, av, hi = map(int, nums[:3])
            return lo, av, hi
    return None, None, None

def find_prev_genre_index(lines: List[str], idx: int, max_scan: int = 60) -> Optional[int]:
    j = idx - 1
    scanned = 0
    while j >= 0 and scanned < max_scan:
        if GENRE_RE.match(lines[j].strip()):
            return j
        j -= 1
        scanned += 1
    return None

def nearest_nonempty_above(lines: List[str], idx: int, max_scan: int = 30) -> Optional[int]:
    j = idx - 1
    scanned = 0
    while j >= 0 and scanned < max_scan:
        if lines[j].strip():
            return j
        j -= 1
        scanned += 1
    return None

def extract_entries_by_genre(lines: List[str], image_name: str) -> List[Dict[str, Any]]:
    entries = []

    for i, ln in enumerate(lines):
        mgenre = GENRE_RE.match(ln.strip())
        if not mgenre:
            continue

        genre = mgenre.group(1).strip()

        # Type = nearest non-empty line above Genre
        type_idx = prev_nonempty_idx(lines, i)
        type_ = lines[type_idx].strip() if type_idx is not None else None

        # Manufacturer/date = nearest "X, Y" w/ year above type
        manufacturer = None
        date = None
        mfr_idx = None
        scan_from = type_idx if type_idx is not None else i
        for j in range(scan_from - 1, max(-1, scan_from - 20), -1):
            t = lines[j].strip()
            mm = MFR_DATE_RE.match(t)
            if mm and YEAR_RE.search(mm.group(2)):
                manufacturer = mm.group(1).strip()
                date = mm.group(2).strip()
                mfr_idx = j
                break

        # Title = nearest non-empty line above manufacturer/date
        title = None
        if mfr_idx is not None:
            t_idx = prev_nonempty_idx(lines, mfr_idx)
            title = lines[t_idx].strip() if t_idx is not None else None

        # Prices = first 3-integer line after Genre (or after type/genre area)
        lo, av, hi = find_prices_forward(lines, i, max_scan=80)

        # Sanity: title + manufacturer + genre are required
        if not title or not manufacturer:
            continue

        # Avoid accidentally treating “Note:” lines as titles
        if title.lower().startswith("note:"):
            continue

        entries.append({
            "image": image_name,
            "title": title,
            "manufacturer": manufacturer,
            "date": date,
            "type": type_,
            "genre": genre,
            "price_lower": lo,
            "price_average": av,
            "price_higher": hi
        })

    return entries

def main():
    ap = argparse.ArgumentParser(description="Extract arcade entries by locating LOWER/AVERAGE/HIGHER bars in OCR text.")
    ap.add_argument("images", nargs="+", help="Input image files (jpg/png)")
    ap.add_argument("--psm", type=int, default=6, help="Tesseract PSM (try 4, 6, 11)")
    ap.add_argument("--debug-text", action="store_true", help="Print OCR text to stderr for debugging")
    args = ap.parse_args()

    all_entries: List[Dict[str, Any]] = []

    for img in args.images:
        base = os.path.basename(img)
        if not os.path.exists(img):
            all_entries.append({"image": base, "error": "missing file"})
            continue

        txt = run_tesseract_text(img, psm=args.psm)
        if args.debug_text:
            print(f"\n===== OCR TEXT: {base} =====\n{txt}\n", file=sys.stderr)

        lines = normalize_lines(txt)
        entries = extract_entries_by_genre(lines, base)
        all_entries.extend(entries)

    print(json.dumps(all_entries, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()

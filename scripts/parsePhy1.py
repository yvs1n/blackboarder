"""
Script to parse syllabus/phy1.pdf when added by user and update Physics 1 weights.
Usage: python scripts/parsePhy1.py
"""

import os
import sys
import re

try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF (fitz) is required. Install via: pip install pymupdf")
    sys.exit(1)

PDF_PATH = os.path.join(os.path.dirname(__file__), "..", "syllabus", "phy1.pdf")
WEIGHTS_TS_PATH = os.path.join(os.path.dirname(__file__), "..", "src", "utils", "syllabusWeights.ts")

def main():
    if not os.path.exists(PDF_PATH):
        print(f"File not found: {PDF_PATH}")
        print("Please place your Physics 1 syllabus file in the 'syllabus/' directory as 'phy1.pdf' and re-run.")
        sys.exit(1)

    print(f"Reading {PDF_PATH}...")
    doc = fitz.open(PDF_PATH)
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"

    print(f"Extracted {len(full_text)} characters from {len(doc)} pages.")

    # Look for assessment table lines
    lines = full_text.splitlines()
    assessments = []

    for i, line in enumerate(lines):
        # Look for lines mentioning percentages
        match = re.search(r'([A-Za-z\s\(\)]+)\s+(\d{1,2})\s*%', line)
        if match:
            item_name = match.group(1).strip()
            item_pct = int(match.group(2))
            if 0 < item_pct <= 100:
                assessments.append((item_name, item_pct))

    print("\nDetected potential grade distributions:")
    for name, pct in assessments:
        print(f"  - {name}: {pct}%")

    print("\nPhysics 1 syllabus reader ready.")

if __name__ == "__main__":
    main()

import fitz
import os

svg_calendar_check = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Rounded App Squircle: UOS Deep Royal Blue -->
  <rect x="0" y="0" width="512" height="512" rx="115" fill="#1e40af"/>
  <rect x="8" y="8" width="496" height="496" rx="107" fill="none" stroke="#60a5fa" stroke-width="3" stroke-opacity="0.35"/>

  <!-- Calendar Card Surface (Crisp White Card) -->
  <rect x="88" y="96" width="336" height="336" rx="32" fill="#ffffff"/>

  <!-- Top Red/Coral Header Bar (Deadline Urgency) -->
  <path d="M88 128 C88 110.3 102.3 96 120 96 L392 96 C409.7 96 424 110.3 424 128 L424 176 L88 176 Z" fill="#ef4444"/>

  <!-- Binder Rings (White / Slate) -->
  <rect x="160" y="74" width="28" height="46" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4"/>
  <rect x="324" y="74" width="28" height="46" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4"/>

  <!-- Checklist Grid Rows (Indigo Tint) -->
  <rect x="136" y="216" width="180" height="18" rx="9" fill="#818cf8" opacity="0.85"/>
  <rect x="136" y="260" width="140" height="18" rx="9" fill="#818cf8" opacity="0.85"/>
  <rect x="136" y="304" width="156" height="18" rx="9" fill="#818cf8" opacity="0.85"/>
  <rect x="136" y="348" width="110" height="18" rx="9" fill="#818cf8" opacity="0.85"/>

  <!-- Completed Checkmark Badge (Emerald Green #10b981) -->
  <circle cx="348" cy="336" r="46" fill="#10b981"/>
  <polyline points="328,336 342,350 370,322" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""

# Save source SVG
os.makedirs("assets", exist_ok=True)
with open("assets/logo.svg", "w", encoding="utf-8") as f:
    f.write(svg_calendar_check)
print("Saved assets/logo.svg")

doc = fitz.open(stream=svg_calendar_check.encode('utf-8'), filetype='svg')
page = doc[0]

# Targets to render
targets = [
    ("assets/logo.png", 512),
    ("public/icons/icon16.png", 16),
    ("public/icons/icon32.png", 32),
    ("public/icons/icon48.png", 48),
    ("public/icons/icon128.png", 128),
    ("dist/icons/icon16.png", 16),
    ("dist/icons/icon32.png", 32),
    ("dist/icons/icon48.png", 48),
    ("dist/icons/icon128.png", 128),
    ("mobile-web/icon-192.png", 192),
    ("mobile-web/icon-512.png", 512),
]

for file_path, size in targets:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    scale = size / 512.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
    pix.save(file_path)
    print(f"Rendered {file_path} ({size}x{size})")

#!/usr/bin/env bash
# Texts: English (resources) and German (resources-deu) have the same ids and the same
# placeholders, no text is empty, and no screen text is a fixed string in the code.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$APP_DIR" <<'PY'
import re, sys, pathlib
app = pathlib.Path(sys.argv[1])
def load(p):
    return dict(re.findall(r'<string id="([^"]*)">(.*?)</string>', p.read_text(encoding="utf-8"), re.S))
en = load(app / "resources/strings/strings.xml")
de = load(app / "resources-deu/strings/strings.xml")
errors = []
for k in sorted(set(en) ^ set(de)):
    errors.append(f"Text {k} gibt es nur in {'eng' if k in en else 'deu'}")
for k in sorted(set(en) & set(de)):
    if not en[k].strip() or not de[k].strip():
        errors.append(f"Text {k} ist leer")
    if sorted(re.findall(r'\$\d\$', en[k])) != sorted(re.findall(r'\$\d\$', de[k])):
        errors.append(f"Text {k}: Platzhalter in eng und deu verschieden")
# Fixed strings in screen code: a text passed straight to a line, menu item, dialog or drawText.
pattern = re.compile(r'(PairingLine\(|MenuItem\(|Confirmation\(|drawText\([^;]*?,\s*)"[^"]*[A-Za-zÄÖÜäöüß][^"]*"')
for f in sorted((app / "source").rglob("*.mc")):
    if f.name.startswith("Debug"):
        continue
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        code = line.split("//")[0]
        if pattern.search(code):
            errors.append(f"{f.relative_to(app)}:{n}: fester Text im Code")
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"Texte ok: {len(en)} Texte in eng und deu, Platzhalter gleich, keine festen Texte im Code")
PY

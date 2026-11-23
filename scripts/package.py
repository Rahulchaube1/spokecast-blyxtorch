"""Create a portable SpokeCast source bundle for the website's download link."""
from pathlib import Path
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "dist/spokecast-project.zip"


def main():
    sources = [ROOT / "README.md", ROOT / ".gitignore"]
    for directory in ("model", "scripts", "dist"):
        sources.extend(p for p in (ROOT / directory).rglob("*")
                       if p.is_file() and p != DEST and "__pycache__" not in p.parts)
    with tempfile.TemporaryDirectory(dir=ROOT) as temp:
        archive = Path(temp) / DEST.name
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for source in sorted(sources):
                name = "spokecast/" + source.relative_to(ROOT).as_posix()
                if source == ROOT / "dist/index.html":
                    # The downloaded copy already contains the complete project.
                    html = re.sub(r'<a class="export source-link"[^>]*>.*?</a>', "", source.read_text(), count=1)
                    bundle.writestr(name, html)
                else:
                    bundle.write(source, name)
        with zipfile.ZipFile(archive) as bundle:
            assert bundle.testzip() is None
        archive.replace(DEST)


if __name__ == "__main__":
    main()

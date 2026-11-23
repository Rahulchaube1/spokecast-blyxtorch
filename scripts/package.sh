#!/bin/sh
# Ship a standalone copy with the same source, site and training order.
set -eu
stage=$(mktemp -d .build/bundle.XXXXXX)
trap 'rm -rf "$stage"' EXIT
project="$stage/spokecast"
mkdir -p "$project/dist"
cp README.md Makefile main.blyx .gitignore .vercelignore vercel.json "$project/"
cp -R model scripts wasm experiments "$project/"
cp -R dist/assets dist/app.js dist/style.css dist/model.wasm dist/metrics.json "$project/dist/"
# The download button is unnecessary inside the already-downloaded project.
sed -E 's#<a class="export source-link"[^>]*>.*</a></div>$#</div>#' dist/index.html > "$project/dist/index.html"
(cd "$stage" && zip -q -X -r bundle.zip spokecast)
unzip -tq "$stage/bundle.zip" >/dev/null
mv "$stage/bundle.zip" dist/spokecast-project.zip

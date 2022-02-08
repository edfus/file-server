#!/bin/sh
intermediateignore=".ignored-1-$RANDOM"
intermediatepackagejson=".ignored-2-$RANDOM"
cp .npmignore "$intermediateignore"
cp package.json "$intermediatepackagejson"

cat>>.npmignore<<'eof'

bin
img
lib
eof

node -e 'const p = require("./package.json"); delete p.bin; delete p.dependencies.prompts; fs.writeFileSync("package.json", JSON.stringify(p, null, 2), "utf-8")'

npm publish --tag interface

mv "$intermediateignore" .npmignore
mv "$intermediatepackagejson" package.json
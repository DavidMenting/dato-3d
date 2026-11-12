#!/bin/zsh
# Pipeline steps 3 + 4: FBX → build/<product>.glb + motion.json → public/models/
#   scripts/build-model.sh drum "cad/Dato+DRUM+1.0.fbx"
set -e
cd "${0:A:h}/.."
product=${1:-drum}
fbx=${2:-cad/Dato+DRUM+1.0.fbx}
/opt/homebrew/bin/blender -b --factory-startup -P scripts/annotate-3d.py -- "${fbx}" "${product}" \
  | grep -vE '^[0-9:]+ \| INFO|^$'
# Keep every named node: no join / flatten / instance / simplify / palette.
~/.local/bin/gltf-transform optimize "build/${product}.glb" "public/models/${product}.glb" \
  --join false --flatten false --instance false --simplify false --palette false \
  --compress meshopt
cp "build/${product}-motion.json" "public/models/${product}-motion.json"
ls -lh public/models/

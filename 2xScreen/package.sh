#!/bin/bash
ZIP_NAME="2xscreen_upload.zip"
rm -f "$ZIP_NAME"

TEMP_DIR="temp_package"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Copiar archivos base
cp -r background.js content.js content.css icons/ "$TEMP_DIR/"
[ -f editor.html ] && cp editor.html "$TEMP_DIR/"
[ -f editor.js ] && cp editor.js "$TEMP_DIR/"
[ -f editor.css ] && cp editor.css "$TEMP_DIR/"

# Remover "key" del manifest de forma segura usando python3
python3 -c "import json; d=json.load(open('manifest.json')); d.pop('key', None); json.dump(d, open('$TEMP_DIR/manifest.json', 'w'), indent=2)"

# Empaquetar
cd "$TEMP_DIR" || exit
zip -r "../$ZIP_NAME" *
cd ..

rm -rf "$TEMP_DIR"
echo "Archivo $ZIP_NAME empaquetado con éxito (sin la propiedad 'key') y listo para subir a la Chrome Web Store."

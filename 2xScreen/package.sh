#!/bin/bash
ZIP_NAME="2xscreen_upload.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" manifest.json background.js content.js content.css editor.html editor.js editor.css icons/ -x "*.git*"
echo "Archivo $ZIP_NAME empaquetado con éxito y listo para subir a la Chrome Web Store / Edge Add-ons."

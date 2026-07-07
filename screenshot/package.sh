#!/bin/bash
ZIP_NAME="screenshot_upload.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" manifest.json background.js editor.html editor.js editor.css icon16.png icon48.png icon128.png -x "*.git*"
echo "Archivo $ZIP_NAME empaquetado con éxito y listo para subir a la Chrome Web Store / Edge Add-ons."

#!/bin/bash
ZIP_NAME="videoplayer_upload.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" manifest.json background.js videoplayer.html videoplayer.js video-style.css theme.css theme.js hls.js icon16.png icon48.png icon128.png favicon.png -x "*.git*"
echo "Archivo $ZIP_NAME empaquetado con éxito y listo para subir a la Chrome Web Store / Edge Add-ons."

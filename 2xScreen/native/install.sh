#!/bin/bash
# Script instalador del host de Native Messaging en Linux

# 1. Obtener la ruta del directorio del script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HELPER_JSON="$DIR/com.merke.twoxscreen.json"
HELPER_PY="$DIR/twoxscreen_helper.py"

# Asegurar permisos de ejecución para los archivos
chmod +x "$HELPER_PY"
chmod +x "${BASH_SOURCE[0]}"

# 2. Rutas de instalación de navegadores para Native Messaging
CHROME_TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_TARGET_DIR="$HOME/.config/chromium/NativeMessagingHosts"
EDGE_TARGET_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
EDGE_BETA_TARGET_DIR="$HOME/.config/microsoft-edge-beta/NativeMessagingHosts"
EDGE_DEV_TARGET_DIR="$HOME/.config/microsoft-edge-dev/NativeMessagingHosts"

install_host() {
    local target_dir="$1"
    local browser_name="$2"
    
    mkdir -p "$target_dir"
    cp "$HELPER_JSON" "$target_dir/com.merke.twoxscreen.json"
    
    # Asegurar permisos correctos en el directorio destino
    chmod 755 "$target_dir"
    chmod 644 "$target_dir/com.merke.twoxscreen.json"
    
    echo "Host nativo registrado con éxito para $browser_name."
}

# Instalar para Google Chrome
if [ -d "$HOME/.config/google-chrome" ] || [ ! -d "$HOME/.config/chromium" ]; then
    install_host "$CHROME_TARGET_DIR" "Google Chrome"
fi

# Instalar para Chromium
if [ -d "$HOME/.config/chromium" ]; then
    install_host "$CHROMIUM_TARGET_DIR" "Chromium"
fi

# Instalar para Microsoft Edge
if [ -d "$HOME/.config/microsoft-edge" ]; then
    install_host "$EDGE_TARGET_DIR" "Microsoft Edge"
fi

# Instalar para Microsoft Edge Beta
if [ -d "$HOME/.config/microsoft-edge-beta" ]; then
    install_host "$EDGE_BETA_TARGET_DIR" "Microsoft Edge Beta"
fi

# Instalar para Microsoft Edge Dev
if [ -d "$HOME/.config/microsoft-edge-dev" ]; then
    install_host "$EDGE_DEV_TARGET_DIR" "Microsoft Edge Dev"
fi

echo "Instalación de Native Messaging Host completada con éxito."

#!/usr/bin/env python3
import sys
import json
import struct
import subprocess
import platform
import os

def log_debug(msg):
    try:
        log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "helper_debug.log")
        lines = []
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        lines.append(msg + "\n")
        if len(lines) > 100:
            lines = lines[-100:]
        with open(log_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    except Exception as e:
        sys.stderr.write(f"Error escribiendo log: {e}\n")

def send_message(message):
    try:
        encoded = json.dumps(message).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.flush()
    except Exception as e:
        log_debug(f"Error enviando mensaje a Chrome: {e}")

def read_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(length).decode('utf-8')
        return json.loads(message)
    except Exception as e:
        log_debug(f"Error leyendo mensaje de Chrome: {e}")
        return None

def undecorate_linux(window_title):
    log_debug(f"Iniciando undecorate_linux para título: '{window_title}'")
    try:
        import re
        # 1. Obtener la lista de todas las ventanas del sistema mediante xprop
        res = subprocess.run(["xprop", "-root", "_NET_CLIENT_LIST"], capture_output=True, text=True)
        if res.returncode != 0:
            log_debug(f"xprop -root falló con retorno: {res.returncode}. Stderr: {res.stderr}")
            return False
            
        # Extraer los IDs de ventana en formato hexadecimal (por ejemplo, 0x3c00010)
        window_ids = re.findall(r"0x[0-9a-fA-F]+", res.stdout)
        log_debug(f"IDs de ventana encontrados en _NET_CLIENT_LIST: {window_ids}")
        
        success = False
        for win_id in window_ids:
            # 2. Consultar el título de la ventana
            for prop in ["WM_NAME", "_NET_WM_NAME"]:
                prop_res = subprocess.run(["xprop", "-id", win_id, prop], capture_output=True, text=True)
                if prop_res.returncode == 0:
                    title_content = prop_res.stdout.strip()
                    if window_title in title_content:
                        log_debug(f"¡Coincidencia encontrada! ID: {win_id}, Prop: {prop}, Contenido: '{title_content}'")
                        
                        # Intentar remover decoraciones usando _MOTIF_WM_HINTS
                        xprop_cmd = [
                            "xprop",
                            "-f", "_MOTIF_WM_HINTS", "32c",
                            "-set", "_MOTIF_WM_HINTS", "2,0,0,0,0",
                            "-id", win_id
                        ]
                        sub_res = subprocess.run(xprop_cmd, capture_output=True, text=True)
                        log_debug(f"Ejecutando xprop para quitar decoraciones en {win_id}. Retorno: {sub_res.returncode}. Stderr: {sub_res.stderr}")
                        if sub_res.returncode == 0:
                            success = True
                        break
        if not success:
            log_debug("No se encontró ninguna ventana que coincida con el título temporal.")
        return success
    except Exception as e:
        log_debug(f"Fallo en undecorate para Linux: {e}")
    return False

def undecorate_windows(window_title):
    log_debug(f"Iniciando undecorate_windows para título: '{window_title}'")
    try:
        import ctypes
        hwnd = ctypes.windll.user32.FindWindowW(None, window_title)
        if hwnd:
            log_debug(f"Ventana de Windows encontrada. HWND: {hwnd}")
            style = ctypes.windll.user32.GetWindowLongW(hwnd, -16)
            style &= ~0x00C00000  # WS_CAPTION
            style &= ~0x00040000  # WS_THICKFRAME
            ctypes.windll.user32.SetWindowLongW(hwnd, -16, style)
            ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0, 0x0027)
            log_debug("Estilos de Windows aplicados correctamente.")
            return True
        log_debug("No se encontró ventana con ese título en Windows.")
    except Exception as e:
        log_debug(f"Fallo en undecorate para Windows: {e}")
    return False

def main():
    log_debug("=== Helper de 2xScreen Iniciado ===")
    
    while True:
        msg = read_message()
        if msg is None:
            log_debug("Conexión cerrada o mensaje nulo recibido. Saliendo.")
            break
            
        action = msg.get("action")
        window_title = msg.get("title")
        log_debug(f"Acción recibida: '{action}', Título: '{window_title}'")
        
        success = False
        if action == "undecorate" and window_title:
            current_os = platform.system().lower()
            if "linux" in current_os:
                success = undecorate_linux(window_title)
            elif "windows" in current_os:
                success = undecorate_windows(window_title)
            else:
                log_debug(f"SO no compatible: {current_os}")
                
        send_message({"success": success})
        log_debug(f"Respuesta enviada a Chrome: success={success}")

if __name__ == "__main__":
    main()

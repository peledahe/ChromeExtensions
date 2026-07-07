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
        log_debug(f"Error enviando mensaje: {e}")

def read_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(length).decode('utf-8')
        return json.loads(message)
    except Exception as e:
        log_debug(f"Error leyendo mensaje: {e}")
        return None

def undecorate_linux(window_title):
    try:
        import re
        res = subprocess.run(["xprop", "-root", "_NET_CLIENT_LIST"], capture_output=True, text=True)
        if res.returncode != 0:
            return False
        window_ids = re.findall(r"0x[0-9a-fA-F]+", res.stdout)
        success = False
        for win_id in window_ids:
            for prop in ["WM_NAME", "_NET_WM_NAME"]:
                prop_res = subprocess.run(["xprop", "-id", win_id, prop], capture_output=True, text=True)
                if prop_res.returncode == 0:
                    title_content = prop_res.stdout.strip()
                    if window_title in title_content:
                        xprop_cmd = ["xprop", "-f", "_MOTIF_WM_HINTS", "32c", "-set", "_MOTIF_WM_HINTS", "2,0,0,0,0", "-id", win_id]
                        sub_res = subprocess.run(xprop_cmd, capture_output=True, text=True)
                        if sub_res.returncode == 0:
                            success = True
                        break
        return success
    except Exception as e:
        log_debug(f"Error en undecorate Linux: {e}")
    return False

def undecorate_windows(window_title):
    try:
        import ctypes
        hwnd = ctypes.windll.user32.FindWindowW(None, window_title)
        if hwnd:
            style = ctypes.windll.user32.GetWindowLongW(hwnd, -16)
            style &= ~0x00C00000  # WS_CAPTION
            style &= ~0x00040000  # WS_THICKFRAME
            ctypes.windll.user32.SetWindowLongW(hwnd, -16, style)
            ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0, 0x0027)
            return True
    except Exception as e:
        log_debug(f"Error en undecorate Windows: {e}")
    return False

def register_extension_id(ext_id):
    if not ext_id or not isinstance(ext_id, str) or not ext_id.isalnum():
        return False
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    local_json = os.path.join(script_dir, "com.merke.twoxscreen.json")
    paths = [local_json]
    
    if "linux" in platform.system().lower():
        home = os.path.expanduser("~")
        linux_paths = [
            os.path.join(home, ".config/google-chrome/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/chromium/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge-beta/NativeMessagingHosts/com.merke.twoxscreen.json"),
            os.path.join(home, ".config/microsoft-edge-dev/NativeMessagingHosts/com.merke.twoxscreen.json"),
        ]
        paths.extend(linux_paths)
        
    success = False
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                allowed = data.get("allowed_origins", [])
                origin = f"chrome-extension://{ext_id}/"
                if origin not in allowed:
                    allowed.append(origin)
                    data["allowed_origins"] = allowed
                    with open(path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                    success = True
                else:
                    success = True
            except Exception as e:
                log_debug(f"Error registrando en {path}: {e}")
    return success

def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        action = msg.get("action")
        success = False
        if action == "ping":
            success = True
        elif action == "register_id":
            success = register_extension_id(msg.get("id"))
        elif action == "undecorate":
            window_title = msg.get("title")
            if window_title:
                current_os = platform.system().lower()
                if "linux" in current_os:
                    success = undecorate_linux(window_title)
                elif "windows" in current_os:
                    success = undecorate_windows(window_title)
        send_message({"success": success})

if __name__ == "__main__":
    main()

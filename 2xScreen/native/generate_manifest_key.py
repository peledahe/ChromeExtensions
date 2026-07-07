#!/usr/bin/env python3
import os
import json
import base64
import hashlib
import subprocess

def main():
    native_dir = os.path.dirname(os.path.abspath(__file__))
    ext_dir = os.path.dirname(native_dir)
    
    manifest_path = os.path.join(ext_dir, "manifest.json")
    key_pem_path = os.path.join(native_dir, "key.pem")
    
    print("Generando clave privada RSA...")
    # Generar la clave privada pkcs8
    try:
        subprocess.run(["openssl", "genrsa", "-out", key_pem_path, "2048"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f"Error llamando a openssl: {e}")
        return
        
    print("Extrayendo clave pública...")
    # Extraer la clave pública en formato DER (sin cabeceras)
    try:
        res = subprocess.run(
            ["openssl", "rsa", "-in", key_pem_path, "-pubout", "-outform", "DER"],
            capture_output=True, check=True
        )
        der_bytes = res.stdout
    except Exception as e:
        print(f"Error extrayendo clave publica DER: {e}")
        return
        
    # Codificar a Base64 de una sola línea (lo que va en el manifest.json)
    pubkey_base64 = base64.b64encode(der_bytes).decode('utf-8')
    
    # Calcular el ID de la extensión de Chrome
    # SHA-256 de los bytes DER, luego los primeros 32 caracteres mapeados de 0-f a a-p
    sha = hashlib.sha256(der_bytes).hexdigest()
    translation = str.maketrans("0123456789abcdef", "abcdefghijklmnop")
    extension_id = sha[:32].translate(translation)
    
    print(f"ID autocalculado de la extensión: {extension_id}")
    
    # 1. Modificar manifest.json para insertar la clave fija ("key")
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
            
        manifest["key"] = pubkey_base64
        
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print("Clave 'key' inyectada en manifest.json.")
    else:
        print("Error: manifest.json no encontrado.")
        return
        
    # 2. Generar el archivo de manifiesto del host com.merke.twoxscreen.json
    helper_path = os.path.join(native_dir, "twoxscreen_helper.py")
    
    allowed_origins = [
        f"chrome-extension://{extension_id}/",
        "chrome-extension://gnjddnfmlhjmmglbhalfcckcplmcdkaf/",
        "chrome-extension://ihbfgcligcckngjlbjccjjojmpepajin/"
    ]
    
    allowed_ids_path = os.path.join(native_dir, "allowed_ids.json")
    if os.path.exists(allowed_ids_path):
        try:
            with open(allowed_ids_path, "r", encoding="utf-8") as f:
                config_data = json.load(f)
                for aid in config_data.get("allowed_ids", []):
                    origin = f"chrome-extension://{aid}/"
                    if origin not in allowed_origins:
                        allowed_origins.append(origin)
        except Exception as e:
            print(f"Error leyendo allowed_ids.json: {e}")

    host_manifest = {
        "name": "com.merke.twoxscreen",
        "description": "Helper nativo de 2xScreen para quitar bordes de ventana",
        "path": helper_path,
        "type": "stdio",
        "allowed_origins": allowed_origins
    }
    
    manifest_host_path = os.path.join(native_dir, "com.merke.twoxscreen.json")
    with open(manifest_host_path, "w", encoding="utf-8") as f:
        json.dump(host_manifest, f, indent=2)
        
    print(f"Manifiesto del host de Native Messaging creado en {manifest_host_path}")
    print("Proceso de inicialización de claves nativas finalizado con éxito.")

if __name__ == "__main__":
    main()

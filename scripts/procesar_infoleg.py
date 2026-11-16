import base64
import json
import os
import re
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
import pandas as pd
import requests

CKAN_INFOLEG_API = "https://datos.jus.gob.ar/api/3/action/package_show?id=base-de-datos-legislativos-infoleg"
CKAN_SAIJ_API = "https://datos.jus.gob.ar/api/3/action/package_show?id=base-saij-de-normativa-provincial"
OUTPUT_DIR = "public/data"
LIMITE_NORMAS_NACIONAL = 5000
LIMITE_NORMAS_PROVINCIAL = 2000


def normalizar_texto(texto):
  if not isinstance(texto, str):
    return ""
  return (
      texto.lower()
      .replace("á", "a")
      .replace("é", "e")
      .replace("í", "i")
      .replace("ó", "o")
      .replace("ú", "u")
      .replace("ü", "u")
  )


def clasificar_eje_jornadas(texto_norm):
  if any(
      w in texto_norm
      for w in [
          "rigi",
          "regimen de incentivo",
          "grandes inversiones",
          "27742",
          "27.742",
      ]
  ):
    return "Políticas de Inversión (RIGI / Súper RIGI)"
  if any(
      w in texto_norm
      for w in [
          "unco",
          "universidad nacional del comahue",
          "comahue",
          "educacion superior",
          "universitaria",
          "universidades nacionales",
      ]
  ):
    return "UNCo (Fiske Menuco / Neuquén)"
  if any(
      w in texto_norm
      for w in [
          "genero",
          "violencia contra las mujeres",
          "identidad de genero",
          "feminism",
          "travesti",
          "transexual",
          "transgenero",
          "interrupcion voluntaria del embarazo",
          "paridad",
          "cuidados",
      ]
  ):
    return "Perspectiva de Género"
  if any(
      w in texto_norm
      for w in [
          "hidrocarburo",
          "mineria",
          "minero",
          "minera",
          "petroleo",
          "litio",
          "vaca muerta",
          "ambiental",
          "ambiente",
          "recursos naturales",
          "gasoducto",
          "oleoducto",
          "energia",
      ]
  ):
    return "Extractivismo y Minería"
  if any(
      w in texto_norm
      for w in [
          "contrato de trabajo",
          "laboral",
          "empleo",
          "convenio colectivo",
          "paritaria",
          "sindicato",
          "previsional",
          "jubilacion",
          "indemnizacion",
          "salario",
          "trabajador",
      ]
  ):
    return "Configuraciones y Reformas Laborales"
  if any(
      w in texto_norm
      for w in [
          "vivienda",
          "alquiler",
          "locacion",
          "barrios populares",
          "renabap",
          "indigena",
          "asignacion universal",
          "emergencia alimentaria",
          "vulnerable",
          "tarifa",
          "servicio publico",
          "migracion",
      ]
  ):
    return "Desigualdades Socio-Territoriales"
  return ""


def clasificar_periodo(fecha_str):
  if not isinstance(fecha_str, str) or len(fecha_str) < 4:
    return "Néstor Kirchner y Cristina Fernández (2003-2015)"
  fecha = fecha_str.strip()[:10]
  if "2003-05-25" <= fecha <= "2015-12-09":
    return "Néstor Kirchner y Cristina Fernández (2003-2015)"
  if "2015-12-10" <= fecha <= "2019-12-09":
    return "Mauricio Macri (2015-2019)"
  if "2019-12-10" <= fecha <= "2023-12-09":
    return "Alberto Fernández (2019-2023)"
  if fecha >= "2023-12-10":
    return "Javier Milei (2023-Presente)"
  return "Néstor Kirchner y Cristina Fernández (2003-2015)"


def limpiar_columnas(df):
  df.columns = [
      str(c).strip().lower().lstrip("\ufeff").replace(" ", "_")
      for c in df.columns
  ]
  return df


def limpiar_id(serie):
  return serie.astype(str).str.strip().str.replace(r"\.0$", "", regex=True)


def extraer_carpeta_drive(url_o_id):
  if not url_o_id:
    return "1KWoAxD2BYQkE6HkZF1eLGEEzsbscGVIb"
  limpio = url_o_id.strip()
  if "/folders/" in limpio:
    limpio = limpio.split("/folders/")[1].split("?")[0].split("/")[0]
  return limpio.strip() or "1KWoAxD2BYQkE6HkZF1eLGEEzsbscGVIb"


def extraer_private_key_sin_json(cred_raw):
  texto = cred_raw.strip()
  # Si esta en Base64 (no contiene BEGIN PRIVATE KEY directamente), lo decodificamos ignorando espacios
  if "BEGIN PRIVATE KEY" not in texto:
    try:
      b64_limpio = re.sub(r"[^A-Za-z0-9+/=]", "", texto)
      # Ajustar padding multiplo de 4
      resto = len(b64_limpio) % 4
      if resto:
        b64_limpio += "=" * (4 - resto)
      texto = base64.b64decode(b64_limpio).decode("utf-8", errors="ignore")
    except Exception:
      pass

  # Extraer directamente el bloque PEM entre -----BEGIN PRIVATE KEY----- y -----END PRIVATE KEY-----
  match = re.search(
      r"(-----BEGIN PRIVATE KEY-----.*?-----END PRIVATE KEY-----)",
      texto,
      re.DOTALL,
  )
  if not match:
    raise ValueError(
        "No se encontró '-----BEGIN PRIVATE KEY-----' en el Secret"
        f" GDRIVE_CREDENTIALS (largo recibido={len(cred_raw)})."
    )

  pem = match.group(1).replace("\\n", "\n")
  return {
      "type": "service_account",
      "project_id": "jifadecsdialogodesaberes",
      "private_key_id": "0bde682c24603f7cbb3aa82ac6d7fc3f075753f3",
      "private_key": pem + "\n",
      "client_email": (
          "respaldo-jifadecs@jifadecsdialogodesaberes.iam.gserviceaccount.com"
      ),
      "client_id": "112952269602916530212",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": (
          "https://www.googleapis.com/oauth2/v1/certs"
      ),
      "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/respaldo-jifadecs%40jifadecsdialogodesaberes.iam.gserviceaccount.com",
      "universe_domain": "googleapis.com",
  }


def subir_archivos_a_drive(rutas_archivos):
  cred_raw = os.environ.get("GDRIVE_CREDENTIALS", "").strip()
  folder_raw = os.environ.get("GDRIVE_FOLDER_URL", "").strip()
  target_folder = extraer_carpeta_drive(folder_raw)

  if not cred_raw:
    print("Aviso: El Secret GDRIVE_CREDENTIALS está vacío en GitHub Actions.")
    return

  try:
    info_cred = extraer_private_key_sin_json(cred_raw)
    creds = service_account.Credentials.from_service_account_info(
        info_cred, scopes=["https://www.googleapis.com/auth/drive"]
    )
    service = build("drive", "v3", credentials=creds)

    for ruta in rutas_archivos:
      if not os.path.exists(ruta):
        continue
      nombre_archivo = os.path.basename(ruta)
      mime = "application/json" if ruta.endswith(".json") else "text/plain"
      media = MediaFileUpload(ruta, mimetype=mime, resumable=False)

      consulta = (
          f"name = '{nombre_archivo}' and '{target_folder}' in parents and"
          " trashed = false"
      )
      existentes = (
          service.files()
          .list(
              q=consulta,
              fields="files(id, name)",
              supportsAllDrives=True,
              includeItemsFromAllDrives=True,
          )
          .execute()
          .get("files", [])
      )

      if existentes:
        service.files().update(
            fileId=existentes[0]["id"], media_body=media, supportsAllDrives=True
        ).execute()
        print(f"Actualizado en Google Drive: {nombre_archivo}")
      else:
        try:
          meta = {"name": nombre_archivo, "parents": [target_folder]}
          service.files().create(
              body=meta, media_body=media, supportsAllDrives=True
          ).execute()
          print(f"Creado en Google Drive: {nombre_archivo}")
        except Exception as create_err:
          print(
              f"Aviso al crear {nombre_archivo} (las cuentas de servicio"
              " gratuitas requieren que el archivo exista previamente en la"
              f" carpeta para actualizarlo): {create_err}"
          )
  except Exception as e:
    print("Error subiendo respaldo a Google Drive:", e)


def obtener_urls_infoleg():
  res = requests.get(CKAN_INFOLEG_API, timeout=30)
  res.raise_for_status()
  recursos = res.json()["result"]["resources"]
  urls = {}
  for r in recursos:
    url = r.get("url", "")
    nombre = r.get("name", "").lower()
    if "normativa-nacional" in url or "normativa nacional" in nombre:
      urls["nacional"] = url
    elif "modificadas" in url or "modificadas" in nombre:
      urls["modificadas"] = url
    elif "modificatorias" in url or "modificatorias" in nombre:
      urls["modificatorias"] = url
  return urls


def obtener_urls_saij_norpatagonia():
  urls_prov = []
  try:
    res = requests.get(CKAN_SAIJ_API, timeout=30)
    res.raise_for_status()
    recursos = res.json()["result"]["resources"]
    for r in recursos:
      url = r.get("url", "")
      nombre = normalizar_texto(r.get("name", "") + " " + url)
      if any(
          p in nombre
          for p in ["rio negro", "rio-negro", "rionegro", "neuquen", "provinc"]
      ):
        if url.lower().endswith((".csv", ".zip")):
          urls_prov.append(url)
  except Exception as e:
    print("Aviso al consultar API SAIJ:", e)
  return urls_prov


def procesar_todo():
  os.makedirs(OUTPUT_DIR, exist_ok=True)
  urls = obtener_urls_infoleg()
  chunks_filtrados = []
  archivos_generados = []

  print("1. Procesando InfoLEG Nacional...")
  if "nacional" in urls:
    for chunk in pd.read_csv(
        urls["nacional"],
        dtype=str,
        chunksize=40000,
        low_memory=False,
        on_bad_lines="skip",
        encoding="utf-8",
    ):
      chunk = limpiar_columnas(chunk)
      if "id_norma" not in chunk.columns:
        chunk = chunk.rename(columns={chunk.columns[0]: "id_norma"})
      chunk = chunk.dropna(subset=["id_norma"]).fillna("")
      chunk["id_norma"] = limpiar_id(chunk["id_norma"])

      textos = (
          chunk.get("titulo_resumido", "")
          + " "
          + chunk.get("titulo_sumario", "")
          + " "
          + chunk.get("texto_resumido", "")
      )
      chunk["axis"] = [
          clasificar_eje_jornadas(normalizar_texto(t)) for t in textos
      ]
      chunk_util = chunk[chunk["axis"] != ""].copy()

      if not chunk_util.empty:
        chunk_util["period"] = [
            clasificar_periodo(str(f))
            for f in chunk_util.get("fecha_sancion", "")
        ]
        chunk_util["jurisdiccion"] = "Nacional (InfoLEG)"
        columnas_guardar = [
            "id_norma",
            "tipo_norma",
            "numero_norma",
            "fecha_sancion",
            "titulo_resumido",
            "titulo_sumario",
            "texto_resumido",
            "texto_original",
            "texto_actualizado",
            "modificada_por",
            "modifica_a",
            "axis",
            "period",
            "jurisdiccion",
        ]
        cols_existentes = [
            c for c in columnas_guardar if c in chunk_util.columns
        ]
        chunks_filtrados.append(chunk_util[cols_existentes])

  df_final = (
      pd.concat(chunks_filtrados, ignore_index=True)
      if chunks_filtrados
      else pd.DataFrame()
  )
  if not df_final.empty:
    df_final = df_final.sort_values(by="fecha_sancion", ascending=False).head(
        LIMITE_NORMAS_NACIONAL
    )

  ids_activos = (
      set(df_final["id_norma"].unique()) if not df_final.empty else set()
  )

  ruta_busqueda = os.path.join(OUTPUT_DIR, "infoleg-busqueda.json")
  df_final.to_json(ruta_busqueda, orient="records", force_ascii=False)
  archivos_generados.append(ruta_busqueda)
  print(f"Guardado {ruta_busqueda} con {len(df_final)} normas clasificadas.")

  # Usamos el mismo nombre que el archivo que ya subiste a tu carpeta de Drive para que el bot lo actualice directo
  ruta_txt_nacional = os.path.join(
      OUTPUT_DIR, "Respaldo_Offline_Leyes_InfoLEG_JIFADECS2027.txt"
  )
  with open(ruta_txt_nacional, "w", encoding="utf-8") as f_txt:
    f_txt.write(
        "=== RESPALDO OFFLINE UNIFICADO DE LEGISLACION E INFOLEG (JIFADECS"
        " 2027) ===\n"
    )
    f_txt.write(f"Total de normas respaldadas: {len(df_final)}\n\n")
    for idx, (_, r) in enumerate(df_final.iterrows(), start=1):
      f_txt.write(
          f"[{idx}] {r.get('tipo_norma', '')} {r.get('numero_norma', '')} |"
          f" {r.get('period', '')}\n"
      )
      f_txt.write(f"Título: {r.get('titulo_resumido', '')}\n")
      f_txt.write(
          f"Eje: {r.get('axis', '')} | Fecha: {r.get('fecha_sancion', '')}\n"
      )
      f_txt.write(f"Resumen: {r.get('texto_resumido', '')}\n")
      f_txt.write(f"Enlace InfoLEG: {r.get('texto_actualizado', '')}\n")
      f_txt.write(f"Enlace B.O.: {r.get('texto_original', '')}\n")
      f_txt.write("-" * 60 + "\n\n")
  archivos_generados.append(ruta_txt_nacional)

  print("2. Procesando SAIJ Normativa Provincial (Río Negro y Neuquén)...")
  urls_saij = obtener_urls_saij_norpatagonia()
  chunks_prov = []
  for u_prov in urls_saij[:3]:
    try:
      for chunk in pd.read_csv(
          u_prov,
          dtype=str,
          chunksize=30000,
          low_memory=False,
          on_bad_lines="skip",
          encoding="utf-8",
      ):
        chunk = limpiar_columnas(chunk).fillna("")
        texto_fila = chunk.astype(str).agg(" ".join, axis=1)
        mask_rn_nq = texto_fila.str.lower().str.contains(
            "rio negro|río negro|neuquen|neuquén", regex=True, na=False
        )
        sub = chunk[mask_rn_nq].copy()
        if not sub.empty:
          chunks_prov.append(sub.head(500))
    except Exception as e:
      print(f"Aviso leyendo recurso SAIJ {u_prov}:", e)

  if chunks_prov:
    df_prov = pd.concat(chunks_prov, ignore_index=True).head(
        LIMITE_NORMAS_PROVINCIAL
    )
    ruta_prov = os.path.join(OUTPUT_DIR, "saij-norpatagonia.json")
    df_prov.to_json(ruta_prov, orient="records", force_ascii=False)
    archivos_generados.append(ruta_prov)
    print(f"Guardado {ruta_prov} con {len(df_prov)} normas provinciales.")

  print("3. Procesando relaciones de normas modificadas y modificatorias...")
  relaciones = {}
  for clave, campo_destino, prefijo in [
      ("modificadas", "modifica_a", "modificada"),
      ("modificatorias", "modificada_por", "modificatoria"),
  ]:
    if clave in urls and ids_activos:
      try:
        for chunk in pd.read_csv(
            urls[clave],
            dtype=str,
            chunksize=50000,
            low_memory=False,
            on_bad_lines="skip",
            encoding="utf-8",
        ):
          chunk = limpiar_columnas(chunk)
          col_origen = (
              "id_norma" if "id_norma" in chunk.columns else chunk.columns[0]
          )
          chunk[col_origen] = limpiar_id(chunk[col_origen])
          filtrado = chunk[chunk[col_origen].isin(ids_activos)].fillna("")
          for _, fila in filtrado.iterrows():
            id_n = str(fila[col_origen])
            if id_n not in relaciones:
              relaciones[id_n] = {"modifica_a": [], "modificada_por": []}
            if len(relaciones[id_n][campo_destino]) < 20:
              relaciones[id_n][campo_destino].append({
                  "id": (
                      str(fila.get(f"id_norma_{prefijo}", "")).replace(
                          ".0", ""
                      )
                  ),
                  "tipo": str(fila.get(f"tipo_norma_{prefijo}", "")),
                  "numero": str(fila.get(f"numero_norma_{prefijo}", "")),
                  "fecha": str(fila.get(f"fecha_sancion_norma_{prefijo}", "")),
              })
      except Exception as e:
        print(f"Aviso en {clave}:", e)

  ruta_relaciones = os.path.join(OUTPUT_DIR, "infoleg-relaciones.json")
  with open(ruta_relaciones, "w", encoding="utf-8") as f:
    json.dump(relaciones, f, ensure_ascii=False)
  archivos_generados.append(ruta_relaciones)
  print(
      f"Guardado {ruta_relaciones} con relaciones para {len(relaciones)} normas."
  )

  print(
      "4. Subiendo archivos de respaldo a la carpeta compartida de Google"
      " Drive..."
  )
  subir_archivos_a_drive(archivos_generados)


if __name__ == "__main__":
  procesar_todo()

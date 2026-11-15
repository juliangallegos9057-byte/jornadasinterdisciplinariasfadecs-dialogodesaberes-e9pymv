import json
import os
import pandas as pd
import requests

CKAN_API_URL = "https://datos.jus.gob.ar/api/3/action/package_show?id=base-de-datos-legislativos-infoleg"
OUTPUT_DIR = "public/data"
LIMITE_NORMAS = 5000


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
          "ley 27742",
          "ley 27.742",
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
    return "Otros Períodos"
  fecha = fecha_str.strip()[:10]
  if "2003-05-25" <= fecha <= "2015-12-09":
    return "Néstor Kirchner y Cristina Fernández (2003-2015)"
  if "2015-12-10" <= fecha <= "2019-12-09":
    return "Mauricio Macri (2015-2019)"
  if "2019-12-10" <= fecha <= "2023-12-09":
    return "Alberto Fernández (2019-2023)"
  if fecha >= "2023-12-10":
    return "Javier Milei (2023-Presente)"
  return "Otros Períodos"


def limpiar_columnas(df):
  df.columns = [
      str(c).strip().lower().lstrip("\ufeff").replace(" ", "_")
      for c in df.columns
  ]
  return df


def limpiar_id(serie):
  return serie.astype(str).str.strip().str.replace(r"\.0$", "", regex=True)


def obtener_urls_csv():
  res = requests.get(CKAN_API_URL, timeout=30)
  res.raise_for_status()
  recursos = res.json()["result"]["resources"]

  urls = {}
  for r in recursos:
    url = r.get("url", "")
    nombre = r.get("name", "").lower()
    formato = r.get("format", "").lower()
    if "csv" not in formato and not url.lower().endswith((".csv", ".zip")):
      continue
    if "normativa-nacional" in url or "normativa nacional" in nombre:
      urls["nacional"] = url
    elif "modificadas" in url or "modificadas" in nombre:
      urls["modificadas"] = url
    elif "modificatorias" in url or "modificatorias" in nombre:
      urls["modificatorias"] = url
  return urls


def procesar_bases():
  os.makedirs(OUTPUT_DIR, exist_ok=True)
  urls = obtener_urls_csv()
  print("URLs detectadas:", urls)

  print("1. Procesando base-infoleg-normativa-nacional.csv...")
  chunks_filtrados = []

  for chunk in pd.read_csv(
      urls["nacional"],
      chunksize=40000,
      low_memory=False,
      on_bad_lines="skip",
      encoding="utf-8",
  ):
    chunk = limpiar_columnas(chunk)
    if "id_norma" not in chunk.columns:
      col_id = chunk.columns[0]
      chunk = chunk.rename(columns={col_id: "id_norma"})

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

    # Nos quedamos con las normas que coinciden con alguno de los 6 ejes de las Jornadas
    chunk_util = chunk[chunk["axis"] != ""].copy()
    if not chunk_util.empty:
      chunk_util["period"] = [
          clasificar_periodo(str(f))
          for f in chunk_util.get("fecha_sancion", "")
      ]
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
      ]
      cols_existentes = [
          c for c in columnas_guardar if c in chunk_util.columns
      ]
      chunks_filtrados.append(chunk_util[cols_existentes])

  if chunks_filtrados:
    df_final = pd.concat(chunks_filtrados, ignore_index=True)
    df_final = df_final.sort_values(by="fecha_sancion", ascending=False).head(
        LIMITE_NORMAS
    )
  else:
    df_final = pd.DataFrame()

  ids_activos = (
      set(df_final["id_norma"].unique()) if not df_final.empty else set()
  )

  ruta_busqueda = os.path.join(OUTPUT_DIR, "infoleg-busqueda.json")
  df_final.to_json(ruta_busqueda, orient="records", force_ascii=False)
  print(f"Guardado {ruta_busqueda} con {len(df_final)} normas clasificadas.")

  relaciones = {}

  # 2. Procesar normas modificadas de forma segura ante cambios de nombre de columna
  if "modificadas" in urls and ids_activos:
    print("2. Procesando base-complementaria-infoleg-normas-modificadas.csv...")
    try:
      for chunk in pd.read_csv(
          urls["modificadas"],
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
          if len(relaciones[id_n]["modifica_a"]) < 20:
            relaciones[id_n]["modifica_a"].append({
                "id": (
                    str(fila.get("id_norma_modificada", "")).replace(".0", "")
                ),
                "tipo": str(fila.get("tipo_norma_modificada", "")),
                "numero": str(fila.get("numero_norma_modificada", "")),
                "fecha": str(fila.get("fecha_sancion_norma_modificada", "")),
            })
    except Exception as e:
      print("Aviso en modificadas:", e)

  # 3. Procesar normas modificatorias de forma segura ante cambios de nombre de columna
  if "modificatorias" in urls and ids_activos:
    print(
        "3. Procesando base-complementaria-infoleg-normas-modificatorias.csv..."
    )
    try:
      for chunk in pd.read_csv(
          urls["modificatorias"],
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
          if len(relaciones[id_n]["modificada_por"]) < 20:
            relaciones[id_n]["modificada_por"].append({
                "id": (
                    str(fila.get("id_norma_modificatoria", "")).replace(
                        ".0", ""
                    )
                ),
                "tipo": str(fila.get("tipo_norma_modificatoria", "")),
                "numero": str(fila.get("numero_norma_modificatoria", "")),
                "fecha": str(fila.get("fecha_sancion_norma_modificatoria", "")),
            })
    except Exception as e:
      print("Aviso en modificatorias:", e)

  ruta_relaciones = os.path.join(OUTPUT_DIR, "infoleg-relaciones.json")
  with open(ruta_relaciones, "w", encoding="utf-8") as f:
    json.dump(relaciones, f, ensure_ascii=False)
  print(
      f"Guardado {ruta_relaciones} con relaciones para {len(relaciones)}"
      " normas."
  )


if __name__ == "__main__":
  procesar_bases()

import json
import os
import pandas as pd
import requests

CKAN_API_URL = "https://datos.jus.gob.ar/api/3/action/package_show?id=base-de-datos-legislativos-infoleg"
OUTPUT_DIR = "public/data"
LIMITE_NORMAS = 15000  # Cantidad de normas más recientes a incluir en el índice liviano


def obtener_urls_csv():
  res = requests.get(CKAN_API_URL, timeout=30)
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


def procesar_bases():
  os.makedirs(OUTPUT_DIR, exist_ok=True)
  urls = obtener_urls_csv()

  print("1. Procesando base-infoleg-normativa-nacional.csv...")
  columnas_nacional = [
      "id_norma",
      "tipo_norma",
      "numero_norma",
      "organismo_origen",
      "fecha_sancion",
      "titulo_resumido",
      "titulo_sumario",
      "texto_resumido",
      "texto_original",
      "texto_actualizado",
      "modificada_por",
      "modifica_a",
  ]

  chunks_nac = []
  for chunk in pd.read_csv(
      urls["nacional"],
      usecols=lambda c: c in columnas_nacional,
      chunksize=50000,
      low_memory=False,
  ):
    # Filtramos normas que tengan al menos título o número válido
    chunk = chunk.dropna(subset=["id_norma", "titulo_resumido"], how="any")
    chunks_nac.append(chunk)

  df_nacional = pd.concat(chunks_nac, ignore_index=True)
  df_nacional["id_norma"] = (
      df_nacional["id_norma"].astype(str).str.replace(r"\.0$", "", regex=True)
  )

  # Ordenar por fecha de sanción descendente y tomar las más recientes
  df_nacional = df_nacional.sort_values(by="fecha_sancion", ascending=False)
  df_liviano = df_nacional.head(LIMITE_NORMAS).fillna("")

  ids_activos = set(df_liviano["id_norma"].unique())

  # Guardar archivo principal para la Vista de Búsqueda
  ruta_busqueda = os.path.join(OUTPUT_DIR, "infoleg-busqueda.json")
  df_liviano.to_json(ruta_busqueda, orient="records", force_ascii=False)
  print(f"Guardado {ruta_busqueda} con {len(df_liviano)} normas.")

  # Diccionario de relaciones (solo para los IDs incluidos, para no duplicar peso)
  relaciones = {}

  print("2. Procesando base-complementaria-infoleg-normas-modificadas.csv...")
  for chunk in pd.read_csv(
      urls["modificadas"], chunksize=50000, low_memory=False
  ):
    chunk["id_norma"] = (
        chunk["id_norma"].astype(str).str.replace(r"\.0$", "", regex=True)
    )
    filtrado = chunk[chunk["id_norma"].isin(ids_activos)].fillna("")

    for _, fila in filtrado.iterrows():
      id_n = fila["id_norma"]
      if id_n not in relaciones:
        relaciones[id_n] = {"modifica_a": [], "modificada_por": []}
      relaciones[id_n]["modifica_a"].append({
          "id": str(fila.get("id_norma_modificada", "")).replace(".0", ""),
          "tipo": str(fila.get("tipo_norma_modificada", "")),
          "numero": str(fila.get("numero_norma_modificada", "")),
          "fecha": str(fila.get("fecha_sancion_norma_modificada", "")),
      })

  print(
      "3. Procesando base-complementaria-infoleg-normas-modificatorias.csv..."
  )
  for chunk in pd.read_csv(
      urls["modificatorias"], chunksize=50000, low_memory=False
  ):
    chunk["id_norma"] = (
        chunk["id_norma"].astype(str).str.replace(r"\.0$", "", regex=True)
    )
    filtrado = chunk[chunk["id_norma"].isin(ids_activos)].fillna("")

    for _, fila in filtrado.iterrows():
      id_n = fila["id_norma"]
      if id_n not in relaciones:
        relaciones[id_n] = {"modifica_a": [], "modificada_por": []}
      relaciones[id_n]["modificada_por"].append({
          "id": str(fila.get("id_norma_modificatoria", "")).replace(".0", ""),
          "tipo": str(fila.get("tipo_norma_modificatoria", "")),
          "numero": str(fila.get("numero_norma_modificatoria", "")),
          "fecha": str(fila.get("fecha_sancion_norma_modificatoria", "")),
      })

  ruta_relaciones = os.path.join(OUTPUT_DIR, "infoleg-relaciones.json")
  with open(ruta_relaciones, "w", encoding="utf-8") as f:
    json.dump(relaciones, f, ensure_ascii=False)
  print(
      f"Guardado {ruta_relaciones} con relaciones para {len(relaciones)}"
      " normas."
  )


if __name__ == "__main__":
  procesar_bases()

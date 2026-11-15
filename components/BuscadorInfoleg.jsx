import React, { useState, useEffect, useMemo } from 'react';

export default function BuscadorInfoleg() {
  const [normas, setNormas] = useState([]);
  const [relaciones, setRelaciones] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [normaSeleccionada, setNormaSeleccionada] = useState(null);

  // 1. Carga inicial solo del índice liviano de búsqueda
  useEffect(() => {
    fetch('/data/infoleg-busqueda.json')
      .then((res) => res.json())
      .then((data) => {
        setNormas(data);
        setCargando(false);
      })
      .catch((err) => {
        console.error('Error cargando base InfoLEG:', err);
        setCargando(false);
      });
  }, []);

  // 2. Filtrado instantáneo con límite de 25 resultados para no sobrecargar el DOM
  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return normas.slice(0, 25);

    const coincidencias = [];
    for (let i = 0; i < normas.length; i++) {
      const n = normas[i];
      if (
        String(n.numero_norma).toLowerCase().includes(q) ||
        String(n.id_norma).toLowerCase() === q ||
        String(n.titulo_resumido).toLowerCase().includes(q) ||
        String(n.titulo_sumario).toLowerCase().includes(q) ||
        String(n.texto_resumido).toLowerCase().includes(q)
      ) {
        coincidencias.push(n);
        if (coincidencias.length >= 25) break;
      }
    }
    return coincidencias;
  }, [busqueda, normas]);

  // 3. Carga diferida (Lazy Load) de normas modificadas y modificatorias solo al pedir detalle
  const verRelaciones = async (norma) => {
    setNormaSeleccionada(norma);
    if (!relaciones) {
      try {
        const res = await fetch('/data/infoleg-relaciones.json');
        const data = await res.json();
        setRelaciones(data);
      } catch (err) {
        console.error('Error cargando relaciones:', err);
        setRelaciones({});
      }
    }
  };

  const detalleRelacion = normaSeleccionada && relaciones
    ? relaciones[normaSeleccionada.id_norma] || { modifica_a: [], modificada_por: [] }
    : null;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1rem', fontFamily: 'sans-serif' }}>
      <h2>Buscador de Normativa Nacional (InfoLEG)</h2>

      <input
        type="search"
        placeholder="Buscar por número de ley/decreto, ID o palabra clave..."
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', marginBottom: '1rem' }}
      />

      {cargando ? (
        <p>Cargando base normativa actualizada...</p>
      ) : (
        <div>
          <p style={{ fontSize: '0.9rem', color: '#555' }}>
            Mostrando {resultados.length} resultados
          </p>

          {resultados.map((n) => (
            <div
              key={n.id_norma}
              style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '1rem', marginBottom: '0.75rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>
                  {n.tipo_norma} {n.numero_norma} ({n.fecha_sancion})
                </strong>
                <span style={{ fontSize: '0.8rem', color: '#666' }}>ID InfoLEG: {n.id_norma}</span>
              </div>

              <h4 style={{ margin: '0.5rem 0 0.25rem' }}>{n.titulo_resumido}</h4>
              <p style={{ fontSize: '0.9rem', color: '#333', margin: '0.25rem 0 0.75rem' }}>
                {n.texto_resumido}
              </p>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                {n.texto_Original || n.texto_original ? (
                  <a href={n.texto_original} target="_blank" rel="noopener noreferrer">
                    Texto Original (InfoLEG)
                  </a>
                ) : null}

                {n.texto_actualizado ? (
                  <a href={n.texto_actualizado} target="_blank" rel="noopener noreferrer">
                    Texto Actualizado (InfoLEG)
                  </a>
                ) : null}

                <button
                  type="button"
                  onClick={() => verRelaciones(n)}
                  style={{ cursor: 'pointer', padding: '0.2rem 0.6rem' }}
                >
                  Ver vínculos normativos ({n.modifica_a || 0} / {n.modificada_por || 0})
                </button>
              </div>

              {normaSeleccionada?.id_norma === n.id_norma && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                  {!detalleRelacion ? (
                    <p>Cargando normas vinculadas...</p>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
                      <div>
                        <strong>Modifica a ({detalleRelacion.modifica_a.length}):</strong>
                        <ul>
                          {detalleRelacion.modifica_a.map((m, idx) => (
                            <li key={idx}>
                              {m.tipo} {m.numero} ({m.fecha}) [ID: {m.id}]
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <strong>Modificada por ({detalleRelacion.modificada_por.length}):</strong>
                        <ul>
                          {detalleRelacion.modificada_por.map((m, idx) => (
                            <li key={idx}>
                              {m.tipo} {m.numero} ({m.fecha}) [ID: {m.id}]
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

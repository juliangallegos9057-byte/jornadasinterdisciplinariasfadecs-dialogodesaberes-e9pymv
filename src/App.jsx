import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, doc, setDoc, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';

// 1. Configuracion de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCEi-f72oL1fTChwwRUpcSeinlw7UNcZS4",
  authDomain: "jornadas-interdisciplinarias.firebaseapp.com",
  projectId: "jornadas-interdisciplinarias",
  storageBucket: "jornadas-interdisciplinarias.firebasestorage.app",
  messagingSenderId: "287626539535",
  appId: "1:287626539535:web:d54f256189f8fd2c61e97a",
  measurementId: "G-N9HCXE93CT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Enlaces de Google Drive y Google Docs
const DRIVE_REPO_URL = [
  'https://drive.google.com/drive/folders/',
  '1E-9JMFs1ot4Y1Omp_OJSbcl3Ilu',
  '_PfH3'
].join('');

const CHATS_FOLDER_URL = [
  'https://drive.google.com/drive/folders/',
  '1dY_-8UTXaqdgxPiLWlsCgx461G08',
  '-hIh'
].join('');

const DEFAULT_GENERAL_CHAT_DOC_URL = [
  'https://docs.google.com/document/d/',
  '10Y7r4XoPMo_L9DC35ejvKCJ53NxeD',
  '-k4jZO4x9w_I0w/edit?usp=drivesdk'
].join('');

const DEFAULT_SALAS_CHAT_DOC_URL = [
  'https://docs.google.com/document/d/',
  '13kZdUmplKvgboCANWE0IgbOUlRNrt',
  'fBROJhz0LGZ-aI/edit?usp=drivesdk'
].join('');

const MAX_MSG_LENGTH = 1000;
const LIVE_CHAT_LIMIT = 150;
const NEWS_CACHE_TTL_MS = 30 * 60 * 1000;
const AUTO_ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NEWS_STORAGE_KEY = "jifadecs_2027_rss_cache_v3";
const ARCHIVE_CHECK_STORAGE_KEY = "jifadecs_2027_last_archive_check_v3";
const OFFLINE_NORMS_STORAGE_KEY = "jifadecs_2027_offline_norms_backup_v1";

const INFOLEG_DATASET_URL = 'https://datos.jus.gob.ar/dataset/base-de-datos-legislativos-infoleg';
const SAIJ_DATASET_URL = 'https://datos.jus.gob.ar/dataset/base-saij-de-normativa-provincial';
const INFOLEG_METADATA_URL = 'https://github.com/datos-justicia-argentina/Base-de-datos-legislativos-infoleg/blob/master/Base-de-datos-legislativos-Infoleg-metadata.md';
const SOURCES_DRIVE_FOLDER_URL = [
  'https://drive.google.com/drive/folders/',
  '1KWoAxD2BYQkE6HkZF1eLGEEzsbsc',
  'GVIb?usp=sharing'
].join('');
const ACCESS_TO_INFO_URL = 'https://www.argentina.gob.ar/normativa/nacional/ley-27275-265949/texto';

const norpatagoniaPortals = [
  {
    province: 'Río Negro',
    links: [
      { label: 'Digesto Jurídico', url: 'https://web.legisrn.gov.ar/digesto' },
      { label: 'Legislación', url: 'https://web.legisrn.gov.ar/legislativa/legislacion' }
    ]
  },
  {
    province: 'Neuquén',
    links: [
      { label: 'Legislación del Poder Judicial', url: 'https://www.jusneuquen.gov.ar/legislacion/' },
      { label: 'Boletines Oficiales', url: 'https://boficial.neuquen.gov.ar/Boletines' },
      { label: 'Legislatura del Neuquén', url: 'https://www.legislaturaneuquen.gob.ar/' }
    ]
  }
];

const ADMIN_EMAILS = [
  'juliangallegos9057@gmail.com',
  'jifadecs@gmail.com'
];

// Normalizador de texto sin regex complejas: minusculas, sin tildes y sin puntos para que "Ley 25.877" coincida con "25877"
const normalizeText = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/á/g, 'a')
    .replace(/é/g, 'e')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/ú/g, 'u')
    .replace(/ü/g, 'u')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// Clasifica fecha de sancion en el periodo presidencial correspondiente para unificar las bases
const resolvePeriodFromDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return 'Néstor Kirchner y Cristina Fernández (2003-2015)';
  const clean = dateStr.trim();
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    if (iso >= '2023-12-10') return 'Javier Milei (2023-Presente)';
    if (iso >= '2019-12-10') return 'Alberto Fernández (2019-2023)';
    if (iso >= '2015-12-10') return 'Mauricio Macri (2015-2019)';
    return 'Néstor Kirchner y Cristina Fernández (2003-2015)';
  }
  const yearMatch = clean.match(/(20\d{2})/);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    if (yr >= 2024) return 'Javier Milei (2023-Presente)';
    if (yr >= 2020) return 'Alberto Fernández (2019-2023)';
    if (yr >= 2016) return 'Mauricio Macri (2015-2019)';
  }
  return 'Néstor Kirchner y Cristina Fernández (2003-2015)';
};

// Normalizador de enlaces de InfoLEG / Boletin Oficial para que siempre sean validos y copiables
const sanitizeInfolegLink = (rawUrl, fallbackNormLabel = '') => {
  if (typeof rawUrl === 'string') {
    const cleaned = rawUrl.trim();
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      return cleaned;
    }
    if (cleaned.startsWith('//')) {
      return 'https:' + cleaned;
    }
    if (cleaned.startsWith('/')) {
      return 'https://www.argentina.gob.ar' + cleaned;
    }
  }
  if (fallbackNormLabel) {
    return `https://www.argentina.gob.ar/normativa/buscar?q=${encodeURIComponent(fallbackNormLabel)}`;
  }
  return 'https://www.argentina.gob.ar/normativa';
};

// Convierte URL de Google Docs a /preview para evitar bloqueos de CSP en el iframe
const getEmbeddableGoogleUrl = (urlString) => {
  if (!urlString || typeof urlString !== 'string') return '';
  return urlString.replace(/\/edit(\?.*)?$/, '/preview');
};

// Generador de hash determinista Argon/FNV-1a para integridad de IDs y cache
const createDeterministicHash = (input) => {
  const clean = normalizeText(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'argon-' + (hash >>> 0).toString(16);
};

// Limpiador de HTML sin expresiones regulares complejas
const stripHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  let text = '';
  let insideTag = false;
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (ch === '<') {
      insideTag = true;
      text += ' ';
    } else if (ch === '>') {
      insideTag = false;
      text += ' ';
    } else if (!insideTag) {
      text += ch;
    }
  }
  return text
    .split('&nbsp;').join(' ')
    .split('&amp;').join('&')
    .split('&quot;').join('"')
    .split('&#39;').join("'")
    .split(/\s+/).join(' ')
    .trim();
};

// Extrae enlace directo si viene dentro del HTML de Google News
const extractRealUrlFromHtml = (htmlString, rawLink) => {
  if (rawLink && typeof rawLink === 'string' && !rawLink.includes('news.google.com')) {
    return rawLink.trim();
  }
  if (typeof htmlString === 'string') {
    const marker = 'href="http';
    const startIdx = htmlString.indexOf(marker);
    if (startIdx !== -1) {
      const urlStart = startIdx + 6;
      const urlEnd = htmlString.indexOf('"', urlStart);
      if (urlEnd !== -1) {
        const extracted = htmlString.slice(urlStart, urlEnd).trim();
        if (!extracted.includes('news.google.com')) {
          return extracted;
        }
      }
    }
  }
  return rawLink && typeof rawLink === 'string' ? rawLink.trim() : '';
};

// Validador de seguridad para URLs de Google Docs / Drive
const isValidGoogleUrl = (urlString) => {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const parsed = new URL(urlString.trim());
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'docs.google.com' || parsed.hostname === 'drive.google.com')
    );
  } catch {
    return false;
  }
};

// Validador estricto de enlace de articulo: rechaza portadas generales y exige ruta de nota real
const getDirectArticleUrl = (urlString) => {
  if (!urlString || typeof urlString !== 'string') return '';
  const trimmed = urlString.trim();
  if (!trimmed || trimmed === '#') return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    let cleanPath = parsed.pathname || '';
    while (cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    if (!cleanPath || cleanPath.length < 4) {
      return '';
    }
    const genericPaths = ['/index.html', '/home', '/inicio', '/portada', '/noticias', '/secciones'];
    if (genericPaths.includes(cleanPath.toLowerCase())) {
      return '';
    }
    return trimmed;
  } catch {
    return '';
  }
};

// Mapeo de nombres de medios segun dominio
const resolveSourceFromUrl = (urlString, fallbackSource) => {
  try {
    let host = new URL(urlString).hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    const domainMap = {
      'rionegro.com.ar': 'Diario Río Negro',
      'anroca.com.ar': 'ANRoca',
      'mejorinformado.com': 'Mejor Informado',
      'elcordillerano.com.ar': 'El Cordillerano',
      'adnrionegro.com.ar': 'ADN Río Negro',
      'lmcipolletti.com.ar': 'LM Cipolletti',
      'lmneuquen.com': 'LM Neuquén',
      'eldiarioar.com': 'elDiarioAR',
      'movimientoalternativa.com.ar': 'Movimiento Alternativa',
      'zapalaya.com.ar': 'Zapala Ya',
      'fuego24.com': 'Fuego 24',
      'damenoticias.com': 'Paralelo Sur',
      'diarioandino.com.ar': 'Diario Andino',
      'elperiodicoderincon.com.ar': 'El Periódico de Rincón',
      'laangosturadigital.com.ar': 'La Angostura Digital',
      'diariamenteneuquen.com.ar': 'Diariamente Neuquén',
      'neuquenalinstante.com.ar': 'Neuquén al Instante',
      'elcomahueonline.com': 'El Comahue Online',
      'neuquenonline.com.ar': 'Neuquén Online',
      'neuquen24horas.com': 'Neuquén 24 Horas',
      'alertadigital.ar': 'Alerta Digital',
      'neuquendigitalnoticias.com.ar': 'Neuquén Digital Noticias',
      'neuquenweb.com': 'Neuquén Web',
      'neuqueninforma.gob.ar': 'Neuquén Informa',
      'cutralcoalinstante.com': 'Cutral Co al Instante',
      'hechosdezapala.com': 'Hechos de Zapala',
      'limaynoticias.com': 'Limay Noticias',
      'vdmnoticias.com': 'VDM Noticias',
      'riocoloradoinforma.com.ar': 'Río Colorado Informa',
      'vivoinformado.com.ar': 'Vivo Informado',
      'hoyvallemedio.ar': 'Hoy Valle Medio',
      'barilochedigital.com': 'Bariloche Digital',
      'cipollettidigital.com.ar': 'Cipolletti Digital',
      'cipo360.com.ar': 'Cipo 360',
      'diariolapalabra.com.ar': 'Diario La Palabra',
      'estoquepasa.com.ar': 'Esto Que Pasa',
      'loprincipal.com.ar': 'Lo Principal',
      'gnrnoticias.com': 'GNR Noticias',
      'canal10.com.ar': 'Canal 10 Río Negro'
    };
    if (domainMap[host]) return domainMap[host];
    return fallbackSource || 'Medio Regional';
  } catch {
    return fallbackSource || 'Medio Regional';
  }
};

// Ciudades, poblados y referencias territoriales de Rio Negro y Neuquen
const rnNqTerritoryTerms = [
  'rio negro', 'neuquen', 'rionegrino', 'rionegrina', 'neuquino', 'neuquina',
  'alto valle', 'valle medio', 'linea sur', 'comahue', 'norpatagonia',
  'golfo san matias', 'vaca muerta', 'fiske menuco', 'rio limay', 'rio colorado',
  'general roca', 'cipolletti', 'bariloche', 'san carlos de bariloche', 'viedma',
  'allen', 'villa regina', 'cinco saltos', 'catriel', 'choele choel',
  'chimpay', 'belisle', 'luis beltran', 'darwin', 'coronel gomez', 'cervantes',
  'ingeniero jacobacci', 'jacobacci', 'maquinchao', 'los menucos', 'sierra grande',
  'las grutas', 'san antonio oeste', 'san antonio este', 'el bolson', 'dina huapi',
  'comallo', 'pilcaniyeu', 'valcheta', 'general conesa', 'guardia mitre',
  'campo grande', 'sargento vidal', 'barda del medio', 'contralmirante cordero',
  'fernandez oro', 'cerro policia', 'aguada guzman', 'mencue', 'el cuy',
  'sierra colorada', 'ramos mexia', 'clemente onelli', 'mainque', 'ingeniero huergo',
  'general godoy', 'chichinales', 'valle azul', 'lamarque', 'pomona',
  'plottier', 'centenario', 'senillosa', 'vista alegre', 'cutral co', 'plaza huincul',
  'zapala', 'san martin de los andes', 'villa la angostura', 'junin de los andes',
  'chos malal', 'rincon de los sauces', 'anelo', 'villa pehuenia', 'moquehue',
  'alumine', 'loncopue', 'las lajas', 'picun leufu', 'piedra del aguila', 'el chocon',
  'villa el chocon', 'las ovejas', 'andacollo', 'huinganco', 'taquimilan', 'el huecu',
  'mariano moreno', 'las coloradas', 'caviahue', 'copahue', 'buta ranquil',
  'barrancas', 'sauzal bonito', 'san patricio del chanar', 'el cholar', 'tricao malal'
];

// Otras provincias y ciudades fuera de Rio Negro y Neuquen
const excludedOtherProvincesAndCities = [
  'provincia de buenos aires', 'caba', 'capital federal', 'amba', 'conurbano', 'la plata',
  'mar del plata', 'bahia blanca', 'cordoba', 'rosario', 'santa fe', 'mendoza',
  'tucuman', 'salta', 'jujuy', 'chubut', 'rawson', 'trelew', 'puerto madryn',
  'comodoro rivadavia', 'esquel', 'santa cruz', 'rio gallegos', 'el calafate',
  'tierra del fuego', 'ushuaia', 'rio grande', 'la pampa', 'santa rosa',
  'general pico', 'san luis', 'san juan', 'la rioja', 'catamarca',
  'santiago del estero', 'chaco', 'resistencia', 'formosa', 'misiones',
  'posadas', 'corrientes', 'entre rios', 'parana'
];

// Palabras prohibidas globales
const globalExclusions = [
  'accidente', 'choque', 'volco', 'vuelco', 'muerto', 'fallecio', 'fallecido', 'fatal',
  'policial', 'detenido', 'robo', 'asaltaron', 'crimen', 'homicidio', 'autopsia',
  'clima', 'pronostico', 'meteorologico', 'futbol', 'torneo', 'partido', 'colapinto',
  'papa francisco', 'vaticano', 'espectaculo', 'famosos', 'farandula', 'horoscopo',
  'arroyo', 'cayo al', 'cruzar el', 'cruzaba', 'rescate', 'rescataron', 'bomberos',
  'ahogado', 'desaparecido', 'buscan a', 'ambulancia', 'heridos', 'hospitalizaron'
];

const isRnOrNqNews = (normText, sourceName) => {
  for (const otherPlace of excludedOtherProvincesAndCities) {
    if (normText.includes(otherPlace)) {
      return false;
    }
  }
  if (rnNqTerritoryTerms.some(term => normText.includes(term))) {
    return true;
  }
  const normSource = normalizeText(sourceName || '');
  return rnNqTerritoryTerms.some(term => normSource.includes(term));
};

const matchesCategoryStrictly = (realTitle, realDesc, sourceName, category) => {
  const normText = normalizeText(`${realTitle} ${realDesc}`);

  for (const badWord of globalExclusions) {
    if (normText.includes(badWord)) return false;
  }

  if (!isRnOrNqNews(normText, sourceName)) {
    return false;
  }

  if (category === 'Extractivismo y Minería') {
    const coreResource = [
      'extractiv', 'mineria', 'minero', 'minera', 'fracking', 'hidrocarburo',
      'petroleo', 'petrolera', 'litio', 'uranio', 'oleoducto', 'vaca muerta',
      'golfo san matias', 'megamineria', 'calcatreu', 'represa', 'gasoducto'
    ];
    const socialImpact = [
      'agua', 'comunidad', 'ambiental', 'socioambiental', 'contaminacion', 'derrame',
      'territorio', 'audiencia', 'asamblea', 'vecinos', 'rechazo', 'impacto',
      'explotacion', 'pasivo', 'recurso', 'inversion', 'aprobacion', 'proyecto', 'sismo'
    ];
    return coreResource.some(w => normText.includes(w)) && socialImpact.some(w => normText.includes(w));
  }

  if (category === 'Desigualdades Socio-Territoriales') {
    const inequalityTerms = [
      'pobreza', 'indigencia', 'desigualdad', 'alquiler', 'vivienda', 'habitacional',
      'barrio popular', 'toma de tierra', 'asentamiento', 'tarifazo', 'servicios basicos',
      'vulnerabilidad', 'acceso al agua', 'canasta basica', 'hacina'
    ];
    return inequalityTerms.some(w => normText.includes(w));
  }

  if (category === 'Configuraciones y Reformas Laborales') {
    const laborTerms = [
      'reforma laboral', 'precarizacion', 'despido', 'sindicato', 'gremio',
      'trabajador', 'paritaria', 'huelga', 'convenio colectivo', 'ajuste',
      'flexibilizacion', 'empleo', 'salario', 'estabilidad laboral', 'ate', 'unter', 'adunc'
    ];
    return laborTerms.some(w => normText.includes(w));
  }

  if (category === 'Políticas de Inversión (RIGI / Súper RIGI)') {
    const rigiTerms = ['rigi', 'super rigi', 'regimen de incentivo', 'grandes inversiones', 'adhesion al rigi'];
    return rigiTerms.some(w => normText.includes(w));
  }

  if (category === 'Perspectiva de Género') {
    const genderTerms = [
      'perspectiva de genero', 'violencia de genero', 'violencia machista', 'feminism',
      'disidencia', 'diversidad sexual', 'lgbti', 'trans', 'travesti', 'tareas de cuidado',
      'patriarcado', 'femicidio', 'aborto', 'esi', 'paridad de genero', 'ni una menos'
    ];
    return genderTerms.some(w => normText.includes(w));
  }

  if (category === 'UNCo (Fiske Menuco / Neuquén)') {
    const uncoTerms = ['unco', 'universidad nacional del comahue', 'fadecs', 'comahue', 'fiske menuco', 'adunc', 'fuco'];
    return uncoTerms.some(w => normText.includes(w));
  }

  return false;
};

// Repertorio Historico de Boletin Oficial e InfoLEG con URLs modernas de argentina.gob.ar/normativa
const officialGazetteNorms = [
  {
    id: 'bo-nk-1',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'Ley 25.877',
    title: 'Ley 25.877 - Régimen de Ordenamiento Laboral y Negociación Colectiva (Derogación de la Ley Banelco)',
    date: '19 Mar 2004',
    axis: 'Configuraciones y Reformas Laborales',
    summary: 'Deroga la Ley 25.250 de flexibilización laboral, restablece la ultraactividad de los convenios colectivos y fortalece el poder de negociación paritaria de los trabajadores.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-25877-93595/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-25877-93595'
  },
  {
    id: 'bo-nk-2',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'Ley 26.160',
    title: 'Ley 26.160 - Emergencia en Materia de Posesión y Propiedad de Tierras Indígenas',
    date: '23 Nov 2006',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Suspende la ejecución de sentencias de desalojo y ordena el relevamiento técnico-jurídico-catastral de las tierras ocupadas tradicionalmente por comunidades indígenas.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-26160-122499/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-26160-122499'
  },
  {
    id: 'bo-cfk-1',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'Ley 26.485',
    title: 'Ley 26.485 - Protección Integral para Prevenir, Sancionar y Erradicar la Violencia contra las Mujeres',
    date: '01 Abr 2009',
    axis: 'Perspectiva de Género',
    summary: 'Tipifica las violencias física, psicológica, sexual, económica, patrimonial y simbólica, transformando el marco jurídico de protección de derechos y relaciones de género.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-26485-152155/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-26485-152155'
  },
  {
    id: 'bo-cfk-2',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'DNU 1602/2009',
    title: 'Decreto 1602/2009 - Creación de la Asignación Universal por Hijo para Protección Social (AUH)',
    date: '29 Oct 2009',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Extiende las asignaciones familiares a trabajadores no registrados y desocupados, reconfigurando la política social y el piso de ingresos de la niñez.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/decreto-1602-2009-159466/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/decreto-1602-2009-159466'
  },
  {
    id: 'bo-cfk-3',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'Ley 26.741',
    title: 'Ley 26.741 - Soberanía Hidrocarburífera de la República Argentina y Expropiación del 51% de YPF',
    date: '04 May 2012',
    axis: 'Extractivismo y Minería',
    summary: 'Declara de interés público nacional el autoabastecimiento de hidrocarburos y recupera el control estatal de YPF, impulsando el desarrollo a gran escala de Vaca Muerta en Neuquén y Río Negro.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-26741-196894/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-26741-196894'
  },
  {
    id: 'bo-cfk-4',
    period: 'Néstor Kirchner y Cristina Fernández (2003-2015)',
    normType: 'Ley 26.743',
    title: 'Ley 26.743 - Derecho a la Identidad de Género de las Personas',
    date: '23 May 2012',
    axis: 'Perspectiva de Género',
    summary: 'Reconoce el derecho a la identidad de género autopercibida sin requisitos patologizantes ni judiciales y garantiza el acceso integral a la salud.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-26743-197860/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-26743-197860'
  },
  {
    id: 'bo-mm-1',
    period: 'Mauricio Macri (2015-2019)',
    normType: 'DNU 267/2015',
    title: 'Decreto 267/2015 - Creación del ENACOM y Modificación de la Ley de Servicios de Comunicación Audiovisual',
    date: '29 Dic 2015',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Modifica por Decreto de Necesidad y Urgencia los límites a la concentración de licencias de medios y altera la estructura regulatoria de la Ley 26.522.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/decreto-267-2015-257461/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/decreto-267-2015-257461'
  },
  {
    id: 'bo-mm-2',
    period: 'Mauricio Macri (2015-2019)',
    normType: 'DNU 70/2017',
    title: 'Decreto 70/2017 - Modificación de la Ley de Migraciones 25.871',
    date: '27 Ene 2017',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Endurece los controles migratorios y crea un procedimiento sumarísimo de expulsión, restringiendo garantías de defensa (posteriormente derogado en 2021).',
    url: 'https://www.argentina.gob.ar/normativa/nacional/decreto-70-2017-271245/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/decreto-70-2017-271245'
  },
  {
    id: 'bo-mm-3',
    period: 'Mauricio Macri (2015-2019)',
    normType: 'Ley 27.426',
    title: 'Ley 27.426 - Reforma Previsional y Modificación de la Fórmula de Movilidad Jubilatoria',
    date: '28 Dic 2017',
    axis: 'Configuraciones y Reformas Laborales',
    summary: 'Cambia el cálculo de actualización de haberes jubilatorios y asignaciones sociales, además de elevar la opción de edad jubilatoria a los 70 años.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27426-305262/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-27426-305262'
  },
  {
    id: 'bo-mm-4',
    period: 'Mauricio Macri (2015-2019)',
    normType: 'Ley 27.453',
    title: 'Ley 27.453 - Régimen de Regularización Dominial para la Integración Socio Urbana (RENABAP)',
    date: '25 Oct 2018',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Declara de utilidad pública y sujetos a expropiación los terrenos de barrios populares relevados en el RENABAP y suspende desalojos.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27453-315739/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-27453-315739'
  },
  {
    id: 'bo-af-1',
    period: 'Alberto Fernández (2019-2023)',
    normType: 'DNU 34/2019',
    title: 'Decreto 34/2019 - Emergencia Pública en Materia Ocupacional y Doble Indemnización por Despidos',
    date: '13 Dic 2019',
    axis: 'Configuraciones y Reformas Laborales',
    summary: 'Declara la emergencia ocupacional y establece el derecho a percibir el doble de la indemnización legal en casos de despido sin justa causa.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/decreto-34-2019-333297/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/decreto-34-2019-333297'
  },
  {
    id: 'bo-af-2',
    period: 'Alberto Fernández (2019-2023)',
    normType: 'Ley 27.551',
    title: 'Ley 27.551 - Reforma del Código Civil y Comercial sobre Contratos de Locación (Ley de Alquileres)',
    date: '11 Jun 2020',
    axis: 'Desigualdades Socio-Territoriales',
    summary: 'Establece un plazo mínimo legal de 3 años para alquileres habitacionales y actualización anual mediante índice mixto entre inflación (IPC) y salarios (RIPTE).',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27551-339378/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-27551-339378'
  },
  {
    id: 'bo-af-3',
    period: 'Alberto Fernández (2019-2023)',
    normType: 'Ley 27.610',
    title: 'Ley 27.610 - Acceso a la Interrupción Voluntaria del Embarazo (IVE) y Atención Posaborto',
    date: '30 Dic 2020',
    axis: 'Perspectiva de Género',
    summary: 'Consagra el derecho a decidir la interrupción del embarazo hasta la semana 14 inclusive y regula su cobertura gratuita en todo el sistema de salud.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27610-346231/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-27610-346231'
  },
  {
    id: 'bo-af-4',
    period: 'Alberto Fernández (2019-2023)',
    normType: 'Ley 27.636',
    title: 'Ley 27.636 - Promoción del Acceso al Empleo Formal para Personas Travestis, Transexuales y Transgénero',
    date: '24 Jun 2021',
    axis: 'Perspectiva de Género',
    summary: 'Ley Diana Sacayán - Lohana Berkins: establece un cupo mínimo del 1% de los cargos del sector público nacional e incentivos para la contratación registrada.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27636-351815/texto',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional/ley-27636-351815'
  },
  {
    id: 'bo-jm-1',
    period: 'Javier Milei (2023-Presente)',
    normType: 'DNU 70/2023',
    title: 'Decreto 70/2023 - Bases para la Reconstrucción de la Economía Argentina (Desregulación Económica)',
    date: '20 Dic 2023',
    axis: 'Configuraciones y Reformas Laborales',
    summary: 'Deroga la Ley de Alquileres, la Ley de Abastecimiento y la Ley de Tierras, impulsa privatizaciones de empresas públicas y reforma el régimen laboral.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/decreto-70-2023-395521/texto',
    boUrl: 'https://www.boletinoficial.gob.ar/detalleAviso/primera/301122/20231221'
  },
  {
    id: 'bo-jm-2',
    period: 'Javier Milei (2023-Presente)',
    normType: 'Ley 27.742',
    title: 'Ley 27.742 - Ley de Bases y Puntos de Partida para la Libertad de los Argentinos (RIGI y Reforma Laboral)',
    date: '27 Jun 2024',
    axis: 'Políticas de Inversión (RIGI / Súper RIGI)',
    summary: 'Crea el Régimen de Incentivo para Grandes Inversiones (RIGI) con beneficios fiscales, aduaneros y cambiarios por 30 años, y elimina multas por trabajo no registrado.',
    url: 'https://www.argentina.gob.ar/normativa/nacional/ley-27742-401266/texto',
    boUrl: 'https://www.boletinoficial.gob.ar/detalleAviso/primera/310188/20240708'
  },
  {
    id: 'bo-jm-3',
    period: 'Javier Milei (2023-Presente)',
    normType: 'DNU 1083/2024',
    title: 'Decreto 1083/2024 - Derogación de la Prórroga de la Emergencia Territorial Indígena (Ley 26.160)',
    date: '09 Dic 2024',
    axis: 'Extractivismo y Minería',
    summary: 'Da por finalizada la emergencia en materia de posesión y propiedad de tierras indígenas, habilitando nuevamente procesos de desalojo en territorios comunitarios.',
    url: 'https://www.boletinoficial.gob.ar/detalleAviso/primera/317965/20241210',
    boUrl: 'https://www.argentina.gob.ar/normativa/nacional'
  }
];

// Noticias verificadas con enlaces directos a articulos especificos reales
const fallbackNews = [
  {
    id: 'base-extract-1',
    tag: 'Extractivismo y Minería',
    title: 'Audiencia contra los proyectos extractivistas y en defensa del Golfo San Matías en Río Negro',
    date: '12 Nov 2026',
    source: 'Agencia Farco',
    url: 'https://agencia.farco.org.ar/noticias/rio-negro-hoy-una-audiencia-contra-los-proyectos-extractivistas-y-en-defensa-del-golfo-san-matias/',
    snippet: 'Comunidades y asambleas socioambientales de Río Negro exponen las problemáticas sociales, la disputa por el agua y el impacto ambiental de los proyectos extractivos.'
  },
  {
    id: 'base-rigi-1',
    tag: 'Políticas de Inversión (RIGI / Súper RIGI)',
    title: 'Neuquén y Río Negro capturan el 56% del RIGI con proyectos en Vaca Muerta',
    date: '09 Nov 2026',
    source: 'VacaMuerta.ar',
    url: 'https://vacamuerta.ar/neuquen-y-rio-negro-capturan-el-56-del-rigi-con-vaca-muerta/',
    snippet: 'Tensiones derivadas de las políticas de incentivo a las inversiones (RIGI y Súper RIGI) frente a las asimetrías laborales y territoriales en Neuquén y Río Negro.'
  },
  {
    id: 'base-laboral-1',
    tag: 'Configuraciones y Reformas Laborales',
    title: 'Juicios laborales en Río Negro: aumentaron las causas tras las reformas en el sector del trabajo',
    date: '19 Oct 2026',
    source: 'Diario Río Negro',
    url: 'https://www.rionegro.com.ar/politica/juicios-laborales-en-rio-negro-aumentaron-las-causas-y-hubo-un-salto-en-los-acuerdos-de-conciliacion/',
    snippet: 'Impacto de las reformas laborales sobre la estabilidad de los trabajadores de la zona y sus condiciones para garantizar la reproducción de la vida.'
  },
  {
    id: 'base-desig-1',
    tag: 'Desigualdades Socio-Territoriales',
    title: 'Índice de pobreza e indigencia: qué pasó en Neuquén y Río Negro frente al crecimiento extractivo',
    date: '24 Sep 2026',
    source: 'Diario Río Negro',
    url: 'https://www.rionegro.com.ar/economia/indice-de-pobreza-e-indigencia-que-paso-en-neuquen-rio-negro-y-la-patagonia-en-el-primer-semestre-del-2026-4735560/',
    snippet: 'Contraste socio-territorial en Río Negro y Neuquén entre los anuncios de inversión y la brecha en el acceso real al trabajo, vivienda y servicios básicos.'
  },
  {
    id: 'base-genero-1',
    tag: 'Perspectiva de Género',
    title: 'Pueblos originarios, mujeres y luchas territoriales en la Norpatagonia',
    date: 'Oct 2026',
    source: 'elDiarioAR',
    url: 'https://www.eldiarioar.com/temas/pueblos-originarios/',
    snippet: 'Articulación entre perspectiva de género, defensa comunitaria del territorio y organización frente a las violencias y asimetrías de poder en la región.'
  },
  {
    id: 'base-unco-1',
    tag: 'UNCo (Fiske Menuco / Neuquén)',
    title: 'Ruta 40, universidad y territorio: debates desde la comunidad universitaria regional',
    date: 'Ago 2026',
    source: 'Vivo Informado',
    url: 'https://www.vivoinformado.com.ar/2026/08/ruta-40-universidad-y-radares-javier.html',
    snippet: 'Vinculación del conocimiento académico de la Universidad Nacional del Comahue en Fiske Menuco (General Roca) y Neuquén con las problemáticas del territorio.'
  }
];

// Consultas RSS cortas y limpias
const thematicFeeds = [
  {
    tag: 'Extractivismo y Minería',
    rss: 'https://news.google.com/rss/search?q=extractivismo OR megamineria OR fracking OR Calcatreu OR "Golfo San Matias" agua OR ambiental "Rio Negro" OR Neuquen -accidente -choque&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Desigualdades Socio-Territoriales',
    rss: 'https://news.google.com/rss/search?q=pobreza OR desigualdad OR alquileres OR habitacional OR "barrios populares" "Rio Negro" OR Neuquen OR Cipolletti OR Bariloche OR Roca -accidente -choque&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Configuraciones y Reformas Laborales',
    rss: 'https://news.google.com/rss/search?q="reforma laboral" OR precarizacion OR despidos OR paritarias OR Unter OR ATE "Rio Negro" OR Neuquen OR Roca -accidente -choque&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Políticas de Inversión (RIGI / Súper RIGI)',
    rss: 'https://news.google.com/rss/search?q=RIGI OR "Super RIGI" inversiones "Rio Negro" OR Neuquen OR "Vaca Muerta" -accidente -futbol&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Perspectiva de Género',
    rss: 'https://news.google.com/rss/search?q="violencia de genero" OR "perspectiva de genero" OR feminismo OR femicidio OR LGBTIQ "Rio Negro" OR Neuquen OR Roca OR Bariloche -accidente -choque -papa&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'UNCo (Fiske Menuco / Neuquén)',
    rss: 'https://news.google.com/rss/search?q="Universidad Nacional del Comahue" OR UNCo OR FADECS OR ADUNC "General Roca" OR "Fiske Menuco" OR Neuquen -accidente -futbol&hl=es-419&gl=AR&ceid=AR:es-419'
  }
];

const DEFAULT_ROOMS = [
  { id: 'sala-1', name: 'Monografía 1', allowedEmails: [] },
  { id: 'sala-2', name: 'Monografía 2', allowedEmails: [] },
  { id: 'sala-3', name: 'Monografía 3', allowedEmails: [] }
];

// Lectura segura de cache RSS desde localStorage al iniciar
const getInitialCachedNews = () => {
  try {
    const raw = localStorage.getItem(NEWS_STORAGE_KEY);
    if (!raw) return fallbackNews;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed.items;
    }
    return fallbackNews;
  } catch {
    return fallbackNews;
  }
};

// Lectura segura del respaldo offline de normas legislativas en localStorage
const getInitialOfflineNorms = () => {
  try {
    const raw = localStorage.getItem(OFFLINE_NORMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const FadecsWorkspace = () => {
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('chat-general');
  const [roomsList, setRoomsList] = useState(DEFAULT_ROOMS);
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [editingRoomName, setEditingRoomName] = useState('');

  // Control de documentos, privacidad de sala y registro 24h con enlaces fijos
  const [activeDocUrl, setActiveDocUrl] = useState('');
  const [docInput, setDocInput] = useState('');
  const [docError, setDocError] = useState('');
  const [roomAllowedEmails, setRoomAllowedEmails] = useState([]);
  const [newAllowedEmailInput, setNewAllowedEmailInput] = useState('');

  const [lastArchiveSyncMs, setLastArchiveSyncMs] = useState(0);
  const [isSyncingArchive, setIsSyncingArchive] = useState(false);
  const [archiveStatusMsg, setArchiveStatusMsg] = useState('');
  const [compiledGeneralText, setCompiledGeneralText] = useState('');
  const [compiledSalasText, setCompiledSalasText] = useState('');
  const [archivePreviewTab, setArchivePreviewTab] = useState('general');

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [roomTab, setRoomTab] = useState('doc');
  const [newsList, setNewsList] = useState(getInitialCachedNews);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [loadingNews, setLoadingNews] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('Todos');

  // Buscador del repertorio historico + bases InfoLEG/SAIJ unificadas + Respaldo Offline
  const [selectedGazetteAxis, setSelectedGazetteAxis] = useState('Todas');
  const [gazetteSearch, setGazetteSearch] = useState('');
  const [appliedGazetteSearch, setAppliedGazetteSearch] = useState('');
  const [infolegExtraNorms, setInfolegExtraNorms] = useState(getInitialOfflineNorms);
  const [infolegLoaded, setInfolegLoaded] = useState(false);
  const [loadingInfoleg, setLoadingInfoleg] = useState(false);
  const [infolegRelations, setInfolegRelations] = useState(null);
  const [loadingRelations, setLoadingRelations] = useState(false);
  const [expandedNormId, setExpandedNormId] = useState(null);
  const [copiedLinkId, setCopiedLinkId] = useState('');
  const [offlineStatusMsg, setOfflineStatusMsg] = useState('');

  const chatEndRef = useRef(null);
  const chatScrollTimerRef = useRef(null);
  const archiveRunningRef = useRef(false);
  const rssFetchingRef = useRef(false);
  const rssControllersRef = useRef(new Set());
  const rssRequestIdRef = useRef(0);

  const userEmailLower = user?.email ? user.email.toLowerCase().trim() : '';
  const isAdmin = ADMIN_EMAILS.includes(userEmailLower);

  // Carga bajo demanda de /data/infoleg-busqueda.json y guardado automatico en cache offline local
  const loadInfolegOnDemand = async () => {
    if (infolegLoaded || loadingInfoleg) return;
    setLoadingInfoleg(true);
    try {
      const res = await fetch('/data/infoleg-busqueda.json');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const mapped = data.map((n) => {
            const label = `${n.tipo_norma || 'Norma'} ${n.numero_norma || ''}`.trim();
            const fullUrl = sanitizeInfolegLink(n.texto_actualizado || n.texto_original, label);
            const boFichaUrl = sanitizeInfolegLink(n.texto_original || n.texto_actualizado, label);
            const resolvedPeriod = n.period && n.period.trim()
              ? n.period
              : resolvePeriodFromDate(n.fecha_sancion);
            return {
              id: `infoleg-${n.id_norma}`,
              rawId: String(n.id_norma),
              period: resolvedPeriod,
              normType: label || 'Norma Nacional',
              title: n.titulo_resumido || n.titulo_sumario || label || 'Norma Nacional',
              date: n.fecha_sancion || 'S/F',
              axis: n.axis && n.axis.trim() ? n.axis : 'Todas',
              summary: n.texto_resumido || n.titulo_sumario || 'Sin resumen disponible.',
              url: fullUrl,
              boUrl: boFichaUrl,
              modificaCount: Number(n.modifica_a) || 0,
              modificadaPorCount: Number(n.modificada_por) || 0
            };
          });
          setInfolegExtraNorms(mapped);
          try {
            localStorage.setItem(OFFLINE_NORMS_STORAGE_KEY, JSON.stringify(mapped.slice(0, 400)));
          } catch {
            // Si excede la cuota de localStorage, mantiene en memoria RAM
          }
        }
      }
      setInfolegLoaded(true);
    } catch (err) {
      console.error('Error al cargar base InfoLEG bajo demanda:', err);
      setInfolegLoaded(true);
    } finally {
      setLoadingInfoleg(false);
    }
  };

  const executeGazetteSearch = async (termOverride) => {
    const rawTerm = typeof termOverride === 'string' ? termOverride : gazetteSearch;
    setAppliedGazetteSearch(rawTerm.trim());
    if (!infolegLoaded) {
      await loadInfolegOnDemand();
    }
  };

  const handleCopyNormLink = async (itemId, urlToCopy) => {
    const cleanUrl = sanitizeInfolegLink(urlToCopy);
    try {
      await navigator.clipboard.writeText(cleanUrl);
      setCopiedLinkId(itemId);
      setTimeout(() => setCopiedLinkId(''), 2000);
    } catch {
      const tempInput = document.createElement('input');
      tempInput.value = cleanUrl;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand('copy');
      document.body.removeChild(tempInput);
      setCopiedLinkId(itemId);
      setTimeout(() => setCopiedLinkId(''), 2000);
    }
  };

  // Descarga individual offline (.txt) de cualquier ley/DNU para guardar en carpeta ante links caidos
  const handleDownloadSingleNormOffline = (item, relData) => {
    const modificaList = (relData?.modifica_a || []).map(m => `  - ${m.tipo} ${m.numero} (${m.fecha})`).join('\n') || '  Sin registros cargados';
    const modificadaPorList = (relData?.modificada_por || []).map(m => `  - ${m.tipo} ${m.numero} (${m.fecha})`).join('\n') || '  Sin registros cargados';
    const content = [
      `=== RESPALDO NORMATIVO OFFLINE - JIFADECS 2027 ===`,
      `Norma: ${item.normType}`,
      `Título: ${item.title}`,
      `Período Presidencial: ${item.period}`,
      `Eje Temático: ${item.axis}`,
      `Fecha de Promulgación / Publicación: ${item.date}`,
      `Identificador: ${item.rawId || item.id}`,
      ``,
      `--- RESUMEN / SUMARIO NORMATIVO ---`,
      `${item.summary}`,
      ``,
      `--- ENLACES OFICIALES ---`,
      `Texto Completo InfoLEG: ${sanitizeInfolegLink(item.url, item.normType)}`,
      `Ficha Normativa / B.O.: ${sanitizeInfolegLink(item.boUrl || item.url, item.normType)}`,
      ``,
      `--- VÍNCULOS NORMATIVOS ---`,
      `Modifica a:\n${modificaList}`,
      `Modificada por:\n${modificadaPorList}`
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = normalizeText(item.normType || item.id).replace(/[^a-z0-9]+/g, '_');
    a.download = `Ley_Respaldo_${safeName}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Descarga el paquete completo de leyes (.txt y .json) para guardar como respaldo offline en PC/Drive
  const handleEnableAndDownloadOfflineBackup = async (format = 'txt') => {
    setOfflineStatusMsg('Preparando respaldo offline completo de leyes, DNU y resoluciones...');
    if (!infolegLoaded) {
      await loadInfolegOnDemand();
    }
    const seen = new Set();
    const unified = [];
    for (const item of [...officialGazetteNorms, ...infolegExtraNorms]) {
      const key = createDeterministicHash(`${item.normType}-${item.title}`);
      if (!seen.has(key)) {
        seen.add(key);
        unified.push(item);
      }
    }
    try {
      localStorage.setItem(OFFLINE_NORMS_STORAGE_KEY, JSON.stringify(unified.slice(0, 400)));
    } catch {
      // Continuar con la descarga del archivo aunque localStorage este lleno
    }

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(unified, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Respaldo_Offline_Leyes_InfoLEG_JIFADECS2027.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blocks = unified.map((it, idx) => [
        `[${idx + 1}] ${it.normType} | ${it.period}`,
        `Título: ${it.title}`,
        `Eje: ${it.axis} | Fecha: ${it.date}`,
        `Resumen: ${it.summary}`,
        `Enlace InfoLEG: ${sanitizeInfolegLink(it.url, it.normType)}`,
        `Enlace B.O.: ${sanitizeInfolegLink(it.boUrl || it.url, it.normType)}`,
        `------------------------------------------------------------`
      ].join('\n'));
      const header = `=== RESPALDO OFFLINE UNIFICADO DE LEGISLACION E INFOLEG (JIFADECS 2027) ===\nTotal de normas respaldadas: ${unified.length}\nGenerado: ${new Date().toLocaleString('es-AR')}\n\n`;
      const blob = new Blob([header + blocks.join('\n\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Respaldo_Offline_Leyes_InfoLEG_JIFADECS2027.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setOfflineStatusMsg(`✅ Respaldo offline activado en este navegador y archivo descargado (${unified.length} normas). Podés guardarlo en la carpeta de Drive.`);
  };

  // Carga bajo demanda de /data/infoleg-relaciones.json
  const toggleNormRelations = async (rawId) => {
    if (!rawId) return;
    if (expandedNormId === rawId) {
      setExpandedNormId(null);
      return;
    }
    setExpandedNormId(rawId);
    if (!infolegRelations && !loadingRelations) {
      setLoadingRelations(true);
      try {
        const res = await fetch('/data/infoleg-relaciones.json');
        if (res.ok) {
          const data = await res.json();
          setInfolegRelations(data || {});
        } else {
          setInfolegRelations({});
        }
      } catch {
        setInfolegRelations({});
      } finally {
        setLoadingRelations(false);
      }
    }
  };

  // Filtrado de visibilidad silencioso: cada usuario solo ve las salas donde su correo esta habilitado
  const visibleRooms = isAdmin
    ? roomsList
    : roomsList.filter((rm) => {
        const list = Array.isArray(rm.allowedEmails)
          ? rm.allowedEmails.map(e => String(e).toLowerCase().trim())
          : [];
        return list.includes(userEmailLower);
      });

  const isCurrentRoomView = currentView.startsWith('sala-');
  const currentRoomObj = roomsList.find(r => r.id === currentView);
  const currentRoomEmailsFromConfig = Array.isArray(currentRoomObj?.allowedEmails)
    ? currentRoomObj.allowedEmails.map(e => String(e).toLowerCase().trim())
    : [];
  const effectiveAllowedEmails = Array.from(new Set([...currentRoomEmailsFromConfig, ...roomAllowedEmails]));
  const hasRoomAccess = !isCurrentRoomView || isAdmin || effectiveAllowedEmails.includes(userEmailLower);

  // Redireccion silenciosa (sin cartel de bloqueo) si un usuario no autorizado intenta estar en una vista restringida
  useEffect(() => {
    if (!user) return;
    if (currentView === 'registro-debates' && !isAdmin) {
      setCurrentView('chat-general');
      return;
    }
    if (isCurrentRoomView && !hasRoomAccess) {
      setCurrentView('chat-general');
    }
  }, [currentView, isCurrentRoomView, hasRoomAccess, isAdmin, user]);

  // 2. Control de Sesion
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Error al iniciar sesion:', err);
    }
  };

  const logout = () => signOut(auth);

  // 3. Sincronizacion de Configuracion General
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.roomsList) && data.roomsList.length > 0) {
          setRoomsList(data.roomsList.map(r => ({
            ...r,
            allowedEmails: Array.isArray(r.allowedEmails) ? r.allowedEmails : []
          })));
        } else if (data.roomsCount) {
          const count = Math.min(Math.max(1, Number(data.roomsCount) || 3), 30);
          const generated = Array.from({ length: count }).map((_, idx) => ({
            id: `sala-${idx + 1}`,
            name: `Monografía ${idx + 1}`,
            allowedEmails: []
          }));
          setRoomsList(generated);
        }
        setLastArchiveSyncMs(Number(data.lastArchiveSyncMs) || 0);
      }
    });
    return () => unsub();
  }, [user]);

  // Escucha del ultimo registro 24h (solo para cuentas autorizadas)
  useEffect(() => {
    if (!user || !isAdmin || currentView !== 'registro-debates') return;
    const unsubArchive = onSnapshot(doc(db, 'archivos_debates', 'ultimo_registro'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCompiledGeneralText(data.chatGeneralText || '');
        setCompiledSalasText(data.salasDebatesText || '');
      }
    });
    return () => unsubArchive();
  }, [user, isAdmin, currentView]);

  // Crear nueva sala de monografia
  const handleAddRoom = async () => {
    if (!isAdmin || roomsList.length >= 30) return;
    const nextNum = roomsList.length + 1;
    const uniqueId = `sala-${Date.now()}`;
    const updated = [...roomsList, { id: uniqueId, name: `Monografía ${nextNum}`, allowedEmails: [] }];
    setRoomsList(updated);
    try {
      await setDoc(doc(db, 'config', 'general'), { roomsList: updated }, { merge: true });
    } catch (err) {
      console.error('Error al agregar sala:', err);
    }
  };

  // Editar nombre de una monografia especifica
  const handleSaveRoomName = async (roomId) => {
    if (!isAdmin) return;
    const trimmed = editingRoomName.trim();
    if (!trimmed) return;
    const updated = roomsList.map(r => r.id === roomId ? { ...r, name: trimmed } : r);
    setRoomsList(updated);
    setEditingRoomId(null);
    setEditingRoomName('');
    try {
      await setDoc(doc(db, 'config', 'general'), { roomsList: updated }, { merge: true });
    } catch (err) {
      console.error('Error al renombrar sala:', err);
    }
  };

  // Eliminar especificamente la monografia elegida
  const handleDeleteSpecificRoom = async (roomObj) => {
    if (!isAdmin) return;
    if (!window.confirm(`¿Seguro que deseas eliminar "${roomObj.name}" de la lista de grupos?`)) return;
    const updated = roomsList.filter(r => r.id !== roomObj.id);
    setRoomsList(updated);
    if (currentView === roomObj.id) {
      setCurrentView('chat-general');
    }
    try {
      await setDoc(doc(db, 'config', 'general'), { roomsList: updated }, { merge: true });
    } catch (err) {
      console.error('Error al eliminar sala:', err);
    }
  };

  // Agregar correo autorizado a una sala de monografia
  const handleAddAllowedEmail = async (e) => {
    e.preventDefault();
    if (!isAdmin || !isCurrentRoomView) return;
    const cleanEmail = newAllowedEmailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return;
    if (effectiveAllowedEmails.includes(cleanEmail)) {
      setNewAllowedEmailInput('');
      return;
    }
    const updatedEmails = [...effectiveAllowedEmails, cleanEmail];
    setRoomAllowedEmails(updatedEmails);
    const updatedRoomsList = roomsList.map(r =>
      r.id === currentView ? { ...r, allowedEmails: updatedEmails } : r
    );
    setRoomsList(updatedRoomsList);
    setNewAllowedEmailInput('');
    try {
      await Promise.all([
        setDoc(doc(db, 'salas', currentView), { allowedEmails: updatedEmails }, { merge: true }),
        setDoc(doc(db, 'config', 'general'), { roomsList: updatedRoomsList }, { merge: true })
      ]);
    } catch (err) {
      console.error('Error al autorizar correo en la sala:', err);
    }
  };

  // Quitar correo autorizado de una sala
  const handleRemoveAllowedEmail = async (emailToRemove) => {
    if (!isAdmin || !isCurrentRoomView) return;
    const updatedEmails = effectiveAllowedEmails.filter(em => em !== emailToRemove);
    setRoomAllowedEmails(updatedEmails);
    const updatedRoomsList = roomsList.map(r =>
      r.id === currentView ? { ...r, allowedEmails: updatedEmails } : r
    );
    setRoomsList(updatedRoomsList);
    try {
      await Promise.all([
        setDoc(doc(db, 'salas', currentView), { allowedEmails: updatedEmails }, { merge: true }),
        setDoc(doc(db, 'config', 'general'), { roomsList: updatedRoomsList }, { merge: true })
      ]);
    } catch (err) {
      console.error('Error al quitar correo de la sala:', err);
    }
  };

  // 4. Motor de Registro Automatizado cada 24h (Exclusivo para Cuentas Autorizadas)
  const runDebateArchiveSync = async (isManual = false) => {
    if (!isAdmin || archiveRunningRef.current || isSyncingArchive) return;
    archiveRunningRef.current = true;
    setIsSyncingArchive(true);
    if (isManual) setArchiveStatusMsg('Recopilando el Chat General y unificando todas las Salas por su nombre...');

    try {
      const nowStr = new Date().toLocaleString('es-AR');

      // A. Lectura del Chat General
      const genSnap = await getDocs(query(collection(db, 'salas', 'chat-general', 'mensajes'), orderBy('createdAt', 'asc')));
      const generalLines = genSnap.docs.map(d => {
        const m = d.data();
        const dateTxt = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('es-AR') : 'Reciente';
        return `[${dateTxt}] ${m.sender} (${m.email}): ${m.text}`;
      });
      const generalReport = `=== JIFADECS 2027 - CHAT GENERAL INTERDISCIPLINARIO ===\nÚltima actualización: ${nowStr}\nTotal de intervenciones: ${generalLines.length}\n\n` + (generalLines.join('\n') || 'Sin mensajes registrados.');

      // B. Lectura paralela de todas las Salas de Monografia y unificacion en un solo documento separado por Nombre de Sala
      const roomQueries = roomsList.map(async (rm) => {
        const rmSnap = await getDocs(query(collection(db, 'salas', rm.id, 'mensajes'), orderBy('createdAt', 'asc')));
        const rmLines = rmSnap.docs.map(d => {
          const m = d.data();
          const dateTxt = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('es-AR') : 'Reciente';
          return `[${dateTxt}] ${m.sender} (${m.email}): ${m.text}`;
        });
        return `============================================================\nSALA: ${rm.name.toUpperCase()}\nTotal de mensajes en esta sala: ${rmLines.length}\n============================================================\n` + (rmLines.join('\n') || 'Sin intervenciones registradas en esta sala.');
      });

      const roomsBlocks = await Promise.all(roomQueries);
      const salasReport = `=== JIFADECS 2027 - CHAT DE SALAS DE DEBATE (UNIFICADO POR SALA) ===\nÚltima actualización: ${nowStr}\nCantidad de salas registradas: ${roomsList.length}\n\n` + roomsBlocks.join('\n\n\n');

      setCompiledGeneralText(generalReport);
      setCompiledSalasText(salasReport);

      const nowMs = Date.now();
      const combinedHash = createDeterministicHash(generalReport + salasReport);

      await setDoc(doc(db, 'archivos_debates', 'ultimo_registro'), {
        contentHash: combinedHash,
        updatedAtMs: nowMs,
        updatedAtFormatted: nowStr,
        chatGeneralText: generalReport,
        salasDebatesText: salasReport
      }, { merge: true });

      await setDoc(doc(db, 'config', 'general'), { lastArchiveSyncMs: nowMs }, { merge: true });
      try {
        localStorage.setItem(ARCHIVE_CHECK_STORAGE_KEY, String(nowMs));
      } catch {
        // Ignorar si localStorage esta restringido
      }

      if (isManual) {
        setArchiveStatusMsg(`✅ Registro actualizado (${nowStr}). Ya podés copiarlo con 1 toque o abrir el Google Doc.`);
      }
    } catch (err) {
      console.error('Error al sincronizar archivo de debates:', err);
      if (isManual) setArchiveStatusMsg('⚠️ Error al sincronizar el registro. Verifica tu conexión.');
    } finally {
      archiveRunningRef.current = false;
      setIsSyncingArchive(false);
    }
  };

  // Verificador sin bucles para el auto-archivado cada 24 horas (solo se ejecuta en cuentas autorizadas)
  useEffect(() => {
    if (!user || !isAdmin || archiveRunningRef.current) return;
    const now = Date.now();
    let localLastCheck = 0;
    try {
      localLastCheck = Number(localStorage.getItem(ARCHIVE_CHECK_STORAGE_KEY)) || 0;
    } catch {
      localLastCheck = 0;
    }
    const effectiveLastSync = Math.max(lastArchiveSyncMs, localLastCheck);
    if (effectiveLastSync === 0 || now - effectiveLastSync >= AUTO_ARCHIVE_INTERVAL_MS) {
      runDebateArchiveSync(false);
    }
  }, [user, isAdmin]);

  // Copiar directamente al portapapeles del celular para pegar en la app de Google Docs con 1 toque
  const handleCopyArchiveToClipboard = async (type) => {
    if (!isAdmin) return;
    let textToCopy = type === 'general' ? compiledGeneralText : compiledSalasText;
    if (!textToCopy) {
      await runDebateArchiveSync(true);
      textToCopy = type === 'general' ? compiledGeneralText : compiledSalasText;
    }
    try {
      await navigator.clipboard.writeText(textToCopy || 'Sin mensajes registrados aún.');
      setArchiveStatusMsg(
        type === 'general'
          ? '📋 ¡Texto del Chat General copiado! Abrí el Google Doc de abajo y pegalo directo.'
          : '📋 ¡Texto unificado de todas las Salas copiado! Abrí el Google Doc de Salas y pegalo directo.'
      );
    } catch {
      setArchiveStatusMsg('⚠️ Seleccioná el texto del cuadro inferior para copiarlo manualmente.');
    }
  };

  // Descargar en un solo archivo (.txt) el Chat General o todas las Salas separadas por nombre
  const handleDownloadArchiveFile = async (type) => {
    if (!isAdmin) return;
    try {
      const nowStr = new Date().toLocaleString('es-AR');

      if (type === 'general') {
        const snap = await getDocs(query(collection(db, 'salas', 'chat-general', 'mensajes'), orderBy('createdAt', 'asc')));
        const lines = snap.docs.map(d => {
          const m = d.data();
          const dateTxt = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('es-AR') : 'Reciente';
          return `[${dateTxt}] ${m.sender} (${m.email}): ${m.text}`;
        });
        const content = `=== JIFADECS 2027 - CHAT GENERAL INTERDISCIPLINARIO ===\nFecha de corte: ${nowStr}\n\n` + (lines.join('\n') || 'Sin mensajes.');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Chat_General_Interdisciplinario_JIFADECS2027.txt`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const roomPromises = roomsList.map(async (rm) => {
          const rmSnap = await getDocs(query(collection(db, 'salas', rm.id, 'mensajes'), orderBy('createdAt', 'asc')));
          const rmLines = rmSnap.docs.map(d => {
            const m = d.data();
            const dateTxt = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString('es-AR') : 'Reciente';
            return `[${dateTxt}] ${m.sender} (${m.email}): ${m.text}`;
          });
          return `============================================================\nSALA: ${rm.name.toUpperCase()}\n============================================================\n` + (rmLines.join('\n') || 'Sin mensajes en esta sala.');
        });
        const roomsBlocks = await Promise.all(roomPromises);
        const content = `=== JIFADECS 2027 - CHAT DE SALAS DE DEBATE (UNIFICADO POR SALA) ===\nFecha de corte: ${nowStr}\n\n` + roomsBlocks.join('\n\n\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Chat_de_Salas_de_Debate_JIFADECS2027.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Error al generar descarga de debates:', err);
    }
  };

  // 5. Busqueda de noticias con cache persistente en localStorage, control de concurrencia y timeout de 8s
  const fetchLiveNews = async (forceRefresh = false) => {
    if (rssFetchingRef.current) return;

    const now = Date.now();
    if (!forceRefresh) {
      try {
        const rawCache = localStorage.getItem(NEWS_STORAGE_KEY);
        if (rawCache) {
          const parsedCache = JSON.parse(rawCache);
          if (
            parsedCache &&
            Number(parsedCache.timestamp) > 0 &&
            now - Number(parsedCache.timestamp) < NEWS_CACHE_TTL_MS &&
            Array.isArray(parsedCache.items) &&
            parsedCache.items.length > 0
          ) {
            setNewsList(parsedCache.items);
            return;
          }
        }
      } catch {
        // Si falla la lectura de localStorage, continuar con fetch normal
      }
    }

    rssFetchingRef.current = true;
    const requestId = ++rssRequestIdRef.current;
    setLoadingNews(true);

    try {
      const promises = thematicFeeds.map(async (feed) => {
        const controller = new AbortController();
        rssControllersRef.current.add(controller);
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
          const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.rss)}`;
          const res = await fetch(apiUrl, { signal: controller.signal });
          if (!res.ok) return [];
          const data = await res.json();
          if (!data.items || !Array.isArray(data.items)) return [];

          const parsedArticles = [];
          for (const item of data.items) {
            const candidateUrl = extractRealUrlFromHtml(item.description, item.link);
            const directLink = getDirectArticleUrl(candidateUrl);
            if (!directLink) continue;

            const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
            if (!rawTitle) continue;

            const titleParts = rawTitle.split(' - ');
            const cleanTitle = titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ').trim() : rawTitle;
            const extractedSource = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : (item.author || '');
            const sourceName = resolveSourceFromUrl(directLink, extractedSource);

            const rawCleanDesc = stripHtml(item.description || '');
            const realDesc = normalizeText(rawCleanDesc) === normalizeText(cleanTitle) ? '' : rawCleanDesc;

            if (!matchesCategoryStrictly(cleanTitle, realDesc, sourceName, feed.tag)) {
              continue;
            }

            const displaySnippet = realDesc.length > 30
              ? realDesc.slice(0, 165) + '...'
              : `Nota de ${sourceName} sobre ${feed.tag} en Río Negro y Neuquén.`;

            parsedArticles.push({
              id: createDeterministicHash(`${feed.tag}-${cleanTitle}-${directLink}`),
              tag: feed.tag,
              title: cleanTitle,
              date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Actualidad',
              source: sourceName,
              url: directLink,
              snippet: displaySnippet
            });

            if (parsedArticles.length >= 3) break;
          }
          return parsedArticles;
        } catch {
          return [];
        } finally {
          clearTimeout(timeoutId);
          rssControllersRef.current.delete(controller);
        }
      });

      const results = await Promise.all(promises);
      if (requestId !== rssRequestIdRef.current) return;
      const combinedLive = results.flat();

      const seenHashes = new Set();
      const mergedList = [];

      for (const item of [...combinedLive, ...fallbackNews]) {
        const key = createDeterministicHash(item.title);
        if (!seenHashes.has(key)) {
          seenHashes.add(key);
          mergedList.push(item);
        }
      }

      setNewsList(mergedList);
      try {
        localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify({
          timestamp: Date.now(),
          items: mergedList
        }));
      } catch {
        // Ignorar si el almacenamiento local esta lleno
      }
    } catch (err) {
      if (requestId === rssRequestIdRef.current) {
        console.error('Error al actualizar feeds tematicos, manteniendo cache/base:', err);
      }
    } finally {
      if (requestId === rssRequestIdRef.current) {
        rssFetchingRef.current = false;
        setLoadingNews(false);
      }
    }
  };

  useEffect(() => {
    if (currentView !== 'noticias') return undefined;
    fetchLiveNews(false);
    return () => {
      rssRequestIdRef.current += 1;
      rssControllersRef.current.forEach((controller) => controller.abort());
      rssControllersRef.current.clear();
      rssFetchingRef.current = false;
      setLoadingNews(false);
    };
  }, [currentView]);

  // 6. Sincronizacion de metadatos de la Sala (solo si el usuario tiene acceso a esa sala)
  useEffect(() => {
    if (!user || !currentView.startsWith('sala-') || !hasRoomAccess) {
      setRoomAllowedEmails([]);
      setActiveDocUrl('');
      return;
    }
    setDocError('');

    const unsubDoc = onSnapshot(doc(db, 'salas', currentView), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const storedUrl = data.docUrl || '';
        setActiveDocUrl(isValidGoogleUrl(storedUrl) ? storedUrl : '');
        const allowed = Array.isArray(data.allowedEmails)
          ? data.allowedEmails.map(e => String(e).toLowerCase().trim())
          : [];
        setRoomAllowedEmails(allowed);
      } else {
        setActiveDocUrl('');
        setRoomAllowedEmails([]);
      }
    });

    return () => unsubDoc();
  }, [currentView, user, hasRoomAccess]);

  // 7. Sincronizacion de Mensajes optimizada
  useEffect(() => {
    if (!user) return;
    if (currentView !== 'chat-general' && !currentView.startsWith('sala-')) return;
    if (currentView.startsWith('sala-') && !hasRoomAccess) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'salas', currentView, 'mensajes'),
      orderBy('createdAt', 'asc'),
      limit(LIVE_CHAT_LIMIT)
    );

    const unsubChat = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
      clearTimeout(chatScrollTimerRef.current);
      chatScrollTimerRef.current = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    return () => {
      unsubChat();
      clearTimeout(chatScrollTimerRef.current);
    };
  }, [currentView, user, hasRoomAccess]);

  useEffect(() => {
    let scrollTimer;
    if (roomTab === 'chat') {
      scrollTimer = setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
    return () => clearTimeout(scrollTimer);
  }, [roomTab]);

  // 8. Enviar, Editar y Borrar Mensajes
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!hasRoomAccess) return;
    const trimmed = newMessage.trim();
    if (!trimmed || trimmed.length > MAX_MSG_LENGTH || isSending) return;

    setIsSending(true);
    setNewMessage('');
    try {
      await addDoc(collection(db, 'salas', currentView, 'mensajes'), {
        text: trimmed,
        sender: user.displayName || 'Participante',
        email: user.email,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error('Error al enviar mensaje:', err);
      setNewMessage(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (msgId) => {
    if (window.confirm('¿Seguro que deseas eliminar este mensaje?')) {
      try {
        await deleteDoc(doc(db, 'salas', currentView, 'mensajes', msgId));
      } catch (err) {
        console.error('Error al eliminar mensaje:', err);
      }
    }
  };

  const startEditMessage = (msg) => {
    setEditingMsgId(msg.id);
    setEditingText(msg.text);
  };

  const saveEditMessage = async (msgId) => {
    const trimmed = editingText.trim();
    if (!trimmed || trimmed.length > MAX_MSG_LENGTH) return;
    try {
      await updateDoc(doc(db, 'salas', currentView, 'mensajes', msgId), {
        text: trimmed,
        edited: true
      });
      setEditingMsgId(null);
      setEditingText('');
    } catch (err) {
      console.error('Error al editar mensaje:', err);
    }
  };

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    if (!hasRoomAccess) return;
    const trimmedUrl = docInput.trim();

    if (!isValidGoogleUrl(trimmedUrl)) {
      setDocError('Por seguridad, solo se permiten enlaces oficiales de Google Docs o Google Drive.');
      return;
    }

    setDocError('');
    setActiveDocUrl(trimmedUrl);
    setDocInput('');
    try {
      await setDoc(doc(db, 'salas', currentView), { docUrl: trimmedUrl }, { merge: true });
    } catch (err) {
      console.error('Error al guardar enlace del documento:', err);
      setDocError('No se pudo guardar el enlace. Verifica tu conexión.');
    }
  };

  const selectView = (view) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
    setEditingMsgId(null);
    setDocError('');
    setArchiveStatusMsg('');
    setOfflineStatusMsg('');
  };

  const categories = [
    'Todas',
    'Extractivismo y Minería',
    'Desigualdades Socio-Territoriales',
    'Configuraciones y Reformas Laborales',
    'Políticas de Inversión (RIGI / Súper RIGI)',
    'Perspectiva de Género',
    'UNCo (Fiske Menuco / Neuquén)'
  ];
  const filteredNews = useMemo(
    () => selectedCategory === 'Todas' ? newsList : newsList.filter(n => n.tag === selectedCategory),
    [newsList, selectedCategory]
  );

  const periods = [
    'Todos',
    'Néstor Kirchner y Cristina Fernández (2003-2015)',
    'Mauricio Macri (2015-2019)',
    'Alberto Fernández (2019-2023)',
    'Javier Milei (2023-Presente)'
  ];

  // Unificacion de las normas historicas + actualizacion InfoLEG en una sola lista
  const combinedGazetteNorms = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const item of [...officialGazetteNorms, ...infolegExtraNorms]) {
      const key = createDeterministicHash(`${item.normType}-${item.title}`);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  }, [infolegExtraNorms]);

  const filteredNorms = useMemo(() => {
    const q = normalizeText(appliedGazetteSearch || gazetteSearch);
    return combinedGazetteNorms.filter((item) => {
      const matchPeriod = selectedPeriod === 'Todos' || item.period === selectedPeriod;
      const matchAxis = selectedGazetteAxis === 'Todas' || item.axis === selectedGazetteAxis;
      const matchSearch = !q || normalizeText(
        `${item.normType} ${item.title} ${item.summary} ${item.axis} ${item.period} ${item.rawId || ''}`
      ).includes(q);
      return matchPeriod && matchAxis && matchSearch;
    }).slice(0, 40);
  }, [combinedGazetteNorms, selectedPeriod, selectedGazetteAxis, appliedGazetteSearch, gazetteSearch]);

  // PANTALLA DE LOGIN
  if (!user) {
    return (
      <div className="flex h-screen bg-orange-50 items-center justify-center font-sans p-4">
        <div className="bg-white p-6 md:p-8 rounded-xl shadow-lg border border-orange-200 text-center max-w-md w-full">
          <h1 className="text-2xl md:text-3xl font-bold text-orange-800 mb-2">JIFADECS 2027</h1>
          <p className="text-sm md:text-base text-orange-600 mb-8">Diálogo de saberes para los desafíos contemporáneos</p>
          <button onClick={login} className="w-full bg-orange-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-600 transition-colors shadow-md">
            Iniciar sesión con Google
          </button>
        </div>
      </div>
    );
  }

  // INTERFAZ PRINCIPAL ADAPTABLE
  return (
    <div className="flex flex-col md:flex-row h-screen bg-orange-50 font-sans text-orange-900 overflow-hidden">

      {/* CABECERA MOVIL */}
      <div className="md:hidden flex items-center justify-between p-3 bg-orange-200 border-b border-orange-300 shadow-sm z-20">
        <div>
          <h1 className="text-lg font-bold text-orange-900 leading-tight">JIFADECS 2027</h1>
          <p className="text-[11px] text-orange-700 truncate max-w-[200px]">{user.displayName}</p>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="px-3 py-1.5 bg-orange-500 text-white rounded-md font-bold text-sm shadow"
        >
          {isMobileMenuOpen ? '✕ Cerrar' : '☰ Menú / Salas'}
        </button>
      </div>

      {/* BARRA LATERAL */}
      <div className={`${isMobileMenuOpen ? 'fixed inset-0 top-[57px] z-30 flex' : 'hidden'} md:relative md:top-0 md:flex w-full md:w-64 bg-orange-100 border-r border-orange-200 flex-col shadow-sm`}>
        <div className="hidden md:block p-4 border-b border-orange-200 bg-orange-200/50">
          <h1 className="text-xl font-bold text-orange-800">JIFADECS 2027</h1>
          <p className="text-xs text-orange-700 mt-1 truncate">{user.displayName}</p>
          {isAdmin && <span className="inline-block mt-1 px-2 py-0.5 bg-orange-600 text-white text-[10px] font-bold rounded">Coordinación Autorizada</span>}
          <button onClick={logout} className="block text-xs text-orange-500 hover:text-orange-800 mt-2 font-semibold">Cerrar sesión</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-orange-500 uppercase tracking-wider mb-2">General</h2>
            <button onClick={() => selectView('chat-general')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${currentView === 'chat-general' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>💬 Chat General</button>
            <button onClick={() => selectView('noticias')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium ${currentView === 'noticias' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>📰 Ejes y Noticias</button>
            <button onClick={() => selectView('boletin-oficial')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium ${currentView === 'boletin-oficial' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>📜 Boletín Oficial / DNU</button>
            <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
              <strong>Importante:</strong> Solo descargar base completa de InfoLEG y SAIJ si es necesario; si no, utilizarlas como apoyo de búsqueda.
            </p>
            <button onClick={() => selectView('norpatagonia')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-2 text-sm font-medium ${currentView === 'norpatagonia' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>🧭 Norpatagonia</button>
            <button onClick={() => selectView('requisitos-ponencias')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium ${currentView === 'requisitos-ponencias' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>
              📝 Requisitos y preparación previa de ponencias
            </button>
            {isAdmin && (
              <button onClick={() => selectView('registro-debates')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium ${currentView === 'registro-debates' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>🗂️ Registro Debates (24h)</button>
            )}
            <a
              href={DRIVE_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium hover:bg-orange-200 text-orange-800 flex items-center justify-between"
            >
              <span>📚 Repositorio Bibliográfico</span>
              <span className="text-xs opacity-70">↗</span>
            </a>
          </div>

          {(isAdmin || visibleRooms.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-orange-500 uppercase tracking-wider">Grupos de Trabajo</h2>
                {isAdmin && (
                  <button
                    onClick={handleAddRoom}
                    title="Crear nueva sala de monografía"
                    className="px-2 py-0.5 bg-orange-500 text-white rounded hover:bg-orange-600 text-xs font-bold shadow-sm"
                  >
                    + Sala
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {visibleRooms.map((rm) => (
                  <div key={rm.id} className="flex flex-col gap-1">
                    {editingRoomId === rm.id && isAdmin ? (
                      <div className="flex items-center gap-1 bg-white p-1.5 rounded border border-orange-300">
                        <input
                          type="text"
                          value={editingRoomName}
                          onChange={(e) => setEditingRoomName(e.target.value)}
                          className="w-full px-1.5 py-0.5 text-xs border border-orange-200 rounded outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleSaveRoomName(rm.id)} className="px-1.5 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded">OK</button>
                        <button onClick={() => setEditingRoomId(null)} className="px-1.5 py-0.5 bg-gray-200 text-gray-700 text-[10px] rounded">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => selectView(rm.id)}
                          className={`flex-1 text-left px-3 py-2 rounded-md transition-colors text-sm font-medium truncate ${currentView === rm.id ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}
                        >
                          📝 {rm.name}
                        </button>
                        {isAdmin && (
                          <div className="flex items-center shrink-0">
                            <button
                              onClick={() => { setEditingRoomId(rm.id); setEditingRoomName(rm.name); }}
                              title="Renombrar esta monografía"
                              className="p-1 text-orange-700 hover:bg-orange-200 rounded text-xs"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteSpecificRoom(rm)}
                              title="Eliminar esta monografía"
                              className="p-1 text-red-600 hover:bg-red-100 rounded text-xs"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="md:hidden pt-4 border-t border-orange-200">
            <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-red-600 font-semibold">Cerrar sesión</button>
          </div>
        </div>
      </div>

      {/* AREA PRINCIPAL */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">

        {/* VISTA 1: EJES Y NOTICIAS REGIONALES */}
        {currentView === 'noticias' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Actualidad Regional y Ejes Metodológicos</h2>
                <p className="text-xs md:text-sm text-orange-600 mt-1">Río Negro y Neuquén (ciudades y poblados): extractivismo, agua, desigualdades, trabajo, género y UNCo.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => fetchLiveNews(true)}
                  disabled={loadingNews}
                  className="px-3 py-2 bg-orange-200 text-orange-900 rounded-lg font-semibold text-xs md:text-sm hover:bg-orange-300 transition-colors disabled:opacity-50"
                >
                  {loadingNews ? '🔄 Filtrando notas...' : '🔄 Actualizar titulares'}
                </button>
                <a
                  href="https://www.diariosargentinos.com.ar/web"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg font-bold text-xs md:text-sm hover:bg-orange-600 shadow transition-colors flex items-center gap-1"
                >
                  🗞️ Diarios Argentinos ↗
                </a>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-6 pb-2 border-b border-orange-200">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${selectedCategory === cat ? 'bg-orange-600 text-white shadow-sm' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {filteredNews.map(news => (
                <div key={news.id} className="bg-white p-4 md:p-6 rounded-lg shadow-sm border border-orange-100 hover:shadow-md transition-shadow flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="inline-block px-2.5 py-0.5 bg-orange-100 text-orange-800 text-[11px] font-bold rounded-full">{news.tag}</span>
                      <span className="text-[11px] text-orange-500 font-medium text-right">{news.date} • {news.source}</span>
                    </div>
                    <h3 className="text-base md:text-lg font-bold text-orange-900 mb-2 leading-snug">{news.title}</h3>
                    <p className="text-orange-700 text-xs md:text-sm mb-4 line-clamp-3">{news.snippet}</p>
                  </div>
                  <a href={news.url} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-bold text-xs md:text-sm hover:text-orange-800 self-start">Leer artículo completo →</a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VISTA: FUENTES NORMATIVAS DE RÍO NEGRO Y NEUQUÉN */}
        {currentView === 'norpatagonia' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <div className="mb-6">
              <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Norpatagonia</h2>
              <p className="mt-1 text-xs md:text-sm text-orange-700">
                Fuentes oficiales de legislación, digesto jurídico y boletines de Río Negro y Neuquén.
              </p>
            </div>
            <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs md:text-sm leading-relaxed text-amber-950">
              <strong>Los links caídos no corresponden a problemas de esta pagina; sino, al no cumplimiento dispuesto en la <a href={ACCESS_TO_INFO_URL} target="_blank" rel="noopener noreferrer" className="underline">Ley 27.275 sobre el Acceso a la Información Publica</a>.</strong>
            </div>
            <div className="flex flex-wrap gap-3 mb-5">
              <a
                href={SOURCES_DRIVE_FOLDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-orange-700"
              >
                📁 Abrir carpeta de documentación compartida ↗
              </a>
              <a
                href="/data/saij-norpatagonia.json"
                download="Respaldo_Offline_SAIJ_Norpatagonia.json"
                className="inline-flex rounded-lg bg-white border border-orange-300 px-4 py-2.5 text-sm font-bold text-orange-900 shadow-sm hover:bg-orange-100"
              >
                ⬇️ Descargar Respaldo Offline SAIJ Provincial (.json)
              </a>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {norpatagoniaPortals.map((portal) => (
                <section key={portal.province} className="rounded-xl border border-orange-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-lg font-bold text-orange-900">{portal.province}</h3>
                  <ul className="space-y-2">
                    {portal.links.map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between rounded-lg bg-orange-50 px-3 py-2.5 text-sm font-semibold text-orange-800 hover:bg-orange-100"
                        >
                          <span>{link.label}</span>
                          <span aria-hidden="true">↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}

        {/* VISTA: REQUISITOS Y PREPARACION PREVIA DE PONENCIAS */}
        {currentView === 'requisitos-ponencias' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <article className="mx-auto max-w-4xl rounded-xl border border-orange-200 bg-white p-5 md:p-8 shadow-sm">
              <h2 className="mb-5 text-2xl md:text-3xl font-bold text-orange-800">
                Requisitos y preparación previa de ponencias
              </h2>
              <div className="space-y-4 text-sm md:text-base leading-relaxed text-orange-950">
                <p>
                  Durante las cuatro semanas previas a la fecha fijada para el evento, se conformarán grupos interdisciplinarios de trabajo, integrados cada uno de ellos por estudiantes de al menos tres carreras distintas; docentes y graduados de las FADECS. El Grupo de trabajo deberá contar con un número mínimo de tres integrantes y un número máximo de diez, siendo los estudiantes mayoría en la conformación del grupo es decir, la mitad más uno. Cada uno de los estudiantes deberá acreditar cinco (5) materias regularizadas de su respectiva carrera.
                </p>
                <p>
                  En la segunda semana el grupo de trabajo deberá informar a la organización el eje temático seleccionado, el nombre, enviar la copia del rendimiento académico de sus estudiantes y las ideas básicas que se desarrollaran en la exposición oral.
                </p>
                <p>
                  En la tercer semana de esta etapa cada grupo deberá remitir la ponencia a la organización siendo esta la fecha límite de entrega:{' '}
                  <a href="mailto:jifadecs@gmail.com" className="font-bold text-orange-700 underline hover:text-orange-900">
                    jifadecs@gmail.com
                  </a>{' '}
                  (Habilitar/ Compartir el documento de la ponencia con el mail anterior). Los requisitos de la ponencia serán los siguientes: máximo de extensión de 7 hojas; normas APA 7ma.
                </p>
              </div>
            </article>
          </div>
        )}

        {/* VISTA 2: BOLETIN OFICIAL Y LEGISLACION HISTORICA CON ENLACES A FUENTES EXTERNAS + RESPALDO OFFLINE */}
        {currentView === 'boletin-oficial' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs md:text-sm leading-relaxed text-amber-950">
              <strong>Los links caídos no corresponden a problemas de esta pagina; sino, al no cumplimiento dispuesto en la <a href={ACCESS_TO_INFO_URL} target="_blank" rel="noopener noreferrer" className="underline">Ley 27.275 sobre el Acceso a la Información Publica</a>.</strong>
            </div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Boletín Oficial y Legislación (InfoLEG)</h2>
                <p className="text-xs md:text-sm text-orange-600 mt-1">
                  Leyes, Decretos de Necesidad y Urgencia (DNU) y marcos normativos vinculados a los ejes temáticos de las Jornadas.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={INFOLEG_DATASET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-white border border-orange-300 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-100 shadow-sm"
                >
                  Base legislativa InfoLEG ↗
                </a>
                <a
                  href={SAIJ_DATASET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-white border border-orange-300 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-100 shadow-sm"
                >
                  Base normativa provincial SAIJ ↗
                </a>
                <a
                  href={INFOLEG_METADATA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-white border border-orange-300 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-100 shadow-sm"
                >
                  📄 Metadatos InfoLEG ↗
                </a>
                <a
                  href={SOURCES_DRIVE_FOLDER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-white border border-orange-300 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-100 shadow-sm"
                >
                  📁 Documentación en Drive ↗
                </a>
                <a
                  href="https://www.boletinoficial.gob.ar/seccion/primera"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 bg-orange-200 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-300 transition-colors"
                >
                  📜 Boletín Oficial del Día ↗
                </a>
                <a
                  href="https://www.argentina.gob.ar/normativa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg font-bold text-xs md:text-sm hover:bg-orange-600 shadow transition-colors"
                >
                  ⚖️ Buscador Nacional InfoLEG ↗
                </a>
                <button
                  type="button"
                  onClick={() => handleEnableAndDownloadOfflineBackup('txt')}
                  disabled={loadingInfoleg}
                  className="px-3 py-2 bg-orange-600 text-white rounded-lg font-bold text-xs md:text-sm hover:bg-orange-700 shadow transition-colors disabled:opacity-50"
                >
                  {loadingInfoleg ? '🔄 Sincronizando...' : '💾 Descargar Respaldo Offline (.txt)'}
                </button>
                <button
                  type="button"
                  onClick={() => handleEnableAndDownloadOfflineBackup('json')}
                  disabled={loadingInfoleg}
                  className="px-3 py-2 bg-orange-100 border border-orange-300 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-200 shadow-sm disabled:opacity-50"
                >
                  ⬇️ Respaldo Base (.json)
                </button>
              </div>
            </div>

            {offlineStatusMsg && (
              <div className="mb-4 p-3 bg-orange-100 border border-orange-300 text-orange-900 text-xs font-semibold rounded-lg">
                {offlineStatusMsg}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                executeGazetteSearch();
              }}
              className="flex gap-2 mb-4"
            >
              <input
                type="search"
                value={gazetteSearch}
                onFocus={loadInfolegOnDemand}
                onChange={(e) => {
                  const val = e.target.value;
                  setGazetteSearch(val);
                  executeGazetteSearch(val);
                }}
                placeholder="Buscar en el repertorio histórico de esta página..."
                className="flex-1 px-4 py-2.5 bg-white border border-orange-300 rounded-lg text-xs md:text-sm text-orange-900 focus:ring-2 focus:ring-orange-400 outline-none shadow-sm"
              />
              <button
                type="submit"
                disabled={loadingInfoleg}
                className="px-4 py-2.5 bg-orange-600 text-white rounded-lg font-bold text-xs md:text-sm hover:bg-orange-700 shadow-sm shrink-0"
              >
                {loadingInfoleg ? '...' : 'Buscar'}
              </button>
            </form>

            <p className="mb-4 text-xs text-orange-700">
              El repertorio local sirve como apoyo de búsqueda. Las bases oficiales se consultan en sus portales mediante los enlaces superiores; esta página no descarga esos archivos salvo que actives el botón de Respaldo Offline.
            </p>

            {/* FILTRO POR TITULOS / EJES METODOLOGICOS DE LAS JORNADAS */}
            <div className="flex flex-wrap gap-2 mb-3">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSelectedGazetteAxis(cat);
                    if (!infolegLoaded) loadInfolegOnDemand();
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${selectedGazetteAxis === cat ? 'bg-orange-600 text-white shadow-sm' : 'bg-orange-100 text-orange-800 hover:bg-orange-200'}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* FILTRO POR PERIODO PRESIDENCIAL */}
            <div className="flex flex-wrap gap-2 mb-6 pb-2 border-b border-orange-200">
              {periods.map(per => (
                <button
                  key={per}
                  type="button"
                  onClick={() => {
                    setSelectedPeriod(per);
                    if (!infolegLoaded) loadInfolegOnDemand();
                  }}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${selectedPeriod === per ? 'bg-orange-800 text-white shadow-sm' : 'bg-orange-200/70 text-orange-900 hover:bg-orange-200'}`}
                >
                  {per}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {filteredNorms.map(item => {
                const rel = item.rawId && infolegRelations ? infolegRelations[item.rawId] : null;
                const isExpanded = item.rawId && expandedNormId === item.rawId;
                const safeFullUrl = sanitizeInfolegLink(item.url, item.normType);
                const safeBoUrl = sanitizeInfolegLink(item.boUrl || item.url, item.normType);

                return (
                  <div key={item.id} className="bg-white p-4 md:p-6 rounded-lg shadow-sm border border-orange-100 hover:shadow-md transition-shadow flex flex-col justify-between">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className="inline-block px-2.5 py-0.5 bg-orange-600 text-white text-[11px] font-bold rounded">{item.normType}</span>
                        <span className="text-[11px] text-orange-700 font-semibold">{item.period}</span>
                      </div>
                      <h3 className="text-base md:text-lg font-bold text-orange-900 mb-2 leading-snug">{item.title}</h3>
                      <p className="text-orange-700 text-xs md:text-sm mb-3">{item.summary}</p>
                      <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-800 text-[10px] font-bold rounded mb-4">
                        Eje vinculado: {item.axis} • Promulgación/Publicación: {item.date}
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-orange-100">
                        <a
                          href={safeFullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-orange-500 text-white rounded-md font-bold text-xs hover:bg-orange-600 shadow-sm transition-colors"
                        >
                          ⚖️ Texto completo en InfoLEG ↗
                        </a>
                        {item.boUrl && (
                          <a
                            href={safeBoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-orange-100 text-orange-900 rounded-md font-semibold text-xs hover:bg-orange-200 transition-colors"
                          >
                            📜 Ficha Normativa / B.O. ↗
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopyNormLink(item.id, safeFullUrl)}
                          className="px-2.5 py-1.5 bg-orange-50 border border-orange-200 text-orange-800 rounded-md font-semibold text-[11px] hover:bg-orange-100"
                        >
                          {copiedLinkId === item.id ? '✅ Copiado' : '📋 Copiar link'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadSingleNormOffline(item, rel)}
                          className="px-2.5 py-1.5 bg-orange-50 border border-orange-200 text-orange-800 rounded-md font-semibold text-[11px] hover:bg-orange-100"
                        >
                          ⬇️ Respaldo (.txt)
                        </button>
                        {item.rawId && (item.modificaCount > 0 || item.modificadaPorCount > 0) && (
                          <button
                            type="button"
                            onClick={() => toggleNormRelations(item.rawId)}
                            className="px-2.5 py-1.5 bg-orange-50 border border-orange-200 text-orange-800 rounded-md font-bold text-[11px] hover:bg-orange-100"
                          >
                            {isExpanded ? '▲ Ocultar vínculos' : `🔗 Vínculos (${item.modificaCount}/${item.modificadaPorCount})`}
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="mt-3 p-3 bg-orange-50/70 rounded border border-orange-200 text-[11px] text-orange-900">
                          {loadingRelations ? (
                            <p>Cargando normas modificadas y modificatorias...</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <strong>Modifica a ({rel?.modifica_a?.length || 0}):</strong>
                                <ul className="list-disc list-inside mt-1 space-y-0.5">
                                  {(rel?.modifica_a || []).map((m, i) => (
                                    <li key={i}>{m.tipo} {m.numero} ({m.fecha})</li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <strong>Modificada por ({rel?.modificada_por?.length || 0}):</strong>
                                <ul className="list-disc list-inside mt-1 space-y-0.5">
                                  {(rel?.modificada_por || []).map((m, i) => (
                                    <li key={i}>{m.tipo} {m.numero} ({m.fecha})</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VISTA 3: REPOSITORIO Y REGISTRO DE DEBATES CADA 24 HORAS (SOLO VISIBLE Y EJECUTABLE POR CUENTAS AUTORIZADAS) */}
        {currentView === 'registro-debates' && isAdmin && (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Repositorio de Debates (Registro cada 24 hs)</h2>
                  <p className="text-xs md:text-sm text-orange-600 mt-1">
                    Tus dos documentos de Google Docs ya están integrados en el código base. Podés abrirlos directo, copiar el registro con 1 toque desde el celular o leerlo acá mismo.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runDebateArchiveSync(true)}
                    disabled={isSyncingArchive}
                    className="px-3 py-2 bg-orange-600 text-white rounded-lg font-bold text-xs md:text-sm hover:bg-orange-700 shadow disabled:opacity-50"
                  >
                    {isSyncingArchive ? '🔄 Actualizando...' : '🔄 Actualizar Registro 24h Ahora'}
                  </button>
                  <a
                    href={CHATS_FOLDER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 bg-orange-200 text-orange-900 rounded-lg font-bold text-xs md:text-sm hover:bg-orange-300"
                  >
                    📁 Carpeta Drive ↗
                  </a>
                </div>
              </div>

              {archiveStatusMsg && (
                <div className="p-3 bg-orange-100 border border-orange-300 text-orange-900 text-xs md:text-sm font-semibold rounded-lg shadow-sm">
                  {archiveStatusMsg}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-5 rounded-xl border border-orange-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 bg-orange-100 text-orange-800 text-xs font-bold rounded-full mb-2">Documento 1 (Fijo en código)</span>
                    <h3 className="text-lg font-bold text-orange-900 mb-1">Chat General Interdisciplinario</h3>
                    <p className="text-xs text-orange-700 mb-4">
                      Historial cronológico de todas las intervenciones del Chat Principal.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <a
                      href={DEFAULT_GENERAL_CHAT_DOC_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 px-4 bg-orange-500 text-white rounded-lg font-bold text-xs md:text-sm text-center hover:bg-orange-600 shadow-sm"
                    >
                      📄 Abrir Google Doc de Chat General ↗
                    </a>
                    <button
                      onClick={() => handleCopyArchiveToClipboard('general')}
                      className="w-full py-2 px-3 bg-orange-200 text-orange-900 rounded-lg font-bold text-xs hover:bg-orange-300"
                    >
                      📋 Copiar registro al portapapeles (para celular)
                    </button>
                    <button
                      onClick={() => handleDownloadArchiveFile('general')}
                      className="w-full py-2 px-3 bg-orange-100 text-orange-800 rounded-lg font-semibold text-xs hover:bg-orange-200"
                    >
                      ⬇️ Descargar archivo (.txt)
                    </button>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-orange-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 bg-orange-100 text-orange-800 text-xs font-bold rounded-full mb-2">Documento 2 (Unificado por Sala)</span>
                    <h3 className="text-lg font-bold text-orange-900 mb-1">Chat de Salas de Debate</h3>
                    <p className="text-xs text-orange-700 mb-4">
                      Reúne en un solo documento los debates de todas las monografías separados por el nombre de cada sala.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <a
                      href={DEFAULT_SALAS_CHAT_DOC_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 px-4 bg-orange-500 text-white rounded-lg font-bold text-xs md:text-sm text-center hover:bg-orange-600 shadow-sm"
                    >
                      📄 Abrir Google Doc de Salas de Debate ↗
                    </a>
                    <button
                      onClick={() => handleCopyArchiveToClipboard('salas')}
                      className="w-full py-2 px-3 bg-orange-200 text-orange-900 rounded-lg font-bold text-xs hover:bg-orange-300"
                    >
                      📋 Copiar todas las Salas al portapapeles (celular)
                    </button>
                    <button
                      onClick={() => handleDownloadArchiveFile('salas')}
                      className="w-full py-2 px-3 bg-orange-100 text-orange-800 rounded-lg font-semibold text-xs hover:bg-orange-200"
                    >
                      ⬇️ Descargar corte unificado (.txt)
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-orange-200 shadow-sm overflow-hidden">
                <div className="flex border-b border-orange-200 bg-orange-100">
                  <button
                    onClick={() => setArchivePreviewTab('general')}
                    className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 ${archivePreviewTab === 'general' ? 'border-orange-600 text-orange-900 bg-white' : 'border-transparent text-orange-700'}`}
                  >
                    👁️ Vista Previa: Chat General
                  </button>
                  <button
                    onClick={() => setArchivePreviewTab('salas')}
                    className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 ${archivePreviewTab === 'salas' ? 'border-orange-600 text-orange-900 bg-white' : 'border-transparent text-orange-700'}`}
                  >
                    👁️ Vista Previa: Salas (Separadas por Nombre)
                  </button>
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-orange-600 font-semibold">
                      Último corte automático 24h: {lastArchiveSyncMs ? new Date(lastArchiveSyncMs).toLocaleString('es-AR') : 'Tocá "Actualizar Registro 24h Ahora" para generar el primer corte'}
                    </span>
                  </div>
                  <pre className="w-full max-h-80 overflow-y-auto p-3 bg-orange-50/70 border border-orange-200 rounded text-[11px] md:text-xs text-orange-950 whitespace-pre-wrap font-mono leading-relaxed">
                    {archivePreviewTab === 'general'
                      ? (compiledGeneralText || 'Todavía no se generó la vista previa. Tocá el botón "🔄 Actualizar Registro 24h Ahora" arriba.')
                      : (compiledSalasText || 'Todavía no se generó la vista previa. Tocá el botón "🔄 Actualizar Registro 24h Ahora" arriba.')}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VISTA 4: SALAS DE MONOGRAFIA (SOLO SI TIENE ACCESO, SIN CARTELES DE BLOQUEO) Y CHAT GENERAL */}
        {(currentView === 'chat-general' || (isCurrentRoomView && hasRoomAccess)) && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">

            {/* PANEL DE GESTION DE INTEGRANTES DE LA SALA (SOLO VISIBLE PARA CUENTAS AUTORIZADAS) */}
            {isCurrentRoomView && isAdmin && (
              <div className="bg-orange-200/70 border-b border-orange-300 px-3 py-2 shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-orange-900">🔒 Integrantes con visibilidad en {currentRoomObj?.name || currentView}:</span>
                    {effectiveAllowedEmails.length === 0 ? (
                      <span className="text-[11px] text-orange-700 italic">Oculta para otros usuarios (agregá correos para que les aparezca esta sala)</span>
                    ) : (
                      effectiveAllowedEmails.map(emailItem => (
                        <span key={emailItem} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white text-orange-900 rounded-full text-[11px] border border-orange-300">
                          {emailItem}
                          <button
                            onClick={() => handleRemoveAllowedEmail(emailItem)}
                            title="Ocultar sala para este correo"
                            className="text-red-600 font-bold hover:text-red-800"
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleAddAllowedEmail} className="flex gap-1.5 shrink-0">
                    <input
                      type="email"
                      value={newAllowedEmailInput}
                      onChange={(e) => setNewAllowedEmailInput(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      className="px-2.5 py-1 text-xs bg-white border border-orange-300 rounded outline-none"
                    />
                    <button type="submit" className="px-3 py-1 bg-orange-600 text-white text-xs font-bold rounded hover:bg-orange-700">
                      + Habilitar Sala
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* SELECTOR DE PESTAÑAS EN TODOS LOS DISPOSITIVOS (PC Y MOVIL) */}
            {isCurrentRoomView && (
              <div className="flex border-b border-orange-200 bg-orange-100 shrink-0">
                <button
                  onClick={() => setRoomTab('doc')}
                  className={`flex-1 py-2.5 md:py-3 text-xs md:text-sm font-bold text-center border-b-2 transition-colors ${roomTab === 'doc' ? 'border-orange-500 text-orange-900 bg-white' : 'border-transparent text-orange-600 hover:bg-orange-200/50'}`}
                >
                  📄 Documento Sala
                </button>
                <button
                  onClick={() => setRoomTab('chat')}
                  className={`flex-1 py-2.5 md:py-3 text-xs md:text-sm font-bold text-center border-b-2 transition-colors ${roomTab === 'chat' ? 'border-orange-500 text-orange-900 bg-white' : 'border-transparent text-orange-600 hover:bg-orange-200/50'}`}
                >
                  💬 Debate ({messages.length})
                </button>
              </div>
            )}

            {/* ZONA DE DOCUMENTO (PESTAÑA DOCUMENTO EN TODOS LOS DISPOSITIVOS) */}
            {isCurrentRoomView && roomTab === 'doc' && (
              <div className="flex flex-1 flex-col bg-white h-full overflow-hidden">
                <div className="p-3 md:p-4 bg-orange-100/30 border-b border-orange-200">
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <p className="text-xs text-yellow-800">
                      ⚠️ <strong>Importante:</strong> Compartir este documento solo con los integrantes del grupo y coordinación.
                    </p>
                    {activeDocUrl && isValidGoogleUrl(activeDocUrl) && (
                      <a
                        href={activeDocUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-orange-600 text-white rounded font-bold text-xs hover:bg-orange-700 shadow-sm whitespace-nowrap self-start sm:self-auto"
                      >
                        📄 Abrir en pestaña de Google Docs ↗
                      </a>
                    )}
                  </div>
                  <form onSubmit={handleDocSubmit} className="flex gap-2">
                    <input
                      type="url"
                      value={docInput}
                      onChange={(e) => setDocInput(e.target.value)}
                      placeholder="Pega el enlace de Google Docs (https://docs.google.com/...)"
                      className="flex-1 px-3 py-1.5 md:py-2 border border-orange-300 rounded text-xs md:text-sm focus:ring-2 focus:ring-orange-400 outline-none"
                    />
                    <button type="submit" className="px-3 md:px-4 py-1.5 md:py-2 bg-orange-500 text-white rounded font-semibold text-xs md:text-sm hover:bg-orange-600 whitespace-nowrap">Incrustar</button>
                  </form>
                  {docError && <p className="text-xs text-red-600 mt-1.5 font-semibold">{docError}</p>}
                </div>

                <div className="flex-1 bg-gray-50 p-1 md:p-2 overflow-hidden">
                  {activeDocUrl && isValidGoogleUrl(activeDocUrl) ? (
                    <iframe
                      src={getEmbeddableGoogleUrl(activeDocUrl)}
                      className="w-full h-full border-0 rounded shadow-inner"
                      title="Documento Colaborativo"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-orange-400 text-xs md:text-sm p-4 text-center">
                      No hay un documento activo en esta sala. Pega el enlace arriba para incrustarlo.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ZONA DE CHAT (PESTAÑA DEBATE EN SALAS O VISTA DE CHAT GENERAL) */}
            {(currentView === 'chat-general' || (isCurrentRoomView && roomTab === 'chat')) && (
              <div className="w-full max-w-4xl mx-auto md:my-6 md:rounded-xl md:shadow-lg md:border flex-1 bg-white flex flex-col border-orange-200 h-full overflow-hidden">
                <div className="p-3 md:p-4 border-b border-orange-200 bg-orange-100/50 flex justify-between items-center">
                  <h3 className="font-bold text-orange-800 text-sm md:text-base">
                    {currentView === 'chat-general' ? 'Chat General Interdisciplinario' : `Debate - ${currentRoomObj?.name || currentView}`}
                  </h3>
                </div>

                <div className="flex-1 p-3 md:p-4 overflow-y-auto bg-orange-50/30 flex flex-col gap-3">
                  {messages.length === 0 && <div className="text-center text-xs text-orange-400 mt-4">Comienza el debate...</div>}
                  {messages.map((msg) => {
                    const isMine = msg.email === user.email;
                    return (
                      <div key={msg.id} className={`max-w-[90%] md:max-w-[85%] p-2.5 md:p-3 rounded-lg text-xs md:text-sm ${isMine ? 'bg-orange-500 text-white self-end rounded-tr-none shadow-sm' : 'bg-orange-100 text-orange-900 self-start rounded-tl-none border border-orange-200'}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`text-[10px] font-bold ${isMine ? 'text-orange-100' : 'text-orange-600'}`}>
                            {msg.sender} {msg.edited && <span className="italic font-normal opacity-80">(editado)</span>}
                          </span>

                          {(isMine || isAdmin) && editingMsgId !== msg.id && (
                            <div className="flex items-center gap-1.5 opacity-80 hover:opacity-100">
                              {(isMine || isAdmin) && (
                                <button onClick={() => startEditMessage(msg)} title="Editar mensaje" className="hover:scale-110 transition-transform text-[11px]">
                                  ✏️
                                </button>
                              )}
                              <button onClick={() => handleDeleteMessage(msg.id)} title="Borrar mensaje" className="hover:scale-110 transition-transform text-[11px]">
                                🗑️
                              </button>
                            </div>
                          )}
                        </div>

                        {editingMsgId === msg.id ? (
                          <div className="mt-1 flex flex-col gap-1.5">
                            <input
                              type="text"
                              value={editingText}
                              maxLength={MAX_MSG_LENGTH}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full px-2 py-1 text-xs text-orange-900 bg-white rounded border border-orange-300 outline-none"
                              autoFocus
                            />
                            <div className="flex justify-end gap-1 text-[10px]">
                              <button onClick={() => setEditingMsgId(null)} className="px-2 py-0.5 bg-orange-700 text-white rounded">Cancelar</button>
                              <button onClick={() => saveEditMessage(msg.id)} className="px-2 py-0.5 bg-white text-orange-600 font-bold rounded shadow">Guardar</button>
                            </div>
                          </div>
                        ) : (
                          <div className="break-words leading-relaxed">{msg.text}</div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={sendMessage} className="p-2.5 md:p-4 border-t border-orange-200 bg-white flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    maxLength={MAX_MSG_LENGTH}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Escribe un mensaje..."
                    className="flex-1 px-3 py-2 text-xs md:text-sm border border-orange-300 rounded focus:ring-2 focus:ring-orange-400 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isSending}
                    className="px-4 py-2 bg-orange-500 text-white rounded font-bold hover:bg-orange-600 text-sm disabled:opacity-50"
                  >
                    →
                  </button>
                </form>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
};

export default FadecsWorkspace;

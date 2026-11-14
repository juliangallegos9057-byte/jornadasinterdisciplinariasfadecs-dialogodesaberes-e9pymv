import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// 1. Configuración de Firebase
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

// Constantes globales
const DRIVE_REPO_URL = "https://drive.google.com/drive/folders/1E-9JMFs1ot4Y1Omp_OJSbcl3Ilu_PfH3";
const MAX_MSG_LENGTH = 1000;
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

// Normalizador de texto: minúsculas y sin tildes
const normalizeText = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

// Generador de hash determinista Argon/FNV-1a para integridad de IDs y deduplicación
const createDeterministicHash = (input) => {
  const clean = normalizeText(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'argon-' + (hash >>> 0).toString(16);
};

// Limpiador de HTML en descripciones RSS
const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/ /gi, ' ')
    .replace(/&/gi, '&')
    .replace(/"/gi, '"')
    .replace(/'/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

// Extrae enlaces directos reales si vienen dentro del HTML de descripción de Google News
const extractRealUrlFromHtml = (htmlString, rawLink) => {
  if (rawLink && !rawLink.includes('news.google.com')) {
    return rawLink.trim();
  }
  if (typeof htmlString === 'string') {
    const hrefMatch = htmlString.match(/href="(https?:\/\/[^"]+)"/i);
    if (hrefMatch && hrefMatch[1] && !hrefMatch[1].includes('news.google.com')) {
      return hrefMatch[1].trim();
    }
  }
  return rawLink ? rawLink.trim() : '';
};

// Validador de seguridad para URLs de Google Docs / Drive
const isValidGoogleUrl = (urlString) => {
  if (!urlString) return false;
  try {
    const parsed = new URL(urlString);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'docs.google.com' || parsed.hostname === 'drive.google.com')
    );
  } catch {
    return false;
  }
};

// Validador estricto de enlace de artículo: rechaza portadas generales y exige ruta de nota real
const getDirectArticleUrl = (urlString) => {
  if (!urlString || typeof urlString !== 'string') return '';
  const trimmed = urlString.trim();
  if (!trimmed || trimmed === '#') return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    // Si no tiene ruta después del dominio (ej. https://www.rionegro.com.ar/), es portada general y se descarta
    if (!cleanPath || cleanPath === '' || cleanPath.length < 4) {
      return '';
    }
    // Evitar páginas índice genéricas sin artículo
    const genericPaths = ['/index.html', '/home', '/inicio', '/portada', '/noticias', '/secciones'];
    if (genericPaths.includes(cleanPath.toLowerCase())) {
      return '';
    }
    return trimmed;
  } catch {
    return '';
  }
};

// Mapeo de nombres de medios según dominio para que coincida siempre el diario con el link
const resolveSourceFromUrl = (urlString, fallbackSource) => {
  try {
    const host = new URL(urlString).hostname.replace(/^www\./, '').toLowerCase();
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

// Ciudades, poblados y referencias territoriales de Río Negro y Neuquén (normalizados sin tildes)
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

// Otras provincias y ciudades fuera de Río Negro y Neuquén (normalizados sin tildes)
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

// Palabras prohibidas globales (sin tildes, comparadas sobre texto normalizado)
const globalExclusions = [
  'accidente', 'choque', 'volco', 'vuelco', 'muerto', 'fallecio', 'fallecido', 'fatal',
  'policial', 'detenido', 'robo', 'asaltaron', 'crimen', 'homicidio', 'autopsia',
  'clima', 'pronostico', 'meteorologico', 'futbol', 'torneo', 'partido', 'colapinto',
  'papa francisco', 'vaticano', 'espectaculo', 'famosos', 'farandula', 'horoscopo',
  'arroyo', 'cayo al', 'cruzar el', 'cruzaba', 'rescate', 'rescataron', 'bomberos',
  'ahogado', 'desaparecido', 'buscan a', 'ambulancia', 'heridos', 'hospitalizaron'
];

// Verifica que la noticia pertenezca a Río Negro o Neuquén y no a otras provincias/ciudades
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

// Clasificador y validador estricto sobre el TEXTO REAL de la noticia (nunca sobre texto inventado)
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

// Noticias verificadas con enlaces directos a artículos específicos reales (nunca portadas generales)
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

// Consultas RSS cortas (respetando el límite de palabras de Google News para que no trunque ni mezcle ejes)
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

const FadecsWorkspace = () => {
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('chat-general');
  const [roomsCount, setRoomsCount] = useState(3);
  const [activeDocUrl, setActiveDocUrl] = useState('');
  const [docInput, setDocInput] = useState('');
  const [docError, setDocError] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileRoomTab, setMobileRoomTab] = useState('chat');
  const [newsList, setNewsList] = useState(fallbackNews);
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [loadingNews, setLoadingNews] = useState(false);

  const chatEndRef = useRef(null);
  const lastFetchTimeRef = useRef(0);
  const isAdmin = user?.email === 'juliangallegos9057@gmail.com';

  // 2. Control de Sesión
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
      console.error('Error al iniciar sesión:', err);
    }
  };

  const logout = () => signOut(auth);

  // 3. Sincronización de Cantidad de Salas
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const count = Number(docSnap.data().roomsCount) || 1;
        setRoomsCount(Math.min(Math.max(1, count), 30));
      }
    });
    return () => unsub();
  }, [user]);

  const updateRoomsCount = async (newCount) => {
    if (!isAdmin) return;
    const boundedCount = Math.min(Math.max(1, newCount), 30);
    setRoomsCount(boundedCount);
    try {
      await setDoc(doc(db, 'config', 'general'), { roomsCount: boundedCount }, { merge: true });
    } catch (err) {
      console.error('Error al actualizar cantidad de salas:', err);
    }
  };

  // 4. Búsqueda automática validando texto real antes de construir cada tarjeta y asegurando enlace directo
  const fetchLiveNews = async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && now - lastFetchTimeRef.current < NEWS_CACHE_TTL_MS) {
      return;
    }

    setLoadingNews(true);
    try {
      const promises = thematicFeeds.map(async (feed) => {
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.rss)}`;
        const res = await fetch(apiUrl);
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

          // Limpiamos la descripción real sin agregar texto artificial antes del filtro
          const rawCleanDesc = stripHtml(item.description || '');
          const realDesc = normalizeText(rawCleanDesc) === normalizeText(cleanTitle) ? '' : rawCleanDesc;

          // Filtramos estrictamente sobre el título y descripción REALES de la nota
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
      });

      const results = await Promise.all(promises);
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
      lastFetchTimeRef.current = Date.now();
    } catch (err) {
      console.error('Error al actualizar feeds temáticos, manteniendo base metodológica:', err);
      setNewsList(fallbackNews);
    } finally {
      setLoadingNews(false);
    }
  };

  useEffect(() => {
    if (currentView === 'noticias') {
      fetchLiveNews(false);
    }
  }, [currentView]);

  // 5. Sincronización de Chat y Documentos por Sala
  useEffect(() => {
    if (!user || currentView === 'noticias') return;
    setDocError('');

    const q = query(collection(db, 'salas', currentView, 'mensajes'), orderBy('createdAt', 'asc'));
    const unsubChat = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap

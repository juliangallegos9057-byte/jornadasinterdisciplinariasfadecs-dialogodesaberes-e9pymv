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

// Generador de hash determinista para evitar noticias duplicadas
const createDeterministicHash = (input) => {
  const clean = normalizeText(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'id-' + (hash >>> 0).toString(16);
};

// Limpiador de HTML en descripciones RSS
const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
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

// Validador estricto de enlace de artículo: exige URL http/https válida y ruta de nota (no portada raíz)
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
    if (!cleanPath || cleanPath === '') {
      return '';
    }
    return trimmed;
  } catch {
    return '';
  }
};

// Palabras prohibidas globales (sin tildes, comparadas sobre texto normalizado)
const globalExclusions = [
  'accidente', 'choque', 'volco', 'vuelco', 'muerto', 'fallecio', 'fallecido', 'fatal',
  'policial', 'detenido', 'robo', 'asaltaron', 'crimen', 'homicidio', 'autopsia',
  'clima', 'pronostico', 'meteorologico', 'futbol', 'torneo', 'partido', 'colapinto',
  'papa francisco', 'vaticano', 'espectaculo', 'famosos', 'farandula', 'horoscopo',
  'arroyo', 'cayo al', 'cruzar el', 'cruzaba', 'rescate', 'rescataron', 'bomberos',
  'ahogado', 'desaparecido', 'buscan a', 'ambulancia', 'heridos', 'hospitalizaron'
];

// Validador metodológico estricto por intersección conceptual
const passesStrictFilter = (title, snippet, category) => {
  const normText = normalizeText(`${title} ${snippet}`);

  for (const badWord of globalExclusions) {
    if (normText.includes(badWord)) return false;
  }

  if (category === 'Extractivismo y Minería') {
    const coreResource = [
      'extractiv', 'mineria', 'minero', 'minera', 'fracking', 'hidrocarburo',
      'petroleo', 'petrolera', 'litio', 'uranio', 'oleoducto', 'vaca muerta',
      'golfo san matias', 'megamineria', 'calcatreu', 'represa'
    ];
    const socialImpact = [
      'agua', 'comunidad', 'ambiental', 'socioambiental', 'contaminacion', 'derrame',
      'territorio', 'audiencia', 'asamblea', 'vecinos', 'rechazo', 'impacto',
      'explotacion', 'pasivo', 'recurso', 'inversion', 'aprobacion', 'proyecto'
    ];
    return coreResource.some(w => normText.includes(w)) && socialImpact.some(w => normText.includes(w));
  }

  if (category === 'Desigualdades Socio-Territoriales') {
    const inequalityTerms = [
      'pobreza', 'indigencia', 'desigualdad', 'alquiler', 'vivienda', 'habitacional',
      'barrio popular', 'toma', 'asentamiento', 'tarifazo', 'servicios basicos',
      'vulnerabilidad', 'territorial', 'canasta basica'
    ];
    return inequalityTerms.some(w => normText.includes(w));
  }

  if (category === 'Configuraciones y Reformas Laborales') {
    const laborTerms = [
      'reforma laboral', 'precarizacion', 'despido', 'sindicato', 'gremio',
      'trabajador', 'paritaria', 'huelga', 'convenio colectivo', 'ajuste',
      'flexibilizacion', 'empleo', 'salario', 'estabilidad', 'ate', 'unter', 'adunc'
    ];
    return laborTerms.some(w => normText.includes(w));
  }

  if (category === 'Políticas de Inversión (RIGI / Súper RIGI)') {
    const rigiTerms = ['rigi', 'super rigi', 'regimen de incentivo', 'grandes inversiones', 'exencion impositiva', 'inversion extractiva'];
    return rigiTerms.some(w => normText.includes(w));
  }

  if (category === 'Perspectiva de Género') {
    const genderTerms = [
      'perspectiva de genero', 'violencia de genero', 'violencia machista', 'feminism',
      'disidencia', 'diversidad sexual', 'lgbti', 'trans', 'travesti', 'cuidado',
      'patriarcado', 'femicidio', 'aborto', 'esi', 'paridad', 'ni una menos'
    ];
    return genderTerms.some(w => normText.includes(w));
  }

  if (category === 'UNCo (Fiske Menuco / Neuquén)') {
    const uncoTerms = ['unco', 'universidad nacional del comahue', 'fadecs', 'comahue', 'fiske menuco', 'adunc', 'fuco'];
    return uncoTerms.some(w => normText.includes(w));
  }

  return true;
};

// Portales regionales seleccionados de Neuquén y Río Negro (sin paréntesis ni corchetes)
const regionalPortalsQuery = [
  'site:eldiarioar.com',
  'site:movimientoalternativa.com.ar',
  'site:zapalaya.com.ar',
  'site:fuego24.com',
  'site:damenoticias.com',
  'site:diarioandino.com.ar',
  'site:elperiodicoderincon.com.ar',
  'site:laangosturadigital.com.ar',
  'site:diariamenteneuquen.com.ar',
  'site:neuquenalinstante.com.ar',
  'site:mejorinformado.com',
  'site:elcomahueonline.com',
  'site:neuquenonline.com.ar',
  'site:neuquen24horas.com',
  'site:alertadigital.ar',
  'site:neuquendigitalnoticias.com.ar',
  'site:neuquenweb.com',
  'site:neuqueninforma.gob.ar',
  'site:cutralcoalinstante.com',
  'site:hechosdezapala.com',
  'site:limaynoticias.com',
  'site:vdmnoticias.com',
  'site:riocoloradoinforma.com.ar',
  'site:vivoinformado.com.ar',
  'site:hoyvallemedio.ar',
  'site:barilochedigital.com',
  'site:cipollettidigital.com.ar',
  'site:cipo360.com.ar',
  'site:diariolapalabra.com.ar',
  'site:estoquepasa.com.ar',
  'site:loprincipal.com.ar',
  'site:gnrnoticias.com',
  'site:anroca.com.ar',
  'site:elcordillerano.com.ar',
  'site:adnrionegro.com.ar',
  'site:rionegro.com.ar',
  'site:canal10.com.ar',
  'site:lmcipolleti.com.ar'
].join(' OR ');

// Noticias base metodológicas curadas con enlaces directos a secciones/notas específicas
const fallbackNews = [
  {
    id: 'base-extract-1',
    tag: 'Extractivismo y Minería',
    title: 'Temas de pueblos originarios y conflictos territoriales en el país y la región',
    date: 'Nov 2026',
    source: 'elDiarioAR',
    url: 'https://www.eldiarioar.com/temas/pueblos-originarios/',
    snippet: 'Problemáticas sociales que trae el extractivismo y la minería: proyectos aprobados en la zona, conflictos de comunidades por el acceso al agua frente a empresas explotadoras y el costo social oculto.'
  },
  {
    id: 'base-extract-2',
    tag: 'Extractivismo y Minería',
    title: 'Invitación a la VII Cumbre del Agua Plurinacional para los pueblos de Abya Yala',
    date: 'Nov 2026',
    source: 'Movimiento Alternativa',
    url: 'https://www.movimientoalternativa.com.ar/l/entrevista/invitacion-a-la-vii-cumbre-del-agua-plurinacional-para-los-pueblos-de-abya-yala-21-22-y-23-de-nov-luyaba-cordoba/',
    snippet: 'Debate sobre el impacto ambiental de las actividades económicas de la zona y las tensiones territoriales frente a nuevos emprendimientos.'
  },
  {
    id: 'base-unco-1',
    tag: 'UNCo (Fiske Menuco / Neuquén)',
    title: 'Ruta 40, universidad y radares: articulación académica y territorial',
    date: 'Ago 2026',
    source: 'Vivo Informado',
    url: 'https://www.vivoinformado.com.ar/2026/08/ruta-40-universidad-y-radares-javier.html',
    snippet: 'Espacio de articulación entre teoría y práctica, participación horizontal y vinculación de la universidad pública con el territorio en Fiske Menuco y Neuquén.'
  }
];

// Consultas RSS optimizadas con los portales de Neuquén y Río Negro (sin paréntesis ni corchetes)
const thematicFeeds = [
  {
    tag: 'Extractivismo y Minería',
    rss: `https://news.google.com/rss/search?q=extractivismo OR mineria OR fracking OR agua OR ambiental OR comunidades ${regionalPortalsQuery} -accidente -choque -policial&hl=es-419&gl=AR&ceid=AR:es-419`
  },
  {
    tag: 'Desigualdades Socio-Territoriales',
    rss: `https://news.google.com/rss/search?q=desigualdad OR pobreza OR vivienda OR alquileres OR barrios OR territorial ${regionalPortalsQuery} -accidente -choque -policial&hl=es-419&gl=AR&ceid=AR:es-419`
  },
  {
    tag: 'Configuraciones y Reformas Laborales',
    rss: `https://news.google.com/rss/search?q="reforma laboral" OR precarizacion OR despidos OR paritarias OR sindicatos ${regionalPortalsQuery} -accidente -choque -policial&hl=es-419&gl=AR&ceid=AR:es-419`
  },
  {
    tag: 'Políticas de Inversión (RIGI / Súper RIGI)',
    rss: `https://news.google.com/rss/search?q=RIGI OR "Super RIGI" OR inversiones OR "Vaca Muerta" ${regionalPortalsQuery} -accidente -futbol&hl=es-419&gl=AR&ceid=AR:es-419`
  },
  {
    tag: 'Perspectiva de Género',
    rss: `https://news.google.com/rss/search?q="perspectiva de genero" OR "violencia de genero" OR feminismo OR disidencias OR cuidado ${regionalPortalsQuery} -accidente -choque -vial -papa&hl=es-419&gl=AR&ceid=AR:es-419`
  },
  {
    tag: 'UNCo (Fiske Menuco / Neuquén)',
    rss: `https://news.google.com/rss/search?q="Universidad Nacional del Comahue" OR UNCo OR FADECS OR "Fiske Menuco" ${regionalPortalsQuery} -accidente -choque -futbol&hl=es-419&gl=AR&ceid=AR:es-419`
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

  // 4. Búsqueda automática manteniendo vínculo estricto 1 a 1 entre título, medio y enlace de la nota
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
          const directLink = getDirectArticleUrl(item.link);
          if (!directLink) continue;

          const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
          if (!rawTitle) continue;

          const titleParts = rawTitle.split(' - ');
          const cleanTitle = titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ').trim() : rawTitle;
          const sourceName = titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : (item.author || 'Medio Regional');
          const cleanDesc = stripHtml(item.description || '');
          const snippetText = cleanDesc.length > 25 ? cleanDesc.slice(0, 160) + '...' : `Artículo periodístico vinculado al eje ${feed.tag} en la región.`;

          if (!passesStrictFilter(cleanTitle, snippetText, feed.tag)) continue;

          parsedArticles.push({
            id: createDeterministicHash(`${feed.tag}-${cleanTitle}-${directLink}`),
            tag: feed.tag,
            title: cleanTitle,
            date: item.pubDate ? new Date(item.pubDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Actualidad',
            source: sourceName,
            url: directLink,
            snippet: snippetText
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
      setMessages(snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    let unsubDoc = () => {};
    if (currentView.startsWith('sala-')) {
      unsubDoc = onSnapshot(doc(db, 'salas', currentView), (docSnap) => {
        if (docSnap.exists()) {
          const storedUrl = docSnap.data().docUrl || '';
          setActiveDocUrl(isValidGoogleUrl(storedUrl) ? storedUrl : '');
        } else {
          setActiveDocUrl('');
        }
      });
    }

    return () => { unsubChat(); unsubDoc(); };
  }, [currentView, user]);

  // 6. Enviar, Editar y Borrar Mensajes
  const sendMessage = async (e) => {
    e.preventDefault();
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
  const filteredNews = selectedCategory === 'Todas' ? newsList : newsList.filter(n => n.tag === selectedCategory);

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

      {/* CABECERA MÓVIL */}
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
          <button onClick={logout} className="text-xs text-orange-500 hover:text-orange-800 mt-2 font-semibold">Cerrar sesión</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-xs font-semibold text-orange-500 uppercase tracking-wider mb-2">General</h2>
            <button onClick={() => selectView('chat-general')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${currentView === 'chat-general' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>💬 Chat General</button>
            <button onClick={() => selectView('noticias')} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors mt-1 text-sm font-medium ${currentView === 'noticias' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>📰 Ejes y Noticias</button>
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

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-orange-500 uppercase tracking-wider">Grupos de Trabajo</h2>
              {isAdmin && (
                <div className="flex space-x-1">
                  <button onClick={() => updateRoomsCount(roomsCount - 1)} className="px-2.5 py-0.5 bg-orange-300 text-orange-900 rounded hover:bg-orange-400 font-bold">-</button>
                  <button onClick={() => updateRoomsCount(roomsCount + 1)} className="px-2.5 py-0.5 bg-orange-300 text-orange-900 rounded hover:bg-orange-400 font-bold">+</button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              {Array.from({ length: roomsCount }).map((_, idx) => (
                <button key={idx} onClick={() => selectView(`sala-${idx + 1}`)} className={`w-full text-left px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${currentView === `sala-${idx + 1}` ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>
                  📝 Monografía {idx + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="md:hidden pt-4 border-t border-orange-200">
            <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-red-600 font-semibold">Cerrar sesión</button>
          </div>
        </div>
      </div>

      {/* ÁREA PRINCIPAL */}
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {currentView === 'noticias' ? (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-orange-50/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Actualidad Regional y Ejes Metodológicos</h2>
                <p className="text-xs md:text-sm text-orange-600 mt-1">Análisis territorial crítico, extractivismo, agua, desigualdades, trabajo, género y UNCo (Fiske Menuco / Neuquén).</p>
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
                  🗞️ Kiosco Diarios Argentinos ↗
                </a>
              </div>
            </div>

            {/* FILTROS POR EJE TEMÁTICO */}
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
        ) : (
          <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">

            {/* SELECTOR DE PESTAÑAS EN MÓVIL */}
            {currentView.startsWith('sala-') && (
              <div className="md:hidden flex border-b border-orange-200 bg-orange-100">
                <button
                  onClick={() => setMobileRoomTab('doc')}
                  className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 ${mobileRoomTab === 'doc' ? 'border-orange-500 text-orange-900 bg-white' : 'border-transparent text-orange-600'}`}
                >
                  📄 Documento Sala
                </button>
                <button
                  onClick={() => setMobileRoomTab('chat')}
                  className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 ${mobileRoomTab === 'chat' ? 'border-orange-500 text-orange-900 bg-white' : 'border-transparent text-orange-600'}`}
                >
                  💬 Debate ({messages.length})
                </button>
              </div>
            )}

            {/* ZONA DE DOCUMENTO (AMBAS OPCIONES: VISOR INCRUSTADO + BOTÓN EXTERNO) */}
            {currentView.startsWith('sala-') && (
              <div className={`${mobileRoomTab === 'doc' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r border-orange-200 bg-white h-full overflow-hidden`}>
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
                      src={activeDocUrl}
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

            {/* ZONA DE CHAT */}
            <div className={`${currentView.startsWith('sala-') && mobileRoomTab === 'doc' ? 'hidden md:flex' : 'flex'} ${currentView === 'chat-general' ? 'w-full max-w-4xl mx-auto md:my-6 md:rounded-xl md:shadow-lg md:border' : 'w-full md:w-96'} flex-1 md:flex-initial bg-white flex-col border-orange-200 h-full overflow-hidden`}>
              <div className="p-3 md:p-4 border-b border-orange-200 bg-orange-100/50 flex justify-between items-center">
                <h3 className="font-bold text-orange-800 text-sm md:text-base capitalize">
                  {currentView === 'chat-general' ? 'Chat General Interdisciplinario' : `Debate - ${currentView.replace('-', ' ')}`}
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
                            {isMine && (
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

          </div>
        )}
      </div>
    </div>
  );
};

export default FadecsWorkspace;

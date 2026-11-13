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

// Enlace al Repositorio Bibliográfico de Google Drive
const DRIVE_REPO_URL = "https://drive.google.com/drive/folders/1E-9JMFs1ot4Y1Omp_OJSbcl3Ilu_PfH3";
const MAX_MSG_LENGTH = 1000;

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

// Sanitizador de enlaces externos de noticias (previene XSS por javascript:)
const sanitizeHttpUrl = (urlString) => {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? urlString : '#';
  } catch {
    return '#';
  }
};

// Noticias base curadas sobre los 5 ejes de las Jornadas
const fallbackNews = [
  { id: 'base-1', tag: 'Ambiente y Extractivismo', title: 'Audiencia contra los proyectos extractivistas y en defensa del Golfo San Matías', date: '12 Nov 2026', source: 'Agencia Farco', url: 'https://agencia.farco.org.ar/2026/11/12/rio-negro-hoy-una-audiencia-contra-los-proyectos-extractivistas-y-en-defensa-del-golfo-san-matias/', snippet: 'Comunidades y asambleas socioambientales exponen el impacto sobre el ecosistema marino y el uso del agua en la región.' },
  { id: 'base-2', tag: 'Políticas de Inversión (RIGI)', title: 'Neuquén y Río Negro capturan el 56% del RIGI con Vaca Muerta', date: '9 Nov 2026', source: 'VacaMuerta.ar', url: 'https://vacamuerta.ar/neuquen-y-rio-negro-capturan-el-56-del-rigi-con-vaca-muerta/', snippet: 'Análisis del impacto fiscal y territorial de los proyectos aprobados bajo el régimen de incentivos a las grandes inversiones y el Súper RIGI.' },
  { id: 'base-3', tag: 'Reconfiguración Laboral', title: 'Juicios laborales en Río Negro: aumentaron las causas tras la reforma', date: '19 Oct 2026', source: 'Diario Río Negro', url: 'https://www.rionegro.com.ar/politica/juicios-laborales-en-rio-negro-aumentaron-las-causas-y-hubo-un-salto-en-los-acuerdos-de-conciliacion/', snippet: 'El impacto de la reforma laboral nacional en los tribunales provinciales y las nuevas dinámicas de contratación y despidos.' },
  { id: 'base-4', tag: 'Desigualdad Socio-territorial', title: 'Índice de pobreza: brechas entre polos extractivos y barrios populares en la Patagonia', date: '24 Sep 2026', source: 'Diario Río Negro', url: 'https://www.rionegro.com.ar/economia/indice-de-pobreza-e-indigencia-que-paso-en-neuquen-rio-negro-y-la-patagonia-en-el-primer-semestre-del-2026-4735560/', snippet: 'Los indicadores reflejan el contraste entre el crecimiento de la renta hidrocarburífera y la crisis habitacional y de servicios en el territorio.' }
];

// Consultas RSS específicas para los 5 ejes en Río Negro y Neuquén
const thematicFeeds = [
  {
    tag: 'Ambiente y Extractivismo',
    rss: 'https://news.google.com/rss/search?q=(extractivismo+OR+ambiental+OR+contaminacion+OR+fracking+OR+"Golfo+San+Matias"+OR+agua)+("Rio+Negro"+OR+Neuquen)&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Comunidades Originarias',
    rss: 'https://news.google.com/rss/search?q=(mapuche+OR+"comunidades+originarias"+OR+"pueblos+originarios"+OR+territorio+OR+Lof)+("Rio+Negro"+OR+Neuquen)&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Políticas de Inversión (RIGI)',
    rss: 'https://news.google.com/rss/search?q=(RIGI+OR+"Super+RIGI"+OR+"Vaca+Muerta"+inversiones)+("Rio+Negro"+OR+Neuquen)&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Reconfiguración Laboral',
    rss: 'https://news.google.com/rss/search?q=("reforma+laboral"+OR+precarizacion+OR+despidos+OR+gremios+OR+sindicatos+OR+trabajadores)+("Rio+Negro"+OR+Neuquen)&hl=es-419&gl=AR&ceid=AR:es-419'
  },
  {
    tag: 'Desigualdad Socio-territorial',
    rss: 'https://news.google.com/rss/search?q=(pobreza+OR+desigualdad+OR+alquileres+OR+vivienda+OR+"barrios+populares"+OR+tomas)+("Rio+Negro"+OR+Neuquen)&hl=es-419&gl=AR&ceid=AR:es-419'
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
  const isAdmin = user?.email === 'juliangallegos9057@gmail.com';

  // 2. Control de Sesión
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const login = () => signInWithPopup(auth, provider);
  const logout = () => signOut(auth);

  // 3. Sincronización de Cantidad de Salas
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const count = Number(docSnap.data().roomsCount) || 1;
        setRoomsCount(Math.min(Math.max(1, count), 30)); // Tope de seguridad de 30 salas
      }
    });
    return () => unsub();
  }, [user]);

  const updateRoomsCount = async (newCount) => {
    if (!isAdmin) return;
    const boundedCount = Math.min(Math.max(1, newCount), 30);
    setRoomsCount(boundedCount);
    await setDoc(doc(db, 'config', 'general'), { roomsCount: boundedCount }, { merge: true });
  };

  // 4. Búsqueda automática filtrada por los 5 ejes temáticos
  const fetchLiveNews = async () => {
    setLoadingNews(true);
    try {
      const promises = thematicFeeds.map(async (feed) => {
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.rss)}`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        if (data.items) {
          return data.items.slice(0, 3).map((item, idx) => {
            const titleParts = item.title.split(' - ');
            const cleanTitle = titleParts.length > 1 ? titleParts.slice(0, -1).join(' - ') : item.title;
            const sourceName = titleParts.length > 1 ? titleParts[titleParts.length - 1] : (item.author || 'Medio Regional');

            return {
              id: `${feed.tag}-${idx}-${Date.now()}`,
              tag: feed.tag,
              title: cleanTitle,
              date: new Date(item.pubDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }),
              source: sourceName,
              url: sanitizeHttpUrl(item.link),
              snippet: `Nota periodística vinculada al eje de ${feed.tag} en la región patagónica.`
            };
          });
        }
        return [];
      });

      const results = await Promise.all(promises);
      const combinedLive = results.flat();

      if (combinedLive.length > 0) {
        setNewsList([...combinedLive, ...fallbackNews]);
      }
    } catch (err) {
      console.error('Error al actualizar feeds temáticos, usando respaldo:', err);
    }
    setLoadingNews(false);
  };

  useEffect(() => {
    if (currentView === 'noticias') {
      fetchLiveNews();
    }
  }, [currentView]);

  // 5. Sincronización de Chat y Documentos por Sala
  useEffect(() => {
    if (!user || currentView === 'noticias') return;
    setDocError('');

    const q = query(collection(db, 'salas', currentView, 'mensajes'), orderBy('createdAt', 'asc'));
    const unsubChat = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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

  // 6. Enviar, Editar y Borrar Mensajes con validaciones de seguridad
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
    }
    setIsSending(false);
  };

  const handleDeleteMessage = async (msgId) => {
    if (window.confirm('¿Seguro que deseas eliminar este mensaje?')) {
      await deleteDoc(doc(db, 'salas', currentView, 'mensajes', msgId));
    }
  };

  const startEditMessage = (msg) => {
    setEditingMsgId(msg.id);
    setEditingText(msg.text);
  };

  const saveEditMessage = async (msgId) => {
    const trimmed = editingText.trim();
    if (!trimmed || trimmed.length > MAX_MSG_LENGTH) return;
    await updateDoc(doc(db, 'salas', currentView, 'mensajes', msgId), {
      text: trimmed,
      edited: true
    });
    setEditingMsgId(null);
    setEditingText('');
  };

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    const trimmedUrl = docInput.trim();
    
    if (!isValidGoogleUrl(trimmedUrl)) {
      setDocError('Por seguridad, solo se permiten enlaces oficiales de Google Docs o Google Drive (https://docs.google.com/...).');
      return;
    }

    setDocError('');
    setActiveDocUrl(trimmedUrl);
    setDocInput('');
    await setDoc(doc(db, 'salas', currentView), { docUrl: trimmedUrl }, { merge: true });
  };

  const selectView = (view) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
    setEditingMsgId(null);
    setDocError('');
  };

  const categories = ['Todas', 'Ambiente y Extractivismo', 'Comunidades Originarias', 'Políticas de Inversión (RIGI)', 'Reconfiguración Laboral', 'Desigualdad Socio-territorial'];
  const filteredNews = selectedCategory === 'Todas' ? newsList : newsList.filter(n => n.tag === selectedCategory);

  // PANTALLA DE LOGIN
  if (!user) {
    return (
      <div className="flex h-screen bg-orange-50 items-center justify-center font-sans p-4">
        <div className="bg-white p-6 md:p-8 rounded-xl shadow-lg border border-orange-200 text-center max-w-md w-full">
          <h1 className="text-2xl md:text-3xl font-bold text-orange-800 mb-2">JIFADECS 2026</h1>
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
          <h1 className="text-lg font-bold text-orange-900 leading-tight">JIFADECS 2026</h1>
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
          <h1 className="text-xl font-bold text-orange-800">JIFADECS 2026</h1>
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
                <h2 className="text-2xl md:text-3xl font-bold text-orange-800">Actualidad Regional por Ejes Temáticos</h2>
                <p className="text-xs md:text-sm text-orange-600 mt-1">Monitoreo de medios patagónicos sobre extractivismo, territorio, pueblos originarios, RIGI y trabajo.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={fetchLiveNews} className="px-3 py-2 bg-orange-200 text-orange-900 rounded-lg font-semibold text-xs md:text-sm hover:bg-orange-300 transition-colors">
                  {loadingNews ? '🔄 Buscando notas...' : '🔄 Actualizar titulares'}
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
                  <a href={sanitizeHttpUrl(news.url)} target="_blank" rel="noopener noreferrer" className="text-orange-600 font-bold text-xs md:text-sm hover:text-orange-800 self-start">Leer artículo completo →</a>
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
                  📄 Ver Documento
                </button>
                <button 
                  onClick={() => setMobileRoomTab('chat')} 
                  className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 ${mobileRoomTab === 'chat' ? 'border-orange-500 text-orange-900 bg-white' : 'border-transparent text-orange-600'}`}
                >
                  💬 Debate ({messages.length})
                </button>
              </div>
            )}

            {/* ZONA DE DOCUMENTO */}
            {currentView.startsWith('sala-') && (
              <div className={`${mobileRoomTab === 'doc' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r border-orange-200 bg-white h-full overflow-hidden`}>
                <div className="p-3 md:p-4 bg-orange-100/30 border-b border-orange-200">
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-2.5">
                    <p className="text-xs text-yellow-800">
                      ⚠️ <strong>Importante:</strong> Compartir este documento solo con los integrantes del grupo y coordinación.
                    </p>
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
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-orange-400 text-xs md:text-sm p-4 text-center">No hay un documento activo en esta sala.</div>
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

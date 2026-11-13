import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc } from 'firebase/firestore';

// 1. Tu Configuración de Firebase
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

const FadecsWorkspace = () => {
  const [user, setUser] = useState(null);
  const [currentView, setCurrentView] = useState('chat-general');
  const [roomsCount, setRoomsCount] = useState(3);
  const [activeDocUrl, setActiveDocUrl] = useState('');
  const [docInput, setDocInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef(null);

  // Tu correo como administrador primordial (solo tú verás los botones + y -)
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

  // 3. Sincronización de Cantidad de Salas (Global)
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        setRoomsCount(docSnap.data().roomsCount || 1);
      }
    });
    return () => unsub();
  }, [user]);

  const updateRoomsCount = async (newCount) => {
    if (!isAdmin) return;
    setRoomsCount(newCount);
    await setDoc(doc(db, 'config', 'general'), { roomsCount: newCount }, { merge: true });
  };

  // 4. Sincronización de Chat y Documentos por Sala
  useEffect(() => {
    if (!user || currentView === 'noticias') return;

    // Cargar Chat
    const q = query(collection(db, 'salas', currentView, 'mensajes'), orderBy('createdAt', 'asc'));
    const unsubChat = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    // Cargar Documento (solo en salas de monografía)
    let unsubDoc = () => {};
    if (currentView.startsWith('sala-')) {
      unsubDoc = onSnapshot(doc(db, 'salas', currentView), (docSnap) => {
        if (docSnap.exists()) {
          setActiveDocUrl(docSnap.data().docUrl || '');
        } else {
          setActiveDocUrl('');
        }
      });
    }

    return () => { unsubChat(); unsubDoc(); };
  }, [currentView, user]);

  // 5. Funciones de envío
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msgText = newMessage;
    setNewMessage('');
    await addDoc(collection(db, 'salas', currentView, 'mensajes'), {
      text: msgText,
      sender: user.displayName,
      email: user.email,
      createdAt: serverTimestamp()
    });
  };

  // Noticias estáticas
  const newsData = [
    { id: 1, tag: 'Ambiente', title: 'Audiencia en defensa del Golfo San Matías', date: 'Nov 2026', source: 'Agencia Farco', url: 'https://agencia.farco.org.ar/2026/11/12/rio-negro-hoy-una-audiencia-contra-los-proyectos-extractivistas-y-en-defensa-del-golfo-san-matias/', snippet: 'Se realiza una audiencia contra los proyectos extractivistas en Río Negro.' },
    { id: 2, tag: 'RIGI', title: 'Neuquén y Río Negro capturan el 56% del RIGI', date: 'Nov 2026', source: 'VacaMuerta.ar', url: 'https://vacamuerta.ar/neuquen-y-rio-negro-capturan-el-56-del-rigi-con-vaca-muerta/', snippet: 'Proyectos aprobados bajo el régimen de incentivos traccionados por Vaca Muerta.' }
  ];

  const handleDocSubmit = async (e) => {
    e.preventDefault();
    setActiveDocUrl(docInput);
    setDocInput('');
    await setDoc(doc(db, 'salas', currentView), { docUrl: docInput }, { merge: true });
  };

  // PANTALLA DE LOGIN
  if (!user) {
    return (
      <div className="flex h-screen bg-orange-50 items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-orange-200 text-center max-w-md w-full">
          <h1 className="text-3xl font-bold text-orange-800 mb-2">JIFADECS 2026</h1>
          <p className="text-orange-600 mb-8">Diálogo de saberes para los desafíos contemporáneos</p>
          <button onClick={login} className="w-full bg-orange-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-orange-600 transition-colors shadow-md">
            Iniciar sesión con Google
          </button>
        </div>
      </div>
    );
  }

  // INTERFAZ PRINCIPAL
  return (
    <div className="flex h-screen bg-orange-50 font-sans text-orange-900">
      {/* BARRA LATERAL */}
      <div className="w-64 bg-orange-100 border-r border-orange-200 flex flex-col shadow-sm">
        <div className="p-4 border-b border-orange-200 bg-orange-200/50">
          <h1 className="text-xl font-bold text-orange-800">JIFADECS 2026</h1>
          <p className="text-xs text-orange-700 mt-1 truncate">{user.displayName}</p>
          <button onClick={logout} className="text-xs text-orange-500 hover:text-orange-800 mt-2 font-semibold">Cerrar sesión</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-orange-500 uppercase tracking-wider mb-2">General</h2>
            <button onClick={() => setCurrentView('chat-general')} className={`w-full text-left px-3 py-2 rounded-md transition-colors ${currentView === 'chat-general' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>💬 Chat General</button>
            <button onClick={() => setCurrentView('noticias')} className={`w-full text-left px-3 py-2 rounded-md transition-colors mt-1 ${currentView === 'noticias' ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>📰 Noticias y Contexto</button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-orange-500 uppercase tracking-wider">Grupos</h2>
              {isAdmin && (
                <div className="flex space-x-1">
                  <button onClick={() => updateRoomsCount(Math.max(1, roomsCount - 1))} className="px-2 py-0.5 bg-orange-300 text-orange-900 rounded hover:bg-orange-400 font-bold">-</button>
                  <button onClick={() => updateRoomsCount(roomsCount + 1)} className="px-2 py-0.5 bg-orange-300 text-orange-900 rounded hover:bg-orange-400 font-bold">+</button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              {Array.from({ length: roomsCount }).map((_, idx) => (
                <button key={idx} onClick={() => setCurrentView(`sala-${idx + 1}`)} className={`w-full text-left px-3 py-2 rounded-md transition-colors ${currentView === `sala-${idx + 1}` ? 'bg-orange-500 text-white shadow' : 'hover:bg-orange-200 text-orange-800'}`}>
                  📝 Monografía {idx + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ÁREA PRINCIPAL */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {currentView === 'noticias' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-orange-50/50">
            <h2 className="text-3xl font-bold text-orange-800 mb-6">Noticias y Contexto Regional</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {newsData.map(news => (
                <div key={news.id} className="bg-white p-6 rounded-lg shadow-sm border border-orange-100 hover:shadow-md transition-shadow">
                  <span className="inline-block px-2 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full mb-3">{news.tag}</span>
                  <h3 className="text-lg font-bold text-orange-900 mb-2">{news.title}</h3>
                  <p className="text-orange-700 text-sm mb-4 line-clamp-3">{news.snippet}</p>
                  <a href={news.url} target="_blank" rel="noreferrer" className="text-orange-500 font-semibold text-sm hover:text-orange-700">Leer artículo →</a>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex h-full">
            
            {/* ZONA DE DOCUMENTO */}
            {currentView.startsWith('sala-') && (
              <div className="flex-1 flex flex-col border-r border-orange-200 bg-white">
                <div className="p-4 bg-orange-100/30 border-b border-orange-200">
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-3">
                    <p className="text-xs text-yellow-800">⚠️ Configura el Drive como <strong>"Cualquier persona con el enlace puede editar"</strong>.</p>
                  </div>
                  <form onSubmit={handleDocSubmit} className="flex gap-2">
                    <input type="url" value={docInput} onChange={(e) => setDocInput(e.target.value)} placeholder="Pega el enlace de Google Docs..." className="flex-1 px-3 py-2 border border-orange-300 rounded text-sm focus:ring-2 focus:ring-orange-400 outline-none" />
                    <button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded font-semibold text-sm hover:bg-orange-600">Incrustar</button>
                  </form>
                </div>
                <div className="flex-1 bg-gray-50 p-2">
                  {activeDocUrl ? (
                    <iframe src={activeDocUrl} className="w-full h-full border-0 rounded shadow-inner" title="Doc" />
                  ) : (
                    <div className="h-full flex items-center justify-center text-orange-400 text-sm">No hay un documento activo.</div>
                  )}
                </div>
              </div>
            )}

            {/* ZONA DE CHAT */}
            <div className={`${currentView === 'chat-general' ? 'w-full max-w-4xl mx-auto my-8 rounded-xl shadow-lg border' : 'w-96'} bg-white flex flex-col border-orange-200`}>
              <div className="p-4 border-b border-orange-200 bg-orange-100/50">
                <h3 className="font-bold text-orange-800 capitalize">
                  {currentView === 'chat-general' ? 'Chat General Interdisciplinario' : `Debate - ${currentView.replace('-', ' ')}`}
                </h3>
              </div>
              
              <div className="flex-1 p-4 overflow-y-auto bg-orange-50/30 flex flex-col gap-3">
                {messages.length === 0 && <div className="text-center text-xs text-orange-400 mt-4">Comienza el debate...</div>}
                {messages.map((msg) => (
                  <div key={msg.id} className={`max-w-[85%] p-3 rounded-lg text-sm ${msg.email === user.email ? 'bg-orange-500 text-white self-end rounded-tr-none shadow-sm' : 'bg-orange-100 text-orange-900 self-start rounded-tl-none border border-orange-200'}`}>
                    <div className={`text-[10px] mb-1 font-bold ${msg.email === user.email ? 'text-orange-200' : 'text-orange-600'}`}>{msg.sender}</div>
                    <div>{msg.text}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendMessage} className="p-4 border-t border-orange-200 bg-white flex gap-2">
                <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1 px-3 py-2 text-sm border border-orange-300 rounded focus:ring-2 focus:ring-orange-400 outline-none" />
                <button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded font-bold hover:bg-orange-600">→</button>
              </form>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

export default FadecsWorkspace;
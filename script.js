// ----------------------------------------------------
// *** 1. CONFIGURACIÓN Y DECLARACIÓN DE VARIABLES ***
// ----------------------------------------------------
const clientId = '9643b3fc5b11421da0364a8eff9b8545';
const redirectUri = 'https://luisalvarado25.github.io/Metronomo/'; 
const scope = 'streaming user-read-playback-state user-modify-playback-state playlist-read-private';

const loginBtn = document.getElementById('loginBtn');
const playlistsDiv = document.getElementById('playlists');
const playlistSelector = document.getElementById('playlist-selector'); 
const tracksDiv = document.getElementById('tracks');
const playBtn = document.getElementById('playBtn');
const seekbar = document.getElementById('seekbar');
const seekbarProgress = document.getElementById('seekbar-progress');
const contadorEl = document.getElementById('contador');
const duracionEl = document.getElementById('duracion');
const metronomo = document.getElementById('metronomo');
const controlsDiv = document.getElementById('controls');
const metroDisplay = document.getElementById('metro-display'); 

let token = null;
let player;
let deviceId;
let isDeviceReady = false; 
let progressMs = 0;
let durationMs = 0;
let interval = null;

let metroTimer = null;
let metroCounterInterval = null; 
let metroCountdown = 30;         
let isMetroRunning = false;       
const METRO_INTERVAL = 30000;

controlsDiv.style.display = 'none';
let currentPlaylistId = null;

// Función auxiliar para desbloquear el audio
function allowAudio() {
    if (!metronomo.src || metronomo.readyState < 2) {
         metronomo.load(); 
    }
    if (metronomo.paused) {
        metronomo.play().then(() => {
            metronomo.pause();
            metronomo.currentTime = 0;
            metroDisplay.classList.remove('warning');
        }).catch(error => {
            console.warn('Bloqueo inicial de audio. Permite la reproducción con un clic.', error);
            metroDisplay.classList.add('warning');
            metroDisplay.textContent = "Metrónomo: ⚠️ Haz clic en Play para activar el sonido.";
        });
    }
}

// ----------------------------------------------------
// *** 2. LÓGICA DE LOGIN (PKCE) ***
// ----------------------------------------------------
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = crypto.getRandomValues(new Uint8Array(length));
  return [...array].map(x => chars[x % chars.length]).join('');
}
async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await crypto.subtle.digest('SHA-256', data);
}
function base64encode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function login() {
  const verifier = generateRandomString(64);
  const challenge = base64encode(await sha256(verifier));
  localStorage.setItem('verifier', verifier);
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope, redirect_uri: redirectUri,
    code_challenge_method: 'S256', code_challenge: challenge
  });
  window.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeToken(code) {
  const verifier = localStorage.getItem('verifier');
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'authorization_code', code,
    redirect_uri: redirectUri, code_verifier: verifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const data = await res.json();
  token = data.access_token;
  localStorage.setItem('access_token', token);
  
  window.history.pushState({}, document.title, redirectUri);
  
  initPlayer();
  loadPlaylists();
  loginBtn.style.display = 'none'; 
  controlsDiv.style.display = 'grid'; 
}

// ----------------------------------------------------
// *** 3. SPOTIFY WEB PLAYBACK SDK (SYNCHRONIZATION) ***
// ----------------------------------------------------

function initPlayer() {
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new Spotify.Player({
      name: 'Mi Metrónomo Web',
      getOAuthToken: cb => cb(token),
      volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
      console.log('Dispositivo listo, ID:', device_id);
      deviceId = device_id;
      isDeviceReady = true; 
      
      fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        body: JSON.stringify({ device_ids: [device_id], play: false }), 
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
      })
      .then(() => console.log('Reproducción transferida al nuevo dispositivo.'));
    });
    
    // Aquí es donde se generaba el alert del error de autenticación original
    player.addListener('authentication_error', ({ message }) => { 
        console.error('Authentication Error:', message); 
        alert('Error de autenticación: Vuelve a iniciar sesión.'); 
    });
    
    // LÓGICA DE SINCRONIZACIÓN CLAVE
    player.addListener('player_state_changed', state => {
      if (!state || !state.track_window.current_track) {
          stopMetro();
          return;
      }
      
      const currentTrack = state.track_window.current_track;
      progressMs = state.position;
      durationMs = currentTrack.duration_ms;
      duracionEl.textContent = msToTime(durationMs);
      updateProgress();
      
      if (!state.paused) { 
        playBtn.innerHTML = '⏸'; 
        startProgress(); 
        
        if (!isMetroRunning) {
            startMetro(); 
        }
      } else { 
        playBtn.innerHTML = '▶️'; 
        stopProgress(); 
        
        if (isMetroRunning) {
            pauseMetro(); 
        }
      }
    });

    player.connect();
  };
}

// ----------------------------------------------------
// *** 4. CARGA DE CONTENIDO (ADAPTADO A MOBILE/WEB) ***
// ----------------------------------------------------

async function loadPlaylists() {
  const res = await fetch('https://api.spotify.com/v1/me/playlists', { headers:{Authorization:`Bearer ${token}`} });
  const data = await res.json();
  
  // Limpiar y resetear ambas interfaces
  playlistsDiv.innerHTML = '<h3>Playlists</h3><select id="playlist-selector" class="mobile-only"></select>';
  tracksDiv.innerHTML = '<h3>Canciones</h3><p>Selecciona una playlist.</p>';
  const selector = document.getElementById('playlist-selector');
  selector.innerHTML = '<option value="">-- Selecciona una Playlist --</option>'; // Opción inicial

  data.items.forEach(p => {
    // 1. Interfaz Web (Lista)
    const div = document.createElement('div');
    div.className='playlist web-only'; 
    div.textContent=p.name;
    div.onclick = () => {
        allowAudio(); 
        currentPlaylistId = p.id;
        loadTracks(p.id);
        tracksDiv.innerHTML = '<h3>Canciones</h3><p>Cargando tracks...</p>';
    };
    playlistsDiv.appendChild(div);

    // 2. Interfaz Móvil (ComboBox)
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    selector.appendChild(option);
  });
  
  // Asignar manejador de evento al selector móvil
  selector.addEventListener('change', (e) => {
      const playlistId = e.target.value;
      if (playlistId) {
          allowAudio();
          currentPlaylistId = playlistId;
          loadTracks(playlistId);
          tracksDiv.innerHTML = '<h3>Canciones</h3><p>Cargando tracks...</p>';
      } else {
          tracksDiv.innerHTML = '<h3>Canciones</h3><p>Selecciona una playlist.</p>';
      }
  });

  if (token) {
    tracksDiv.classList.remove('disabled');
  } else {
    tracksDiv.classList.add('disabled');
  }
}

async function loadTracks(playlistId) {
  if (!token) return; 

  const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, { headers:{Authorization:`Bearer ${token}`} });
  const data = await res.json();
  tracksDiv.innerHTML = '<h3>Canciones</h3>';
  data.items.forEach(item => {
    const track = item.track;
    if (!track || !track.uri) return; 
    
    const div = document.createElement('div');
    div.className='track';
    div.textContent=`${track.name} - ${track.artists.map(a=>a.name).join(', ')}`;
    div.onclick = () => {
        allowAudio(); 
        playTrack(track.uri);
        stopMetro(); 
    };
    tracksDiv.appendChild(div);
  });
}

// ----------------------------------------------------
// *** 5. FUNCIONES DE REPRODUCCIÓN SPOTIFY ***
// ----------------------------------------------------

async function playTrack(uri) {
  if (!isDeviceReady) { 
    return alert('El dispositivo de Spotify aún se está conectando. Por favor, espera unos segundos y vuelve a intentarlo.');
  }
  
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, { 
    method:'PUT',
    body: JSON.stringify({uris:[uri]}),
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}
  });
}

// ----------------------------------------------------
// *** 6. MANEJO DE CONTROLES, SEEKING Y METRÓNOMO ***
// ----------------------------------------------------

playBtn.onclick = () => {
    allowAudio(); 
    if (!isDeviceReady) return;
    
    player.getCurrentState().then(state => {
        if (state && state.track_window.current_track) {
            if (state.paused) {
                player.resume();
            } else {
                player.pause();
            }
        } else {
            alert("Selecciona una canción primero.");
        }
    });
};

seekbar.addEventListener('click', (e) => {
    allowAudio(); 
    if (!isDeviceReady || durationMs === 0) return;

    pauseMetro(); 

    const rect = seekbar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const seekbarWidth = rect.width;

    const percentage = clickX / seekbarWidth;
    const newPositionMs = Math.round(durationMs * percentage);

    player.seek(newPositionMs)
        .then(() => {
            progressMs = newPositionMs;
            updateProgress();
        })
        .catch(err => {
            console.error('Error al intentar buscar la posición:', err);
        });
});

// -------------------- LÓGICA DEL METRÓNOMO --------------------

async function startMetro() {
  if (isMetroRunning) return;

  isMetroRunning = true;
  metroDisplay.classList.remove('warning');

  try {
    await metronomo.load();
    metronomo.currentTime = 0; 
    await metronomo.play();
    console.log("Metrónomo INICIADO con sonido.");
    resetCounter();
  } catch (e) {
      console.warn("No se pudo reproducir el primer sonido (bloqueo de Autoplay).", e);
      metroDisplay.textContent = "Metrónomo: ⚠️ Activa el Sonido con un clic en Play.";
      metroDisplay.classList.add('warning');
      resetCounter(); 
  }
  
  if (metroTimer) clearInterval(metroTimer);
  metroTimer = setInterval(async ()=> {
      try {
          metronomo.currentTime = 0; 
          await metronomo.play();
          console.log('CHICHARRA: 30 segundos cumplidos.');
          resetCounter(); 
      } catch (e) {
          console.error("No se pudo reproducir chicharra.mp3. Error de Autoplay:", e);
          if (!metroDisplay.classList.contains('warning')) {
              metroDisplay.textContent = "Metrónomo: ⚠️ Activa el Sonido con un clic en Play.";
              metroDisplay.classList.add('warning');
          }
          resetCounter();
      }
  }, METRO_INTERVAL); 
  
  startCounter();
}

function pauseMetro() {
  if (!isMetroRunning) return;
  isMetroRunning = false;

  if(metroTimer) clearInterval(metroTimer); 
  stopCounter();
  metroDisplay.textContent = "Metrónomo: Pausado (Spotify pausado)";
  metroDisplay.classList.remove('warning');
}

function stopMetro(){ 
  if (!isMetroRunning && metroTimer === null) return;
  
  isMetroRunning = false;
  if(metroTimer) clearInterval(metroTimer); 
  metroTimer = null;
  stopCounter();
  metroDisplay.textContent = "Metrónomo: Inactivo";
  metroDisplay.classList.remove('warning');
}

// -------------------- LÓGICA DEL CONTADOR VISUAL --------------------

function startCounter() {
    metroCountdown = 30; 
    updateCounterDisplay();
    
    if (metroCounterInterval) clearInterval(metroCounterInterval);
    metroCounterInterval = setInterval(() => {
        metroCountdown--;
        if (metroCountdown < 0) {
            metroCountdown = 29; 
        }
        updateCounterDisplay();
    }, 1000);
}

function stopCounter() {
    if (metroCounterInterval) clearInterval(metroCounterInterval);
    metroCounterInterval = null;
}

function resetCounter() {
    metroCountdown = 30; 
    updateCounterDisplay();
}

function updateCounterDisplay() {
    if (isMetroRunning || !metroDisplay.classList.contains('warning')) {
        metroDisplay.textContent = `Metrónomo: ${metroCountdown.toString().padStart(2, '0')}s`;
    }
}

// -------------------- LÓGICA DE PROGRESO DE SPOTIFY --------------------

function updateProgress(){
  contadorEl.textContent = msToTime(progressMs);
  seekbarProgress.style.width = ((progressMs/durationMs)*100)+'%';
}
function startProgress(){
  if(interval) clearInterval(interval);
  interval = setInterval(()=>{ 
    progressMs+=1000; 
    if(progressMs<=durationMs) updateProgress(); 
    else stopProgress(); 
  },1000);
}
function stopProgress(){ if(interval) clearInterval(interval); }

function msToTime(ms){
  let s=Math.floor(ms/1000); 
  return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
}

// ----------------------------------------------------
// *** 7. INICIO DE LA APLICACIÓN ***
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', ()=>{
  loginBtn.addEventListener('click', login);
  
  document.body.addEventListener('click', allowAudio, { once: true });
  
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  
  if(code) {
    exchangeToken(code);
  } else {
    token = localStorage.getItem('access_token');
    if(token){ 
      initPlayer(); 
      loadPlaylists(); 
      loginBtn.style.display = 'none'; 
      controlsDiv.style.display = 'grid'; 
    } else {
        // Estado inicial: si no hay token, se muestra el botón de login
        playlistsDiv.innerHTML = '<h3>Playlists</h3><p>Inicia sesión para ver tu contenido.</p>';
    }
  }
  
  metroDisplay.textContent = "Metrónomo: Inactivo";

});




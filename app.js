import {
  auth,
  torneoRef,
  ADMIN_UID,
  datosIniciales,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  onValue,
  set
} from "./firebase.js";

const $ = id => document.getElementById(id);

let torneo = null;
let administrador = false;
let tieneDatos = false;

const pagina = document.body.dataset.page;

function escapar(valor) {
  return String(valor).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function mensaje(texto) {
  const el = $("estado");
  if (el) el.textContent = texto;
}

function normalizar(datos) {
  const base = datos || datosIniciales();

  return {
    teams: Array.isArray(base.teams) ? base.teams : [],
    format: base.format || "grupos",
    groupCount: Number(base.groupCount) || 2,
    groupDraw: base.groupDraw || null,
    matches: Array.isArray(base.matches) ? base.matches : [],
    upcoming: Array.isArray(base.upcoming) ? base.upcoming : [],
    liveUrl: base.liveUrl || "",
    tiktokUrl: base.tiktokUrl || "",
    facebookUrl: base.facebookUrl || "",
    timer: base.timer || {
      seconds: 0,
      startedAt: null,
      active: false
    }
  };
}

async function guardar() {
  if (!administrador || auth.currentUser?.uid !== ADMIN_UID) {
    alert("No tienes permiso para modificar el torneo.");
    return;
  }

  try {
    await set(torneoRef, torneo);
    mensaje("Cambios guardados correctamente.");
  } catch (error) {
    console.error(error);
    mensaje("No se pudo guardar. Revisa Firebase.");
    alert("Error al guardar: " + error.message);
  }
}

function calcularTabla(equipos) {
  const tabla = equipos.map(nombre => ({
    nombre,
    pj: 0,
    pg: 0,
    pe: 0,
    pp: 0,
    gf: 0,
    gc: 0,
    pts: 0
  }));

  torneo.matches.forEach(partido => {
    const local = tabla.find(t => t.nombre === partido.home);
    const visitante = tabla.find(t => t.nombre === partido.away);

    if (!local || !visitante) return;

    const gl = Number(partido.hg);
    const gv = Number(partido.ag);

    local.pj++;
    visitante.pj++;

    local.gf += gl;
    local.gc += gv;
    visitante.gf += gv;
    visitante.gc += gl;

    if (gl > gv) {
      local.pg++;
      local.pts += 3;
      visitante.pp++;
    } else if (gv > gl) {
      visitante.pg++;
      visitante.pts += 3;
      local.pp++;
    } else {
      local.pe++;
      visitante.pe++;
      local.pts++;
      visitante.pts++;
    }
  });

  tabla.forEach(t => t.dg = t.gf - t.gc);

  return tabla.sort((a, b) =>
    b.pts - a.pts ||
    b.dg - a.dg ||
    b.gf - a.gf ||
    a.nombre.localeCompare(b.nombre)
  );
}

function pintarInicio() {
  if ($("cantidadEquipos")) {
    $("cantidadEquipos").textContent = torneo.teams.length;
    $("cantidadPartidos").textContent = torneo.matches.length;
    $("cantidadGoles").textContent = torneo.matches.reduce(
      (s, p) => s + Number(p.hg) + Number(p.ag), 0
    );
  }
}

function pintarSorteo() {
  const contenedor = $("grupos");
  if (!contenedor) return;

  if (!torneo.groupDraw) {
    contenedor.textContent = "Todavía no se ha realizado el sorteo.";
    return;
  }

  contenedor.innerHTML = Object.keys(torneo.groupDraw).map(grupo => `
    <div class="draw-group">
      <h3>GRUPO ${escapar(grupo)}</h3>
      <ol>
        ${(torneo.groupDraw[grupo] || []).map(equipo =>
          `<li>${escapar(equipo)}</li>`
        ).join("")}
      </ol>
    </div>
  `).join("");
}

function pintarPosiciones() {
  const contenedor = $("tablas");
  if (!contenedor) return;

  if (!torneo.groupDraw) {
    contenedor.textContent = "Primero debes realizar el sorteo.";
    return;
  }

  const grupos = Object.keys(torneo.groupDraw);
  contenedor.innerHTML = grupos.map(grupo => {
    const tabla = calcularTabla(torneo.groupDraw[grupo] || []);

    return `
      <div class="card">
        <h3>GRUPO ${grupo}</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Equipo</th>
                <th>PJ</th>
                <th>PG</th>
                <th>PE</th>
                <th>PP</th>
                <th>GF</th>
                <th>GC</th>
                <th>DG</th>
                <th>PTS</th>
              </tr>
            </thead>
            <tbody>
              ${tabla.map(t => `
                <tr>
                  <td>${escapar(t.nombre)}</td>
                  <td>${t.pj}</td>
                  <td>${t.pg}</td>
                  <td>${t.pe}</td>
                  <td>${t.pp}</td>
                  <td>${t.gf}</td>
                  <td>${t.gc}</td>
                  <td>${t.gf - t.gc}</td>
                  <td><b>${t.pts}</b></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  if ($("semifinales")) {
    if (grupos.length === 2) {
      const a = calcularTabla(torneo.groupDraw.A || []);
      const b = calcularTabla(torneo.groupDraw.B || []);
      $("semifinales").innerHTML = `
        <p>Semifinal 1: ${escapar(a[0]?.nombre || "Por definir")} vs ${escapar(b[1]?.nombre || "Por definir")}</p>
        <p>Semifinal 2: ${escapar(b[0]?.nombre || "Por definir")} vs ${escapar(a[1]?.nombre || "Por definir")}</p>`;
    } else {
      $("semifinales").textContent = "La clasificación a eliminatorias se definirá al terminar la fase de grupos.";
    }
  }
}

function pintarResultados() {
  const contenedor = $("listaResultados");
  if (!contenedor) return;

  contenedor.innerHTML = torneo.matches.length
    ? torneo.matches.slice().reverse().map(p => `
      <div class="match">
        <div class="muted">${escapar(p.date || "Fecha por definir")}</div>
        <div class="score">
          <span>${escapar(p.home)}</span>
          <b>${Number(p.hg)} - ${Number(p.ag)}</b>
          <span>${escapar(p.away)}</span>
        </div>
      </div>
    `).join("")
    : "Todavía no hay resultados registrados.";
}

function pintarCalendario() {
  const contenedor = $("listaProximos");
  if (!contenedor) return;

  contenedor.innerHTML = torneo.upcoming.length
    ? torneo.upcoming.map(p => `
      <div class="match">
        <div class="muted">${escapar(p.date || "Por programar")}</div>
        <div class="score">
          <span>${escapar(p.home)}</span>
          <b>VS</b>
          <span>${escapar(p.away)}</span>
        </div>
      </div>
    `).join("")
    : "No hay partidos programados.";
}

function pintarEnVivo() {
  const video = $("video");
  if (!video) return;

  if (torneo.liveUrl) {
    video.innerHTML = `
      <iframe
        src="${escapar(torneo.liveUrl)}"
        title="Transmisión del torneo"
        allowfullscreen>
      </iframe>
    `;
  } else {
    video.textContent = "La transmisión aparecerá aquí cuando se configure.";
  }
}

function llenarSelect(id) {
  const el = $(id);
  if (!el) return;

  el.innerHTML = torneo.teams.map(e =>
    `<option value="${escapar(e)}">${escapar(e)}</option>`
  ).join("");
}

function pintarEquiposAdmin() {
  const contenedor = $("editorEquipos");
  if (!contenedor) return;

  contenedor.innerHTML = torneo.teams.map((e, i) => `
    <div class="match">
      <b>${escapar(e)}</b>
      <button onclick="cambiarEquipo(${i})">Cambiar nombre</button>
      <button onclick="eliminarEquipo(${i})">Eliminar</button>
    </div>
  `).join("");

  ["local", "visitante", "proximoLocal", "proximoVisitante"]
    .forEach(llenarSelect);
}

function pintarCronometro() {
  const el = $("cronometro");
  if (!el) return;

  let segundos = Number(torneo.timer.seconds) || 0;

  if (torneo.timer.active && torneo.timer.startedAt) {
    segundos += Math.max(
      0,
      Math.floor((Date.now() - torneo.timer.startedAt) / 1000)
    );
  }

  const minutos = String(Math.floor(segundos / 60)).padStart(2, "0");
  const resto = String(segundos % 60).padStart(2, "0");

  el.textContent = `${minutos}:${resto}`;
}

function mostrarAdministrador() {
  const panel = $("panelAdmin");
  const login = $("loginAdmin");

  if (panel) panel.style.display = administrador ? "block" : "none";
  if (login) login.style.display = administrador ? "none" : "block";
}

function renderizar() {
  pintarInicio();
  pintarSorteo();
  pintarPosiciones();
  pintarResultados();
  pintarCalendario();
  pintarEnVivo();
  pintarEquiposAdmin();
  pintarCronometro();
  mostrarAdministrador();
}

onAuthStateChanged(auth, async usuario => {
  administrador = !!usuario && usuario.uid === ADMIN_UID;
  if (usuario && !administrador) {
    if (pagina === "admin") {
      mensaje("La cuenta inició sesión, pero su UID no está autorizado como administrador. Revisa ADMIN_UID en firebase.js.");
    }
    await signOut(auth);
  }
  mostrarAdministrador();
  if (administrador && torneo && !tieneDatos) await guardar();
});

onValue(torneoRef, async snapshot => {
  tieneDatos = snapshot.exists();
  torneo = normalizar(snapshot.exists() ? snapshot.val() : datosIniciales());
  renderizar();
  mensaje("Conectado a Firebase. Información actualizada.");
  if (!tieneDatos && administrador) await guardar();
}, error => {
  console.error("Firebase Realtime Database:", error);
  mensaje("Error de conexión con Firebase: " + (error.message || "revisa las reglas y la conexión"));
});

setInterval(() => { if (torneo) pintarCronometro(); }, 500);

function explicarErrorAcceso(error) {
  const mensajes = {
    "auth/invalid-email": "El formato del correo no es válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo en Firebase Authentication.",
    "auth/wrong-password": "La contraseña no coincide.",
    "auth/invalid-credential": "El correo o la contraseña son incorrectos.",
    "auth/too-many-requests": "Firebase bloqueó temporalmente los intentos. Espera e inténtalo más tarde.",
    "auth/network-request-failed": "No hay conexión estable o el navegador bloqueó la conexión con Firebase.",
    "auth/operation-not-allowed": "Activa Correo electrónico/Contraseña en Firebase Authentication.",
    "auth/invalid-api-key": "La API Key de Firebase no es válida. Revisa firebase.js.",
    "auth/unauthorized-domain": "Este dominio no está autorizado. Agrega elkincastillo124-web.github.io en Firebase Authentication → Configuración → Dominios autorizados."
  };
  return mensajes[error.code] || (error.message || "Error desconocido de autenticación") + " [" + (error.code || "sin código") + "]";
}

window.iniciarSesion = async function () {
  const correo = $("correo")?.value.trim();
  const clave = $("clave")?.value;
  if (!correo || !clave) {
    mensaje("Escribe el correo y la contraseña.");
    return;
  }
  const boton = document.querySelector('#loginAdmin button');
  if (boton) { boton.disabled = true; boton.textContent = "Verificando..."; }
  mensaje("Conectando con Firebase Authentication...");
  try {
    const credencial = await signInWithEmailAndPassword(auth, correo, clave);
    if (credencial.user.uid !== ADMIN_UID) {
      await signOut(auth);
      mensaje("Acceso rechazado: el UID de esta cuenta no coincide con ADMIN_UID de firebase.js. UID detectado: " + credencial.user.uid);
      return;
    }
    mensaje("Sesión iniciada correctamente.");
  } catch (error) {
    console.error("Error de inicio de sesión:", error);
    mensaje("No se pudo iniciar sesión: " + explicarErrorAcceso(error));
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = "Iniciar sesión"; }
  }
};


function crearGrupos(equipos, cantidad) {
  const mezcla = [...equipos];
  for (let i = mezcla.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mezcla[i], mezcla[j]] = [mezcla[j], mezcla[i]];
  }
  const grupos = {};
  for (let i = 0; i < cantidad; i++) grupos[String.fromCharCode(65 + i)] = [];
  mezcla.forEach((equipo, i) => grupos[String.fromCharCode(65 + (i % cantidad))].push(equipo));
  return grupos;
}

function crearPartidosLiga(equipos, idaVuelta = false) {
  const lista = [...equipos];
  if (lista.length % 2) lista.push(null);
  const n = lista.length;
  const rondas = [];
  for (let r = 0; r < n - 1; r++) {
    const ronda = [];
    for (let i = 0; i < n / 2; i++) {
      const a = lista[i], b = lista[n - 1 - i];
      if (a && b) ronda.push({ home: r % 2 ? b : a, away: r % 2 ? a : b, date: `Jornada ${r + 1}` });
    }
    rondas.push(...ronda);
    lista.splice(1, 0, lista.pop());
  }
  return idaVuelta ? rondas.concat(rondas.map(p => ({ home: p.away, away: p.home, date: "Vuelta - " + p.date }))) : rondas;
}

function generarCalendarioAutomatico() {
  if (torneo.format === "todos" || torneo.format === "ida_vuelta") {
    torneo.upcoming = crearPartidosLiga(torneo.teams, torneo.format === "ida_vuelta");
  } else if (torneo.format === "grupos" && torneo.groupDraw) {
    torneo.upcoming = Object.entries(torneo.groupDraw).flatMap(([g, equipos]) =>
      crearPartidosLiga(equipos).map(p => ({ ...p, date: `Grupo ${g} - ${p.date}` }))
    );
  } else if (torneo.format === "eliminacion") {
    const mezcla = [...torneo.teams];
    torneo.upcoming = [];
    for (let i = 0; i + 1 < mezcla.length; i += 2) torneo.upcoming.push({ home: mezcla[i], away: mezcla[i + 1], date: "Primera ronda" });
  }
}

window.aplicarConfiguracionTorneo = async function () {
  if (!administrador || !torneo) return;
  const cantidad = Number($("cantidadEquiposConfig")?.value);
  const formato = $("formatoTorneo")?.value || "grupos";
  const grupos = Number($("cantidadGrupos")?.value || 2);
  if (!Number.isInteger(cantidad) || cantidad < 2 || cantidad > 64) return alert("El número de equipos debe estar entre 2 y 64.");
  if (formato === "grupos" && (!Number.isInteger(grupos) || grupos < 2 || grupos > Math.min(8, cantidad))) return alert("El número de grupos debe estar entre 2 y 8 y no superar el número de equipos.");
  if (!confirm("Aplicar esta configuración reemplazará el calendario y borrará los resultados anteriores. ¿Continuar?")) return;
  while (torneo.teams.length < cantidad) torneo.teams.push(`Equipo ${torneo.teams.length + 1}`);
  torneo.teams = torneo.teams.slice(0, cantidad);
  torneo.format = formato;
  torneo.groupCount = formato === "grupos" ? grupos : 0;
  torneo.matches = [];
  torneo.groupDraw = formato === "grupos" ? crearGrupos(torneo.teams, grupos) : null;
  generarCalendarioAutomatico();
  renderizar();
  await guardar();
};

window.realizarSorteo = async function () {
  if (!administrador || !torneo || torneo.format !== "grupos") return alert("Selecciona primero el formato de grupos.");
  torneo.groupDraw = crearGrupos(torneo.teams, torneo.groupCount || 2);
  torneo.matches = [];
  generarCalendarioAutomatico();
  renderizar();
  await guardar();
};

window.cerrarSesion = () => signOut(auth);

window.realizarSorteo = async function () {
  if (!administrador) return;

  if (torneo.teams.length !== 8) {
    alert("El sorteo necesita exactamente ocho equipos.");
    return;
  }

  const equipos = [...torneo.teams];

  for (let i = equipos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [equipos[i], equipos[j]] = [equipos[j], equipos[i]];
  }

  torneo.groupDraw = {
    A: equipos.slice(0, 4),
    B: equipos.slice(4, 8)
  };

  renderizar();
  await guardar();
};

window.agregarEquipo = async function () {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const nombre = $("nuevoEquipo").value.trim();

  if (!nombre || nombre.length > 40) {
    alert("Escribe un nombre válido de máximo 40 caracteres.");
    return;
  }

  if (torneo.teams.length >= 64) {
    alert("El máximo permitido es de 64 equipos.");
    return;
  }
  if (torneo.teams.some(e => e.toLowerCase() === nombre.toLowerCase())) {
    alert("Ese equipo ya existe.");
    return;
  }

  torneo.teams.push(nombre);
  $("nuevoEquipo").value = "";

  renderizar();
  await guardar();
};

window.cambiarEquipo = async function (indice) {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const anterior = torneo.teams[indice];
  const nuevo = prompt("Nuevo nombre:", anterior);

  if (!nuevo || !nuevo.trim()) return;

  const nombre = nuevo.trim();

  if (torneo.teams.some((e, i) =>
    i !== indice && e.toLowerCase() === nombre.toLowerCase()
  )) {
    alert("Ese nombre ya está registrado.");
    return;
  }

  torneo.teams[indice] = nombre;

  torneo.matches.forEach(p => {
    if (p.home === anterior) p.home = nombre;
    if (p.away === anterior) p.away = nombre;
  });

  torneo.upcoming.forEach(p => {
    if (p.home === anterior) p.home = nombre;
    if (p.away === anterior) p.away = nombre;
  });

  if (torneo.groupDraw) {
    ["A", "B"].forEach(g => {
      torneo.groupDraw[g] = torneo.groupDraw[g].map(
        e => e === anterior ? nombre : e
      );
    });
  }

  renderizar();
  await guardar();
};

window.eliminarEquipo = async function (indice) {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const nombre = torneo.teams[indice];

  if (!confirm(`¿Eliminar el equipo ${nombre}?`)) return;

  torneo.teams.splice(indice, 1);

  torneo.matches = torneo.matches.filter(
    p => p.home !== nombre && p.away !== nombre
  );

  torneo.upcoming = torneo.upcoming.filter(
    p => p.home !== nombre && p.away !== nombre
  );

  if (torneo.groupDraw) {
    ["A", "B"].forEach(g => {
      torneo.groupDraw[g] = torneo.groupDraw[g].filter(
        e => e !== nombre
      );
    });
  }

  renderizar();
  await guardar();
};

window.registrarResultado = async function () {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const home = $("local").value;
  const away = $("visitante").value;
  const hg = $("golesLocal").value;
  const ag = $("golesVisitante").value;
  const date = $("fechaResultado").value;

  if (
    !home || !away || home === away ||
    hg === "" || ag === "" ||
    Number(hg) < 0 || Number(ag) < 0 ||
    !Number.isInteger(Number(hg)) ||
    !Number.isInteger(Number(ag))
  ) {
    alert("Revisa los equipos y el marcador.");
    return;
  }

  torneo.matches.push({
    home,
    away,
    hg: Number(hg),
    ag: Number(ag),
    date: date || "Fecha por definir"
  });

  torneo.upcoming = torneo.upcoming.filter(
    p => !(p.home === home && p.away === away)
  );

  $("golesLocal").value = "";
  $("golesVisitante").value = "";

  renderizar();
  await guardar();
};

window.agregarProximo = async function () {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const home = $("proximoLocal").value;
  const away = $("proximoVisitante").value;
  const date = $("fechaProximo").value.trim();

  if (!home || !away || home === away) {
    alert("Selecciona dos equipos diferentes.");
    return;
  }

  torneo.upcoming.push({
    home,
    away,
    date: date || "Por programar"
  });

  $("fechaProximo").value = "";

  renderizar();
  await guardar();
};

window.guardarTransmision = async function () {
  if (!administrador || !torneo) return alert("Inicia sesión como administrador para realizar cambios.");
  const youtube = $("urlYouTube")?.value.trim() || "";
  const tiktok = $("urlTikTok")?.value.trim() || "";
  const facebook = $("urlFacebook")?.value.trim() || "";
  try {
    if (youtube) {
      const u = new URL(youtube);
      if (!["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"].includes(u.hostname) || !u.pathname.startsWith("/embed/")) throw new Error("YouTube debe ser un enlace /embed/ válido.");
      torneo.liveUrl = u.href;
    } else torneo.liveUrl = "";
    for (const [valor, etiqueta] of [[tiktok, "TikTok"], [facebook, "Facebook"]]) {
      if (valor) {
        const u = new URL(valor);
        if (u.protocol !== "https:") throw new Error(`El enlace de ${etiqueta} debe comenzar con https://.`);
      }
    }
    torneo.tiktokUrl = tiktok;
    torneo.facebookUrl = facebook;
    renderizar();
    await guardar();
  } catch (error) {
    alert(error.message || "Revisa los enlaces de transmisión.");
  }
};

function segundosActuales() {
  let s = Number(torneo.timer.seconds) || 0;

  if (torneo.timer.active && torneo.timer.startedAt) {
    s += Math.max(
      0,
      Math.floor((Date.now() - torneo.timer.startedAt) / 1000)
    );
  }

  return s;
}

window.iniciarCronometro = async function () {
  if (!administrador || torneo.timer.active) return;

  torneo.timer = {
    seconds: segundosActuales(),
    startedAt: Date.now(),
    active: true
  };

  await guardar();
  pintarCronometro();
};

window.pausarCronometro = async function () {
  if (!administrador || !torneo.timer.active) return;

  torneo.timer = {
    seconds: segundosActuales(),
    startedAt: null,
    active: false
  };

  await guardar();
  pintarCronometro();
};

window.reiniciarCronometro = async function () {
  if (!administrador) return;

  torneo.timer = {
    seconds: 0,
    startedAt: null,
    active: false
  };

  await guardar();
  pintarCronometro();
};
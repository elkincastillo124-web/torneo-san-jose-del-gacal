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
    groupDraw: base.groupDraw || null,
    matches: Array.isArray(base.matches) ? base.matches : [],
    upcoming: Array.isArray(base.upcoming) ? base.upcoming : [],
    format: base.format || "grupos",
    liveUrl: base.liveUrl || "",
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
  const formato = $("formatoActual");
  if (formato) {
    const nombres = {
      todos: "Todos contra todos",
      ida_vuelta: "Todos contra todos (ida y vuelta)",
      grupos: "Fase de grupos (A y B)",
      eliminacion: "Eliminación directa"
    };
    formato.textContent = nombres[torneo.format] || "Por configurar";
  }

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

  contenedor.innerHTML = ["A", "B"].map(grupo => `
    <div class="draw-group">
      <h3>GRUPO ${grupo}</h3>
      <ol>
        ${torneo.groupDraw[grupo].map(equipo =>
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

  contenedor.innerHTML = ["A", "B"].map(grupo => {
    const tabla = calcularTabla(torneo.groupDraw[grupo]);

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

  const a = calcularTabla(torneo.groupDraw.A);
  const b = calcularTabla(torneo.groupDraw.B);

  if ($("semifinales")) {
    $("semifinales").innerHTML = `
      <p>Semifinal 1: ${escapar(a[0]?.nombre || "Por definir")}
      vs ${escapar(b[1]?.nombre || "Por definir")}</p>
      <p>Semifinal 2: ${escapar(b[0]?.nombre || "Por definir")}
      vs ${escapar(a[1]?.nombre || "Por definir")}</p>
    `;
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


function crearPartidosLiga(equipos, grupo = "General", idaVuelta = false) {
  const lista = [...equipos];
  if (lista.length % 2 !== 0) lista.push(null);

  const total = lista.length;
  const jornadas = [];

  for (let ronda = 0; ronda < total - 1; ronda++) {
    const partidos = [];

    for (let i = 0; i < total / 2; i++) {
      let local = lista[i];
      let visitante = lista[total - 1 - i];

      if (local && visitante) {
        if (ronda % 2 === 1) [local, visitante] = [visitante, local];
        partidos.push({
          home: local,
          away: visitante,
          date: `${grupo} · Jornada ${ronda + 1}`
        });
      }
    }

    jornadas.push(partidos);
    lista.splice(1, 0, lista.pop());
  }

  let fixture = jornadas.flat();

  if (idaVuelta) {
    fixture = fixture.concat(fixture.map(p => ({
      home: p.away,
      away: p.home,
      date: `${grupo} · Vuelta`
    })));
  }

  return fixture;
}

function generarCalendarioAutomatico() {
  torneo.upcoming = [];

  if (torneo.format === "todos") {
    torneo.upcoming = crearPartidosLiga(torneo.teams, "Liga", false);
  } else if (torneo.format === "ida_vuelta") {
    torneo.upcoming = crearPartidosLiga(torneo.teams, "Liga", true);
  } else if (torneo.format === "grupos") {
    if (!torneo.groupDraw || !torneo.groupDraw.A || !torneo.groupDraw.B) {
      throw new Error("Primero realiza el sorteo de los grupos A y B.");
    }
    torneo.upcoming = [
      ...crearPartidosLiga(torneo.groupDraw.A, "Grupo A"),
      ...crearPartidosLiga(torneo.groupDraw.B, "Grupo B")
    ];
  } else if (torneo.format === "eliminacion") {
    const equipos = [...torneo.teams];
    for (let i = equipos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [equipos[i], equipos[j]] = [equipos[j], equipos[i]];
    }
    for (let i = 0; i < equipos.length; i += 2) {
      torneo.upcoming.push({
        home: equipos[i],
        away: equipos[i + 1] || "Pasa directamente",
        date: "Eliminación · Primera ronda"
      });
    }
  }
}

window.aplicarConfiguracionTorneo = async function () {
  if (!administrador) return;

  const cantidad = Number($("cantidadEquiposConfig")?.value || torneo.teams.length);
  const formato = $("formatoTorneo")?.value || "grupos";

  if (!Number.isInteger(cantidad) || cantidad < 2 || cantidad > 64) {
    alert("El número de equipos debe estar entre 2 y 64.");
    return;
  }

  if (formato === "grupos" && cantidad < 4) {
    alert("Para jugar en dos grupos se necesitan al menos cuatro equipos.");
    return;
  }

  if (formato === "grupos" && cantidad % 2 !== 0) {
    alert("Para repartir los equipos en dos grupos iguales, utiliza una cantidad par.");
    return;
  }

  const iniciales = datosIniciales().teams;
  const nuevos = torneo.teams.slice(0, cantidad);

  for (const nombre of iniciales) {
    if (nuevos.length >= cantidad) break;
    if (!nuevos.includes(nombre)) nuevos.push(nombre);
  }

  let numero = 1;
  while (nuevos.length < cantidad) {
    nuevos.push(`Equipo ${numero++}`);
  }

  torneo.teams = nuevos;
  torneo.format = formato;
  torneo.matches = [];
  torneo.groupDraw = null;
  torneo.upcoming = [];

  if (formato === "grupos") {
    const mezcla = [...nuevos];
    for (let i = mezcla.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mezcla[i], mezcla[j]] = [mezcla[j], mezcla[i]];
    }
    const mitad = mezcla.length / 2;
    torneo.groupDraw = {
      A: mezcla.slice(0, mitad),
      B: mezcla.slice(mitad)
    };
  }

  try {
    generarCalendarioAutomatico();
    renderizar();
    await guardar();
    alert("Configuración y calendario generados correctamente.");
  } catch (error) {
    alert(error.message);
  }
};

onAuthStateChanged(auth, async usuario => {
  administrador = !!usuario && usuario.uid === ADMIN_UID;

  if (usuario && !administrador) {
    await signOut(auth);
  }

  mostrarAdministrador();

  if (administrador && torneo && !tieneDatos) {
    await guardar();
  }
});

onValue(torneoRef, async snapshot => {
  tieneDatos = snapshot.exists();

  if (snapshot.exists()) {
    torneo = normalizar(snapshot.val());
  } else {
    torneo = datosIniciales();
  }

  renderizar();

  mensaje("Conectado a Firebase. Información actualizada.");

  if (!tieneDatos && administrador) {
    await guardar();
  }
}, error => {
  console.error(error);
  mensaje("Error de conexión con Firebase.");
});

setInterval(pintarCronometro, 500);

window.iniciarSesion = async function () {
  const correo = $("correo").value.trim();
  const clave = $("clave").value;

  try {
    const credencial = await signInWithEmailAndPassword(
      auth, correo, clave
    );

    if (credencial.user.uid !== ADMIN_UID) {
      await signOut(auth);
      alert("Esta cuenta no es la administradora autorizada.");
    }
  } catch (error) {
    alert("No se pudo iniciar sesión. Verifica los datos.");
  }
};

window.cerrarSesion = () => signOut(auth);

window.realizarSorteo = async function () {
  if (!administrador) return;

  if (torneo.teams.length < 4 || torneo.teams.length % 2 !== 0) {
    alert("Para sortear dos grupos se necesitan al menos cuatro equipos y una cantidad par.");
    return;
  }

  const equipos = [...torneo.teams];

  for (let i = equipos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [equipos[i], equipos[j]] = [equipos[j], equipos[i]];
  }

  torneo.groupDraw = {
    A: equipos.slice(0, equipos.length / 2),
    B: equipos.slice(equipos.length / 2)
  };

  if (torneo.format === "grupos") {
    generarCalendarioAutomatico();
  }

  renderizar();
  await guardar();
  alert("Sorteo y calendario actualizados.");
};

window.agregarEquipo = async function () {
  const nombre = $("nuevoEquipo").value.trim();

  if (!nombre || nombre.length > 40) {
    alert("Escribe un nombre válido de máximo 40 caracteres.");
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
  const url = $("urlYouTube").value.trim();

  try {
    const u = new URL(url);

    if (
      !["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"]
        .includes(u.hostname) ||
      !u.pathname.startsWith("/embed/")
    ) {
      throw new Error();
    }

    torneo.liveUrl = u.href;

    renderizar();
    await guardar();

  } catch {
    alert("Introduce un enlace de YouTube Embed válido.");
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
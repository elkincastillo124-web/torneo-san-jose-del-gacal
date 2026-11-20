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
    liveUrl: base.liveUrl || "",
    tiktokUrl: base.tiktokUrl || "",
    facebookUrl: base.facebookUrl || "",
    format: base.format || "grupos",
    groupCount: Number(base.groupCount) || 2,
    timer: {
      seconds: Number(base.timer?.seconds) || 0,
      startedAt: base.timer?.startedAt || null,
      active: !!base.timer?.active
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


function mezclar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function nombreGrupo(i) {
  return `Grupo ${i + 1}`;
}

function crearGrupos(equipos, cantidad) {
  const grupos = {};
  for (let i = 0; i < cantidad; i++) grupos[nombreGrupo(i)] = [];
  mezclar(equipos).forEach((equipo, i) => {
    grupos[nombreGrupo(i % cantidad)].push(equipo);
  });
  return grupos;
}

function partidosTodosContraTodos(equipos, idaVuelta = false, grupo = "General") {
  const lista = [...equipos];
  if (lista.length % 2 !== 0) lista.push(null);

  const cantidad = lista.length;
  const jornadas = [];

  for (let ronda = 0; ronda < cantidad - 1; ronda++) {
    const partidos = [];

    for (let i = 0; i < cantidad / 2; i++) {
      const local = lista[i];
      const visitante = lista[cantidad - 1 - i];

      if (local && visitante) {
        partidos.push({
          id: `${grupo}-${ronda + 1}-${i + 1}`,
          group: grupo,
          round: ronda + 1,
          home: ronda % 2 === 0 ? local : visitante,
          away: ronda % 2 === 0 ? visitante : local,
          date: "",
          time: ""
        });
      }
    }

    jornadas.push(partidos);
    lista.splice(1, 0, lista.pop());
  }

  let fixture = jornadas.flat();

  if (idaVuelta) {
    const vuelta = fixture.map((p, i) => ({
      ...p,
      id: `${p.id}-vuelta-${i + 1}`,
      round: p.round + jornadas.length,
      home: p.away,
      away: p.home
    }));

    fixture = [...fixture, ...vuelta];
  }

  return fixture;
}

function generarCalendario() {
  torneo.upcoming = [];

  if (torneo.format === "todos" ||
      torneo.format === "ida_vuelta") {
    torneo.upcoming = partidosTodosContraTodos(
      torneo.teams,
      torneo.format === "ida_vuelta"
    );
  }

  else if (torneo.format === "grupos" && torneo.groupDraw) {
    Object.entries(torneo.groupDraw).forEach(([grupo, equipos]) => {
      torneo.upcoming.push(
        ...partidosTodosContraTodos(equipos, false, grupo)
      );
    });
  }

  else if (torneo.format === "eliminacion") {
    const equipos = mezclar(torneo.teams);

    for (let i = 0; i < equipos.length; i += 2) {
      torneo.upcoming.push({
        id: `eliminacion-${i + 1}`,
        group: "Eliminación",
        round: 1,
        home: equipos[i],
        away: equipos[i + 1] || "Pasa directamente",
        date: "",
        time: ""
      });
    }
  }
}
function pintarPosiciones() {
  const contenedor = $("tablas");
  if (!contenedor) return;

  if (torneo.groupDraw && Object.keys(torneo.groupDraw).length) {
    contenedor.innerHTML = Object.entries(torneo.groupDraw).map(([grupo, equipos]) => {
      const tabla = calcularTabla(equipos);
      return `
        <div class="card">
          <h3>${escapar(grupo.startsWith("Grupo") ? grupo.toUpperCase() : "GRUPO " + grupo)}</h3>
          ${htmlTabla(tabla)}
        </div>
      `;
    }).join("");

    const grupos = Object.entries(torneo.groupDraw);
    if ($("semifinales")) {
      if (grupos.length === 2) {
        const a = calcularTabla(grupos[0][1]);
        const b = calcularTabla(grupos[1][1]);
        $("semifinales").innerHTML = `
          <p>Semifinal 1: ${escapar(a[0]?.nombre || "Por definir")}
          vs ${escapar(b[1]?.nombre || "Por definir")}</p>
          <p>Semifinal 2: ${escapar(b[0]?.nombre || "Por definir")}
          vs ${escapar(a[1]?.nombre || "Por definir")}</p>`;
      } else {
        $("semifinales").textContent = "Clasificarán los mejores equipos de cada grupo según el reglamento.";
      }
    }
    return;
  }

  if (torneo.format === "eliminacion") {
    contenedor.textContent = "La eliminación directa no utiliza tabla de posiciones.";
    if ($("semifinales")) $("semifinales").textContent = "Las rondas se definen según los resultados de cada eliminatoria.";
    return;
  }

  contenedor.innerHTML = `
    <div class="card">
      <h3>Tabla general</h3>
      ${htmlTabla(calcularTabla(torneo.teams))}
    </div>`;
  if ($("semifinales")) $("semifinales").textContent = "La clasificación se determina por la tabla general.";
}

function htmlTabla(tabla) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>PTS</th></tr></thead>
    <tbody>${tabla.map(t => `<tr>
      <td>${escapar(t.nombre)}</td><td>${t.pj}</td><td>${t.pg}</td>
      <td>${t.pe}</td><td>${t.pp}</td><td>${t.gf}</td><td>${t.gc}</td>
      <td>${t.dg}</td><td><b>${t.pts}</b></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
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
  const cont = $("listaProximos");
  if (!cont) return;

  if (!torneo.upcoming.length) {
    cont.textContent = "Todavía no hay partidos programados.";
    return;
  }

  const jornadas = {};

  torneo.upcoming.forEach(p => {
    const nombre = p.round || 1;
    const grupo = p.group || "General";
    const clave = `${grupo} - Jornada ${nombre}`;

    if (!jornadas[clave]) jornadas[clave] = [];
    jornadas[clave].push(p);
  });

  cont.innerHTML = Object.entries(jornadas).map(([jornada, partidos]) => `
    <section class="card">
      <h3>${escapar(jornada)}</h3>

      ${partidos.map(p => `
        <article class="match">
          <div class="score">
            <span>${escapar(p.home)}</span>
            <b>VS</b>
            <span>${escapar(p.away)}</span>
          </div>

          <div class="muted">
            Fecha: ${escapar(p.date || "Por definir")}
          </div>

          <div class="muted">
            Hora: ${escapar(p.time || "Por definir")}
          </div>
        </article>
      `).join("")}
    </section>
  `).join("");
}

function pintarEnVivo() {
  const video = $("video");
  if (video) {
    if (torneo.liveUrl) {
      video.innerHTML = `<iframe src="${escapar(torneo.liveUrl)}" title="Transmisión del torneo" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    } else {
      video.innerHTML = '<div class="video-placeholder"><strong>▶ Próximamente</strong>La transmisión aparecerá aquí cuando se configure.</div>';
    }
  }
  const tiktok = $("enlaceTikTok");
  const facebook = $("enlaceFacebook");
  if (tiktok) tiktok.href = torneo.tiktokUrl || "https://www.tiktok.com/";
  if (facebook) facebook.href = torneo.facebookUrl || "https://www.facebook.com/";
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
  if (contenedor) {
    contenedor.innerHTML = torneo.teams.map((e, i) => `
      <div class="match">
        <b>${escapar(e)}</b>
        <button onclick="cambiarEquipo(${i})">Cambiar nombre</button>
        <button onclick="eliminarEquipo(${i})">Eliminar</button>
      </div>
    `).join("");
  }

  ["local", "visitante", "proximoLocal", "proximoVisitante"].forEach(llenarSelect);

  if ($("cantidadEquiposConfig")) $("cantidadEquiposConfig").value = torneo.teams.length;
  if ($("formatoTorneo")) $("formatoTorneo").value = torneo.format;
  if ($("cantidadGrupos")) $("cantidadGrupos").value = torneo.groupCount;
  if ($("urlYouTube")) $("urlYouTube").value = torneo.liveUrl || "";
  if ($("urlTikTok")) $("urlTikTok").value = torneo.tiktokUrl || "";
  if ($("urlFacebook")) $("urlFacebook").value = torneo.facebookUrl || "";
}

function pintarCronometro() {
  const el = $("cronometro");
  if (!el || !torneo) return;

  const segundos = segundosActuales();
  const minutos = String(Math.floor(segundos / 60)).padStart(2, "0");
  const resto = String(segundos % 60).padStart(2, "0");
  el.textContent = `${minutos}:${resto}`;

  const estado = $("estadoCronometro");
  if (estado) estado.textContent = torneo.timer.active ? "EN JUEGO" : "PAUSADO";
}


function mostrarAdministrador() {
  const panel = $("panelAdmin");
  const login = $("loginAdmin");

  if (panel) panel.style.display = administrador ? "block" : "none";
  if (login) login.style.display = administrador ? "none" : "block";
}

function renderizar() {
  if (!torneo) return;

  pintarInicio();
  pintarSorteo();
  pintarPosiciones();
  pintarResultados();
  pintarCalendario();
  pintarEnVivo();
  pintarEquiposAdmin();
  pintarEditorFixture();
  pintarCronometro();
  mostrarAdministrador();
}

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

window.aplicarConfiguracionTorneo = async function () {
  if (!administrador) return;

  const cantidad = Number($("cantidadEquiposConfig")?.value);
  const formato = $("formatoTorneo")?.value || "grupos";
  if (!Number.isInteger(cantidad) || cantidad < 2 || cantidad > 64) {
    alert("El número de equipos debe estar entre 2 y 64.");
    return;
  }
  if (formato === "grupos" && cantidad < 4) {
    alert("El formato de grupos con semifinales necesita al menos 4 equipos.");
    return;
  }
  if (!["todos", "ida_vuelta", "grupos", "eliminacion"].includes(formato)) {
    alert("Selecciona un formato válido.");
    return;
  }
  const gruposElegidos = Number($("cantidadGrupos")?.value || 2);
  if (formato === "grupos" && (!Number.isInteger(gruposElegidos) || gruposElegidos < 2 || gruposElegidos > Math.min(8, cantidad))) {
    alert("La cantidad de grupos debe estar entre 2 y 8 y no superar el número de equipos.");
    return;
  }
  if (!confirm("Aplicar la configuración reiniciará el calendario y los resultados actuales. ¿Deseas continuar?")) return;

  const equipos = [...torneo.teams];
  while (equipos.length < cantidad) equipos.push(`Equipo ${equipos.length + 1}`);
  torneo.teams = equipos.slice(0, cantidad);
  torneo.format = formato;
  torneo.groupCount = formato === "grupos" ? gruposElegidos : 0;
  torneo.matches = [];
  torneo.groupDraw = formato === "grupos"
    ? crearGrupos(torneo.teams, torneo.groupCount)
    : null;

  torneo.upcoming = [];
  renderizar();
  await guardar();
  mensaje("Configuración del torneo guardada.");
};

window.realizarSorteo = async function () {
  if (!administrador) return;
  if (torneo.format !== "grupos") {
    alert("El sorteo por grupos solo se utiliza en el formato de grupos y eliminatorias.");
    return;
  }

  const cantidad = Math.min(Math.max(2, Number(torneo.groupCount) || 2), torneo.teams.length);
  torneo.groupDraw = crearGrupos(torneo.teams, cantidad);
  torneo.matches = [];
  renderizar();
  await guardar();
};


window.agregarEquipo = async function () {
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
  if (torneo.format === "grupos") {
    torneo.groupDraw = crearGrupos(torneo.teams, Math.min(torneo.groupCount || 2, torneo.teams.length));
  }
  generarCalendario();
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
    Object.keys(torneo.groupDraw).forEach(g => {
      torneo.groupDraw[g] = torneo.groupDraw[g].map(e => e === anterior ? nombre : e);
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

  if (torneo.format === "grupos" && torneo.teams.length >= 2) {
    torneo.groupCount = Math.min(torneo.groupCount || 2, torneo.teams.length);
    torneo.groupDraw = crearGrupos(torneo.teams, torneo.groupCount);
  } else {
    torneo.groupDraw = null;
  }
  generarCalendario();

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
function pintarCalendarioAdmin() {
  const cont = $("editorCalendario");
  if (!cont || !administrador) return;

  if (!torneo.upcoming.length) {
    cont.textContent = "Todavía no hay partidos en el fixture.";
    return;
  }

  cont.innerHTML = torneo.upcoming.map((p, i) => `
    <article class="match">
      <div class="muted">
        ${escapar(p.group || "General")} -
        ${escapar(p.date || "Por programar")}
      </div>

      <div class="score">
        <span>${escapar(p.home)}</span>
        <b>VS</b>
        <span>${escapar(p.away)}</span>
      </div>

      <p>Hora: ${escapar(p.time || "Por definir")}</p>

      <button onclick="editarPartido(${i})">
        Editar partido
      </button>

      <button class="danger"
        onclick="eliminarPartidoFixture(${i})">
        Eliminar
      </button>
    </article>
  `).join("");
}

window.editarPartido = async indice => {
  if (!administrador || !torneo) return;

  const partido = torneo.upcoming[indice];
  if (!partido) return;

  const local = prompt("Equipo local:", partido.home);
  if (local === null) return;

  const visitante = prompt("Equipo visitante:", partido.away);
  if (visitante === null) return;

  const fecha = prompt("Jornada o fecha:", partido.date || "");
  if (fecha === null) return;

  const hora = prompt("Hora del partido:", partido.time || "");
  if (hora === null) return;

  const nombres = torneo.teams;

  if (
    !nombres.includes(local.trim()) ||
    !nombres.includes(visitante.trim()) ||
    local.trim() === visitante.trim()
  ) {
    return alert("Selecciona dos equipos válidos y diferentes.");
  }

  partido.home = local.trim();
  partido.away = visitante.trim();
  partido.date = fecha.trim() || "Por programar";
  partido.time = hora.trim();

  renderizar();
  await guardar();
};

window.eliminarPartidoFixture = async indice => {
  if (!administrador || !torneo) return;

  if (!confirm("¿Eliminar este partido del fixture?")) return;

  torneo.upcoming.splice(indice, 1);

  renderizar();
  await guardar();
};
function pintarEditorFixture() {
  const cont = $("editorFixture");
  if (!cont || !administrador) return;

  if (!torneo.upcoming.length) {
    cont.textContent = "Primero genera el fixture del torneo.";
    return;
  }

  cont.innerHTML = torneo.upcoming.map((p, i) => `
    <article class="match">
      <h3>${escapar(p.group || "General")} -
        Jornada ${escapar(p.round || 1)}</h3>

      <p>
        <b>${escapar(p.home)}</b> VS
        <b>${escapar(p.away)}</b>
      </p>

      <label>Fecha</label>
      <input type="date"
        id="fixtureFecha${i}"
        value="${escapar(p.date || "")}">

      <label>Hora</label>
      <input type="time"
        id="fixtureHora${i}"
        value="${escapar(p.time || "")}">

      <button type="button"
        onclick="guardarHorarioFixture(${i})">
        Guardar fecha y hora
      </button>
    </article>
  `).join("");
}

window.guardarHorarioFixture = async indice => {
  if (!administrador || !torneo) return;

  const partido = torneo.upcoming[indice];
  if (!partido) return;

  partido.date = $("fixtureFecha" + indice).value;
  partido.time = $("fixtureHora" + indice).value;

  await guardar();
  renderizar();

  alert("Fecha y hora guardadas correctamente.");
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
  if (!administrador) return;
  const youtube = $("urlYouTube")?.value.trim() || "";
  const tiktok = $("urlTikTok")?.value.trim() || "";
  const facebook = $("urlFacebook")?.value.trim() || "";
  const validar = (valor, dominios, etiqueta, rutaOpcional = false) => {
    if (!valor) return "";
    const u = new URL(valor);
    if (!dominios.includes(u.hostname.toLowerCase())) throw new Error("Revisa el enlace de " + etiqueta + ".");
    if (etiqueta === "YouTube" && !u.pathname.startsWith("/embed/")) throw new Error("YouTube debe usar un enlace /embed/.");
    return u.href;
  };
  try {
    torneo.liveUrl = validar(youtube, ["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"], "YouTube");
    torneo.tiktokUrl = validar(tiktok, ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"], "TikTok");
    torneo.facebookUrl = validar(facebook, ["facebook.com", "www.facebook.com", "fb.watch", "m.facebook.com"], "Facebook");
    renderizar();
    await guardar();
    mensaje("Enlaces de transmisión guardados.");
  } catch (error) {
    alert(error.message || "Uno de los enlaces no es válido.");
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
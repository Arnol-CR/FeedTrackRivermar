const selectSector = document.getElementById('sector');
const selectTipoRecipiente = document.getElementById('tipo-recipiente');
const inputFecha = document.getElementById('fecha');
const form = document.getElementById('form-reporte');
const tbody = document.querySelector('#tabla-reporte tbody');
const mensajeReporte = document.getElementById('mensaje-reporte');

// Fecha por defecto: hoy (en hora local, no UTC)
function fechaLocalHoy() {
  const hoy = new Date();
  const offset = hoy.getTimezoneOffset() * 60000; // minutos a milisegundos
  return new Date(hoy - offset).toISOString().split('T')[0];
}
inputFecha.value = fechaLocalHoy();

// Intenta encontrar una columna "de nombre" en un registro, sin asumir un
// nombre exacto de columna (las vistas pueden variar).
function obtenerEtiqueta(fila, idField) {
  const candidatos = ['Nombre', 'NombreSector', 'Sector', 'Descripcion',
    'NombreTipoRecipiente', 'TipoRecipiente', 'NombreRecipiente'];
  for (const campo of candidatos) {
    if (fila[campo]) return fila[campo];
  }
  return `#${fila[idField]}`;
}

async function cargarCombos() {
  try {
    const [resSectores, resTipos] = await Promise.all([
      fetch('/api/reportes/sectores', { headers: authHeaders() }),
      fetch('/api/reportes/tipos-recipientes', { headers: authHeaders() })
    ]);
    await manejarRespuesta(resSectores);
    await manejarRespuesta(resTipos);

    const sectores = await resSectores.json();
    const tipos = await resTipos.json();

const SECTORES_EXCLUIDOS = ['EXPOMARE', 'LAS DELICIAS', 'ACUAGOLFO'];

selectSector.innerHTML = sectores
  .filter(s => {
    const nombre = obtenerEtiqueta(s, 'IdSector').toUpperCase().trim();
    return !nombre.startsWith('TODA') && !SECTORES_EXCLUIDOS.includes(nombre);
  })
  .map(s => `<option value="${s.IdSector}">${obtenerEtiqueta(s, 'IdSector')}</option>`)
  .join('');

    selectTipoRecipiente.innerHTML = tipos.map(t =>
      `<option value="${t.IdTipoRecimiente}">${obtenerEtiqueta(t, 'IdTipoRecimiente')}</option>`
    ).join('');
  } catch (err) {
    console.error('Error al cargar combos:', err);
    mostrarError('No se pudieron cargar los sectores / tipos de recipiente');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  ocultarError();
  tbody.innerHTML = '';

  const params = new URLSearchParams({
    fecha: inputFecha.value,
    idSector: selectSector.value,
    idRecipiente: selectTipoRecipiente.value
  });

  try {
    const res = await fetch(`/api/reportes/racion?${params}`, { headers: authHeaders() });
    await manejarRespuesta(res);
    const data = await res.json();

    if (!res.ok) {
      mostrarError(data.detalle || data.error || 'No se pudo generar el reporte');
      return;
    }

    const filas = data.filter(f =>
      Number(f.Racion) > 0 ||
      (f.LecturaMañana && f.LecturaMañana.trim() !== '') ||
      (f.LecturaTarde && f.LecturaTarde.trim() !== '')
    );

    if (filas.length === 0) {
      mostrarError('No hay datos para los filtros seleccionados');
      return;
    }

const mapaRacionesExistentes = await obtenerRacionesExistentes(filas);
const mapaAjustesExistentes = await obtenerAjustesExistentes(filas);
mostrarResumenFiltros();
renderTabla(filas, mapaRacionesExistentes, mapaAjustesExistentes);
  } catch (err) {
    console.error('Error al generar el reporte:', err);
    mostrarError('Error de conexión al generar el reporte');
  }
});

function calcularFechaSiguiente() {
  const fechaSeleccionada = new Date(inputFecha.value + 'T00:00:00');
  fechaSeleccionada.setDate(fechaSeleccionada.getDate() + 1);
  return fechaSeleccionada.toISOString().split('T')[0];
}

async function obtenerAjustesExistentes(filas) {
  const idEstanques = filas.map(f => f.IdEstanque).join(',');

  try {
    const res = await fetch(`/api/reportes/ajustes-existentes?fecha=${inputFecha.value}&idEstanques=${idEstanques}`, {
      headers: authHeaders()
    });
    await manejarRespuesta(res);
    const registros = await res.json();

    const mapa = {};
    registros.forEach(r => { mapa[r.IdEstanque] = { ajuste1: r.Ajuste1, ajuste2: r.Ajuste2 }; });
    return mapa;
  } catch (err) {
    console.error('Error al obtener ajustes existentes:', err);
    return {};
  }
}

async function obtenerRacionesExistentes(filas) {
  const fechaSiguiente = calcularFechaSiguiente();
  const idEstanques = filas.map(f => f.IdEstanque).join(',');

  try {
    const res = await fetch(`/api/reportes/racion-existente?fecha=${fechaSiguiente}&idEstanques=${idEstanques}`, {
      headers: authHeaders()
    });
    await manejarRespuesta(res);
    const registros = await res.json();

    const mapa = {};
    registros.forEach(r => { mapa[r.IdEstanque] = r.Racion; });
    return mapa;
  } catch (err) {
    console.error('Error al obtener raciones existentes:', err);
    return {};
  }
}

const timersGuardado = {};
const timersAjustes = {};

function renderTabla(filas, mapaRacionesExistentes = {}, mapaAjustesExistentes = {}) {
  tbody.innerHTML = filas.map((f, i) => {
    const racionExistente = mapaRacionesExistentes[f.IdEstanque];
    const valorInicialRacion = (racionExistente !== undefined && racionExistente !== null)
      ? Number(racionExistente).toLocaleString('es-HN', { maximumFractionDigits: 2 })
      : '';

    const ajustes = mapaAjustesExistentes[f.IdEstanque] || {};
    const valorAjuste1 = (ajustes.ajuste1 !== undefined && ajustes.ajuste1 !== null)
      ? Number(ajustes.ajuste1).toLocaleString('es-HN', { maximumFractionDigits: 2 })
      : '';
    const valorAjuste2 = (ajustes.ajuste2 !== undefined && ajustes.ajuste2 !== null)
      ? Number(ajustes.ajuste2).toLocaleString('es-HN', { maximumFractionDigits: 2 })
      : '';

    return `
    <tr>
      <td>
        <div style="display:flex; justify-content:center;">
  <button type="button" onclick="toggleHistorial(${i}, ${f.IdEstanque})"
          id="btn-historial-${i}"
          style="background:transparent; color:#0F9D58; border:none; cursor:pointer; font-weight:bold; font-size:1.4rem; line-height:1; padding:0.2rem;">+</button>
</div>
      </td>
      <td>${f.NombreRecipiente ?? ''}</td>
      <td>
        <input type="text" inputmode="decimal" id="ajuste1-${i}" name="ajuste1-${i}" autocomplete="off" value="${valorAjuste1}"
          oninput="onCambioAjuste(${i}, ${f.IdEstanque})"
          onfocus="limpiarCampoParaEditar(this)"
          onblur="formatearCampo(this)"
          style="width:65px; padding:0.4rem; border:1px solid #cbd2d9; border-radius:4px; text-align:center;">
      </td>
      <td>
       <input type="text" inputmode="decimal" id="ajuste2-${i}" name="ajuste2-${i}" autocomplete="off" value="${valorAjuste2}"
       oninput="onCambioAjuste(${i}, ${f.IdEstanque})"
       onfocus="limpiarCampoParaEditar(this)"
       onblur="formatearCampo(this)"
       style="width:65px; padding:0.4rem; border:1px solid #cbd2d9; border-radius:4px; text-align:center;">

        <span id="estado-ajuste-${i}" style="font-size:0.8rem; display:block; margin-top:0.2rem;"></span>
      </td>
      <td>${formatearNumero(f.Racion)}</td>
      <td>${formatearNumero(f.LibrasConsumo)}</td>
      <td>${badgePorcentaje(f.Porcentaje)}</td>
<td>${badgeEstado(f.LecturaMañana)}</td>
<td>${badgeEstado(f.LecturaTarde)}</td>
      <td>
        <div style="display:flex; gap:0.4rem; align-items:center; justify-content:center;">
          <input type="text" inputmode="decimal" placeholder="Ración"
              id="racion-siguiente-${i}" name="racion-siguiente-${i}" autocomplete="off" value="${valorInicialRacion}"
              oninput="onCambioRacion(${i}, ${f.IdEstanque})"
              onfocus="limpiarCampoParaEditar(this)"
              onblur="formatearCampo(this)"
              style="width:80px; padding:0.4rem; border:1px solid #cbd2d9; border-radius:4px; text-align:center;">
          <span id="estado-racion-${i}" style="font-size:0.8rem;"></span>
        </div>
      </td>
    </tr>
    <tr id="fila-historial-${i}" style="display:none;">
      <td colspan="10" style="background:#f4f5f7; padding:0;">
        <div id="contenido-historial-${i}" style="padding:1rem 2rem;">Cargando...</div>
      </td>
    </tr>
  `;
  }).join('');
}

async function toggleHistorial(indice, idEstanque) {
  const fila = document.getElementById(`fila-historial-${indice}`);
  const boton = document.getElementById(`btn-historial-${indice}`);
  const abierta = fila.style.display !== 'none';

  if (abierta) {
    fila.style.display = 'none';
    boton.textContent = '+';
    return;
  }

  fila.style.display = 'table-row';
  boton.textContent = '−';

  const contenido = document.getElementById(`contenido-historial-${indice}`);
  contenido.innerHTML = 'Cargando...';

  try {
    const res = await fetch(`/api/reportes/historial?idEstanque=${idEstanque}&fecha=${inputFecha.value}`, {
      headers: authHeaders()
    });
    await manejarRespuesta(res);
    const dias = await res.json();

    if (dias.length === 0) {
      contenido.innerHTML = '<em>Sin historial disponible.</em>';
      return;
    }

    contenido.innerHTML = `
      <div style="background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="padding:0.75rem 1rem 0; font-weight:600; color:#1E3A8A; font-size:0.85rem;">📅 Historial — últimos 6 días</div>  
      <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead>
  <tr style="background:#DBEAFE; color:#1E3A8A;">
    <th style="text-align:left; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Fecha</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Consumo 100%/Ración</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">%</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Ajuste 1</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Ajuste 2</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">O₂ mañana</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">O₂ Noche</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">C° Mañana</th>
    <th style="text-align:center; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">C° Tarde</th>
    <th style="text-align:left; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Lectura Mañana</th>
    <th style="text-align:left; padding:0.4rem 0.8rem; font-size:0.75rem; background:#DBEAFE; color:#1E3A8A;">Lectura Tarde</th>
  </tr>
</thead>
          <tbody>
            ${dias.map((d, i) => `
              <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f8f9fb'};">
                <td style="padding:0.6rem 0.8rem; white-space:nowrap;">${formatearFecha(d.Fecha)}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem; white-space:nowrap;">${formatearNumero(d.LibrasConsumo)} / ${formatearNumero(d.Racion)}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${badgePorcentaje(d.Porcentaje)}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${d.Ajuste1 ? formatearNumero(d.Ajuste1) : '-'}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${d.Ajuste2 ? formatearNumero(d.Ajuste2) : '-'}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${badgeOxigenoManana(d.OxigenoManana)}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${badgeOxigenoNoche(d.OxigenoHora3)}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${d.TemperaturaManana ?? '-'}</td>
                <td style="text-align:center; padding:0.6rem 0.8rem;">${d.TemperaturaTarde ?? '-'}</td>
                <td style="padding:0.6rem 0.8rem;">${badgeEstado(d.LecturaMañana)}</td>
                <td style="padding:0.6rem 0.8rem;">${badgeEstado(d.LecturaTarde)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Error al cargar historial:', err);
    contenido.innerHTML = '<em style="color:#b91c1c;">Error al cargar el historial.</em>';
  }
}


function formatearFecha(fechaISO) {
  const f = new Date(fechaISO);
  const dia = String(f.getUTCDate()).padStart(2, '0');
  const mes = String(f.getUTCMonth() + 1).padStart(2, '0');
  const anio = f.getUTCFullYear();
  return `${dia}/${mes}/${anio}`;
}


function onCambioAjuste(indice, idEstanque) {
  const estado = document.getElementById(`estado-ajuste-${indice}`);
  estado.textContent = '';
  estado.style.color = '';

  clearTimeout(timersAjustes[indice]);
  timersAjustes[indice] = setTimeout(() => {
    guardarAjustes(indice, idEstanque);
  }, 800);
}
async function guardarAjustes(indice, idEstanque) {
  const inputAjuste1 = document.getElementById(`ajuste1-${indice}`);
  const inputAjuste2 = document.getElementById(`ajuste2-${indice}`);
  const estado = document.getElementById(`estado-ajuste-${indice}`);

  const valor1 = limpiarNumero(inputAjuste1.value);
  const valor2 = limpiarNumero(inputAjuste2.value);

  if ((valor1 !== '' && isNaN(valor1)) || (valor2 !== '' && isNaN(valor2))) {
    estado.textContent = 'Número inválido';
    estado.style.color = '#b91c1c';
    return;
  }

  estado.textContent = 'Guardando...';
  estado.style.color = '#6b7280';

  try {
    const res = await fetch('/api/reportes/ajustes', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        idEstanque,
        fecha: inputFecha.value,
        ajuste1: valor1 === '' ? null : Number(valor1),
        ajuste2: valor2 === '' ? null : Number(valor2)
      })
    });
    await manejarRespuesta(res);
    const data = await res.json();

    if (!res.ok) {
      estado.textContent = data.detalle || data.error || 'Error al guardar';
      estado.style.color = '#b91c1c';
      return;
    }

    estado.textContent = '✔ Guardado';
    estado.style.color = '#15803d';
  } catch (err) {
    console.error('Error al guardar ajustes:', err);
    estado.textContent = 'Error de conexión';
    estado.style.color = '#b91c1c';
  }
}


function onCambioRacion(indice, idEstanque) {
  const estado = document.getElementById(`estado-racion-${indice}`);
  estado.textContent = '';

  clearTimeout(timersGuardado[indice]);
  timersGuardado[indice] = setTimeout(() => {
    guardarRacionSiguiente(indice, idEstanque);
  }, 800); // espera 800ms después de dejar de escribir
}

function badgePorcentaje(valor) {
  const pct = Number(valor) || 0;
  let color = '#EF4444'; // rojo: <= 50
  if (pct > 55) color = '#10B981'; // verde: > 55
  else if (pct > 50) color = '#F59E0B'; // amarillo: 50.01–55
  return `<span style="background:${color}22; color:${color}; padding:0.35rem 0.85rem; border-radius:999px; font-weight:700; font-size:0.9rem;">${pct}%</span>`;
}

function badgeOxigenoManana(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  const num = Number(valor);
  let color = '#EF4444'; // rojo: 0 - 1.99
  if (num >= 2.5) color = '#10B981'; // verde: 2.5 - 100
  else if (num >= 2) color = '#F59E0B'; // amarillo: 2 - 2.49
  return `<span style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; background:${color}22; color:${color}; font-weight:700; font-size:0.8rem;">${num}</span>`;
}

function badgeOxigenoNoche(valor) {
  if (valor === null || valor === undefined || valor === '') return '-';
  const num = Number(valor);
  let color = '#EF4444'; // rojo: 0 - 5.49
  if (num >= 6) color = '#10B981'; // verde: 6 - 100
  else if (num >= 5.5) color = '#F59E0B'; // amarillo: 5.5 - 5.99
  return `<span style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; background:${color}22; color:${color}; font-weight:700; font-size:0.8rem;">${num}</span>`;
}

function badgeEstado(texto) {
  if (!texto || texto.trim() === '') return '';
  const t = texto.toUpperCase();

  const tieneBarrida = t.includes('BARRIDA');
  const tieneProblema = t.includes('MUERTO') || t.includes('ROJOS');

  // Combo: barrida (bien) + problema (mal) a la vez
  if (tieneBarrida && tieneProblema) {
    return `<span style="display:inline-block; padding:0.2rem 0.6rem; border-radius:5px; font-size:0.7rem; font-weight:600; white-space:normal; background:linear-gradient(90deg, #d1fae5 50%, #fee2e2 50%); color:#1f2933; border-left:3px solid #10B981; border-right:3px solid #EF4444;">${texto}</span>`;
  }

  let color = '#475569', fondo = '#e2e8f0';

  if (tieneProblema) { color = '#EF4444'; fondo = '#fee2e2'; }
  else if (t.includes('PAUSA')) { color = '#F59E0B'; fondo = '#fef3c7'; }
  else if (tieneBarrida) { color = '#10B981'; fondo = '#d1fae5'; }
  else if (t.includes('RALEO') || t.includes('COSECHA')) { color = '#1E3A8A'; fondo = '#dbeafe'; }
  else if (t.includes('POCOS GRANOS') || t.includes('NO BARRE')) { color = '#EA580C'; fondo = '#fed7aa'; }

  return `<span style="display:inline-block; background:${fondo}; color:${color}; padding:0.2rem 0.6rem; border-radius:5px; font-size:0.7rem; font-weight:600; white-space:normal;">${texto}</span>`;
}


function limpiarNumero(texto) {
  return String(texto ?? '')
    .replace(/,/g, '')
    .replace(/[^\d.\-]/g, '')
    .trim();
}

function formatearCampo(input) {
  const limpio = limpiarNumero(input.value);
  if (limpio === '' || isNaN(limpio)) return;
  input.value = Number(limpio).toLocaleString('es-HN', { maximumFractionDigits: 2 });
}

function limpiarCampoParaEditar(input) {
  input.value = limpiarNumero(input.value);
}

function mostrarResumenFiltros() {
  const textoSector = selectSector.options[selectSector.selectedIndex]?.text || '';
  const [anio, mes, dia] = inputFecha.value.split('-');
  const fechaFormateada = `${dia}/${mes}/${anio}`;
  document.getElementById('resumen-filtros').textContent =
    `Sector: ${textoSector}  •  Fecha: ${fechaFormateada}`;
}

async function guardarRacionSiguiente(indice, idEstanque) {
  const input = document.getElementById(`racion-siguiente-${indice}`);
  const estado = document.getElementById(`estado-racion-${indice}`);
  const valor = input.value;

  if (valor === '') {
    estado.textContent = '';
    return;
  }

  if (isNaN(valor)) {
    estado.textContent = 'Número inválido';
    estado.style.color = '#b91c1c';
    return;
  }

  // La ración capturada aquí es para el día SIGUIENTE a la fecha consultada
  const fechaSiguiente = calcularFechaSiguiente();

  estado.textContent = 'Guardando...';
  estado.style.color = '#6b7280';

  try {
    const res = await fetch('/api/reportes/racion', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ idEstanque, fecha: fechaSiguiente, racion: Number(valor) })
    });
    await manejarRespuesta(res);
    const data = await res.json();

    if (!res.ok) {
      estado.textContent = data.detalle || data.error || 'Error al guardar';
      estado.style.color = '#b91c1c';
      return;
    }

    estado.textContent = '✔ Guardado';
    estado.style.color = '#15803d';
  } catch (err) {
    console.error('Error al guardar ración del día siguiente:', err);
    estado.textContent = 'Error de conexión';
    estado.style.color = '#b91c1c';
  }
}

function mostrarError(texto) {
  mensajeReporte.textContent = texto;
  mensajeReporte.hidden = false;
}

function ocultarError() {
  mensajeReporte.hidden = true;
  mensajeReporte.textContent = '';
}

function formatearNumero(valor) {
  const num = Number(valor) || 0;
  return num.toLocaleString('es-HN', { maximumFractionDigits: 0 });
}

cargarCombos();
document.getElementById('btn-exportar-excel').addEventListener('click', exportarExcel);
document.getElementById('btn-copiar-imagen').addEventListener('click', copiarImagen);

function leerFilasVisibles() {
  const filas = [];
  document.querySelectorAll('#tabla-reporte tbody tr').forEach(tr => {
    const c = tr.querySelectorAll('td');
    filas.push({
      'Recipiente': c[0].textContent.trim(),
      'Ajuste 1': (c[1].querySelector('input')?.value || '').replace(/,/g, ''),
      'Ajuste 2': (c[2].querySelector('input')?.value || '').replace(/,/g, ''),
      'Ración': c[3].textContent.replace(/,/g, '').trim(),
      'Libras consumo': c[4].textContent.replace(/,/g, '').trim(),
      '%': c[5].textContent.trim(),
      'Lectura mañana': c[6].textContent.trim(),
      'Lectura tarde': c[7].textContent.trim(),
      'Ración día siguiente': (c[8].querySelector('input')?.value || '').replace(/,/g, '')
    });
  });
  return filas;
}

function exportarExcel() {
  const filas = leerFilasVisibles();
  if (filas.length === 0) {
    mostrarError('No hay datos para exportar');
    return;
  }
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Reporte de Ración');
  XLSX.writeFile(libro, `ReporteRacion_${inputFecha.value}.xlsx`);
}

async function construirElementoParaImagen() {
  const textoSector = selectSector.options[selectSector.selectedIndex]?.text || '';
  const [anio, mes, dia] = inputFecha.value.split('-');
  const fechaFormateada = `${dia}/${mes}/${anio}`;
  const usuario = localStorage.getItem('usuario') || '';

  const temp = document.createElement('div');
  temp.style.cssText = 'position:fixed; left:-9999px; top:0; background:white; padding:24px; width:1400px; font-family:Inter, system-ui, sans-serif;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex; align-items:center; gap:16px; margin-bottom:20px; border-bottom:3px solid #4285F4; padding-bottom:16px;';
  header.innerHTML = `
    <img src="img/logo.png" style="width:56px; height:56px;">
    <div>
      <div style="font-size:22px; font-weight:700; color:#1f2933;">FeedTrack Web Rivermar</div>
      <div style="font-size:14px; color:#6b7280;">Reporte de Ración — Sector: ${textoSector} · Fecha: ${fechaFormateada}</div>
      <div style="font-size:13px; color:#6b7280;">Generado por: ${usuario}</div>
    </div>
  `;
  temp.appendChild(header);

  const tablaClonada = document.getElementById('tabla-reporte').cloneNode(true);
  tablaClonada.querySelectorAll('input').forEach(input => {
    const span = document.createElement('span');
    span.textContent = input.value || '-';
    input.replaceWith(span);
  });
tablaClonada.querySelectorAll('tr').forEach(tr => {
  const celda = tr.children[9]; // columna "Ración día siguiente"
  if (celda) {
    celda.style.background = '#0f799a';
    celda.style.fontWeight = 'bold';
    celda.style.color = 'white';
  }
  });
  temp.appendChild(tablaClonada);
  document.body.appendChild(temp);
  return temp;
}

async function copiarImagen() {
  if (document.querySelectorAll('#tabla-reporte tbody tr').length === 0) {
    mostrarError('No hay datos para copiar');
    return;
  }

  const temp = await construirElementoParaImagen();

  try {
    const canvas = await html2canvas(temp, { scale: 2, backgroundColor: '#ffffff' });
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        mostrarError('✔ Imagen copiada, ya puedes pegarla (Ctrl+V)');
      } catch (err) {
        console.error('Error al copiar al portapapeles:', err);
        mostrarError('No se pudo copiar la imagen (tu navegador podría no permitirlo)');
      }
    }, 'image/png');
  } catch (err) {
    console.error('Error al generar la imagen:', err);
    mostrarError('Error al generar la imagen');
  } finally {
    document.body.removeChild(temp);
  }
}
// --- Guardia de sesión (se ejecuta apenas carga el script) ---
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = 'login.html';
}

// --- Helpers para llamadas autenticadas a la API ---
function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  };
}

async function manejarRespuesta(res) {
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('idUsuario');
    localStorage.removeItem('usuario');
    window.location.href = 'login.html';
    throw new Error('Sesión expirada');
  }
  return res;
}

// --- Títulos de cada página según data-page en <body> ---
const TITULOS_PAGINA = {
  inicio: 'Inicio',
  usuarios: 'Usuarios',
  reportes: 'Analítica de Campo',
  horario: 'Programación de Raciones'
};

function inicializarLayout() {
  const paginaActual = document.body.dataset.page || '';

  // Título en la topbar
  const tituloEl = document.getElementById('page-title');
  if (tituloEl) {
    tituloEl.textContent = TITULOS_PAGINA[paginaActual] || '';
  }

  // Usuario logueado
  const usuarioEl = document.getElementById('usuario-actual');
  if (usuarioEl) {
    usuarioEl.textContent = localStorage.getItem('usuario') || '';
  }

  // Resaltar link activo en el menú
  document.querySelectorAll('.sidebar nav a').forEach(link => {
    if (link.dataset.page === paginaActual) {
      link.classList.add('activo');
    }
  });

  // Botón de logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('idUsuario');
      localStorage.removeItem('usuario');
      window.location.href = 'login.html';
    });
  }

  // Botón hamburguesa: colapsa/expande el sidebar
  const btnToggle = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('sidebar');
  if (btnToggle && sidebar) {
    // En pantallas chicas arranca colapsado
    if (window.innerWidth <= 768) {
      sidebar.classList.add('colapsado');
    }
    btnToggle.addEventListener('click', () => {
      sidebar.classList.toggle('colapsado');
    });
  }
}

document.addEventListener('DOMContentLoaded', inicializarLayout);

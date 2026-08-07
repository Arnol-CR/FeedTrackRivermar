const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');

// GET /api/reportes/sectores -> lista de sectores para el combo
router.get('/sectores', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM P_V_Sectores');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener sectores:', err);
    res.status(500).json({ error: 'Error al obtener sectores', detalle: err.message });
  }
});

// GET /api/reportes/tipos-recipientes -> lista de tipos de recipiente para el combo
router.get('/tipos-recipientes', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM P_V_TipoRecipientes');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener tipos de recipiente:', err);
    res.status(500).json({ error: 'Error al obtener tipos de recipiente', detalle: err.message });
  }
});

router.get('/racion', async (req, res) => {
  const { fecha, idSector, idRecipiente } = req.query;

  if (!fecha || !idSector || !idRecipiente) {
    return res.status(400).json({ error: 'Fecha, sector y tipo de recipiente son requeridos' });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('Fecha', sql.Date, fecha)
      .input('IdSector', sql.Int, idSector)
      .input('IdRecipiente', sql.Int, idRecipiente)
      .execute('sp_ReporteRacion');

    const filas = result.recordset;

    if (filas.length > 0) {
      const idsEstanques = [...new Set(filas.map(f => f.IdEstanque))];
      const request2 = pool.request().input('Fecha', sql.Date, fecha);
      const placeholders = idsEstanques.map((id, i) => {
        request2.input(`id${i}`, sql.Int, id);
        return `@id${i}`;
      }).join(',');

      const lecturasResult = await request2.query(`
        SELECT
          L.IdEstanque,
          MAX(CASE WHEN L.IdHora = 1 THEN L.Oxigeno END) AS OxigenoManana,
          MAX(CASE WHEN L.IdHora = 3 THEN L.Oxigeno END) AS OxigenoNoche,
          MAX(CASE WHEN L.IdHora = 1 THEN L.Temperatura END) AS TemperaturaManana,
          MAX(CASE WHEN L.IdHora = 2 THEN L.Temperatura END) AS TemperaturaTarde
        FROM Lecturas L
        WHERE L.Fecha = @Fecha AND L.IdEstanque IN (${placeholders})
        GROUP BY L.IdEstanque
      `);

      const pesoResult = await pool.request()
        .input('Fecha', sql.Date, fecha)
        .query(`
          SELECT IdEstanque, [Peso (g) Proyectado] AS PesoGramos
          FROM PBI_Bitacoras
          WHERE Fecha = @Fecha AND IdEstanque IN (${idsEstanques.join(',')})
        `);

      const equiposResult = await pool.request()
        .input('Fecha', sql.Date, fecha)
        .query(`
          SELECT IdUbicacionLagSector AS IdEstanque, COUNT(DISTINCT IdEquipo) AS EquiposEncendidos
          FROM Tracker.dbo.VW_HorasTrabajas_Bitacora
          WHERE FechaHoraFinal = @Fecha
            AND HorasTrabajadas > 0
            AND IdUbicacionLagSector IN (${idsEstanques.join(',')})
            AND TipoEquipo = 'Aireador'
          GROUP BY IdUbicacionLagSector
        `);
      const mapaLecturas = {};
      lecturasResult.recordset.forEach(r => { mapaLecturas[r.IdEstanque] = r; });

      const mapaPeso = {};
      pesoResult.recordset.forEach(r => { mapaPeso[r.IdEstanque] = r.PesoGramos; });

      const mapaEquipos = {};
      equiposResult.recordset.forEach(r => { mapaEquipos[r.IdEstanque] = r.EquiposEncendidos; });

      filas.forEach(f => {
        const l = mapaLecturas[f.IdEstanque] || {};
        f.OxigenoManana = l.OxigenoManana ?? null;
        f.OxigenoNoche = l.OxigenoNoche ?? null;
        f.TemperaturaManana = l.TemperaturaManana ?? null;
        f.TemperaturaTarde = l.TemperaturaTarde ?? null;
        f.PesoGramos = mapaPeso[f.IdEstanque] ?? null;
        f.EquiposEncendidos = mapaEquipos[f.IdEstanque] ?? null;
      });
    }

    res.json(filas);
  } catch (err) {
    console.error('Error al generar el reporte de ración:', err);
    res.status(500).json({ error: 'Error al generar el reporte', detalle: err.message });
  }
});

// POST /api/reportes/racion  { idEstanque, fecha, racion }
// Guarda/actualiza la ración de un estanque para una fecha (usado para
// capturar la ración del día siguiente desde el reporte).
router.post('/racion', async (req, res) => {
  const { idEstanque, fecha, racion } = req.body;

  if (!idEstanque || !fecha || racion === undefined || racion === null) {
    return res.status(400).json({ error: 'idEstanque, fecha y racion son requeridos' });
  }

  try {
    const pool = await getPool();
    await pool.request()
      .input('IdEstanque', sql.Int, idEstanque)
      .input('Fecha', sql.Date, fecha)
      .input('Racion', sql.Decimal(18, 2), racion)
      .execute('SP_ActualizarOInsertarRacion');

    res.json({ ok: true });
  } catch (err) {
    console.error('Error al guardar la ración:', err);
    res.status(500).json({ error: 'Error al guardar la ración', detalle: err.message });
  }
});

// GET /api/reportes/racion-existente?fecha=YYYY-MM-DD&idEstanques=1,2,3
// Devuelve la Ración ya guardada en Consumos para esa fecha, para precargar
// el campo "Ración día siguiente" en el reporte.
router.get('/racion-existente', async (req, res) => {
  const { fecha, idEstanques } = req.query;

  if (!fecha || !idEstanques) {
    return res.status(400).json({ error: 'fecha e idEstanques son requeridos' });
  }

  const ids = idEstanques.split(',').map(Number).filter(n => Number.isInteger(n));
  if (ids.length === 0) {
    return res.json([]);
  }

  try {
    const pool = await getPool();
    const request = pool.request().input('Fecha', sql.Date, fecha);
    const placeholders = ids.map((id, i) => {
      request.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    }).join(',');

    const result = await request.query(
      `SELECT IdEstanque, Racion FROM Consumos WHERE Fecha = @Fecha AND IdEstanque IN (${placeholders})`
    );

    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener raciones existentes:', err);
    res.status(500).json({ error: 'Error al obtener raciones existentes', detalle: err.message });
  }
});

// POST /api/reportes/ajustes  { idEstanque, fecha, ajuste1, ajuste2 }
router.post('/ajustes', async (req, res) => {
  const { idEstanque, fecha, ajuste1, ajuste2 } = req.body;

  if (!idEstanque || !fecha) {
    return res.status(400).json({ error: 'idEstanque y fecha son requeridos' });
  }

  try {
    const pool = await getPool();
    await pool.request()
      .input('IdEstanque', sql.Int, idEstanque)
      .input('Fecha', sql.Date, fecha)
      .input('Ajuste1', sql.Decimal(18, 2), ajuste1 === '' || ajuste1 === undefined ? null : ajuste1)
      .input('Ajuste2', sql.Decimal(18, 2), ajuste2 === '' || ajuste2 === undefined ? null : ajuste2)
      .execute('sp_ActualizarAjustes');

    res.json({ ok: true });
  } catch (err) {
    console.error('Error al guardar ajustes:', err);
    res.status(500).json({ error: 'Error al guardar ajustes', detalle: err.message });
  }
});

// GET /api/reportes/ajustes-existentes?fecha=YYYY-MM-DD&idEstanques=1,2,3
router.get('/ajustes-existentes', async (req, res) => {
  const { fecha, idEstanques } = req.query;

  if (!fecha || !idEstanques) {
    return res.status(400).json({ error: 'fecha e idEstanques son requeridos' });
  }

  const ids = idEstanques.split(',').map(Number).filter(n => Number.isInteger(n));
  if (ids.length === 0) {
    return res.json([]);
  }

  try {
    const pool = await getPool();
    const request = pool.request().input('Fecha', sql.Date, fecha);
    const placeholders = ids.map((id, i) => {
      request.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    }).join(',');

    const result = await request.query(
      `SELECT IdEstanque, Ajuste1, Ajuste2 FROM Consumos WHERE Fecha = @Fecha AND IdEstanque IN (${placeholders})`
    );

    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener ajustes existentes:', err);
    res.status(500).json({ error: 'Error al obtener ajustes existentes', detalle: err.message });
  }
});




// GET /api/reportes/historial?idEstanque=1&fecha=2026-07-24
// Devuelve los últimos 6 días de consumo/lecturas de un estanque, incluyendo la fecha dada.
router.get('/historial', async (req, res) => {
  const { idEstanque, fecha } = req.query;

  if (!idEstanque || !fecha) {
    return res.status(400).json({ error: 'idEstanque y fecha son requeridos' });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('IdEstanque', sql.Int, idEstanque)
      .input('Fecha', sql.Date, fecha)
      .query(`
        SELECT TOP 6
          C.Fecha,
          ISNULL(C.Racion, 0) AS Racion,
          ISNULL(DC.Libras, 0) AS LibrasConsumo,
          CAST(
            CASE
              WHEN ISNULL(C.Racion, 0) <> 0
              THEN (ISNULL(DC.Libras, 0) / C.Racion) * 100
              ELSE 0
            END
          AS DECIMAL(18,2)) AS Porcentaje,
          ISNULL(C.Ajuste1, 0) AS Ajuste1,
          ISNULL(C.Ajuste2, 0) AS Ajuste2,
          ISNULL(LM.Observaciones, '') AS LecturaMañana,
          ISNULL(LT.Observaciones, '') AS LecturaTarde,
          OM1.Oxigeno AS OxigenoManana,
          OM3.Oxigeno AS OxigenoHora3,
          TM1.Temperatura AS TemperaturaManana,
          TM2.Temperatura AS TemperaturaTarde
        FROM Consumos C
        OUTER APPLY (
          SELECT TOP 1 Libras FROM DetallesConsumos
          WHERE IdConsumo = C.IdConsumo AND HoraIngreso = 3
        ) DC
        OUTER APPLY (
          SELECT TOP 1 Observaciones FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 1
        ) LM
        OUTER APPLY (
          SELECT TOP 1 Observaciones FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 2
        ) LT
        OUTER APPLY (
          SELECT TOP 1 Oxigeno FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 1
        ) OM1
        OUTER APPLY (
          SELECT TOP 1 Oxigeno FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 3
        ) OM3
        OUTER APPLY (
          SELECT TOP 1 Temperatura FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 1
        ) TM1
        OUTER APPLY (
          SELECT TOP 1 Temperatura FROM Lecturas
          WHERE IdEstanque = @IdEstanque AND Fecha = C.Fecha AND IdHora = 2
        ) TM2
        WHERE C.IdEstanque = @IdEstanque
          AND C.Fecha < @Fecha
        ORDER BY C.Fecha DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener historial:', err);
    res.status(500).json({ error: 'Error al obtener historial', detalle: err.message });
  }
});

module.exports = router;

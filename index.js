const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const TICKET = process.env.MP_TICKET || "1FC8A3E9-5D72-495C-8340-83E5B1749B79";

app.use(cors({ origin: "*" }));
app.options("*", cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const REGIONES = [
  { codigo: "15", nombre: "Región de Arica y Parinacota",                oficial: "arica" },
  { codigo: "1",  nombre: "Región de Tarapacá",                          oficial: "tarapacá" },
  { codigo: "2",  nombre: "Región de Antofagasta",                       oficial: "antofagasta" },
  { codigo: "3",  nombre: "Región de Atacama",                           oficial: "atacama" },
  { codigo: "4",  nombre: "Región de Coquimbo",                          oficial: "coquimbo" },
  { codigo: "5",  nombre: "Región de Valparaíso",                        oficial: "valparaíso" },
  { codigo: "13", nombre: "Región Metropolitana",                        oficial: "metropolitana" },
  { codigo: "6",  nombre: "Región de O'Higgins",                         oficial: "o'higgins" },
  { codigo: "7",  nombre: "Región del Maule",                            oficial: "maule" },
  { codigo: "16", nombre: "Región de Ñuble",                             oficial: "ñuble" },
  { codigo: "8",  nombre: "Región del Biobío",                           oficial: "biobío" },
  { codigo: "9",  nombre: "Región de La Araucanía",                      oficial: "araucanía" },
  { codigo: "14", nombre: "Región de Los Ríos",                          oficial: "los ríos" },
  { codigo: "10", nombre: "Región de Los Lagos",                         oficial: "los lagos" },
  { codigo: "11", nombre: "Región de Aysén",                             oficial: "aysén" },
  { codigo: "12", nombre: "Región de Magallanes",                        oficial: "magallanes" }
];

const REGION_MAP = {};
REGIONES.forEach(r => REGION_MAP[r.codigo] = r.nombre);

// ── Salud ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Lista de regiones ─────────────────────────────────────────────────────────
app.get("/regiones", (req, res) => {
  res.json(REGIONES);
});

// ── Obtener detalle de una licitación por código ──────────────────────────────
async function fetchDetalle(codigo) {
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const l = data.Listado?.[0];
    if (!l) return null;
    // El detalle usa "Comprador.RegionUnidad" con el nombre completo de la región
    const regionTexto = l.Comprador?.RegionUnidad || "";
    return {
      organismo:    l.Comprador?.NombreOrganismo || l.Nombre_org_unidad_compradora || null,
      region:       regionTexto || null,
      regionTexto:  regionTexto.toLowerCase(),
      monto:        l.MontoEstimado ? `${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
      descripcion:  l.Descripcion || ""
    };
  } catch {
    return null;
  }
}

// Procesar en grupos paralelos de N
async function fetchDetallesEnGrupos(licitaciones, tamanoGrupo = 20) {
  const resultados = [];
  for (let i = 0; i < licitaciones.length; i += tamanoGrupo) {
    const grupo = licitaciones.slice(i, i + tamanoGrupo);
    const detalles = await Promise.all(
      grupo.map(l => fetchDetalle(l.CodigoExterno))
    );
    detalles.forEach((detalle, idx) => {
      resultados.push({ ...grupo[idx], detalle });
    });
  }
  return resultados;
}

// ── Búsqueda principal ────────────────────────────────────────────────────────
app.get("/buscar", async (req, res) => {
  const keyword    = (req.query.q     || "").toLowerCase().trim();
  const desdeParam = req.query.desde  || "todas";
  const hastaParam = req.query.hasta  || "todas";

  if (!keyword) return res.status(400).json({ error: "Parámetro q requerido" });

  // Calcular rango de regiones seleccionado
  let codigosValidos = null;
  if (desdeParam !== "todas" || hastaParam !== "todas") {
    const idxDesde = desdeParam === "todas" ? 0 : REGIONES.findIndex(r => r.codigo === desdeParam);
    const idxHasta = hastaParam === "todas" ? REGIONES.length - 1 : REGIONES.findIndex(r => r.codigo === hastaParam);
    const start = Math.min(idxDesde < 0 ? 0 : idxDesde, idxHasta < 0 ? REGIONES.length - 1 : idxHasta);
    const end   = Math.max(idxDesde < 0 ? 0 : idxDesde, idxHasta < 0 ? REGIONES.length - 1 : idxHasta);
    codigosValidos = new Set(REGIONES.slice(start, end + 1).map(r => r.codigo));
  }

  try {
    // Paso 1: Traer lista completa de licitaciones activas
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const mpRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    const licitaciones = data.Listado || [];

    // Paso 2: Filtrar por keyword
    const terms = keyword.split(/\s+/);
    const filtradas = licitaciones.filter(l => {
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      return terms.every(t => texto.includes(t));
    });

    if (filtradas.length === 0) {
      return res.json({ total: 0, keyword, resultados: [] });
    }

    // Paso 3: Obtener detalle de cada licitación en grupos paralelos de 20
    const conDetalle = await fetchDetallesEnGrupos(filtradas, 20);

    // Paso 4: Filtrar por región usando el dato real del detalle
    const resultado = conDetalle
      .filter(item => {
        if (!codigosValidos) return true;
        const cod = item.detalle?.codigoRegion || "";
        return codigosValidos.has(cod);
      })
      .map(item => ({
        titulo:           item.Nombre || "Sin título",
        codigo:           item.CodigoExterno || "",
        organismo:        item.detalle?.organismo || "–",
        region:           item.detalle?.region || null,
        codigoRegion:     "",
        estado:           estadoTexto(item.CodigoEstado),
        fechaPublicacion: formatFecha(item.FechaPublicacion),
        fechaCierre:      formatFecha(item.FechaCierre),
        monto:            item.detalle?.monto || (item.MontoEstimado ? `$${Number(item.MontoEstimado).toLocaleString("es-CL")} CLP` : null),
        descripcion:      item.detalle?.descripcion || item.Descripcion || "",
        url:              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${item.CodigoExterno}`,
        fuente:           "Mercado Público"
      }));

    res.json({ total: resultado.length, keyword, resultados: resultado });

  } catch (err) {
    console.error("Error /buscar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy Claude para análisis IA ─────────────────────────────────────────────
app.post("/claude", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": ANTHROPIC_KEY
      },
      body: JSON.stringify(req.body),
      timeout: 40000
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function estadoTexto(codigo) {
  const m = { "5":"Publicada","6":"Cerrada","7":"Desierta","8":"Adjudicada","9":"Revocada","10":"Suspendida","15":"Publicada","18":"Adjudicada" };
  return m[String(codigo)] || "Publicada";
}

function formatFecha(str) {
  if (!str) return "–";
  const match = String(str).match(/\/Date\((\d+)\)\//);
  if (match) return new Date(Number(match[1])).toLocaleDateString("es-CL");
  return String(str).substring(0, 10);
}

app.listen(PORT, () => console.log(`Backend licitaciones corriendo en puerto ${PORT}`));

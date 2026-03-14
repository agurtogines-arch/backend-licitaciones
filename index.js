const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const TICKET = process.env.MP_TICKET || "F8537A18-6766-4DEF-9E59-426B4FEE2844";

// CORS abierto para permitir llamadas desde claude.ai y cualquier origen
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "anthropic-dangerous-direct-browser-access"]
}));
app.options("*", cors());
app.use(express.json());

// ── Ruta de salud ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", mensaje: "Backend Licitaciones activo" });
});

// ── Búsqueda por keyword ──────────────────────────────────────────────────────
// GET /buscar?q=infraestructura+vial&estado=activas
app.get("/buscar", async (req, res) => {
  const keyword = (req.query.q || "").toLowerCase().trim();
  const estado  = req.query.estado || "activas";

  if (!keyword) return res.status(400).json({ error: "Parámetro q requerido" });

  try {
    // 1. Traer todas las licitaciones activas desde la API oficial
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=${estado}&ticket=${TICKET}`;
    const mpRes = await fetch(url, { timeout: 15000 });
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();

    const licitaciones = data.Listado || [];

    // 2. Filtrar por keyword en nombre y descripción
    const terms = keyword.split(/\s+/); // soporta múltiples palabras
    const filtradas = licitaciones.filter(l => {
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      return terms.every(t => texto.includes(t)); // todas las palabras deben aparecer
    });

    // 3. Mapear al formato que usa el agente
    const resultado = filtradas.map(l => ({
      titulo:           l.Nombre || "Sin título",
      codigo:           l.CodigoExterno || "",
      organismo:        l.Nombre_org_unidad_compradora || l.NombreOrganismo || "–",
      estado:           estadoTexto(l.CodigoEstado),
      fechaPublicacion: formatFecha(l.FechaPublicacion),
      fechaCierre:      formatFecha(l.FechaCierre),
      monto:            l.MontoEstimado ? `$${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
      descripcion:      l.Descripcion || "",
      url:              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
      fuente:           "Mercado Público"
    }));

    res.json({ total: resultado.length, keyword, resultados: resultado });

  } catch (err) {
    console.error("Error /buscar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Detalle de una licitación por código ──────────────────────────────────────
// GET /detalle?codigo=1234-56-LE25
app.get("/detalle", async (req, res) => {
  const codigo = (req.query.codigo || "").trim();
  if (!codigo) return res.status(400).json({ error: "Parámetro codigo requerido" });

  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
    const mpRes = await fetch(url, { timeout: 15000 });
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function estadoTexto(codigo) {
  const estados = {
    "5":  "Publicada",
    "6":  "Cerrada",
    "7":  "Desierta",
    "8":  "Adjudicada",
    "9":  "Revocada",
    "10": "Suspendida",
    "15": "Publicada",
    "18": "Adjudicada"
  };
  return estados[String(codigo)] || `Estado ${codigo}`;
}

function formatFecha(str) {
  if (!str) return "–";
  // La API retorna fechas como "/Date(1234567890000)/"
  const match = String(str).match(/\/Date\((\d+)\)\//);
  if (match) {
    return new Date(Number(match[1])).toLocaleDateString("es-CL");
  }
  return str.substring(0, 10);
}

app.listen(PORT, () => {
  console.log(`Backend licitaciones corriendo en puerto ${PORT}`);
});

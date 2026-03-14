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

// Regiones desde Maule al sur (códigos oficiales Mercado Público)
const REGIONES_SUR = {
  "7":  "Región del Maule",
  "16": "Región de Ñuble",
  "8":  "Región del Biobío",
  "9":  "Región de La Araucanía",
  "14": "Región de Los Ríos",
  "10": "Región de Los Lagos",
  "11": "Región de Aysén",
  "12": "Región de Magallanes",
  "todas": "Todas las regiones"
};

// ── Salud ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Regiones disponibles ──────────────────────────────────────────────────────
app.get("/regiones", (req, res) => {
  res.json(REGIONES_SUR);
});

// ── Búsqueda Mercado Público ───────────────────────────────────────────────────
app.get("/buscar", async (req, res) => {
  const keyword = (req.query.q || "").toLowerCase().trim();
  const regionFiltro = req.query.region || "todas";

  if (!keyword) return res.status(400).json({ error: "Parámetro q requerido" });

  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const mpRes = await fetch(url, { timeout: 20000 });
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    const licitaciones = data.Listado || [];

    const terms = keyword.split(/\s+/);

    const filtradas = licitaciones.filter(l => {
      // Filtro keyword
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      const matchKeyword = terms.every(t => texto.includes(t));
      if (!matchKeyword) return false;

      // Filtro región
      if (regionFiltro === "todas") return true;
      const codigoRegion = String(l.CodigoRegion || "");
      return codigoRegion === regionFiltro;
    });

    const resultado = filtradas.map(l => ({
      titulo:           l.Nombre || "Sin título",
      codigo:           l.CodigoExterno || "",
      organismo:        l.Nombre_org_unidad_compradora || l.NombreOrganismo || "–",
      region:           REGIONES_SUR[String(l.CodigoRegion)] || regionNombre(l.CodigoRegion),
      codigoRegion:     String(l.CodigoRegion || ""),
      estado:           estadoTexto(l.CodigoEstado),
      fechaPublicacion: formatFecha(l.FechaPublicacion),
      fechaCierre:      formatFecha(l.FechaCierre),
      monto:            l.MontoEstimado ? `$${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
      descripcion:      l.Descripcion || "",
      url:              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
      fuente:           "Mercado Público"
    }));

    res.json({ total: resultado.length, keyword, region: regionFiltro, resultados: resultado });

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

function regionNombre(codigo) {
  const m = {
    "1":"Tarapacá","2":"Antofagasta","3":"Atacama","4":"Coquimbo",
    "5":"Valparaíso","6":"O'Higgins","7":"Maule","8":"Biobío",
    "9":"Araucanía","10":"Los Lagos","11":"Aysén","12":"Magallanes",
    "13":"Metropolitana","14":"Los Ríos","15":"Arica y Parinacota","16":"Ñuble"
  };
  return m[String(codigo)] || `Región ${codigo}`;
}

function formatFecha(str) {
  if (!str) return "–";
  const match = String(str).match(/\/Date\((\d+)\)\//);
  if (match) return new Date(Number(match[1])).toLocaleDateString("es-CL");
  return String(str).substring(0, 10);
}

app.listen(PORT, () => console.log(`Backend licitaciones corriendo en puerto ${PORT}`));

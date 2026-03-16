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
  { codigo: "15", nombre: "Región de Arica y Parinacota" },
  { codigo: "1",  nombre: "Región de Tarapacá" },
  { codigo: "2",  nombre: "Región de Antofagasta" },
  { codigo: "3",  nombre: "Región de Atacama" },
  { codigo: "4",  nombre: "Región de Coquimbo" },
  { codigo: "5",  nombre: "Región de Valparaíso" },
  { codigo: "13", nombre: "Región Metropolitana" },
  { codigo: "6",  nombre: "Región de O'Higgins" },
  { codigo: "7",  nombre: "Región del Maule" },
  { codigo: "16", nombre: "Región de Ñuble" },
  { codigo: "8",  nombre: "Región del Biobío" },
  { codigo: "9",  nombre: "Región de La Araucanía" },
  { codigo: "14", nombre: "Región de Los Ríos" },
  { codigo: "10", nombre: "Región de Los Lagos" },
  { codigo: "11", nombre: "Región de Aysén" },
  { codigo: "12", nombre: "Región de Magallanes" }
];

const REGION_MAP = {};
REGIONES.forEach(r => REGION_MAP[r.codigo] = r.nombre);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/regiones", (req, res) => {
  res.json(REGIONES);
});

app.get("/buscar", async (req, res) => {
  const keyword    = (req.query.q     || "").toLowerCase().trim();
  const desdeParam = req.query.desde  || "todas";
  const hastaParam = req.query.hasta  || "todas";

  if (!keyword) return res.status(400).json({ error: "Parámetro q requerido" });

  let codigosValidos = null;
  if (desdeParam !== "todas" || hastaParam !== "todas") {
    const idxDesde = desdeParam === "todas" ? 0 : REGIONES.findIndex(r => r.codigo === desdeParam);
    const idxHasta = hastaParam === "todas" ? REGIONES.length - 1 : REGIONES.findIndex(r => r.codigo === hastaParam);
    const start = Math.min(idxDesde < 0 ? 0 : idxDesde, idxHasta < 0 ? REGIONES.length - 1 : idxHasta);
    const end   = Math.max(idxDesde < 0 ? 0 : idxDesde, idxHasta < 0 ? REGIONES.length - 1 : idxHasta);
    codigosValidos = new Set(REGIONES.slice(start, end + 1).map(r => r.codigo));
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const mpRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    const licitaciones = data.Listado || [];
    const terms = keyword.split(/\s+/);

    const filtradas = licitaciones.filter(l => {
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      if (!terms.every(t => texto.includes(t))) return false;
      if (!codigosValidos) return true;
      return codigosValidos.has(String(l.CodigoRegion || ""));
    });

    const resultado = filtradas.map(l => ({
      titulo:           l.Nombre || "Sin título",
      codigo:           l.CodigoExterno || "",
      organismo:        l.Nombre_org_unidad_compradora || l.NombreOrganismo || "–",
      region:           REGION_MAP[String(l.CodigoRegion)] || null,
      codigoRegion:     String(l.CodigoRegion || ""),
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

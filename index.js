const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 8080;
const TICKET = process.env.MP_TICKET || "F8537A18-6766-4DEF-9E59-426B4FEE2844";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

app.use(cors({ origin: "*" }));
app.options("*", cors());
app.use(express.json());
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

// ── Salud ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", mensaje: "Backend Licitaciones activo" });
});

// ── Búsqueda Mercado Público ───────────────────────────────────────────────────
app.get("/buscar", async (req, res) => {
  const keyword = (req.query.q || "").toLowerCase().trim();
  if (!keyword) return res.status(400).json({ error: "Parámetro q requerido" });
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const mpRes = await fetch(url, { timeout: 20000 });
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    const licitaciones = data.Listado || [];
    const terms = keyword.split(/\s+/);
    const filtradas = licitaciones.filter(l => {
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      return terms.every(t => texto.includes(t));
    });
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

// ── Proxy Anthropic (para Diario Oficial y análisis IA) ───────────────────────
app.post("/claude", async (req, res) => {
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

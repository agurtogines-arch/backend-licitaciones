const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 8080;
const TICKET = process.env.MP_TICKET || "1FC8A3E9-5D72-495C-8340-83E5B1749B79";

app.use(cors({ origin: "*" }));
app.options("*", cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const REGIONES = [
  { codigo:"15", nombre:"Región de Arica y Parinacota", oficial:"arica" },
  { codigo:"1",  nombre:"Región de Tarapacá",           oficial:"tarapacá" },
  { codigo:"2",  nombre:"Región de Antofagasta",         oficial:"antofagasta" },
  { codigo:"3",  nombre:"Región de Atacama",             oficial:"atacama" },
  { codigo:"4",  nombre:"Región de Coquimbo",            oficial:"coquimbo" },
  { codigo:"5",  nombre:"Región de Valparaíso",          oficial:"valparaíso" },
  { codigo:"13", nombre:"Región Metropolitana",          oficial:"metropolitana" },
  { codigo:"6",  nombre:"Región de O'Higgins",           oficial:"o'higgins" },
  { codigo:"7",  nombre:"Región del Maule",              oficial:"maule" },
  { codigo:"16", nombre:"Región de Ñuble",               oficial:"ñuble" },
  { codigo:"8",  nombre:"Región del Biobío",             oficial:"biobío" },
  { codigo:"9",  nombre:"Región de La Araucanía",        oficial:"araucanía" },
  { codigo:"14", nombre:"Región de Los Ríos",            oficial:"los ríos" },
  { codigo:"10", nombre:"Región de Los Lagos",           oficial:"los lagos" },
  { codigo:"11", nombre:"Región de Aysén",               oficial:"aysén" },
  { codigo:"12", nombre:"Región de Magallanes",          oficial:"magallanes" }
];

function extraerRegionDeTexto(texto) {
  if (!texto) return null;
  const t = texto.toLowerCase();
  for (const r of REGIONES) {
    if (t.includes(r.oficial)) return r;
  }
  return null;
}

function estadoTexto(codigo) {
  const m = { "5":"Publicada","6":"Cerrada","7":"Desierta","8":"Adjudicada",
              "9":"Revocada","10":"Suspendida","15":"Publicada","18":"Adjudicada" };
  return m[String(codigo)] || "Publicada";
}

function formatFecha(str) {
  if (!str) return "–";
  const match = String(str).match(/\/Date\((\d+)\)\//);
  if (match) return new Date(Number(match[1])).toLocaleDateString("es-CL");
  return String(str).substring(0, 10);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/regiones", (req, res) => res.json(REGIONES));

// ── Búsqueda Mercado Público ──────────────────────────────────────────────────
app.get("/buscar", async (req, res) => {
  const keyword    = (req.query.q || "").trim();
  const desdeParam = req.query.desde || "todas";
  const hastaParam = req.query.hasta || "todas";

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
    const primerTerm = keyword.split(/\s+/).filter(Boolean)[0] || keyword;
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90000);

    const fetchMP = async (extraParams) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}nombre=${encodeURIComponent(primerTerm)}&ticket=${TICKET}${extraParams}`;
      try {
        const mpRes = await fetch(mpUrl, { signal: controller.signal });
        const rawText = await mpRes.text();
        if (!mpRes.ok) return [];
        const data = JSON.parse(rawText);
        return data.Listado || [];
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return [];
      }
    };

    const [sinTipo, conSC, porDescripcion] = await Promise.all([
      fetchMP(""),
      fetchMP("&tipo=SC"),
      fetchMP(`&descripcion=${encodeURIComponent(primerTerm)}`).catch(() => [])
    ]);
    clearTimeout(timeoutId);

    // Fusionar y deduplicar
    const vistos = new Set();
    const licitaciones = [];
    for (const l of [...sinTipo, ...conSC, ...porDescripcion]) {
      const cod = l.CodigoExterno || JSON.stringify(l);
      if (!vistos.has(cod)) { vistos.add(cod); licitaciones.push(l); }
    }

    // Filtrar: truncar términos largos para manejar variaciones de género/número en español
    const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const filtradas = licitaciones.filter(l => {
      const texto = `${l.Nombre || ""} ${l.Descripcion || ""}`.toLowerCase();
      return terms.every(t => {
        // Para términos de 6+ letras, truncar las últimas 2 para cubrir variaciones
        // hidráulico → hidráuli, hidráulica ✓, hidráulicos ✓
        const stem = t.length >= 6 ? t.slice(0, -2) : t;
        return texto.includes(stem);
      });
    });

    // Mapear resultados
    let resultado = filtradas.map(l => {
      const textoCompleto  = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const regionExtraida = extraerRegionDeTexto(textoCompleto);
      return {
        titulo:           l.Nombre || "Sin título",
        codigo:           l.CodigoExterno || "",
        organismo:        "–",
        region:           regionExtraida?.nombre || null,
        codigoRegion:     regionExtraida?.codigo || null,
        estado:           estadoTexto(l.CodigoEstado),
        fechaPublicacion: formatFecha(l.FechaPublicacion),
        fechaCierre:      formatFecha(l.FechaCierre),
        monto:            null,
        descripcion:      "",
        url:              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
        fuente:           "Mercado Público"
      };
    });

    // Filtrar por rango de regiones — incluir también las que no tienen región identificada
    if (codigosValidos) {
      resultado = resultado.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
    }

    res.json({ total: resultado.length, resultados: resultado });

  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "Tiempo de espera agotado" });
    console.error("[buscar] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Detalle individual ────────────────────────────────────────────────────────
app.get("/detalle/:codigo", async (req, res) => {
  const codigo = req.params.codigo;
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 30000);
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
    const mpRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!mpRes.ok) throw new Error(`API MP respondió ${mpRes.status}`);
    const data = await mpRes.json();
    const l = data.Listado?.[0];
    if (!l) return res.status(404).json({ error: "No encontrada" });
    const regionTexto    = l.Comprador?.RegionUnidad || "";
    const regionExtraida = extraerRegionDeTexto(regionTexto) ||
                           extraerRegionDeTexto(`${l.Nombre || ""} ${l.Descripcion || ""}`);
    res.json({
      organismo:     l.Comprador?.NombreOrganismo || "–",
      region:        regionTexto || regionExtraida?.nombre || null,
      regionOficial: regionExtraida?.oficial || null,
      monto:         l.MontoEstimado ? `$${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
      descripcion:   l.Descripcion || ""
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy Claude ──────────────────────────────────────────────────────────────
app.post("/claude", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":ANTHROPIC_KEY },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Diario Oficial — Búsqueda ─────────────────────────────────────────────────
app.post("/diario-oficial/buscar", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });
  const { keyword, regiones, hayFiltro } = req.body;
  if (!keyword) return res.status(400).json({ error: "keyword requerido" });
  const regionQuery = hayFiltro && regiones?.length ? ` (${regiones.slice(0,3).join(" OR ")})` : "";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":ANTHROPIC_KEY },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 3000,
        system: `Eres un agente experto en buscar licitaciones en el Diario Oficial de Chile.
Responde ÚNICAMENTE con un array JSON válido. Sin texto, sin markdown, sin explicaciones.
Schema: {"titulo":"","organismo":"","estado":"Publicada","fechaPublicacion":"","fechaCierre":"","monto":null,"descripcion":"","url":"","region":""}`,
        messages: [{ role:"user", content:`Busca licitaciones en el Diario Oficial de Chile relacionadas con: "${keyword}"${hayFiltro?` en las regiones: ${regiones?.join(", ")}`:""}.\n1. site:diariooficial.interior.gob.cl licitacion "${keyword}"${regionQuery}\n2. diario oficial chile licitacion "${keyword}"${regionQuery} 2025 2026\nDevuelve array JSON.` }],
        tools: [{ type:"web_search_20250305", name:"web_search" }]
      })
    });
    const data = await response.json();
    const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
    try {
      const clean = text.replace(/```json|```/g,"").trim();
      const match = clean.match(/\[[\s\S]*\]/);
      res.json({ resultados: match ? JSON.parse(match[0]) : [] });
    } catch { res.json({ resultados:[] }); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Diario Oficial — Análisis IA ──────────────────────────────────────────────
app.post("/diario-oficial/analizar", async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json","anthropic-version":"2023-06-01","x-api-key":ANTHROPIC_KEY },
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:1500,
        system:`Eres experto en licitaciones públicas chilenas para LEN Ingeniería, consultora multidisciplinaria. NO ejecuta obras físicas directamente, pero SÍ realiza ITO.`,
        messages:[{ role:"user", content:`Analiza esta licitación:\nTítulo: ${item.titulo}\nOrganismo: ${item.organismo}\nRegión: ${item.region||"No especificada"}\nCierre: ${item.fechaCierre}\nURL: ${item.url||""}\n\n1. Objeto\n2. Relevancia Alta/Media/Baja\n3. Modalidad de participación\n4. Recomendación` }],
        tools:[{ type:"web_search_20250305", name:"web_search" }]
      })
    });
    const data = await response.json();
    const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
    res.json({ analysis: text||"No se pudo obtener el análisis." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mercado Público — Análisis IA (OpenAI) ───────────────────────────────────
app.post("/mp/analizar", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada en Render" });

  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `Eres experto en licitaciones públicas chilenas para LEN Ingeniería (LEN & Asociados Ingenieros Consultores Ltda.), empresa consultora multidisciplinaria fundada en 1974, con más de 250 colaboradores.
Divisiones de LEN: Infraestructura de Transporte, Inspección Técnica de Obra (ITO), Obras Hidráulicas y Riego, Proyectos Civiles, Medio Ambiente y Territorio, Energía, Minería, Ingeniería Zona Sur.
LEN NO ejecuta obras físicas directamente, pero SÍ realiza ITO (presencia en terreno).
LEN tiene experiencia como subcontratista de concesionarias viales en proyectos MOP de gran escala.`
          },
          {
            role: "user",
            content: `Analiza esta licitación de Mercado Público para LEN Ingeniería:

Título: ${item.titulo}
Código: ${item.codigo || "N/A"}
Organismo: ${item.organismo || "N/A"}
Región: ${item.region || "No especificada"}
Estado: ${item.estado || "N/A"}
Publicación: ${item.fechaPublicacion || "N/A"}
Cierre: ${item.fechaCierre || "N/A"}
Monto: ${item.monto || "No especificado"}
URL: ${item.url || ""}

Entrega el análisis en este formato:

**1. Objeto** (2-3 líneas describiendo qué se requiere)
**2. División LEN más relevante**
**3. Relevancia para LEN**: Alta / Media / Baja — explica por qué en 1-2 líneas
**4. Modalidad de participación** — ¿directa o como subcontratista? Analiza objetivamente
**5. Plazos clave** (fechas importantes del proceso)
**6. Recomendación final**: Participar / Evaluar / Descartar — con justificación breve`
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `OpenAI respondió ${response.status}: ${err.substring(0, 200)}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "No se pudo obtener el análisis.";
    res.json({ analysis: text });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Backend licitaciones en puerto ${PORT} | Ticket: ${TICKET.substring(0,8)}...`));
app.post("/mp/analizar", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada en Render" });

  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `Eres un analista experto en licitaciones públicas chilenas para una consultora de ingeniería civil vial.
La empresa se especializa en: estudios viales, diseño geométrico, seguridad vial, hidráulica, hidrología, puentes, APR y prefactibilidad de rutas. NO es constructora.
Analiza la licitación y responde en español con:
1. Relevancia: Alta / Media / Baja (y por qué en 1 línea)
2. Tipo de servicio requerido
3. Coincidencia con el perfil de la empresa
4. Recomendación: Participar / Evaluar / Descartar
Sé conciso. Máximo 200 palabras.`
          },
          {
            role: "user",
            content: `Analiza esta licitación de Mercado Público Chile:

Título: ${item.titulo}
Código: ${item.codigo || "N/A"}
Organismo: ${item.organismo || "N/A"}
Región: ${item.region || "No especificada"}
Estado: ${item.estado || "N/A"}
Publicación: ${item.fechaPublicacion || "N/A"}
Cierre: ${item.fechaCierre || "N/A"}
URL: ${item.url || ""}

Accede a la URL si está disponible para obtener más detalles.`
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: `OpenAI respondió ${response.status}: ${err.substring(0, 200)}` });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "No se pudo obtener el análisis.";
    res.json({ analysis: text });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

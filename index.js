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
  const keywordsParam  = (req.query.keywords || "").trim();
  const serviciosParam = (req.query.servicios || "").trim();
  const legacyQ        = (req.query.q || "").trim(); // compatibilidad n8n
  const desdeParam     = req.query.desde || "todas";
  const hastaParam     = req.query.hasta || "todas";

  if (!keywordsParam && !legacyQ) {
    return res.status(400).json({ error: "Parámetro keywords requerido" });
  }

  const keywords  = keywordsParam
    ? keywordsParam.split(",").map(k => k.trim()).filter(Boolean)
    : [legacyQ];
  const servicios = serviciosParam
    ? serviciosParam.split(",").map(k => k.trim()).filter(Boolean)
    : [];

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
    const timeoutId  = setTimeout(() => controller.abort(), 90000);

    // UNA SOLA llamada al API — todas las licitaciones activas
    const fetchAll = async (extraParams) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
      try {
        const mpRes = await fetch(mpUrl, { signal: controller.signal });
        if (!mpRes.ok) return [];
        const data = await mpRes.json();
        return data.Listado || [];
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return [];
      }
    };

    const [sinTipo, conSC] = await Promise.all([
      fetchAll(""),
      fetchAll("&tipo=SC")
    ]);
    clearTimeout(timeoutId);

    // Fusionar y deduplicar
    const vistos = new Set();
    const licitaciones = [];
    for (const l of [...sinTipo, ...conSC]) {
      const cod = l.CodigoExterno || JSON.stringify(l);
      if (!vistos.has(cod)) { vistos.add(cod); licitaciones.push(l); }
    }

    // ── Normalización ──────────────────────────────────────────────────────
    const norm = s => (s || "").toLowerCase()
      .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
      .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
      .replace(/['''`´]/g, "").trim();

    // Stemming: cortar últimas 2 letras para palabras de 6+ chars
    // hidráulica → hidraul | cauces → cauc | modificación → modificaci
    const stem = t => t.length >= 6 ? t.slice(0, -2) : t;

    // ¿El título contiene TODOS los términos de una keyword?
    const matchesKeyword = (titulo, keyword) => {
      const tNorm = norm(titulo);
      const terms = norm(keyword)
        .split(/\s+/)
        .filter(t => t.length >= 3); // ignorar "de", "y", "el", etc.
      if (!terms.length) return false;
      return terms.every(t => tNorm.includes(stem(t)));
    };

    // ── Filtro principal sobre título completo ─────────────────────────────
    // Condición: AL MENOS UNA keyword técnica
    //            Y AL MENOS UN tipo de servicio (si hay activos)
    const filtradas = licitaciones.filter(l => {
      const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const matchesTecnica = keywords.some(kw => matchesKeyword(titulo, kw));
      if (!matchesTecnica) return false;
      if (servicios.length === 0) return true;
      return servicios.some(s => matchesKeyword(titulo, s));
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

    // Filtrar por rango de regiones sobre lo identificado en el título
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

// ── Detalle en lote ───────────────────────────────────────────────────────────
app.post("/detalle-lote", async (req, res) => {
  const { codigos } = req.body;
  if (!codigos || !Array.isArray(codigos)) return res.status(400).json({ error: "codigos requerido" });

  const resultados = {};
  const BATCH = 5;

  for (let i = 0; i < codigos.length; i += BATCH) {
    const lote = codigos.slice(i, i + BATCH);
    await Promise.all(lote.map(async codigo => {
      try {
        const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) return;
        const data = await r.json();
        const l = data.Listado?.[0];
        if (!l) return;
        const regionTexto = l.Comprador?.RegionUnidad || "";
        const regionExtraida = extraerRegionDeTexto(regionTexto) ||
                               extraerRegionDeTexto(`${l.Nombre||""} ${l.Descripcion||""}`);
        resultados[codigo] = {
          organismo:  l.Comprador?.NombreOrganismo || null,
          region:     regionTexto || regionExtraida?.nombre || null,
          monto:      l.MontoEstimado ? `${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
          descripcion: l.Descripcion || null
        };
      } catch(e) {}
    }));
  }

  res.json({ resultados });
});

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

// ── Helpers para extraer texto limpio del HTML de MP ─────────────────────────
function extraerTextoMP(html) {
  // Eliminar scripts, styles y comentarios
  let texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")         // quitar tags HTML
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")          // colapsar espacios múltiples
    .trim();

  // Recortar a 6000 caracteres para no exceder contexto de GPT-4o
  return texto.length > 6000 ? texto.substring(0, 6000) + "..." : texto;
}

// ── Mercado Público — Análisis IA (OpenAI) ───────────────────────────────────
app.post("/mp/analizar", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada en Render" });

  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  // ── Paso 1: Fetch de la página de MP para obtener contenido completo ────────
  let contenidoMP = "";
  if (item.url) {
    try {
      const mpPage = await fetch(item.url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LENBot/1.0)" }
      });
      if (mpPage.ok) {
        const html = await mpPage.text();
        contenidoMP = extraerTextoMP(html);
      }
    } catch (e) {
      console.warn("[mp/analizar] No se pudo obtener página MP:", e.message);
    }
  }

  const contenidoExtra = contenidoMP
    ? `\n\nCONTENIDO COMPLETO DE LA PÁGINA DE MERCADO PÚBLICO:\n${contenidoMP}`
    : "\n\n(No se pudo obtener el contenido de la página de Mercado Público. Analiza solo con los metadatos disponibles.)";

  // ── Paso 2: Análisis con GPT-4o ─────────────────────────────────────────────
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `Eres un experto en análisis de licitaciones públicas chilenas para LEN Ingeniería (LEN & Asociados Ingenieros Consultores Ltda.), consultora de ingeniería multidisciplinaria fundada en 1974, con más de 250 colaboradores y presencia en todo Chile.

PERFIL DE LA EMPRESA:
- Es consultora, NO constructora. Realiza estudios, diseños, inspecciones técnicas (ITO) y asesorías de ingeniería.
- Divisiones: Infraestructura de Transporte, ITO (opera desde Santiago), Obras Hidráulicas y Riego, Proyectos Civiles, Medio Ambiente y Territorio, Energía, Minería (en etapa de entrada), Ingeniería Zona Sur.
- Zona de operación principal: Maule → Magallanes. Oficina central en Santiago, oficina Zona Sur en Concepción.
- Experiencia en proyectos de gran escala (ej. Costanera Chiguayante, Concepción).
- Clientes principales: MOP Vialidad, DOH, GORE, Municipios zona sur, SERVIU, concesionarias viales.
- LEN está entrando en minería solo en: diseño de calles, saneamiento, hidráulica, hidrología y seguridad vial en contextos mineros.

CRITERIOS DE EVALUACIÓN — aplica esta puntuación internamente antes de emitir el análisis:

1. ALINEACIÓN TÉCNICA (0-2 pts)
   2 pts → especialidad core Zona Sur: hidráulica, hidrología, vial, APR, diseño geométrico, seguridad vial, puentes, saneamiento, drenaje, aguas lluvias, cauces, cuencas, inundaciones
   1 pt  → especialidad secundaria: medio ambiente, topografía, proyectos civiles generales, minería (solo en diseño de calles, saneamiento, hidráulica, hidrología o seguridad vial en faenas)
   0 pts → fuera del perfil: construcción de obras, ITO en terreno, minería especializada (explosivos, extracción, procesamiento), tecnología, salud, educación

2. ORGANISMO MANDANTE (0-2 pts)
   2 pts → MOP, DOH, GORE, SERVIU, Municipios zona sur (Maule a Magallanes)
   1 pt  → Ministerios, organismos públicos RM o zona centro
   0 pts → Privados, organismos zona norte, rubros ajenos a infraestructura

3. MONTO ESTIMADO (0-2 pts)
   2 pts → sobre $100.000.000 CLP
   1 pt  → entre $20.000.000 y $100.000.000 CLP
   0 pts → bajo $20.000.000 CLP o no especificado

4. REGIÓN (0-2 pts)
   2 pts → Maule, Ñuble, Biobío, Araucanía, Los Ríos, Los Lagos, Aysén, Magallanes
   1 pt  → Metropolitana, Valparaíso, O'Higgins
   0 pts → Arica, Tarapacá, Antofagasta, Atacama, Coquimbo

5. VIABILIDAD DE PARTICIPACIÓN (0-2 pts)
   2 pts → LEN puede participar directamente como consultor principal
   1 pt  → Requiere evaluar requisitos específicos de experiencia o asociación
   0 pts → Requiere capacidades fuera del perfil de LEN

VEREDICTO FINAL según puntaje total:
   8-10 pts → 🟢 PARTICIPAR
   5-7  pts → 🟡 EVALUAR
   0-4  pts → 🔴 DESCARTAR

INSTRUCCIÓN IMPORTANTE: Si tienes el contenido completo de la página de MP, úsalo para extraer requisitos reales, experiencia exigida, criterios de evaluación y plazos de ejecución. Prioriza esa información sobre los metadatos básicos.`
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
URL: ${item.url || ""}${contenidoExtra}

Entrega el análisis con este formato exacto:

📋 OBJETO
Describe en 2-3 líneas qué se requiere y cuál es el alcance del servicio.

🏢 DIVISIÓN LEN
Indica qué división de LEN es la más adecuada para ejecutar este contrato.

📅 FECHAS CLAVE
Fecha publicación:         DD-MM-AAAA
Cierre recepción ofertas:  DD-MM-AAAA
Fecha final de preguntas:  DD-MM-AAAA
Apertura técnica:          DD-MM-AAAA
Apertura económica:        DD-MM-AAAA
Adjudicación estimada:     DD-MM-AAAA
Duración del contrato:     X meses (si está disponible)
Si alguna fecha no está disponible en la información, omitirla.

📊 EVALUACIÓN DE FACTIBILIDAD
Criterio                  | Puntaje | Fundamento
--------------------------|---------|------------------
Alineación técnica        |  X/2    | ...
Organismo mandante        |  X/2    | ...
Monto estimado            |  X/2    | ...
Región                    |  X/2    | ...
Viabilidad participación  |  X/2    | ...
TOTAL                     |  X/10   |

🎯 VEREDICTO
[🟢 PARTICIPAR / 🟡 EVALUAR / 🔴 DESCARTAR]
Justificación en 2-3 líneas explicando la decisión.

⚠️ ALERTAS
Lista de 1-3 aspectos críticos a verificar antes de decidir (requisitos, plazos, experiencia acreditada, etc.).
Si no hay alertas relevantes, indica "Sin alertas críticas".`
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

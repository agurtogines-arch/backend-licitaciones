const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");
const multer  = require("multer");
const AdmZip  = require("adm-zip");

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

// ── Clasificador de divisiones LEN ────────────────────────────────────────
const DIVISIONES_LEN = [
  {
    id: "zonasur", label: "Zona Sur", icon: "🌊", color: "#0369a1",
    keywords: ["vial","seguridad vial","puentes","caminos","transito","pavimento","diseño geometrico","prefactibilidad vial","factibilidad vial","prefactibilidad hidraulica","factibilidad hidraulica","hidraulica","hidrologia","aguas lluvias","cauces","apr","saneamiento","alcantarillado","planta de tratamiento","planta elevadora","conducciones","inundaciones","drenaje","cuencas"],
    servicios: ["estudio","consultoria","asesoria","diseno","inspeccion","levantamiento"],
    regiones: ["7","16","8","9","14","10","11","12"] // Maule → Magallanes
  },
  {
    id: "infra", label: "Infraestructura", icon: "🛣️", color: "#7c3aed",
    keywords: ["ingenieria de detalle","ingenieria basica","estudio de factibilidad","anteproyecto","preinversion","iluminacion vial","conservacion vial","infraestructura vial","ingenieria vial","transporte vial","proteccion costera","obras portuarias","infraestructura portuaria","obras maritimas"],
    servicios: ["estudio","consultoria","diseno","prefactibilidad","factibilidad","asesoria","anteproyecto","inspeccion"]
  },
  {
    id: "medioambiente", label: "Medio Ambiente", icon: "🌿", color: "#15803d",
    keywords: ["ambiental","seia","impacto ambiental","pertinencia ambiental","linea de base","monitoreo ambiental","seguimiento ambiental","declaracion de impacto"],
    servicios: ["estudio","consultoria","monitoreo","asesoria","levantamiento"]
  },
  {
    id: "energia", label: "Energía", icon: "⚡", color: "#b45309",
    keywords: ["fotovoltaico","eolico","solar","ernc","bess","eficiencia energetica","hidrogeno verde","electromovilidad","energia renovable","descarbonizacion","autogeneracion","energetico"],
    servicios: ["estudio","consultoria","diseno","asesoria","diagnostico","prefactibilidad","factibilidad","ingenieria"]
  },
  {
    id: "ito", label: "Inspección Técnica", icon: "🔍", color: "#dc2626",
    keywords: ["ito","inspeccion tecnica","supervision de obras","contraparte tecnica","fiscalizacion de obras","control de obras","auditoria tecnica de obras","geomensura","supervision tecnica","acompanamiento a la construccion","inspeccion fiscal","asistencia tecnica en obra","inspeccion de obras"],
    servicios: []
  },
  {
    id: "civil", label: "Proyectos Civiles", icon: "🏗️", color: "#475569",
    keywords: ["paralelismo","atraviesos","movimiento de tierras","pavimentacion","permisos dga","hidrogeologia","obras tempranas","ingenieria estructural","obras civiles","urbanizacion"],
    servicios: ["estudio","diseno","consultoria","ingenieria civil","asesoria"]
  },
  {
    id: "mineria", label: "Minería", icon: "⛏️", color: "#92400e",
    keywords: ["mineria","minera","minero","mina","expropiaciones","descarbonizacion","hoja de ruta","faena"],
    servicios: ["estudio","consultoria","ingenieria","asesoria","diseno"]
  }
];

const CODIGOS_ZONA_SUR = new Set(["7","16","8","9","14","10","11","12"]);

function normDiv(s) {
  return (s||"").toLowerCase()
    .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
    .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
    .replace(/['''`´]/g,"").trim();
}

function stemDiv(t) { return t.length >= 6 ? t.slice(0,-2) : t; }

function matchDivKw(titulo, kw) {
  const tNorm = normDiv(titulo);
  const kwNorm = normDiv(kw);
  // Para keywords cortas (≤4 chars) verificar que sea palabra completa
  if (kwNorm.length <= 4) {
    return new RegExp(`(?<![a-z])${kwNorm}(?![a-z])`).test(tNorm);
  }
  return kwNorm.split(/\s+/).filter(t=>t.length>=3).every(t=>tNorm.includes(stemDiv(t)));
}

function clasificarDivisiones(titulo, codigoRegion) {
  const divisiones = [];
  for (const div of DIVISIONES_LEN) {
    const matchTec = div.keywords.some(kw => matchDivKw(titulo, kw));
    if (!matchTec) continue;
    // Para Zona Sur verificar región si está disponible
    if (div.id === "zonasur" && codigoRegion && !CODIGOS_ZONA_SUR.has(codigoRegion)) continue;
    divisiones.push({ id: div.id, label: div.label, icon: div.icon, color: div.color });
  }
  return divisiones;
}

// ── Registro Consultores MOP de LEN (Cert. N° 264614) ─────────────────────
// Rank: 1 = Primera Superior, 2 = Primera, 3 = Segunda, 4 = Tercera
// Una licitación que pide "2da" la cumple quien tenga rank ≤ 3.
const LEN_REGISTRO_MOP = {
  certificado: "264614",
  rut: "83.665.200-2",
  vigente_hasta: "2026-05-23",
  especialidades: {
    "1.1":  3, "1.2":  4, "1.3":  1, "2.2":  1, "3.1":  1,
    "3.2":  2, "3.3":  1, "3.6":  1, "3.7":  1, "4.1":  1,
    "4.2":  4, "4.3":  1, "4.4":  3, "4.5":  1, "4.6":  3,
    "4.7":  4, "4.9":  1, "4.10": 1, "7.1":  1, "7.4":  4,
    "7.8":  2, "8.3":  2, "8.5":  3, "8.6":  4, "9.1":  1
  }
};

const RANK_CATEGORIA = {
  "primera superior": 1, "1ra superior": 1, "1° superior": 1, "1 superior": 1,
  "primera":          2, "1ra":          2, "1°":          2, "1":           2,
  "segunda":          3, "2da":          3, "2°":          3, "2":           3,
  "tercera":          4, "3ra":          4, "3°":          4, "3":           4
};

const NOMBRE_CATEGORIA = ["", "1ra Superior", "1ra", "2da", "3ra"];

function validarRegistroMOP(requisitos) {
  const hoy = new Date();
  const vence = new Date(LEN_REGISTRO_MOP.vigente_hasta);
  const dias = Math.ceil((vence - hoy) / 86400000);

  if (dias < 0) {
    return { califica: false, fallas: ["⛔ Registro MOP vencido"], diasVigencia: dias, avisoVigencia: "⛔ Registro vencido — renovar urgente" };
  }

  const fallas = [];
  for (const req of (requisitos || [])) {
    const rankLEN = LEN_REGISTRO_MOP.especialidades[req.codigo];
    const rankReq = RANK_CATEGORIA[(req.categoria || "").toLowerCase().trim()];
    if (rankLEN === undefined) {
      fallas.push(`Falta especialidad ${req.codigo} (${req.descripcion || ""})`);
    } else if (rankReq && rankLEN > rankReq) {
      fallas.push(`${req.codigo}: requiere ${req.categoria}, LEN tiene ${NOMBRE_CATEGORIA[rankLEN]}`);
    }
  }

  return {
    califica: fallas.length === 0,
    fallas,
    diasVigencia: dias,
    avisoVigencia: dias < 30 ? `⚠️ Registro vence en ${dias} días` : null
  };
}

// Extrae los requisitos del recuadro "Especialidades y categorías" del HTML de MP
// Devuelve: [{ codigo: "4.8", descripcion: "Obras Sanitarias", categoria: "2da" }, ...]
//
// El HTML de mercadopublico.cl usa <table id="tblEspecialidades"> con estructura:
//   <tr><td>Ingeniería Civil</td><td>4.8 Obras Sanitarias.</td><td>2da</td></tr>
// Así que parseamos la tabla celda por celda en lugar de regex sobre texto plano.
function extraerEspecialidadesMOP(html) {
  if (!html) return [];

  // Localizar la tabla específica de especialidades MOP
  const tablaMatch = html.match(/<table[^>]*id\s*=\s*["']tblEspecialidades["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tablaMatch) return [];

  const tablaHTML = tablaMatch[1];

  // Si hay <tbody> usarlo, sino trabajar con todo el contenido de la tabla
  const tbodyMatch = tablaHTML.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const filasHTML = tbodyMatch ? tbodyMatch[1] : tablaHTML;

  // Extraer cada <tr>
  const filas = filasHTML.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  const cleanCell = s => s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();

  const requisitos = [];
  const seen = new Set();

  for (const filaHTML of filas) {
    // Skip filas del thead (header)
    if (/<th[\s>]/i.test(filaHTML)) continue;

    const celdas = filaHTML.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (celdas.length < 3) continue;

    const especialidad    = cleanCell(celdas[0]);  // "Ingeniería Civil"
    const subEspecialidad = cleanCell(celdas[1]);  // "4.8 Obras Sanitarias."
    const categoria       = cleanCell(celdas[2]);  // "2da"

    // Extraer código N.N y descripción de la sub-especialidad
    const m = subEspecialidad.match(/^(\d{1,2}\.\d{1,2})\s+(.+?)\.?\s*$/);
    if (!m) continue;

    const codigo = m[1];
    const descripcion = m[2].trim();

    if (seen.has(codigo)) continue;
    seen.add(codigo);

    requisitos.push({ codigo, descripcion, categoria, especialidad });
  }

  return requisitos;
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
  const desdeParam     = req.query.desde || "todas";
  const hastaParam     = req.query.hasta || "todas";

  if (!keywordsParam) {
    return res.status(400).json({ error: "Parámetro keywords requerido" });
  }

  const keywords  = keywordsParam.split(",").map(k => k.trim()).filter(Boolean);
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

    console.log(`[buscar] sinTipo=${sinTipo.length} conSC=${conSC.length}`);

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

    // ── Palabras de exclusión — licitaciones de obras/suministros ─────────────
    const EXCLUSION = [
      "construccion de ","construcción de ","ejecucion de obras","ejecución de obras",
      "suministro de materiales","suministro e instalacion","suministro e instalación",
      "obra de construccion","obra de construcción","licitacion de obras","licitación de obras",
      "contrato de obras","compra de ","adquisicion de ","adquisición de ",
      "arriendo de ","arriendo de maquinaria","provision de ","provisión de "
    ];
    // Palabras que salvan de la exclusión (son consultoría aunque digan "construcción")
    const SALVAVIDAS = [
      "inspeccion","inspección","supervision","supervisión","asesoria","asesoría",
      "estudio","consultoria","consultoría","contraparte","auditoria","auditoría",
      "diseño","proyecto de ingenieria","proyecto de ingeniería","ito"
    ];

    const esBloqueada = (titulo) => {
      const t = norm(titulo);
      const tieneExclusion = EXCLUSION.some(ex => t.includes(ex));
      if (!tieneExclusion) return false;
      // Si tiene palabra de exclusión pero también de consultoría → no bloquear
      return !SALVAVIDAS.some(sv => t.includes(sv));
    };

    // ── Filtro principal sobre título completo ─────────────────────────────
    // Condición: AL MENOS UNA keyword técnica
    //            Y AL MENOS UN tipo de servicio (si hay activos)
    //            Y NO es licitación de obra/suministro puro
    const filtradas = licitaciones.filter(l => {
      const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      if (esBloqueada(titulo)) return false;
      const matchesTecnica = keywords.some(kw => matchesKeyword(titulo, kw));
      if (!matchesTecnica) return false;
      if (servicios.length === 0) return true;
      return servicios.some(s => matchesKeyword(titulo, s));
    });

    console.log(`[buscar] licitaciones=${licitaciones.length} filtradas=${filtradas.length} keywords=${keywords} servicios=${servicios}`);
    let resultado = filtradas.map(l => {
      const textoCompleto  = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const regionExtraida = extraerRegionDeTexto(textoCompleto);
      const titulo         = l.Nombre || "Sin título";
      return {
        titulo,
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
        fuente:           "Mercado Público",
        divisiones:       clasificarDivisiones(titulo, regionExtraida?.codigo || null)
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

// ── Búsqueda General MP (una sola llamada, filtra por todas las divisiones) ───
app.post("/buscar-general", async (req, res) => {
  const divisiones = req.body.divisiones || []; // [{id, keywords, servicios, regionDesde, regionHasta}]
  if (!divisiones.length) return res.status(400).json({ error: "Divisiones requeridas" });

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90000);

    // UNA SOLA descarga de todas las licitaciones activas
    const fetchAll = async (extraParams) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
      try {
        const mpRes = await fetch(mpUrl, { signal: controller.signal });
        if (!mpRes.ok) return [];
        const data = await mpRes.json();
        return data.Listado || [];
      } catch(e) { if(e.name==="AbortError") throw e; return []; }
    };

    const [sinTipo, conSC] = await Promise.all([fetchAll(""), fetchAll("&tipo=SC")]);
    clearTimeout(timeoutId);

    // Deduplicar pool total
    const vistos = new Set();
    const pool   = [];
    for (const l of [...sinTipo, ...conSC]) {
      const cod = l.CodigoExterno || JSON.stringify(l);
      if (!vistos.has(cod)) { vistos.add(cod); pool.push(l); }
    }

    // Normalización y stemming
    const norm = s => (s || "").toLowerCase()
      .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
      .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
      .replace(/['''`´]/g,"").trim();
    const stem = t => t.length >= 6 ? t.slice(0,-2) : t;
    const matchKw = (titulo, kw) => {
      const tNorm = norm(titulo);
      const terms = norm(kw).split(/\s+/).filter(t => t.length >= 3);
      if (!terms.length) return false;
      return terms.every(t => tNorm.includes(stem(t)));
    };

    // ── Exclusión obras/suministros ───────────────────────────────────────
    const EXCLUSION = [
      "construccion de ","construcción de ","ejecucion de obras","ejecución de obras",
      "suministro de materiales","suministro e instalacion","suministro e instalación",
      "obra de construccion","obra de construcción","licitacion de obras","licitación de obras",
      "contrato de obras","compra de ","adquisicion de ","adquisición de ",
      "arriendo de ","provision de ","provisión de "
    ];
    const SALVAVIDAS = [
      "inspeccion","inspección","supervision","supervisión","asesoria","asesoría",
      "estudio","consultoria","consultoría","contraparte","auditoria","auditoría",
      "diseño","proyecto de ingenieria","proyecto de ingeniería","ito"
    ];
    const esBloqueada = (titulo) => {
      const t = norm(titulo);
      const tieneExclusion = EXCLUSION.some(ex => t.includes(ex));
      if (!tieneExclusion) return false;
      return !SALVAVIDAS.some(sv => t.includes(sv));
    };

    const mapItem = l => {
      const textoCompleto  = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const regionExtraida = extraerRegionDeTexto(textoCompleto);
      const titulo = l.Nombre || "Sin título";
      return {
        titulo,
        codigo:          l.CodigoExterno || "",
        organismo:       "–",
        region:          regionExtraida?.nombre || null,
        codigoRegion:    regionExtraida?.codigo || null,
        estado:          estadoTexto(l.CodigoEstado),
        fechaPublicacion: formatFecha(l.FechaPublicacion),
        fechaCierre:     formatFecha(l.FechaCierre),
        monto:           null,
        descripcion:     "",
        url:             `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
        fuente:          "Mercado Público",
        divisiones:      clasificarDivisiones(titulo, regionExtraida?.codigo || null)
      };
    };

    // Filtrar pool por cada división
    const resultados = {};
    for (const div of divisiones) {
      const { id, keywords, servicios, regionDesde, regionHasta } = div;
      if (!keywords?.length) { resultados[id] = []; continue; }

      // Filtro región
      let codigosValidos = null;
      if (regionDesde !== "todas" || regionHasta !== "todas") {
        const idxD = regionDesde === "todas" ? 0 : REGIONES.findIndex(r => r.codigo === regionDesde);
        const idxH = regionHasta === "todas" ? REGIONES.length-1 : REGIONES.findIndex(r => r.codigo === regionHasta);
        const s = Math.min(idxD<0?0:idxD, idxH<0?REGIONES.length-1:idxH);
        const e = Math.max(idxD<0?0:idxD, idxH<0?REGIONES.length-1:idxH);
        codigosValidos = new Set(REGIONES.slice(s,e+1).map(r => r.codigo));
      }

      // Filtro keywords + exclusión
      const filtradas = pool.filter(l => {
        const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
        if (esBloqueada(titulo)) return false;
        const matchTec = keywords.some(kw => matchKw(titulo, kw));
        if (!matchTec) return false;
        if (!servicios?.length) return true;
        return servicios.some(s => matchKw(titulo, s));
      });

      let mapped = filtradas.map(mapItem);
      if (codigosValidos) {
        mapped = mapped.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
      }

      // Deduplicar por título normalizado
      const seen = new Set();
      resultados[id] = mapped.filter(r => {
        const k = norm(r.titulo);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }

    res.json({ ok: true, resultados, total: pool.length });

  } catch(err) {
    if(err.name==="AbortError") return res.status(504).json({ error:"Tiempo de espera agotado" });
    res.status(500).json({ error: err.message });
  }
});


app.get("/buscar-organismo", async (req, res) => {
  const codigoOrganismo = (req.query.organismo || "").trim();
  const keywords        = (req.query.keywords || "").trim().split(",").map(k => k.trim()).filter(Boolean);
  const servicios       = (req.query.servicios || "").trim().split(",").map(k => k.trim()).filter(Boolean);
  const desdeParam      = req.query.desde || "todas";
  const hastaParam      = req.query.hasta || "todas";

  if (!codigoOrganismo) return res.status(400).json({ error: "Parámetro organismo requerido" });

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

    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                  `?estado=activas&codigoOrganismo=${codigoOrganismo}&ticket=${TICKET}`;

    const mpRes = await fetch(mpUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!mpRes.ok) return res.json({ total: 0, resultados: [] });
    const data = await mpRes.json();
    let licitaciones = data.Listado || [];

    // Normalización y filtro por keywords si se proporcionan
    const norm = s => (s || "").toLowerCase()
      .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
      .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
      .replace(/['''`´]/g, "").trim();
    const stem = t => t.length >= 6 ? t.slice(0, -2) : t;
    const matchesKw = (titulo, kw) => {
      const tNorm = norm(titulo);
      const terms = norm(kw).split(/\s+/).filter(t => t.length >= 3);
      if (!terms.length) return false;
      return terms.every(t => tNorm.includes(stem(t)));
    };

    // Si hay keywords, filtrar — si no, devolver todas las del organismo
    let filtradas = licitaciones;
    if (keywords.length > 0) {
      filtradas = licitaciones.filter(l => {
        const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
        const matchTec = keywords.some(kw => matchesKw(titulo, kw));
        if (!matchTec) return false;
        if (servicios.length === 0) return true;
        return servicios.some(s => matchesKw(titulo, s));
      });
    }

    // Mapear resultados
    let resultado = filtradas.map(l => {
      const textoCompleto  = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const regionExtraida = extraerRegionDeTexto(textoCompleto);
      const titulo         = l.Nombre || "Sin título";
      return {
        titulo,
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
        fuente:           "Mercado Público",
        divisiones:       clasificarDivisiones(titulo, regionExtraida?.codigo || null)
      };
    });

    if (codigosValidos) {
      resultado = resultado.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
    }

    res.json({ total: resultado.length, resultados: resultado });

  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "Tiempo de espera agotado" });
    res.status(500).json({ error: err.message });
  }
});


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

// ── DEBUG: devuelve el JSON crudo del API de MP para inspeccionar campos ─────
app.get("/detalle-raw/:codigo", async (req, res) => {
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${req.params.codigo}&ticket=${TICKET}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return res.status(r.status).json({ error: `API MP ${r.status}` });
    const data = await r.json();
    res.json(data.Listado?.[0] || { error: "No encontrada", raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEBUG: descarga el HTML de la ficha de MP y diagnostica el extractor ─────
// Uso: abrir https://backend-licitaciones.onrender.com/debug-mop/1063487-10-O126
app.get("/debug-mop/:codigo", async (req, res) => {
  const codigo = req.params.codigo;
  const url = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${codigo}`;
  try {
    const mpRes = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LENBot/1.0)" }
    });
    const status = mpRes.status;
    const html = await mpRes.text();

    // ── Búsquedas de texto en TODO el HTML ─────────────────────────────────
    // Si los datos están escondidos en cualquier parte (script, hidden, otra
    // tabla), aparecerán aquí. Si NO aparecen, confirma que es AJAX.
    const buscarEnHTML = (termino) => {
      const lower = html.toLowerCase();
      const t = termino.toLowerCase();
      const matches = [];
      let idx = 0;
      while ((idx = lower.indexOf(t, idx)) !== -1 && matches.length < 5) {
        const inicio = Math.max(0, idx - 80);
        const fin = Math.min(html.length, idx + termino.length + 80);
        matches.push({
          posicion: idx,
          contexto: html.substring(inicio, fin).replace(/\s+/g, " ").trim()
        });
        idx += termino.length;
      }
      return { ocurrencias: matches.length, matches };
    };

    // ── Listar scripts grandes (>1KB) que podrían contener datos ──────────
    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    const scriptsRelevantes = scriptMatches
      .map(m => ({ tamaño: m[1].length, primeros300: m[1].substring(0, 300).replace(/\s+/g, " ").trim() }))
      .filter(s => s.tamaño > 1000)
      .sort((a, b) => b.tamaño - a.tamaño)
      .slice(0, 5);

    // ── Buscar campos hidden con datos ─────────────────────────────────────
    const inputsHidden = [...html.matchAll(/<input[^>]+type\s*=\s*["']hidden["'][^>]*>/gi)]
      .map(m => m[0].substring(0, 200))
      .filter(s => /especial|categor|mop/i.test(s))
      .slice(0, 10);

    // ── Diagnóstico de la tabla específica ────────────────────────────────
    const tablaMatch = html.match(/<table[^>]*id\s*=\s*["']tblEspecialidades["'][^>]*>([\s\S]*?)<\/table>/i);
    const requisitos = extraerEspecialidadesMOP(html);

    res.json({
      url,
      status,
      tamaño_html: html.length,
      // Lo más importante: ¿están los datos esperados en el HTML?
      busqueda_datos_esperados: {
        "4.8":              buscarEnHTML("4.8"),
        "Obras Sanitarias": buscarEnHTML("Obras Sanitarias"),
        "2da":              buscarEnHTML("2da"),
        "tblEspecialidades":buscarEnHTML("tblEspecialidades")
      },
      tabla_tblEspecialidades: tablaMatch ? tablaMatch[0] : null,
      requisitos_extraidos_por_extractor: requisitos,
      scripts_grandes_que_podrian_tener_datos: scriptsRelevantes,
      inputs_hidden_relacionados: inputsHidden,
      primeros_500_chars: html.substring(0, 500)
    });
  } catch (err) {
    res.status(500).json({ error: err.message, url });
  }
});

// ── Validar Registro de Consultores MOP de LEN ───────────────────────────────
// Recibe { requisitos: [{ codigo: "4.8", descripcion: "Obras Sanitarias", categoria: "2da" }] }
// Devuelve { califica, fallas, diasVigencia, avisoVigencia }
app.post("/mp/validar-registro-mop", (req, res) => {
  res.json(validarRegistroMOP(req.body.requisitos || []));
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
  let htmlCompleto = "";
  if (item.url) {
    try {
      const mpPage = await fetch(item.url, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LENBot/1.0)" }
      });
      if (mpPage.ok) {
        htmlCompleto = await mpPage.text();
        contenidoMP = extraerTextoMP(htmlCompleto);
      }
    } catch (e) {
      console.warn("[mp/analizar] No se pudo obtener página MP:", e.message);
    }
  }

  // ── Paso 2: PRE-FILTRO Registro MOP ─────────────────────────────────────────
  // Si la licitación exige especialidades MOP y LEN no las tiene → descartar
  // sin gastar tokens de OpenAI.
  const requisitosMOP = extraerEspecialidadesMOP(htmlCompleto);
  if (requisitosMOP.length > 0) {
    const validacion = validarRegistroMOP(requisitosMOP);
    if (!validacion.califica) {
      const listaReq = requisitosMOP
        .map(r => `   • ${r.codigo} ${r.descripcion} — Categoría ${r.categoria}`)
        .join("\n");
      const listaFallas = validacion.fallas.map(f => `   ⚠️ ${f}`).join("\n");
      const aviso = validacion.avisoVigencia ? `\n${validacion.avisoVigencia}\n` : "";
      const analysis =
`🔴 LICITACIÓN DESCARTADA AUTOMÁTICAMENTE

❌ NO CUMPLE REQUISITOS DEL REGISTRO DE CONSULTORES MOP

Esta licitación exige las siguientes especialidades del Registro MOP:
${listaReq}

Estado de LEN frente a esos requisitos:
${listaFallas}
${aviso}
LEN quedaría fuera de bases automáticamente. El análisis IA fue omitido para no consumir tokens de OpenAI.

Si crees que esto es un error o quieres revisar igualmente, abre la licitación con "Ver en MP" y verifica el recuadro "Especialidades y categorías".`;

      return res.json({
        descartado: true,
        motivo: "No cumple Registro MOP",
        requisitos_mop: requisitosMOP,
        validacion,
        analysis
      });
    }
  }

  const contenidoExtra = contenidoMP
    ? `\n\nCONTENIDO COMPLETO DE LA PÁGINA DE MERCADO PÚBLICO:\n${contenidoMP}`
    : "\n\n(No se pudo obtener el contenido de la página de Mercado Público. Analiza solo con los metadatos disponibles.)";

  const requisitosTexto = requisitosMOP.length
    ? `\n\nREGISTRO MOP — VERIFICACIÓN PREVIA: Esta licitación exige ${requisitosMOP.map(r => `${r.codigo} ${r.descripcion} (${r.categoria})`).join(", ")}. LEN cumple con todos estos requisitos según el certificado vigente N°${LEN_REGISTRO_MOP.certificado}.`
    : "";

  // ── Paso 3: Análisis con GPT-4o ─────────────────────────────────────────────
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

REGLAS DE ASIGNACIÓN DE DIVISIÓN LEN:
Asigna la división según la especialidad principal del contrato:
- Cauces, hidráulica, hidrología, APR, drenaje, aguas lluvias, 
  cuencas, inundaciones, saneamiento → Obras Hidráulicas y Riego
- Vial, puentes, caminos, diseño geométrico, seguridad vial, 
  pavimentos, tránsito → Infraestructura de Transporte
- Inspección técnica en terreno, supervisión de obras → ITO (Santiago)
- Impacto ambiental, estudios territoriales → Medio Ambiente y Territorio
- Minería en contexto hidráulico o vial → Minería (en formación)
- Proyectos civiles generales sin especialidad clara → Proyectos Civiles
Si el contrato mezcla dos especialidades, indica la división principal 
y menciona la secundaria entre paréntesis.

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
URL: ${item.url || ""}${requisitosTexto}${contenidoExtra}

Entrega el análisis con este formato exacto:

📋 DESCRIPCIÓN Y OBJETIVOS
Redacta un párrafo extenso de 6 a 10 líneas que cubra:
- Contexto y antecedentes del proyecto (por qué se licita, qué problema resuelve)
- Objetivo general y objetivos específicos del estudio o servicio
- Alcance geográfico, técnico y temporal del trabajo
- Entregables principales esperados
- Cualquier condición particular relevante (modalidad de ejecución, ubicación clave, etc.)
Usa información concreta de las bases si está disponible. Evita frases genéricas.

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

// ── Guardar licitación en Gestor (Supabase) ───────────────────────────────────
app.post("/mp/guardar-gestor", async (req, res) => {
  const SUPABASE_URL  = "https://veuzudobuiwtrigdxqjt.supabase.co";
  const SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZldXp1ZG9idWl3dHJpZ2R4cWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODM2NTIsImV4cCI6MjA5MTc1OTY1Mn0.mb6Vo3-PmXKezJmSrLYbpCloEu8DPJglrBgkho63wYM";

  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  // Parsear fecha de cierre al formato YYYY-MM-DD que espera Supabase
  const parsearFecha = (str) => {
    if (!str || str === "–") return null;
    const p = str.split(/[-\/]/);
    if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
    if (p.length === 3 && p[0].length === 4) return str.substring(0, 10);
    return null;
  };

  // Steps inicializados en cero (14 pasos)
  const stepsInit = {};
  for (let i = 0; i < 14; i++) {
    stepsInit[i] = { done: false, notes: "", days: [1,2,2,2,1,1,1,2,2,1,2,5,2,1][i] };
  }

  // Generar id único igual que el gestor frontend
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  const payload = {
    id:          uid(),
    nombre:      item.titulo || "Sin título",
    codigo:      item.codigo || "No Indica",
    mandante:    item.organismo || "–",
    fecha_cierre: parsearFecha(item.fechaCierre),
    responsable: "Ginés Agurto / Karina Montecinos",
    steps_json:  stepsInit
  };

  try {
    // Verificar si ya existe la licitación por código para no duplicar
    if (item.codigo) {
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/licitaciones?codigo=eq.${encodeURIComponent(item.codigo)}&select=id`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      const existing = await checkRes.json();
      if (existing.length > 0) {
        return res.json({ ok: false, mensaje: "La licitación ya existe en el gestor", id: existing[0].id });
      }
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/licitaciones`, {
      method: "POST",
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=representation"
      },
      body: JSON.stringify(payload)
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      return res.status(502).json({ error: `Supabase respondió ${insertRes.status}: ${err.substring(0, 200)}` });
    }

    const data = await insertRes.json();
    res.json({ ok: true, mensaje: "Licitación guardada en el gestor", id: data[0]?.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analizar Bases de Licitación (ZIP → Excel) ────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 } // 60MB
}).single("archivo");

async function extraerTextoPDF(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    const avgChars = data.numpages > 0 ? data.text.length / data.numpages : 0;
    return {
      texto:     data.text.substring(0, 40000), // 40K por PDF
      paginas:   data.numpages,
      escaneado: avgChars < 50,
      ok:        true
    };
  } catch(e) {
    return { texto: "", paginas: 0, escaneado: true, ok: false, error: e.message };
  }
}

// Detectar si un archivo es genérico/no relevante para priorización
function esDocumentoGenerico(nombre) {
  const lower = nombre.toLowerCase();
  return lower.includes('sso') || lower.includes('seguridad') ||
         lower.includes('salud') || lower.includes('reglamento') ||
         lower.includes('eeg') || lower.includes('estandar') ||
         lower.includes('standard');
}

app.post("/mp/analizar-bases", (req, res) => {
  // Timeout de 3 minutos para el análisis secuencial de 5 agentes
  req.setTimeout(180000);
  res.setTimeout(180000);
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "Error al subir archivo: " + err.message });

    const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
    if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada" });
    if (!req.file)   return res.status(400).json({ error: "Archivo ZIP requerido" });

    let metadata = {};
    try { metadata = JSON.parse(req.body.metadata || "{}"); } catch(e) {}

    const archivosAuditoria = [];
    const textosRelevantes  = []; // BA, TR, bases técnicas
    const textosGenericos   = []; // SSO, reglamentos, estándares genéricos
    let escaneadosCount     = 0;

    try {
      const zip     = new AdmZip(req.file.buffer);
      const entradas = zip.getEntries();

      for (const entrada of entradas) {
        if (entrada.isDirectory) continue;
        const nombre = entrada.name;
        const ext    = nombre.split(".").pop().toLowerCase();

        if (ext === "pdf") {
          const buf       = entrada.getData();
          const resultado = await extraerTextoPDF(buf);
          archivosAuditoria.push({
            nombre,
            tipo:        resultado.escaneado ? "Escaneado" : "Texto",
            paginas:     resultado.paginas,
            estado:      resultado.ok ? (resultado.escaneado ? "⚠️ Escaneado" : "✅ Procesado") : "❌ Error",
            observacion: resultado.escaneado ? "Revisar manualmente" : (resultado.error || "")
          });
          if (resultado.escaneado) escaneadosCount++;
          if (resultado.texto.trim()) {
            const bloque = `=== ${nombre} ===\n${resultado.texto}`;
            // Separar documentos relevantes de genéricos
            if (esDocumentoGenerico(nombre)) {
              textosGenericos.push(bloque);
            } else {
              textosRelevantes.push(bloque);
            }
          }

        } else if (["docx","doc"].includes(ext)) {
          archivosAuditoria.push({ nombre, tipo:"Word", paginas:"–", estado:"⚠️ No procesado", observacion:"Revisar manualmente" });
        } else {
          archivosAuditoria.push({ nombre, tipo:ext.toUpperCase(), paginas:"–", estado:"⚪ Omitido", observacion:"Formato no soportado" });
        }
      }

      if (!textosRelevantes.length && !textosGenericos.length) {
        return res.status(422).json({ error: "No se pudo extraer texto de ningún PDF.", escaneados: escaneadosCount, auditoria: archivosAuditoria });
      }

      // Límite total y por agente
      const LIMITE_TOTAL = 80000;
      let textoTotal = textosRelevantes.join("\n\n");
      if (textoTotal.length < LIMITE_TOTAL && textosGenericos.length) {
        const espacio = LIMITE_TOTAL - textoTotal.length;
        textoTotal += "\n\n" + textosGenericos.join("\n\n").substring(0, espacio);
      }
      textoTotal = textoTotal.substring(0, LIMITE_TOTAL);

      // Cada agente recibe un fragmento distinto del texto para respetar el límite de tokens
      // Agentes 1 y 2 leen el inicio (identificación, fechas suelen estar al principio)
      // Agentes 3 y 4 leen la parte media (garantías, requisitos)
      // Agente 5 lee el final (alcance técnico suele estar al final en TR)
      const FRAG = Math.floor(textoTotal.length / 3);
      const textoInicio = textoTotal.substring(0, FRAG * 2);        // 0% - 67%
      const textoMedio  = textoTotal.substring(FRAG, FRAG * 3);     // 33% - 100%
      const textoFinal  = textoTotal.substring(FRAG * 2);           // 67% - 100%

      // ── Helper para llamar GPT-4o ──────────────────────────────────────────
      const gpt = async (systemPrompt, userPrompt) => {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({
            model: "gpt-4o", max_tokens: 3000,
            messages: [
              { role:"system", content: systemPrompt },
              { role:"user",   content: userPrompt }
            ]
          })
        });
        if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text().then(t=>t.substring(0,100))}`);
        const d = await r.json();
        const txt = d.choices?.[0]?.message?.content || "";
        const clean = txt.replace(/```json|```/g,"").trim();
        const match = clean.match(/\{[\s\S]*\}/);
        return JSON.parse(match ? match[0] : clean);
      };

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

      const BASE_SYSTEM = `Eres un experto senior en licitaciones públicas chilenas para LEN Ingeniería.
Extrae información TEXTUAL EXACTA de los documentos (montos exactos, fechas con hora, direcciones completas, porcentajes, secciones de referencia).
NUNCA inventes — usa "[NO ENCONTRADO]" solo si genuinamente no existe.
Responde ÚNICAMENTE con JSON válido sin markdown.`;

      const META = `METADATA MP: Título: ${metadata.titulo||""} | Código: ${metadata.codigo||""} | Mandante: ${metadata.organismo||""} | Región: ${metadata.region||""} | Monto: ${metadata.monto||""} | Cierre: ${metadata.fechaCierre||""} | URL: ${metadata.url||""}`;

      // ── 5 Agentes especializados secuenciales ─────────────────────────────
      console.log("[analizar-bases] Iniciando agente 1: Identificación");
      const r1 = await gpt(BASE_SYSTEM, `${META}\n\nDOCUMENTOS:\n${textoInicio}\n\nExtrae SOLO identificación y descripción del proyecto. JSON:\n{"identificacion":{"nombre":"","codigo_mp":"","mandante":"","region":"","tipo_licitacion":"","monto_estimado":"","fecha_cierre":"","tipo_proceso":"","modalidad_contrato":"","moneda":"","vigencia_contrato":"","inicio_estimado":"","contacto":"","plataforma_envio":"","url_mp":"","documentos_licitacion":""},"proposito":{"objetivo_general":"","alcance_detallado":"","naturaleza_encargo":"","obras_principales":"","grupos_trabajo":"","especialidades_requeridas":""}}`);
      await sleep(15000);

      console.log("[analizar-bases] Iniciando agente 2: Calendario");
      const r2 = await gpt(BASE_SYSTEM, `${META}\n\nDOCUMENTOS:\n${textoInicio}\n\nExtrae TODAS las fechas y hitos del proceso. Para cada fecha incluye hora si existe, lugar si aplica, y observaciones importantes. JSON:\n{"calendario":[{"hito":"","fecha_plazo":"","observaciones":"","estado":"✔ Pasado o Próximo o —"}],"preguntas_sugeridas":[""]}`);
      await sleep(15000);

      console.log("[analizar-bases] Iniciando agente 3: Garantías y Pagos");
      const r3 = await gpt(BASE_SYSTEM, `${META}\n\nDOCUMENTOS:\n${textoMedio}\n\nExtrae garantías (monto exacto, forma, vigencia, lugar entrega, glosa), esquema de pagos por hitos (porcentaje exacto, descripción hito), condiciones de pago y multas. JSON:\n{"garantias":[{"tipo":"","monto":"","vigencia":"","forma":"","lugar_entrega":"","glosa":"","observaciones":""}],"esquema_pagos":[{"estado_pago":"","hito_etapa":"","porcentaje":"","descripcion":""}],"condiciones_pago":[{"condicion":"","descripcion":""}],"multas":[{"causal":"","monto":"","alcance":"","tope":""}]}`);
      await sleep(15000);

      console.log("[analizar-bases] Iniciando agente 4: Requisitos y Puntos Críticos");
      const r4 = await gpt(BASE_SYSTEM, `${META}\n\nDOCUMENTOS:\n${textoMedio}\n\nExtrae requisitos de empresa (con fuente y cómo acreditar), requisitos de profesionales (cargo, título, experiencia, dedicación) y puntos críticos (🔴 excluyentes/riesgosos, 🟡 importantes, 🟢 favorables, ℹ informativos). JSON:\n{"requisitos_empresa":[{"requisito":"","descripcion":"","fuente":"","como_acreditar":""}],"requisitos_profesionales":[{"cargo":"","titulo_requerido":"","experiencia":"","dedicacion":"","como_acreditar":""}],"puntos_criticos":[{"indicador":"🔴 o 🟡 o 🟢 o ℹ","punto":"","descripcion_detallada":""}]}`);
      await sleep(15000);

      console.log("[analizar-bases] Iniciando agente 5: Alcance Técnico");
      const r5 = await gpt(BASE_SYSTEM, `${META}\n\nDOCUMENTOS:\n${textoFinal}\n\nExtrae alcance técnico completo: etapas con duración y entregables específicos, especialidades requeridas, condiciones operativas, formatos de entrega y normativa aplicable. JSON:\n{"alcance_tecnico":{"etapas":[{"etapa":"","duracion":"","contenido":"","entregables":""}],"especialidades":[{"especialidad":"","alcance_principal":""}],"condiciones_operativas":"","formatos_entrega":"","normativa_aplicable":""}}`);

      console.log("[analizar-bases] Todos los agentes completados, consolidando resultados");

      // ── Consolidar resultados de los 5 agentes ─────────────────────────────
      const analisis = {
        identificacion:        r1.identificacion        || {},
        proposito:             r1.proposito             || {},
        calendario:            r2.calendario            || [],
        preguntas_sugeridas:   r2.preguntas_sugeridas   || [],
        garantias:             r3.garantias             || [],
        esquema_pagos:         r3.esquema_pagos         || [],
        condiciones_pago:      r3.condiciones_pago      || [],
        multas:                r3.multas                || [],
        requisitos_empresa:    r4.requisitos_empresa    || [],
        requisitos_profesionales: r4.requisitos_profesionales || [],
        puntos_criticos:       r4.puntos_criticos       || [],
        alcance_tecnico:       r5.alcance_tecnico       || {}
      };

      // ── Generar Excel ──────────────────────────────────────────────────────
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "LEN Ingeniería";
      wb.created = new Date();

      const C = { azulOscuro:"1E3A5F", azulMedio:"2563EB", azulClaro:"EFF6FF",
                  verdeClaro:"F0FDF4", amClaro:"FFFBEB", rojoClaro:"FEF2F2",
                  gris:"F8FAFC", blanco:"FFFFFF" };

      const hdrStyle = (bg) => ({
        font: { bold:true, color:{argb:"FFFFFFFF"}, name:"Arial", size:10 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb:`FF${bg}`} },
        alignment: { horizontal:"left", vertical:"middle", wrapText:true }
      });
      const secStyle = () => ({
        font: { bold:true, color:{argb:`FF${C.azulMedio}`}, name:"Arial", size:10 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb:`FF${C.azulClaro}`} },
        alignment: { horizontal:"left", vertical:"middle" }
      });
      const lblStyle = () => ({
        font: { bold:true, name:"Arial", size:9 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb:"FFFAFAFA"} },
        alignment: { horizontal:"left", vertical:"middle", wrapText:true }
      });
      const valStyle = (bg) => ({
        font: { name:"Arial", size:9 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb: bg ? `FF${bg}` : "FFFFFFFF"} },
        alignment: { horizontal:"left", vertical:"middle", wrapText:true }
      });
      const tblHdr = () => ({
        font: { bold:true, color:{argb:"FFFFFFFF"}, name:"Arial", size:9 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb:`FF${C.azulOscuro}`} },
        alignment: { horizontal:"center", vertical:"middle", wrapText:true }
      });
      const rowS = (i, bg) => ({
        font: { name:"Arial", size:9 },
        fill: { type:"pattern", pattern:"solid", fgColor:{argb: bg ? `FF${bg}` : (i%2===0 ? "FFFFFFFF" : `FF${C.gris}`)} },
        alignment: { horizontal:"left", vertical:"middle", wrapText:true }
      });

      const addTitle = (ws, txt, cols) => {
        const r = ws.addRow([txt]);
        ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = { font:{bold:true,size:13,color:{argb:"FFFFFFFF"},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.azulOscuro}`}}, alignment:{horizontal:"center",vertical:"middle"} };
        r.height = 32;
      };
      const addSec = (ws, txt, cols) => {
        const r = ws.addRow([txt]);
        ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = secStyle();
        r.height = 22;
      };
      const addKV = (ws, lbl, val, bg) => {
        const r = ws.addRow([lbl, val||"[NO ENCONTRADO]"]);
        r.getCell(1).style = lblStyle();
        r.getCell(2).style = valStyle(bg);
        r.height = 18;
        return r;
      };
      const addTableRow = (ws, cells, idx, bg) => {
        const r = ws.addRow(cells);
        r.eachCell(c => { c.style = rowS(idx, bg); c.alignment = {wrapText:true, vertical:"middle"}; });
        r.height = 32;
        return r;
      };

      const id   = analisis.identificacion || {};
      const prop = analisis.proposito || {};
      const alc  = analisis.alcance_tecnico || {};

      // ── Hoja 1: Resumen General ────────────────────────────────────────────
      const ws1 = wb.addWorksheet("Resumen General");
      ws1.columns = [{ width:35 },{ width:75 }];
      const tituloExcel = (id.nombre || metadata.titulo || "LICITACIÓN").toUpperCase();
      addTitle(ws1, tituloExcel, 2);
      addTitle(ws1, (id.mandante || metadata.organismo || "").toUpperCase(), 2);

      // Indicador de confianza
      ws1.addRow([]);
      const confLabel = escaneadosCount===0 ? "🟢 Extracción completa — revisión recomendada antes de usar" :
                        escaneadosCount < archivosAuditoria.filter(a=>a.tipo==="Texto").length ? "🟡 Extracción parcial — algunos PDFs escaneados, completar manualmente" :
                        "🔴 Extracción fallida — revisar manualmente";
      const confBg = escaneadosCount===0 ? "F0FDF4" : escaneadosCount < archivosAuditoria.length/2 ? "FFFBEB" : "FEF2F2";
      const rConf = addKV(ws1, "📊 Indicador de confianza", confLabel, confBg);
      rConf.height = 22;
      if (escaneadosCount > 0) {
        const rAlert = addKV(ws1, "⚠️ Alerta", `${escaneadosCount} archivo(s) escaneado(s). Revisar manualmente esas secciones.`, "FFFBEB");
        rAlert.height = 22;
      }
      ws1.addRow([]);

      // Identificación
      addSec(ws1, "IDENTIFICACIÓN", 2);
      const camposId = [
        ["Nombre licitación", id.nombre || metadata.titulo],
        ["Mandante", id.mandante || metadata.organismo],
        ["Tipo de licitación", id.tipo_licitacion],
        ["Modalidad contrato", id.modalidad_contrato],
        ["Monto estimado", id.monto_estimado || metadata.monto],
        ["Fecha cierre", id.fecha_cierre || metadata.fechaCierre],
        ["Región", id.region || metadata.region],
        ["Tipo de proceso", id.tipo_proceso],
        ["Moneda", id.moneda],
        ["Vigencia del contrato", id.vigencia_contrato],
        ["Inicio estimado", id.inicio_estimado],
        ["Contacto", id.contacto],
        ["Plataforma / Envío", id.plataforma_envio],
        ["URL Mercado Público", id.url_mp || metadata.url],
        ["Confidencialidad", id.confidencialidad]
      ];
      camposId.filter(([,v]) => v && v !== "[NO ENCONTRADO]").forEach(([l,v]) => addKV(ws1, l, v));
      ws1.addRow([]);

      // Descripción del proyecto
      addSec(ws1, "DESCRIPCIÓN DEL PROYECTO", 2);
      const camposProp = [
        ["Objetivo principal", prop.objetivo_general],
        ["Alcance detallado", prop.alcance_detallado],
        ["Naturaleza del encargo", prop.naturaleza_encargo],
        ["Obras principales", prop.obras_principales],
        ["Grupos de trabajo", prop.grupos_trabajo],
        ["Especialidades requeridas", prop.especialidades_requeridas]
      ];
      camposProp.filter(([,v]) => v && v !== "[NO ENCONTRADO]").forEach(([l,v]) => {
        const r = addKV(ws1, l, v);
        r.height = 48;
      });
      ws1.addRow([]);

      // Requisitos empresa
      if (analisis.requisitos_empresa?.length) {
        addSec(ws1, "REQUISITOS PROPONENTES", 2);
        const hrEmp = ws1.addRow(["Requisito", "Descripción / Cómo acreditar"]);
        hrEmp.eachCell(c => { c.style = hdrStyle(C.azulMedio); }); hrEmp.height = 18;
        analisis.requisitos_empresa.forEach((r, i) => {
          const texto = [r.descripcion, r.fuente ? `Fuente: ${r.fuente}` : "", r.como_acreditar ? `Acreditación: ${r.como_acreditar}` : ""].filter(Boolean).join("\n");
          addTableRow(ws1, [r.requisito, texto], i);
        });
        ws1.addRow([]);
      }

      // Requisitos profesionales
      if (analisis.requisitos_profesionales?.length) {
        addSec(ws1, "REQUISITOS PROFESIONALES", 2);
        const hrProf = ws1.addRow(["Cargo", "Título / Experiencia / Dedicación"]);
        hrProf.eachCell(c => { c.style = hdrStyle(C.azulMedio); }); hrProf.height = 18;
        analisis.requisitos_profesionales.forEach((r, i) => {
          const texto = [r.titulo_requerido, r.experiencia, r.dedicacion ? `Dedicación: ${r.dedicacion}` : "", r.como_acreditar ? `Acreditar: ${r.como_acreditar}` : ""].filter(Boolean).join("\n");
          addTableRow(ws1, [r.cargo, texto], i);
        });
        ws1.addRow([]);
      }

      // Puntos críticos
      if (analisis.puntos_criticos?.length) {
        addSec(ws1, "⚠ PUNTOS CRÍTICOS ANTES DE DECIDIR PARTICIPAR", 2);
        analisis.puntos_criticos.forEach((p, i) => {
          const bg = p.indicador?.includes("🟢") ? "F0FDF4" : p.indicador?.includes("🟡") ? "FFFBEB" : p.indicador?.includes("🔴") ? "FEF2F2" : null;
          const r = addKV(ws1, `${p.indicador||""} ${p.punto||""}`, p.descripcion_detallada || p.descripcion || "", bg);
          r.height = 36;
        });
        ws1.addRow([]);
      }

      // Preguntas sugeridas
      if (analisis.preguntas_sugeridas?.length && analisis.preguntas_sugeridas[0]) {
        addSec(ws1, "PREGUNTAS SUGERIDAS PARA EL FORO", 2);
        analisis.preguntas_sugeridas.forEach((q, i) => {
          const r = ws1.addRow([`${i+1}.`, q]);
          r.getCell(1).style = lblStyle();
          r.getCell(2).style = valStyle();
          r.height = 22;
        });
      }

      // ── Hoja 2: Calendario ────────────────────────────────────────────────
      const ws2 = wb.addWorksheet("Calendario");
      ws2.columns = [{ width:38 },{ width:22 },{ width:55 },{ width:14 }];
      addTitle(ws2, `CALENDARIO DE LICITACIÓN — ${id.codigo_mp || metadata.codigo || ""}`, 4);
      const hc = ws2.addRow(["Hito", "Fecha / Plazo", "Observaciones", "Estado"]);
      hc.eachCell(c => { c.style = tblHdr(); }); hc.height = 18;
      (analisis.calendario || []).forEach((c, i) => {
        const bg = c.estado?.includes("✔") ? "F0FDF4" : c.estado?.includes("⚠") ? "FEF2F2" : null;
        addTableRow(ws2, [c.hito, c.fecha_plazo || c.fecha, c.observaciones, c.estado], i, bg);
      });

      // ── Hoja 3: Garantías y Pagos ─────────────────────────────────────────
      const ws3 = wb.addWorksheet("Garantías y Pagos");
      ws3.columns = [{ width:35 },{ width:25 },{ width:22 },{ width:22 },{ width:42 }];
      addTitle(ws3, `GARANTÍAS Y ESQUEMA DE PAGOS — ${id.mandante || metadata.organismo || ""}`, 5);

      addSec(ws3, "GARANTÍAS", 5);
      const hg = ws3.addRow(["Tipo de Garantía", "Monto / Porcentaje", "Vigencia", "Forma", "Observaciones"]);
      hg.eachCell(c => { c.style = tblHdr(); }); hg.height = 18;
      (analisis.garantias || []).forEach((g, i) => {
        const obs = [g.lugar_entrega ? `Lugar: ${g.lugar_entrega}` : "", g.observaciones].filter(Boolean).join(" | ");
        addTableRow(ws3, [g.tipo, g.monto, g.vigencia, g.forma, obs], i);
      });
      ws3.addRow([]);

      if (analisis.esquema_pagos?.length) {
        addSec(ws3, "ESQUEMA DE PAGOS POR HITOS", 5);
        const hep = ws3.addRow(["Estado de Pago", "Hito / Etapa", "Porcentaje", "", "Descripción del hito"]);
        hep.eachCell(c => { c.style = tblHdr(); }); hep.height = 18;
        analisis.esquema_pagos.forEach((ep, i) => {
          addTableRow(ws3, [ep.estado_pago, ep.hito_etapa, ep.porcentaje, "", ep.descripcion], i);
        });
        ws3.addRow([]);
      }

      addSec(ws3, "CONDICIONES DE PAGO", 5);
      (analisis.condiciones_pago || []).forEach((cp, i) => {
        const r = ws3.addRow([cp.condicion, cp.descripcion]);
        ws3.mergeCells(r.number, 2, r.number, 5);
        r.eachCell(c => { c.style = rowS(i); c.alignment = {wrapText:true, vertical:"middle"}; });
        r.height = 24;
      });
      ws3.addRow([]);

      if (analisis.multas?.length) {
        addSec(ws3, "MULTAS Y SANCIONES", 5);
        const hm = ws3.addRow(["Causal", "Monto", "Alcance", "Tope", "Observaciones"]);
        hm.eachCell(c => { c.style = tblHdr(); }); hm.height = 18;
        analisis.multas.forEach((m, i) => {
          addTableRow(ws3, [m.causal, m.monto, m.alcance, m.tope, ""], i);
        });
      }

      // ── Hoja 4: Alcance Técnico ───────────────────────────────────────────
      const ws4 = wb.addWorksheet("Alcance Técnico");
      ws4.columns = [{ width:20 },{ width:15 },{ width:45 },{ width:45 }];
      addTitle(ws4, "ALCANCE TÉCNICO Y ENTREGABLES", 4);

      if (alc.etapas?.length) {
        addSec(ws4, "ETAPAS Y ENTREGABLES POR ETAPA", 4);
        const he = ws4.addRow(["Etapa", "Duración", "Contenido Principal", "Entregables Clave"]);
        he.eachCell(c => { c.style = tblHdr(); }); he.height = 18;
        alc.etapas.forEach((e, i) => addTableRow(ws4, [e.etapa, e.duracion, e.contenido, e.entregables], i));
        ws4.addRow([]);
      }

      if (alc.especialidades?.length) {
        addSec(ws4, "ESPECIALIDADES CONSULTADAS", 4);
        const hes = ws4.addRow(["Especialidad", "", "Alcance Principal", ""]);
        hes.eachCell(c => { c.style = tblHdr(); }); hes.height = 18;
        alc.especialidades.forEach((e, i) => {
          const r = ws4.addRow([e.especialidad, "", e.alcance_principal, ""]);
          ws4.mergeCells(r.number, 3, r.number, 4);
          r.eachCell(c => { c.style = rowS(i); c.alignment = {wrapText:true, vertical:"middle"}; });
          r.height = 28;
        });
        ws4.addRow([]);
      }

      if (alc.condiciones_operativas) {
        addSec(ws4, "CONDICIONES OPERATIVAS RELEVANTES", 4);
        const rCO = ws4.addRow([alc.condiciones_operativas]);
        ws4.mergeCells(rCO.number, 1, rCO.number, 4);
        rCO.getCell(1).style = { font:{name:"Arial",size:9}, alignment:{wrapText:true,vertical:"middle"} };
        rCO.height = 48;
        ws4.addRow([]);
      }

      if (alc.formatos_entrega || alc.normativa_aplicable) {
        addSec(ws4, "FORMATOS Y NORMATIVA", 4);
        if (alc.formatos_entrega) addKV(ws4, "Formatos de entrega", alc.formatos_entrega);
        if (alc.normativa_aplicable) addKV(ws4, "Normativa aplicable", alc.normativa_aplicable);
      }

      // ── Hoja 5: Auditoría ─────────────────────────────────────────────────
      const ws5 = wb.addWorksheet("Auditoría");
      ws5.columns = [{ width:42 },{ width:15 },{ width:10 },{ width:18 },{ width:42 }];
      addTitle(ws5, "AUDITORÍA DE ARCHIVOS PROCESADOS", 5);
      const rfecha = ws5.addRow([`Fecha análisis: ${new Date().toLocaleString("es-CL")} | Archivos: ${archivosAuditoria.length} | PDFs escaneados: ${escaneadosCount}`]);
      ws5.mergeCells(rfecha.number, 1, rfecha.number, 5);
      rfecha.getCell(1).style = { font:{italic:true,size:9,name:"Arial"}, alignment:{horizontal:"left"} };
      rfecha.height = 16;
      ws5.addRow([]);
      const ha = ws5.addRow(["Archivo", "Tipo", "Páginas", "Estado", "Observación"]);
      ha.eachCell(c => { c.style = tblHdr(); }); ha.height = 18;
      archivosAuditoria.forEach((a, i) => addTableRow(ws5, [a.nombre, a.tipo, a.paginas, a.estado, a.observacion], i));

      // ── Respuesta ──────────────────────────────────────────────────────────
      const buf     = await wb.xlsx.writeBuffer();
      const b64     = Buffer.from(buf).toString("base64");
      const archivo = `Resumen_${(metadata.codigo||"LIC").replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`;
      const confianza = escaneadosCount===0 ? "completa" : escaneadosCount < archivosAuditoria.filter(a=>a.tipo==="Escaneado"||a.tipo==="Texto").length ? "parcial" : "fallida";

      res.json({ ok:true, excelBase64:b64, nombreArchivo:archivo, confianza, escaneados:escaneadosCount, totalArchivos:archivosAuditoria.length, auditoria:archivosAuditoria });

    } catch(err) {
      console.error("[analizar-bases]", err.message);
      res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, () => console.log(`Backend licitaciones en puerto ${PORT} | Ticket: ${TICKET.substring(0,8)}...`));

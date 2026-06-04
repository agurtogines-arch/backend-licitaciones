const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");
const path    = require("path");
const multer  = require("multer");
const AdmZip  = require("adm-zip");
const ExcelJS = require("exceljs");

const app  = express();
const PORT = process.env.PORT || 8080;
const TICKET = process.env.MP_TICKET || "1FC8A3E9-5D72-495C-8340-83E5B1749B79";

// ── Configuración Supabase (centralizada) ────────────────────────────────────
const SUPABASE_URL = "https://veuzudobuiwtrigdxqjt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZldXp1ZG9idWl3dHJpZ2R4cWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODM2NTIsImV4cCI6MjA5MTc1OTY1Mn0.mb6Vo3-PmXKezJmSrLYbpCloEu8DPJglrBgkho63wYM";
const SUPABASE_HEADERS = {
  "apikey":        SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type":  "application/json"
};

// ── Identidad de LEN para detección de adjudicaciones ─────────────────────────
const LEN_RUT = "83.665.200-2";
function normalizarRut(rut) {
  return (rut || "").toString().replace(/[.\-\s]/g, "").toLowerCase();
}
const LEN_RUT_NORMALIZADO = normalizarRut(LEN_RUT);

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

// ── DIVISIONES LEN ─────────────────────────────────────────────────────────
const DIVISIONES_LEN = [
  {
    id: "zonasur", label: "Zona Sur", icon: "🌊", color: "#0369a1",
    activa: true,
    keywords: ["vial","seguridad vial","puentes","caminos","transito","pavimento","diseño geometrico","prefactibilidad vial","factibilidad vial","prefactibilidad hidraulica","factibilidad hidraulica","hidraulica","hidrologia","aguas lluvias","cauces","apr","saneamiento","alcantarillado","planta de tratamiento","planta elevadora","conducciones","inundaciones","drenaje","cuencas","aguas servidas","agua potable","sanitario","ssr","rural"],
    servicios: ["estudio","consultoria","asesoria","diseno","inspeccion","levantamiento"],
    regiones: ["7","16","8","9","14","10","11","12"],
    exclusiones: {
      // Si el texto tiene señales claras de ITO, NO es Zona Sur — el servicio
      // (no el territorio) determina la división. ITO opera nacionalmente, así
      // que un trabajo de inspección en Ñuble va a ITO, no a Zona Sur.
      keywords: [
        // ── ITO (inspección/supervisión) ──
        "aif","aif global","aif vialidad","aif mop",
        "asesoria a la inspeccion","asesoria a la inspeccion fiscal",
        "asesoria inspeccion fiscal","asistencia a la inspeccion",
        "inspeccion fiscal","fiscalizacion de obras","fiscalizacion de contrato",
        "supervision de obras","supervision de contrato","supervision tecnica",
        "contraparte tecnica","auditoria tecnica de obras",
        "inspeccion de obras","inspeccion tecnica","inspeccion de puente",
        "inspeccion de puentes","inspeccion de pavimento","inspeccion de caminos",
        // ── Sector salud (no es LEN) ──
        "stent","medicamento","insumo medico","insumos medicos","farmaceutico",
        "consignacion en transito","hospital de carabineros","fondo hospital",
        "servicio de salud","atencion medica","equipo medico","equipamiento medico",
        "implante","protesis","reactivo","cirugia",
        // ── Sector eléctrico (no es Zona Sur, va a Energía si aplica) ──
        "asesoria tecnica electrica","asesor electrico","ingeniero electrico",
        "instalacion electrica","tablero electrico","empalme electrico",
        // ── Servicios menores fuera del alcance LEN ──
        "senda peatonal","sendas peatonales","reparacion de veredas",
        "bacheo","tapado de hoyos","pintura de demarcacion"
      ],
      combinados: [
        { todas: ["actualizacion sanitario rural", "hidrogeologia"] },
        { todas: ["actualizacion ssr", "hidrogeologia"] }
      ]
    }
  },
  {
    id: "infra", label: "Infraestructura", icon: "🛣️", color: "#7c3aed",
    activa: true,
    keywords: ["ingenieria de detalle","ingenieria basica","estudio de factibilidad","anteproyecto","preinversion","iluminacion vial","conservacion vial","infraestructura vial","ingenieria vial","transporte vial","proteccion costera","obras portuarias","infraestructura portuaria","obras maritimas"],
    servicios: ["estudio","consultoria","diseno","prefactibilidad","factibilidad","asesoria","anteproyecto","inspeccion"],
    exclusiones: {
      organismos: ["serviu", "municipalidad", "ilustre municipalidad", "i. municipalidad"],
      // Si tiene señales ITO, no es infra — infra hace proyectos/diseños,
      // ITO hace supervisión/asesoría a la inspección
      keywords: [
        "arquitectura", "edificacion", "edificaciones",
        "aif","aif global","aif vialidad","aif mop",
        "asesoria a la inspeccion","asesoria a la inspeccion fiscal",
        "asesoria inspeccion fiscal","inspeccion fiscal",
        "fiscalizacion de obras","fiscalizacion de contrato",
        "supervision de obras","supervision de contrato","supervision tecnica",
        "contraparte tecnica"
      ]
    }
  },
  {
    id: "medioambiente", label: "Medio Ambiente", icon: "🌿", color: "#15803d",
    activa: false,
    keywords: ["ambiental","seia","impacto ambiental","pertinencia ambiental","linea de base","monitoreo ambiental","seguimiento ambiental","declaracion de impacto"],
    servicios: ["estudio","consultoria","monitoreo","asesoria","levantamiento"],
    exclusiones: { organismos: ["mop", "minvu", "municipalidad", "universidad"] }
  },
  {
    id: "energia", label: "Energía", icon: "⚡", color: "#b45309",
    activa: true,
    keywords: ["fotovoltaico","eolico","solar","ernc","bess","eficiencia energetica","hidrogeno verde","electromovilidad","energia renovable","descarbonizacion","autogeneracion","energetico"],
    servicios: ["estudio","consultoria","diseno","asesoria","diagnostico","prefactibilidad","factibilidad","ingenieria"],
    exclusiones: { organismos: ["minvu", "ministerio de vivienda"] }
  },
  {
    id: "ito", label: "Inspección Técnica", icon: "🔍", color: "#dc2626",
    activa: true,
    keywords: [
      "ito","inspeccion tecnica","supervision de obras","contraparte tecnica",
      "fiscalizacion de obras","auditoria tecnica de obras",
      "geomensura","supervision tecnica","acompanamiento a la construccion",
      "inspeccion fiscal","asistencia tecnica en obra","inspeccion de obras",
      // AIF = Asesoría a la Inspección Fiscal (sigla MOP muy frecuente)
      "aif","aif global","aif vialidad","aif mop",
      "asesoria a la inspeccion","asesoria inspeccion fiscal",
      "asesoria a la inspeccion fiscal","asistencia a la inspeccion",
      "inspeccion de contrato","supervision de contrato",
      "fiscalizacion de contrato"
    ],
    servicios: [],
    exclusiones: {
      organismos: ["municipalidad", "ilustre municipalidad", "i. municipalidad"],
      organismosCondicionales: [{ si_organismo: "serviu", excluir_si_keywords: ["camino", "caminos"] }]
    }
  },
  {
    id: "civil", label: "Proyectos Civiles", icon: "🏗️", color: "#475569",
    activa: false,
    keywords: ["paralelismo","atraviesos","movimiento de tierras","pavimentacion","permisos dga","hidrogeologia","obras tempranas","ingenieria estructural","obras civiles","urbanizacion","observaciones del proyecto"],
    servicios: ["estudio","diseno","consultoria","ingenieria civil","asesoria"],
    exclusiones: {}
  },
  {
    id: "mineria", label: "Minería", icon: "⛏️", color: "#92400e",
    activa: true,
    keywords: ["mineria","minera","minero","mina","expropiaciones","descarbonizacion","hoja de ruta","faena"],
    servicios: ["estudio","consultoria","ingenieria","asesoria","diseno"],
    exclusiones: {
      keywords: ["geologia", "hidrogeologia", "hidrociclones", "geotecnica", "geotecnia",
                 "lixiviacion", "procesos de planta", "sulfuros", "chancado", "molienda", "flotacion"]
    }
  }
];

function aplicaExclusiones(division, organismo, textoCompleto) {
  const exc = division.exclusiones;
  if (!exc) return false;
  const orgN = (organismo || "").toLowerCase();
  if (exc.organismosCondicionales) {
    for (const cond of exc.organismosCondicionales) {
      if (orgN.includes(cond.si_organismo.toLowerCase())) {
        const tieneKwExclusion = cond.excluir_si_keywords.some(k => matchDivKw(textoCompleto, k));
        if (tieneKwExclusion) return true;
        return false;
      }
    }
  }
  if (exc.organismos) {
    for (const org of exc.organismos) { if (orgN.includes(org.toLowerCase())) return true; }
  }
  if (exc.keywords) {
    for (const kw of exc.keywords) { if (matchDivKw(textoCompleto, kw)) return true; }
  }
  if (exc.combinados) {
    for (const combo of exc.combinados) {
      if (combo.todas.every(k => matchDivKw(textoCompleto, k))) return true;
    }
  }
  return false;
}

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
  if (kwNorm.length <= 4) return new RegExp(`(?<![a-z])${kwNorm}(?![a-z])`).test(tNorm);
  return kwNorm.split(/\s+/).filter(t=>t.length>=3).every(t=>tNorm.includes(stemDiv(t)));
}

function clasificarDivisiones(titulo, codigoRegion, organismo) {
  const ORDEN_CLASIFICACION = ["ito","medioambiente","energia","mineria","zonasur","civil","infra"];
  const divisiones = [];
  const divsById = Object.fromEntries(DIVISIONES_LEN.map(d => [d.id, d]));
  for (const id of ORDEN_CLASIFICACION) {
    const div = divsById[id];
    if (!div) continue;
    if (div.activa === false) continue;
    const matchTec = div.keywords.some(kw => matchDivKw(titulo, kw));
    if (!matchTec) continue;
    if (div.id === "zonasur" && codigoRegion && !CODIGOS_ZONA_SUR.has(codigoRegion)) continue;
    if (aplicaExclusiones(div, organismo, titulo)) continue;
    divisiones.push({ id: div.id, label: div.label, icon: div.icon, color: div.color });
  }
  return divisiones;
}

const MOP_A_DIVISION = {
  "1.1": "civil", "1.2": "civil", "1.3": "civil", "2.2": "civil",
  "3.1": "ito", "3.2": "ito", "3.3": "ito", "3.6": "ito",
  "3.7": "zonasur",
  "4.1": "civil", "4.2": "civil", "4.3": "zonasur",
  "4.4": "energia", "4.5": "civil", "4.6": "civil",
  "4.7": "energia", "4.8": "zonasur", "4.10": "infra",
  "7.1": "ito", "7.4": "ito", "7.8": "ito",
  "8.3": "ito", "8.5": "ito", "8.6": "ito",
  "9.1": "medioambiente"
};

function sugerirDivision(titulo, especialidadesMOP, codigoRegion, organismo) {
  const porKeywords = clasificarDivisiones(titulo || "", codigoRegion, organismo || "");
  const conteoMOP = {};
  for (const esp of (especialidadesMOP || [])) {
    let div = MOP_A_DIVISION[esp.codigo];
    if (esp.codigo === "4.9") div = CODIGOS_ZONA_SUR.has(String(codigoRegion)) ? "zonasur" : "infra";
    if (div) conteoMOP[div] = (conteoMOP[div] || 0) + 1;
  }
  const divsActivas = new Set(DIVISIONES_LEN.filter(d => d.activa !== false).map(d => d.id));
  const conteoMOPActivo = Object.fromEntries(Object.entries(conteoMOP).filter(([d]) => divsActivas.has(d)));
  const divPorMOP = Object.entries(conteoMOPActivo).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
  if (divPorMOP && porKeywords.some(d => d.id === divPorMOP)) return divPorMOP;
  if (divPorMOP) return divPorMOP;
  if (porKeywords.length > 0) return porKeywords[0].id;
  return null;
}

const LEN_REGISTRO_MOP = {
  certificado: "264614",
  rut: "83.665.200-2",
  // vigente_hasta: null porque la fecha de caducidad del certificado solo es
  // relevante al momento de postular (LEN renueva antes de cada postulación).
  // No implica pérdida de categorías. Solo actualizar este campo si LEN
  // efectivamente gana o pierde una categoría.
  vigente_hasta: null,
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
  // El chequeo de vigencia de fecha fue eliminado: las categorías de LEN
  // se consideran permanentes hasta que se actualicen manualmente.
  // La fecha del certificado solo importa al momento de postular.
  const fallas = [];
  for (const req of (requisitos || [])) {
    const rankLEN = LEN_REGISTRO_MOP.especialidades[req.codigo];
    const rankReq = RANK_CATEGORIA[(req.categoria || "").toLowerCase().trim()];
    if (rankLEN === undefined) fallas.push(`Falta especialidad ${req.codigo} (${req.descripcion || ""})`);
    else if (rankReq && rankLEN > rankReq) fallas.push(`${req.codigo}: requiere ${req.categoria}, LEN tiene ${NOMBRE_CATEGORIA[rankLEN]}`);
  }
  return {
    califica: fallas.length === 0,
    fallas,
    diasVigencia: null,
    avisoVigencia: null
  };
}

function extraerEspecialidadesMOP(html) {
  if (!html) return [];
  const tablaMatch = html.match(/<table[^>]*id\s*=\s*["']tblEspecialidades["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tablaMatch) return [];
  const tablaHTML = tablaMatch[1];
  const tbodyMatch = tablaHTML.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const filasHTML = tbodyMatch ? tbodyMatch[1] : tablaHTML;
  const filas = filasHTML.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const cleanCell = s => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const requisitos = [];
  const seen = new Set();
  for (const filaHTML of filas) {
    if (/<th[\s>]/i.test(filaHTML)) continue;
    const celdas = filaHTML.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (celdas.length < 3) continue;
    const especialidad    = cleanCell(celdas[0]);
    const subEspecialidad = cleanCell(celdas[1]);
    const categoria       = cleanCell(celdas[2]);
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

function requiereRegistroMOP(html) {
  if (!html) return false;
  const match = html.match(/<input[^>]*id\s*=\s*["']IndicadorEsMOP["'][^>]*value\s*=\s*["']([^"']*)["']/i);
  if (!match) return false;
  const v = match[1].toLowerCase().trim();
  return v === "1" || v === "true" || v === "si" || v === "sí";
}

async function obtenerEspecialidadesMOPviaAjax(codigo, cookieHeader) {
  if (!codigo || !cookieHeader) return [];
  const referer = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${codigo}`;
  const ajaxUrl = "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx/ObtenerEspecialidades";
  try {
    const r = await fetch(ajaxUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/json; charset=utf-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer, "Origin": "https://www.mercadopublico.cl",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Cookie": cookieHeader
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) { console.warn(`[ObtenerEspecialidades] WebMethod respondió ${r.status} para ${codigo}`); return []; }
    const data = await r.json();
    const items = Array.isArray(data?.d) ? data.d : [];
    const requisitos = [];
    const seen = new Set();
    for (const it of items) {
      const partes = (it.Descripcion || "").split("|").map(s => s.trim());
      if (partes.length < 3) continue;
      const especialidad    = partes[0];
      const subEspecialidad = partes[1];
      const categoria       = partes[2];
      const m = subEspecialidad.match(/^(\d{1,2}\.\d{1,2})\s+(.+?)\.?\s*$/);
      if (!m) continue;
      const codigoEspec = m[1];
      const descripcion = m[2].trim();
      if (seen.has(codigoEspec)) continue;
      seen.add(codigoEspec);
      requisitos.push({ codigo: codigoEspec, descripcion, categoria, especialidad });
    }
    return requisitos;
  } catch (e) {
    console.warn(`[ObtenerEspecialidades] Error para ${codigo}:`, e.message);
    return [];
  }
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

function formatFechaPub(str) {
  const f = formatFecha(str);
  return f === "–" ? "–" : `Fecha de Publicación: ${f}`;
}

// ── Exclusión sectorial global ────────────────────────────────────────────
const EXCLUSION_SECTORIAL = [
  "medicamento","metilfenidato","farmaceutico","cateter","dialisis",
  "dispositivo medico","dispositivos medicos",
  "insumo medico","insumos medicos","equipo medico","equipamiento medico",
  "soporte vital","quirurgico","endoscopia","protesis dental","implante coclear",
  "colchones clinicos","ventilacion mecanica",
  "hospitalizacion domiciliaria","transporte para hospitalizacion",
  "servicio de salud","atencion primaria","atencion medica",
  "hospital de carabineros","fondo hospital","ambulancia","reactivo","laboratorio clinico",
  "colaciones saludables","colaciones escolares","racion alimentaria",
  "alimentacion escolar","servicio de alimentacion","servicio de colacion",
  "comedor escolar","casino de alimentacion","catering",
  "talleres comunitarios","talleres culturales","talleres artisticos",
  "servicio de talleristas","centro cultural","actividad cultural",
  "educacion parvularia","jardin infantil","sala cuna",
  "contador auditor","auditoria contable","auditoria financiera","servicio contable",
  "toldos de proteccion solar","juegos infantiles para plazas",
  "mobiliario urbano","bancas de plaza","maquinas de ejercicio",
  "municion","armamento","gendarmeria","penitenciario",
  "servicio de vigilancia","guardia de seguridad","monitoreo de alarmas",
  "servicio de aseo","insumos de aseo","productos de limpieza",
  "desratizacion","fumigacion","control de plagas",
  "vestuario","uniforme","ropa de trabajo","calzado de seguridad",
  "suministro de combustible","bencina","lubricantes",
  "mantencion de vehiculos","lavado de vehiculos",
  "servicio de impresion","material grafico","produccion audiovisual",
  "poliza de seguro","corredor de seguros",
  "transporte escolar","transporte de pasajeros","transporte de personal",
  "soporte informatico","mantencion de impresoras","toner","licencia de software",
  "creditos de nube","infraestructura cloud","nube publica de aws","plataformas cloud",
  "evento artistico","festival","produccion de evento","evento cultural",
  "evento comunitario","espectaculo","show","concierto",
  "servicios transitorios","personal de reemplazo","dotacion transitoria",
  "cargos de reemplazo","horas de matroneria","prestaciones en caracter transitorio",
  "arriendo tractor","tractor desbrozador","arriendo de maquinaria pesada",
  "retroexcavadora en arriendo",
  "administracion enteral","apositos","curacion avanzada",
  "insumos para administracion","neuroquirurgic",
  // ── Vehículos / carrocerías / módulos (no es rubro LEN) ──
  "vehiculos de emergencia","vehiculo de emergencia",
  "carrocerias","carroceria",
  "modulos de gabinetes","gabinetes en carrocerias",
  "imagen corporativa","distribucion imagen corporativa",
  "distribucion de imagen corporativa",
  "distintivos vehiculares","distintivos para vehiculos",
  // ── Contratación de personal individual (LEN se postula como empresa, no como persona) ──
  "profesional ingeniero civil","profesional ingeniera civil",
  "contratacion de profesional","contrato a honorarios",
  "contrato de honorarios","honorarios para ingeniero",
  "servicios profesionales a honorarios"
];
function bloqueadaSectorial(titulo) {
  const t = normDiv(titulo);
  return EXCLUSION_SECTORIAL.some(ex => t.includes(ex));
}

// ── Tipos de proyecto que YA implican servicio profesional ─────────────────
// Muchas licitaciones legítimas (planes maestros, líneas de base, monografías,
// anteproyectos) NO mencionan "Estudio" ni "Diseño" en el título porque el
// TIPO DE PROYECTO es lo principal. Sin embargo, estos tipos de proyecto solo
// se ejecutan vía consultoría/estudio — no se "compran" ni se "construyen".
//
// Cuando el título contiene alguno de estos términos, omitimos el filtro de
// "servicios" del frontend (esBloqueada y bloqueadaSectorial siguen aplicando).
// Esto resuelve casos como "PLANES MAESTROS DE AGUAS LLUVIAS DE COLLIPULLI Y
// LAUTARO" que matchean keywords pero no servicios.
const TIPOS_PROYECTO_IMPLICAN_SERVICIO = [
  "plan maestro","planes maestros",
  "plan regulador","planes reguladores",
  "plan de desarrollo","plan estrategico","planes estrategicos",
  "linea de base","lineas de base",
  "monografia","monografias",
  "anteproyecto","anteproyectos",
  "proyecto de ingenieria","proyecto integral",
  "memoria de calculo","memoria tecnica",
  "evaluacion ambiental","evaluacion economica",
  "actualizacion ssr","actualizacion sanitario rural"
];
function tipoProyectoImplicito(titulo) {
  const t = normDiv(titulo);
  return TIPOS_PROYECTO_IMPLICAN_SERVICIO.some(k => t.includes(k));
}

// ── HELPER: fetch a API de MP con reintentos automáticos ──────────────────
// La API de Mercado Público es notoriamente intermitente: a veces responde
// con HTTP 200 pero `Listado` vacío sin error explícito (rate limit silencioso,
// sesión expirada, etc). Sin reintento, el agente reporta "0 resultados"
// cuando en realidad hay miles de licitaciones disponibles.
//
// Estrategia:
//   - Hasta 3 intentos por defecto
//   - Backoff exponencial: 2s → 4s → 8s
//   - Si la respuesta es HTTP OK pero Listado está vacío en los primeros 2
//     intentos, reintenta (el rate limit silencioso es la causa típica)
//   - En el intento 3 acepta vacío como "real"
//   - Si TODOS los intentos fallan con error de red o HTTP no-OK, devuelve null
//     para que el caller pueda distinguir "fallo real" de "0 legítimo"
//   - Logging estructurado con etiqueta para diagnóstico en logs de Render
async function fetchConReintentos(url, controller, etiqueta = 'mp', maxIntentos = 3) {
  let ultimoError = null;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const mpRes = await fetch(url, { signal: controller.signal });
      if (!mpRes.ok) {
        ultimoError = `HTTP ${mpRes.status}`;
        console.warn(`[${etiqueta}] intento ${intento}/${maxIntentos} → HTTP ${mpRes.status}`);
      } else {
        const data = await mpRes.json();
        const listado = Array.isArray(data?.Listado) ? data.Listado : [];
        console.log(`[${etiqueta}] intento ${intento}/${maxIntentos} → ${listado.length} licitaciones`);
        if (listado.length > 0) return listado;
        if (intento === maxIntentos) {
          console.warn(`[${etiqueta}] ⚠ Vacío después de ${maxIntentos} intentos. Aceptando como real.`);
          return [];
        }
        ultimoError = 'listado vacío silencioso';
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      ultimoError = e.message;
      console.warn(`[${etiqueta}] intento ${intento}/${maxIntentos} → error: ${e.message}`);
    }
    if (intento < maxIntentos) {
      const espera = 2000 * intento;
      await new Promise(r => setTimeout(r, espera));
    }
  }
  console.error(`[${etiqueta}] ✗ Falla definitiva tras ${maxIntentos} intentos. Último error: ${ultimoError}`);
  return null;
}

// ── Estado del proceso de clasificación IA (consultable vía /mp/clasificar-pool-ia-status)
let clasificacionIAState = {
  estado: "no_iniciado",
  ultimo_inicio: null, ultimo_fin: null,
  total_pool: 0, total_candidatas: 0,
  ya_en_cache: 0, a_clasificar: 0,
  clasificadas_hasta_ahora: 0,
  total_clasificadas: 0, total_errores: 0,
  ultimo_error: null
};

app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });
app.get("/regiones", (req, res) => res.json(REGIONES));

// ── Búsqueda Mercado Público ──────────────────────────────────────────────────
app.get("/buscar", async (req, res) => {
  const keywordsParam  = (req.query.keywords || "").trim();
  const serviciosParam = (req.query.servicios || "").trim();
  const desdeParam     = req.query.desde || "todas";
  const hastaParam     = req.query.hasta || "todas";
  if (!keywordsParam) return res.status(400).json({ error: "Parámetro keywords requerido" });
  const keywords  = keywordsParam.split(",").map(k => k.trim()).filter(Boolean);
  const servicios = serviciosParam ? serviciosParam.split(",").map(k => k.trim()).filter(Boolean) : [];
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
    const timeoutId  = setTimeout(() => controller.abort(), 120000);
    // ✦ FASE 1: usa el helper fetchConReintentos para tolerar intermitencia de API MP
    const fetchAll = async (extraParams, etiqueta) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
      return await fetchConReintentos(mpUrl, controller, `buscar:${etiqueta}`);
    };
    const [sinTipo, conSC] = await Promise.all([fetchAll("", "activas"), fetchAll("&tipo=SC", "tipoSC")]);
    clearTimeout(timeoutId);

    // Si AMBAS llamadas devolvieron null (fallo real), responder 503
    if (sinTipo === null && conSC === null) {
      return res.status(503).json({
        error: "MP_API_UNAVAILABLE",
        mensaje: "La API de Mercado Público no respondió tras 3 intentos. Intenta de nuevo en unos segundos.",
        retry: true
      });
    }
    const sinTipoArr = sinTipo || [];
    const conSCArr   = conSC   || [];
    console.log(`[buscar] TOTAL: sinTipo=${sinTipoArr.length} conSC=${conSCArr.length}`);

    const vistos = new Set();
    const licitaciones = [];
    for (const l of [...sinTipoArr, ...conSCArr]) {
      const cod = l.CodigoExterno || JSON.stringify(l);
      if (!vistos.has(cod)) { vistos.add(cod); licitaciones.push(l); }
    }
    const norm = s => (s || "").toLowerCase()
      .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
      .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
      .replace(/['''`´]/g, "").trim();
    const stem = t => t.length >= 6 ? t.slice(0, -2) : t;
    const matchesKeyword = (titulo, keyword) => {
      const tNorm = norm(titulo);
      const terms = norm(keyword).split(/\s+/).filter(t => t.length >= 3);
      if (!terms.length) return false;
      return terms.every(t => tNorm.includes(stem(t)));
    };
    const EXCLUSION = [
      "construccion de ","construcción de ","ejecucion de obras","ejecución de obras",
      "suministro de materiales","suministro e instalacion","suministro e instalación",
      "obra de construccion","obra de construcción","licitacion de obras","licitación de obras",
      "contrato de obras","compra de ","adquisicion de ","adquisición de ",
      "arriendo de ","arriendo de maquinaria","provision de ","provisión de "
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
    const filtradas = licitaciones.filter(l => {
      const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      if (esBloqueada(titulo)) return false;
      if (bloqueadaSectorial(titulo)) return false;
      const matchesTecnica = keywords.some(kw => matchesKeyword(titulo, kw));
      if (!matchesTecnica) return false;
      if (servicios.length === 0) return true;
      // ✦ Tipos de proyecto que ya implican servicio (Plan Maestro, Anteproyecto, etc.)
      // pasan sin necesidad de matchear el catálogo de servicios.
      if (tipoProyectoImplicito(titulo)) return true;
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
        fechaPublicacion: formatFechaPub(l.FechaPublicacion),
        fechaCierre:      formatFecha(l.FechaCierre),
        monto:            null,
        descripcion:      l.Descripcion || "",
        url:              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
        fuente:           "Mercado Público",
        divisiones:       clasificarDivisiones(titulo, regionExtraida?.codigo || null, "")
      };
    });
    if (codigosValidos) resultado = resultado.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
    res.json({ total: resultado.length, resultados: resultado });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ error: "Tiempo de espera agotado" });
    console.error("[buscar] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Búsqueda General MP ───
app.post("/buscar-general", async (req, res) => {
  const divisiones = req.body.divisiones || [];
  if (!divisiones.length) return res.status(400).json({ error: "Divisiones requeridas" });
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 120000);
    // ✦ FASE 1: usa el helper fetchConReintentos para tolerar intermitencia de API MP
    const fetchAll = async (extraParams, etiqueta) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
      return await fetchConReintentos(mpUrl, controller, `buscar-general:${etiqueta}`);
    };
    const [sinTipo, conSC] = await Promise.all([fetchAll("", "activas"), fetchAll("&tipo=SC", "tipoSC")]);
    clearTimeout(timeoutId);

    // Si AMBAS llamadas devolvieron null (fallo real), responder 503
    if (sinTipo === null && conSC === null) {
      return res.status(503).json({
        error: "MP_API_UNAVAILABLE",
        mensaje: "La API de Mercado Público no respondió tras 3 intentos. Intenta de nuevo en unos segundos.",
        retry: true
      });
    }
    const sinTipoArr = sinTipo || [];
    const conSCArr   = conSC   || [];
    console.log(`[buscar-general] TOTAL: sinTipo=${sinTipoArr.length} conSC=${conSCArr.length}`);

    const vistos = new Set();
    const pool   = [];
    for (const l of [...sinTipoArr, ...conSCArr]) {
      const cod = l.CodigoExterno || JSON.stringify(l);
      if (!vistos.has(cod)) { vistos.add(cod); pool.push(l); }
    }

    // ── Enriquecimiento con cache persistente Supabase ────────────────────
    const esTituloGenerico = (nombre) => {
      if (!nombre) return false;
      const n = nombre.toLowerCase()
        .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
        .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
        .replace(/['''`´]/g,"").trim();
      const palabras = n.split(/\s+/).filter(Boolean).length;
      const patrones = [
        "servicio de consultoria","servicio de asesoria","consultoria especializada",
        "asesoria tecnica","proyecto de ingenieria","asistencia tecnica",
        "estudio de ingenieria","diseno de ingenieria","servicios profesionales",
        "servicios de consultoria","contratacion de servicios",
        "ingenieria de detalle","ingenieria basica"
      ];
      const matchPatron = patrones.some(p => n.includes(p));
      return matchPatron || palabras <= 4;
    };

    const genericasSinDesc = pool.filter(l =>
      esTituloGenerico(l.Nombre) && !(l.Descripcion && l.Descripcion.trim().length > 20)
    );
    console.log(`[buscar-general] Pool=${pool.length} | Genéricas sin desc=${genericasSinDesc.length}`);

    let cacheMap = new Map();
    if (genericasSinDesc.length > 0) {
      try {
        const codigosNecesarios = genericasSinDesc.map(l => l.CodigoExterno).filter(Boolean);
        const CHUNK_QRY = 500;
        for (let i = 0; i < codigosNecesarios.length; i += CHUNK_QRY) {
          const chunk = codigosNecesarios.slice(i, i + CHUNK_QRY);
          const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
          const cacheRes = await fetch(
            `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,descripcion,organismo,region,monto,comuna,fecha_publicacion,tipo_licitacion`,
            { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(12000) }
          );
          if (cacheRes.ok) {
            const rows = await cacheRes.json();
            for (const row of rows) cacheMap.set(row.codigo, row);
          }
        }
        console.log(`[buscar-general] Cache hits: ${cacheMap.size}/${genericasSinDesc.length}`);
      } catch (e) {
        console.warn(`[buscar-general] Cache lookup falló: ${e.message}`);
      }
    }

    for (const lic of genericasSinDesc) {
      const cached = cacheMap.get(lic.CodigoExterno);
      if (cached?.descripcion) {
        lic.Descripcion = cached.descripcion;
        if (cached.organismo && !lic.Comprador) {
          lic.Comprador = { NombreOrganismo: cached.organismo, RegionUnidad: cached.region, ComunaUnidad: cached.comuna };
        }
        if (cached.monto && !lic.MontoEstimado) lic.MontoEstimado = cached.monto;
        if (cached.fecha_publicacion && !lic.FechaPublicacion) lic.FechaPublicacion = cached.fecha_publicacion;
        if (cached.tipo_licitacion && !lic.Tipo) lic.Tipo = cached.tipo_licitacion;
      }
    }

    const aEnriquecer = genericasSinDesc.filter(l => !cacheMap.has(l.CodigoExterno));
    const LIMITE_POR_BUSQUEDA = 30;
    const lotePendiente = aEnriquecer.slice(0, LIMITE_POR_BUSQUEDA);
    console.log(`[buscar-general] A enriquecer ahora: ${lotePendiente.length} (pendientes totales: ${aEnriquecer.length})`);

    if (lotePendiente.length > 0) {
      const PARALELISMO = 5;
      const SLEEP_ENTRE_LOTES = 250;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const nuevasEnCache = [];

      for (let i = 0; i < lotePendiente.length; i += PARALELISMO) {
        const lote = lotePendiente.slice(i, i + PARALELISMO);
        await Promise.all(lote.map(async lic => {
          try {
            const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${lic.CodigoExterno}&ticket=${TICKET}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) return;
            const data = await r.json();
            const detalle = data.Listado?.[0];
            if (!detalle) return;
            if (detalle.Descripcion) lic.Descripcion = detalle.Descripcion;
            if (detalle.Comprador && !lic.Comprador) lic.Comprador = detalle.Comprador;
            if (detalle.MontoEstimado && !lic.MontoEstimado) lic.MontoEstimado = detalle.MontoEstimado;
            if (detalle.Fechas?.FechaPublicacion && !lic.FechaPublicacion) lic.FechaPublicacion = detalle.Fechas.FechaPublicacion;
            if (detalle.Tipo && !lic.Tipo) lic.Tipo = detalle.Tipo;
            nuevasEnCache.push({
              codigo:      lic.CodigoExterno,
              nombre:      detalle.Nombre || lic.Nombre,
              descripcion: detalle.Descripcion || "",
              organismo:   detalle.Comprador?.NombreOrganismo || null,
              region:      detalle.Comprador?.RegionUnidad || null,
              comuna:      detalle.Comprador?.ComunaUnidad || null,
              monto:       parseFloat(detalle.MontoEstimado) || null,
              fecha_publicacion: detalle.Fechas?.FechaPublicacion || null,
              tipo_licitacion:   detalle.Tipo || null,
              fetched_at:  new Date().toISOString()
            });
          } catch (e) {}
        }));
        if (i + PARALELISMO < lotePendiente.length) await sleep(SLEEP_ENTRE_LOTES);
      }

      if (nuevasEnCache.length > 0) {
        fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
          method: "POST",
          headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify(nuevasEnCache),
          signal: AbortSignal.timeout(10000)
        }).then(r => {
          if (r.ok) console.log(`[buscar-general] Cache actualizado con ${nuevasEnCache.length} nuevas entradas`);
          else console.warn(`[buscar-general] Falló guardado cache: ${r.status}`);
        }).catch(e => console.warn(`[buscar-general] Error guardando cache: ${e.message}`));
      }
    }

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
        titulo, codigo: l.CodigoExterno || "", organismo: "–",
        region: regionExtraida?.nombre || null,
        codigoRegion: regionExtraida?.codigo || null,
        estado: estadoTexto(l.CodigoEstado),
        fechaPublicacion: formatFechaPub(l.FechaPublicacion),
        fechaCierre: formatFecha(l.FechaCierre),
        monto: null, descripcion: l.Descripcion || "",
        url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
        fuente: "Mercado Público",
        divisiones: clasificarDivisiones(titulo, regionExtraida?.codigo || null, "")
      };
    };
    // ── Clasificación IA: cargar del cache para todo el pool ──────────────
    // Cuando hay clasificación IA disponible, tiene prioridad sobre keywords.
    // Si no hay (pool nuevo o IA aún no ejecutó), el sistema de keywords es el fallback.
    const iaClassMap = new Map();
    try {
      const codigosPool = pool.map(l => l.CodigoExterno).filter(Boolean);
      const CHUNK_IA = 500;
      for (let i = 0; i < codigosPool.length; i += CHUNK_IA) {
        const chunk = codigosPool.slice(i, i + CHUNK_IA);
        const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
        const iaRes = await fetch(
          `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,divisiones_ia,veredicto_ia&divisiones_ia=not.is.null`,
          { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
        );
        if (iaRes.ok) {
          for (const row of await iaRes.json()) {
            iaClassMap.set(row.codigo, {
              divisiones_ia: Array.isArray(row.divisiones_ia) ? row.divisiones_ia : [],
              veredicto_ia:  row.veredicto_ia || "⚪"
            });
          }
        }
      }
      console.log(`[buscar-general] IA cache: ${iaClassMap.size}/${codigosPool.length} licitaciones clasificadas`);
    } catch(e) {
      console.warn(`[buscar-general] IA cache lookup falló (usando keywords como fallback): ${e.message}`);
    }

    const resultados = {};    for (const div of divisiones) {
      const { id, keywords, servicios, regionDesde, regionHasta } = div;
      if (!keywords?.length) { resultados[id] = []; continue; }
      let codigosValidos = null;
      if (regionDesde !== "todas" || regionHasta !== "todas") {
        const idxD = regionDesde === "todas" ? 0 : REGIONES.findIndex(r => r.codigo === regionDesde);
        const idxH = regionHasta === "todas" ? REGIONES.length-1 : REGIONES.findIndex(r => r.codigo === regionHasta);
        const s = Math.min(idxD<0?0:idxD, idxH<0?REGIONES.length-1:idxH);
        const e = Math.max(idxD<0?0:idxD, idxH<0?REGIONES.length-1:idxH);
        codigosValidos = new Set(REGIONES.slice(s,e+1).map(r => r.codigo));
      }
      const divConfig = DIVISIONES_LEN.find(d => d.id === id);

      const filtradas = pool.filter(l => {
        const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
        if (esBloqueada(titulo)) return false;
        if (bloqueadaSectorial(titulo)) return false;

        // ✦ PRIORIDAD: clasificación IA cuando está disponible en cache
        const iaClass = iaClassMap.get(l.CodigoExterno);
        if (iaClass) {
          if (iaClass.veredicto_ia === "🔴") return false;
          return iaClass.divisiones_ia.includes(id);
        }

        // Fallback: sistema de keywords (cuando IA aún no clasificó)
        const matchTec = keywords.some(kw => matchKw(titulo, kw));
        if (!matchTec) return false;
        // ✦ Tipos de proyecto que ya implican servicio (Plan Maestro, Anteproyecto, etc.)
        if (servicios?.length && !tipoProyectoImplicito(titulo) && !servicios.some(s => matchKw(titulo, s))) return false;
        if (divConfig && aplicaExclusiones(divConfig, l.Comprador?.NombreOrganismo || "", titulo)) return false;
        const DIVISIONES_ESTRICTAS = new Set(["ito","mineria","energia"]);
        const regionClasif = extraerRegionDeTexto(titulo);
        const clasificacion = clasificarDivisiones(titulo, regionClasif?.codigo || null, l.Comprador?.NombreOrganismo || "");
        if (clasificacion.length === 0 && DIVISIONES_ESTRICTAS.has(id)) return false;
        if (clasificacion.length > 0 && !clasificacion.some(d => d.id === id)) return false;
        return true;
      });
      let mapped = filtradas.map(mapItem);
      if (codigosValidos) mapped = mapped.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
      const seen = new Set();
      resultados[id] = mapped.filter(r => {
        const k = norm(r.titulo);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }

    // ── Enriquecimiento POST-FILTRO ────────────────────────────────────
    try {
      const codigosSinFecha = new Set();
      for (const divId in resultados) {
        for (const item of resultados[divId]) {
          if (!item.fechaPublicacion || item.fechaPublicacion === "–") {
            if (item.codigo) codigosSinFecha.add(item.codigo);
          }
        }
      }

      if (codigosSinFecha.size > 0) {
        const codigosArr = [...codigosSinFecha];
        console.log(`[buscar-general] Post-filtro: enriqueciendo ${codigosArr.length} licitaciones para fecha pub`);

        const fechasCache = new Map();
        const yaEnCache = new Set();
        try {
          const CHUNK = 200;
          for (let i = 0; i < codigosArr.length; i += CHUNK) {
            const chunk = codigosArr.slice(i, i + CHUNK);
            const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
            const r = await fetch(
              `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,descripcion,organismo,region,monto,comuna,fecha_publicacion,tipo_licitacion`,
              { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
            );
            if (r.ok) {
              for (const row of await r.json()) {
                fechasCache.set(row.codigo, row);
                if (row.fecha_publicacion) yaEnCache.add(row.codigo);
              }
            }
          }
        } catch(e) { console.warn(`[buscar-general] Post-filtro cache lookup falló: ${e.message}`); }

        const sinCache = codigosArr.filter(c => !yaEnCache.has(c));
        const PARALELISMO_POST = 5;
        const SLEEP_POST = 250;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const nuevasParaCache = [];

        for (let i = 0; i < sinCache.length; i += PARALELISMO_POST) {
          const lote = sinCache.slice(i, i + PARALELISMO_POST);
          await Promise.all(lote.map(async cod => {
            try {
              const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${cod}&ticket=${TICKET}`;
              const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
              if (!r.ok) return;
              const data = await r.json();
              const det = data.Listado?.[0];
              if (!det) return;
              const row = {
                codigo: cod,
                nombre: det.Nombre || null,
                descripcion: det.Descripcion || "",
                organismo:   det.Comprador?.NombreOrganismo || null,
                region:      det.Comprador?.RegionUnidad || null,
                comuna:      det.Comprador?.ComunaUnidad || null,
                monto:       parseFloat(det.MontoEstimado) || null,
                fecha_publicacion: det.Fechas?.FechaPublicacion || null,
                tipo_licitacion:   det.Tipo || null,
                fetched_at: new Date().toISOString()
              };
              fechasCache.set(cod, row);
              nuevasParaCache.push(row);
            } catch (e) {}
          }));
          if (i + PARALELISMO_POST < sinCache.length) await sleep(SLEEP_POST);
        }

        for (const divId in resultados) {
          for (const item of resultados[divId]) {
            const row = fechasCache.get(item.codigo);
            if (!row) continue;
            if (row.fecha_publicacion && (!item.fechaPublicacion || item.fechaPublicacion === "–")) {
              item.fechaPublicacion = formatFechaPub(row.fecha_publicacion);
            }
            if (row.organismo && item.organismo === "–") item.organismo = row.organismo;
            if (row.region && !item.region) item.region = row.region;
            if (row.monto && !item.monto) item.monto = `${Number(row.monto).toLocaleString("es-CL")} CLP`;
          }
        }

        for (const div of divisiones) {
          const { id, regionDesde, regionHasta } = div;
          if (!regionDesde || regionDesde === "todas" || !regionHasta || regionHasta === "todas") continue;
          const s = REGIONES.findIndex(r => r.codigo === String(regionDesde));
          const e = REGIONES.findIndex(r => r.codigo === String(regionHasta));
          if (s < 0 || e < 0 || s > e) continue;
          const codigosValidos = new Set(REGIONES.slice(s, e + 1).map(r => r.codigo));
          resultados[id] = (resultados[id] || []).filter(item => {
            if (item.codigoRegion) return codigosValidos.has(String(item.codigoRegion));
            if (!item.region) return true;
            const inferida = extraerRegionDeTexto(item.region);
            if (!inferida?.codigo) return true;
            item.codigoRegion = inferida.codigo;
            return codigosValidos.has(inferida.codigo);
          });
        }

        if (nuevasParaCache.length > 0) {
          fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
            method: "POST",
            headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify(nuevasParaCache),
            signal: AbortSignal.timeout(10000)
          }).then(r => {
            if (r.ok) console.log(`[buscar-general] Post-filtro: ${nuevasParaCache.length} nuevas guardadas en cache`);
          }).catch(e => console.warn(`[buscar-general] Post-filtro cache save error: ${e.message}`));
        }
      }
    } catch(e) {
      console.warn(`[buscar-general] Error en enriquecimiento post-filtro: ${e.message}`);
    }

    // ── Ordenar por fecha de publicación descendente ──────────────────
    for (const divId in resultados) {
      resultados[divId].sort((a, b) => {
        const aSinFecha = !a.fechaPublicacion || a.fechaPublicacion === "–";
        const bSinFecha = !b.fechaPublicacion || b.fechaPublicacion === "–";
        if (aSinFecha && bSinFecha) return 0;
        if (aSinFecha) return 1;
        if (bSinFecha) return -1;
        return b.fechaPublicacion.localeCompare(a.fechaPublicacion);
      });
    }

    res.json({ ok: true, resultados, total: pool.length });
  } catch(err) {
    if(err.name==="AbortError") return res.status(504).json({ error:"Tiempo de espera agotado" });
    res.status(500).json({ error: err.message });
  }
});

// ── Búsqueda por organismo específico ──────────────────────────────────────
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
    const timeoutId  = setTimeout(() => controller.abort(), 120000);
    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                  `?estado=activas&codigoOrganismo=${codigoOrganismo}&ticket=${TICKET}`;
    // ✦ FASE 1: usa helper de reintentos
    const listadoResult = await fetchConReintentos(mpUrl, controller, `buscar-organismo:${codigoOrganismo}`);
    clearTimeout(timeoutId);

    // Si falló tras todos los reintentos, responder 503
    if (listadoResult === null) {
      return res.status(503).json({
        error: "MP_API_UNAVAILABLE",
        mensaje: "La API de Mercado Público no respondió tras 3 intentos. Intenta de nuevo en unos segundos.",
        retry: true
      });
    }
    let licitaciones = listadoResult;

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
    let filtradas = licitaciones;
    if (keywords.length > 0) {
      filtradas = licitaciones.filter(l => {
        const titulo = `${l.Nombre || ""} ${l.Descripcion || ""}`;
        const matchTec = keywords.some(kw => matchesKw(titulo, kw));
        if (!matchTec) return false;
        if (servicios.length === 0) return true;
        if (tipoProyectoImplicito(titulo)) return true;
        return servicios.some(s => matchesKw(titulo, s));
      });
    }
    let resultado = filtradas.map(l => {
      const textoCompleto  = `${l.Nombre || ""} ${l.Descripcion || ""}`;
      const regionExtraida = extraerRegionDeTexto(textoCompleto);
      const titulo         = l.Nombre || "Sin título";
      return {
        titulo, codigo: l.CodigoExterno || "", organismo: "–",
        region: regionExtraida?.nombre || null,
        codigoRegion: regionExtraida?.codigo || null,
        estado: estadoTexto(l.CodigoEstado),
        fechaPublicacion: formatFechaPub(l.FechaPublicacion),
        fechaCierre: formatFecha(l.FechaCierre),
        monto: null, descripcion: l.Descripcion || "",
        url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
        fuente: "Mercado Público",
        divisiones: clasificarDivisiones(titulo, regionExtraida?.codigo || null, "")
      };
    });
    if (codigosValidos) resultado = resultado.filter(r => !r.codigoRegion || codigosValidos.has(r.codigoRegion));
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
  const BATCH = 10;
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
        const regionExtraida = extraerRegionDeTexto(regionTexto) || extraerRegionDeTexto(`${l.Nombre||""} ${l.Descripcion||""}`);
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
    const regionExtraida = extraerRegionDeTexto(regionTexto) || extraerRegionDeTexto(`${l.Nombre || ""} ${l.Descripcion || ""}`);
    res.json({
      organismo:     l.Comprador?.NombreOrganismo || "–",
      region:        regionTexto || regionExtraida?.nombre || null,
      regionOficial: regionExtraida?.oficial || null,
      monto:         l.MontoEstimado ? `$${Number(l.MontoEstimado).toLocaleString("es-CL")} CLP` : null,
      descripcion:   l.Descripcion || ""
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/detalle-raw/:codigo", async (req, res) => {
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${req.params.codigo}&ticket=${TICKET}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return res.status(r.status).json({ error: `API MP ${r.status}` });
    const data = await r.json();
    res.json(data.Listado?.[0] || { error: "No encontrada", raw: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/debug-ajax-mop/:codigo", async (req, res) => {
  const codigo = req.params.codigo;
  const base = "https://www.mercadopublico.cl";
  const referer = `${base}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${codigo}`;
  const ajaxUrl = `${base}/Procurement/Modules/RFB/DetailsAcquisition.aspx/ObtenerEspecialidades`;
  const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "es-CL,es;q=0.9",
  };
  let cookieHeader = "";
  let getStatus = null;
  try {
    const pageRes = await fetch(referer, {
      signal: AbortSignal.timeout(15000),
      headers: { ...browserHeaders, "Accept": "text/html,application/xhtml+xml" }
    });
    getStatus = pageRes.status;
    const setCookies = pageRes.headers.raw ? pageRes.headers.raw()["set-cookie"] : null;
    if (setCookies && setCookies.length) cookieHeader = setCookies.map(c => c.split(";")[0]).join("; ");
  } catch (e) { return res.status(500).json({ error: `GET inicial falló: ${e.message}` }); }
  const ajaxHeaders = {
    ...browserHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": referer, "Origin": base,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    ...(cookieHeader ? { "Cookie": cookieHeader } : {})
  };
  const payloads = [
    { nombre: "vacio", data: {} },
    { nombre: "codigo", data: { codigo } },
    { nombre: "idLicitacion", data: { idLicitacion: codigo } },
    { nombre: "id", data: { id: codigo } },
    { nombre: "codigoExterno", data: { codigoExterno: codigo } },
    { nombre: "_id", data: { _id: codigo } }
  ];
  const resultados = [];
  for (const p of payloads) {
    try {
      const r = await fetch(ajaxUrl, {
        method: "POST", headers: ajaxHeaders,
        body: JSON.stringify(p.data),
        signal: AbortSignal.timeout(10000)
      });
      const text = await r.text();
      resultados.push({
        variante: p.nombre, body_enviado: p.data,
        status: r.status, content_type: r.headers.get("content-type"),
        respuesta_primeros_800_chars: text.substring(0, 800)
      });
    } catch (e) {
      resultados.push({ variante: p.nombre, body_enviado: p.data, error: e.message });
    }
  }
  res.json({
    paso1_get_pagina: { url: referer, status: getStatus, cookies_capturadas: cookieHeader || "(ninguna)" },
    paso2_post_webmethod: { url: ajaxUrl, headers_enviados: ajaxHeaders },
    resultados_por_variante: resultados
  });
});

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
    const buscarEnHTML = (termino) => {
      const lower = html.toLowerCase();
      const t = termino.toLowerCase();
      const matches = [];
      let idx = 0;
      while ((idx = lower.indexOf(t, idx)) !== -1 && matches.length < 5) {
        const inicio = Math.max(0, idx - 80);
        const fin = Math.min(html.length, idx + termino.length + 80);
        matches.push({ posicion: idx, contexto: html.substring(inicio, fin).replace(/\s+/g, " ").trim() });
        idx += termino.length;
      }
      return { ocurrencias: matches.length, matches };
    };
    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    const scriptsRelevantes = scriptMatches
      .map(m => ({ tamaño: m[1].length, primeros300: m[1].substring(0, 300).replace(/\s+/g, " ").trim() }))
      .filter(s => s.tamaño > 1000)
      .sort((a, b) => b.tamaño - a.tamaño).slice(0, 5);
    const scriptsConTabla = scriptMatches
      .map(m => m[1])
      .filter(s => s.includes("tblEspecialidades") || s.includes("MostrarEsp") || /especialidad/i.test(s))
      .map(s => s.length > 8000 ? s.substring(0, 8000) + "...[TRUNCADO]" : s);
    const allScriptsText = scriptMatches.map(m => m[1]).join("\n");
    const urlsAjax = new Set();
    [...allScriptsText.matchAll(/url\s*:\s*['"]([^'"]+)['"]/gi)].forEach(m => urlsAjax.add(m[1]));
    [...allScriptsText.matchAll(/['"]([^'"]*\.aspx\/[A-Za-z0-9_]+)['"]/gi)].forEach(m => urlsAjax.add(m[1]));
    [...allScriptsText.matchAll(/['"]([^'"]*\.asmx\/[A-Za-z0-9_]+)['"]/gi)].forEach(m => urlsAjax.add(m[1]));
    [...allScriptsText.matchAll(/['"]([^'"]*WebService[^'"]*)['"]/gi)].forEach(m => urlsAjax.add(m[1]));
    [...allScriptsText.matchAll(/PageMethods\.([A-Za-z0-9_]+)/g)].forEach(m => urlsAjax.add("PageMethods." + m[1]));
    const inputsHidden = [...html.matchAll(/<input[^>]+type\s*=\s*["']hidden["'][^>]*>/gi)]
      .map(m => m[0].substring(0, 200))
      .filter(s => /especial|categor|mop/i.test(s)).slice(0, 10);
    const tablaMatch = html.match(/<table[^>]*id\s*=\s*["']tblEspecialidades["'][^>]*>([\s\S]*?)<\/table>/i);
    const requisitos = extraerEspecialidadesMOP(html);
    res.json({
      url, status, tamaño_html: html.length,
      busqueda_datos_esperados: {
        "4.8": buscarEnHTML("4.8"),
        "Obras Sanitarias": buscarEnHTML("Obras Sanitarias"),
        "2da": buscarEnHTML("2da"),
        "tblEspecialidades": buscarEnHTML("tblEspecialidades")
      },
      tabla_tblEspecialidades: tablaMatch ? tablaMatch[0] : null,
      requisitos_extraidos_por_extractor: requisitos,
      requiere_mop_segun_flag: requiereRegistroMOP(html),
      urls_ajax_encontradas: [...urlsAjax],
      scripts_completos_que_tocan_la_tabla: scriptsConTabla,
      scripts_grandes_que_podrian_tener_datos: scriptsRelevantes,
      inputs_hidden_relacionados: inputsHidden,
      primeros_500_chars: html.substring(0, 500)
    });
  } catch (err) { res.status(500).json({ error: err.message, url }); }
});

app.post("/mp/validar-registro-mop", (req, res) => {
  res.json(validarRegistroMOP(req.body.requisitos || []));
});

function extraerTextoMP(html) {
  let texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ").trim();
  return texto.length > 6000 ? texto.substring(0, 6000) + "..." : texto;
}

// ── Mercado Público — Análisis IA (OpenAI) ───────────────────────────────────
app.post("/mp/analizar", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada en Render" });

  const { item, forzarReanalisis } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  if (item.codigo && !forzarReanalisis) {
    try {
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analisis_cache?codigo=eq.${encodeURIComponent(item.codigo)}&select=analisis,creado_en`,
        { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      if (cacheRes.ok) {
        const data = await cacheRes.json();
        if (data.length > 0) {
          console.log(`[analizar] Cache HIT para ${item.codigo} (creado ${data[0].creado_en})`);
          return res.json({ analysis: data[0].analisis, cached: true, cacheCreadoEn: data[0].creado_en });
        }
      }
    } catch (e) { console.warn(`[analizar] Cache lookup falló: ${e.message}`); }
  }

  let datosAPI = {};
  if (item.codigo) {
    try {
      const apiUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${item.codigo}&ticket=${TICKET}`;
      const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const lic = data.Listado?.[0];
        if (lic) {
          datosAPI = {
            montoEstimado:           parseFloat(lic.MontoEstimado) || 0,
            organismoCompleto:       lic.Comprador?.NombreOrganismo || null,
            unidadCompradora:        lic.Comprador?.NombreUnidad   || null,
            rutOrganismo:            lic.Comprador?.RutOrganismo   || null,
            regionUnidad:            lic.Comprador?.RegionUnidad   || null,
            comuna:                  lic.Comprador?.ComunaUnidad   || null,
            descripcionMP:           lic.Descripcion               || null,
            duracionContrato:        lic.UnidadTiempoContratoLicitacion && lic.TiempoDuracionContrato
                                       ? `${lic.TiempoDuracionContrato} ${lic.UnidadTiempoContratoLicitacion}`
                                       : null,
            tipoEstimacion:          lic.MontoEstimado > 0 ? "Presupuesto disponible (oficial MP)" : null
          };
        }
      }
    } catch (e) { console.warn("[mp/analizar] No se pudo enriquecer desde API:", e.message); }
  }

  let contenidoMP = "";
  let htmlCompleto = "";
  let cookieHeader = "";
  if (item.url) {
    try {
      const mpPage = await fetch(item.url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "es-CL,es;q=0.9"
        }
      });
      if (mpPage.ok) {
        htmlCompleto = await mpPage.text();
        contenidoMP = extraerTextoMP(htmlCompleto);
        const setCookies = mpPage.headers.raw ? mpPage.headers.raw()["set-cookie"] : null;
        if (setCookies && setCookies.length) cookieHeader = setCookies.map(c => c.split(";")[0]).join("; ");
      }
    } catch (e) { console.warn("[mp/analizar] No se pudo obtener página MP:", e.message); }
  }

  let requisitosMOP = extraerEspecialidadesMOP(htmlCompleto);
  if (requisitosMOP.length === 0 && cookieHeader && item.codigo) {
    requisitosMOP = await obtenerEspecialidadesMOPviaAjax(item.codigo, cookieHeader);
  }
  const requiereMOP = requiereRegistroMOP(htmlCompleto);

  if (requisitosMOP.length > 0) {
    const validacion = validarRegistroMOP(requisitosMOP);
    if (!validacion.califica) {
      const listaReq = requisitosMOP.map(r => `   • ${r.codigo} ${r.descripcion} — Categoría ${r.categoria}`).join("\n");
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
      return res.json({ descartado: true, motivo: "No cumple Registro MOP", requisitos_mop: requisitosMOP, validacion, analysis });
    }
  } else if (requiereMOP) {
    const especialidadesLEN = Object.keys(LEN_REGISTRO_MOP.especialidades)
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map(c => `   • ${c} — ${NOMBRE_CATEGORIA[LEN_REGISTRO_MOP.especialidades[c]]}`)
      .join("\n");
    const analysis =
`🟡 LICITACIÓN PENDIENTE DE VERIFICACIÓN MANUAL

⚠️ ESTA LICITACIÓN REQUIERE REGISTRO DE CONSULTORES MOP

El indicador "IndicadorEsMOP" de Mercado Público está activado para esta licitación, lo que significa que SÍ exige especialidades del Registro MOP. Sin embargo, las especialidades específicas no pudieron extraerse automáticamente porque mercadopublico.cl las carga con JavaScript en el navegador (no vienen en el HTML que el backend descarga).

Para evitar consumir tokens de OpenAI en una licitación que LEN podría no calificar, el análisis IA fue omitido.

🔍 PASOS PARA VERIFICAR MANUALMENTE:
1. Hacer clic en "Ver en MP" arriba para abrir la licitación
2. Buscar el recuadro azul "Especialidades y categorías"
3. Comparar las especialidades requeridas contra las inscritas de LEN

📋 ESPECIALIDADES INSCRITAS DE LEN (Cert. N°${LEN_REGISTRO_MOP.certificado}):
${especialidadesLEN}

Si tras la verificación manual confirmas que LEN califica, podemos analizar la licitación más adelante (cuando se implemente el extractor de bases PDF o se identifique el endpoint AJAX de MP).`;
    return res.json({ descartado: true, motivo: "Requiere Registro MOP — verificación manual pendiente", requiere_mop: true, verificacion_pendiente: true, analysis });
  }

  let montoExtraidoHTML = 0;
  let baseEstimacionHTML = null;
  if (htmlCompleto) {
    const textoMP = htmlCompleto
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const patrones = [
      /Monto\s*Total\s*Estimado\s*[:.]?\s*\$?\s*([\d.,]+)/i,
      /Monto\s*Estimado\s*[:.]?\s*\$?\s*([\d.,]+)/i,
      /Presupuesto\s*Disponible\s*[:.]?\s*\$?\s*([\d.,]+)/i,
      /Monto\s*Referencial\s*[:.]?\s*\$?\s*([\d.,]+)/i
    ];
    for (const pat of patrones) {
      const m = textoMP.match(pat);
      if (m) {
        const numStr = m[1].replace(/\./g, "").replace(/,/g, "");
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > 0) {
          montoExtraidoHTML = num;
          const ctx = textoMP.substring(Math.max(0, m.index - 200), m.index);
          if (/Estimaci[oó]n\s*en\s*base\s*a\s*[:.]?\s*Presupuesto\s*Disponible/i.test(ctx)) baseEstimacionHTML = "Presupuesto Disponible";
          else if (/Estimaci[oó]n\s*en\s*base\s*a\s*[:.]?\s*Monto\s*Referencial/i.test(ctx)) baseEstimacionHTML = "Monto Referencial";
          else if (/Estimaci[oó]n\s*en\s*base\s*a\s*[:.]?\s*Monto\s*Estimado/i.test(ctx)) baseEstimacionHTML = "Monto Estimado";
          break;
        }
      }
    }
  }
  const montoFinal = datosAPI.montoEstimado > 0 ? datosAPI.montoEstimado : montoExtraidoHTML;
  const fuenteMonto = datosAPI.montoEstimado > 0
    ? `API ChileCompra (${datosAPI.tipoEstimacion})`
    : montoExtraidoHTML > 0
      ? `HTML del sitio MP${baseEstimacionHTML ? ` (${baseEstimacionHTML})` : ""}`
      : null;

  const textoParaClasif = [
    item.titulo || "", item.organismo || "", item.region || "", contenidoMP || ""
  ].filter(Boolean).join(" | ").substring(0, 6000);
  let codigoRegionAnalizar = item.codigoRegion || null;
  if (!codigoRegionAnalizar && item.region) {
    const r = REGIONES.find(reg => item.region.toLowerCase().includes(reg.oficial));
    if (r) codigoRegionAnalizar = r.codigo;
  }
  const divisionPreCalc = sugerirDivision(textoParaClasif, requisitosMOP, codigoRegionAnalizar, item.organismo || "");
  const divisionPreCalcLabel = divisionPreCalc
    ? (DIVISIONES_LEN.find(d => d.id === divisionPreCalc)?.label || divisionPreCalc)
    : "Sin clasificar (GPT debe sugerir)";

  const contenidoExtra = contenidoMP
    ? `\n\nCONTENIDO COMPLETO DE LA PÁGINA DE MERCADO PÚBLICO:\n${contenidoMP}`
    : "\n\n(No se pudo obtener el contenido de la página de Mercado Público. Analiza solo con los metadatos disponibles.)";

  const requisitosTexto = requisitosMOP.length
    ? `\n\nREGISTRO MOP — VERIFICACIÓN PREVIA: Esta licitación exige ${requisitosMOP.map(r => `${r.codigo} ${r.descripcion} (${r.categoria})`).join(", ")}. LEN cumple con todos estos requisitos según el certificado vigente N°${LEN_REGISTRO_MOP.certificado}.`
    : "";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `Eres un experto en análisis de licitaciones públicas chilenas para LEN Ingeniería (LEN & Asociados Ingenieros Consultores Ltda.), consultora de ingeniería multidisciplinaria fundada en 1974, con más de 250 colaboradores y presencia en todo Chile.

PERFIL DE LA EMPRESA:
- Es consultora, NO constructora. Realiza estudios, diseños, inspecciones técnicas (ITO) y asesorías de ingeniería.
- Divisiones reales (7): Zona Sur (regiones VII a XII, oficina Concepción), Infraestructura de Transporte (centro/norte), ITO (Santiago, opera nacional), Medio Ambiente y Territorio, Energía (ERNC), Proyectos Civiles (centro/norte), Minería (en etapa de entrada).
- Zona de operación principal: Maule → Magallanes para Zona Sur; resto del país para las demás divisiones.
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

REGLAS DE ASIGNACIÓN DE DIVISIÓN LEN (alineadas con las 7 divisiones reales):

REGLA REGIONAL CRÍTICA:
- ZONA SUR opera desde Maule (VII) hasta Magallanes (XII), incluyendo Ñuble (XVI), Biobío (VIII), La Araucanía (IX), Los Ríos (XIV), Los Lagos (X), Aysén (XI).
- Si la licitación está en cualquiera de esas regiones Y el alcance técnico calza con Zona Sur, va a ZONA SUR (no a otra división de la misma especialidad técnica).
- Si la licitación está fuera de esas regiones, va a la división correspondiente del centro/norte (Infraestructura de Transporte / Proyectos Civiles).

ALCANCES POR DIVISIÓN:
- ZONA SUR (regiones VII a XII): cualquier obra civil/hidráulica/sanitaria/vial dentro de su zona geográfica. Incluye: puentes, caminos, vial, diseño geométrico, hidráulica, hidrología, APR, drenaje, aguas lluvias, cauces, cuencas, inundaciones, saneamiento, alcantarillado, agua potable, obras civiles.
- INFRAESTRUCTURA DE TRANSPORTE (regiones I a VI + Metropolitana): proyectos viales, puentes, caminos, conservación vial, obras portuarias en zona centro/norte. Si el proyecto vial está en zona sur, va a Zona Sur.
- ITO (oficina Santiago, opera nacionalmente): inspección técnica de obras, supervisión, fiscalización, contraparte técnica.
- MEDIO AMBIENTE Y TERRITORIO: SEIA, declaraciones e impacto ambiental, monitoreos ambientales, estudios territoriales.
- ENERGÍA: ERNC, fotovoltaico, eólico, hidrógeno verde, BESS, eficiencia energética, electromovilidad.
- PROYECTOS CIVILES (regiones I a VI + Metropolitana): obras civiles generales sin alcance vial/hidráulico/sanitario claro. Estructural, paralelismos, atraviesos, urbanización en zona centro/norte.
- MINERÍA: licitaciones mineras (CODELCO, ENAMI, mineras privadas) o atraviesos en faenas mineras.

INSTRUCCIÓN ANTI-ERROR FRECUENTE:
- NO sugieras "Obras Hidráulicas y Riego" — esa división no existe; lo hidráulico en zona sur va a Zona Sur, lo hidráulico en centro/norte va a Proyectos Civiles.
- NO sugieras "Infraestructura de Transporte" para una licitación de puentes/caminos/vial en regiones del sur — eso va a Zona Sur.
- En la sección "EVALUACIÓN DE FACTIBILIDAD", al evaluar el criterio "Región", aplicá los rangos geográficos de la división seleccionada. Si la división es Zona Sur y la licitación está entre Maule y Magallanes, la región está DENTRO del área de operación (2/2). NO penalices por estar en Magallanes o Los Ríos cuando la división es Zona Sur.

INSTRUCCIÓN IMPORTANTE: Si tienes el contenido completo de la página de MP, úsalo para extraer requisitos reales, experiencia exigida, criterios de evaluación y plazos de ejecución. Prioriza esa información sobre los metadatos básicos.`
          },
          {
            role: "user",
            content: `Analiza esta licitación de Mercado Público para LEN Ingeniería:

Título: ${item.titulo}
Código: ${item.codigo || "N/A"}
Organismo: ${datosAPI.organismoCompleto || item.organismo || "N/A"}
${datosAPI.unidadCompradora ? `Unidad compradora: ${datosAPI.unidadCompradora}` : ""}
${datosAPI.rutOrganismo ? `RUT organismo: ${datosAPI.rutOrganismo}` : ""}
Región: ${datosAPI.regionUnidad || item.region || "No especificada"}
${datosAPI.comuna ? `Comuna: ${datosAPI.comuna}` : ""}
Estado: ${item.estado || "N/A"}
Publicación: ${item.fechaPublicacion || "N/A"}
Cierre: ${item.fechaCierre || "N/A"}
Monto estimado oficial: ${montoFinal > 0 ? `$${Number(montoFinal).toLocaleString("es-CL")} CLP — fuente: ${fuenteMonto}` : "No publicado en API ni en HTML"}
${datosAPI.duracionContrato ? `Duración del contrato (API): ${datosAPI.duracionContrato}` : ""}
División LEN ya clasificada por el sistema: ${divisionPreCalcLabel}
URL: ${item.url || ""}${requisitosTexto}${contenidoExtra}

Entrega el análisis con este formato exacto:

📋 DESCRIPCIÓN
Redacta un párrafo de 4-6 líneas que cubra:
- Contexto y antecedentes del proyecto (por qué se licita, qué problema resuelve)
- Alcance geográfico, técnico y temporal del trabajo
- Cualquier condición particular relevante (modalidad de ejecución, ubicación clave, etc.)
Usa información concreta de las bases si está disponible. Evita frases genéricas.

🧭 OBJETIVOS
Redacta un párrafo de 3-5 líneas que cubra:
- Objetivo general del estudio o servicio
- Objetivos específicos
- Entregables principales esperados

🏛️ ORGANISMO MANDANTE
Indica el nombre completo del organismo licitante, su tipo (MOP / DOH / SERVIU / Municipalidad / Universidad / GORE / etc.), su ámbito territorial, y si es un cliente recurrente o nuevo para consultoras del rubro de LEN. 2-3 líneas como máximo.

💰 MONTO ESTIMADO
PRIORIDAD 1: Si "Monto estimado oficial" tiene un valor, USA ESE MONTO sin modificar (con la fuente que indica entre paréntesis).
PRIORIDAD 2: Si "Monto estimado oficial" dice "No publicado", busca en el contenido completo del HTML alguna sección con "Monto Total Estimado", "Presupuesto Disponible", "Monto Referencial", o tabla "Montos y duración del contrato". Extraé literalmente el número que aparece y formátalo.
Formato de salida: $XXX.XXX.XXX CLP (con separadores de miles y signo $).
Indica la base de la estimación (Presupuesto Disponible / Monto Referencial / Estimado por contrato / etc.) si está disponible.
Solo usa "No especificado" si realmente no aparece en ningún lado del contenido proporcionado.

🏢 DIVISIÓN LEN
La clasificación automática del sistema indica: ${divisionPreCalcLabel}.
${divisionPreCalc 
  ? "Confirma esta clasificación si te parece correcta. Si propondrías una división diferente, indica la propuesta y la razón en 1-2 líneas."
  : "Sugiere la división de LEN más adecuada en base a las reglas de asignación, justificando en 1-2 líneas."
}

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

    if (item.codigo && text && !text.startsWith("No se pudo")) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/analisis_cache`, {
          method: "POST",
          headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify({ codigo: item.codigo, analisis: text, creado_en: new Date().toISOString() }),
          signal: AbortSignal.timeout(5000)
        });
        console.log(`[analizar] Análisis cacheado para ${item.codigo}`);
        await fetch(`${SUPABASE_URL}/rest/v1/licitaciones?codigo=eq.${encodeURIComponent(item.codigo)}`, {
          method: "PATCH",
          headers: SUPABASE_HEADERS,
          body: JSON.stringify({ analisis_ia_completo: text }),
          signal: AbortSignal.timeout(5000)
        });
      } catch (e) { console.warn(`[analizar] No se pudo cachear ${item.codigo}: ${e.message}`); }
    }

    res.json({
      analysis: text,
      cached: false,
      divisionPreCalc,
      divisionPreCalcLabel
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Guardar licitación en Gestor ──────────────────────────────────────────
app.post("/mp/guardar-gestor", async (req, res) => {
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "item requerido" });

  const parsearFecha = (str) => {
    if (!str || str === "–") return null;
    const p = str.split(/[-\/]/);
    if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
    if (p.length === 3 && p[0].length === 4) return str.substring(0, 10);
    return null;
  };
  const stepsInit = {};
  for (let i = 0; i < 14; i++) {
    stepsInit[i] = { done: false, notes: "", days: [1,2,2,2,1,1,1,2,2,1,2,5,2,1][i] };
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  const datosExtra = {};
  let nombreCompletoMP = "";
  let descripcionMP    = "";
  if (item.codigo) {
    try {
      const apiUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${item.codigo}&ticket=${TICKET}`;
      const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const lic = data.Listado?.[0];
        if (lic) {
          datosExtra.fecha_publicacion           = (lic.Fechas?.FechaPublicacion || "").substring(0, 10) || null;
          datosExtra.fecha_adjudicacion_estimada = lic.Fechas?.FechaEstimadaAdjudicacion || null;
          datosExtra.monto_estimado              = parseFloat(lic.MontoEstimado) || null;
          datosExtra.region                      = lic.Comprador?.RegionUnidad || null;
          nombreCompletoMP                       = lic.Nombre || "";
          descripcionMP                          = lic.Descripcion || "";
        }
      }
    } catch (e) { console.warn("[guardar-gestor] No se pudo enriquecer desde API:", e.message); }
  }

  let especialidadesMOP = Array.isArray(item.especialidadesMOP) ? item.especialidadesMOP : [];
  if (especialidadesMOP.length === 0 && item.url && item.codigo) {
    try {
      const mpPage = await fetch(item.url, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });
      if (mpPage.ok) {
        const setCookies = mpPage.headers.raw ? mpPage.headers.raw()["set-cookie"] : null;
        const cookieHeader = setCookies ? setCookies.map(c => c.split(";")[0]).join("; ") : "";
        if (cookieHeader) especialidadesMOP = await obtenerEspecialidadesMOPviaAjax(item.codigo, cookieHeader);
      }
    } catch (e) { console.warn("[guardar-gestor] No se pudieron extraer especialidades MOP:", e.message); }
  }

  const VALID_DIV_IDS = new Set(DIVISIONES_LEN.map(d => d.id));
  let divisionSugerida;

  if (item.divisionPreCalc && VALID_DIV_IDS.has(item.divisionPreCalc)) {
    divisionSugerida = item.divisionPreCalc;
    console.log(`[guardar-gestor] División heredada de /mp/analizar: ${divisionSugerida}`);
  } else {
    let codigoRegion = item.codigoRegion || null;
    if (!codigoRegion && datosExtra.region) {
      const r = REGIONES.find(reg => datosExtra.region.toLowerCase().includes(reg.oficial));
      if (r) codigoRegion = r.codigo;
    }
    const textoEnriquecido = [
      item.titulo || "", nombreCompletoMP, descripcionMP,
      item.descripcion || "", item.objetivos || ""
    ].filter(Boolean).join(" | ");
    divisionSugerida = sugerirDivision(textoEnriquecido, especialidadesMOP, codigoRegion, item.organismo || "");
    console.log(`[guardar-gestor] División calculada localmente: ${divisionSugerida || 'null'}`);
  }

  const payload = {
    id:           uid(),
    nombre:       item.titulo || "Sin título",
    codigo:       item.codigo || "No Indica",
    mandante:     item.organismo || "–",
    fecha_cierre: parsearFecha(item.fechaCierre),
    responsable:  "Ginés Agurto / Karina Montecinos",
    steps_json:   stepsInit,
    division_sugerida:        divisionSugerida,
    division_len:             divisionSugerida,
    estado_proceso:           "Detectada",
    especialidades_mop_json:  especialidadesMOP,
    descripcion:              item.descripcion || null,
    objetivos:                item.objetivos || null,
    url:                      item.url || null,
    fecha_publicacion:        datosExtra.fecha_publicacion || null,
    fecha_adjudicacion_estimada: datosExtra.fecha_adjudicacion_estimada || null,
    monto_estimado:           datosExtra.monto_estimado || null,
    region:                   datosExtra.region || null,
    analisis_ia_completo:     item.analysis || null
  };

  if (!payload.analisis_ia_completo && item.codigo) {
    try {
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/analisis_cache?codigo=eq.${encodeURIComponent(item.codigo)}&select=analisis`,
        { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(5000) }
      );
      if (cacheRes.ok) {
        const data = await cacheRes.json();
        if (data.length > 0) {
          payload.analisis_ia_completo = data[0].analisis;
          console.log(`[guardar-gestor] Análisis recuperado del cache para ${item.codigo}`);
        }
      }
    } catch (e) { console.warn(`[guardar-gestor] No se pudo recuperar análisis cache: ${e.message}`); }
  }

  try {
    if (item.codigo) {
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/licitaciones?codigo=eq.${encodeURIComponent(item.codigo)}&select=id`,
        { headers: SUPABASE_HEADERS }
      );
      const existing = await checkRes.json();
      if (existing.length > 0) {
        return res.json({ ok: false, mensaje: "La licitación ya existe en el gestor", id: existing[0].id });
      }
    }
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/licitaciones`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(payload)
    });
    if (!insertRes.ok) {
      const err = await insertRes.text();
      return res.status(502).json({ error: `Supabase respondió ${insertRes.status}: ${err.substring(0, 300)}` });
    }
    const data = await insertRes.json();
    res.json({
      ok: true,
      mensaje: "Licitación guardada en el gestor",
      id: data[0]?.id,
      division_sugerida: divisionSugerida,
      especialidades_mop: especialidadesMOP
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Analizar Bases de Licitación (ZIP → Excel) ────────────────────────────────
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }
}).single("archivo");

async function extraerTextoPDF(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    const avgChars = data.numpages > 0 ? data.text.length / data.numpages : 0;
    return { texto: data.text.substring(0, 40000), paginas: data.numpages, escaneado: avgChars < 50, ok: true };
  } catch(e) { return { texto: "", paginas: 0, escaneado: true, ok: false, error: e.message }; }
}

function esDocumentoGenerico(nombre) {
  const lower = nombre.toLowerCase();
  return lower.includes('sso') || lower.includes('seguridad') ||
         lower.includes('salud') || lower.includes('reglamento') ||
         lower.includes('eeg') || lower.includes('estandar') || lower.includes('standard');
}

app.post("/mp/analizar-bases", (req, res) => {
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
    const textosRelevantes  = [];
    const textosGenericos   = [];
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
            nombre, tipo: resultado.escaneado ? "Escaneado" : "Texto",
            paginas: resultado.paginas,
            estado: resultado.ok ? (resultado.escaneado ? "⚠️ Escaneado" : "✅ Procesado") : "❌ Error",
            observacion: resultado.escaneado ? "Revisar manualmente" : (resultado.error || "")
          });
          if (resultado.escaneado) escaneadosCount++;
          if (resultado.texto.trim()) {
            const bloque = `=== ${nombre} ===\n${resultado.texto}`;
            if (esDocumentoGenerico(nombre)) textosGenericos.push(bloque);
            else textosRelevantes.push(bloque);
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
      const LIMITE_TOTAL = 80000;
      let textoTotal = textosRelevantes.join("\n\n");
      if (textoTotal.length < LIMITE_TOTAL && textosGenericos.length) {
        const espacio = LIMITE_TOTAL - textoTotal.length;
        textoTotal += "\n\n" + textosGenericos.join("\n\n").substring(0, espacio);
      }
      textoTotal = textoTotal.substring(0, LIMITE_TOTAL);

      const FRAG = Math.floor(textoTotal.length / 3);
      const textoInicio = textoTotal.substring(0, FRAG * 2);
      const textoMedio  = textoTotal.substring(FRAG, FRAG * 3);
      const textoFinal  = textoTotal.substring(FRAG * 2);

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

      const ws1 = wb.addWorksheet("Resumen General");
      ws1.columns = [{ width:35 },{ width:75 }];
      const tituloExcel = (id.nombre || metadata.titulo || "LICITACIÓN").toUpperCase();
      addTitle(ws1, tituloExcel, 2);
      addTitle(ws1, (id.mandante || metadata.organismo || "").toUpperCase(), 2);
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
      if (analisis.puntos_criticos?.length) {
        addSec(ws1, "⚠ PUNTOS CRÍTICOS ANTES DE DECIDIR PARTICIPAR", 2);
        analisis.puntos_criticos.forEach((p, i) => {
          const bg = p.indicador?.includes("🟢") ? "F0FDF4" : p.indicador?.includes("🟡") ? "FFFBEB" : p.indicador?.includes("🔴") ? "FEF2F2" : null;
          const r = addKV(ws1, `${p.indicador||""} ${p.punto||""}`, p.descripcion_detallada || p.descripcion || "", bg);
          r.height = 36;
        });
        ws1.addRow([]);
      }
      if (analisis.preguntas_sugeridas?.length && analisis.preguntas_sugeridas[0]) {
        addSec(ws1, "PREGUNTAS SUGERIDAS PARA EL FORO", 2);
        analisis.preguntas_sugeridas.forEach((q, i) => {
          const r = ws1.addRow([`${i+1}.`, q]);
          r.getCell(1).style = lblStyle();
          r.getCell(2).style = valStyle();
          r.height = 22;
        });
      }

      const ws2 = wb.addWorksheet("Calendario");
      ws2.columns = [{ width:38 },{ width:22 },{ width:55 },{ width:14 }];
      addTitle(ws2, `CALENDARIO DE LICITACIÓN — ${id.codigo_mp || metadata.codigo || ""}`, 4);
      const hc = ws2.addRow(["Hito", "Fecha / Plazo", "Observaciones", "Estado"]);
      hc.eachCell(c => { c.style = tblHdr(); }); hc.height = 18;
      (analisis.calendario || []).forEach((c, i) => {
        const bg = c.estado?.includes("✔") ? "F0FDF4" : c.estado?.includes("⚠") ? "FEF2F2" : null;
        addTableRow(ws2, [c.hito, c.fecha_plazo || c.fecha, c.observaciones, c.estado], i, bg);
      });

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

      const buf     = await wb.xlsx.writeBuffer();
      const b64     = Buffer.from(buf).toString("base64");
      const archivo = `Resumen_${(metadata.codigo||"LIC").replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`;
      const confianza = escaneadosCount===0 ? "completa" : escaneadosCount < archivosAuditoria.filter(a=>a.tipo==="Escaneado"||a.tipo==="Texto").length ? "parcial" : "fallida";

      let excelPath = null;
      if (metadata.codigo && metadata.licitacionId) {
        try {
          const storagePath = `${metadata.codigo.replace(/[^a-zA-Z0-9_-]/g, "_")}/${archivo}`;
          const upRes = await fetch(
            `${SUPABASE_URL}/storage/v1/object/bases-resumenes/${storagePath}`,
            {
              method: "POST",
              headers: {
                "Authorization": SUPABASE_HEADERS.Authorization,
                "apikey": SUPABASE_HEADERS.apikey,
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "x-upsert": "true"
              },
              body: buf,
              signal: AbortSignal.timeout(20000)
            }
          );
          if (upRes.ok) {
            excelPath = storagePath;
            console.log(`[analizar-bases] Excel subido a Storage: ${storagePath}`);
          } else {
            console.warn(`[analizar-bases] Subida a Storage falló ${upRes.status}: ${await upRes.text()}`);
          }
          await fetch(
            `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(metadata.licitacionId)}`,
            {
              method: "PATCH",
              headers: SUPABASE_HEADERS,
              body: JSON.stringify({
                resumen_bases_excel_path: excelPath,
                resumen_bases_creado_at: new Date().toISOString(),
                resumen_bases_archivos_originales: archivosAuditoria.map(a => ({
                  nombre: a.nombre, tipo: a.tipo, paginas: a.paginas, estado: a.estado
                }))
              }),
              signal: AbortSignal.timeout(8000)
            }
          );
        } catch(e) { console.warn(`[analizar-bases] No se pudo persistir: ${e.message}`); }
      }

      res.json({ ok:true, excelBase64:b64, nombreArchivo:archivo, excelPath, confianza, escaneados:escaneadosCount, totalArchivos:archivosAuditoria.length, auditoria:archivosAuditoria });
    } catch(err) {
      console.error("[analizar-bases]", err.message);
      res.status(500).json({ error: err.message });
    }
  });
});

app.get("/mp/descargar-resumen-bases/:licitacionId", async (req, res) => {
  const { licitacionId } = req.params;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(licitacionId)}&select=resumen_bases_excel_path`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const data = await r.json();
    if (!data.length || !data[0].resumen_bases_excel_path) {
      return res.status(404).json({ error: "Esta licitación aún no tiene resumen de bases generado" });
    }
    const path = data[0].resumen_bases_excel_path;
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/bases-resumenes/${path}`,
      {
        method: "POST",
        headers: SUPABASE_HEADERS,
        body: JSON.stringify({ expiresIn: 300 }),
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!signRes.ok) return res.status(502).json({ error: `Storage signing falló: ${await signRes.text()}` });
    const signed = await signRes.json();
    const fullUrl = `${SUPABASE_URL}/storage/v1${signed.signedURL || signed.signedUrl}`;
    res.json({ ok: true, url: fullUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch("/mp/actualizar-licitacion/:id", async (req, res) => {
  const id = req.params.id;
  const allowedFields = [
    "division_len", "estado_proceso", "monto_ofertado_len",
    "monto_estimado", "razon_resultado", "notas_internas",
    "responsable", "steps_json"
  ];
  const updates = {};
  for (const k of allowedFields) {
    if (k in req.body) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "Sin campos válidos para actualizar" });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SUPABASE_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(updates)
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: err.substring(0, 300) });
    }
    const data = await r.json();
    if (!data || data.length === 0) return res.status(404).json({ error: "Licitación no encontrada" });
    res.json({ ok: true, licitacion: data[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Polling automático de adjudicaciones ──────────────────────────────────────
let pollingState = {
  ultimo_inicio: null, ultimo_fin: null,
  ultimo_total: 0, ultimo_actualizadas: 0, ultimo_error: null
};

async function pollingAdjudicaciones() {
  pollingState.ultimo_inicio = new Date().toISOString();
  pollingState.ultimo_error  = null;
  try {
    const estadosActivos = ["Detectada", "En análisis", "Postulada"];
    const filtroEstados = `estado_proceso=in.(${estadosActivos.map(e => `"${e}"`).join(",")})`;
    const url = `${SUPABASE_URL}/rest/v1/licitaciones?${filtroEstados}&select=*`;
    const r = await fetch(url, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    const licitaciones = await r.json();
    const ahora = new Date();
    let totalRevisadas = 0;
    let totalActualizadas = 0;
    for (const lic of licitaciones) {
      if (lic.fecha_adjudicacion_estimada) {
        const estim = new Date(lic.fecha_adjudicacion_estimada);
        const diffMs = estim - ahora;
        const unDiaMs = 24 * 60 * 60 * 1000;
        if (diffMs > unDiaMs) continue;
      }
      totalRevisadas++;
      try {
        const apiUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${lic.codigo}&ticket=${TICKET}`;
        const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
        if (!apiRes.ok) continue;
        const data = await apiRes.json();
        const licData = data.Listado?.[0];
        if (!licData) continue;
        const updates = { ultimo_polling_at: new Date().toISOString() };
        const estadoMP = (licData.Estado || "").trim();
        if (estadoMP === "Adjudicada") {
          const items = licData.Items?.Listado || [];
          let rutAdj = null;
          let nombreAdj = null;
          let montoAdj = 0;
          for (const item of items) {
            const adj = item.Adjudicacion;
            if (!adj) continue;
            rutAdj    = rutAdj    || adj.RutProveedor    || adj.RutOferente   || null;
            nombreAdj = nombreAdj || adj.NombreProveedor || adj.NombreOferente|| null;
            const unitario = parseFloat(adj.MontoUnitario || adj.Monto || 0);
            const cantidad = parseFloat(adj.Cantidad || 1);
            if (!isNaN(unitario)) montoAdj += unitario * cantidad;
          }
          updates.adjudicatario          = nombreAdj;
          updates.adjudicatario_rut      = rutAdj;
          updates.monto_adjudicado       = montoAdj > 0 ? montoAdj : null;
          updates.fecha_adjudicacion_real = licData.Fechas?.FechaAdjudicacion || new Date().toISOString();
          if (rutAdj && normalizarRut(rutAdj) === LEN_RUT_NORMALIZADO) updates.estado_proceso = "Adjudicada";
          else updates.estado_proceso = "Perdida";
        } else if (estadoMP === "Desierta") updates.estado_proceso = "Desierta";
        else if (estadoMP === "Revocada") updates.estado_proceso = "Revocada";
        if (updates.estado_proceso) {
          const patchRes = await fetch(
            `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(lic.id)}`,
            {
              method: "PATCH", headers: SUPABASE_HEADERS,
              body: JSON.stringify(updates),
              signal: AbortSignal.timeout(10000)
            }
          );
          if (patchRes.ok) {
            totalActualizadas++;
            console.log(`[polling] ${lic.codigo} → ${updates.estado_proceso}`);
          }
        }
      } catch (e) { console.warn(`[polling] Error con ${lic.codigo}: ${e.message}`); }
    }
    pollingState.ultimo_total        = totalRevisadas;
    pollingState.ultimo_actualizadas = totalActualizadas;
    pollingState.ultimo_fin          = new Date().toISOString();
    console.log(`[polling] Revisadas=${totalRevisadas} actualizadas=${totalActualizadas}`);
  } catch (e) {
    pollingState.ultimo_error = e.message;
    pollingState.ultimo_fin   = new Date().toISOString();
    console.error("[polling] Error general:", e.message);
  }
}

const POLLING_INTERVAL_MS = 12 * 60 * 60 * 1000;

let limpiezaState = {
  ultimo_inicio: null, ultimo_fin: null,
  ultimo_revisadas: 0, ultimo_descartadas: 0, ultimo_error: null
};

async function limpiarVencidas() {
  limpiezaState.ultimo_inicio = new Date().toISOString();
  limpiezaState.ultimo_error  = null;
  try {
    const ahora = new Date();
    const hoyStr = ahora.toISOString().split("T")[0];
    const filtroEstados = `estado_proceso=in.("Detectada","En análisis")`;
    const filtroFecha   = `fecha_cierre=lt.${hoyStr}`;
    const url = `${SUPABASE_URL}/rest/v1/licitaciones?${filtroEstados}&${filtroFecha}&select=id,codigo,nombre,fecha_cierre,estado_proceso`;
    const r = await fetch(url, { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    const vencidas = await r.json();
    let totalDescartadas = 0;
    for (const lic of vencidas) {
      const diasVencida = Math.floor((ahora - new Date(lic.fecha_cierre)) / (24 * 60 * 60 * 1000));
      const sufijoTiempo = diasVencida <= 0 ? "ayer" : `hace ${diasVencida} días`;
      const motivoTexto = `Vencida sin postulación (auto-cierre, cerró ${sufijoTiempo} el ${lic.fecha_cierre}). Estado anterior: ${lic.estado_proceso}.`;
      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(lic.id)}`,
        {
          method: "PATCH", headers: SUPABASE_HEADERS,
          body: JSON.stringify({ estado_proceso: "Descartada", razon_resultado: motivoTexto }),
          signal: AbortSignal.timeout(8000)
        }
      );
      if (patchRes.ok) {
        totalDescartadas++;
        console.log(`[limpiar-vencidas] ${lic.codigo} → Descartada (cerró ${sufijoTiempo})`);
      }
    }
    limpiezaState.ultimo_revisadas   = vencidas.length;
    limpiezaState.ultimo_descartadas = totalDescartadas;
    limpiezaState.ultimo_fin         = new Date().toISOString();
    console.log(`[limpiar-vencidas] Revisadas=${vencidas.length} descartadas=${totalDescartadas}`);
    return { revisadas: vencidas.length, descartadas: totalDescartadas };
  } catch (e) {
    limpiezaState.ultimo_error = e.message;
    limpiezaState.ultimo_fin   = new Date().toISOString();
    console.error("[limpiar-vencidas] Error:", e.message);
    throw e;
  }
}

app.get("/mp/limpiar-vencidas", async (req, res) => {
  try {
    const result = await limpiarVencidas();
    res.json({ ok: true, ...result, state: limpiezaState });
  } catch (e) { res.status(500).json({ error: e.message, state: limpiezaState }); }
});

app.get("/mp/limpiar-vencidas-status", (req, res) => res.json(limpiezaState));

async function ciclo12h() {
  await limpiarVencidas().catch(e => console.warn("[ciclo12h] limpiar-vencidas falló:", e.message));
  await pollingAdjudicaciones().catch(e => console.warn("[ciclo12h] polling-adjudicaciones falló:", e.message));
}
setInterval(ciclo12h, POLLING_INTERVAL_MS);
setTimeout(ciclo12h, 60 * 1000);

app.get("/mp/polling-adjudicaciones", (req, res) => {
  pollingAdjudicaciones();
  res.json({ ok: true, mensaje: "Polling iniciado en background", state: pollingState });
});

app.get("/mp/polling-status", (req, res) => res.json(pollingState));

// ── Listar/Exportar Gestor ──────────────────────────────────────────────────
app.get("/mp/listar-gestor", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?select=*&order=created_at.desc`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const data = await r.json();
    res.json({ ok: true, total: data.length, licitaciones: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mp/codigos-gestor", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?select=codigo`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const data = await r.json();
    const codigos = data.map(l => l.codigo).filter(Boolean);
    res.json({ codigos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mp/exportar-excel", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?select=*&order=created_at.desc`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const licitaciones = await r.json();

    const wb = new ExcelJS.Workbook();
    wb.creator = "LEN Ingeniería";
    wb.created = new Date();
    const ws = wb.addWorksheet("Licitaciones");
    ws.columns = [
      { header: "Código",             key: "codigo",            width: 18 },
      { header: "Nombre",             key: "nombre",            width: 60 },
      { header: "Mandante",           key: "mandante",          width: 35 },
      { header: "Región",             key: "region",            width: 25 },
      { header: "Fecha Publicación",  key: "fecha_publicacion", width: 16 },
      { header: "Fecha Cierre",       key: "fecha_cierre",      width: 14 },
      { header: "Monto Estimado",     key: "monto_estimado",    width: 18 },
      { header: "División LEN",       key: "division_len",      width: 18 },
      { header: "Estado",             key: "estado_proceso",    width: 16 },
      { header: "Responsable",        key: "responsable",       width: 30 },
      { header: "Monto Ofertado LEN", key: "monto_ofertado_len",width: 18 },
      { header: "Adjudicatario",      key: "adjudicatario",     width: 35 },
      { header: "Monto Adjudicado",   key: "monto_adjudicado",  width: 18 },
      { header: "Razón / Resultado",  key: "razon_resultado",   width: 50 }
    ];
    ws.getRow(1).eachCell(c => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      c.alignment = { horizontal: "center", vertical: "middle" };
    });
    licitaciones.forEach(l => {
      ws.addRow({
        codigo:             l.codigo,
        nombre:             l.nombre,
        mandante:           l.mandante,
        region:             l.region,
        fecha_publicacion:  l.fecha_publicacion,
        fecha_cierre:       l.fecha_cierre,
        monto_estimado:     l.monto_estimado,
        division_len:       l.division_len,
        estado_proceso:     l.estado_proceso,
        responsable:        l.responsable,
        monto_ofertado_len: l.monto_ofertado_len,
        adjudicatario:      l.adjudicatario,
        monto_adjudicado:   l.monto_adjudicado,
        razon_resultado:    l.razon_resultado
      });
    });
    ws.eachRow((row, idx) => {
      if (idx > 1) {
        row.eachCell(c => {
          c.font = c.font || {};
          c.font.name = "Arial";
          c.font.size = 10;
          c.alignment = { vertical: "middle", wrapText: true };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" } };
        });
      }
    });
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Gestor_Licitaciones_${new Date().toISOString().split("T")[0]}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error("[exportar-excel]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Sincronizar análisis IA del cache hacia tabla licitaciones ────────────
app.post("/mp/sincronizar-analisis", async (req, res) => {
  try {
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?analisis_ia_completo=is.null&select=id,codigo`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!r1.ok) return res.status(502).json({ error: `Supabase ${r1.status}` });
    const sinAnalisis = await r1.json();
    let actualizadas = 0;
    let sinCache = 0;
    for (const lic of sinAnalisis) {
      if (!lic.codigo) continue;
      try {
        const cacheRes = await fetch(
          `${SUPABASE_URL}/rest/v1/analisis_cache?codigo=eq.${encodeURIComponent(lic.codigo)}&select=analisis`,
          { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(5000) }
        );
        if (!cacheRes.ok) continue;
        const cData = await cacheRes.json();
        if (cData.length === 0) { sinCache++; continue; }
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(lic.id)}`,
          {
            method: "PATCH",
            headers: SUPABASE_HEADERS,
            body: JSON.stringify({ analisis_ia_completo: cData[0].analisis }),
            signal: AbortSignal.timeout(5000)
          }
        );
        if (patchRes.ok) actualizadas++;
      } catch (e) { console.warn(`[sincronizar] ${lic.codigo}: ${e.message}`); }
    }
    res.json({ ok: true, total_revisadas: sinAnalisis.length, actualizadas, sin_cache_aun: sinCache });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Triaje por lotes (GPT-4o-mini) ────────────────────────────────────────
app.post("/mp/triaje", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada" });
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items requeridos (array)" });
  }
  const LOTE = 10;
  const veredictos = {};
  const sistema = `Eres un clasificador rápido de licitaciones públicas chilenas para LEN Ingeniería (consultora de ingeniería: vial, hidráulica, sanitaria, ITO, medio ambiente, energía).

Para CADA licitación entrega UN solo emoji según tu evaluación rápida:
  🟢 = participar (encaja con perfil LEN, buen monto, buena región)
  🟡 = evaluar (encaja parcialmente, requiere verificación)
  🔴 = descartar (claramente fuera de perfil o fuera de zona)
  ⚪ = sin info suficiente

Responde ÚNICAMENTE con JSON: {"veredictos": [{"codigo":"X","emoji":"🟢"}, ...]} sin markdown ni explicaciones.`;
  try {
    for (let i = 0; i < items.length; i += LOTE) {
      const lote = items.slice(i, i + LOTE);
      const userPrompt = lote.map((it, idx) =>
        `${idx + 1}. Código: ${it.codigo || "?"} | Título: ${it.titulo || ""} | Organismo: ${it.organismo || "?"} | Región: ${it.region || "?"}`
      ).join("\n");
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 500,
            messages: [
              { role: "system", content: sistema },
              { role: "user", content: userPrompt }
            ]
          }),
          signal: AbortSignal.timeout(20000)
        });
        if (!r.ok) {
          console.warn(`[triaje] OpenAI ${r.status}`);
          lote.forEach(it => { veredictos[it.codigo] = "⚪"; });
          continue;
        }
        const d = await r.json();
        const txt = d.choices?.[0]?.message?.content || "";
        const clean = txt.replace(/```json|```/g, "").trim();
        const match = clean.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : clean);
        for (const v of (parsed.veredictos || [])) {
          if (v.codigo && v.emoji) veredictos[v.codigo] = v.emoji;
        }
        for (const it of lote) {
          if (!veredictos[it.codigo]) veredictos[it.codigo] = "⚪";
        }
      } catch (e) {
        console.warn(`[triaje] Error lote ${i / LOTE + 1}: ${e.message}`);
        lote.forEach(it => { veredictos[it.codigo] = "⚪"; });
      }
    }
    res.json({ ok: true, veredictos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Reclasificar licitaciones existentes en el gestor ──────────────────────
app.post("/mp/clasificar-existentes", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/licitaciones?select=id,codigo,nombre,descripcion,mandante,region,especialidades_mop_json`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(15000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Supabase ${r.status}` });
    const todas = await r.json();
    let actualizadas = 0;
    let sinCambio = 0;
    const reporte = [];
    for (const lic of todas) {
      const texto = [lic.nombre, lic.descripcion].filter(Boolean).join(" | ");
      let codigoRegion = null;
      if (lic.region) {
        const reg = REGIONES.find(r => lic.region.toLowerCase().includes(r.oficial));
        if (reg) codigoRegion = reg.codigo;
      }
      const especialidadesMOP = Array.isArray(lic.especialidades_mop_json) ? lic.especialidades_mop_json : [];
      const nuevaDiv = sugerirDivision(texto, especialidadesMOP, codigoRegion, lic.mandante || "");
      try {
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(lic.id)}`,
          {
            method: "PATCH",
            headers: SUPABASE_HEADERS,
            body: JSON.stringify({ division_sugerida: nuevaDiv, division_len: nuevaDiv }),
            signal: AbortSignal.timeout(5000)
          }
        );
        if (patchRes.ok) {
          actualizadas++;
          reporte.push({ codigo: lic.codigo, nombre: lic.nombre, division_nueva: nuevaDiv });
        } else { sinCambio++; }
      } catch (e) {
        console.warn(`[clasificar-existentes] ${lic.codigo}: ${e.message}`);
        sinCambio++;
      }
    }
    res.json({ ok: true, total_revisadas: todas.length, actualizadas, sin_cambio: sinCambio, reporte });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Precalentar pool: enriquece licitaciones del listado MP en background ──
app.post("/mp/precalentar-pool", async (req, res) => {
  res.json({ ok: true, mensaje: "Precalentamiento iniciado en background. Revisar logs." });
  (async () => {
    try {
      const controller = new AbortController();
      const fetchAll = async (extraParams, etiqueta) => {
        const usaEstado = !extraParams.includes("tipo=SC");
        const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                      `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
        return await fetchConReintentos(mpUrl, controller, `precalentar:${etiqueta}`);
      };
      const [sinTipo, conSC] = await Promise.all([fetchAll("", "activas"), fetchAll("&tipo=SC", "tipoSC")]);
      const sinTipoArr = sinTipo || [];
      const conSCArr   = conSC   || [];
      const vistos = new Set();
      const pool = [];
      for (const l of [...sinTipoArr, ...conSCArr]) {
        const cod = l.CodigoExterno;
        if (cod && !vistos.has(cod)) { vistos.add(cod); pool.push(l); }
      }
      console.log(`[precalentar] Pool MP: ${pool.length}`);
      const codigosArr = pool.map(l => l.CodigoExterno);
      const yaEnCache = new Set();
      try {
        const CHUNK = 500;
        for (let i = 0; i < codigosArr.length; i += CHUNK) {
          const chunk = codigosArr.slice(i, i + CHUNK);
          const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo`,
            { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
          );
          if (r.ok) {
            const rows = await r.json();
            for (const row of rows) yaEnCache.add(row.codigo);
          }
        }
      } catch (e) { console.warn(`[precalentar] cache lookup falló: ${e.message}`); }
      const aFetch = pool.filter(l => !yaEnCache.has(l.CodigoExterno));
      console.log(`[precalentar] Ya en cache: ${yaEnCache.size} | Pendientes: ${aFetch.length}`);
      const PARALELISMO = 5;
      const SLEEP = 300;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let totalGuardadas = 0;
      for (let i = 0; i < aFetch.length; i += PARALELISMO) {
        const lote = aFetch.slice(i, i + PARALELISMO);
        const rows = [];
        await Promise.all(lote.map(async lic => {
          try {
            const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${lic.CodigoExterno}&ticket=${TICKET}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return;
            const data = await r.json();
            const det = data.Listado?.[0];
            if (!det) return;
            rows.push({
              codigo:      lic.CodigoExterno,
              nombre:      det.Nombre || lic.Nombre,
              descripcion: det.Descripcion || "",
              organismo:   det.Comprador?.NombreOrganismo || null,
              region:      det.Comprador?.RegionUnidad || null,
              comuna:      det.Comprador?.ComunaUnidad || null,
              monto:       parseFloat(det.MontoEstimado) || null,
              fecha_publicacion: det.Fechas?.FechaPublicacion || null,
              tipo_licitacion:   det.Tipo || null,
              fetched_at:  new Date().toISOString()
            });
          } catch (e) {}
        }));
        if (rows.length > 0) {
          try {
            const up = await fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
              method: "POST",
              headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
              body: JSON.stringify(rows),
              signal: AbortSignal.timeout(10000)
            });
            if (up.ok) totalGuardadas += rows.length;
          } catch (e) { console.warn(`[precalentar] save: ${e.message}`); }
        }
        if (i + PARALELISMO < aFetch.length) await sleep(SLEEP);
        if (i % 100 === 0) console.log(`[precalentar] Progreso: ${i}/${aFetch.length} | guardadas=${totalGuardadas}`);
      }
      console.log(`[precalentar] FIN: total guardadas en cache=${totalGuardadas}`);
    } catch (e) {
      console.error("[precalentar] Error general:", e.message);
    }
  })();
});

app.get("/mp/cache-pool-status", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/mp_pool_cache?select=codigo&limit=1`,
      { headers: { ...SUPABASE_HEADERS, "Prefer": "count=exact" }, signal: AbortSignal.timeout(5000) }
    );
    const total = r.headers.get("content-range")?.split("/")[1] || "?";
    res.json({ ok: true, total_en_cache: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Endpoint de diagnóstico para entender por qué una licitación aparece o no ─
// USO: GET /mp/debug-clasificacion/1148-2-O126
// Devuelve análisis paso a paso: pool MP, detección de región, filtros de
// exclusión, keywords matcheadas por división y veredicto final.
app.get("/mp/debug-clasificacion/:codigo", async (req, res) => {
  const codigo = req.params.codigo;
  try {
    // 1. Consultar listado activo de MP (con reintentos)
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 60000);
    const fetchListado = async (extraParams, etiqueta) => {
      const usaEstado = !extraParams.includes("tipo=SC");
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                    `?${usaEstado ? "estado=activas&" : ""}ticket=${TICKET}${extraParams}`;
      return await fetchConReintentos(mpUrl, controller, `debug:${etiqueta}`);
    };
    const [sinTipo, conSC] = await Promise.all([
      fetchListado("", "activas"),
      fetchListado("&tipo=SC", "tipoSC")
    ]);
    clearTimeout(timeoutId);
    const sinTipoArr = sinTipo || [];
    const conSCArr   = conSC   || [];
    const todos = [...sinTipoArr, ...conSCArr];
    const enListado = todos.find(l => l.CodigoExterno === codigo) || null;

    // 2. Consultar detalle directo (siempre, aunque esté en listado, para tener datos completos)
    let detalle = null;
    try {
      const detalleUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
      const dr = await fetch(detalleUrl, { signal: AbortSignal.timeout(15000) });
      if (dr.ok) {
        const dd = await dr.json();
        detalle = dd.Listado?.[0] || null;
      }
    } catch (e) {}

    if (!enListado && !detalle) {
      return res.json({
        codigo,
        veredicto: "❌ NO ENCONTRADA EN MP (ni en listado activo ni por código directo)",
        sugerencia: "Verificar si el código es correcto o si la licitación está en estado distinto (cerrada, adjudicada, suspendida)."
      });
    }

    // 3. Tomar datos para análisis
    const titulo       = enListado?.Nombre || detalle?.Nombre || "";
    const descripcion  = enListado?.Descripcion || detalle?.Descripcion || "";
    const tituloTexto  = `${titulo} ${descripcion}`.trim();
    const organismo    = detalle?.Comprador?.NombreOrganismo || "";
    const regionUnidad = detalle?.Comprador?.RegionUnidad || "";
    const estadoMP     = enListado?.CodigoEstado || detalle?.CodigoEstado || null;

    // 4. Detección de región (con misma lógica del sistema)
    const regionDetectadaTitulo = extraerRegionDeTexto(tituloTexto);
    const regionDetectadaUnidad = extraerRegionDeTexto(regionUnidad);
    const regionFinal = regionDetectadaTitulo || regionDetectadaUnidad;

    // 5. Análisis de filtros generales (mismos de /buscar-general)
    const tNorm = normDiv(tituloTexto);
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
    const exclusionesEncontradas = EXCLUSION.filter(ex => tNorm.includes(normDiv(ex)));
    const salvavidasEncontrados  = SALVAVIDAS.filter(sv => tNorm.includes(normDiv(sv)));
    const bloqueadaPorExclusion  = exclusionesEncontradas.length > 0 && salvavidasEncontrados.length === 0;
    const sectorialEncontradas   = EXCLUSION_SECTORIAL.filter(ex => tNorm.includes(ex));

    // 6. Match por keywords del backend (DIVISIONES_LEN)
    const matchesPorDivision = {};
    for (const div of DIVISIONES_LEN) {
      const kwMatch        = (div.keywords || []).filter(kw => matchDivKw(tituloTexto, kw));
      const exclusionDiv   = aplicaExclusiones(div, organismo, tituloTexto);
      const fueraDeZonaSur = div.id === "zonasur" && regionFinal?.codigo &&
                             !CODIGOS_ZONA_SUR.has(regionFinal.codigo);
      matchesPorDivision[div.id] = {
        label: div.label,
        activa: div.activa !== false,
        keywords_matcheadas: kwMatch,
        exclusiones_aplicadas: exclusionDiv,
        fuera_de_zona_geografica: fueraDeZonaSur,
        pasaria_filtro:
          div.activa !== false && kwMatch.length > 0 &&
          !exclusionDiv && !fueraDeZonaSur && !bloqueadaPorExclusion &&
          sectorialEncontradas.length === 0
      };
    }

    // 7. clasificarDivisiones final (mismo que el sistema usa)
    const clasificacionFinal = clasificarDivisiones(
      tituloTexto,
      regionFinal?.codigo || null,
      organismo
    );

    // 8. Veredicto
    let veredicto;
    if (!enListado && detalle) {
      veredicto = `⚠️ EXISTE EN MP (CodigoEstado=${estadoMP}) PERO NO APARECE EN LISTADO 'activas' — posiblemente en estado distinto a Publicada`;
    } else if (bloqueadaPorExclusion) {
      veredicto = `🚫 BLOQUEADA POR EXCLUSION (construcción/suministro). Términos: ${exclusionesEncontradas.join(", ")}. Sin salvavidas.`;
    } else if (sectorialEncontradas.length > 0) {
      veredicto = `🚫 BLOQUEADA SECTORIAL. Términos: ${sectorialEncontradas.join(", ")}`;
    } else if (clasificacionFinal.length === 0) {
      veredicto = `⚠️ NO CLASIFICA EN NINGUNA DIVISIÓN LEN (no matchea keywords de ninguna división activa, o queda fuera de zona)`;
    } else {
      veredicto = `✅ DEBERÍA APARECER EN: ${clasificacionFinal.map(d => d.label).join(", ")}`;
    }

    res.json({
      codigo,
      titulo,
      descripcion: descripcion?.substring(0, 400) || null,
      organismo,
      region_unidad_api: regionUnidad,
      estado_mp: estadoMP,
      esta_en_listado_mp_activas: !!enListado,
      total_licitaciones_en_pool: todos.length,
      detalle_disponible_por_codigo_directo: !!detalle,
      deteccion_region: {
        en_titulo_descripcion: regionDetectadaTitulo,
        en_region_unidad: regionDetectadaUnidad,
        final_usada: regionFinal
      },
      filtros_generales: {
        bloqueada_por_construccion: {
          resultado: bloqueadaPorExclusion,
          exclusiones_encontradas: exclusionesEncontradas,
          salvavidas_encontrados: salvavidasEncontrados
        },
        bloqueada_sectorial: {
          resultado: sectorialEncontradas.length > 0,
          terminos_encontrados: sectorialEncontradas
        }
      },
      matches_por_division: matchesPorDivision,
      clasificacion_final_sistema: clasificacionFinal,
      veredicto
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Clasificación IA del pool completo con GPT-4o-mini ────────────────────────
// Trae el pool de MP, filtra exclusiones obvias, y clasifica con IA las
// candidatas que no están en cache o cuya clasificación tiene > 12h.
// Guarda resultado en mp_pool_cache (columnas divisiones_ia, veredicto_ia, razon_ia).
// Diseñado para ejecutarse desde GitHub Actions 2 veces al día.
// Devuelve respuesta INMEDIATA y trabaja en background para tolerar free tier Render.
app.post("/mp/clasificar-pool-ia", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada" });

  clasificacionIAState.ultimo_inicio = new Date().toISOString();
  clasificacionIAState.estado        = "iniciando";
  clasificacionIAState.ultimo_error  = null;

  res.json({ ok: true, mensaje: "Clasificación IA iniciada en background. Consultar /mp/clasificar-pool-ia-status para progreso.", state: clasificacionIAState });

  (async () => {
    try {
      // 1. Traer pool MP
      clasificacionIAState.estado = "trayendo_pool";
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 120000);
      const [sinTipo, conSC] = await Promise.all([
        fetchConReintentos(`https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`, controller, "clasif-ia:activas"),
        fetchConReintentos(`https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?ticket=${TICKET}&tipo=SC`,        controller, "clasif-ia:tipoSC")
      ]);
      clearTimeout(timeoutId);

      if (!sinTipo && !conSC) {
        clasificacionIAState.estado = "error";
        clasificacionIAState.ultimo_error = "API MP no respondió tras reintentos";
        return;
      }

      // 2. Deduplicar
      const vistos = new Set();
      const pool   = [];
      for (const l of [...(sinTipo || []), ...(conSC || [])]) {
        if (l.CodigoExterno && !vistos.has(l.CodigoExterno)) { vistos.add(l.CodigoExterno); pool.push(l); }
      }
      clasificacionIAState.total_pool = pool.length;
      console.log(`[clasif-ia] Pool: ${pool.length}`);

      // 3. Pre-filtro obvio → candidatas
      // esBloqueada está definida localmente en los otros endpoints, así que
      // replicamos la lógica inline para este contexto.
      clasificacionIAState.estado = "filtrando";
      const normIA  = s => (s || "").toLowerCase()
        .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
        .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
        .replace(/['''`´]/g,"").trim();
      const EXCL_IA = ["construccion de ","ejecucion de obras","suministro de materiales",
                       "suministro e instalacion","obra de construccion","licitacion de obras",
                       "contrato de obras","compra de ","adquisicion de ","arriendo de ","provision de "];
      const SALV_IA = ["inspeccion","supervision","asesoria","estudio","consultoria",
                       "contraparte","auditoria","diseño","proyecto de ingenieria","ito"];
      const esBloqueadaIA = titulo => {
        const t = normIA(titulo);
        const tieneExcl = EXCL_IA.some(ex => t.includes(ex));
        if (!tieneExcl) return false;
        return !SALV_IA.some(sv => t.includes(sv));
      };
      const candidatas = pool.filter(l => {
        const t = `${l.Nombre || ""} ${l.Descripcion || ""}`;
        return !esBloqueadaIA(t) && !bloqueadaSectorial(t);
      });
      clasificacionIAState.total_candidatas = candidatas.length;
      console.log(`[clasif-ia] Candidatas: ${candidatas.length}`);

      // 4. Verificar cuáles ya tienen clasificación IA vigente (< 12h)
      clasificacionIAState.estado = "verificando_cache";
      const yaClasificadas = new Set();
      const VALIDEZ_IA_MS  = 12 * 60 * 60 * 1000;
      const ahora          = new Date();
      try {
        const codigos = candidatas.map(l => l.CodigoExterno).filter(Boolean);
        for (let i = 0; i < codigos.length; i += 500) {
          const chunk  = codigos.slice(i, i + 500);
          const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,clasificado_ia_en&divisiones_ia=not.is.null`,
            { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
          );
          if (r.ok) {
            for (const row of await r.json()) {
              if (row.clasificado_ia_en && (ahora - new Date(row.clasificado_ia_en)) < VALIDEZ_IA_MS) {
                yaClasificadas.add(row.codigo);
              }
            }
          }
        }
      } catch(e) { console.warn(`[clasif-ia] Cache check: ${e.message}`); }

      // Limitar a 500 por ejecución para que Render free tier no se duerma
      // a mitad del proceso (~5 min de trabajo). Las siguientes ejecuciones
      // continúan automáticamente desde donde quedó gracias al cache en Supabase.
      const sinClasificarTotal = candidatas.filter(l => !yaClasificadas.has(l.CodigoExterno));
      const sinClasificar      = sinClasificarTotal.slice(0, 500);
      clasificacionIAState.ya_en_cache    = yaClasificadas.size;
      clasificacionIAState.a_clasificar   = sinClasificarTotal.length; // total real pendiente
      clasificacionIAState.en_este_lote   = sinClasificar.length;      // lo que clasifica ahora
      console.log(`[clasif-ia] Ya en cache: ${yaClasificadas.size} | Pendientes totales: ${sinClasificarTotal.length} | Este lote: ${sinClasificar.length}`);

      if (sinClasificar.length === 0) {
        clasificacionIAState.estado     = "completado";
        clasificacionIAState.ultimo_fin = new Date().toISOString();
        console.log(`[clasif-ia] Todo vigente. Nada que clasificar.`);
        return;
      }

      // 5. Enriquecer con descripciones del cache para mejor contexto
      const datosCache = new Map();
      try {
        const codigos = sinClasificar.map(l => l.CodigoExterno).filter(Boolean);
        for (let i = 0; i < codigos.length; i += 500) {
          const chunk  = codigos.slice(i, i + 500);
          const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,descripcion,organismo,region`,
            { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
          );
          if (r.ok) { for (const row of await r.json()) datosCache.set(row.codigo, row); }
        }
      } catch(e) { console.warn(`[clasif-ia] Enriquecimiento: ${e.message}`); }

      // 6. Clasificar con GPT-4o-mini por lotes de 10
      clasificacionIAState.estado = "clasificando";
      const LOTE = 10;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let totalClasificadas = 0;
      let totalErrores      = 0;

      const PROMPT_SISTEMA = `Eres clasificador de licitaciones públicas chilenas para LEN Ingeniería (consultora: diseña, estudia, inspecciona — NUNCA construye ni compra).

DIVISIONES ACTIVAS DE LEN:
zonasur — Hidráulica, hidrología, aguas lluvias, drenaje, cauces, APR, saneamiento, vial, puentes, caminos, planes maestros, seguridad vial. SOLO en regiones Maule(7), Ñuble(16), Biobío(8), Araucanía(9), Los Ríos(14), Los Lagos(10), Aysén(11), Magallanes(12).
infra — Mismo alcance técnico que zonasur PERO en norte/centro: Arica(15), Tarapacá(1), Antofagasta(2), Atacama(3), Coquimbo(4), Valparaíso(5), Metropolitana(13), O'Higgins(6). También obras portuarias y costeras.
ito — Inspección técnica, supervisión, fiscalización, AIF, asesoría a la inspección fiscal, contraparte técnica, geomensura. Opera en todo Chile.
energia — ERNC, fotovoltaico, eólico, BESS, hidrógeno verde, eficiencia energética, electromovilidad, descarbonización. Opera en todo Chile.
mineria — SOLO estudios de hidráulica, saneamiento, vial o seguridad vial dentro de faenas mineras. NO insumos ni extracción.

DESCARTAR SIEMPRE (divisiones=[]):
- Construcción/ejecución directa de obras
- Suministro, compra, arriendo de materiales o equipos
- Contratación de persona individual
- Salud, alimentación, educación, cultura, deporte, turismo, seguridad privada
- Carrocerías, vehículos, mobiliario, vestuario
- Mataderos, agroindustria, asesoría psicosocial/contable/jurídica

REGLA REGIONAL: La región donde se EJECUTA el trabajo determina zonasur vs infra.

Responde SOLO con JSON array sin texto previo ni markdown:
[{"codigo":"X","divisiones":["zonasur"],"veredicto":"🟢","razon":"breve razón"}]`;

      for (let i = 0; i < sinClasificar.length; i += LOTE) {
        const lote  = sinClasificar.slice(i, i + LOTE);
        const items = lote.map(l => {
          const c   = datosCache.get(l.CodigoExterno) || {};
          const desc = (l.Descripcion || c.descripcion || "").substring(0, 200);
          const org  = c.organismo || l.Comprador?.NombreOrganismo || "";
          const reg  = c.region    || l.Comprador?.RegionUnidad    || "";
          return [l.CodigoExterno, l.Nombre || "", desc, org, reg].filter(Boolean).join(" | ");
        }).join("\n");

        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify({
              model: "gpt-4o-mini", max_tokens: 800, temperature: 0.1,
              messages: [
                { role: "system", content: PROMPT_SISTEMA },
                { role: "user",   content: `Clasifica estas ${lote.length} licitaciones:\n${items}` }
              ]
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!r.ok) {
            console.warn(`[clasif-ia] OpenAI ${r.status} lote ${Math.ceil(i/LOTE)+1}`);
            totalErrores += lote.length;
            continue;
          }

          const d     = await r.json();
          const txt   = d.choices?.[0]?.message?.content || "[]";
          const clean = txt.replace(/```json|```/g, "").trim();
          const match = clean.match(/\[[\s\S]*\]/);
          const resultados = JSON.parse(match ? match[0] : "[]");

          // Guardar en mp_pool_cache
          const rows = resultados
            .filter(res => res.codigo)
            .map(res => ({
              codigo:            res.codigo,
              divisiones_ia:     res.divisiones || [],
              veredicto_ia:      res.veredicto  || "⚪",
              razon_ia:          res.razon       || "",
              clasificado_ia_en: new Date().toISOString()
            }));

          if (rows.length > 0) {
            await fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
              method: "POST",
              headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
              body: JSON.stringify(rows),
              signal: AbortSignal.timeout(10000)
            }).then(res => { if (res.ok) totalClasificadas += rows.length; })
              .catch(e => console.warn(`[clasif-ia] Supabase save: ${e.message}`));
          }

        } catch(e) {
          console.warn(`[clasif-ia] Error lote ${Math.ceil(i/LOTE)+1}: ${e.message}`);
          totalErrores += lote.length;
        }

        clasificacionIAState.clasificadas_hasta_ahora = totalClasificadas;
        if (i + LOTE < sinClasificar.length) await sleep(500);
        if (((i / LOTE) + 1) % 10 === 0) {
          console.log(`[clasif-ia] Progreso: ${i + LOTE}/${sinClasificar.length} | OK: ${totalClasificadas} | Err: ${totalErrores}`);
        }
      }

      clasificacionIAState.estado            = "completado";
      clasificacionIAState.ultimo_fin        = new Date().toISOString();
      clasificacionIAState.total_clasificadas = totalClasificadas;
      clasificacionIAState.total_errores      = totalErrores;
      console.log(`[clasif-ia] FIN — Clasificadas: ${totalClasificadas} | Errores: ${totalErrores}`);

    } catch(e) {
      clasificacionIAState.estado       = "error";
      clasificacionIAState.ultimo_error = e.message;
      clasificacionIAState.ultimo_fin   = new Date().toISOString();
      console.error("[clasif-ia] Error general:", e.message);
    }
  })();
});

app.get("/mp/clasificar-pool-ia-status", (req, res) => res.json(clasificacionIAState));

// ── Arranque del servidor ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor LEN-Licitaciones corriendo en puerto ${PORT}`);
  console.log(`   Helper fetchConReintentos activo (Fase 1)`);
  console.log(`   Polling automático cada ${POLLING_INTERVAL_MS / 1000 / 60 / 60} horas`);
});

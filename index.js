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
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
if (!SUPABASE_KEY) console.warn("⚠️  SUPABASE_KEY no configurada como variable de entorno en Render");
// ── Monto de Mercado Público → número entero de pesos ────────────────────
// MP entrega el monto a veces como número y a veces como texto con formato
// chileno ("849.896.000": punto de miles, coma decimal). El parseFloat que
// se usaba antes se corta en el segundo punto y devuelve 849,896 en vez de
// 849.896.000, y eso quedaba guardado así en la columna monto_estimado.
function parseMontoMP(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;

  let s = String(v).trim().replace(/[^\d.,-]/g, "");   // fuera "$", "CLP", espacios
  if (!s) return null;

  const puntos = (s.match(/\./g) || []).length;
  const comas  = (s.match(/,/g)  || []).length;

  if (puntos && comas) {
    // Tiene los dos: el último que aparece es el separador decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else                                         s = s.replace(/,/g, "");
  } else if (puntos > 1) {
    s = s.replace(/\./g, "");                          // "849.896.000" → miles
  } else if (puntos === 1) {
    // Un solo punto: es de miles si deja exactamente 3 dígitos detrás
    // ("849.896"), y decimal si no ("849.5").
    s = /\.\d{3}$/.test(s) ? s.replace(".", "") : s;
  } else if (comas === 1) {
    s = /,\d{3}$/.test(s) ? s.replace(",", "") : s.replace(",", ".");
  } else if (comas > 1) {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Mismo monto ya formateado para mostrar: "$849.896.000 CLP".
function fmtMontoMP(v, conSigno = true) {
  const n = parseMontoMP(v);
  if (n === null) return null;
  return (conSigno ? "$" : "") + n.toLocaleString("es-CL") + " CLP";
}

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
    keywords: ["vial","vias","seguridad vial","puentes","caminos","transito","pavimento","pav","diseño geometrico","prefactibilidad vial","factibilidad vial","prefactibilidad hidraulica","factibilidad hidraulica","hidraulica","hidrologia","aguas lluvias","cauces","apr","saneamiento","alcantarillado","planta de tratamiento","planta elevadora","conducciones","inundaciones","drenaje","cuencas","aguas servidas","agua potable","sanitario","ssr","agua potable rural","saneamiento rural","mejoramiento camino rural","habilitacion camino rural","electrificacion rural"],
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
        "stent cardiaco","stent coronario","medicamento","insumo medico","insumos medicos","farmaceutico",
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
    // El alcance técnico de Infraestructura es prácticamente el mismo que
    // el de Zona Sur — la única diferencia real entre ambas es la
    // cobertura geográfica: Zona Sur es 7ma región al sur, Infraestructura
    // es todo Chile. Por eso este listado incorpora las mismas keywords
    // viales/hidráulicas/sanitarias de "zonasur" (puentes, caminos,
    // hidráulica, APR, saneamiento, etc.), para que un proyecto de ese
    // mismo tipo en regiones I-VI/RM dejara de caer entre ambas divisiones
    // sin ser capturado por ninguna (caso real: "Estudio Ing Reposición
    // Puente Tilama", Región de Coquimbo — antes no calzaba con ninguna
    // keyword de infra por más que fuera un puente/vial típico de LEN).
    keywords: [
      "ingenieria de detalle","ingenieria basica","estudio de factibilidad","anteproyecto",
      "preinversion","est. preinv","ep const","ep mej","ep vial","iluminacion vial",
      "conservacion vial","infraestructura vial","ingenieria vial","transporte vial",
      "pavimento","pav","manual de carreteras","cambio climatico","proteccion costera",
      "obras portuarias","infraestructura portuaria","obras maritimas",
      // ── Mismo alcance vial/hidráulico/sanitario que Zona Sur ──
      "vial","vias","seguridad vial","puentes","caminos","transito",
      "diseño geometrico","prefactibilidad vial","factibilidad vial",
      "prefactibilidad hidraulica","factibilidad hidraulica","hidraulica","hidrologia",
      "aguas lluvias","cauces","apr","saneamiento","alcantarillado",
      "planta de tratamiento","planta elevadora","conducciones","inundaciones",
      "drenaje","cuencas","aguas servidas","agua potable","sanitario","ssr",
      "agua potable rural","saneamiento rural","mejoramiento camino rural",
      "habilitacion camino rural","electrificacion rural"
    ],
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
    activa: true,
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
      "cgm",
      // AIT = Asesoría Inspección Técnica (sigla MOP similar a AIF)
      "ait",
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

// ── Configuración de keywords para el frontend (fuente única de verdad) ────
// El frontend consulta este endpoint al cargar la página para mantenerse
// sincronizado automáticamente con las keywords del backend, en vez de
// depender de su propia copia hardcodeada que puede quedar desactualizada.
// Este endpoint es de solo lectura y no modifica ningún comportamiento
// existente — es puramente aditivo.
const SIGLAS_CONOCIDAS_DISPLAY = new Set(["aif","ssr","apr","ito","cgm","ep","ernc","bess","est.","mop","dga","seia","ei","ait"]);
function capitalizarKw(s) {
  return s.split(" ").map(w => {
    const wLimpia = w.replace(/\./g, "").toLowerCase();
    if (SIGLAS_CONOCIDAS_DISPLAY.has(wLimpia) || SIGLAS_CONOCIDAS_DISPLAY.has(w.toLowerCase())) {
      return w.toUpperCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}
app.get("/mp/keywords-config", (req, res) => {
  try {
    const config = {};
    DIVISIONES_LEN.forEach(div => {
      config[div.id] = {
        keywords: div.keywords.map(capitalizarKw),
        servicios: (div.servicios || []).map(capitalizarKw)
      };
    });
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    .replace(/['''`´]/g,"")
    // Elimina puntos: MOP escribe la misma sigla con o sin puntos de forma
    // inconsistente ("E.I." vs "EI", "EST." vs "EST"). Sin este paso, cada
    // variante con puntos requeriría un caso especial aparte.
    .replace(/\./g,"")
    .trim();
}

// ── Expansión de abreviaturas MOP ──────────────────────────────────────────
// MOP abrevia palabras comunes en los títulos de licitación de forma muy
// inconsistente ("CONSULT", "DIAG", "ELAB", "PROY", "PAV", "MEJ", etc.).
// En vez de agregar cada variante abreviada como keyword nueva cada vez que
// aparece un caso (lo cual requiere descubrirlo manualmente cada vez), se
// expande el TÍTULO a su forma completa antes de buscar coincidencias. Así,
// cualquier keyword que ya use la palabra completa ("pavimento",
// "consultoria", "mejoramiento", etc.) matchea automáticamente sin
// necesitar una variante abreviada agregada a mano.
// Solo se incluyen abreviaturas sin riesgo real de ambigüedad — se excluyen
// a propósito "est" (choca con "Este", dirección cardinal), "geom" (choca
// entre "Geométrico" y "Geomensura", especialidades distintas), "sup" (muy
// corta) y "contr" (ambigua entre Contrato/Contratación/Control).
const ABREVIATURAS_MOP = {
  "const":"construccion", "constr":"construccion", "construc":"construccion",
  "conserv":"conservacion",
  "consult":"consultoria",
  "mej":"mejoramiento",
  "diag":"diagnostico",
  "elab":"elaboracion",
  "proy":"proyecto",
  "pav":"pavimento", "pavim":"pavimentacion",
  "preinv":"preinversion",
  "habil":"habilitacion", "habilit":"habilitacion",
  "repos":"reposicion", "reposic":"reposicion",
  "ampl":"ampliacion",
  "superv":"supervision",
  "insp":"inspeccion",
  "asesor":"asesoria",
  "fisc":"fiscal",
  "serv":"servicio",
  "eval":"evaluacion",
  "anteproy":"anteproyecto",
  "ejec":"ejecucion",
  "rehab":"rehabilitacion",
  "emerg":"emergencia",
  "transp":"transporte",
  "vialid":"vialidad",
  "munic":"municipal",
  "adq":"adquisicion",
  "pte":"puente",
  "electrif":"electrificacion",
  "alcant":"alcantarillado",
  "saneam":"saneamiento",
  "hidraul":"hidraulica",
  "estruct":"estructural",
  // "FTO" = Fiscalización Técnica de Obras — sigla muy usada por SERVIU en
  // licitaciones de inspección de proyectos habitacionales (ej. "SERVICIOS
  // FTO PROYECTO CONJUNTO HABITACIONAL..."). Sin expandirla, el título
  // nunca contiene "fiscalizacion"/"obras", así que nunca calzaba con la
  // keyword de ITO ("fiscalizacion de obras") y la licitación quedaba sin
  // clasificar en ninguna división pese a ser un trabajo de ITO típico.
  "fto":"fiscalizacion tecnica de obras"
};
// Reemplaza solo palabras COMPLETAS que coincidan exactamente con una
// abreviatura conocida (nunca substrings dentro de otras palabras) — el
// texto de entrada debe estar ya normalizado con normDiv.
function expandirAbreviaturasMOP(textoNormalizado) {
  return (textoNormalizado || "").replace(/[a-z]+/g, palabra => ABREVIATURAS_MOP[palabra] || palabra);
}

// ── Tolerancia a errores de tipeo ──────────────────────────────────────────
// Mercado Público a veces publica títulos con errores de tipeo reales (ej.
// "ACTUALIKZACION" en vez de "ACTUALIZACION"). Esta función mide cuántas
// letras hay que cambiar/agregar/quitar para convertir una palabra en otra
// (distancia de Levenshtein), y se usa como ÚLTIMO recurso — solo si el
// match exacto ya falló — para palabras de 7+ letras. Las palabras cortas
// (menos de 7 letras) NUNCA usan esta tolerancia, porque ahí cualquier
// letra distinta suele cambiar el significado completo (ej. "vial" vs
// "vital" son palabras totalmente distintas, no un error de tipeo).
function distanciaEdicion(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99; // corte rápido: nunca serán similares
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i=0; i<=m; i++) dp[i][0] = i;
  for (let j=0; j<=n; j++) dp[0][j] = j;
  for (let i=1; i<=m; i++) {
    for (let j=1; j<=n; j++) {
      if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
function toleranciaMaxima(largo) {
  if (largo < 7) return 0;   // palabras cortas: exige coincidencia exacta
  if (largo <= 9) return 1;  // 7-9 letras: tolera 1 error de tipeo
  return 2;                 // 10+ letras: tolera 2 errores de tipeo
}
function apareceConTolerancia(tNorm, termino) {
  if (termino.length < 7) return false;
  const tol = toleranciaMaxima(termino.length);
  const palabras = tNorm.split(/[^a-z]+/).filter(Boolean);
  return palabras.some(p => Math.abs(p.length - termino.length) <= 2 && distanciaEdicion(p, termino) <= tol);
}

// Construye el regex de "palabra aislada" permitiendo un sufijo plural
// opcional en español ("s" o "es") — sin esto, "vial" no matcheaba dentro
// de "viales" (plural legítimo), aunque sí protegía correctamente contra
// falsos positivos como "vial" dentro de "vialidad" (que sigue bloqueado,
// ya que "idad" no es un sufijo de plural válido).
function regexPalabraAislada(termino) {
  return new RegExp(`(?<![a-z])${termino}(e?s)?(?![a-z])`);
}

function stemDiv(t) { return t.length >= 6 ? t.slice(0,-2) : t; }
function matchDivKw(titulo, kw) {
  // Se revisan AMBOS textos — el original y el expandido — nunca solo uno.
  // La expansión de abreviaturas ("mej"→"mejoramiento") consume la forma
  // corta antes de que una keyword que busca esa forma corta (ej. "ep mej")
  // tenga oportunidad de encontrarla. Revisando también el texto SIN
  // expandir, keywords que dependen de la abreviatura literal siguen
  // funcionando, sin perder el beneficio de la expansión para keywords que
  // ya usan la palabra completa (ej. "pavimento" encontrando "PAV").
  const tOriginal  = normDiv(titulo);
  const tExpandido = expandirAbreviaturasMOP(tOriginal);
  const kwNorm = normDiv(kw);
  if (kwNorm.length <= 4) {
    return regexPalabraAislada(kwNorm).test(tOriginal) || regexPalabraAislada(kwNorm).test(tExpandido);
  }
  return kwNorm.split(/\s+/).filter(t=>t.length>=3).every(t=>
    tOriginal.includes(stemDiv(t)) || tExpandido.includes(stemDiv(t)) ||
    apareceConTolerancia(tExpandido, t)
  );
}

// ── Matching de keywords/servicios (usado en /buscar y /buscar-general) ──
// Única fuente de verdad para esta comparación — antes existían 3 copias
// locales idénticas (una por endpoint) SIN protección de límite de palabra
// para términos cortos, a diferencia de matchDivKw que sí la tenía. Eso
// permitía falsos positivos como "pav" matcheando dentro de "PAVANA".
// Ahora ambas funciones (matchDivKw y matchKwSafe) usan la misma lógica de
// protección para términos de 4 caracteres o menos (con soporte de plural),
// la misma tolerancia a errores de tipeo para términos de 7+ caracteres, y
// revisan tanto el texto original como el expandido (ver nota en matchDivKw)
// para no perder keywords que dependen de la forma abreviada literal.
function matchKwSafe(titulo, kw) {
  const tOriginal  = normDiv(titulo);
  const tExpandido = expandirAbreviaturasMOP(tOriginal);
  const terms = normDiv(kw).split(/\s+/).filter(t => t.length >= 3);
  if (!terms.length) return false;
  return terms.every(t => {
    if (t.length <= 4) {
      return regexPalabraAislada(t).test(tOriginal) || regexPalabraAislada(t).test(tExpandido);
    }
    const stem = t.length >= 6 ? t.slice(0,-2) : t;
    return tOriginal.includes(stem) || tExpandido.includes(stem) || apareceConTolerancia(tExpandido, t);
  });
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
  // Aplana los grupos OR ({or:[...]}) a sus especialidades individuales —
  // para efectos de SUGERIR la división, cualquier especialidad mencionada
  // (aunque sea una alternativa) es una señal válida del tipo de proyecto.
  const especialidadesPlanas = (especialidadesMOP || []).flatMap(e => e.or ? e.or : [e]);
  for (const esp of especialidadesPlanas) {
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
  //
  // Cada elemento de `requisitos` puede ser:
  // - Un requisito simple {codigo, descripcion, categoria, especialidad}
  //   → obligatorio, LEN debe cumplirlo ("Y").
  // - Un grupo {or: [...]} → basta con que LEN cumpla UNA de las
  //   alternativas listadas dentro del grupo ("O").
  const fallas = [];
  const evaluarUno = req => {
    const rankLEN = LEN_REGISTRO_MOP.especialidades[req.codigo];
    const rankReq = RANK_CATEGORIA[(req.categoria || "").toLowerCase().trim()];
    if (rankLEN === undefined) return { ok: false, motivo: `Falta especialidad ${req.codigo} (${req.descripcion || ""})` };
    if (rankReq && rankLEN > rankReq) return { ok: false, motivo: `${req.codigo}: requiere ${req.categoria}, LEN tiene ${NOMBRE_CATEGORIA[rankLEN]}` };
    return { ok: true, motivo: null };
  };
  for (const req of (requisitos || [])) {
    if (req.or) {
      const resultados = req.or.map(evaluarUno);
      const algunoOk = resultados.some(r => r.ok);
      if (!algunoOk) {
        const opciones = req.or.map(o => o.codigo).join(" o ");
        fallas.push(`Requiere alguna de estas especialidades (no se cumple ninguna): ${opciones}`);
      }
    } else {
      const r = evaluarUno(req);
      if (!r.ok) fallas.push(r.motivo);
    }
  }
  return {
    califica: fallas.length === 0,
    fallas,
    diasVigencia: null,
    avisoVigencia: null
  };
}

// ── Parseo de un texto de "Sub Especialidad" → requisito simple o grupo OR ──
// Por defecto, cada especialidad listada en el recuadro de MP es un requisito
// obligatorio (LEN debe cumplir TODAS — lógica "Y"). Pero si el mismo texto
// menciona más de un código de especialidad (ej. "3.1 Mecánica de Suelos...
// o 3.2 Geología..."), se interpreta como alternativas — basta con cumplir
// UNA de ellas (lógica "O"). Esta función es la única fuente de verdad para
// esta interpretación, usada tanto por el parser de tabla estática como por
// el parser del endpoint AJAX, para que ambos se comporten igual siempre.
const CODIGO_ESPECIALIDAD_REGEX = /(\d{1,2}\.\d{1,2})\s+([^.]+\.?)/g;
function parseSubEspecialidad(subEspecialidad, especialidad, categoria) {
  const coincidencias = [...(subEspecialidad || "").matchAll(CODIGO_ESPECIALIDAD_REGEX)];
  if (coincidencias.length === 0) return null;
  if (coincidencias.length === 1) {
    return { codigo: coincidencias[0][1], descripcion: coincidencias[0][2].trim().replace(/\.$/, ""), categoria, especialidad };
  }
  // Múltiples códigos en el mismo texto → grupo de alternativas ("O").
  return {
    or: coincidencias.map(m => ({
      codigo: m[1], descripcion: m[2].trim().replace(/\.$/, ""), categoria, especialidad
    }))
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
    const req = parseSubEspecialidad(subEspecialidad, especialidad, categoria);
    if (!req) continue;
    const clave = req.or ? req.or.map(o => o.codigo).join("|") : req.codigo;
    if (seen.has(clave)) continue;
    seen.add(clave);
    requisitos.push(req);
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

  // ── Reintento silencioso ante respuesta vacía ──────────────────────────
  // Se confirmó en vivo que la PRIMERA llamada a este endpoint, justo
  // después de abrir la sesión, a veces responde "{d:null}" con HTTP 200
  // (sesión aún no "calentada" del lado de Mercado Público) — pero la
  // MISMA sesión, reintentada segundos después, responde correctamente de
  // forma consistente. En vez de mostrarle al usuario un falso "no se
  // pudieron obtener las especialidades", el backend reintenta solo,
  // internamente, antes de rendirse.
  const MAX_INTENTOS = 3;
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const r = await fetch(ajaxUrl, {
        method: "POST",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Content-Type": "application/json; charset=utf-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": referer, "Origin": "https://www.mercadopublico.cl",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          // Mercado Público empezó a exigir estos headers Sec-Fetch-* para
          // aceptar la petición (confirmado en vivo: sin ellos responde
          // "{d:null}" con HTTP 200 aunque las cookies y el Referer sean
          // correctos; con ellos, devuelve las especialidades reales).
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "Cookie": cookieHeader
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) {
        console.warn(`[ObtenerEspecialidades] Intento ${intento}/${MAX_INTENTOS}: WebMethod respondió ${r.status} para ${codigo}`);
      } else {
        const data = await r.json();
        const items = Array.isArray(data?.d) ? data.d : [];
        if (items.length > 0) {
          if (intento > 1) console.log(`[ObtenerEspecialidades] ${codigo}: obtenido en el intento ${intento}/${MAX_INTENTOS}`);
          const requisitos = [];
          const seen = new Set();
          for (const it of items) {
            const partes = (it.Descripcion || "").split("|").map(s => s.trim());
            if (partes.length < 3) continue;
            const especialidad    = partes[0];
            const subEspecialidad = partes[1];
            const categoria       = partes[2];
            const req = parseSubEspecialidad(subEspecialidad, especialidad, categoria);
            if (!req) continue;
            const clave = req.or ? req.or.map(o => o.codigo).join("|") : req.codigo;
            if (seen.has(clave)) continue;
            seen.add(clave);
            requisitos.push(req);
          }
          return requisitos;
        }
        console.warn(`[ObtenerEspecialidades] Intento ${intento}/${MAX_INTENTOS}: respuesta vacía (d:null) para ${codigo}`);
      }
    } catch (e) {
      console.warn(`[ObtenerEspecialidades] Intento ${intento}/${MAX_INTENTOS}: error para ${codigo}:`, e.message);
    }
    if (intento < MAX_INTENTOS) await new Promise(r => setTimeout(r, 1500));
  }
  console.warn(`[ObtenerEspecialidades] ${codigo}: sin especialidades tras ${MAX_INTENTOS} intentos`);
  return [];
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

// ── Fechas con hora (formato DD-MM-AAAA HH:MM) ─────────────────────────────
// Usado para construir la sección "📅 FECHAS CLAVE" del análisis de forma
// determinística, con los datos exactos de la API de MP (nunca vía IA).
function formatFechaHora(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Construye el texto de la sección "📅 FECHAS CLAVE" a partir de los datos
// exactos de la API de MP (ver `fechasPrecisas` en /mp/analizar). Reemplaza
// por completo lo que la IA hubiera escrito para esta sección, evitando
// errores de transcripción y agregando la hora, que el prompt nunca pedía.
function construirBloqueFechasClave(fp) {
  if (!fp) return null;
  const filas = [
    ["Fecha publicación",            fp.publicacion],
    ["Fecha inicio de preguntas",    fp.inicioPreguntas],
    ["Fecha final de preguntas",     fp.finalPreguntas],
    ["Publicación de respuestas",    fp.publicacionRespuestas],
    ["Cierre recepción ofertas",     fp.cierre],
    ["Apertura técnica",             fp.aperturaTecnica],
    ["Apertura económica",           fp.aperturaEconomica],
    [fp.adjudicacionEsEstimada ? "Adjudicación estimada" : "Adjudicación", fp.adjudicacion],
  ];
  const lineas = filas
    .map(([label, iso]) => {
      const f = formatFechaHora(iso);
      return f ? `${label}:`.padEnd(28) + f : null;
    })
    .filter(Boolean);
  if (!lineas.length) return null;
  return `📅 FECHAS CLAVE (fuente: ficha oficial de Mercado Público, hora exacta)\n${lineas.join("\n")}`;
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
  "servicios profesionales a honorarios",
  // ── Programas sociales/urbanos (no son ingeniería LEN) ──
  "quiero mi barrio","programa quiero mi barrio","mejoramiento de barrio",
  "mejoramiento integral barrio","programa de barrio",
  // ── Arriendos de equipos/vehículos/maquinaria (sin importar organismo) ──
  "arriendo maquinaria","arriendo maquinarias","arriendo de maquinaria",
  "arriendo camion","arriendo camiones","arriendo de camion","arriendo de camiones",
  "arriendo retroexcavadora","arriendo tractor","arriendo equipos",
  "arriendo vehiculo","arriendo vehiculos","arriendo de vehiculo",
  "contratacion servicio arriendo",
  // ── Mantenciones de infraestructura menor ──
  "mantencion camino acceso","mantenimiento camino acceso",
  "mantencion de ascensor","mantenimiento de ascensor",
  "mantencion de jardines","mantenimiento de jardines",
  "mantencion de edificio","mantenimiento de edificio",
  // ── Suministros y provisiones ──
  "suministro combustible","suministro de combustible",
  "provision de materiales","provision materiales"
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

// ── Siglas que por sí solas identifican el tipo de servicio ──────────────
// Licitaciones con estas siglas en el título no necesitan que aparezca
// una palabra de servicio adicional (Estudio, Consultoría, etc.) porque
// la sigla ya define inequívocamente el tipo de trabajo.
// Usa regex con límite de palabra para evitar falsos positivos
// (ej: APRendizaje no matchea APR).
//
// NOTA IMPORTANTE: "ep" y "ei" son prefijos equivalentes usados por MOP
// para nombrar el mismo tipo de proyecto (ej. "EP CONST Y MEJ...",
// "EI CONEXIÓN VIAL..."). Antes se manejaban como frases compuestas
// rígidas ("ep const","ep vial", etc.) en TIPOS_PROYECTO_IMPLICAN_SERVICIO,
// pero eso fallaba en cuanto MOP usaba una variante distinta de la sigla
// o intercalaba una palabra entre el prefijo y el resto del título. Al
// tratarlas como siglas independientes aquí (igual que AIF/APR/SSR/CGM),
// el sistema es robusto a cualquier variante sin necesidad de anticipar
// cada combinación posible.
const SIGLAS_IMPLICAN_SERVICIO = ["apr","ssr","ernc","bess","aif","cgm","ei","ep","preinv","ait"];

function tipoProyectoImplicito(titulo) {
  const t = normDiv(titulo);
  // Las frases de TIPOS_PROYECTO_IMPLICAN_SERVICIO se buscan también en la
  // versión expandida (ej. "ANTEPROY" → "anteproyecto"). Las siglas de
  // SIGLAS_IMPLICAN_SERVICIO se buscan en el texto SIN expandir, porque son
  // códigos literales de MOP (AIF, CGM, etc.), no abreviaciones de palabras.
  const tExpandido = expandirAbreviaturasMOP(t);
  if (TIPOS_PROYECTO_IMPLICAN_SERVICIO.some(k => tExpandido.includes(k))) return true;
  return SIGLAS_IMPLICAN_SERVICIO.some(sigla =>
    new RegExp(`(?<![a-z])${sigla}(?![a-z])`).test(t)
  );
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

// ── Jobs de análisis de bases en background ───────────────────────────────────
const basesJobs = new Map();

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
    // Nota: se eliminó la consulta con "tipo=SC" — la API de Mercado Público
    // no reconoce ese parámetro (confirmado: devuelve siempre HTTP 400
    // "Nombre de parametro no válido"). Nunca aportó licitaciones reales al
    // pool; solo agregaba 3 reintentos fallidos por búsqueda y ruido en los
    // logs. La única fuente real y válida es "estado=activas".
    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const sinTipo = await fetchConReintentos(mpUrl, controller, "buscar:activas");
    clearTimeout(timeoutId);

    if (sinTipo === null) {
      return res.status(503).json({
        error: "MP_API_UNAVAILABLE",
        mensaje: "La API de Mercado Público no respondió tras 3 intentos. Intenta de nuevo en unos segundos.",
        retry: true
      });
    }
    const licitaciones = sinTipo;
    console.log(`[buscar] TOTAL: ${licitaciones.length} licitaciones`);

    // Alias a la función central normDiv (única fuente de verdad de
    // normalización de texto). Antes esta función se redefinía por separado
    // en cada endpoint, lo que causaba que una mejora aplicada en un lugar
    // (ej. quitar puntos de "E.I.") no se reflejara en los demás.
    const norm = normDiv;
    // Alias a la función central matchKwSafe — ver nota junto a su definición.
    const matchesKeyword = matchKwSafe;
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
    // Nota: se eliminó la consulta con "tipo=SC" — la API de Mercado Público
    // no reconoce ese parámetro (confirmado: devuelve siempre HTTP 400
    // "Nombre de parametro no válido"). Nunca aportó licitaciones reales al
    // pool; solo agregaba 3 reintentos fallidos por búsqueda y ruido en los
    // logs. La única fuente real y válida es "estado=activas".
    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const sinTipo = await fetchConReintentos(mpUrl, controller, "buscar-general:activas");
    clearTimeout(timeoutId);

    if (sinTipo === null) {
      return res.status(503).json({
        error: "MP_API_UNAVAILABLE",
        mensaje: "La API de Mercado Público no respondió tras 3 intentos. Intenta de nuevo en unos segundos.",
        retry: true
      });
    }
    const pool = sinTipo;
    console.log(`[buscar-general] TOTAL: ${pool.length} licitaciones`);


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

    // DATO DE RAÍZ CONFIRMADO EN VIVO (consulta directa a la API de MP):
    // el endpoint masivo (?estado=activas) NUNCA trae "FechaPublicacion" ni
    // "Descripcion" para NINGUNA licitación, sea el título genérico o no —
    // esos dos campos solo existen en el endpoint de detalle individual
    // (?codigo=XXX). Por eso cualquier licitación que nunca haya disparado
    // una consulta de detalle (ni por este enriquecimiento, ni por abrir su
    // ficha, ni por "Analizar con IA") se queda sin fecha para siempre, sin
    // importar cuántas palabras tenga su título.
    //
    // El heurístico "título genérico" de abajo NO decide quién necesita la
    // FECHA — decide quién necesita la DESCRIPCIÓN para clasificarse bien
    // (un título específico ya trae pistas suficientes por sí solo, así
    // que no vale la pena gastar una consulta extra solo por eso). Son dos
    // necesidades distintas que antes compartían un solo mecanismo
    // gobernado por esa heurística, dejando sin ninguna vía de backfill a
    // las licitaciones de título específico que nadie hubiera abierto aún.
    //
    // Ambas necesidades se resuelven con la MISMA llamada de detalle (un
    // solo fetch trae fecha + descripción + monto + comprador a la vez),
    // pero se calculan y priorizan por separado para que una nunca le
    // quite el cupo a la otra: el backfill de fecha es un problema de
    // integridad de datos (la fecha real existe y no se ha traído) y
    // siempre va primero; el de descripción es una optimización de
    // clasificación y se atiende con lo que sobre del cupo.
    const necesitaDescripcion = l =>
      esTituloGenerico(l.Nombre) && !(l.Descripcion && l.Descripcion.trim().length > 20);
    const necesitaFecha = l => !l.FechaPublicacion;

    const candidatos = pool.filter(l => necesitaDescripcion(l) || necesitaFecha(l));
    console.log(`[buscar-general] Pool=${pool.length} | Necesitan descripción=${pool.filter(necesitaDescripcion).length} | Necesitan fecha=${pool.filter(necesitaFecha).length} | Candidatos únicos=${candidatos.length}`);

    let cacheMap = new Map();
    if (candidatos.length > 0) {
      try {
        const codigosNecesarios = candidatos.map(l => l.CodigoExterno).filter(Boolean);
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
        console.log(`[buscar-general] Cache hits: ${cacheMap.size}/${candidatos.length}`);
      } catch (e) {
        console.warn(`[buscar-general] Cache lookup falló: ${e.message}`);
      }
    }

    for (const lic of candidatos) {
      const cached = cacheMap.get(lic.CodigoExterno);
      if (!cached) continue;
      if (cached.descripcion) lic.Descripcion = cached.descripcion;
      if (cached.organismo && !lic.Comprador) {
        lic.Comprador = { NombreOrganismo: cached.organismo, RegionUnidad: cached.region, ComunaUnidad: cached.comuna };
      }
      if (cached.monto && !lic.MontoEstimado) lic.MontoEstimado = cached.monto;
      if (cached.fecha_publicacion && !lic.FechaPublicacion) lic.FechaPublicacion = cached.fecha_publicacion;
      if (cached.tipo_licitacion && !lic.Tipo) lic.Tipo = cached.tipo_licitacion;
    }

    // De lo que sigue sin cache, se ordena para que quienes AÚN necesitan
    // fecha de publicación (integridad de datos) vayan primero en la cola,
    // por sobre quienes solo necesitan descripción (optimización). Así, si
    // en un mismo pool aparecen muchos títulos genéricos nuevos de golpe,
    // nunca dejan sin cupo el backfill de fecha de licitaciones de título
    // específico.
    const aEnriquecer = candidatos
      .filter(l => !cacheMap.has(l.CodigoExterno))
      .sort((a, b) => (necesitaFecha(b) ? 1 : 0) - (necesitaFecha(a) ? 1 : 0));
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
              monto:       parseMontoMP(detalle.MontoEstimado),
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

    // Alias a la función central normDiv — ver nota en la primera ocurrencia.
    const norm = normDiv;
    // Alias a la función central matchKwSafe — ver nota junto a su definición.
    const matchKw = matchKwSafe;
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
          `${SUPABASE_URL}/rest/v1/ia_clasificaciones?codigo=in.(${inList})&select=codigo,divisiones_ia,veredicto_ia`,
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

    // ── Descripciones cacheadas: cargar ANTES de filtrar ──────────────────
    // El listado masivo de MP casi siempre trae "Descripcion" vacía — solo
    // el título. Si esa licitación ya fue enriquecida en una búsqueda
    // anterior (queda guardada en mp_pool_cache), usamos esa descripción
    // real para el matching de keywords y servicios ANTES de filtrar, en
    // vez de solo después (como se hacía hasta ahora, cuando ya era
    // demasiado tarde: si el título solo no bastaba, la licitación ya había
    // sido descartada y la descripción real nunca llegaba a usarse).
    const descCacheMap = new Map();
    try {
      const codigosSinDescripcion = pool
        .filter(l => !l.Descripcion && l.CodigoExterno)
        .map(l => l.CodigoExterno);
      const CHUNK_DESC = 200;
      for (let i = 0; i < codigosSinDescripcion.length; i += CHUNK_DESC) {
        const chunk = codigosSinDescripcion.slice(i, i + CHUNK_DESC);
        const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
        const descRes = await fetch(
          `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&select=codigo,descripcion`,
          { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
        );
        if (descRes.ok) {
          for (const row of await descRes.json()) {
            if (row.descripcion) descCacheMap.set(row.codigo, row.descripcion);
          }
        }
      }
      console.log(`[buscar-general] Descripciones cacheadas recuperadas pre-filtro: ${descCacheMap.size}/${codigosSinDescripcion.length}`);
    } catch(e) {
      console.warn(`[buscar-general] Carga de descripciones cacheadas falló (se sigue solo con título): ${e.message}`);
    }

    // ── Rescate previo: títulos que son solo sigla + ubicación ────────────
    // Casos como "E.I. I-72, SECTOR LOLOL..." o "AIF CGM COMUNA X" no
    // contienen NINGUNA palabra técnica en el título — solo la sigla y el
    // nombre del lugar. La palabra que confirma el tipo de proyecto
    // ("mejoramiento", "vial", etc.) vive únicamente en la descripción, que
    // el pool masivo no trae. Sin este paso, estas licitaciones nunca
    // matchean ninguna keyword y se descartan silenciosamente sin
    // oportunidad alguna. Se identifican por sigla conocida y, si no tienen
    // descripción aún, se consulta su detalle real en vivo (acotado) ANTES
    // del filtro principal — así el filtro de keywords ya las evalúa con
    // el contenido completo, igual que a cualquier otra licitación.
    try {
      const SIGLA_REGEX = new RegExp(`(?<![a-z])(${SIGLAS_IMPLICAN_SERVICIO.join("|")})(?![a-z])`);
      const candidatosSolaSigla = pool.filter(l => {
        if (l.Descripcion || descCacheMap.has(l.CodigoExterno)) return false; // ya tiene descripción
        const tituloNorm = normDiv(l.Nombre || "");
        return SIGLA_REGEX.test(tituloNorm);
      });
      const MAX_RESCATE_SIGLA = 20; // revertido de 60 (2026-08-04) — el aumento causó 502 (timeout) en búsquedas con muchas candidatas nuevas sin cachear; el costo en dinero es cero, pero el tiempo de espera sí es real y rompió búsquedas en producción
      const codigosSigla = [...new Set(candidatosSolaSigla.map(l => l.CodigoExterno).filter(Boolean))].slice(0, MAX_RESCATE_SIGLA);
      if (codigosSigla.length > 0) {
        console.log(`[buscar-general] Rescate previo (solo-sigla): ${candidatosSolaSigla.length} candidatos, consultando ${codigosSigla.length} (límite ${MAX_RESCATE_SIGLA})...`);
        const PARALELISMO_SIGLA = 5;
        const nuevasParaCacheSigla = [];
        for (let i = 0; i < codigosSigla.length; i += PARALELISMO_SIGLA) {
          const lote = codigosSigla.slice(i, i + PARALELISMO_SIGLA);
          await Promise.all(lote.map(async codigo => {
            try {
              const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
              const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!r.ok) return;
              const data = await r.json();
              const detalle = data.Listado?.[0];
              if (detalle?.Descripcion) {
                descCacheMap.set(codigo, detalle.Descripcion);
                nuevasParaCacheSigla.push({ codigo, descripcion: detalle.Descripcion });
              }
            } catch(e) {}
          }));
        }
        console.log(`[buscar-general] Rescate previo (solo-sigla): ${nuevasParaCacheSigla.length}/${codigosSigla.length} descripciones obtenidas`);
        if (nuevasParaCacheSigla.length > 0) {
          fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
            method: "POST",
            headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify(nuevasParaCacheSigla)
          }).then(r => {
            if (r.ok) console.log(`[buscar-general] Rescate previo: ${nuevasParaCacheSigla.length} descripciones guardadas en cache`);
          }).catch(e => console.warn(`[buscar-general] Rescate previo: error guardando cache: ${e.message}`));
        }
      }
    } catch(e) {
      console.warn(`[buscar-general] Rescate previo (solo-sigla) falló: ${e.message}`);
    }

    // Candidatos que matchean keyword técnica pero se descartarían solo por
    // falta de descripción real (nunca cacheada, pool masivo la trae vacía)
    // — se les da una segunda oportunidad más abajo antes de descartarlos
    // definitivamente.
    const candidatosRescate = []; // { codigo, id, l }
    const yaEnRescate = new Set(); // evita duplicar el mismo codigo+division
    // Casos donde la IA ya había clasificado (con opinión propia) pero dijo
    // que NO, y el sistema de keywords dice que SÍ — un desacuerdo real que
    // vale la pena revisar más adelante, en vez de depender de encontrarlo
    // por casualidad (ver caso Puerto Williams, 2026-08-04).
    const rescatesKeywordsIA = []; // { codigo, division_id, veredicto_ia, divisiones_ia }
    const yaRegistradoRescate = new Set();

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
        // Si el pool masivo trae descripción vacía, usamos la que ya
        // tengamos cacheada de una búsqueda anterior — así el matching de
        // keywords y servicios ve el contenido real, no solo el título.
        const descripcionReal = l.Descripcion || descCacheMap.get(l.CodigoExterno) || "";
        const titulo = `${l.Nombre || ""} ${descripcionReal}`;
        // Exclusiones duras: bloquean SIEMPRE, sin importar lo que digan la
        // IA o el sistema de keywords (arriendos, mantenciones de edificios,
        // programas sociales, sectores ajenos a LEN, etc.)
        if (esBloqueada(titulo)) return false;
        if (bloqueadaSectorial(titulo)) return false;

        // ── Clasificación por IA (si ya existe para esta licitación) ──────
        const iaClass = iaClassMap.get(l.CodigoExterno);
        const iaDiceQueSi = !!iaClass && iaClass.veredicto_ia !== "🔴" && iaClass.divisiones_ia.includes(id);

        // ── Clasificación por keywords (siempre se evalúa, no solo como
        // respaldo cuando falta la IA) ────────────────────────────────────
        const matchTec = keywords.some(kw => matchKw(titulo, kw));
        let keywordsDicenQueSi = false;
        if (matchTec) {
          const faltaServicio = servicios?.length && !tipoProyectoImplicito(titulo) && !servicios.some(s => matchKw(titulo, s));
          if (faltaServicio) {
            // Si aún no tenemos descripción real y la única razón de
            // descarte por keywords es el servicio, se da una segunda
            // oportunidad más abajo (rescate) en vez de descartar
            // definitivamente por esta vía — pero la IA todavía podría
            // confirmar igual si ya la clasificó bien.
            if (!descripcionReal && l.CodigoExterno) {
              const key = `${l.CodigoExterno}::${id}`;
              if (!yaEnRescate.has(key)) {
                yaEnRescate.add(key);
                candidatosRescate.push({ codigo: l.CodigoExterno, id, l });
              }
            }
          } else {
            const exclConfig = divConfig && aplicaExclusiones(divConfig, l.Comprador?.NombreOrganismo || "", titulo);
            if (!exclConfig) {
              const DIVISIONES_ESTRICTAS = new Set(["ito","mineria","energia"]);
              const regionClasif = extraerRegionDeTexto(titulo);
              const clasificacion = clasificarDivisiones(titulo, regionClasif?.codigo || null, l.Comprador?.NombreOrganismo || "");
              const pasaEstricta = !(clasificacion.length === 0 && DIVISIONES_ESTRICTAS.has(id));
              const pasaCruce = !(clasificacion.length > 0 && !clasificacion.some(d => d.id === id));
              keywordsDicenQueSi = pasaEstricta && pasaCruce;
            }
          }
        }

        // ── Registro de desacuerdos IA vs keywords ─────────────────────
        // Si la IA ya clasificó esta licitación (tiene opinión propia,
        // no es que "aún no la haya visto") y dijo que NO, pero las
        // keywords dicen que SÍ, se guarda el caso para revisión
        // posterior — sin esto, este tipo de error de la IA solo se
        // detecta por casualidad, como pasó hoy.
        if (iaClass && !iaDiceQueSi && keywordsDicenQueSi) {
          const key = `${l.CodigoExterno}::${id}`;
          if (!yaRegistradoRescate.has(key)) {
            yaRegistradoRescate.add(key);
            rescatesKeywordsIA.push({
              codigo: l.CodigoExterno,
              division_id: id,
              veredicto_ia: iaClass.veredicto_ia,
              divisiones_ia: iaClass.divisiones_ia
            });
          }
        }

        // ── Decisión final: basta con que UNO de los dos sistemas
        // confirme la relevancia — ya no gana automáticamente la IA. Esto
        // evita perder licitaciones donde la IA se equivocó al descartar
        // algo que las keywords sí reconocen correctamente (y viceversa).
        return iaDiceQueSi || keywordsDicenQueSi;
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

    // ── Guardar desacuerdos IA vs keywords (no bloquea la respuesta) ──────
    // Se guarda en segundo plano (sin "await") para no retrasar la
    // búsqueda — es un registro para revisión posterior, no algo crítico
    // para el resultado que ve el usuario ahora mismo.
    if (rescatesKeywordsIA.length > 0) {
      console.log(`[buscar-general] ${rescatesKeywordsIA.length} desacuerdo(s) IA vs keywords detectado(s), guardando para revisión...`);
      fetch(`${SUPABASE_URL}/rest/v1/keywords_rescates_ia`, {
        method: "POST",
        headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(rescatesKeywordsIA.map(r => ({
          codigo: r.codigo,
          division_id: r.division_id,
          veredicto_ia: r.veredicto_ia,
          divisiones_ia: r.divisiones_ia,
          detectado_en: new Date().toISOString()
        }))),
        signal: AbortSignal.timeout(5000)
      }).catch(e => console.warn(`[buscar-general] No se pudo guardar registro de desacuerdos IA vs keywords: ${e.message}`));
    }

    // ── Rescate: segunda oportunidad para candidatos sin descripción ─────
    // Estas licitaciones matchearon la keyword técnica pero fueron
    // descartadas solo por falta de una palabra de servicio explícita en el
    // título — y no teníamos su descripción real para confirmar. Se
    // consulta su detalle en vivo (acotado a un máximo por búsqueda para no
    // saturar la API de MP) y, si la descripción real confirma el
    // servicio, se rescatan. La descripción consultada se guarda en cache
    // para que futuras búsquedas ya no necesiten este paso.
    if (candidatosRescate.length > 0) {
      const MAX_RESCATE = 30; // revertido de 90 (2026-08-04) — mismo motivo: el aumento causó timeouts (502) reales en producción
      const codigosUnicos = [...new Set(candidatosRescate.map(c => c.codigo))].slice(0, MAX_RESCATE);
      console.log(`[buscar-general] Rescate: ${candidatosRescate.length} candidatos (${codigosUnicos.length} códigos únicos, límite ${MAX_RESCATE}) sin descripción — consultando detalle real...`);
      const descRescatadas = new Map();
      const PARALELISMO_RESCATE = 5;
      for (let i = 0; i < codigosUnicos.length; i += PARALELISMO_RESCATE) {
        const lote = codigosUnicos.slice(i, i + PARALELISMO_RESCATE);
        await Promise.all(lote.map(async codigo => {
          try {
            const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${codigo}&ticket=${TICKET}`;
            const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return;
            const data = await r.json();
            const detalle = data.Listado?.[0];
            if (detalle?.Descripcion) descRescatadas.set(codigo, detalle.Descripcion);
          } catch(e) {}
        }));
      }
      console.log(`[buscar-general] Rescate: ${descRescatadas.size}/${codigosUnicos.length} descripciones obtenidas`);

      // Re-evaluar cada candidato con su descripción real
      for (const cand of candidatosRescate) {
        const descRescatada = descRescatadas.get(cand.codigo);
        if (!descRescatada) continue;
        const div = divisiones.find(d => d.id === cand.id);
        if (!div) continue;
        const titulo = `${cand.l.Nombre || ""} ${descRescatada}`;
        if (esBloqueada(titulo) || bloqueadaSectorial(titulo)) continue;
        const matchTec = div.keywords.some(kw => matchKw(titulo, kw));
        if (!matchTec) continue;
        const faltaServicio = div.servicios?.length && !tipoProyectoImplicito(titulo) && !div.servicios.some(s => matchKw(titulo, s));
        if (faltaServicio) continue;
        const divConfig = DIVISIONES_LEN.find(d => d.id === cand.id);
        if (divConfig && aplicaExclusiones(divConfig, cand.l.Comprador?.NombreOrganismo || "", titulo)) continue;
        const DIVISIONES_ESTRICTAS = new Set(["ito","mineria","energia"]);
        const regionClasif = extraerRegionDeTexto(titulo);
        const clasificacion = clasificarDivisiones(titulo, regionClasif?.codigo || null, cand.l.Comprador?.NombreOrganismo || "");
        if (clasificacion.length === 0 && DIVISIONES_ESTRICTAS.has(cand.id)) continue;
        if (clasificacion.length > 0 && !clasificacion.some(d => d.id === cand.id)) continue;

        // Pasa el filtro con la descripción real: se rescata
        const itemConDescripcion = { ...cand.l, Descripcion: descRescatada };
        const mapeado = mapItem(itemConDescripcion);
        const yaEsta = resultados[cand.id].some(r => r.codigo === mapeado.codigo);
        if (!yaEsta) {
          resultados[cand.id].push(mapeado);
          console.log(`[buscar-general] Rescate exitoso: ${cand.codigo} → ${cand.id}`);
        }
      }

      // Guardar en cache para que futuras búsquedas no necesiten rescatarlas de nuevo
      if (descRescatadas.size > 0) {
        const filas = [...descRescatadas.entries()].map(([codigo, descripcion]) => ({ codigo, descripcion }));
        fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
          method: "POST",
          headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify(filas)
        }).then(r => {
          if (r.ok) console.log(`[buscar-general] Rescate: ${filas.length} descripciones guardadas en cache`);
        }).catch(e => console.warn(`[buscar-general] Rescate: error guardando cache: ${e.message}`));
      }
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
                monto:       parseMontoMP(det.MontoEstimado),
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

    // Alias a la función central normDiv — ver nota en la primera ocurrencia.
    const norm = normDiv;
    // Alias a la función central matchKwSafe — ver nota junto a su definición.
    const matchesKw = matchKwSafe;
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
          monto:      fmtMontoMP(l.MontoEstimado, false),
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
      monto:         fmtMontoMP(l.MontoEstimado),
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
          const diasTranscurridos = (Date.now() - new Date(data[0].creado_en).getTime()) / 86400000;
          const TTL_REFRESCO_FECHAS_DIAS = 3;

          if (diasTranscurridos < TTL_REFRESCO_FECHAS_DIAS) {
            console.log(`[analizar] Cache HIT para ${item.codigo} (creado ${data[0].creado_en})`);
            return res.json({ analysis: data[0].analisis, cached: true, cacheCreadoEn: data[0].creado_en });
          }

          // ── Caché con más de 3 días: refrescar SOLO las fechas ──────────
          // No se vuelve a llamar a la IA (cero costo adicional) — se
          // consulta la API de MP (gratuita) para traer las fechas
          // actuales y se reemplaza únicamente la sección "📅 FECHAS CLAVE"
          // del análisis ya guardado, dejando el resto intacto. Si Mercado
          // Público movió una fecha (algo común y legítimo), el usuario la
          // ve actualizada sin tener que reanalizar manualmente ni pagar
          // otro análisis completo.
          console.log(`[analizar] Cache de ${item.codigo} tiene ${diasTranscurridos.toFixed(1)} días — refrescando solo fechas (sin IA)`);
          try {
            const apiUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${item.codigo}&ticket=${TICKET}`;
            const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              const lic = apiData.Listado?.[0];
              if (lic) {
                const fechasFrescas = {
                  publicacion:           lic.FechaPublicacion || lic.Fechas?.FechaPublicacion || null,
                  inicioPreguntas:       lic.Fechas?.FechaInicio || null,
                  finalPreguntas:        lic.Fechas?.FechaFinal || null,
                  publicacionRespuestas: lic.Fechas?.FechaPubRespuestas || null,
                  cierre:                lic.Fechas?.FechaCierre || null,
                  aperturaTecnica:       lic.Fechas?.FechaActoAperturaTecnica || null,
                  aperturaEconomica:     lic.Fechas?.FechaActoAperturaEconomica || null,
                  adjudicacion:          lic.Fechas?.FechaAdjudicacion || lic.Fechas?.FechaEstimadaAdjudicacion || null,
                  adjudicacionEsEstimada: !lic.Fechas?.FechaAdjudicacion && !!lic.Fechas?.FechaEstimadaAdjudicacion
                };
                const bloqueFechasFresco = construirBloqueFechasClave(fechasFrescas);
                if (bloqueFechasFresco) {
                  const seccionRegex = /📅 FECHAS CLAVE[\s\S]*?(?=\n📊|\n🎯|\n⚠️|$)/;
                  const textoActualizado = seccionRegex.test(data[0].analisis)
                    ? data[0].analisis.replace(seccionRegex, bloqueFechasFresco + "\n")
                    : data[0].analisis.trim() + "\n\n" + bloqueFechasFresco;

                  // Guardar el texto refrescado — esto también resetea el
                  // contador de 3 días para la próxima vez.
                  await fetch(`${SUPABASE_URL}/rest/v1/analisis_cache`, {
                    method: "POST",
                    headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
                    body: JSON.stringify({ codigo: item.codigo, analisis: textoActualizado, creado_en: new Date().toISOString() }),
                    signal: AbortSignal.timeout(5000)
                  });
                  await fetch(`${SUPABASE_URL}/rest/v1/licitaciones?codigo=eq.${encodeURIComponent(item.codigo)}`, {
                    method: "PATCH",
                    headers: SUPABASE_HEADERS,
                    body: JSON.stringify({ analisis_ia_completo: textoActualizado }),
                    signal: AbortSignal.timeout(5000)
                  });
                  console.log(`[analizar] Fechas de ${item.codigo} refrescadas sin usar IA`);
                  return res.json({ analysis: textoActualizado, cached: true, fechasRefrescadas: true });
                }
              }
            }
          } catch (e) {
            console.warn(`[analizar] No se pudieron refrescar fechas de ${item.codigo}, se devuelve la caché tal cual: ${e.message}`);
          }
          // Si el refresco falla por cualquier motivo, mejor devolver la
          // caché vieja que dejar al usuario sin nada.
          return res.json({ analysis: data[0].analisis, cached: true, cacheCreadoEn: data[0].creado_en });
        }
      }
    } catch (e) { console.warn(`[analizar] Cache lookup falló: ${e.message}`); }
  }

  let datosAPI = {};
  let fechasPrecisas = null;
  if (item.codigo) {
    try {
      const apiUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${item.codigo}&ticket=${TICKET}`;
      const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
      if (apiRes.ok) {
        const data = await apiRes.json();
        const lic = data.Listado?.[0];
        if (lic) {
          datosAPI = {
            montoEstimado:           parseMontoMP(lic.MontoEstimado) || 0,
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
          // ── Fechas con hora exacta, tomadas directamente de la API de MP ──
          // Se arman de forma determinística (sin IA) para que la sección
          // "FECHAS CLAVE" del análisis nunca dependa de que el modelo
          // transcriba bien una fecha desde texto/HTML — y para que incluya
          // la hora, que el prompt nunca pedía. Mapeo confirmado contra la
          // ficha real de Mercado Público (recuadro "Etapas y plazos").
          fechasPrecisas = {
            // MP es inconsistente: en algunas licitaciones FechaPublicacion
            // viene a nivel raíz, en otras solo dentro de "Fechas". Se
            // revisan ambos lugares, con el nivel raíz como prioridad.
            publicacion:        lic.FechaPublicacion || lic.Fechas?.FechaPublicacion || null,
            inicioPreguntas:    lic.Fechas?.FechaInicio || null,
            finalPreguntas:     lic.Fechas?.FechaFinal || null,
            publicacionRespuestas: lic.Fechas?.FechaPubRespuestas || null,
            cierre:             lic.Fechas?.FechaCierre || null,
            aperturaTecnica:    lic.Fechas?.FechaActoAperturaTecnica || null,
            aperturaEconomica:  lic.Fechas?.FechaActoAperturaEconomica || null,
            adjudicacion:       lic.Fechas?.FechaAdjudicacion || lic.Fechas?.FechaEstimadaAdjudicacion || null,
            adjudicacionEsEstimada: !lic.Fechas?.FechaAdjudicacion && !!lic.Fechas?.FechaEstimadaAdjudicacion
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
      const listaReq = requisitosMOP.map(r =>
        r.or
          ? `   • (se acepta cualquiera de estas) ${r.or.map(o => `${o.codigo} ${o.descripcion} — Categoría ${o.categoria}`).join("  O  ")}`
          : `   • ${r.codigo} ${r.descripcion} — Categoría ${r.categoria}`
      ).join("\n");
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

⏱️ PLAZO DE EJECUCIÓN
Indica el plazo de ejecución del contrato o estudio (NO el plazo del proceso de licitación: no es la fecha de cierre de ofertas ni de adjudicación, es cuánto dura el trabajo una vez adjudicado).
Búscalo en el contenido como "Plazo de Ejecución", "Plazo del Contrato", "Duración del Estudio/Servicio", "Plazo de Entrega" o similar. Si "Duración del contrato (API)" tiene un valor, úsalo como referencia.
Formato de salida: un número y su unidad, tal como aparece en las bases (ej: "180 días corridos", "6 meses", "12 meses desde la orden de inicio").
Usa "No especificado" si no aparece en ningún lado del contenido proporcionado.

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
    let text = data.choices?.[0]?.message?.content || "No se pudo obtener el análisis.";

    // ── Reemplazo determinístico de "📅 FECHAS CLAVE" ──────────────────────
    // Sustituye lo que la IA haya escrito para esta sección (adivinado desde
    // texto/HTML, sin hora) por el bloque exacto construido desde la API de
    // MP, que sí incluye hora. Si por algún motivo no hay fechas precisas
    // disponibles (ej. la API no respondió), se deja el texto de la IA tal
    // cual, sin romper el análisis.
    const bloqueFechas = construirBloqueFechasClave(fechasPrecisas);
    if (bloqueFechas) {
      const seccionRegex = /📅 FECHAS CLAVE[\s\S]*?(?=\n📊|\n🎯|\n⚠️|$)/;
      if (seccionRegex.test(text)) {
        text = text.replace(seccionRegex, bloqueFechas + "\n");
      } else {
        // Si la IA omitió la sección por completo, se agrega igual.
        text = text.trim() + "\n\n" + bloqueFechas;
      }
    }

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
          datosExtra.monto_estimado              = parseMontoMP(lic.MontoEstimado);
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
      const LIMITE_TOTAL = 40000;
      let textoTotal = textosRelevantes.join("\n\n");
      if (textoTotal.length < LIMITE_TOTAL && textosGenericos.length) {
        const espacio = LIMITE_TOTAL - textoTotal.length;
        textoTotal += "\n\n" + textosGenericos.join("\n\n").substring(0, espacio);
      }
      textoTotal = textoTotal.substring(0, LIMITE_TOTAL);

      // ── Agente único: Claude Sonnet lee TODO el documento de una vez ──────
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada" });

      const META = `METADATA DE LA LICITACIÓN EN MERCADO PÚBLICO:
Título: ${metadata.titulo||""}
Código: ${metadata.codigo||""}
Mandante: ${metadata.organismo||""}
Región: ${metadata.region||""}
Monto estimado: ${metadata.monto||""}
Fecha cierre: ${metadata.fechaCierre||""}
URL: ${metadata.url||""}`;

      const SYSTEM_PROMPT = `Eres un experto senior en licitaciones públicas chilenas para LEN Ingeniería (consultora de ingeniería: vial, hidráulica, sanitaria, ITO, medio ambiente, energía, minería).

Tu tarea es analizar los documentos de bases de licitación y generar un resumen estructurado, completo y HONESTO.

PRINCIPIOS FUNDAMENTALES:
1. Usa texto LITERAL de los documentos cuando sea posible. Cita secciones específicas.
2. Sé HONESTO sobre lo que falta: si los documentos son solo Términos de Referencia técnicos sin Bases Administrativas, indícalo explícitamente. No uses "[NO ENCONTRADO]" — escribe una advertencia clara explicando qué falta y dónde encontrarlo.
3. Los puntos críticos deben ser realmente útiles para decidir si LEN debe participar o no.
4. En calendario: distingue entre fechas del portal MP (administración) y plazos del TR (técnicos).
5. En garantías: si no están en los documentos, usa el campo "garantias_advertencia" para explicarlo.
6. Sé específico: nombres de software, normativas, metodologías, códigos de documentos, áreas en km².

RESPONDE ÚNICAMENTE CON JSON VÁLIDO SIN MARKDOWN NI TEXTO PREVIO:
{
  "titulo": "NOMBRE COMPLETO DE LA CONSULTORÍA EN MAYÚSCULAS",
  "subtitulo": "Tipo documento — Fecha — Región",
  "identificacion": {
    "nombre_estudio": "",
    "mandante": "",
    "region": "",
    "numero_licitacion": "",
    "fecha_documentos": "",
    "marco_legal": "",
    "documentos_base_referencia": ""
  },
  "objetivo_general": "texto del objetivo general tal como aparece en el TR",
  "area_estudio": [{"sector": "nombre sector", "descripcion": "superficie, límites, comunas"}],
  "perfiles_profesionales": "descripción de los perfiles requeridos o advertencia si no están en los documentos",
  "alcance_resumen": "descripción de qué documentos se analizaron, qué contienen y qué información administrativa queda fuera del alcance de este resumen",
  "puntos_criticos": ["punto crítico 1 con detalle suficiente para tomar decisión", "punto 2"],
  "calendario_licitacion": [{"hito": "nombre del hito", "fecha": "DD-MM-AAAA HH:MM:SS"}],
  "nota_calendario": "explicación sobre las fechas — cuáles vienen del portal y cuáles del TR",
  "referencias_temporales_tr": ["plazo o referencia temporal que aparece en el TR pero no en el calendario"],
  "garantias_advertencia": "texto explicando qué información de garantías y pagos está disponible y qué no",
  "referencias_pago_tr": ["referencia al pago que aparece en el TR (puede ser técnica, no financiera)"],
  "alcances_consultoria": ["alcance 1", "alcance 2"],
  "etapas": [{"etapa": "ETAPA I", "descripcion": "contenido detallado de la etapa"}],
  "herramientas": [{"herramienta": "nombre", "descripcion": "especificación técnica completa"}],
  "informes_por_etapa": [{"informe": "nombre del informe", "contenido": "descripción del contenido"}],
  "entregables_finales": ["entregable 1 con detalle"],
  "formato_informes": ["requisito de formato 1"],
  "anexos_tr": [{"anexo": "código del anexo", "descripcion": "descripción del anexo"}]
}`;

      console.log("[analizar-bases] Iniciando agente único Claude Sonnet...");
      let analisis;
      try {
        const rIA = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type":      "application/json",
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model:      "claude-sonnet-4-6",
            max_tokens: 5000,
            system:     SYSTEM_PROMPT,
            messages:   [{
              role: "user",
              content: `${META}\n\n--- DOCUMENTOS DE LA LICITACIÓN ---\n\n${textoTotal}`
            }]
          }),
          signal: AbortSignal.timeout(90000)
        });
        if (!rIA.ok) throw new Error(`Anthropic ${rIA.status}: ${await rIA.text().then(t=>t.substring(0,200))}`);
        const dIA    = await rIA.json();
        const txtIA  = dIA.content?.[0]?.text || "{}";
        const cleanIA = txtIA.replace(/```json|```/g,"").trim();
        const matchIA = cleanIA.match(/\{[\s\S]*\}/);
        analisis = JSON.parse(matchIA ? matchIA[0] : cleanIA);
        console.log("[analizar-bases] Agente completado exitosamente");
      } catch(e) {
        throw new Error(`Error en agente IA: ${e.message}`);
      }

      // ── Generación del Excel — 5 hojas en formato del ejemplo ────────────
      const wb = new ExcelJS.Workbook();
      wb.creator = "LEN Ingeniería";
      wb.created = new Date();

      // Paleta de colores
      const C = { azulOscuro:"1E3A5F", azulMedio:"2563EB", azulClaro:"EFF6FF",
                  verdeClaro:"F0FDF4", amClaro:"FFFBEB", rojoClaro:"FEF2F2",
                  gris:"F8FAFC", grisMedio:"E2E8F0" };

      // Helpers de estilo
      const stTitle = { font:{bold:true,size:13,color:{argb:"FFFFFFFF"},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.azulOscuro}`}}, alignment:{horizontal:"center",vertical:"middle"} };
      const stSub   = { font:{bold:false,size:10,color:{argb:"FFFFFFFF"},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.azulMedio}`}}, alignment:{horizontal:"center",vertical:"middle"} };
      const stSec   = { font:{bold:true,size:10,color:{argb:`FF${C.azulMedio}`},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.azulClaro}`}}, alignment:{horizontal:"left",vertical:"middle"} };
      const stLbl   = { font:{bold:true,size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:"FFFAFAFA"}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} };
      const stVal   = (bg) => ({ font:{size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:"FFFFFFFF"}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} });
      const stTblH  = { font:{bold:true,color:{argb:"FFFFFFFF"},size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.azulOscuro}`}}, alignment:{horizontal:"center",vertical:"middle",wrapText:true} };
      const stRow   = (i,bg) => ({ font:{size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:(i%2===0?"FFFFFFFF":`FF${C.gris}`)}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} });
      const stWarn  = { font:{bold:true,size:9,name:"Arial",color:{argb:"FF92400E"}}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C.amClaro}`}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} };

      const addTitle = (ws, txt, cols) => {
        const r = ws.addRow([txt]); ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = stTitle; r.height = 32; return r;
      };
      const addSub = (ws, txt, cols) => {
        const r = ws.addRow([txt]); ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = stSub; r.height = 20; return r;
      };
      const addSec = (ws, txt, cols) => {
        const r = ws.addRow([txt]); ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = stSec; r.height = 22; return r;
      };
      const addKV = (ws, lbl, val, bg) => {
        const r = ws.addRow([lbl, val||""]);
        r.getCell(1).style = stLbl; r.getCell(2).style = stVal(bg); r.height = 18; return r;
      };
      const addTexto = (ws, txt, cols, bg) => {
        const r = ws.addRow([txt||""]); ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = { font:{size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:"FFFFFFFF"}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} };
        r.height = 36; return r;
      };
      const addWarn = (ws, txt, cols) => {
        const r = ws.addRow([txt||""]); ws.mergeCells(r.number,1,r.number,cols);
        r.getCell(1).style = stWarn; r.height = 36; return r;
      };
      const addLista = (ws, items, cols) => {
        (items||[]).filter(Boolean).forEach((item, i) => {
          const r = ws.addRow([`• ${item}`]); ws.mergeCells(r.number,1,r.number,cols);
          r.getCell(1).style = stRow(i); r.height = 28;
        });
      };
      const addTblRow = (ws, cells, i, bg) => {
        const r = ws.addRow(cells);
        r.eachCell(c => { c.style = stRow(i,bg); c.alignment = {wrapText:true,vertical:"middle"}; });
        r.height = 32; return r;
      };

      const id  = analisis.identificacion || {};
      const TITULO_EXCEL = (analisis.titulo || metadata.titulo || "LICITACIÓN").toUpperCase();
      const SUBTITULO    = analisis.subtitulo || `${metadata.organismo||""} — ${metadata.region||""}`;

      // ── Hoja 1: Resumen General ───────────────────────────────────────────
      const ws1 = wb.addWorksheet("Resumen General");
      ws1.columns = [{ width:32 },{ width:78 }];
      addTitle(ws1, TITULO_EXCEL, 2);
      addSub(ws1, SUBTITULO, 2);

      if (escaneadosCount > 0) {
        ws1.addRow([]);
        addWarn(ws1, `⚠️ ATENCIÓN: ${escaneadosCount} archivo(s) escaneado(s) — el texto no pudo extraerse automáticamente. Revisar manualmente esas secciones antes de usar este resumen.`, 2);
      }

      ws1.addRow([]);
      addSec(ws1, "IDENTIFICACIÓN", 2);
      [
        ["Nombre del estudio",           id.nombre_estudio       || metadata.titulo],
        ["Mandante",                      id.mandante             || metadata.organismo],
        ["Región",                        id.region               || metadata.region],
        ["Nº de licitación",              id.numero_licitacion    || metadata.codigo],
        ["Fecha de los documentos",       id.fecha_documentos],
        ["Marco legal",                   id.marco_legal],
        ["Documentos base de referencia", id.documentos_base_referencia]
      ].filter(([,v]) => v).forEach(([l,v]) => { const r = addKV(ws1, l, v); r.height = 22; });

      ws1.addRow([]);
      addSec(ws1, "OBJETIVO GENERAL", 2);
      if (analisis.objetivo_general) addTexto(ws1, analisis.objetivo_general, 2);

      if (analisis.area_estudio?.length) {
        ws1.addRow([]);
        addSec(ws1, "ÁREA DE ESTUDIO", 2);
        analisis.area_estudio.forEach((a, i) => { const r = addKV(ws1, a.sector, a.descripcion); r.height = 26; });
      }

      if (analisis.perfiles_profesionales) {
        ws1.addRow([]);
        addSec(ws1, "PERFILES PROFESIONALES", 2);
        addTexto(ws1, analisis.perfiles_profesionales, 2);
      }

      if (analisis.alcance_resumen) {
        ws1.addRow([]);
        addSec(ws1, "ALCANCE DE ESTE RESUMEN", 2);
        addTexto(ws1, analisis.alcance_resumen, 2, C.azulClaro.replace("EFF6FF","EFF6FF") ? "EFF6FF" : null);
      }

      if (analisis.puntos_criticos?.length) {
        ws1.addRow([]);
        addSec(ws1, "PUNTOS CRÍTICOS", 2);
        analisis.puntos_criticos.forEach((p, i) => {
          const r = ws1.addRow([`•`, p]); r.getCell(1).style = stLbl; r.getCell(2).style = stVal(); r.height = 32;
        });
      }

      // ── Hoja 2: Calendario ───────────────────────────────────────────────
      const ws2 = wb.addWorksheet("Calendario");
      ws2.columns = [{ width:40 },{ width:28 }];
      addTitle(ws2, TITULO_EXCEL, 2);
      addSub(ws2, "Plazos y fechas", 2);

      if (analisis.calendario_licitacion?.length) {
        ws2.addRow([]);
        addSec(ws2, "CALENDARIO DE LA LICITACIÓN (según ficha del portal)", 2);
        const hc = ws2.addRow(["Hito", "Fecha / Plazo"]);
        hc.eachCell(c => { c.style = stTblH; }); hc.height = 18;
        analisis.calendario_licitacion.forEach((c, i) => addTblRow(ws2, [c.hito, c.fecha], i));
      }

      if (analisis.nota_calendario) {
        ws2.addRow([]);
        addSec(ws2, "NOTA", 2);
        addTexto(ws2, analisis.nota_calendario, 2, "FFFBEB");
      }

      if (analisis.referencias_temporales_tr?.length) {
        ws2.addRow([]);
        addSec(ws2, "REFERENCIAS TEMPORALES QUE SÍ APARECEN EN EL TR", 2);
        addTexto(ws2, "(No constituyen un calendario de la licitación; son condiciones técnicas/operativas del estudio)", 2, "EFF6FF");
        addLista(ws2, analisis.referencias_temporales_tr, 2);
      }

      // ── Hoja 3: Garantías y Pagos ─────────────────────────────────────────
      const ws3 = wb.addWorksheet("Garantías y Pagos");
      ws3.columns = [{ width:40 },{ width:68 }];
      addTitle(ws3, TITULO_EXCEL, 2);
      addSub(ws3, "Garantías, presupuesto y condiciones de pago", 2);

      ws3.addRow([]);
      if (analisis.garantias_advertencia) {
        addWarn(ws3, `ADVERTENCIA\n${analisis.garantias_advertencia}`, 2);
      }

      if (analisis.referencias_pago_tr?.length) {
        ws3.addRow([]);
        addSec(ws3, "REFERENCIAS A 'PAGO' QUE SÍ APARECEN EN EL TR", 2);
        addTexto(ws3, "Aclaración: estas referencias usan el término 'pago' en sentido técnico (cómo se contabilizan partidas), NO como calendario de estados de pago ni condiciones económicas del contrato.", 2, "EFF6FF");
        ws3.addRow([]);
        analisis.referencias_pago_tr.forEach((ref, i) => {
          const r = ws3.addRow([`•`, ref]); r.getCell(1).style = stLbl; r.getCell(2).style = stVal(); r.height = 28;
        });
      }

      // ── Hoja 4: Alcance Técnico ──────────────────────────────────────────
      const ws4 = wb.addWorksheet("Alcance Técnico");
      ws4.columns = [{ width:18 },{ width:90 }];
      addTitle(ws4, TITULO_EXCEL, 2);
      addSub(ws4, "Objetivos, alcances, etapas y herramientas", 2);

      if (analisis.alcances_consultoria?.length) {
        ws4.addRow([]);
        addSec(ws4, "ALCANCES DE LA CONSULTORÍA", 2);
        addLista(ws4, analisis.alcances_consultoria, 2);
      }

      if (analisis.etapas?.length) {
        ws4.addRow([]);
        addSec(ws4, `ETAPAS DEL ESTUDIO (${analisis.etapas.length} etapas secuenciales)`, 2);
        const he = ws4.addRow(["Etapa", "Descripción"]);
        he.eachCell(c => { c.style = stTblH; }); he.height = 18;
        analisis.etapas.forEach((e, i) => {
          const r = addTblRow(ws4, [e.etapa, e.descripcion], i);
          r.height = 48;
        });
      }

      if (analisis.herramientas?.length) {
        ws4.addRow([]);
        addSec(ws4, "HERRAMIENTAS Y COMPONENTES TRANSVERSALES", 2);
        analisis.herramientas.forEach((h, i) => {
          const r = addKV(ws4, h.herramienta, h.descripcion); r.height = 26;
        });
      }

      // ── Hoja 5: Documentos a Preparar ────────────────────────────────────
      const ws5 = wb.addWorksheet("Documentos a Preparar");
      ws5.columns = [{ width:32 },{ width:76 }];
      addTitle(ws5, TITULO_EXCEL, 2);
      addSub(ws5, "Entregables, informes y anexos del TR", 2);

      if (analisis.informes_por_etapa?.length) {
        ws5.addRow([]);
        addSec(ws5, "INFORMES POR ETAPA", 2);
        const hi = ws5.addRow(["Informe", "Contenido"]);
        hi.eachCell(c => { c.style = stTblH; }); hi.height = 18;
        analisis.informes_por_etapa.forEach((inf, i) => {
          const r = addTblRow(ws5, [inf.informe, inf.contenido], i); r.height = 40;
        });
      }

      if (analisis.entregables_finales?.length) {
        ws5.addRow([]);
        addSec(ws5, "ENTREGABLES FINALES", 2);
        addLista(ws5, analisis.entregables_finales, 2);
      }

      if (analisis.formato_informes?.length) {
        ws5.addRow([]);
        addSec(ws5, "FORMATO EXIGIDO PARA LOS INFORMES", 2);
        addLista(ws5, analisis.formato_informes, 2);
      }

      if (analisis.anexos_tr?.length) {
        ws5.addRow([]);
        addSec(ws5, "ANEXOS DEL TR", 2);
        const ha = ws5.addRow(["Anexo", "Descripción"]);
        ha.eachCell(c => { c.style = stTblH; }); ha.height = 18;
        analisis.anexos_tr.forEach((a, i) => addTblRow(ws5, [a.anexo, a.descripcion], i));
      }

      // ── Confianza e indicadores ───────────────────────────────────────────
      const confianza = escaneadosCount === 0 ? "completa" :
                        escaneadosCount < archivosAuditoria.length / 2 ? "parcial" : "fallida";

      const buf     = await wb.xlsx.writeBuffer();
      const b64     = Buffer.from(buf).toString("base64");
      const archivo = `Resumen_${(metadata.codigo||"LIC").replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

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

// ── Analizar Bases — versión async con background + polling ──────────────────
// Responde inmediatamente con un jobId. El frontend consulta /mp/bases-status/:jobId
// cada 5 segundos. Esto elimina el timeout de Render y permite usar 80K chars + 8000 tokens.
app.post("/mp/analizar-bases-async", (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "Error al subir archivo: " + err.message });
    if (!req.file) return res.status(400).json({ error: "Archivo ZIP requerido" });

    let metadata = {};
    try { metadata = JSON.parse(req.body.metadata || "{}"); } catch(e) {}

    // Responder inmediatamente con jobId
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    basesJobs.set(jobId, { estado: "procesando", progreso: "Leyendo archivos ZIP...", resultado: null, error: null });
    res.json({ ok: true, jobId });

    // Procesar en background (sin bloquear la respuesta HTTP)
    const fileBuffer = req.file.buffer;
    setImmediate(async () => {
      try {
        const archivosAuditoria = [];
        const textosRelevantes  = [];
        const textosGenericos   = [];
        let escaneadosCount     = 0;

        basesJobs.set(jobId, { ...basesJobs.get(jobId), progreso: "Extrayendo texto de PDFs..." });

        const zip = new AdmZip(fileBuffer);
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
          basesJobs.set(jobId, { estado: "error", progreso: null, resultado: null, error: `No se pudo extraer texto de ningún PDF. Escaneados: ${escaneadosCount}` });
          setTimeout(() => basesJobs.delete(jobId), 10 * 60 * 1000);
          return;
        }

        // 80K chars con calidad máxima — sin restricción de timeout HTTP
        const LIMITE_TOTAL = 80000;
        let textoTotal = textosRelevantes.join("\n\n");
        if (textoTotal.length < LIMITE_TOTAL && textosGenericos.length) {
          const espacio = LIMITE_TOTAL - textoTotal.length;
          textoTotal += "\n\n" + textosGenericos.join("\n\n").substring(0, espacio);
        }
        textoTotal = textoTotal.substring(0, LIMITE_TOTAL);

        basesJobs.set(jobId, { ...basesJobs.get(jobId), progreso: `Consultando Claude Sonnet — ${Math.round(textoTotal.length/1000)}K caracteres...` });

        const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
        if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY no configurada");

        const META = `METADATA DE LA LICITACIÓN EN MERCADO PÚBLICO:
Título: ${metadata.titulo||""}
Código: ${metadata.codigo||""}
Mandante: ${metadata.organismo||""}
Región: ${metadata.region||""}
Monto estimado: ${metadata.monto||""}
Fecha cierre: ${metadata.fechaCierre||""}
URL: ${metadata.url||""}`;

        const SYSTEM_PROMPT = `Eres un experto senior en licitaciones públicas chilenas para LEN Ingeniería (consultora de ingeniería: vial, hidráulica, sanitaria, ITO, medio ambiente, energía, minería).

Tu tarea es analizar los documentos de bases de licitación y generar un resumen estructurado, completo y HONESTO.

PRINCIPIOS FUNDAMENTALES:
1. Usa texto LITERAL de los documentos cuando sea posible. Cita secciones específicas.
2. Sé HONESTO sobre lo que falta: si los documentos son solo Términos de Referencia técnicos sin Bases Administrativas, indícalo explícitamente. No uses "[NO ENCONTRADO]" — escribe una advertencia clara explicando qué falta y dónde encontrarlo.
3. Los puntos críticos deben ser realmente útiles para decidir si LEN debe participar o no.
4. En calendario: distingue entre fechas del portal MP (administración) y plazos del TR (técnicos).
5. En garantías: si no están en los documentos, usa el campo "garantias_advertencia" para explicarlo.
6. Sé específico: nombres de software, normativas, metodologías, códigos de documentos, áreas en km².

RESPONDE ÚNICAMENTE CON JSON VÁLIDO SIN MARKDOWN NI TEXTO PREVIO:
{
  "titulo": "NOMBRE COMPLETO DE LA CONSULTORÍA EN MAYÚSCULAS",
  "subtitulo": "Tipo documento — Fecha — Región",
  "identificacion": {
    "nombre_estudio": "",
    "mandante": "",
    "region": "",
    "numero_licitacion": "",
    "fecha_documentos": "",
    "marco_legal": "",
    "documentos_base_referencia": ""
  },
  "objetivo_general": "texto del objetivo general tal como aparece en el TR",
  "area_estudio": [{"sector": "nombre sector", "descripcion": "superficie, límites, comunas"}],
  "perfiles_profesionales": "descripción de los perfiles requeridos o advertencia si no están en los documentos",
  "alcance_resumen": "descripción de qué documentos se analizaron, qué contienen y qué información administrativa queda fuera del alcance de este resumen",
  "puntos_criticos": ["punto crítico 1 con detalle suficiente para tomar decisión", "punto 2"],
  "calendario_licitacion": [{"hito": "nombre del hito", "fecha": "DD-MM-AAAA HH:MM:SS"}],
  "nota_calendario": "explicación sobre las fechas — cuáles vienen del portal y cuáles del TR",
  "referencias_temporales_tr": ["plazo o referencia temporal que aparece en el TR pero no en el calendario"],
  "garantias_advertencia": "texto explicando qué información de garantías y pagos está disponible y qué no",
  "referencias_pago_tr": ["referencia al pago que aparece en el TR (puede ser técnica, no financiera)"],
  "alcances_consultoria": ["alcance 1", "alcance 2"],
  "etapas": [{"etapa": "ETAPA I", "descripcion": "contenido detallado de la etapa"}],
  "herramientas": [{"herramienta": "nombre", "descripcion": "especificación técnica completa"}],
  "informes_por_etapa": [{"informe": "nombre del informe", "contenido": "descripción del contenido"}],
  "entregables_finales": ["entregable 1 con detalle"],
  "formato_informes": ["requisito de formato 1"],
  "anexos_tr": [{"anexo": "código del anexo", "descripcion": "descripción del anexo"}]
}`;

        console.log(`[analizar-bases-async] Llamando a Claude Sonnet (streaming) jobId=${jobId}...`);

        // ── STREAMING ──────────────────────────────────────────────────────
        // Con max_tokens=16000 la llamada no-stream puede superar los 3 min y
        // el AbortSignal fijo la mataba. Con streaming la conexión recibe deltas
        // continuamente. El watchdog aborta SOLO si Claude deja de enviar datos
        // por 90s (cuelgue real), no por tiempo total de generación.
        const abortCtrl   = new AbortController();
        let   ultimoChunk = Date.now();
        const watchdog    = setInterval(() => {
          if (Date.now() - ultimoChunk > 90000) abortCtrl.abort();
        }, 5000);

        let txtIA = "";
        try {
          const rIA = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type":      "application/json",
              "x-api-key":         ANTHROPIC_KEY,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model:      "claude-sonnet-4-6",
              max_tokens: 16000,
              stream:     true,
              system:     SYSTEM_PROMPT,
              messages:   [{ role: "user", content: `${META}\n\n--- DOCUMENTOS DE LA LICITACIÓN ---\n\n${textoTotal}` }]
            }),
            signal: abortCtrl.signal
          });

          if (!rIA.ok) {
            const errTxt = await rIA.text().catch(() => "");
            throw new Error(`Anthropic ${rIA.status}: ${errTxt.substring(0, 200)}`);
          }

          // node-fetch v2: rIA.body es un Readable de Node (chunks = Buffer).
          // Parseamos el SSE línea por línea acumulando los text_delta.
          let sseBuf = "", deltas = 0;
          for await (const chunk of rIA.body) {
            ultimoChunk = Date.now();
            sseBuf += chunk.toString("utf8");
            let nl;
            while ((nl = sseBuf.indexOf("\n")) !== -1) {
              const linea = sseBuf.slice(0, nl).trim();
              sseBuf = sseBuf.slice(nl + 1);
              if (!linea.startsWith("data:")) continue;
              const data = linea.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let evt;
              try { evt = JSON.parse(data); } catch { continue; }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                txtIA += evt.delta.text;
                deltas++;
                // Actualizar progreso visible en polling cada 150 deltas
                if (deltas % 150 === 0) {
                  basesJobs.set(jobId, { ...basesJobs.get(jobId), progreso: `Recibiendo respuesta de Claude — ${txtIA.length} chars...` });
                }
              } else if (evt.type === "error") {
                throw new Error("Stream error: " + JSON.stringify(evt.error || evt));
              }
            }
          }
        } catch (e) {
          if (e.name === "AbortError") throw new Error("Sin respuesta de Claude por 90s (stream colgado) — abortado por watchdog");
          throw e;
        } finally {
          clearInterval(watchdog);
        }

        if (!txtIA) txtIA = "{}";
        const clean = txtIA.replace(/```json|```/g, "").trim();
        // Extraer JSON con manejo robusto de respuesta truncada
        let analisis = {};
        try {
          const match = clean.match(/\{[\s\S]*\}/);
          analisis = JSON.parse(match ? match[0] : clean);
        } catch(jsonErr) {
          console.warn(`[analizar-bases-async] JSON completo falló (${jsonErr.message}), intentando reparar...`);
          // Intentar truncar en el último objeto completo antes del error
          let texto = clean;
          const posError = parseInt(jsonErr.message.match(/position (\d+)/)?.[1]) || texto.length;
          texto = texto.substring(0, posError);
          // Cerrar arrays y objetos abiertos
          let open = 0;
          for (const ch of texto) { if (ch==='{') open++; else if (ch==='}') open--; }
          texto = texto + '}'.repeat(Math.max(0, open));
          try {
            const matchRep = texto.match(/\{[\s\S]*\}/);
            analisis = JSON.parse(matchRep ? matchRep[0] : "{}");
            console.warn(`[analizar-bases-async] JSON reparado OK`);
          } catch(e2) {
            console.error(`[analizar-bases-async] No se pudo reparar JSON: ${e2.message}. Usando objeto vacío.`);
            analisis = { titulo: metadata.titulo || "LICITACIÓN", subtitulo: metadata.organismo || "", alcance_resumen: "⚠️ Error al parsear respuesta IA — el análisis puede estar incompleto. Intenta de nuevo." };
          }
        }
        console.log(`[analizar-bases-async] Claude OK jobId=${jobId}`);

        basesJobs.set(jobId, { ...basesJobs.get(jobId), progreso: "Generando Excel..." });

        // ── Generar Excel (mismo código que en /mp/analizar-bases) ────────────
        const wb2 = new ExcelJS.Workbook();
        wb2.creator = "LEN Ingeniería";
        wb2.created = new Date();
        const C2 = { azulOscuro:"1E3A5F", azulMedio:"2563EB", azulClaro:"EFF6FF", gris:"F8FAFC", amClaro:"FFFBEB" };
        const stT2 = { font:{bold:true,size:13,color:{argb:"FFFFFFFF"},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C2.azulOscuro}`}}, alignment:{horizontal:"center",vertical:"middle"} };
        const stSb2 = { font:{bold:false,size:10,color:{argb:"FFFFFFFF"},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C2.azulMedio}`}}, alignment:{horizontal:"center",vertical:"middle"} };
        const stSc2 = { font:{bold:true,size:10,color:{argb:`FF${C2.azulMedio}`},name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C2.azulClaro}`}}, alignment:{horizontal:"left",vertical:"middle"} };
        const stLb2 = { font:{bold:true,size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:"FFFAFAFA"}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} };
        const stVl2 = (bg) => ({ font:{size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:"FFFFFFFF"}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} });
        const stTH2 = { font:{bold:true,color:{argb:"FFFFFFFF"},size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C2.azulOscuro}`}}, alignment:{horizontal:"center",vertical:"middle",wrapText:true} };
        const stRw2 = (i,bg) => ({ font:{size:9,name:"Arial"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:(i%2===0?"FFFFFFFF":`FF${C2.gris}`)}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} });
        const stWn2 = { font:{bold:true,size:9,name:"Arial",color:{argb:"FF92400E"}}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:`FF${C2.amClaro}`}}, alignment:{horizontal:"left",vertical:"middle",wrapText:true} };
        const aT2 = (ws,t,c) => { const r=ws.addRow([t]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style=stT2; r.height=32; return r; };
        const aS2 = (ws,t,c) => { const r=ws.addRow([t]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style=stSb2; r.height=20; return r; };
        const aSc2 = (ws,t,c) => { const r=ws.addRow([t]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style=stSc2; r.height=22; return r; };
        const aKV2 = (ws,l,v,bg) => { const r=ws.addRow([l,v||""]); r.getCell(1).style=stLb2; r.getCell(2).style=stVl2(bg); r.height=18; return r; };
        const aTx2 = (ws,t,c,bg) => { const r=ws.addRow([t||""]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style={font:{size:9,name:"Arial"},fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg?`FF${bg}`:"FFFFFFFF"}},alignment:{horizontal:"left",vertical:"middle",wrapText:true}}; r.height=36; return r; };
        const aWn2 = (ws,t,c) => { const r=ws.addRow([t||""]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style=stWn2; r.height=36; return r; };
        const aLs2 = (ws,items,c) => { (items||[]).filter(Boolean).forEach((it,i)=>{ const r=ws.addRow([`• ${it}`]); ws.mergeCells(r.number,1,r.number,c); r.getCell(1).style=stRw2(i); r.height=28; }); };
        const aTR2 = (ws,cells,i,bg) => { const r=ws.addRow(cells); r.eachCell(c=>{c.style=stRw2(i,bg);c.alignment={wrapText:true,vertical:"middle"};}); r.height=32; return r; };

        const id2  = analisis.identificacion || {};
        const TIT2 = (analisis.titulo || metadata.titulo || "LICITACIÓN").toUpperCase();
        const SUB2 = analisis.subtitulo || `${metadata.organismo||""} — ${metadata.region||""}`;

        // Hoja 1
        const w1 = wb2.addWorksheet("Resumen General");
        w1.columns = [{ width:32 },{ width:78 }];
        aT2(w1,TIT2,2); aS2(w1,SUB2,2);
        if (escaneadosCount>0) { w1.addRow([]); aWn2(w1,`⚠️ ATENCIÓN: ${escaneadosCount} archivo(s) escaneado(s) — revisar manualmente.`,2); }
        w1.addRow([]); aSc2(w1,"IDENTIFICACIÓN",2);
        [["Nombre del estudio",id2.nombre_estudio||metadata.titulo],["Mandante",id2.mandante||metadata.organismo],["Región",id2.region||metadata.region],["Nº de licitación",id2.numero_licitacion||metadata.codigo],["Fecha de los documentos",id2.fecha_documentos],["Marco legal",id2.marco_legal],["Documentos base",id2.documentos_base_referencia]].filter(([,v])=>v).forEach(([l,v])=>{const r=aKV2(w1,l,v);r.height=22;});
        if (analisis.objetivo_general) { w1.addRow([]); aSc2(w1,"OBJETIVO GENERAL",2); aTx2(w1,analisis.objetivo_general,2); }
        if (analisis.area_estudio?.length) { w1.addRow([]); aSc2(w1,"ÁREA DE ESTUDIO",2); analisis.area_estudio.forEach(a=>{const r=aKV2(w1,a.sector,a.descripcion);r.height=26;}); }
        if (analisis.perfiles_profesionales) { w1.addRow([]); aSc2(w1,"PERFILES PROFESIONALES",2); aTx2(w1,analisis.perfiles_profesionales,2); }
        if (analisis.alcance_resumen) { w1.addRow([]); aSc2(w1,"ALCANCE DE ESTE RESUMEN",2); aTx2(w1,analisis.alcance_resumen,2,"EFF6FF"); }
        if (analisis.puntos_criticos?.length) { w1.addRow([]); aSc2(w1,"PUNTOS CRÍTICOS",2); analisis.puntos_criticos.forEach(p=>{const r=w1.addRow([`•`,p]);r.getCell(1).style=stLb2;r.getCell(2).style=stVl2();r.height=32;}); }

        // Hoja 2
        const w2 = wb2.addWorksheet("Calendario");
        w2.columns = [{ width:40 },{ width:28 }];
        aT2(w2,TIT2,2); aS2(w2,"Plazos y fechas",2);
        if (analisis.calendario_licitacion?.length) { w2.addRow([]); aSc2(w2,"CALENDARIO DE LA LICITACIÓN (según ficha del portal)",2); const hc=w2.addRow(["Hito","Fecha / Plazo"]); hc.eachCell(c=>{c.style=stTH2;}); hc.height=18; analisis.calendario_licitacion.forEach((c,i)=>aTR2(w2,[c.hito,c.fecha],i)); }
        if (analisis.nota_calendario) { w2.addRow([]); aSc2(w2,"NOTA",2); aTx2(w2,analisis.nota_calendario,2,"FFFBEB"); }
        if (analisis.referencias_temporales_tr?.length) { w2.addRow([]); aSc2(w2,"REFERENCIAS TEMPORALES EN EL TR",2); aTx2(w2,"(No constituyen un calendario; son condiciones técnicas del estudio)",2,"EFF6FF"); aLs2(w2,analisis.referencias_temporales_tr,2); }

        // Hoja 3
        const w3 = wb2.addWorksheet("Garantías y Pagos");
        w3.columns = [{ width:40 },{ width:68 }];
        aT2(w3,TIT2,2); aS2(w3,"Garantías, presupuesto y condiciones de pago",2);
        w3.addRow([]);
        if (analisis.garantias_advertencia) aWn2(w3,`ADVERTENCIA\n${analisis.garantias_advertencia}`,2);
        if (analisis.referencias_pago_tr?.length) { w3.addRow([]); aSc2(w3,"REFERENCIAS A 'PAGO' EN EL TR",2); aTx2(w3,"Aclaración: referencias técnicas al pago de partidas — NO condiciones económicas del contrato.",2,"EFF6FF"); w3.addRow([]); analisis.referencias_pago_tr.forEach((ref,i)=>{const r=w3.addRow([`•`,ref]);r.getCell(1).style=stLb2;r.getCell(2).style=stVl2();r.height=28;}); }

        // Hoja 4
        const w4 = wb2.addWorksheet("Alcance Técnico");
        w4.columns = [{ width:18 },{ width:90 }];
        aT2(w4,TIT2,2); aS2(w4,"Objetivos, alcances, etapas y herramientas",2);
        if (analisis.alcances_consultoria?.length) { w4.addRow([]); aSc2(w4,"ALCANCES DE LA CONSULTORÍA",2); aLs2(w4,analisis.alcances_consultoria,2); }
        if (analisis.etapas?.length) { w4.addRow([]); aSc2(w4,`ETAPAS DEL ESTUDIO (${analisis.etapas.length} etapas)`,2); const he=w4.addRow(["Etapa","Descripción"]); he.eachCell(c=>{c.style=stTH2;}); he.height=18; analisis.etapas.forEach((e,i)=>{const r=aTR2(w4,[e.etapa,e.descripcion],i);r.height=48;}); }
        if (analisis.herramientas?.length) { w4.addRow([]); aSc2(w4,"HERRAMIENTAS Y COMPONENTES TRANSVERSALES",2); analisis.herramientas.forEach(h=>{const r=aKV2(w4,h.herramienta,h.descripcion);r.height=26;}); }

        // Hoja 5
        const w5 = wb2.addWorksheet("Documentos a Preparar");
        w5.columns = [{ width:32 },{ width:76 }];
        aT2(w5,TIT2,2); aS2(w5,"Entregables, informes y anexos del TR",2);
        if (analisis.informes_por_etapa?.length) { w5.addRow([]); aSc2(w5,"INFORMES POR ETAPA",2); const hi=w5.addRow(["Informe","Contenido"]); hi.eachCell(c=>{c.style=stTH2;}); hi.height=18; analisis.informes_por_etapa.forEach((inf,i)=>{const r=aTR2(w5,[inf.informe,inf.contenido],i);r.height=40;}); }
        if (analisis.entregables_finales?.length) { w5.addRow([]); aSc2(w5,"ENTREGABLES FINALES",2); aLs2(w5,analisis.entregables_finales,2); }
        if (analisis.formato_informes?.length) { w5.addRow([]); aSc2(w5,"FORMATO EXIGIDO",2); aLs2(w5,analisis.formato_informes,2); }
        if (analisis.anexos_tr?.length) { w5.addRow([]); aSc2(w5,"ANEXOS DEL TR",2); const ha=w5.addRow(["Anexo","Descripción"]); ha.eachCell(c=>{c.style=stTH2;}); ha.height=18; analisis.anexos_tr.forEach((a,i)=>aTR2(w5,[a.anexo,a.descripcion],i)); }

        const confianza2 = escaneadosCount===0 ? "completa" : escaneadosCount < archivosAuditoria.length/2 ? "parcial" : "fallida";
        const buf2    = await wb2.xlsx.writeBuffer();
        const b64_2   = Buffer.from(buf2).toString("base64");
        const archivo2 = `Resumen_${(metadata.codigo||"LIC").replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

        let excelPath2 = null;
        if (metadata.codigo && metadata.licitacionId) {
          try {
            const sp2 = `${metadata.codigo.replace(/[^a-zA-Z0-9_-]/g,"_")}/${archivo2}`;
            const up2 = await fetch(`${SUPABASE_URL}/storage/v1/object/bases-resumenes/${sp2}`, {
              method:"POST", headers:{"Authorization":SUPABASE_HEADERS.Authorization,"apikey":SUPABASE_HEADERS.apikey,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","x-upsert":"true"}, body:buf2, signal:AbortSignal.timeout(20000)
            });
            if (up2.ok) { excelPath2=sp2; console.log(`[analizar-bases-async] Excel subido: ${sp2}`); }
            await fetch(`${SUPABASE_URL}/rest/v1/licitaciones?id=eq.${encodeURIComponent(metadata.licitacionId)}`, {
              method:"PATCH", headers:SUPABASE_HEADERS, body:JSON.stringify({ resumen_bases_excel_path:excelPath2, resumen_bases_creado_at:new Date().toISOString(), resumen_bases_archivos_originales:archivosAuditoria.map(a=>({nombre:a.nombre,tipo:a.tipo,paginas:a.paginas,estado:a.estado})) }), signal:AbortSignal.timeout(8000)
            });
          } catch(e) { console.warn(`[analizar-bases-async] No se pudo persistir: ${e.message}`); }
        }

        basesJobs.set(jobId, {
          estado:    "completado",
          progreso:  null,
          resultado: { ok:true, excelBase64:b64_2, nombreArchivo:archivo2, excelPath:excelPath2, confianza:confianza2, escaneados:escaneadosCount, totalArchivos:archivosAuditoria.length, auditoria:archivosAuditoria },
          error:     null
        });
        setTimeout(() => basesJobs.delete(jobId), 30 * 60 * 1000);
        console.log(`[analizar-bases-async] ✅ Completado jobId=${jobId}`);

      } catch(err) {
        console.error(`[analizar-bases-async] ❌ jobId=${jobId}:`, err.message);
        basesJobs.set(jobId, { estado:"error", progreso:null, resultado:null, error:err.message });
        setTimeout(() => basesJobs.delete(jobId), 10 * 60 * 1000);
      }
    });
  });
});

app.get("/mp/bases-status/:jobId", (req, res) => {
  const job = basesJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job no encontrado o expirado" });
  // No retornar excelBase64 en la respuesta de status (muy pesado) — solo cuando completado y se pida el resultado
  if (job.estado === "completado" && job.resultado) {
    return res.json({ estado: job.estado, resultado: job.resultado });
  }
  res.json({ estado: job.estado, progreso: job.progreso, error: job.error });
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

// ── Backfill definitivo de fecha de publicación ───────────────────────────
// Por qué existe: el endpoint masivo de MP (?estado=activas) NUNCA trae
// FechaPublicacion — solo el detalle individual (?codigo=XXX) la tiene. En
// /buscar-general el backfill de esa fecha solo ocurría cuando alguien
// disparaba una búsqueda, con cupo compartido y limitado a 30 llamadas de
// detalle por request (para no romper el tiempo de respuesta de esa ruta).
// Si nadie buscaba, o si aparecían muchas licitaciones nuevas de golpe, el
// backlog de licitaciones sin fecha podía tardar varias búsquedas en
// cerrarse — y mientras tanto, una licitación de título específico que
// nadie abriera manualmente se quedaba sin fecha indefinidamente.
//
// Este job es la solución definitiva a ESE límite estructural: corre solo,
// en segundo plano, cada cierto tiempo, sin depender de que alguien use el
// buscador ni de ningún límite de tiempo de respuesta HTTP. Recorre TODO
// el pool activo (no solo lo que ya esté en mp_pool_cache), identifica qué
// códigos siguen sin fecha_publicacion, y va cerrando ese backlog solo,
// para siempre — sin volver a depender de una heurística de título ni de
// que un usuario abra la ficha.
let backfillFechaState = {
  ultimo_inicio: null, ultimo_fin: null,
  ultimo_revisadas: 0, ultimo_pendientes: 0, ultimo_actualizadas: 0, ultimo_error: null,
  // ── Tendencia del backlog ──────────────────────────────────────────────
  // Guarda las últimas corridas (pendientes al cierre de cada una) para
  // poder distinguir un backlog que se achica solo (nada que hacer) de uno
  // que crece sostenido (señal de que el lote/frecuencia ya no alcanza y
  // hay que subirlos). Sin este historial, "ultimo_pendientes" por sí solo
  // no dice si la situación está mejorando o empeorando.
  historial_pendientes: [], // [{ ts, pendientes }], más reciente al final, máx. 20
  tendencia: null           // "bajando" | "estable" | "subiendo" | null (aún sin datos suficientes)
};

const BACKFILL_FECHA_LOTE       = 100; // por corrida — no bloquea ninguna request de usuario
const BACKFILL_FECHA_PARALELISMO = 5;
const BACKFILL_FECHA_SLEEP_MS    = 250;
const BACKFILL_HISTORIAL_MAX     = 20;
// Margen para no gritar "sube" por ruido de +1/-1 entre corridas —
// solo se considera una subida real cuando el backlog crece más que esto
// respecto de la corrida anterior.
const BACKFILL_MARGEN_ALERTA     = 10;

async function backfillFechasPublicacion() {
  backfillFechaState.ultimo_inicio = new Date().toISOString();
  backfillFechaState.ultimo_error  = null;
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 120000);
    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const pool = await fetchConReintentos(mpUrl, controller, "backfill-fechas:activas");
    clearTimeout(timeoutId);
    if (pool === null) throw new Error("MP_API_UNAVAILABLE tras reintentos");

    // Averigua, en un solo viaje por lote, cuáles códigos YA tienen fecha
    // guardada en caché — el resto son los pendientes reales, sin importar
    // si alguna vez pasaron o no por /buscar-general.
    const codigos = pool.map(l => l.CodigoExterno).filter(Boolean);
    const conFecha = new Set();
    const CHUNK = 500;
    for (let i = 0; i < codigos.length; i += CHUNK) {
      const chunk = codigos.slice(i, i + CHUNK);
      const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/mp_pool_cache?codigo=in.(${inList})&fecha_publicacion=not.is.null&select=codigo`,
        { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(12000) }
      );
      if (r.ok) for (const row of await r.json()) conFecha.add(row.codigo);
    }

    const pendientes = pool.filter(l => l.CodigoExterno && !conFecha.has(l.CodigoExterno));
    backfillFechaState.ultimo_revisadas  = pool.length;
    console.log(`[backfill-fechas] Pool=${pool.length} | Ya con fecha=${conFecha.size} | Pendientes=${pendientes.length}`);

    const lote = pendientes.slice(0, BACKFILL_FECHA_LOTE);
    const nuevasEnCache = [];
    for (let i = 0; i < lote.length; i += BACKFILL_FECHA_PARALELISMO) {
      const grupo = lote.slice(i, i + BACKFILL_FECHA_PARALELISMO);
      await Promise.all(grupo.map(async lic => {
        try {
          const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${lic.CodigoExterno}&ticket=${TICKET}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return;
          const data = await r.json();
          const detalle = data.Listado?.[0];
          if (!detalle) return;
          nuevasEnCache.push({
            codigo:            lic.CodigoExterno,
            nombre:            detalle.Nombre || lic.Nombre,
            descripcion:       detalle.Descripcion || "",
            organismo:         detalle.Comprador?.NombreOrganismo || null,
            region:            detalle.Comprador?.RegionUnidad || null,
            comuna:            detalle.Comprador?.ComunaUnidad || null,
            monto:             parseMontoMP(detalle.MontoEstimado),
            fecha_publicacion: detalle.Fechas?.FechaPublicacion || null,
            tipo_licitacion:   detalle.Tipo || null,
            fetched_at:        new Date().toISOString()
          });
        } catch (e) {}
      }));
      if (i + BACKFILL_FECHA_PARALELISMO < lote.length) {
        await new Promise(r => setTimeout(r, BACKFILL_FECHA_SLEEP_MS));
      }
    }

    if (nuevasEnCache.length > 0) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/mp_pool_cache`, {
        method: "POST",
        headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(nuevasEnCache),
        signal: AbortSignal.timeout(15000)
      });
      if (!r.ok) console.warn(`[backfill-fechas] Falló guardado cache: ${r.status}`);
    }

    backfillFechaState.ultimo_actualizadas = nuevasEnCache.filter(n => n.fecha_publicacion).length;
    backfillFechaState.ultimo_fin = new Date().toISOString();
    const quedanPendientes = Math.max(0, pendientes.length - lote.length);
    backfillFechaState.ultimo_pendientes = quedanPendientes;

    // ── Tendencia + alerta ─────────────────────────────────────────────
    // Compara contra la corrida anterior (no contra el arranque del
    // servidor) para detectar si el backlog viene creciendo sostenido.
    const anterior = backfillFechaState.historial_pendientes.at(-1) || null;
    if (anterior) {
      const delta = quedanPendientes - anterior.pendientes;
      if (delta > BACKFILL_MARGEN_ALERTA) {
        backfillFechaState.tendencia = "subiendo";
        console.warn(`[backfill-fechas] ⚠️ ALERTA: el backlog de licitaciones sin fecha viene SUBIENDO (${anterior.pendientes} → ${quedanPendientes}, +${delta}). El lote actual (${BACKFILL_FECHA_LOTE} cada ${BACKFILL_FECHA_INTERVAL_MS / 60000} min) ya no alcanza a mantenerlo al día — considera subir BACKFILL_FECHA_LOTE o la frecuencia.`);
      } else if (delta < -BACKFILL_MARGEN_ALERTA) {
        backfillFechaState.tendencia = "bajando";
      } else {
        backfillFechaState.tendencia = "estable";
      }
    }
    backfillFechaState.historial_pendientes.push({ ts: backfillFechaState.ultimo_fin, pendientes: quedanPendientes });
    if (backfillFechaState.historial_pendientes.length > BACKFILL_HISTORIAL_MAX) {
      backfillFechaState.historial_pendientes = backfillFechaState.historial_pendientes.slice(-BACKFILL_HISTORIAL_MAX);
    }

    console.log(`[backfill-fechas] Procesadas=${lote.length} | Con fecha nueva=${backfillFechaState.ultimo_actualizadas} | Quedan pendientes=${quedanPendientes} | Tendencia=${backfillFechaState.tendencia || "sin datos aún"}`);
  } catch (e) {
    backfillFechaState.ultimo_error = e.message;
    backfillFechaState.ultimo_fin   = new Date().toISOString();
    console.error("[backfill-fechas] Error:", e.message);
  }
}

// Cada 30 min, sin depender de que alguien use el buscador. La primera
// corrida arranca 90s después de levantar el servidor.
const BACKFILL_FECHA_INTERVAL_MS = 30 * 60 * 1000;
setInterval(backfillFechasPublicacion, BACKFILL_FECHA_INTERVAL_MS);
setTimeout(backfillFechasPublicacion, 90 * 1000);

// Disparo manual — útil para vaciar de una vez el backlog inicial la
// primera vez que se despliega este cambio (llamar varias veces seguidas
// si "pendientes" sigue siendo grande; cada llamada procesa hasta
// BACKFILL_FECHA_LOTE códigos nuevos).
app.get("/mp/backfill-fechas", async (req, res) => {
  await backfillFechasPublicacion();
  res.json({ ok: true, state: backfillFechaState });
});
app.get("/mp/backfill-fechas-status", (req, res) => res.json(backfillFechaState));

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
      // Ver nota en /buscar: "tipo=SC" no es un parámetro válido de la API de MP.
      const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
      const pool = (await fetchConReintentos(mpUrl, controller, "precalentar:activas")) || [];
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
              monto:       parseMontoMP(det.MontoEstimado),
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
// Consulta los casos donde el sistema de keywords rescató una licitación
// que la IA había descartado — para revisar si hay un patrón que valga la
// pena corregir en el prompt de clasificación. Sin este endpoint, este tipo
// de error de la IA solo se detecta por casualidad.
app.get("/mp/desacuerdos-ia", async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/keywords_rescates_ia?select=*&order=detectado_en.desc&limit=200`,
      { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return res.status(502).json({ error: "No se pudo consultar Supabase" });
    const data = await r.json();
    res.json({ total: data.length, desacuerdos: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/mp/debug-clasificacion/:codigo", async (req, res) => {
  const codigo = req.params.codigo;
  try {
    // 1. Consultar listado activo de MP (con reintentos)
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 60000);
    // Ver nota en /buscar: "tipo=SC" no es un parámetro válido de la API de MP.
    const mpUrl = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`;
    const todos = (await fetchConReintentos(mpUrl, controller, "debug:activas")) || [];
    clearTimeout(timeoutId);
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

// ── Diagnóstico: clasificar 2 licitaciones y ver respuesta raw de OpenAI ──
app.get("/mp/debug-clasificar-ia", async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY no configurada" });
  try {
    const controller = new AbortController();
    const sinTipo = await fetchConReintentos(
      `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`,
      controller, "debug-ia"
    );
    const lote = (sinTipo || []).slice(0, 2);
    if (!lote.length) return res.json({ error: "No se pudo traer licitaciones de MP" });
    const items = lote.map(l =>
      [l.CodigoExterno, l.Nombre || "", (l.Descripcion || "").substring(0,200)].filter(Boolean).join(" | ")
    ).join("\n");
    const PROMPT = `Eres clasificador de licitaciones públicas chilenas para LEN Ingeniería (consultora: diseña, estudia, inspecciona — NUNCA construye ni compra).\n\nDIVISIONES ACTIVAS DE LEN:\nzonasur — Hidráulica, hidrología, aguas lluvias, drenaje, cauces, APR, saneamiento, vial, puentes, caminos, planes maestros, seguridad vial. SOLO en regiones Maule(7), Ñuble(16), Biobío(8), Araucanía(9), Los Ríos(14), Los Lagos(10), Aysén(11), Magallanes(12).\ninfra — Mismo alcance técnico que zonasur PERO en norte/centro: Arica(15), Tarapacá(1), Antofagasta(2), Atacama(3), Coquimbo(4), Valparaíso(5), Metropolitana(13), O'Higgins(6). También obras portuarias y costeras.\nito — Inspección técnica, supervisión, fiscalización, AIF, asesoría a la inspección fiscal, contraparte técnica, geomensura. Opera en todo Chile.\nenergia — ERNC, fotovoltaico, eólico, BESS, hidrógeno verde, eficiencia energética, electromovilidad, descarbonización. Opera en todo Chile.\nmineria — SOLO estudios de hidráulica, saneamiento, vial o seguridad vial dentro de faenas mineras. NO insumos ni extracción.\n\nDESCARTAR SIEMPRE (divisiones=[]):\n- Construcción/ejecución directa de obras\n- Suministro, compra, arriendo de materiales o equipos\n- Contratación de persona individual\n- Salud, alimentación, educación, cultura, deporte, turismo, seguridad privada\n- Carrocerías, vehículos, mobiliario, vestuario\n- Mataderos, agroindustria, asesoría psicosocial/contable/jurídica\n\nREGLA REGIONAL: La región donde se EJECUTA el trabajo determina zonasur vs infra.\n\nResponde SOLO con JSON array sin texto previo ni markdown:\n[{"codigo":"X","divisiones":["zonasur"],"veredicto":"🟢","razon":"breve razón"}]`;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini", max_tokens: 400, temperature: 0.1,
        messages: [
          { role: "system", content: PROMPT },
          { role: "user",   content: `Clasifica estas 2 licitaciones:\n${items}` }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
    const d        = await r.json();
    const rawText  = d.choices?.[0]?.message?.content || "";
    const clean    = rawText.replace(/```json|```/g, "").trim();
    const match    = clean.match(/\[[\s\S]*\]/);
    let parsed     = null;
    let parseError = null;
    try { parsed = JSON.parse(match ? match[0] : "[]"); }
    catch(e) { parseError = e.message; }
    res.json({
      licitaciones_enviadas: lote.map(l => ({ codigo: l.CodigoExterno, titulo: l.Nombre })),
      prompt_usuario: items,
      openai_status: r.status,
      raw_response: rawText,
      clean_response: clean,
      regex_match: match ? match[0] : null,
      parsed_result: parsed,
      parse_error: parseError
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
      // Ver nota en /buscar: "tipo=SC" no es un parámetro válido de la API de MP.
      const pool = (await fetchConReintentos(`https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${TICKET}`, controller, "clasif-ia:activas")) || [];
      clearTimeout(timeoutId);

      if (!pool.length) {
        clasificacionIAState.estado = "error";
        clasificacionIAState.ultimo_error = "API MP no respondió tras reintentos";
        return;
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

      // 4. Verificar cuáles ya tienen clasificación IA — si existe, NUNCA reclasificar.
      // Las licitaciones publicadas en MP no cambian título ni descripción, así que
      // una clasificación existente es permanentemente válida. Solo se clasifican
      // las genuinamente nuevas que aún no tienen registro en ia_clasificaciones.
      clasificacionIAState.estado = "verificando_cache";
      const yaClasificadas = new Set();
      try {
        const codigos = candidatas.map(l => l.CodigoExterno).filter(Boolean);
        for (let i = 0; i < codigos.length; i += 500) {
          const chunk  = codigos.slice(i, i + 500);
          const inList = chunk.map(c => `"${encodeURIComponent(c)}"`).join(",");
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/ia_clasificaciones?codigo=in.(${inList})&select=codigo`,
            { headers: SUPABASE_HEADERS, signal: AbortSignal.timeout(10000) }
          );
          if (r.ok) {
            for (const row of await r.json()) {
              yaClasificadas.add(row.codigo); // existe = válida para siempre
            }
          }
        }
      } catch(e) { console.warn(`[clasif-ia] Cache check: ${e.message}`); }

      // Límite diario de clasificación. Bajado a 150 (2025-08-03) tras la
      // ráfaga que vació el backlog acumulado (llegó a ~100% de las
      // licitaciones clasificables). 150/día da margen cómodo sobre el
      // ritmo normal de licitaciones nuevas (~90/día estimado), evitando que
      // vuelva a acumularse un backlog grande, con un costo de ~$2/mes.
      const LIMITE_DIARIO_CLASIFICACION = 150;
      const sinClasificarTotal = candidatas
        .filter(l => !yaClasificadas.has(l.CodigoExterno))
        .sort((a, b) => {
          const fa = a.FechaPublicacion ? new Date(a.FechaPublicacion).getTime() : 0;
          const fb = b.FechaPublicacion ? new Date(b.FechaPublicacion).getTime() : 0;
          return fb - fa; // más reciente primero
        });
      const sinClasificar      = sinClasificarTotal.slice(0, LIMITE_DIARIO_CLASIFICACION);
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

      // 6. Clasificar con Claude (Anthropic) por lotes de 10
      clasificacionIAState.estado = "clasificando";
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
      if (!ANTHROPIC_KEY) {
        clasificacionIAState.estado       = "error";
        clasificacionIAState.ultimo_error = "ANTHROPIC_API_KEY no configurada";
        clasificacionIAState.ultimo_fin   = new Date().toISOString();
        console.error("[clasif-ia] ANTHROPIC_API_KEY no configurada");
        return;
      }
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
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type":      "application/json",
              "x-api-key":         ANTHROPIC_KEY,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model:      "claude-haiku-4-5-20251001",
              max_tokens: 1000,
              system:     PROMPT_SISTEMA,
              messages:   [{ role: "user", content: `Clasifica estas ${lote.length} licitaciones:\n${items}` }]
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!r.ok) {
            const errTxt = await r.text();
            console.warn(`[clasif-ia] Anthropic ${r.status} lote ${Math.ceil(i/LOTE)+1}: ${errTxt.substring(0,200)}`);
            totalErrores += lote.length;
            continue;
          }

          const d     = await r.json();
          const txt   = d.content?.[0]?.text || "[]";
          const clean = txt.replace(/```json|```/g, "").trim();
          const match = clean.match(/\[[\s\S]*\]/);

          if (i === 0) {
            console.log(`[clasif-ia] Lote 1 Claude raw: ${txt.substring(0, 400)}`);
            console.log(`[clasif-ia] Lote 1 regex match: ${match ? "SÍ" : "NO"}`);
          }

          let resultados = [];
          try { resultados = JSON.parse(match ? match[0] : "[]"); }
          catch(e) { console.warn(`[clasif-ia] Parse error lote ${Math.ceil(i/LOTE)+1}: ${e.message}`); }

          // Guardar en mp_pool_cache
          const rows = resultados
            .filter(res => res.codigo)
            .map(res => ({
              codigo:        res.codigo,
              divisiones_ia: res.divisiones || [],
              veredicto_ia:  res.veredicto  || "⚪",
              razon_ia:      res.razon       || "",
              clasificado_en: new Date().toISOString()
            }));

          if (rows.length > 0) {
            await fetch(`${SUPABASE_URL}/rest/v1/ia_clasificaciones?on_conflict=codigo`, {
              method: "POST",
              headers: { ...SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates" },
              body: JSON.stringify(rows),
              signal: AbortSignal.timeout(10000)
            }).then(async r => {
              if (r.ok) {
                totalClasificadas += rows.length;
              } else {
                const errTxt = await r.text();
                console.warn(`[clasif-ia] Supabase ${r.status}: ${errTxt.substring(0, 300)}`);
              }
            }).catch(e => console.warn(`[clasif-ia] Supabase save: ${e.message}`));
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

// ── Health check (wake-up para Render free tier) ───────────────────────────
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Arranque del servidor ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor LEN-Licitaciones corriendo en puerto ${PORT}`);
  console.log(`   Helper fetchConReintentos activo (Fase 1)`);
  console.log(`   Polling automático cada ${POLLING_INTERVAL_MS / 1000 / 60 / 60} horas`);
});

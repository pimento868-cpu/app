import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import katex from "katex";

/**
 * Sintaxis para el usuario:
 *   $latex$           -> fórmula en línea (opcional, también auto-detecta)
 *   $$latex$$         -> fórmula en bloque centrada a la izquierda
 *   *texto*           -> texto rojo (título)
 *   _texto_           -> subrayado rojo (resultado)
 */

const DEFAULT_TEXT = `Ejercicio 2.1 - Transformada Discreta de Fourier (DFT) por Definición
*Enunciado:*
Calcula la DFT de la siguiente secuencia discreta de 4 puntos:
$x[n] = \\{1, 1, 0, 0\\}$

Partimos de la ecuación de análisis de la DFT de N puntos:
$$X[k] = \\sum_{n=0}^{N-1} x[n] e^{-j \\frac{2\\pi}{N} k n}$$

Para N = 4, el factor de giro (twiddle factor) base es:
$$W_4 = e^{-j \\frac{2\\pi}{4}} = e^{-j \\frac{\\pi}{2}}$$

Usando la identidad de Euler ($e^{-j\\theta} = \\cos(\\theta) - j\\sin(\\theta)$):
$$W_4 = \\cos\\!\\left(\\tfrac{\\pi}{2}\\right) - j\\sin\\!\\left(\\tfrac{\\pi}{2}\\right) = 0 - j(1) = -j$$

Sustituyendo los valores (x[0]=1, x[1]=1, x[2]=0, x[3]=0):
$$X[k] = 1 + (-j)^{k}$$

Evaluamos para cada k:
  k=0 : $X[0] = 1 + (-j)^{0} = 2$
  k=1 : $X[1] = 1 + (-j)^{1} = 1 - j$
  k=2 : $X[2] = 1 + (-j)^{2} = 0$
  k=3 : $X[3] = 1 + (-j)^{3} = 1 + j$

*Resultado Final:*  _$X[k] = \\{2,\\; 1-j,\\; 0,\\; 1+j\\}$_`;

const HAND_FONTS = [
    "Caveat",
    "Homemade Apple",
    "Shadows Into Light",
    "Architects Daughter",
    "Reenie Beanie",
    "Gloria Hallelujah",
    "Indie Flower",
];

/* URL del fondo por defecto del escritorio */
const DEFAULT_BG_URL =
    "https://customer-assets.emergentagent.com/job_notebook-writer-2/artifacts/i5wy1xq9_WhatsApp%20Image%202026-04-29%20at%208.11.27%20PM.jpeg";

const STORAGE_KEY = "notebook-state-v2";

/* ============================================================
   1) LIMPIEZA del pegado de ChatGPT
   ============================================================ */

function normalizeUnicode(s) {
    return s
        .replace(/\u2061/g, "")
        .replace(/\u2062/g, "")
        .replace(/\u2063/g, "")
        .replace(/\u2009/g, " ")
        .replace(/\u00A0/g, " ");
}

function dedupeChatGPTLine(raw) {
    let line = normalizeUnicode(raw);

    const anchorRe =
        /([A-Za-z][A-Za-z0-9_]*(?:\[[A-Za-z0-9,+\- ]+\])?)\s+=\s+/g;

    for (let guard = 0; guard < 5; guard++) {
        const anchors = [...line.matchAll(anchorRe)];
        let changed = false;
        for (const m of anchors) {
            const fullId = m[1];
            const anchorPos = m.index;
            for (let start = 0; start < fullId.length; start++) {
                const id2 = fullId.slice(start);
                if (!/^[A-Za-z]/.test(id2)) continue;
                const id1 = id2.replace(/_/g, "");
                const esc = id1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const id2pos = anchorPos + start;
                const before = line.slice(0, id2pos);
                const prettyRe = new RegExp("(^|[^A-Za-z0-9_])" + esc + "=");
                const pm = before.match(prettyRe);
                if (!pm) continue;
                const prettyStart = pm.index + pm[1].length;
                const middle = line.slice(prettyStart, id2pos);
                const looksPretty =
                    /[∑π θ−²³·∫∞→⟂]/.test(middle) || /=[^\s]/.test(middle);
                if (!looksPretty) continue;
                line = line.slice(0, prettyStart) + line.slice(id2pos);
                changed = true;
                break;
            }
            if (changed) break;
        }
        if (!changed) break;
    }

    line = line.replace(
        /([A-Za-z][A-Za-z0-9]*(?:\[[A-Za-z0-9,+\- ]+\])?)\1/g,
        "$1",
    );
    line = line.replace(
        /([A-Za-z])([A-Za-z0-9]*)(\[[A-Za-z0-9,+\- ]+\])\1_\2\3/g,
        "$1_$2$3",
    );
    line = line.replace(
        /\b(\d{1,2})\1\b(?=\s+[A-Za-z]|\s*[):,.?!])/g,
        "$1",
    );
    line = line
        .replace(/−/g, "-")
        .replace(/·/g, "\\cdot ")
        .replace(/→/g, "\\to ");

    return line;
}

const LATEX_MARKERS =
    /\\[a-zA-Z]+|[_^]\{|\\\{|\\\}|\\frac|\\sum|\\int|\\cos|\\sin|\\theta|\\pi|\\alpha|\\beta|[A-Za-z]_[A-Za-z0-9]|\^[0-9A-Za-z]/;

function splitSegments(line) {
    const cleaned = dedupeChatGPTLine(line);
    const segments = [];
    const re = /(\${1,2})([\s\S]+?)\1/g;
    let last = 0;
    let m;
    while ((m = re.exec(cleaned)) !== null) {
        if (m.index > last) {
            segments.push({ type: "text", value: cleaned.slice(last, m.index) });
        }
        segments.push({
            type: m[1] === "$$" ? "mathDisplay" : "math",
            value: m[2],
        });
        last = m.index + m[0].length;
    }
    if (last < cleaned.length) {
        segments.push({ type: "text", value: cleaned.slice(last) });
    }

    if (
        segments.length === 1 &&
        segments[0].type === "text" &&
        LATEX_MARKERS.test(segments[0].value)
    ) {
        return [{ type: "mathDisplay", value: segments[0].value.trim() }];
    }
    return segments;
}

function parseText(str, autoTitle) {
    const out = [];
    const re = /(\*[^*]+\*)|(_[^_]+_)/g;
    let last = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
        if (m.index > last) {
            out.push({
                text: str.slice(last, m.index),
                cls: autoTitle ? "title" : "blue",
            });
        }
        if (m[1]) out.push({ text: m[1].slice(1, -1), cls: "title" });
        else if (m[2])
            out.push({ text: m[2].slice(1, -1), cls: "underline-red" });
        last = m.index + m[0].length;
    }
    if (last < str.length) {
        out.push({
            text: str.slice(last),
            cls: autoTitle ? "title" : "blue",
        });
    }
    return out;
}

function renderMathHTML(tex, displayMode) {
    try {
        return katex.renderToString(tex, {
            throwOnError: false,
            displayMode,
            output: "html",
            strict: "ignore",
            trust: false,
        });
    } catch {
        return `<span style="color:#c0392b">${tex}</span>`;
    }
}

function prng(a, b) {
    const x = Math.sin((a + 1) * 78.233 + (b + 1) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
}

/* =========================================================================
   HandText
   -------------------------------------------------------------------------
   FIX IMPORTANTE: el motor anterior tenía un caso `isSkip` que volvía
   ~1-3% de los caracteres prácticamente invisibles (opacity 0.28-0.50)
   y, combinado con `mix-blend-mode: multiply` sobre el papel, se "comían"
   letras dejando huecos (ej: "Ej rcio" en vez de "Ejercicio").
   También permitía `marginRight` negativo, lo que provocaba que letras
   se solapasen entre sí.
   Ahora:
     - Eliminamos por completo el `isSkip` (ya no hay letras casi en blanco).
     - Garantizamos opacity mínima >= 0.7 para texto normal.
     - Forzamos `marginRight >= 0` (sin solapes).
   ========================================================================= */
function HandText({ text, cls, seed, ink = 0.4, vv = 0.5, hv = 0.45 }) {
    const tokens = [];
    let cur = "";
    let curType = null;
    for (const ch of text) {
        const t = /\s/.test(ch) ? "space" : "word";
        if (t !== curType) {
            if (cur) tokens.push({ type: curType, value: cur });
            cur = ch;
            curType = t;
        } else cur += ch;
    }
    if (cur) tokens.push({ type: curType, value: cur });

    const totalLen = Math.max(1, text.length);
    let cumLen = 0;
    const out = [];

    const blobP = 0.005 + ink * 0.04;
    const heavyP = 0.12 + ink * 0.1;
    const lightP = 0.1 + ink * 0.08;
    const dotP = 0.01 + ink * 0.04;
    const opMin = 0.86 - ink * 0.16; // mínimo aún muy legible
    const opRange = 0.05 + ink * 0.1;

    tokens.forEach((tok, ti) => {
        if (tok.type === "space") {
            const w = 0.24 + prng(seed, ti * 11) * 0.08 * hv;
            out.push(
                <span
                    key={ti}
                    style={{
                        display: "inline-block",
                        width: `${w * tok.value.length}em`,
                    }}
                >
                    {"\u00A0"}
                </span>,
            );
            cumLen += tok.value.length;
            return;
        }

        const wr1 = prng(seed, ti * 17 + 5);
        const wr2 = prng(seed, ti * 17 + 7);
        const wr4 = prng(seed, ti * 17 + 11);
        const wRot = (wr1 - 0.5) * 1.2 * vv;
        // wDy reducido a la mitad: las palabras siguen mejor la línea base
        const wDy = (wr2 - 0.5) * 1.2 * vv;
        const wDx = (wr4 - 0.5) * 1.2 * hv;
        // Sin lineLift/lineTilt sistemáticos: el texto se queda sobre la línea
        // (antes derivaba siempre hacia arriba al final de cada renglón).
        const lineTilt = 0;
        const lineLift = 0;

        const chars = [];
        const word = [...tok.value];
        word.forEach((ch, ci) => {
            const r1 = prng(seed + ti * 41, ci * 3 + 1);
            const r2 = prng(seed + ti * 41, ci * 3 + 2);
            const r3 = prng(seed + ti * 41, ci * 3 + 3);
            const r4 = prng(seed + ti * 41, ci * 3 + 4);
            const rot = (r1 - 0.5) * 1.6 * vv;
            // dy reducido: cada letra se mantiene cerca de la línea base
            const dy = (r2 - 0.5) * 0.9 * vv;
            const dx = (r4 - 0.5) * 0.8 * hv;
            // Letter spacing SOLO aditivo: nunca deja que las letras se solapen
            const letterSpacingPx = Math.max(0, (r4 - 0.3) * 0.6 * hv);
            const scale = 1 + (r3 - 0.5) * (0.03 * vv + 0.03 * hv);

            const isBlob = r2 > 1 - blobP;
            const isHeavy = !isBlob && r1 > 1 - heavyP;
            const isLight = !isBlob && !isHeavy && r1 < lightP;

            let opacity = opMin + r1 * opRange;
            if (isBlob) opacity = 0.95 + r1 * 0.05;
            if (isHeavy) opacity = Math.min(1, opacity + 0.1);
            if (isLight) opacity = Math.max(0.7, opacity - 0.08);

            const baseSh = `0.1px 0.12px ${0.2 + ink * 0.2}px currentColor`;
            const bleed = isBlob
                ? `0 0 ${1.0 + ink * 0.8}px currentColor, 0.35px 0.4px ${0.7 + ink * 0.4}px currentColor, -0.2px 0.15px ${0.4 + ink * 0.3}px currentColor`
                : isHeavy
                  ? `0 0 ${0.5 + ink * 0.4}px currentColor, 0.2px 0.22px ${0.35 + ink * 0.2}px currentColor`
                  : isLight
                    ? "none"
                    : baseSh;

            const hasDot = r3 > 1 - dotP;

            chars.push(
                <span
                    key={ci}
                    className={cls}
                    style={{
                        display: "inline-block",
                        position: "relative",
                        transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${scale})`,
                        transformOrigin: "center bottom",
                        marginRight: `${letterSpacingPx}px`,
                        opacity,
                        textShadow: bleed,
                        WebkitTextStroke: isHeavy
                            ? `${0.15 + ink * 0.15}px currentColor`
                            : isBlob
                              ? `${0.25 + ink * 0.2}px currentColor`
                              : "0",
                    }}
                >
                    {ch}
                    {hasDot && (
                        <span
                            aria-hidden="true"
                            style={{
                                position: "absolute",
                                width: `${1.5 + ink * 1.5}px`,
                                height: `${1.5 + ink * 1.5}px`,
                                borderRadius: "50%",
                                background: "currentColor",
                                opacity: 0.5 + ink * 0.2,
                                top: `${60 + r1 * 40}%`,
                                left: `${40 + r2 * 60}%`,
                                pointerEvents: "none",
                            }}
                        />
                    )}
                </span>,
            );
        });

        out.push(
            <span
                key={ti}
                style={{
                    display: "inline-block",
                    transform: `translate(${wDx}px, ${wDy + lineLift}px) rotate(${wRot + lineTilt}deg)`,
                    transformOrigin: "center",
                }}
            >
                {chars}
            </span>,
        );
        cumLen += tok.value.length;
    });
    return out;
}

function jitter(i, hv = 0.45, vv = 0.45) {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const frac = seed - Math.floor(seed);
    const rot = (frac - 0.5) * 0.4 * vv;
    const dx = (frac - 0.5) * 4 * hv;
    const dy = (frac - 0.5) * 1.2 * vv;
    return { rot, dx, dy };
}

function SliderRow({ label, value, onChange, testid, min = 0, max = 100, unit = "%" }) {
    return (
        <div className="slider-row full" data-testid={testid}>
            <div className="slider-head">
                <span>{label}</span>
                <span className="slider-val">
                    {value}
                    {unit}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
            />
        </div>
    );
}

/* =========================================================================
   Render del contenido escrito (líneas + matemáticas) — extraído para
   poderlo reutilizar en miniaturas
   ========================================================================= */
function RenderedHandwriting({
    text,
    font,
    size,
    cell,
    ink,
    vv,
    hv,
    mathJitter,
    plain = false, // si true: sin jitter, sin html2canvas, render rápido para miniaturas
}) {
    const lines = useMemo(() => text.split("\n"), [text]);
    return (
        <div
            className="handwriting"
            style={{
                fontFamily: `"${font}", cursive`,
                fontSize: `${size}px`,
                lineHeight: `${cell}px`,
            }}
            data-testid={plain ? "handwriting-mini" : "handwriting"}
        >
            {text.trim() === "" ? (
                <span className="empty-hint">
                    Tu texto aparecerá aquí…
                </span>
            ) : (
                lines.map((raw, i) => {
                    const segs = splitSegments(raw);
                    const autoTitle =
                        /^\s*Ejercicio\b/i.test(raw) ||
                        /^\s*\d+\s*[-–]/.test(raw);
                    const { rot, dx, dy } = plain
                        ? { rot: 0, dx: 0, dy: 0 }
                        : jitter(i, hv, vv);
                    const mj = plain ? 0 : mathJitter / 100;
                    const mathJitterT = `rotate(${(prng(i, 7) - 0.5) * 2.5 * mj}deg) translateY(${(prng(i, 9) - 0.5) * 4 * mj}px)`;

                    if (
                        segs.length === 0 ||
                        (segs.length === 1 &&
                            segs[0].type === "text" &&
                            segs[0].value.trim() === "")
                    ) {
                        return (
                            <span
                                key={i}
                                className="ln"
                                style={{
                                    transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                                }}
                            >
                                {"\u00A0"}
                            </span>
                        );
                    }

                    return (
                        <span
                            key={i}
                            className="ln"
                            style={{
                                transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                            }}
                        >
                            {segs.map((seg, j) => {
                                if (seg.type === "math") {
                                    return (
                                        <span
                                            key={j}
                                            className="math-inline"
                                            style={{
                                                transform: mathJitterT,
                                                opacity:
                                                    0.84 +
                                                    prng(i, j) * 0.12,
                                            }}
                                            dangerouslySetInnerHTML={{
                                                __html: renderMathHTML(
                                                    seg.value,
                                                    false,
                                                ),
                                            }}
                                        />
                                    );
                                }
                                if (seg.type === "mathDisplay") {
                                    return (
                                        <span
                                            key={j}
                                            className="math-display"
                                            style={{
                                                transform: mathJitterT,
                                                opacity:
                                                    0.86 +
                                                    prng(i, j) * 0.1,
                                            }}
                                            dangerouslySetInnerHTML={{
                                                __html: renderMathHTML(
                                                    seg.value,
                                                    true,
                                                ),
                                            }}
                                        />
                                    );
                                }
                                const parts = parseText(seg.value, autoTitle);
                                if (plain) {
                                    return (
                                        <span key={j}>
                                            {parts.map((p, k) => (
                                                <span
                                                    key={k}
                                                    className={p.cls}
                                                >
                                                    {p.text}
                                                </span>
                                            ))}
                                        </span>
                                    );
                                }
                                return (
                                    <span key={j}>
                                        {parts.map((p, k) => (
                                            <HandText
                                                key={k}
                                                text={p.text}
                                                cls={p.cls}
                                                seed={
                                                    i * 131 +
                                                    k * 17 +
                                                    j * 3
                                                }
                                                ink={ink}
                                                vv={vv}
                                                hv={hv}
                                            />
                                        ))}
                                    </span>
                                );
                            })}
                        </span>
                    );
                })
            )}
        </div>
    );
}

/* ============================================================
   Componente principal
   ============================================================ */

function loadInitialState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export default function Notebook() {
    const saved = loadInitialState();

    const [text, setText] = useState(saved?.text ?? DEFAULT_TEXT);
    const [headerText, setHeaderText] = useState(saved?.headerText ?? "");
    const [cell, setCell] = useState(saved?.cell ?? 26);
    const [font, setFont] = useState(saved?.font ?? "Caveat");
    const [size, setSize] = useState(saved?.size ?? 22);
    const [inkIntensity, setInkIntensity] = useState(saved?.inkIntensity ?? 35);
    const [vertVariation, setVertVariation] = useState(saved?.vertVariation ?? 45);
    const [horizVariation, setHorizVariation] = useState(saved?.horizVariation ?? 45);
    const [paperTexture, setPaperTexture] = useState(saved?.paperTexture ?? 35);
    const [mathJitter, setMathJitter] = useState(saved?.mathJitter ?? 30);
    const [paperDefects, setPaperDefects] = useState(saved?.paperDefects ?? 40);
    const [paperRot, setPaperRot] = useState(
        saved?.paperRot ?? Number(((Math.random() - 0.5) * 8).toFixed(1)),
    );
    const [paperTilt, setPaperTilt] = useState(saved?.paperTilt ?? 8);
    const [paperCurve, setPaperCurve] = useState(saved?.paperCurve ?? 20);
    const [bgScale, setBgScale] = useState(saved?.bgScale ?? 100);
    const [bgX, setBgX] = useState(saved?.bgX ?? 0);
    const [bgY, setBgY] = useState(saved?.bgY ?? 0);
    const [allBlack, setAllBlack] = useState(saved?.allBlack ?? false);
    const [customBg, setCustomBg] = useState(saved?.customBg ?? null); // data URL o null
    const [currentPage, setCurrentPage] = useState(saved?.currentPage ?? 0);

    /* ===== Multi-página: cortes calculados por línea (sin partir letras) ===== */
    const [pageOffsets, setPageOffsets] = useState([0]);
    const [pageStep, setPageStep] = useState(520);
    const [gridPadBottom, setGridPadBottom] = useState(22);

    const sheetRef = useRef(null);
    const gridBoxRef = useRef(null);
    const handwritingRef = useRef(null);
    const workspaceRef = useRef(null);
    const fileInputRef = useRef(null);
    const dragRef = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });

    const ink = inkIntensity / 100;
    const vv = vertVariation / 100;
    const hv = horizVariation / 100;

    /* Persistencia en localStorage */
    useEffect(() => {
        const data = {
            text, headerText, cell, font, size, inkIntensity, vertVariation,
            horizVariation, paperTexture, mathJitter, paperDefects,
            paperRot, paperTilt, paperCurve, bgScale, bgX, bgY,
            allBlack, customBg, currentPage,
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            /* localStorage lleno (probablemente customBg muy grande) */
        }
    }, [text, headerText, cell, font, size, inkIntensity, vertVariation, horizVariation,
        paperTexture, mathJitter, paperDefects, paperRot, paperTilt,
        paperCurve, bgScale, bgX, bgY, allBlack, customBg, currentPage]);

    /* Recalcular cortes de página: cada página debe romper SIEMPRE entre
       líneas completas, nunca a media letra. Medimos cada línea (.ln)
       renderizada y empezamos una nueva página justo en la primera
       línea que no quepa entera. */
    useLayoutEffect(() => {
        const hw = handwritingRef.current;
        const gb = gridBoxRef.current;
        if (!hw || !gb) return;
        const measure = () => {
            // Calculamos el área útil de escritura como un MÚLTIPLO EXACTO
            // de la celda. Así nunca queda media celda visible en el borde
            // inferior, y cada página contiene un número entero de líneas.
            const cs = getComputedStyle(gb);
            const padT = parseFloat(cs.paddingTop) || 0;
            const clientH = gb.clientHeight;
            const usable = clientH - padT;
            // Reservamos al menos un poco para que no se pegue al borde
            const steps = Math.max(1, Math.floor((usable - 4) / cell));
            const step = steps * cell;
            const newPadB = Math.max(4, usable - step);
            setPageStep(step);
            setGridPadBottom(newPadB);

            const handDiv = hw.firstElementChild;
            if (!handDiv) {
                setPageOffsets([0]);
                return;
            }
            const lines = Array.from(handDiv.children);
            if (lines.length === 0) {
                setPageOffsets([0]);
                return;
            }
            const offsets = [0];
            let currentTop = 0;
            const totalH = handDiv.scrollHeight;
            for (let i = 0; i < lines.length; i++) {
                const lineTop = lines[i].offsetTop;
                const lineBottom =
                    i + 1 < lines.length
                        ? lines[i + 1].offsetTop
                        : totalH;
                // Si esta línea no cabe entera en la página actual,
                // y NO es la primera línea de la página, la mandamos
                // a la siguiente.
                if (
                    lineBottom - currentTop > step + 0.5 &&
                    lineTop > currentTop + 0.5
                ) {
                    offsets.push(lineTop);
                    currentTop = lineTop;
                }
            }
            setPageOffsets(offsets);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(hw);
        ro.observe(gb);
        return () => ro.disconnect();
    }, [text, cell, size, font, vertVariation, horizVariation, mathJitter]);

    const pageCount = pageOffsets.length;

    /* Si la página actual queda fuera de rango, ajustar */
    useEffect(() => {
        if (currentPage >= pageCount) {
            setCurrentPage(Math.max(0, pageCount - 1));
        }
    }, [pageCount, currentPage]);

    /* Drag del fondo */
    const onBgPointerDown = useCallback((e) => {
        const target = e.target;
        if (!target.closest) return;
        if (
            target.closest(".sheet") ||
            target.closest(".panel") ||
            target.closest(".pages-rail") ||
            target.closest(".overflow-warning")
        ) {
            return;
        }
        dragRef.current = {
            active: true,
            sx: e.clientX,
            sy: e.clientY,
            ox: bgX,
            oy: bgY,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }, [bgX, bgY]);

    const onBgPointerMove = useCallback((e) => {
        if (!dragRef.current.active) return;
        const { sx, sy, ox, oy } = dragRef.current;
        setBgX(ox + (e.clientX - sx));
        setBgY(oy + (e.clientY - sy));
    }, []);

    const onBgPointerUp = useCallback(() => {
        dragRef.current.active = false;
    }, []);

    const handleExport = async (format = "png") => {
        if (!sheetRef.current) return;
        try {
            const canvas = await html2canvas(sheetRef.current, {
                backgroundColor: format === "jpg" ? "#1f1d1f" : null,
                scale: 2,
                useCORS: true,
            });
            if (format === "pdf") {
                const imgData = canvas.toDataURL("image/png");
                const pdf = new jsPDF({
                    orientation:
                        canvas.width > canvas.height ? "landscape" : "portrait",
                    unit: "px",
                    format: [canvas.width, canvas.height],
                });
                pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
                pdf.save(`cuaderno-hoja-${currentPage + 1}.pdf`);
                return;
            }
            const mime = format === "jpg" ? "image/jpeg" : "image/png";
            const ext = format === "jpg" ? "jpg" : "png";
            const link = document.createElement("a");
            link.download = `cuaderno-hoja-${currentPage + 1}.${ext}`;
            link.href = canvas.toDataURL(mime, 0.95);
            link.click();
        } catch (e) {
            alert("No se pudo exportar: " + e.message);
        }
    };

    const handleClear = () => {
        if (confirm("¿Borrar el texto?")) {
            setText("");
            setCurrentPage(0);
        }
    };

    const handleResetText = () => {
        setText(DEFAULT_TEXT);
        setCurrentPage(0);
    };

    const randomizeRotation = () => {
        setPaperRot(Number(((Math.random() - 0.5) * 24).toFixed(1)));
        setPaperTilt(Math.round(4 + Math.random() * 14));
    };

    const resetBgPosition = () => {
        setBgScale(100);
        setBgX(0);
        setBgY(0);
    };

    /* === Carga / reseteo de imagen de fondo === */
    const handleBgUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            alert("El archivo debe ser una imagen");
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            setCustomBg(ev.target.result);
        };
        reader.onerror = () => alert("No se pudo leer la imagen");
        reader.readAsDataURL(file);
        // limpiar el input para poder volver a cargar la misma imagen
        e.target.value = "";
    };

    const resetBgImage = () => {
        setCustomBg(null);
        resetBgPosition();
    };

    const bgUrl = customBg || DEFAULT_BG_URL;

    return (
        <div
            className="workspace"
            data-testid="workspace"
            ref={workspaceRef}
            onPointerDown={onBgPointerDown}
            onPointerMove={onBgPointerMove}
            onPointerUp={onBgPointerUp}
            onPointerCancel={onBgPointerUp}
            style={{
                "--bg-scale": `${bgScale}%`,
                "--bg-x": `${bgX}px`,
                "--bg-y": `${bgY}px`,
                "--bg-image": `url("${bgUrl}")`,
            }}
        >
            {/* Panel IZQUIERDO: solo entrada de texto */}
            <aside
                className="panel panel-left"
                data-testid="text-panel"
            >
                <h1>Mi Cuaderno</h1>
                <p className="subtitle">
                    Escribe tu texto aquí — las fórmulas LaTeX (con{" "}
                    <code style={{ color: "#f5c27a" }}>$...$</code> o{" "}
                    <code style={{ color: "#f5c27a" }}>$$...$$</code>) se dibujan
                    como ecuaciones reales. Si el texto no cabe, se crearán nuevas
                    hojas automáticamente.
                </p>

                <label htmlFor="txt">Texto</label>
                <textarea
                    id="txt"
                    data-testid="text-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Escribe aquí tu texto..."
                    spellCheck={false}
                />

                <label htmlFor="header-txt">Hoja superior (encabezado)</label>
                <textarea
                    id="header-txt"
                    data-testid="header-text-input"
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder={'Ej:\nNombre / Materia\nFecha'}
                    spellCheck={false}
                    style={{ minHeight: 70 }}
                />

                <div className="tips">
                    Tips de formato:
                    <br />• Fórmulas entre <code>$...$</code> (en línea) o{" "}
                    <code>$$...$$</code> (bloque).
                    <br />• <code>*texto*</code> → título rojo; líneas que
                    empiezan con <code>Ejercicio</code> o <code>N -</code>{" "}
                    también.
                    <br />• <code>_texto_</code> → subrayado rojo (resultados).
                </div>

                <div className="text-actions">
                    <button
                        data-testid="reset-btn"
                        className="btn"
                        onClick={handleResetText}
                    >
                        Texto ejemplo
                    </button>
                    <button
                        data-testid="clear-btn"
                        className="btn"
                        onClick={handleClear}
                    >
                        Borrar
                    </button>
                </div>
            </aside>

            {/* Lienzo / hoja */}
            <section className="canvas-area" data-testid="canvas-area">
                <div
                    className={`sheet${allBlack ? " all-black" : ""}`}
                    ref={sheetRef}
                    data-testid="sheet"
                    style={{
                        "--cell": `${cell}px`,
                        "--font-size": `${size}px`,
                        "--paper-grain": paperTexture / 100,
                        "--hand-font": `"${font}"`,
                        "--math-j": mathJitter / 100,
                        "--defects": paperDefects / 100,
                        "--paper-rot": `${paperRot}deg`,
                        "--paper-tilt": `${paperTilt}deg`,
                    }}
                >
                    <div className="lamp-light" aria-hidden="true" />
                    <div className="lamp-shadow" aria-hidden="true" />
                    <div className="micro-wrinkles" aria-hidden="true" />
                    <div className="header-box" data-testid="header-box">
                        <div
                            className="header-handwriting handwriting"
                            data-testid="header-handwriting"
                            style={{
                                fontFamily: `"${font}", cursive`,
                                fontSize: `${size}px`,
                            }}
                        >
                            {headerText.trim() === "" ? null : (
                                headerText.split("\n").slice(0, 2).map((raw, i) => {
                                    const segs = splitSegments(raw);
                                    const autoTitle =
                                        /^\s*Ejercicio\b/i.test(raw) ||
                                        /^\s*\d+\s*[-–]/.test(raw);
                                    if (
                                        segs.length === 0 ||
                                        (segs.length === 1 &&
                                            segs[0].type === "text" &&
                                            segs[0].value.trim() === "")
                                    ) {
                                        return (
                                            <span key={i} className="header-ln">
                                                {"\u00A0"}
                                            </span>
                                        );
                                    }
                                    return (
                                        <span key={i} className="header-ln">
                                            {segs.map((seg, j) => {
                                                if (seg.type === "math") {
                                                    return (
                                                        <span
                                                            key={j}
                                                            className="math-inline"
                                                            dangerouslySetInnerHTML={{
                                                                __html: renderMathHTML(seg.value, false),
                                                            }}
                                                        />
                                                    );
                                                }
                                                if (seg.type === "mathDisplay") {
                                                    return (
                                                        <span
                                                            key={j}
                                                            className="math-inline"
                                                            dangerouslySetInnerHTML={{
                                                                __html: renderMathHTML(seg.value, false),
                                                            }}
                                                        />
                                                    );
                                                }
                                                const parts = parseText(seg.value, autoTitle);
                                                return (
                                                    <span key={j}>
                                                        {parts.map((p, k) => (
                                                            <HandText
                                                                key={k}
                                                                text={p.text}
                                                                cls={p.cls}
                                                                seed={1000 + i * 131 + k * 17 + j * 3}
                                                                ink={ink}
                                                                vv={vv}
                                                                hv={hv}
                                                            />
                                                        ))}
                                                    </span>
                                                );
                                            })}
                                        </span>
                                    );
                                })
                            )}
                        </div>
                    </div>
                    <div
                        className="grid-box"
                        data-testid="grid-box"
                        ref={gridBoxRef}
                        style={{
                            filter:
                                paperCurve > 0
                                    ? "url(#paperWarp)"
                                    : "none",
                        }}
                    >
                        <div
                            className="page-window"
                            style={{
                                transform: `translateY(${-pageOffsets[currentPage] || 0}px)`,
                            }}
                        >
                            <div ref={handwritingRef}>
                                <RenderedHandwriting
                                    text={text}
                                    font={font}
                                    size={size}
                                    cell={cell}
                                    ink={ink}
                                    vv={vv}
                                    hv={hv}
                                    mathJitter={mathJitter}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* RAIL DE HOJAS (miniaturas) — visible solo si hay 2+ */}
            {pageCount > 1 && (
                <aside
                    className="pages-rail"
                    data-testid="pages-rail"
                >
                    <h3 className="pages-rail-title">Hojas</h3>
                    <div className="pages-rail-list">
                        {pageOffsets.map((off, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`page-thumb${i === currentPage ? " active" : ""}`}
                                onClick={() => setCurrentPage(i)}
                                data-testid={`page-thumb-${i}`}
                                aria-label={`Ir a hoja ${i + 1}`}
                            >
                                <div className="page-thumb-paper">
                                    <div
                                        className="page-thumb-content"
                                        style={{
                                            transform: `scale(0.13) translateY(${-off}px)`,
                                            transformOrigin: "top left",
                                            width: `${100 / 0.13}%`,
                                        }}
                                    >
                                        <RenderedHandwriting
                                            text={text}
                                            font={font}
                                            size={size}
                                            cell={cell}
                                            ink={ink}
                                            vv={0}
                                            hv={0}
                                            mathJitter={0}
                                            plain
                                        />
                                    </div>
                                </div>
                                <span className="page-thumb-label">
                                    Hoja {i + 1}
                                </span>
                            </button>
                        ))}
                    </div>
                </aside>
            )}

            {/* Panel DERECHO: configuraciones */}
            <aside
                className="panel panel-right"
                data-testid="controls-panel"
            >
                <h2 className="panel-title">Configuración</h2>
                <div className="controls">
                    <div className="select-wrap">
                        <label
                            style={{
                                margin: 0,
                                textTransform: "none",
                                letterSpacing: 0,
                            }}
                        >
                            Tipografía
                        </label>
                        <select
                            data-testid="font-select"
                            value={font}
                            onChange={(e) => setFont(e.target.value)}
                        >
                            {HAND_FONTS.map((f) => (
                                <option key={f} value={f}>
                                    {f}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="select-wrap">
                        <label
                            style={{
                                margin: 0,
                                textTransform: "none",
                                letterSpacing: 0,
                            }}
                        >
                            Tamaño letra
                        </label>
                        <input
                            data-testid="font-size-input"
                            type="number"
                            min={14}
                            max={34}
                            value={size}
                            onChange={(e) =>
                                setSize(
                                    Math.max(
                                        12,
                                        Math.min(40, Number(e.target.value) || 22),
                                    ),
                                )
                            }
                        />
                    </div>
                    <div className="select-wrap full">
                        <label
                            style={{
                                margin: 0,
                                textTransform: "none",
                                letterSpacing: 0,
                            }}
                        >
                            Tamaño cuadrícula (px)
                        </label>
                        <input
                            data-testid="cell-size-input"
                            type="number"
                            min={18}
                            max={40}
                            value={cell}
                            onChange={(e) =>
                                setCell(
                                    Math.max(
                                        16,
                                        Math.min(48, Number(e.target.value) || 26),
                                    ),
                                )
                            }
                        />
                    </div>

                    <label
                        className="full toggle-row"
                        data-testid="all-black-toggle"
                    >
                        <input
                            type="checkbox"
                            checked={allBlack}
                            onChange={(e) => setAllBlack(e.target.checked)}
                        />
                        <span>
                            Letras todo negro (números a lápiz se mantienen)
                        </span>
                    </label>

                    <SliderRow
                        label="Tinta"
                        value={inkIntensity}
                        onChange={setInkIntensity}
                        testid="ink-slider"
                    />
                    <SliderRow
                        label="Variación vertical"
                        value={vertVariation}
                        onChange={setVertVariation}
                        testid="vert-slider"
                    />
                    <SliderRow
                        label="Variación horizontal"
                        value={horizVariation}
                        onChange={setHorizVariation}
                        testid="horiz-slider"
                    />
                    <SliderRow
                        label="Variación de fórmulas"
                        value={mathJitter}
                        onChange={setMathJitter}
                        testid="math-slider"
                    />
                    <SliderRow
                        label="Textura del papel"
                        value={paperTexture}
                        onChange={setPaperTexture}
                        testid="paper-slider"
                    />
                    <SliderRow
                        label="Defectos del papel"
                        value={paperDefects}
                        onChange={setPaperDefects}
                        testid="defects-slider"
                    />

                    <div className="full sheet-rot-row">
                        <SliderRow
                            label="Ángulo de la hoja"
                            value={paperRot}
                            onChange={setPaperRot}
                            testid="rot-slider"
                            min={-30}
                            max={30}
                            unit="°"
                        />
                        <SliderRow
                            label="Inclinación (perspectiva)"
                            value={paperTilt}
                            onChange={setPaperTilt}
                            testid="tilt-slider"
                            min={0}
                            max={30}
                            unit="°"
                        />
                        <SliderRow
                            label="Curvatura del papel"
                            value={paperCurve}
                            onChange={setPaperCurve}
                            testid="curve-slider"
                            min={0}
                            max={100}
                        />
                        <button
                            data-testid="random-rot-btn"
                            className="btn"
                            onClick={randomizeRotation}
                            style={{ marginTop: 4 }}
                            type="button"
                        >
                            Aleatorio
                        </button>
                    </div>

                    {/* Fondo / escritorio */}
                    <div className="full bg-controls">
                        <label
                            style={{
                                margin: "10px 0 4px",
                                textTransform: "none",
                                letterSpacing: 0,
                                fontWeight: 600,
                                color: "#e9dfc6",
                            }}
                        >
                            Fondo (escritorio)
                        </label>

                        <div className="bg-image-buttons">
                            <button
                                data-testid="bg-upload-btn"
                                className="btn"
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Cargar imagen
                            </button>
                            <button
                                data-testid="bg-image-reset-btn"
                                className="btn"
                                type="button"
                                onClick={resetBgImage}
                                title="Volver al fondo por defecto"
                            >
                                Reiniciar
                            </button>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleBgUpload}
                            style={{ display: "none" }}
                            data-testid="bg-file-input"
                        />
                        <p className="bg-hint">
                            {customBg
                                ? "Usando imagen personalizada."
                                : "Usando fondo por defecto."}
                        </p>

                        <SliderRow
                            label="Tamaño"
                            value={bgScale}
                            onChange={setBgScale}
                            testid="bg-scale-slider"
                            min={50}
                            max={300}
                            unit="%"
                        />
                        <SliderRow
                            label="Posición X"
                            value={bgX}
                            onChange={setBgX}
                            testid="bg-x-slider"
                            min={-600}
                            max={600}
                            unit="px"
                        />
                        <SliderRow
                            label="Posición Y"
                            value={bgY}
                            onChange={setBgY}
                            testid="bg-y-slider"
                            min={-600}
                            max={600}
                            unit="px"
                        />
                        <div className="arrow-pad" data-testid="arrow-pad">
                            <button
                                data-testid="bg-up"
                                className="btn arrow"
                                onClick={() => setBgY((v) => v - 20)}
                                type="button"
                                aria-label="Subir fondo"
                            >
                                ↑
                            </button>
                            <div className="arrow-pad-row">
                                <button
                                    data-testid="bg-left"
                                    className="btn arrow"
                                    onClick={() => setBgX((v) => v - 20)}
                                    type="button"
                                    aria-label="Mover fondo a la izquierda"
                                >
                                    ←
                                </button>
                                <button
                                    data-testid="bg-reset"
                                    className="btn arrow"
                                    onClick={resetBgPosition}
                                    type="button"
                                    aria-label="Reiniciar posición del fondo"
                                >
                                    ⟳
                                </button>
                                <button
                                    data-testid="bg-right"
                                    className="btn arrow"
                                    onClick={() => setBgX((v) => v + 20)}
                                    type="button"
                                    aria-label="Mover fondo a la derecha"
                                >
                                    →
                                </button>
                            </div>
                            <button
                                data-testid="bg-down"
                                className="btn arrow"
                                onClick={() => setBgY((v) => v + 20)}
                                type="button"
                                aria-label="Bajar fondo"
                            >
                                ↓
                            </button>
                        </div>
                        <p className="bg-hint">
                            Tip: También puedes <b>arrastrar</b> el fondo
                            haciendo clic fuera de la hoja.
                        </p>
                    </div>

                    <div className="full download-group">
                        <label
                            style={{
                                margin: 0,
                                textTransform: "none",
                                letterSpacing: 0,
                            }}
                        >
                            Descargar (hoja actual)
                        </label>
                        <div className="download-buttons">
                            <button
                                data-testid="export-png-btn"
                                className="btn primary"
                                onClick={() => handleExport("png")}
                            >
                                PNG
                            </button>
                            <button
                                data-testid="export-jpg-btn"
                                className="btn"
                                onClick={() => handleExport("jpg")}
                            >
                                JPG
                            </button>
                            <button
                                data-testid="export-pdf-btn"
                                className="btn"
                                onClick={() => handleExport("pdf")}
                            >
                                PDF
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* SVG filter para curvatura */}
            <svg
                aria-hidden="true"
                style={{
                    position: "absolute",
                    width: 0,
                    height: 0,
                    pointerEvents: "none",
                }}
            >
                <defs>
                    <filter
                        id="paperWarp"
                        x="-2%"
                        y="-2%"
                        width="104%"
                        height="104%"
                    >
                        <feTurbulence
                            type="fractalNoise"
                            baseFrequency="0.008 0.012"
                            numOctaves="2"
                            seed="7"
                            result="warp"
                        />
                        <feDisplacementMap
                            in="SourceGraphic"
                            in2="warp"
                            scale={(paperCurve / 100) * 14}
                            xChannelSelector="R"
                            yChannelSelector="G"
                        />
                    </filter>
                </defs>
            </svg>
        </div>
    );
}

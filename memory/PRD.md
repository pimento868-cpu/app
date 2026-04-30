# Mi Cuaderno - Simulador de hoja cuadriculada manuscrita

## Original problem statement
Trabajo previo: simulador que renderiza texto como una hoja de cuaderno cuadriculado con escritura a mano, fórmulas LaTeX y fondo de escritorio realista. Esta iteración pidió tres mejoras concretas:

1. **Multi-página por overflow**: cuando el texto excede la hoja, en lugar de mostrar un aviso debe crearse otra hoja. Las hojas se listan a la derecha (junto a los ajustes) como miniaturas etiquetadas “Hoja 1, Hoja 2, …”. Al hacer clic se carga esa hoja en el escritorio. Capacidad alta (10+ hojas, idealmente ilimitada).
2. **Imagen de fondo personalizable**: por defecto se mantiene el escritorio actual; un botón permite cargar otra imagen y un botón de reinicio vuelve al fondo por defecto.
3. **Bug crítico de render**: el motor de texto manuscrito se “comía” letras al azar, dejando huecos (ej. *“Ej rcio”* en lugar de *“Ejercicio”*, *“scuenci”* en lugar de *“secuencia”*). Probable causa: ligaduras / kerning / overlap o caché.

Persistencia: las hojas y configuraciones deben mantenerse al recargar.

Código base de partida: https://github.com/pa683377-bit/app.git

## Architecture
- **Frontend**: React 19 + CRA (craco), Tailwind, shadcn/ui, KaTeX, html2canvas, jsPDF.
- **Backend**: FastAPI + Mongo (sin uso real en esta iteración; se mantiene el endpoint placeholder `/api`).
- Estado y todas las preferencias persistidas en `localStorage` (clave `notebook-state-v2`).

## What's been implemented (2026-04-30)
- Clonado el repositorio base y montado en `/app`.
- **Bug fix del motor de texto** (`HandText` en `Notebook.jsx`):
  - Eliminado por completo el caso `isSkip` que ponía caracteres a opacity 0.28-0.50 y, combinado con `mix-blend-mode: multiply`, los hacía invisibles sobre el papel.
  - Elevada la opacity mínima para texto normal (~0.7).
  - Forzado `marginRight >= 0` (impide que las letras se solapen y se cancelen).
- **Sistema multi-página automático** por overflow:
  - El alto total del contenido se mide con `ResizeObserver` sobre un único contenedor `.handwriting`.
  - El número de hojas = `ceil(scrollHeight / pageStep)` donde `pageStep` es múltiplo de la celda de la cuadrícula (snap a línea).
  - Render con ventana deslizante: `transform: translateY(-page * pageStep)` dentro de `.grid-box { overflow: hidden }`. Sin replicar el componente N veces → sin pérdida de rendimiento.
  - Etiqueta “Hoja N / Total” en la cabecera de la hoja.
- **Rail de miniaturas** a la derecha (entre la hoja y el panel de ajustes), `data-testid="pages-rail"`:
  - Una miniatura por hoja, con preview real escalado (×0.13) del contenido de esa página.
  - Botón activo con borde y fondo destacados.
  - Aparece sólo cuando hay 2+ páginas (CSS `:has(.pages-rail)` reordena el grid).
  - Capacidad ilimitada (sin tope artificial).
- **Fondo del escritorio**:
  - Fondo por defecto = la imagen original del proyecto.
  - Botón **“Cargar imagen”** → file picker → `FileReader` → data URL → CSS variable `--bg-image`.
  - Botón **“Reiniciar”** → vuelve al fondo por defecto y resetea posición/escala.
  - Sliders y arrow-pad de posición y escala mantenidos.
- **Persistencia** completa en `localStorage`: texto, fuente, tamaños, sliders, rotaciones, fondo personalizado, página actual, modo todo-negro.
- Exportación PNG/JPG/PDF reutiliza la hoja actualmente visible (`cuaderno-hoja-N.ext`).

## Backlog / próximos pasos (P0/P1/P2)
- **P1**: Permitir reordenar/eliminar hojas individuales (drag-drop en el rail).
- **P1**: Auto-numerar “página X” en cabeceras o pie de cada hoja exportada.
- **P2**: “Exportar todas las hojas” (un PDF multi-página combinado).
- **P2**: Atajos de teclado para navegar páginas (PgUp/PgDn).
- **P2**: Soporte real de back-end (Mongo) para guardar cuadernos por usuario.

## User personas
- Estudiante / docente que prepara apuntes técnicos con fórmulas LaTeX y quiere una versión “a mano” estética para entregar, redes o presentaciones.
- Creador de contenido educativo que necesita exportar hojas verosímiles a PDF/PNG.

## Test credentials
N/A — la app no tiene autenticación.

# Segundo Cerebro

App de escritorio en la que tomar notas es solo una de las entradas de un asistente personal. A partir de tus notas, tu calendario y tus herramientas (Jira, Slack, correo…), te dice:

- **qué es lo importante hoy** y por qué,
- **qué prometiste** y a quién,
- **qué entregas se acercan**, teniendo en cuenta el tiempo que necesitas para prepararlas,
- **qué tienes que preparar** antes de cada reunión.

Y puede **resolver trabajo** en tus herramientas (mover un ticket, escribir en Slack, preparar un correo) con los permisos que tú decidas.

Todo se rige por **Mi flujo**: una página viva que escribes tú, con tus prioridades, reglas, personas clave y permisos, y que Claude lee como si fuera un skill. Se puede exportar como `SKILL.md`.

## Pantallas

| Pantalla | Qué hace |
| --- | --- |
| **Hoy** | Brief del día: las 3 cosas, promesas que vencen, agenda con checklist de preparación, entregas en el horizonte, qué puedes soltar y qué reglas se aplicaron. |
| **Bandeja** | Todo lo detectado (en notas, capturas, actas, archivos y herramientas) espera aquí a que lo confirmes. |
| **Notas** | Editor de bloques. Mientras escribes, Claude detecta promesas, entregas, tareas y decisiones. |
| **Promesas / Entregas** | Listas filtrables por persona, área y estado. |
| **Mi flujo** | Tu página de reglas, con historial de versiones, sugerencias de Claude y exportación como skill. |
| **Entradas** | Calendarios ICS, archivos y PDFs, herramientas MCP (Jira, Slack, GitHub, Notion, Linear…) y el registro de todo lo que ha hecho Claude. |
| **Preguntar** | Chat sobre todo tu contenido y tus herramientas. |

**Captura rápida:** desde cualquier app, con ⌥ Espacio (o ⌘ ⇧ Espacio si el primero está ocupado).

## Cómo decide qué es lo importante

1. Una **fórmula explicable** (`src/shared/priority.ts`) puntúa cada elemento:
   - las promesas a otras personas pesan más que las tareas propias;
   - la urgencia se calcula como la fecha límite menos los días de preparación;
   - el peso de cada área multiplica la puntuación.

   Cada punto deja un motivo legible.
2. Después, Claude ajusta el orden con tus reglas de Mi flujo y tu agenda.

## Permisos

En Mi flujo, sección `## Permisos`, una línea por herramienta:

```markdown
## Permisos
- jira: automático
- slack: requiere OK
- slack.send_message: solo borrador
- gmail: solo borrador
- *delete*: prohibido
```

Las conexiones de tu cuenta de claude.ai (Gmail, Google Drive, Notion…) se usan con su nombre: `gmail`, `google drive`. «Solo borrador» deja leer y crear borradores (por ejemplo, en Gmail), pero no enviar.

Sin regla, leer es automático y escribir requiere tu OK. Las acciones que requieren OK aparecen como tarjetas de aprobación. «Solo borradores» prepara todo sin enviar nada. Todo queda registrado.

## Conexiones de tu cuenta de Claude

Si usas la IA con Claude Code y tu cuenta de claude.ai, en **Entradas → De tu cuenta de Claude** aparecen los conectores que tengas en claude.ai (Ajustes → Conectores): Gmail, Google Drive, Notion… Actívalos uno a uno con «Usar en la app». La app solo carga los que actives, y únicamente en «Resolver», «Preguntar» y las lecturas a la bandeja. El brief y la detección en notas no usan ninguna herramienta externa.

## Requisitos

- macOS (probado), Node.js 22 o superior.
- Para la IA, una de estas dos opciones:
  - **Claude Code** instalado y con sesión iniciada (`claude` en una terminal). Es la opción de uso personal.
  - Una **API key de Anthropic** (en Ajustes). Es obligatoria si distribuyes la app a otras personas: Anthropic no permite que apps de terceros ofrezcan el inicio de sesión de claude.ai.

Sin IA, la app sigue funcionando: notas, compromisos manuales, calendario y priorización.

## Desarrollo

```bash
npm install          # instala y recompila SQLite para Electron
npm test             # tests de priorización, permisos, calendario y Mi flujo
npm run dev          # arranca la app con recarga en caliente
npm run build        # compila a out/
```

Para probar sin tocar tus datos reales: `CEREBRO_DATA_DIR=/tmp/cerebro-prueba npm run dev`.

## Estructura

```
src/shared/    lógica pura: priorización, permisos, fechas, tipos
src/main/      proceso principal de Electron
  db.ts          SQLite (better-sqlite3), búsqueda FTS5
  agent/         Claude Agent SDK: extracción, brief, resolver, preguntar, herramientas internas (MCP)
  sources.ts     calendarios ICS, archivos, actas, lecturas desde herramientas MCP
src/preload/   puente seguro entre la interfaz y el proceso principal
src/renderer/  interfaz (React + Tailwind + TipTap)
tests/         Vitest
```

## Pendiente

- Notas de voz (transcripción local).
- Empaquetado y firma de la app (`.dmg`).
- Sincronización entre dispositivos.

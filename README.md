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
| **Dashboard** | La pantalla principal: lo atrasado, lo de hoy (por prioridad) con tus reuniones, y una tarjeta por cada uno de los próximos 6 días. Cada cosa aparece el día en que tienes que **empezarla** (fecha límite menos días de preparación). Debajo: lo nuevo que ha detectado Claude para confirmar, lo de más adelante y lo que no tiene fecha. Arriba, una caja para apuntar algo o preguntar. |
| **Notas** | Editor de bloques. Mientras escribes, Claude detecta lo que tienes que hacer y te lo propone en el dashboard. |
| **Ajustes** | Tres pestañas: General (Claude, áreas, brief), **Entradas** (calendarios, archivos, herramientas y registro) y **Mi flujo** (tus reglas, con historial y exportación como skill). |

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

## Actualizaciones automáticas

Cada Mac con la app instalada en Aplicaciones busca versiones nuevas cada 4 horas en GitHub Releases, las descarga, comprueba que son exactamente las publicadas y las instala al cerrar la app (o al pulsar «Reiniciar ahora» en el aviso). Los datos no se tocan. En **Ajustes → General → Actualizaciones** se ve la versión y se puede buscar a mano.

Para publicar una versión nueva (compila desde lo guardado en git, sube la versión y la publica):

```bash
npm run release -- "Qué ha cambiado"
```

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

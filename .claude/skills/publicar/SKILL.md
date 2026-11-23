---
name: publicar
description: Publica una versión nueva de Segundo Cerebro en GitHub Releases para que los Macs con la app instalada se actualicen solos. Úsala al terminar cualquier tarea que cambie la app, o cuando el usuario diga "publica", "saca versión" o "actualiza la app".
---

# Publicar una versión nueva

Siempre el mismo proceso, en este orden. Si un paso falla, para, arréglalo y empieza de nuevo desde el paso 1.

## 1. Comprobar que todo está bien

```bash
npm run typecheck
npm test
```

Los dos tienen que pasar. Si no, no se publica.

## 2. Comprobar que todo está guardado

```bash
git status --short
```

Tiene que salir vacío. Si hay cambios de la tarea sin guardar: commit en `main` con mensaje en español y `git push origin main`. Nunca incluyas `.env`, `*.db` ni datos de prueba.

Si `git push` falla porque hay cambios en GitHub que no tienes, haz `git pull --rebase origin main`, repite el paso 1 y vuelve a subir.

## 3. Escribir las notas de la versión

Una o dos frases en español, pensadas para el usuario, sobre lo que nota él (no sobre el código). Ejemplos:

- «Las reuniones de Google Calendar aparecen en el dashboard.»
- «Se pueden crear notas dentro de otras notas.»

Si en esta versión entran varios cambios desde la anterior, júntalos. Para ver qué hay desde la última versión: `git log --oneline $(git describe --tags --abbrev=0)..HEAD`.

## 4. Publicar

```bash
npm run release -- "Notas de la versión"
```

El script (`scripts/release.sh`) hace el resto: sube el número de versión, lo guarda en GitHub, compila desde una copia limpia y crea la Release con el `.zip`. Tarda unos minutos, así que lánzalo en segundo plano si hace falta.

Si falla por la sesión de GitHub (`gh auth login`), explícale al usuario en llano que tiene que iniciar sesión en GitHub una vez y dale el comando en un bloque `bash`.

## 5. Comprobar y contarlo

```bash
gh release view --json tagName,assets -q '.tagName + " " + (.assets | length | tostring)'
```

Tiene que salir la versión nueva con un archivo adjunto. Después dile al usuario, en dos frases:

- qué versión ha salido y qué cambia para él;
- que su Mac la instalará sola en las próximas horas, o al momento en **Ajustes → General → Actualizaciones → Buscar ahora**.

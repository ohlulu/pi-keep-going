# pi-keep-going

[English](../README.md) · [繁體中文](zh-TW.md) · [日本語](ja.md) · [Français](fr.md) · **Español**

Una extensión de [Pi](https://pi.dev) que mantiene viva una ejecución a pesar de
los límites de uso del proveedor, y que programa mensajes de seguimiento
puntuales cuando se lo pides.

## Sin configuración — funciona sola

**No tienes que ejecutar ningún comando.** La reanudación automática está
activada por defecto (`autoResume.enabled: true`), así que en cuanto instalas la
extensión esta vigila cada turno por su cuenta:

1. Cachea cualquier respuesta `429` que reciba del proveedor.
2. Cuando un turno termina con un error de límite de uso, clasifica el error y
   resuelve la hora de reinicio (cabeceras → cuerpo del error → API de uso del
   proveedor).
3. Programa el mensaje de continuación (`continue`) para `reinicio + 90 s` y te
   indica la hora:
   `Usage limit reached (anthropic) — auto-resuming at 14:05.`

Cuando la ventana vuelve a abrirse el mensaje se envía y el agente retoma donde
se quedó. El comando `/kg` existe para cuando quieres programar algo tú mismo;
nunca hace falta para el camino automático.

## Instalación

```bash
pi install npm:pi-keep-going
```

Pi solo te pide ejecutar `pi update --extensions` cuando se publica una nueva
**versión**: para una fuente npm compara la versión del `package.json` instalado
con la del registro. Deja la especificación sin versión —
`npm:pi-keep-going@1.0.0` cuenta como fijada, y Pi omite por completo la
comprobación de actualizaciones para las fuentes fijadas.

Para desarrollar, instala un clon por ruta local. Una instalación por ruta se
referencia desde `~/.pi/agent/settings.json`, no se copia, así que tus cambios
surten efecto en el siguiente arranque de Pi.

```bash
git clone https://github.com/ohlulu/pi-keep-going
pi install ./pi-keep-going
```

## Comando `/kg`

| Comando | Efecto |
| --- | --- |
| `/kg 40m keep going` | Envía `keep going` dentro de 40 minutos. |
| `/kg 2h30m` | Envía el mensaje por defecto (`keep going`) dentro de 2 h 30 min. |
| `/kg 90s ship it` | La duración va de la unidad mayor a la menor: `d h m s`, cada unidad como máximo una vez. |
| `/kg auto [message]` | Consulta la API de uso del proveedor actual y programa a la hora de reinicio + margen. |
| `/kg list` | Lista los mensajes programados pendientes. |
| `/kg cancel` | Cancela un mensaje programado (pregunta cuál si hay varios). |
| `/kg help` | Muestra la ayuda. Un `/kg` a secas hace lo mismo. |

Los trabajos programados se persisten por rama, así que sobreviven a `/tree`, a
`/fork` y a una recarga. Los temporizadores usan una marca de tiempo de disparo
absoluta comprobada en un tick de 30 s, por lo que un trabajo se dispara
correctamente incluso después de que la máquina haya estado suspendida. Nada
entra en el contexto del LLM salvo el mensaje final que se envía de verdad.

## Reanudación automática

Cuando un turno termina con un error de límite de uso, la extensión:

1. Clasifica el error por proveedor (a partir del mensaje de error del asistente
   y de las cabeceras de respuesta `429` cacheadas).
2. Resuelve la hora de reinicio (cabeceras → hora incrustada en el mensaje → API
   de uso del proveedor). Este paso por la API de uso es imprescindible con
   Anthropic: el SDK lanza una excepción ante un 429 antes de que pi pueda
   observar la respuesta, de modo que las cabeceras unified-reset nunca se
   cachean y el cuerpo del error no lleva ninguna hora de reinicio.
3. Programa un mensaje de continuación en `reinicio + bufferSeconds`, protegido
   por los ajustes de abajo.

La reanudación automática se omite en silencio dentro de los 5 minutos
posteriores a una reanudación previa (protección contra bucles), y se convierte
en una notificación (en lugar de una programación) cuando se alcanza el tope por
sesión o cuando el reinicio queda más lejos que `maxWaitHours`.

## Proveedores soportados

| Proveedor | Detección | API de uso para `auto` |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `hit your ChatGPT usage limit`, `usage_limit_reached`, 429 | `GET /backend-api/wham/usage` → `rate_limit.primary_window.reset_at` |
| Anthropic (`anthropic`) | errores de límite de tasa, 429, cabeceras unified-reset | `GET /api/oauth/usage` → `five_hour.resets_at` (requiere inicio de sesión OAuth, no una clave de API) |
| Google Gemini (`google-gemini-cli`, `google`) | `RESOURCE_EXHAUSTED`, errores de cuota | `POST v1internal:retrieveUserQuota` → el `buckets[].resetTime` más próximo (requiere el project id del inicio de sesión de la CLI) |

Los tokens se obtienen a través de `ctx.modelRegistry.getApiKeyForProvider()`
(Pi se encarga del refresco de OAuth); la extensión nunca lee `auth.json` ni
refresca tokens por su cuenta. Si una API de uso es inalcanzable o no está
soportada, `auto` degrada a una notificación que sugiere un `/kg <duración>`
manual.

## Ajustes

Todo lo de abajo ya tiene un valor por defecto funcional: solo necesitas un
fichero de configuración para cambiar el comportamiento, por ejemplo desactivar
la reanudación automática o enviar otro mensaje.

La configuración global vive en `<pi agent dir>/keep-going.json`. Una
sobrescritura propia del proyecto en `<cwd>/<pi config dir>/keep-going.json` se
aplica **solo cuando el proyecto es de confianza**. Las capas posteriores ganan;
los campos desconocidos o inválidos se ignoran.

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,        // interruptor principal de la reanudación automática
    "message": "continue",  // mensaje enviado al reabrirse la ventana
    "bufferSeconds": 90,    // espera adicional tras el reinicio antes de enviar
    "maxPerSession": 5,     // tope de reanudaciones automáticas por sesión
    "maxWaitHours": 24      // más allá de esto, notificar en vez de programar
  }
}
```

## Cómo se mantiene segura

- **Guarda de generación** — cada sesión recibe un `AbortController` y un id de
  generación. Las peticiones a la API de uso de `auto` se ejecutan con un tiempo
  límite de 10 s compuesto con la señal de la sesión, y el resultado se descarta
  si la sesión fue reemplazada mientras la petición estaba en vuelo.
- **Arrendamiento de disparador único** — si dos procesos de Pi se conectan a la
  misma sesión, un bloqueo consultivo elige un único disparador; el otro
  funciona en solo lectura, de forma que un trabajo se envía exactamente una vez.

## Desarrollo

```bash
npm install
npm run typecheck
npm test
pi -e ./src/index.ts   # cargar localmente
```

`@earendil-works/pi-coding-agent` es una **peer dependency**: la aporta el
runtime de Pi que carga la extensión, así que no debe empaquetarse. También
figura aquí como dev dependency para que `tsc` y `vitest` la resuelvan en local.

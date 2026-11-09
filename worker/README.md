# Cumbre en Cloudflare Workers

Una sola Worker sirve la app (`../app`), la API (`/api/*`) y revisa **cada minuto** qué misión toca preguntar por push («¿Lo hiciste?» con botones Sí / No). Los datos viven en **Workers KV**.

## Desplegar (5 pasos)

```bash
cd worker
npm install
npx wrangler login

# 1) Crea el almacén y pega el id que imprime en wrangler.toml → [[kv_namespaces]] id
npx wrangler kv namespace create CUMBRE

# 2) Genera las claves de push y tu código de acceso
npm run vapid
#    · pega VAPID_PUBLIC_KEY en wrangler.toml → [vars]
#    · guarda los tres secretos con `npx wrangler secret put <NOMBRE>` (te pide el valor)
#    · cambia VAPID_SUBJECT por la dirección de tu sitio (https://…workers.dev), no por tu correo

# 3) Publica
npx wrangler deploy
```

4. Abre la dirección que imprime `deploy`. En **Ajustes** escribe tu código de acceso (`APP_TOKEN`) y pulsa **Guardar código**: la app empieza a sincronizar.
5. Pulsa **Activar avisos push** y luego **Enviar push de prueba**.

**iPhone:** el push solo funciona con la app instalada en la pantalla de inicio (Compartir → Añadir a pantalla de inicio, iOS 16.4 o superior). iOS no muestra los botones Sí / No dentro de la notificación: al tocarla, la app abre una hoja con las dos opciones.

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| `src/tick.js` (cron cada minuto) | Lee la hora en `America/Guayaquil`, el plan y lo hecho hoy; manda como máximo **un** push por minuto. |
| `src/schedule.js` | Reglas puras: qué se pregunta y cuándo, reintentos, horas de silencio (antes de 06:30 y después de 23:30), tope de 14 preguntas al día. |
| `src/push.js` | Web Push con VAPID y cifrado `aes128gcm`, solo con Web Crypto. |
| `src/answer.js` | Aplica «Sí» (marca la misión y suma XP) o «No» a los mismos documentos que usa la app. |
| `src/api.js` | `/api/docs`, `/api/doc/<ruta>`, `/api/push/*`, `/api/answer`. |
| `../app/sw.js` | Muestra la notificación y envía la respuesta; la app se refresca sola. |

**Reglas de «No»:** primera respuesta «No» (o sin respuesta) → vuelve a preguntar a los 30 minutos; si el segundo intento es «No» o no contestas en 30 minutos, la misión queda como *no cumplida* y la app lo usa para aprender (no se vuelve a preguntar ese día).

**Qué se pregunta:** cada hábito con campo `ask` en `app/data/content.json`, y las tareas del plan al cerrar su bloque (mañana 07:30, noche 22:00). Cambia las horas ahí (`ask`, `blocks`) y vuelve a desplegar.

## Seguridad

- Todo lo que lee o cambia datos exige `Authorization: Bearer <APP_TOKEN>`. Guárdalo en un gestor de contraseñas.
- Responder desde la notificación usa una firma HMAC (`SIGN_SECRET`) por pregunta y por respuesta, que caduca a las 12 h y solo vale una vez.
- Recomendado: protege el dominio con **Cloudflare Access** (gratis para pocas personas). No hace falta tocar el código.
- Las claves y secretos nunca van en el repositorio: `.dev.vars` y `.wrangler/` están en `.gitignore`.

## Probar en local

```bash
npm test                      # 17 pruebas: cifrado push, firmas, cron, reintentos, API
cp .dev.vars.example .dev.vars   # edita los valores (o usa los de `npm run vapid`)
npm run dev                   # http://localhost:8787 con KV local
```

## Límites que conviene saber

- El cron tiene precisión de un minuto: el aviso puede llegar hasta un minuto tarde.
- Los cambios en KV tardan hasta ~1 minuto en verse desde otro lugar del mundo; para una sola persona no se nota.
- Plan gratuito de Workers: sobra para una persona (el cron lee ~4 valores por minuto y escribe solo cuando algo cambia).

## Aviso de los lunes por la noche
Cada lunes entre las 20:00 y las 22:00 (hora de `TZ`), si el plan de esa semana todavía no tiene tareas, el cron envía **un** push
«Es lunes por la noche · ¿Qué tareas tienes esta semana?». Al tocarlo se abre la app en `/?plan=1`, donde dictas (micrófono) o escribes
las tareas y la app las ordena por día. Si ya añadiste tareas desde la app, no se envía.

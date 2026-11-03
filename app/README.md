# Cumbre — tu coach interactivo

App instalable (PWA) con misiones diarias, rachas, XP, mapa de montaña (Cotopaxi → Cayambe), bloque de Iguana (20:00–22:00) y planificación semanal editable. Todo se guarda en tu dispositivo.

## Diseño
La interfaz usa el sistema de diseño **Cumbre** (`ds/`): `tokens.json` es la fuente, `tokens.css` está compilado de ahí (claro y oscuro) y `components.css` trae botones, tarjetas, gráficas de cápsula, caritas de ánimo y banners con sol. El libro de marca está en `ds/README.md`.

## Probar en local
```
cd app && python3 -m http.server 8000
```
Abre http://localhost:8000. Para instalarla en el celular necesita HTTPS: publícala con GitHub Pages (Settings → Pages → rama y carpeta `/app`) y usa «Añadir a pantalla de inicio».

## Cada semana
Los domingos: pestaña **Semana → Planificar** (asistente de 5 pasos: resumen, prioridades, tareas, equipo, confirmar). Luego **Más → Pizarra** para imprimir la hoja de la semana.

## Notificaciones
- Con la app abierta: **Más → Activar notificaciones**.
- Aunque la app esté cerrada: **Más → Descargar alarmas (.ics)** y ábrelo en el calendario del celular (crea alarmas diarias y el recordatorio del domingo).

## Contenido
Los datos, tips, salmos, plantillas de tareas y mensajes por nicho están en `data/content.json`.

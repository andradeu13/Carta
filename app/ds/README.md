Cumbre es el sistema visual de un coach de hábitos para el celular: cada día son misiones cortas, rachas y una montaña que se sube con puntos. Se siente cálido, juguetón y claro, como un cuaderno con sol, no como una aplicación de oficina.

## Voz y contenido

- Habla de tú, en español neutro, con frases cortas. El coach cambia de modo según el día:
  - **Directo** cuando se pospone: «Iguana no se vende sola. Abre tu bloque de las 20:00 y cumple lo que te prometiste.»
  - **Empático** cuando hay miedo o cansancio: «Hay días pesados y está bien. Hoy basta con una misión pequeña.»
  - **Pregunta** cuando hay duda: «¿Qué es lo que más te acerca a tus primeras ventas esta semana?»
  - **Celebra** con una racha: «¡Racha de 6 días! Así se sube una montaña: paso a paso.»
- Los botones son verbos: «Empezar misión», «Completar», «Planificar mi semana», «Compartir progreso». Nunca «Aceptar» ni «OK».
- Mayúscula solo al inicio de la frase. Sin signos de exclamación salvo para celebrar (máximo uno). Sin emojis como decoración: usa los iconos y las caritas del sistema.
- Cada pantalla termina en un siguiente paso concreto. No reproches nunca un día perdido: muestra qué se puede hacer hoy.
- Cifras reales o ninguna. Los puntos se escriben «842 XP»; las alturas, «4 600 m»; las duraciones, «5 min», «2 h».

## Color

- Fondo de pantalla `surface`; tarjetas `surface-raised` con `shadow-card`, sin bordes marcados. Zonas hundidas (pistas de barras) en `surface-sunken`.
- Texto en `ink`; secundario en `ink-muted`. Sobre cualquier relleno de color usa su pareja `on-*` (`on-action`, `on-sun`, `on-green`, `on-brown`, `on-pink`, `on-taupe`, `on-night`). Nunca blanco sobre `action`.
- `action` (naranja) es la acción principal y solo hay una por pantalla. `sun` (amarillo) marca hoy, la mañana, las caritas felices y la acción central de la barra. `green` es progreso y éxito; `brown` es el botón flotante y la energía baja; `pink` y `taupe` completan las gráficas.
- Las tarjetas pastel (`peach`, `lilac`, `mint`, `sand`) agrupan por área: recordatorio, intención, gratitud, noche. Su texto es `ink`.
- Texto o trazo de acento sobre tarjetas blancas: `action-strong` y `green-strong`, que cumplen 4.5:1.
- El tema oscuro cambia los valores, no el carácter: los rellenos se aclaran y sus textos `on-*` se mantienen oscuros.
- Estado nunca solo con color: cada barra lleva su porcentaje; cada carita, su palabra; cada día cumplido, un punto además del color.

## Tipografía

- Números y títulos en `Outfit` (`display-xl`, `display`, `title`, `subtitle`), peso 700 a 800. Texto en `Plus Jakarta Sans` (`body`, `body-sm`, `caption`, `label`).
- Un número protagonista por pantalla en `display-xl`. Los títulos de fila llevan `body` con peso 700; los subtítulos, `body-sm` en `ink-muted`.
- Carga ambas familias desde Google Fonts: `Outfit` pesos 600 y 800; `Plus Jakarta Sans` pesos 500, 600, 700 y 800.

## Forma y espacio

- Todo es una pastilla o un disco: botones, chips, círculos de día y barras de gráfica usan `radius-pill`. Tarjetas grandes y banners, `radius-lg`; filas, `radius-md`; cuadros de icono, `radius-sm`; marco de teléfono y barra inferior, `radius-xl`.
- Espacio en múltiplos de 4. Margen lateral `space-4`, entre tarjetas `space-5`, relleno de banner `space-6`.
- Áreas táctiles de al menos 44 px; el botón mide 48 px.

## Ilustración

- Banners con cielo por franja del día: sol sonriente (mañana), sol bajo (tarde), luna y estrellas (noche) y montaña con bandera (cierre). Formas planas, sin degradados ni sombras, colores del sistema.
- El sol es el único personaje con rostro. Las caritas de ánimo son círculos de color con ojos y boca simples.

## Iconografía

- Trazo de 2 px, esquinas redondeadas, rejilla de 24 px (`.cb-ico-*`); se pintan con el color del texto. Existen: añadir, check, cerrar, atrás, más, reloj, gota, campana, montaña, loto, luna, sol, libro, chat, celular apagado, cama, casa, brújula, diario, usuario, llama, estrella, compartir, gráfica, estiramiento.
- Los iconos van en cuadros pastel de 40 px para filas, o sueltos a 18 px dentro de botones y chips.

## Movimiento

- Lo que se pulsa se hunde (`duration-fast`). Lo que se completa rebota con `easing-spring` (`duration-base`). Las barras y el anillo crecen con `duration-slow` y `easing-out`.
- El sol gira lento, las nubes se desplazan, las estrellas titilan y la campana suena. Con `prefers-reduced-motion` todo se detiene y los valores aparecen ya completos.
- Vibración de 12 ms al elegir una carita o completar una misión, si el dispositivo la permite.

## Accesibilidad

- Texto 4.5:1 y bordes de controles 3:1 en ambos temas. El foco es un aro de 3 px (`focus`) con 2 px de separación.
- Cada botón sin texto lleva `aria-label`. Las caritas se anuncian como un grupo de opciones.

# CinemaCity: contexto robots.txt en Vercel

Prueba del 23 de octubre de 2026, 18:41:11 en Madrid, sobre el despliegue del commit `4e3a94717ca5e8e7fbf64fe7df273a5a6fc58612`.

El documento aportado describe un addon local que utiliza una pestaña CinemaCity `robots.txt` como contexto y solicita las fichas mediante `fetch` con `credentials: include`, aprovechando una sesión ya autenticada del navegador del usuario. El túnel HTTPS descrito publica ese servicio local; no elimina su dependencia del PC.

Se preparó una prueba distinta de la navegación directa al catálogo del experimento anterior: abrir `https://cinemacity.cc/robots.txt` con Chromium dentro de Vercel y, únicamente si la carga no presenta un desafío, ejecutar un `fetch` del catálogo dentro de esa página. Se usó un contexto nuevo sin importar cookies, JavaScript de página desactivado y siete pruebas de aislamiento, límites, clasificación y limpieza. No se modificó el addon original ni se utilizaron el túnel o su token privado.

## Resultado observado

Chromium `HeadlessChrome/153.0.8010.0` arranca dentro de Vercel. La carga inicial devuelve HTTP 200 y se clasifica como `cloudflare_challenge`. El clasificador utiliza la cabecera `cf-mitigated` o un título explícito de verificación, no la mera presencia del script `challenge-platform`. El informe no distingue cuál de esas dos señales se produjo, por lo que no debe atribuirse específicamente a una cabecera.

La prueba termina en 4.379 ms antes de ejecutar el fetch del catálogo. No se prueba login, acceso autenticado, extracción ni reproducción HLS. Un HTTP 200 en este punto no demuestra que el catálogo o una ficha estén disponibles.

## Alcance de la conclusión

La variante probada no resuelve el requisito de Vercel con el PC apagado. La prueba no reproduce un perfil ya autenticado ni el Chrome completo del usuario, y no demuestra que todas las configuraciones posibles de navegador fallen. El documento no aporta un mecanismo autónomo de acceso autorizado desde Vercel. Tampoco permite atribuir el resultado únicamente a TLS, IP o sesión.

El endpoint y las dependencias temporales se retiran después de guardar este resultado. El addon de producción conserva la versión 1.3.0.

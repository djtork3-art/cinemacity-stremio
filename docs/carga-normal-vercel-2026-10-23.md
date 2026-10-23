# Carga normal con verificación automática en Vercel

Prueba del 23 de octubre de 2026, 19:22:04 en Madrid. Despliegue `4a74f888752d6f2798eaf22f160dd23680914aba`.

Esta prueba corrige una limitación de las anteriores: detenerse al encontrar el desafío no comprobaba si el navegador podía completar la carga automática como el navegador del usuario.

## Cambio probado

Chromium arranca dentro de Vercel con un perfil nuevo y JavaScript habilitado. Se dejan ejecutar los recursos y las peticiones normales del sitio y de los dominios de verificación documentados por Cloudflare. La prueba espera hasta 25 segundos a que aparezca el formulario real o el marcador de autenticación, utilizando la última respuesta de navegación en lugar de conservar el 403 inicial si la página termina de cargar.

No se simulan clics, movimientos de ratón ni señales de humanidad. No se modifica la identidad del navegador, no se importa un perfil o cookies, no se desactiva TLS y no se pulsa ningún control de verificación. Las credenciales solo pueden enviarse una vez al formulario HTTPS reconocido del mismo sitio, después de que aparezca.

## Resultado real

| Indicador | Resultado |
| --- | --- |
| JavaScript normal | Habilitado |
| Peticiones de verificación admitidas | 9 |
| Peticiones bloqueadas por la prueba | 0 |
| Espera de la carga | 25.271 ms |
| Respuesta inicial y final | HTTP 403, desafío Cloudflare |
| Formulario disponible al terminar | No |
| Credenciales enviadas | No |
| Sesión autenticada | No |
| Duración total | 28.315 ms |

El requisito de acceso autónomo desde Vercel sigue sin resolverse. No se han comprobado la contraseña ni la reproducción real. El informe no identifica qué señal concreta decide el resultado, por lo que no permite atribuirlo exclusivamente a IP, TLS o perfil.

Cloudflare explica que JavaScript, los recursos de verificación y el almacenamiento del navegador afectan a estas cargas, y también indica que los navegadores automatizados no están soportados para resolver desafíos de producción. Esto explica por qué una comprobación automática en el navegador personal no garantiza el mismo resultado en un navegador automatizado alojado en Vercel; no es una demostración de que todas las configuraciones posibles fallen.

Fuentes: [problemas de verificación](https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/), [navegadores compatibles](https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/).

## Fichero conservado

Se conserva `scripts/check-browser-session.js` como diagnóstico, sin conectarlo a los endpoints del addon. Su código cuenta con siete pruebas propias; junto con las existentes, pasan 38 tests en Windows. La puerta temporal de acceso tuvo otras cuatro pruebas, antes de retirarse.

Para repetir el diagnóstico de navegador se requiere Linux, Node 24 o superior y las credenciales propias disponibles en variables privadas del proceso. Las dependencias del navegador no forman parte del addon de producción:

```sh
npm ci --ignore-scripts
npm install --ignore-scripts --no-save --no-package-lock @sparticuz/chromium@153.0.0 puppeteer-core@25.11.0
node scripts/check-browser-session.js
```

El fichero solo imprime indicadores sanitizados. El endpoint privado, su clave temporal y las dependencias añadidas para la medición se retiran del despliegue de producción, que conserva la versión 1.3.0.

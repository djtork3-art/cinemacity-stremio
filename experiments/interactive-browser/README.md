# Interfaz privada de Chromium en Vercel

Experimento separado del addon. Permite al propietario abrir CinemaCity en Chromium completo con pantalla virtual y manejarlo mediante imágenes y controles enviados por WebSocket. No importa cookies, no emplea ocultación y no automatiza verificaciones. Solo admite navegación principal a CinemaCity y recursos HTTPS reconocidos del sitio/Cloudflare.

La vista previa debe conservar Vercel Authentication. Además, cada conexión exige una clave aleatoria temporal cuyo SHA-256 y caducidad se guardan en config.json; la clave no se publica. No hay acceso al protocolo de depuración, archivos, evaluación de código ni exportación de cookies.

Cada WebSocket conserva un navegador en su instancia. Se cierra al desconectarse, tras dos minutos sin interacción o al llegar a cuatro minutos. No guarda el perfil para futuras funciones o despliegues, ni hace funcionar automáticamente Stremio. Sirve para verificar si una sesión iniciada directamente en Vercel es aceptada.

Dockerfile.vercel instala Chromium y Xvfb de Debian; usa Node 24, Puppeteer Core 25.16.0 y ws 8.22.0. Para reproducir exactamente un despliegue hay que fijar también las versiones del paquete Debian y la imagen base. Las pruebas se ejecutan con npm ci y npm test.

La clave no se envía en la URL ni se guarda en almacenamiento del navegador. La pantalla puede contener datos de la cuenta: no compartas la clave ni la vista previa. Las pulsaciones se entregan al campo remoto elegido y no se registran en los logs de la aplicación.

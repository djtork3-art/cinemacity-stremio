# Escritorio privado de Chromium convencional

Sustituye el experimento de Puppeteer por Chromium instalado de Debian, iniciado directamente y manejado mediante Xvfb, x11vnc y noVNC. No usa Puppeteer, WebDriver, CDP, parches de identidad o cambios de cookies. Solo transmite el escritorio y las entradas del usuario.

La vista previa conserva Vercel Authentication y una clave temporal con SHA-256 y caducidad. La clave se entrega por el WebSocket cifrado, no por la URL. Cada conexión tiene su propio escritorio y perfil temporal. VNC solo escucha en 127.0.0.1 dentro del contenedor. No se exponen puertos VNC al exterior. La conexión pública solo acepta el mismo origen y requiere autenticarse antes de crear procesos o transmitir VNC.

El escritorio dura hasta cuatro minutos y se cierra al desconectar. Entonces se terminan Chromium, x11vnc y Xvfb y se elimina el perfil temporal. Las variables de entorno privadas del addon no se heredan en los procesos del escritorio. El servicio permite hasta dos escritorios simultáneos por instancia.

Este es un navegador convencional: los recursos web se cargan directamente, sin el filtro de peticiones del experimento anterior. Usa la sesión únicamente para tu cuenta y no compartas la clave. La interfaz no está conectada al addon Stremio ni conserva cookies entre conexiones. No garantiza que el sitio acepte el acceso.

Validación local: npm ci y npm test. El despliegue real verifica pantalla y transporte VNC. La verificación de Cloudflare y el inicio de sesión corresponden al usuario.

# Intento privado de sesión propia dentro de Vercel

23 de octubre de 2026, 19:01:04 en Madrid. Despliegue `5addb8e70ce29a15f92a594bd35820651e95099c`.

Se desplegó una prueba privada de login en el proyecto CinemaCity de Vercel. Utiliza exclusivamente `CINEMACITY_USERNAME` y `CINEMACITY_PASSWORD` del entorno del servidor, sin leer ni publicar sus valores. La ejecución se protegió con una clave temporal enviada por POST; solo se almacenó su hash en el código. El formulario público no ejecuta operaciones de cuenta sin esa clave.

## Flujo previsto

1. Arrancar Chromium en Vercel, con perfil nuevo y JavaScript habilitado, sin cookies o perfiles importados, sin cambiar el User-Agent ni desactivar TLS.
2. Obtener el formulario real de CinemaCity. Rechazar verificaciones interactivas, dispositivos revocados, otros orígenes y formularios no reconocidos.
3. Si el formulario está disponible, realizar un único envío normal de las credenciales al action HTTPS validado del mismo sitio.
4. Leer otra página para comprobar el marcador explícito de autenticación. Un POST o una cookie por sí solos no cuentan como autenticación.
5. Si se autentica, abrir `robots.txt`, obtener el catálogo mediante fetch dentro del navegador y contar los streams de Tulsa King S1E1, sin devolver URLs privadas.

## Resultado real

| Indicador | Resultado |
| --- | --- |
| Credenciales configuradas en Vercel | Sí |
| Credenciales enviadas | No |
| Etapa alcanzada | Carga del formulario |
| Respuesta | HTTP 403, desafío Cloudflare |
| Sesión autenticada | No |
| Navegador | HeadlessChrome/153.0.8010.0 |
| Duración | 3218 ms |

El bloqueo ocurre antes del formulario. No se puede concluir que la contraseña sea correcta o incorrecta, porque no llegó a enviarse. No se obtuvo una sesión ni se probó reproducción real.

La prueba pasa nueve tests en Windows: acceso privado, caducidad, intento concurrente único, ausencia de exposición de la clave, detención ante desafío, formulario correcto, autenticación verificada y conteo de un stream con respuestas sintéticas. Ese caso sintético no equivale al resultado real de Vercel.

Después de la medición se retiran el endpoint, su configuración temporal, tests y dependencias de navegador. El informe no contiene contraseñas, cookies, claves de acceso, HTML de cuenta ni enlaces de reproducción.

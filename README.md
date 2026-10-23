# CinemaCity para Stremio (experimental)

Puente **no oficial** que adapta parte de la lógica del proveedor CinemaCity de Nuvio a la interfaz de addons de Stremio.

## Estado

Este proyecto es **experimental**. La sintaxis del código puede comprobarse localmente, pero **no se ha verificado que encuentre o reproduzca fuentes**. Las URLs o el HTML del sitio origen pueden cambiar, y algunos reproductores requieren cabeceras que los enlaces de Stremio no incluyen.

## Despliegue en Vercel

1. Importa este repositorio desde https://vercel.com/new.
2. Usa **Node.js 20 o superior**.
3. Configura la variable de entorno **TMDB_API_KEY** con tu clave de https://www.themoviedb.org/settings/api.
4. El login automático queda desactivado. Solo si verificas el formulario y dispones de autorización, configura **CINEMACITY_ENABLE_LOGIN=true**, **CINEMACITY_USERNAME** y **CINEMACITY_PASSWORD** como variables privadas. El formulario estándar de DataLife Engine sigue sin estar confirmado para CinemaCity y no resuelve un desafío de Cloudflare. No introduzcas credenciales en la página pública ni en enlaces.
5. Despliega.
6. Abre `https://TU-DOMINIO.vercel.app/manifest.json` para comprobar que devuelve JSON.
7. Instala esa misma URL desde la sección de addons de Stremio.

El endpoint de streams utiliza el patrón `/stream/movie/tt1234567.json`, o el equivalente para series.

## Uso local

```bash
npm install
export TMDB_API_KEY=tu_clave
npm start
```

Visita `http://localhost:7000/manifest.json`.

## Variables

- `TMDB_API_KEY` (obligatoria para resolver títulos).
- `CINEMACITY_URL` (opcional).
- `CINEMACITY_USERNAME` (opcional, usuario o correo; solo en entorno privado).
- `CINEMACITY_PASSWORD` (opcional, solo en entorno privado).
- `CINEMACITY_ENABLE_LOGIN` (opcional, `false` por defecto; debe ser `true` para enviar el formulario experimental).
- `CINEMACITY_COOKIE` (opcional, solo si posees una sesión autorizada; nunca la publiques).
- `PORT` (local).

La autenticación es experimental. `/health.json` expone solamente si se configuró, no su valor. No se ha probado el flujo de login real ni que elimine el HTTP 403 de Vercel.

## Diagnóstico reproducible en Windows

En PowerShell, con Node 20 o superior:

```powershell
npm ci --ignore-scripts
npm test
npm run check
node scripts/diagnose.js https://cinemacity-stremio.vercel.app |
  Tee-Object -FilePath diagnostico.json
```

El diagnóstico hace peticiones públicas de bajo volumen: DNS, negociación TLS validada y HTTPS HTTP/1.1 para CinemaCity; `fetch` para CinemaCity y TMDB; manifest y health del addon opcional. No envía cookies, credenciales ni claves, aunque estén configuradas en el entorno. TMDB debe devolver `401` sin clave: eso comprueba conectividad, no el funcionamiento de tu clave. El proceso termina con éxito si genera el informe; los fallos de red quedan en los campos `kind`, no en el código de salida.

Para comparar con el cliente nativo de Windows, sin cookies ni desactivar certificados:

```powershell
curl.exe --version
curl.exe --head --max-time 10 https://cinemacity.cc/
```

Anota si ese curl utiliza Schannel u otro motor TLS. HEAD y GET pueden recibir respuestas diferentes. No uses `-k`, cookies de proveedores ni herramientas de elusión para esta prueba.

`/health.json` informa sobre peticiones **anónimas**, versión y motor de Node. Comparte peticiones concurrentes y reutiliza resultados durante 30 segundos por instancia para reducir carga. `reachable` indica que hubo respuesta HTTP, incluso con `403`; `kind` indica el resultado. No prueba autenticación, búsqueda autorizada ni reproducción.

- `connection_reset`: corte de conexión; no permite atribuir la causa a Cloudflare.
- `tls_error`, `dns_error`, `timeout`: fallo clasificado con códigos seguros y fase.
- `http_forbidden`: HTTP 403 sin señal explícita de desafío.
- `cloudflare_challenge`: cabecera `cf-mitigated: challenge`; el addon se detiene.
- `redirect_rejected`: redirección entre orígenes, con credenciales en URL, o demasiados saltos. No se reenvía la cookie a ese destino.

Los logs distinguen `tmdb` y `cinemacity`, y fases como `lookup`, `title`, `search`, `detail` y `login`. No registran URL, cuerpo, cookie, clave ni mensajes crudos de excepciones. Los tiempos de espera cubren cabeceras y lectura del cuerpo; el tamaño está limitado a 2 MiB (512 KiB en health).

La comparación y los límites de las conclusiones están en [docs/diagnostico-2026-10-23.md](docs/diagnostico-2026-10-23.md).

Mantén secretos en las variables del proyecto Vercel, nunca en commits. Utiliza únicamente contenidos y fuentes para los que tengas autorización.

## Limitaciones conocidas

- El parseo HTML está acoplado a un diseño concreto del sitio de origen.
- Las búsquedas pueden devolver cero streams.
- No se implementa un proxy para cookies, cabeceras ni restricciones de acceso.
- El análisis de capítulos y las URLs resultantes necesitan pruebas en Stremio real.

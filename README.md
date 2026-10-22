# CinemaCity para Stremio (experimental)

Puente **no oficial** que adapta parte de la lógica del proveedor CinemaCity de Nuvio a la interfaz de addons de Stremio.

## Estado

Este proyecto es **experimental**. La sintaxis del código puede comprobarse localmente, pero **no se ha verificado que encuentre o reproduzca fuentes**. Las URLs o el HTML del sitio origen pueden cambiar, y algunos reproductores requieren cabeceras que los enlaces de Stremio no incluyen.

## Despliegue en Vercel

1. Importa este repositorio desde https://vercel.com/new.
2. Usa **Node.js 20 o superior**.
3. Configura la variable de entorno **TMDB_API_KEY** con tu clave de https://www.themoviedb.org/settings/api.
4. Si dispones de credenciales propias y el sitio permite este acceso, configura **CINEMACITY_USERNAME** y **CINEMACITY_PASSWORD** como variables **Sensitive** en Vercel. El código intenta el formulario estándar de DataLife Engine, pero no está confirmado para CinemaCity. No introduzcas estas credenciales en la página pública del addon ni en enlaces.
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
- `CINEMACITY_COOKIE` (opcional, solo si posees una sesión autorizada; nunca la publiques).
- `PORT` (local).

La autenticación es experimental. `/health.json` expone solamente si se configuró, no su valor. No se ha probado el flujo de login real ni que elimine el HTTP 403 de Vercel.

Mantén secretos en las variables del proyecto Vercel, nunca en commits. Utiliza únicamente contenidos y fuentes para los que tengas autorización.

## Limitaciones conocidas

- El parseo HTML está acoplado a un diseño concreto del sitio de origen.
- Las búsquedas pueden devolver cero streams.
- No se implementa un proxy para cookies, cabeceras ni restricciones de acceso.
- El análisis de capítulos y las URLs resultantes necesitan pruebas en Stremio real.

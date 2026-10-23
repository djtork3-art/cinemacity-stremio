# Importación del proveedor local — 2026-10-23

Origen: addon local facilitado por el usuario en `acestream_tv_plus/stremio-addon/cinemacity`. Se importan sus algoritmos de catálogo, correspondencia de títulos y análisis del reproductor en `lib/local-provider.js`. La carpeta original no se modifica. No se incluyen su entorno privado, logs ni cliente Chrome.

La versión local realiza las solicitudes dentro de Chrome mediante CDP y `credentials: include`. Esta sesión y el motor HTTP del navegador explican una diferencia concreta respecto a las solicitudes Node de Vercel; no demuestran por sí solos qué condición del servidor produce el bloqueo. El HTTP 403 con `cf-mitigated: challenge` observado en Vercel indica un desafío. Un ECONNRESET de Windows, por sí solo, no identifica al responsable.

## Verificación

En Windows, con Node 20 o superior:

```powershell
npm ci --ignore-scripts
npm test
npm run check
node scripts/inspect-html.js "C:\ruta\ficha-visitante.html" "C:\ruta\ficha-autenticada.html"
```

- 31 pruebas: catálogo, autenticación, transporte, episodios, calidades, URLset y metadatos.
- HTML aportado de Tulsa King: visitante, 0 streams y `login_required`; autenticado, 1 stream para S1E1 con cabeceras de reproducción.
- El análisis de HTML es offline y no prueba reproducción ni acceso desde Vercel. Los HTML y las URLs privadas no se incorporan al repositorio.

Para comprobar conectividad real sin cookies, se mantiene `node scripts/diagnose.js URL_DEL_ADDON`. El addon no resuelve desafíos ni ejecuta scripts del sitio. Si el origen sigue rechazando las solicitudes, hace falta un acceso automatizado permitido por el propietario del sitio; cambiar el parser no concede ese acceso.

# Investigación de CinemaCity — 23 de octubre de 2026

## Código comparado

Base del addon: commit `7bbe0a4` de `djtork3-art/cinemacity-stremio`.
Proveedor consultado: `D3adlyRocket/Hindi-Nuvio/providers/cinemacity.js`, blob `a53bd87c2019203c14d638c5096cf87da2731202`.

El proveedor comparte con el addon las búsquedas DLE, las tarjetas `div.dar-short_item`, el payload `atob` y las listas de reproducción. Llama al `fetch` inyectado por la aplicación y pasa `skipSizeCheck: true`; esta opción no forma parte de fetch estándar de Node, no cambia TLS y no resuelve Cloudflare. El proveedor no comprueba `response.ok`, captura errores devolviendo `[]` e incluye una cookie de cuenta y una clave TMDB incrustadas. No se copiaron ni se utilizaron esos valores. También entrega cookies al reproductor; nuestro addon no las expone en streams.

## Motor HTTP

En el código Android actual de NuvioMobile, commit `e6c399e014939cd63dd85a3fc5d248c2bacccbe4`, `FetchBridge.kt` registra `__native_fetch` en QuickJS y llama a `httpRequestRaw`. `AddonPlatform.android.kt` implementa esa llamada con OkHttp, DNS IPv4 primero, tiempos de 60 s y proxy explícitamente desactivado. El proveedor JS no determina ese motor. La versión instalada por el usuario no fue identificada; este hallazgo no demuestra qué motor usa esa instalación o una versión anterior de Nuvio.

Node implementa `fetch` mediante Undici. Un User-Agent igual no iguala la negociación TLS, DNS, proxy, HTTP, IP de salida ni el estado de sesión. En Vercel las peticiones salen del servidor, no del teléfono. Estas diferencias son hipótesis plausibles para resultados diferentes, no una atribución causal demostrada. No se ha medido la huella TLS de Nuvio ni comparado el mismo dispositivo, red y sesión autorizada.

## Observaciones locales

Prueba del 23/10/2026 a las 01:51 CEST (22/10 23:51 UTC), Windows, Node 22.20.0, Undici 6.21.2, OpenSSL 3.5.2, sin credenciales:

| Prueba | Resultado |
| --- | --- |
| DNS CinemaCity | Resuelve IPv4 |
| TLS directo con SNI y validación | `ECONNRESET`, antes de `secureConnect` |
| HTTPS de Node HTTP/1.1 | `ECONNRESET` |
| fetch CinemaCity | HTTP 403, `server: cloudflare`, `cf-mitigated: challenge` |
| fetch TMDB sin clave | HTTP 401; hay respuesta HTTP |
| Manifest de producción previo | HTTP 200, versión 1.0.0 |
| Health de producción previo | HTTP 200; petición de origen indica HTTP 403 |

Una segunda ejecución a las 01:55 CEST devolvió `ECONNRESET` también con fetch, con DNS/TMDB/manifest sin cambios y health de producción todavía indicando 403. No había variables de proxy ni NODE_OPTIONS. Por tanto, incluso en esta máquina el resultado de fetch varió entre 403 y reset: no es una comparación controlada que permita atribuir la diferencia exclusivamente a TLS. El script registra presencia de variables de proxy/NODE_OPTIONS sin mostrar valores. El `ECONNRESET` histórico del usuario es compatible con un corte antes de HTTP, pero no identifica quién lo provoca.

Una respuesta `403` demuestra que la conexión llegó a HTTP; `cf-mitigated: challenge` identifica específicamente el desafío. No prueba que una cuenta válida permita automatización. TMDB funcionando tampoco demuestra acceso a CinemaCity: son servicios y rutas de red diferentes.

## Cambios y pruebas

- Diagnósticos estructurados por servicio/fase; códigos DNS, TLS, timeout, reset, HTTP y desafío. Sin secretos ni mensajes crudos.
- Tiempo de espera que abarca la lectura, límites de cuerpo y redirecciones restringidas al origen HTTPS inicial. No hay reintentos de bloqueo ni fallback para desafíos.
- Health anónimo con caché de 30 s por instancia y peticiones concurrentes compartidas. No genera sesiones.
- Login experimental requiere activación explícita. Una cookie genérica PHPSESSID ya no se considera suficiente para aceptar la sesión; la autenticación real continúa sin verificarse.
- TMDB utiliza también tiempos de espera y errores clasificados. Validación temprana de IDs y coincidencias numéricas de temporadas/episodios.
- Pruebas offline con respuestas sintéticas: flujo de película y serie, secretos ausentes en streams/logs, bloqueo sin fallback, 403 sin falsa atribución, desafío HTTP 200, redirects y tamaño/corte del cuerpo.

No se verificó reproducción real en Stremio ni en Nuvio. La protección del origen sigue siendo un impedimento; no hay base para afirmar que el addon devuelve fuentes reales. El siguiente paso legítimo para resolver acceso es confirmar con el operador un API o método de integración autorizado, o probar una sesión propia dentro de las condiciones que permita el sitio.

## Fuentes primarias

- [Proveedor CinemaCity](https://github.com/D3adlyRocket/Hindi-Nuvio/blob/main/providers/cinemacity.js)
- [FetchBridge de Nuvio Android](https://github.com/NuvioMedia/NuvioMobile/blob/e6c399e014939cd63dd85a3fc5d248c2bacccbe4/composeApp/src/fullCommonMain/kotlin/com/nuvio/app/features/plugins/runtime/network/FetchBridge.kt)
- [Cliente OkHttp de Nuvio Android](https://github.com/NuvioMedia/NuvioMobile/blob/e6c399e014939cd63dd85a3fc5d248c2bacccbe4/composeApp/src/androidMain/kotlin/com/nuvio/app/features/addons/AddonPlatform.android.kt)
- [Node: fetch y Undici](https://nodejs.org/api/globals.html#fetch)
- [Cloudflare: detectar una página de desafío](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)

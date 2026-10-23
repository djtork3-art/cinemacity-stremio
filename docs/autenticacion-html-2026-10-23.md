# Comparación offline de fichas y autenticación

Los HTML aportados por el usuario para una misma ficha mostraron dos estados diferentes: `CCDeviceGuardRuntime={authenticated:false}` con `file:""`, y `authenticated:true` con una lista JSON de 4 carpetas de temporada y 31 entradas de episodio. El dominio de las fuentes observado en la lista es `s1.cccdn.net`; no se han solicitado los vídeos ni reproducido enlaces.

La prueba offline del handler extrajo 0 streams del HTML visitante y 1 HLS para S1E1 del HTML autenticado. Esto comprueba que el analizador reconoce esta estructura cuando la página contiene fuentes. No demuestra que la sesión del proveedor Nuvio sea actualmente válida ni que Node/Vercel pueda obtener ese HTML desde el origen. Cloudflare sigue siendo una barrera independiente.

No se han incorporado al repositorio las cookies, los HTML privados, tokens o URLs completas del usuario. El comando `scripts/inspect-html.js` permite repetir la comparación localmente sin red, usando los archivos conservados por el usuario.

## Cambios 1.2.0

- El login optativo descubre y valida el formulario observado; se elimina la suposición de un endpoint `do=login`. Usa exclusivamente credenciales privadas configuradas por el operador, con verificación posterior del estado autenticado.
- Jar privado de cookies de respuesta limitado a origen, dominio exacto, rutas y caducidad. Se comparten intentos concurrentes y se espera 60 segundos después de un fallo. No se importan cookies de navegador ni se resuelven desafíos.
- Se distinguen `login_required`, `empty_player_file`, `player_payload_missing` y `session_unconfirmed`. La extracción ya no interpreta las comillas de `file:""` como contenido.
- Se añade `notWebReady:true` junto a `proxyHeaders`, como requiere la documentación de streams de Stremio. Las cabeceras de reproducción siguen sin incluir cookies de cuenta.
- Health continúa siendo anónimo y no intenta iniciar sesión.

El login real y la reproducción en Stremio permanecen sin verificar. Ninguna de estas correcciones permite afirmar que el desafío HTTP 403 haya desaparecido.

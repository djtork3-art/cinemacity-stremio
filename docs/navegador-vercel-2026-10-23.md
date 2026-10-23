# Prueba real de navegador dentro de Vercel

23 de octubre de 2026, 18:00:32 (Madrid).

El navegador sí arranca y funciona dentro de una función de Vercel con el PC sin intervenir en la extracción. La prueba se ejecutó sobre el despliegue del commit `7b765eb8f023be3b0d38fd921f155e9166a1b0a4`, no en el navegador del ordenador.

| Cliente en Vercel | Respuesta del catálogo público |
| --- | --- |
| Node, cliente HTTP del addon | HTTP 403, `cf-mitigated: challenge` |
| Chromium Headless Shell 153.0.8010.0 | HTTP 307 dentro del mismo origen y, después, HTTP 403 con `cf-mitigated: challenge` |

El resultado del navegador es `catalog:false`. La ejecución dura unos tres segundos. No se intentó iniciar sesión ni se obtuvieron enlaces de reproducción.

La prueba utilizó un contexto nuevo, sin cookies importadas, JavaScript desactivado, destino inicial fijo y un máximo de tres redirecciones GET por HTTPS dentro del mismo origen. Rechazó subrecursos, destinos de desafío, verificaciones de dispositivo y otros orígenes. No modificó la identidad del navegador ni desactivó la validación TLS. Chromium se ejecutó con los argumentos mínimos necesarios para el entorno de funciones; no se utilizaron las opciones que desactivan la seguridad web del paquete.

Se añadieron 17 pruebas para comprobar clasificación, redirecciones, límites, limpieza del navegador y ausencia de datos sensibles en el informe. El código del experimento está en el historial del repositorio. El endpoint y las dependencias temporales se retiran después de la medición para evitar costes sin una mejora comprobada.

## Qué demuestra

Ejecutar un navegador en Vercel es posible, pero esta prueba no elimina el bloqueo. La diferencia con el addon local no puede atribuirse únicamente a `fetch` de Node. El navegador local también tiene otra sesión y otra conexión de salida; esta prueba no permite separar cuál de esas condiciones decide el acceso.

## Qué sigue pendiente

No se ha conseguido reproducción alojada exclusivamente en Vercel. Para mantener ese requisito hace falta que el origen permita el acceso automatizado, por ejemplo mediante una API autorizada o una regla acordada con su responsable. Cambiar el parser, copiar una sesión local o rotar direcciones no proporciona por sí solo ese permiso.

Fuentes de implementación: [Vercel: Puppeteer en Functions](https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel), [versiones compatibles de Puppeteer](https://pptr.dev/supported-browsers), [Chromium para entornos serverless](https://github.com/Sparticuz/chromium).

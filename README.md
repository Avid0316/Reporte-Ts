# Reporte-Ts

Informe de inventario de TechnologySales, publicado con GitHub Pages.

| Archivo | Qué es |
|---|---|
| `index.html` | Página del informe (resumen mensual, cambios por sucursal, existencias bajas). |
| `app.js` | Calcula cifras y textos a partir de los datos y lee los Excel. |
| `datos.js` | Datos que se muestran al abrir la página. |
| `informe-mensual.html` | Informe mensual de control operativo (septiembre 2026). |
| `vendor/xlsx.full.min.js` | Lector de Excel ([SheetJS](https://sheetjs.com), licencia Apache 2.0). |

## Actualizar el informe cada mes

1. Abre la página y pulsa **Cargar Excel** (o arrastra el archivo). Sirve un libro con
   hojas *Entradas* e *Inventario*, o dos archivos separados. **Descargar plantilla Excel**
   muestra las columnas esperadas.
2. La página detecta las columnas sola. Si alguna no cuadra, corrígela en la lista de hojas.
3. Revisa la **fecha de corte** del inventario.
4. Pulsa **Descargar datos.js** y súbelo aquí (*Add file → Upload files*), reemplazando el
   anterior. En 1–2 minutos todos ven el informe nuevo.

Hasta el paso 4, los datos cargados solo se ven en tu navegador.

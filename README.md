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

1. Exporta del sistema los reportes **ENTRADAS** e **Inventario** tal como salen
   (por ejemplo `ENTRADAS_SEP_Y_OCT.xlsx` e `Inventario_02.11.26.xlsx`).
2. Abre la página, pulsa **Cargar Excel** y selecciona los dos archivos. La página
   reconoce cuál es cada uno y sus columnas (si alguna no cuadra, se corrige en la lista).
3. Elige el **mes del informe** y revisa la **fecha de corte** (se toma del nombre del
   archivo de inventario).
4. Pulsa **Descargar datos.js** y súbelo aquí (*Add file → Upload files*), reemplazando el
   anterior. En 1–2 minutos todos ven el informe nuevo.

Hasta el paso 4, los datos cargados solo se ven en tu navegador. `datos.js` no guarda
IMEI, proveedores ni conceptos.

### Cómo se leen los reportes

- **ENTRADAS**: se usa la columna *Cantidad* (si no existe, cada fila cuenta como una unidad). El tipo sale de *NombreConceptoAjuste*; en los
  `CAMBIOS`, la sucursal de origen sale de *Referencia*. Los accesorios se reconocen por la
  categoría del producto en el inventario.
- **Inventario**: *NombreProducto*, *NombreSucursal*, *CantidadVirtual*; marca
  (*Referencia*), categoría (*NombreSubgrupoProducto*) y condición (*NombreGrupoProducto*).
- Los nombres de sucursal escritos distinto se unifican en `app.js` (`BRANCHES` y
  `BRANCH_ALIASES`).

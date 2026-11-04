# Reporte-Ts

Informe de inventario de TechnologySales, publicado con GitHub Pages.

| Archivo | Qué es |
|---|---|
| `index.html` | Página del informe (resumen mensual, cambios por sucursal, existencias bajas). |
| `app.js` | Calcula cifras y textos a partir de los datos y lee los Excel. |
| `datos.js` | Datos que se muestran al abrir la página. |
| `incidencias.xlsx` | Todas las incidencias registradas (se actualiza al guardar). |
| `informe-mensual.html` | Informe mensual de control operativo (septiembre 2026). |
| `vendor/xlsx.full.min.js` | Lector de Excel ([SheetJS](https://sheetjs.com), licencia Apache 2.0). |

## Actualizar el informe

Arriba de la página están los 12 meses del año; cada mes muestra cuántos equipos tiene
cargados. El botón **Actualizar datos** abre el panel para cargar y guardar.

1. **Entradas de un mes:** elige el mes y pulsa **Cargar Excel de entradas** con el reporte
   ENTRADAS del sistema (con la columna *Cantidad*). Solo se toman las filas de ese mes y
   reemplazan lo que hubiera guardado para él.
2. **Inventario general:** pulsa **Cargar Excel de inventario**. Es uno solo para todo el
   informe; la fecha de corte se toma del nombre del archivo (`Inventario_02.11.26.xlsx`).
3. **Incidencias:** en la pestaña *Control e incidencias* (con el panel abierto) o en el
   panel, **+ Nueva incidencia** registra cada error del control diario: fecha del error,
   fecha de detección, tipo, sucursal, equipo, qué pasó y estado. El reporte calcula
   resueltas, pendientes, % detectadas el mismo día y la tendencia de 6 meses.
4. **Guardar cambios.** Hasta entonces, lo cargado solo se ve en tu navegador.
   - Con la **conexión con GitHub** configurada (token *fine-grained* con permiso
     *Contents: Read and write* solo en este repositorio), Guardar publica `datos.js` y en
     1–2 minutos todos ven el informe nuevo.
   - Sin conexión, Guardar descarga `datos.js` para subirlo aquí a mano
     (*Add file → Upload files*).

Al guardar con incidencias también se actualiza **`incidencias.xlsx`** en el repositorio
(todas las incidencias, con filtros); en la pestaña Control se puede descargar en cualquier
momento con **Descargar Excel**.

`datos.js` no guarda IMEI ni conceptos; en las compras guarda el proveedor (columna *Referencia*), que se ve en la pestaña Compras locales.

### Cómo se leen los reportes

- **ENTRADAS**: se usa la columna *Cantidad* (si no existe, cada fila cuenta como una
  unidad y la página lo avisa). El tipo sale de *NombreConceptoAjuste*; en los `CAMBIOS`,
  la sucursal de origen sale de *Referencia*. Los accesorios se reconocen por la categoría
  del producto en el inventario; los productos con `HIDROGEL` son insumos.
- **Inventario**: *NombreProducto*, *NombreSucursal*, *CantidadVirtual*; marca
  (*Referencia*), categoría (*NombreSubgrupoProducto*) y condición (*NombreGrupoProducto*).
- Los nombres de sucursal escritos distinto se unifican en `app.js` (`BRANCHES` y
  `BRANCH_ALIASES`).

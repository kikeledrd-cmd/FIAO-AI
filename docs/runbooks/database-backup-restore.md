# FIAO — Backup y restore (drill)

El "restore drill" del exit gate de Plan 6 exige probar que un respaldo se
puede restaurar sin perder datos.

## Backup (PostgreSQL)

```bash
# En la máquina con Docker (el contenedor publica 5433 si 5432 está ocupado)
docker exec fiao-postgres-1 pg_dump -U fiao -d fiao_dev -Fc -f /tmp/fiao.dump
docker cp fiao-postgres-1:/tmp/fiao.dump ./fiao.dump
```

En producción (Postgres gestionado), el equivalente es un `pg_dump -Fc` del
tenant completo, retenido con política de versionado (diario + semanal).

## Restore (drill)

```bash
# 1. Restaurar en una base temporal (nunca encima de la viva)
docker exec -i fiao-postgres-1 createdb -U fiao fiao_restore
docker exec -i fiao-postgres-1 pg_restore -U fiao -d fiao_restore --clean --if-exists < ./fiao.dump

# 2. Verificar invariantes de negocio
#    - saldos de fiado: Σ FIAO_SALE − Σ ABONO por cliente (no hay saldo guardado)
#    - stock: Σ StockMovement (no hay onHand guardado como única fuente)
#    - caja: esperado = float + ventas cash no anuladas + abonos + inyecciones − gastos − retiros
```

## Verificación de integridad posterior al restore

1. Contar filas por tabla crítica y comparar contra el origen:
   `OwnerAccount`, `Branch`, `User`, `Sale`, `CreditMovement`, `StockMovement`,
   `CashSession`, `CashMovement`, `Order`.
2. Recomputar el saldo de un cliente de muestra y compararlo con la UI.
3. Recomputar el esperado de caja de una sesión cerrada con diferencia.

## Reglas

- El histórico sensible es append-only: el backup es del estado completo, pero
  las correcciones en vivo siempre son eventos de reverso/ajuste, nunca edición.
- Guardar los dumps fuera del workspace y cifrarlos si contienen datos reales.
- Probar el restore en un entorno aislado, nunca en producción en vivo.

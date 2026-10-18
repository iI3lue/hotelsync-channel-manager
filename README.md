# HotelSync — Channel Manager

Microservicio Channel Manager de HotelSync: simula un proveedor OTA, ingesta reservas externas y las convierte en reservas propias, y proyecta disponibilidad y tarifas a partir de los eventos canónicos.

- **Producción:** https://hotelsync-channel-manager.onrender.com
- **Puerto local:** 3008
- **Base de datos:** `channel_manager_db` (PostgreSQL 16)

## Responsabilidad

| Hace | No hace |
| --- | --- |
| Recibir reservas de un canal externo (simulado) | Ser la fuente de verdad de las reservas (las crea en Booking) |
| Crear y confirmar la reserva en Booking con clave interna | Gestionar inventario propio (lee R&A) |
| Proyectar disponibilidad y tarifas por canal | Cobrar ni facturar |
| Mantener reservas externas idempotentes por `external_id` | Autenticar huéspedes |

## Tecnologías

Node.js ≥20 · TypeScript · Express · Prisma · PostgreSQL 16 · Zod · RabbitMQ (consumidor de eventos).

## Arquitectura interna

`Route → Controller → Service → Prisma`, con Zod y `AppError`. El endpoint de simulador se autentica con `x-provider-key` contra el hash SHA-256 guardado por canal. La ingesta crea la reserva en Booking (`POST /bookings` + `confirm`) usando `x-channel-manager-key` y registra el `external_id` para que un reintento sea idempotente. El consumidor mantiene proyecciones locales de inventario y tarifas; `booking.created` no afecta inventario (queda pendiente hasta la confirmación).

## Endpoints

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | `/health` | — | Estado del servicio |
| POST | `/v1/simulator/:channel/reservations` | `x-provider-key` | Ingesta una reserva OTA simulada |
| GET | `/v1/simulator/:channel/state?room_type_id&from&to` | `x-provider-key` | Estado proyectado del canal |

`external_id` es opcional en el body; si falta se genera `SIM-…`. La respuesta propaga 201/200/409/400 de Booking.

## Modelo de datos

Tablas: `Channel`, `ExternalReservation`, `ChannelInventory`, `ChannelRate`.

Migraciones en `prisma/migrations` (1). Seed: asegura el canal `simulado` con el hash de `CHANNEL_MANAGER_SIMULATOR_KEY` (mínimo 32 caracteres).

## Comunicación

- **Consume:** `booking.created`, `booking.confirmed`, `booking.cancelled`, `availability.updated` y `rate.updated`.
- **REST saliente:**
  - Booking: `POST /v1/bookings`, `POST /v1/bookings/:id/confirm`, `GET /v1/bookings/:id`, `POST /v1/bookings/:id/cancel` (header `x-channel-manager-key`).
  - Rate & Availability: `GET /v1/availability/range` y `GET /v1/availability` para proyectar estado.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `NODE_ENV` | No | `development` / `production` |
| `PORT` | No | Puerto HTTP (default 3008) |
| `DATABASE_URL` | Sí | PostgreSQL de `channel_manager_db` |
| `BOOKING_SERVICE_URL` | Sí | Base de booking-service |
| `RATE_SERVICE_URL` | Sí | Base de Rate & Availability |
| `CHANNEL_MANAGER_SERVICE_KEY` | Sí | Clave hacia Booking (`x-channel-manager-key`) |
| `CHANNEL_MANAGER_SIMULATOR_KEY` | Sí | Provider-key del canal simulado (mín. 32); también la usa el seed |
| `RABBITMQ_URL` | No | Sin ella no se actualizan proyecciones ni reservas |

Copiar `.env.example` a `.env` y completar los valores.

## Ejecución local

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run seed
npm run dev                 # http://localhost:3008
```

Ejemplo de ingesta:

```bash
curl -X POST http://localhost:3008/v1/simulator/simulado/reservations \
  -H "Content-Type: application/json" \
  -H "x-provider-key: $CHANNEL_MANAGER_SIMULATOR_KEY" \
  -d '{"hotel_id":"<uuid>","room_type_id":"<uuid>","check_in":"2026-11-01","check_out":"2026-11-03","total_amount":250000,"guest":{"name":"Demo","email":"demo@example.com","phone":"3000000000"}}'
```

## Despliegue

Render (Oregon, free): build `npm ci && npx prisma generate && npm run build`; start `npx prisma migrate deploy && npm start`; Neon `channel_manager_db`. El front lo consume por el BFF (`CHANNEL_MANAGER_API_URL` + `CHANNEL_MANAGER_SIMULATOR_KEY`), nunca desde el navegador. El plan free duerme a los 15 minutos.

## Pruebas y verificación

```bash
npm test
npm run lint
curl https://hotelsync-channel-manager.onrender.com/health
```

## Respaldo de base de datos

```bash
pg_dump "$DATABASE_URL" -Fc -f channel_manager_db.dump
pg_restore --clean --if-exists -d "$DATABASE_URL" channel_manager_db.dump
```

## Estructura

```
src/{routes,controllers,services,validators,middleware,lib}
prisma/{schema.prisma,seed.ts,migrations}
tests/
```

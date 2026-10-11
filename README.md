# hotelsync-channel-manager

Microservicio Channel Manager de HotelSync (v0.1): proveedor OTA simulado,
ingesta de reservas externas hacia Booking por contrato interno y publicación
de disponibilidad/tarifas desde eventos canónicos.

Extraído del monorepo HotelSync como repo autocontenido (un repo por microservicio).

## Stack

Node 20 · Express 4 · Prisma 6 (PostgreSQL) · RabbitMQ (amqplib) · TypeScript · Jest + ts-jest

## Variables de entorno

| Variable                              | Uso                                                        |
| ------------------------------------- | ---------------------------------------------------------- |
| `PORT`                                | Puerto HTTP (Render inyecta el suyo, ej. 10000)            |
| `DATABASE_URL`                        | Conexión PostgreSQL (`channel_manager_db`)                 |
| `RABBITMQ_URL`                        | RabbitMQ (CloudAMQP); vacío = eventos deshabilitados       |
| `BOOKING_SERVICE_URL`                 | URL base de booking (`.../v1`)                             |
| `RATE_SERVICE_URL`                    | URL base de rate-availability (`.../v1`)                   |
| `CHANNEL_MANAGER_SERVICE_KEY`         | Clave que Booking exige a este servicio (mín. 32 chars)    |
| `CHANNEL_MANAGER_SIMULATOR_KEY`       | Clave del proveedor simulado; la usa el seed (mín. 32)     |
| `NODE_ENV`                            | `development` / `production`                               |

Ver `.env.example`. Sin `RABBITMQ_URL` el servicio arranca igual pero no consume eventos.

## Scripts

- `npm run dev` - desarrollo con recarga
- `npm run build` / `npm start` - compilación y arranque
- `npm run lint` - `tsc --noEmit`
- `npm test` - Jest (unit + integration; integración requiere DB)
- `npm run seed` - asegura el canal `simulado` (requiere `CHANNEL_MANAGER_SIMULATOR_KEY`)

## Health

`GET /health` → `{ status: "ok" }` (usado como healthCheckPath en Render).

## Despliegue (Render, plan free)

Build: `npm ci && npx prisma generate && npm run build`
Start: `npx prisma migrate deploy && npm start`

Tras el primer deploy, correr el seed una vez con `CHANNEL_MANAGER_SIMULATOR_KEY`
definido para dar de alta el canal `simulado`.

# WattWise — Developer notes

## Policy: Tesla API is read-only

The backend MUST NOT issue any write/command calls to the Tesla API (Powerwall,
Solar, or Vehicle). This is an explicit product decision — the app is advisory,
not automated. Device control belongs to the user via the Tesla app.

**Forbidden (do not add):**
- `site.set_backup_reserve_percent(...)`
- `site.set_operation(...)` — self_consumption / backup / autonomous
- `site.set_off_grid(...)` / `set_grid_charging(...)`
- `vehicle.command(...)` of any kind (charge_start, charge_stop, wake_up,
  climate_on, door_unlock, trunk, honk_horn, flash_lights, etc.)
- `site.api("<WRITE_ENDPOINT>", ...)` with non-GET payloads
- Any `POST` to `owner-api.teslamotors.com/api/1/energy_sites/.../command/...`

**Allowed (read-only):**
- `tesla.battery_list()`, `tesla.solar_list()` — list products
- `site.get_site_data()` — current telemetry
- `site.get_calendar_history_data(kind="power"|"soe", ...)` — history
- `site.api("SITE_CONFIG")` — site configuration (address, capacity, tariff)
- OAuth: `tesla.fetch_token(...)`, `tesla.authorization_url(...)`

**Context:** Auto Mode and `backend/optimizer/act.py` were removed in commit
`1bce673`. The optimizer is now a pure forecast/recommendation engine — it
generates a 24-hour plan stored in `optimizer_state.current_plan` and the
frontend reads it via `GET /optimizer/plan`. No scheduler path issues device
commands.

Nest and Smartcar (BMW) writes remain allowed because those are user-initiated
through the Optimize tab device cards (thermostat mode, temp adjust, EV
start/stop charging).

## Deployment

- Backend: Railway, auto-deploys from `origin/main` (see `railway.json`)
- Frontend: Next.js, `.env.local` points API to `localhost:8000` for local dev

After pushing backend changes, the scheduler will regenerate plans on its next
hourly tick; there is no manual trigger endpoint.

# soukcart
Ground-up B2B marketplace from UI Twin specs + project plan. Not a clone of the old SoukCart repo.

## Stack
- client: React + Vite + Tailwind + React Context
- server: Express + Mongoose
- DB: MongoDB Atlas (cloud) — `app/server/.env` → `MONGODB_URI`

## Quick start (one command)

From the `app` folder:

```bash
# 1) Install deps (first time only)
npm install                      # app root (concurrently), then:
npm run install:all              # server + client deps

# 2) Seed Atlas (wipes DB, creates ONLY the admin user)
npm run seed

# 3) Start backend + frontend together
npm run dev
```

Open http://localhost:5173

> `npm run dev` runs the API (`app/server`) and the client (`app/client`) together via
> `concurrently`. The API reads its config from `app/server/.env` — set `MONGODB_URI` there to a
> local MongoDB (`mongodb://127.0.0.1:27017/nekcart`) or MongoDB Atlas before seeding.

### Seed
The seed script wipes every collection and creates **only** the admin user (no categories, products, orders, suppliers or retailers).

| Role | Name | Email | Password |
| --- | --- | --- | --- |
| Admin | Admin | admin@soukcart.com | admin123456 |

# SoukCart

B2B marketplace where retailers order from verified suppliers and admins manage the platform.

## Stack

- Client: React, Vite, Tailwind
- Server: Express, Mongoose
- Database: MongoDB
- Payments: SSLCommerz (sandbox)
- Image uploads: Cloudinary

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `server/.env.example` to `server/.env` and set `MONGODB_URI`, `JWT_SECRET`, the SSLCommerz store credentials and the Cloudinary keys.

3. Seed the database. This wipes all data and creates the admin user:

   ```bash
   npm run seed
   ```

4. Start the API and client:

   ```bash
   npm run dev
   ```

The client runs at http://localhost:5173 and the API at http://localhost:5001.

## Admin login

Sign in at `/admin`. The seed script creates the admin account. Its credentials are in `server/src/seed.js`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run server and client together |
| `npm run seed` | Reset the database and create the admin |
| `npm run build` | Build the client |

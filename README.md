# Microwave Travel

Simple Vue + Node.js travel planner for turning rough trip requirements into an optimized route.

The current optimizer is an MVP: it uses a small built-in city/route heuristic dataset, supports repeated stops, and checks deadline requirements such as `Dubai before 1 June`. It does not call airline, visa, rail, hotel, or live price APIs yet.

## Run

```bash
npm install
npm run dev
```

The Vue app runs through Vite, and the Express API listens on `http://127.0.0.1:3444`.

## Verify

```bash
npm test
npm run build
```

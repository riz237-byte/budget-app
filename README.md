# Budget App

Personal finance app built as a static web app for GitHub Pages.

## Architecture

- **Frontend:** React + Vite, hosted on GitHub Pages.
- **API gateway:** Cloudflare Worker. It keeps the Google Apps Script secret off the public frontend and handles browser CORS.
- **Database:** the existing Google Sheet. The API reads and writes the existing sheets; it does not run migrations or reset data.

## Data safety

The application expects these existing sheets:

- `Movimenti`: Data, Tipo, Descrizione, Importo, Conto, Categoria
- `SaldiMensili`: Anno, Mese, Conto iniziale, Contanti iniziali, Investimenti inizio mese, Conto finale, Contanti finali, Investimenti fine mese
- `BudgetMensili` (optional): Anno, Mese, Budget mensile

The bootstrap/read operation is read-only. It does not create sheets, rewrite headers, import historical data, or change investment balances. The only writes happen after an explicit user action in the app.

## Setup status

This repository contains the new application scaffold. The live Google Sheet is not connected yet. Do not add spreadsheet IDs, API secrets, passwords, or personal financial data to this repository.

See `docs/SETUP.md` for the setup sequence.

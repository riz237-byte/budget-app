# Configurazione

## GitHub Pages
Apri Settings → Pages. Seleziona Deploy from a branch, branch main, cartella /(root), quindi salva. L'indirizzo atteso è https://riz237-byte.github.io/budget-app/.

## Google Apps Script
Il backend verrà configurato come progetto Apps Script separato e collegato allo Spreadsheet esistente tramite SPREADSHEET_ID nelle Script Properties. Imposta anche API_SECRET con una stringa casuale lunga almeno 32 caratteri. Pubblica come Web App eseguita dal proprietario. L'endpoint deve rifiutare ogni richiesta senza il segreto. Non inserire mai ID, token, password o dati personali nel repository.

Il codice backend deve leggere e scrivere solo fogli e intestazioni già presenti. La lettura iniziale deve essere read-only: niente creazione di fogli, modifiche alle intestazioni, migrazioni, importazioni storiche o reset.

## Cloudflare Worker
Crea un Worker con variabile GAS_URL (URL Web App Apps Script), secret API_SECRET (lo stesso configurato in Apps Script) e ALLOWED_ORIGIN (https://riz237-byte.github.io). Il Worker deve gestire OPTIONS/CORS, accettare solo l'origine autorizzata e inoltrare solo azioni consentite. Il segreto non deve arrivare al browser.

## Frontend
Prima di app.js, imposta window.BUDGET_API_URL all'URL del Worker, ad esempio https://nome-worker.workers.dev.

## Stato attuale
Questa è la base grafica iniziale, non ancora collegata. Il pulsante Aggiungi è disabilitato funzionalmente e non scrive dati. Prima attiveremo e testeremo la sola lettura del foglio, poi le scritture esplicite. Non eseguire funzioni di inizializzazione o migrazione sul foglio esistente.
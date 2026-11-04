# Budget App

Dashboard personale in sola lettura, pubblicato con GitHub Pages e collegato a Google Sheets attraverso Cloudflare Worker e Google Apps Script.

Il bootstrap legge soltanto i fogli esistenti `Movimenti`, `BudgetMensili` e `SaldiMensili`. Non esegue inizializzazioni, migrazioni, importazioni, reset o scritture. Il repository non contiene ID del foglio, segreti o dati finanziari.

Prima di collegare il foglio, proteggi il Worker con Cloudflare Access: la restrizione CORS non è un controllo di accesso. La procedura completa è in [docs/SETUP.md](docs/SETUP.md).


# Budget App

Dashboard personale pubblicata con GitHub Pages e collegata a Google Sheets tramite Cloudflare Worker e Apps Script.

La home mostra patrimonio, budget e spese per categoria, entrate, uscite, bilancio, andamento degli investimenti e movimenti raggruppati per giorno. Il menu include **Budget mensile** e **Riepilogo annuale**. Le modifiche al foglio avvengono solo quando l'utente salva un movimento, un patrimonio finale o i budget per categoria.

Il backend non esegue inizializzazioni, migrazioni, importazioni o reset. Il repository non contiene l'ID del foglio, segreti o dati finanziari. Vedi [docs/SETUP.md](docs/SETUP.md) per pubblicare gli aggiornamenti.

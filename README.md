# Budget App

Dashboard personale pubblicata con GitHub Pages e collegata a Google Sheets tramite Cloudflare Worker e Apps Script.

La home mostra patrimonio totale, ultimo saldo inserito, investimento del mese e tutti i movimenti del mese selezionato. Il menu include **Budget mensile** e **Riepilogo annuale**. La modifica di un movimento aggiorna solo la riga selezionata quando si preme **Salva**.

Il backend non esegue inizializzazioni, migrazioni, importazioni o reset. Il repository non contiene l'ID del foglio, segreti o dati finanziari. Vedi [docs/SETUP.md](docs/SETUP.md) per pubblicare gli aggiornamenti.


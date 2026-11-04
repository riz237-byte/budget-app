# Budget App

Dashboard personale pubblicata con GitHub Pages, protetta da login email/password e collegata a Cloudflare Worker + D1.

La prima configurazione consente di copiare nel database Cloudflare i movimenti, i saldi e i budget del foglio Google. Il foglio originale resta intatto come backup. Dopo la verifica dei dati, si rimuovono dal Worker i collegamenti temporanei a Google.

Il repository contiene codice e schema del database, mai dati finanziari, password o chiavi segrete. Per configurare e migrare il progetto, segui [docs/SETUP.md](docs/SETUP.md).


# Cloudflare: database, accesso e passaggio dei dati

L'app usa GitHub Pages per la pagina e Cloudflare Worker + D1 per il servizio e i dati. L'accesso è con email e password. Il foglio Google viene letto una sola volta durante la migrazione e resta intatto come copia di sicurezza.

## Preparare D1

1. In Cloudflare apri **Workers & Pages → D1 SQL Database → Create database** e crea `budget-app-db`.
2. Copia il **Database ID** mostrato da Cloudflare. È un identificativo, non una password.
3. Nel progetto sostituisci `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID` in `worker/wrangler.toml` con quel valore.
4. Apri la Console SQL del database e applica tutto il contenuto di `worker/migrations/0001_initial.sql` una volta sola.

## Collegare il Worker

Nel Worker `budget-app-api`, aggiungi il binding D1 con nome `DB` e scegli `budget-app-db`. Imposta queste variabili in **Settings → Variables and Secrets**:

- `ALLOWED_ORIGIN`: `https://riz237-byte.github.io`.
- `OWNER_EMAIL` come **secret**: il tuo indirizzo email di accesso.
- `INITIAL_SETUP_KEY` come **secret**: una stringa casuale lunga almeno 32 caratteri. La userai una sola volta per creare l'accesso iniziale.
- Mantieni temporaneamente le variabili/secret esistenti `GAS_URL` e `API_SECRET`: servono solo a leggere il foglio per la migrazione.

Pubblica `worker/src/index.js` e verifica che il Worker riceva il binding `DB`. Se Cloudflare Access è attivo su questo Worker, disattivalo: il nuovo login dell'app protegge già le richieste e Access intercetterebbe la schermata di accesso.

## Creare l'accesso e trasferire i dati

1. Apri `https://riz237-byte.github.io/budget-app/` e inserisci l'indirizzo email autorizzato, la password scelta (almeno 12 caratteri) e `INITIAL_SETUP_KEY`.
2. L'app mostra il trasferimento dal foglio. Premi **Copia i miei dati**: il Worker legge i movimenti, i budget, i saldi e i budget per categoria già presenti e li copia in D1. Nessun dato viene scritto o cancellato nel foglio.
3. Verifica la dashboard, il totale dei movimenti e gli ultimi saldi. Il trasferimento è registrato come completato e non viene ripetuto automaticamente.
4. Dopo la verifica, elimina `GAS_URL` e `API_SECRET` dai segreti/variabili del Worker. Da quel momento il Worker non dipende più da Google Sheets.

La password viene derivata con PBKDF2 e non è salvata in chiaro. Le sessioni durano 30 giorni e il token è conservato nella sessione della scheda del browser; chiudendo la scheda può essere necessario accedere di nuovo. Non mettere password o chiavi segrete in `config.js`, nel repository o nei messaggi.

## Distribuzione

GitHub Pages continua a usare l'URL pubblico del Worker in `config.js`. `worker/wrangler.toml` contiene solo il binding e l'origine pubblica; `OWNER_EMAIL`, `INITIAL_SETUP_KEY`, `API_SECRET` e ogni altra chiave restano nelle impostazioni private del Worker. Non caricare file esportati dal foglio nel repository.

## Verifica

- Senza login, `/api/bootstrap` deve rispondere `401` e non restituire dati.
- Dopo il login, la dashboard deve mostrare i dati importati; prova anche una modifica a un budget e ricarica la pagina.
- `OPTIONS` deve ricevere `204` con CORS solo per l'origine GitHub Pages configurata.
- La schermata iniziale e il trasferimento devono essere completati prima di rimuovere i vecchi segreti Google dal Worker.


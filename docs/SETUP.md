# Configurazione e uso

Il backend legge i fogli già esistenti e non esegue inizializzazioni, importazioni, migrazioni o reset. Gli unici aggiornamenti al foglio sono le modifiche di un singolo movimento dopo che l'utente preme **Salva** nell'app.

## Aggiornare Apps Script

1. Apri il progetto Apps Script collegato al nuovo foglio e sostituisci `Code.gs` con `apps-script/Code.gs`.
2. Mantieni le Script Properties private `SPREADSHEET_ID` e `API_SECRET` già configurate.
3. Salva. Vai in **Deploy → Manage deployments**, modifica la Web App esistente, seleziona **New version** e fai deploy. Se Google richiede autorizzazioni aggiuntive per modificare il foglio, esaminale e autorizza.

## Aggiornare Cloudflare Worker

1. Apri il Worker `budget-app-api`, scegli **Edit code** e sostituisci il codice con `worker/src/index.js`.
2. In **Settings → Variables and Secrets** verifica che `GAS_URL` punti all'URL `/exec` Apps Script, `ALLOWED_ORIGIN` sia `https://riz237-byte.github.io` e `API_SECRET` sia il secret già configurato.
3. Distribuisci il Worker. Mantieni Cloudflare Access attivo solo per gli utenti autorizzati e mantieni il bypass delle richieste `OPTIONS`; il codice Worker risponde con CORS per l'origine esatta.

Il Worker espone `GET /api/bootstrap` e `POST /api/movimenti/edit`. Il secondo percorso accetta soltanto data, descrizione, categoria, tipo e importo e aggiorna le celle corrispondenti nella riga indicata. Il conto non è mostrato né modificabile dall'interfaccia.

## Pubblicare l'interfaccia

Le modifiche in `index.html`, `app.js` e `styles.css` si pubblicano con GitHub Pages dalla branch `main` e cartella `/(root)`. `config.js` deve contenere solo l'URL pubblico del Worker, mai ID o segreti.

## Calcoli

- Patrimonio e totale usano l'ultimo saldo mensile disponibile fino al mese visualizzato, usando i valori finali inseriti nel foglio.
- I versamenti sono movimenti `Uscita` con categoria `Investimenti`; i prelievi sono `Entrata` con categoria `Investimenti`.
- Il guadagno mensile è fine mese meno inizio mese, meno versamenti, più prelievi. Il capitale investito cumulativo parte dal valore iniziale del primo mese registrato, poi aggiunge i versamenti e sottrae i prelievi. Il guadagno totale è fine mese meno capitale investito cumulativo.
- Budget mensile e riepilogo annuale escludono i movimenti di categoria `Investimenti` dalle uscite di budget.

## Verifica manuale

1. Accedi al Worker in Brave e ricarica la pagina Budget.
2. Verifica che patrimonio, dettaglio investimenti e movimenti siano coerenti con il mese di saldo mostrato.
3. Prova il menu **Budget mensile** e **Riepilogo annuale**.
4. Per correggere un movimento, usa l'icona di modifica nella sua riga, controlla i campi e premi **Salva**. La riga verrà aggiornata nel foglio solo dopo questa conferma.


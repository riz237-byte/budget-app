# Configurazione e uso

Il backend legge i fogli già esistenti e non esegue inizializzazioni, importazioni, migrazioni o reset all'avvio. Scrive solo dopo un'azione esplicita nell'app: modifica di un movimento, salvataggio del patrimonio finale o salvataggio dei budget per categoria. La scheda `BudgetCategorie` viene creata solo al primo salvataggio dei budget per categoria.

## Aggiornare Apps Script

1. Apri il progetto Apps Script collegato al nuovo foglio e sostituisci `Code.gs` con `apps-script/Code.gs`.
2. Mantieni le Script Properties private `SPREADSHEET_ID` e `API_SECRET` già configurate.
3. Salva. Vai in **Deploy → Manage deployments**, modifica la Web App esistente, seleziona **New version** e fai deploy. Se Google richiede autorizzazioni aggiuntive per modificare il foglio, esaminale e autorizza.

## Aggiornare Cloudflare Worker

1. Apri il Worker `budget-app-api`, scegli **Edit code** e sostituisci il codice con `worker/src/index.js`.
2. In **Settings → Variables and Secrets** verifica che `GAS_URL` punti all'URL `/exec` Apps Script, `ALLOWED_ORIGIN` sia `https://riz237-byte.github.io` e `API_SECRET` sia il secret già configurato.
3. Distribuisci il Worker. Mantieni Cloudflare Access attivo solo per gli utenti autorizzati e mantieni il bypass delle richieste `OPTIONS`; il codice Worker risponde con CORS per l'origine esatta.

Il Worker espone `GET /api/bootstrap`, `POST /api/movimenti/edit`, `POST /api/saldi/save` e `POST /api/budgets/categories`. I tre percorsi POST sono chiamati solo dai rispettivi pulsanti **Salva** nell'app. I saldi modificano o aggiungono la riga del mese selezionato in `SaldiMensili`; il primo saldo inserito parte da valori iniziali pari a zero. I budget usano `BudgetMensili` per il totale mensile e la scheda `BudgetCategorie` per categoria, percentuale e importo. Il conto dei movimenti non è mostrato né modificabile.

## Pubblicare l'interfaccia

Le modifiche in `index.html`, `app.js` e `styles.css` si pubblicano con GitHub Pages dalla branch `main` e cartella `/(root)`. `config.js` deve contenere solo l'URL pubblico del Worker, mai ID o segreti.

## Calcoli

- Patrimonio e totale usano l'ultimo saldo mensile disponibile fino al mese visualizzato, usando i valori finali inseriti nell'app o nel foglio. Il patrimonio atteso parte dal patrimonio finale del mese precedente e aggiunge entrate meno uscite del mese.
- I versamenti sono movimenti `Uscita` con categoria `Investimenti`; i prelievi sono `Entrata` con categoria `Investimenti`.
- Il capitale investito cumulativo è la somma dei versamenti (uscite con categoria `Investimenti`) meno i prelievi (entrate con la stessa categoria). Il guadagno mensile è fine mese meno inizio mese, meno versamenti, più prelievi. Il guadagno totale è fine mese meno capitale investito cumulativo.
- Il piano iniziale da 360 € ripartisce il budget in Investimenti 45%, Spese fisse 16,2%, Cibo 19,4%, Trasporti 5%, Shopping / svago 8,3% e Imprevisti / altro 6%. Le percentuali sono arrotondate e sommano al 99,9%. Spese fisse viene associato agli Abbonamenti.
- Nella pagina **Budget mensile** si possono modificare il totale, la percentuale e l'importo di ciascuna voce. Cambiare percentuale ricalcola l'importo; cambiare importo ricalcola la percentuale; cambiare il totale ricalcola gli importi. Il salvataggio applica i valori da quel mese in avanti fino alla modifica successiva. La home mostra speso, disponibile e budget per ciascuna voce.
- Budget mensile e riepilogo annuale escludono i movimenti di categoria `Investimenti` dalle uscite di budget.

## Verifica manuale

1. Accedi al Worker in Brave e ricarica la pagina Budget.
2. Verifica che patrimonio, dettaglio investimenti e movimenti siano coerenti con il mese di saldo mostrato.
3. Prova il menu **Budget mensile** e **Riepilogo annuale**.
4. Per aggiornare il patrimonio, scegli il mese, premi **Patrimonio finale**, inserisci conto, contanti e investimenti, quindi premi **Salva saldo**.
5. Per impostare i budget, apri **Budget mensile**, compila i valori per categoria e premi **Salva budget**. La scheda `BudgetCategorie` verrà aggiunta al foglio in quel momento.
6. Per correggere un movimento, usa l'icona di modifica nella sua riga, controlla i campi e premi **Salva**. La riga verrà aggiornata nel foglio solo dopo questa conferma.

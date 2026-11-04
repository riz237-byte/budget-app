# Configurazione sicura in sola lettura

Questa procedura collega l'app al nuovo Google Sheet senza cambiare il foglio. Non eseguire initializer o utility di importazione/migrazione.

## 1. GitHub Pages

In `riz237-byte/budget-app`, apri **Settings → Pages** e seleziona **Deploy from a branch**, branch `main`, cartella `/(root)`. L'indirizzo sarà `https://riz237-byte.github.io/budget-app/`; l'origine CORS da usare è `https://riz237-byte.github.io`.

## 2. Apps Script

1. Dal nuovo Google Sheet apri **Estensioni → Apps Script**.
2. Sostituisci il contenuto dell'editor con `apps-script/Code.gs` e salva. Il codice contiene solo `doPost` per il bootstrap e nessuna funzione di scrittura o inizializzazione.
3. In **Impostazioni progetto → Proprietà script**, imposta `SPREADSHEET_ID` con l'ID del nuovo foglio e `API_SECRET` con una stringa casuale lunga almeno 32 byte. Conserva il segreto per il passaggio successivo. Non inserirli in GitHub, nel frontend o in chat.
4. In **Deploy → Nuova implementazione → App web**, scegli **Esegui come: Me** e **Chi può accedere: Chiunque**. Il Worker autentica ogni richiesta con il segreto; copia l'URL `/exec`.
5. Non eseguire funzioni manuali: questa implementazione non ne richiede.

Per generare un segreto localmente in PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Imposta lo stesso valore direttamente nelle proprietà private Apps Script e nel campo secret di Cloudflare. Non salvarlo in un file di configurazione.

## 3. Cloudflare Worker

1. Crea un Worker dal file `worker/src/index.js` (entry point) e dalla configurazione `worker/wrangler.toml`, oppure incolla il sorgente nell'editor Cloudflare.
2. Imposta la variabile Worker `GAS_URL` con l'URL `/exec` Apps Script e `ALLOWED_ORIGIN` con `https://riz237-byte.github.io`.
3. Aggiungi `API_SECRET` come **secret** del Worker, con il valore usato in Apps Script. Non impostarlo come variabile visibile e non inserirlo in `wrangler.toml`.
4. Distribuisci il Worker e abilita **Cloudflare Access** sulla produzione del Worker, con una policy di accesso consentita solo al tuo indirizzo e-mail. L'Access protegge anche l'hostname `workers.dev` del Worker.
5. Nelle impostazioni CORS di Access, abilita il passaggio delle richieste `OPTIONS` verso il Worker (preflight bypass) senza impostare in Access le intestazioni CORS di risposta; le intestazioni le aggiunge il codice Worker.
6. Visita una volta l'URL base del Worker nel browser e completa l'accesso Access. Poi la pagina GitHub Pages può inviare il fetch includendo il cookie Access.

CORS limita quali pagine possono leggere la risposta nel browser; da solo non protegge i dati. La policy Access e il segreto Apps Script sono entrambi necessari prima di collegare dati reali.

## 4. Collega la pagina

Apri `config.js` e imposta `window.BUDGET_API_URL` all'URL base del Worker, senza slash finale, ad esempio `https://budget-app-api.<account>.workers.dev`. Salva e pubblica la modifica su `main`. L'URL Worker non è un segreto; `API_SECRET` non deve mai comparire qui.

La pagina esegue solo `GET /api/bootstrap`; il Worker inoltra un `POST` privato ad Apps Script con l'azione `bootstrap`. La risposta usa i campi previsti dalla dashboard: `movimenti`, `budgets` e `saldi`.

## 5. Verifica manuale senza modificare il foglio

1. Apri il Worker URL prima dell'app e verifica che Cloudflare Access richieda l'accesso. Dopo l'accesso, ricarica la pagina GitHub Pages.
2. In DevTools → Network controlla che la pagina chiami soltanto `GET <worker-url>/api/bootstrap` e che riceva JSON con gli array `movimenti`, `budgets` e `saldi`.
3. Controlla che la dashboard mostri il mese corrente, il budget, i movimenti e i saldi. Un altro `Origin` deve ricevere `403` e nessuna intestazione CORS permissiva.
4. Invia una richiesta `OPTIONS` con l'origine GitHub Pages e verifica status `204` e `Access-Control-Allow-Origin: https://riz237-byte.github.io`.
5. Verifica le esecuzioni Apps Script: devono essere solo `doPost` avviate dal Worker. Se la risposta dice che il backend non riesce a leggere il foglio, controlla proprietà e nomi/intestazioni esistenti; non correggerli con scritture automatiche.

Il Worker risponde solo a `GET /api/bootstrap` e `OPTIONS`; qualsiasi altro percorso o metodo è rifiutato. Non usare l'endpoint Apps Script direttamente dal browser.


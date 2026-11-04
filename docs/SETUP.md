# Supabase, accesso e trasferimento dati

La pagina resta su GitHub Pages. Supabase gestisce l’accesso email/password e salva i dati; il Worker Cloudflare fa da collegamento server-side, così nessuna chiave Supabase o Google è nel browser o nel repository. Le tabelle applicano Row Level Security e accettano solo le righe dell’utente autenticato.

## Progetto Supabase

Il progetto **Budget App** è stato creato in regione UE e le tabelle `movements`, `monthly_budgets`, `category_budgets`, `balances` e `migration_state` sono state predisposte con RLS. Il progetto è sul piano gratuito: Supabase può sospendere i progetti gratuiti dopo una settimana di attività insufficiente; i dati restano nel progetto e si può riattivare dal pannello. Consulta [prezzi](https://supabase.com/pricing) e [sospensione dei progetti gratuiti](https://supabase.com/docs/guides/platform/free-project-pausing).

## Impostazioni private del Worker

Nel Worker `budget-app-api`, in **Settings → Variables and Secrets**, imposta o aggiungi:

- `ALLOWED_ORIGIN` (variabile): `https://riz237-byte.github.io`.
- `APP_URL` (variabile): `https://riz237-byte.github.io/budget-app/`.
- `SUPABASE_URL` (secret): l’URL API del progetto Budget App.
- `SUPABASE_PUBLISHABLE_KEY` (secret): la chiave publishable del progetto.
- `OWNER_EMAIL` (secret): l’indirizzo email autorizzato.
- `INITIAL_SETUP_KEY` (secret): una stringa casuale lunga almeno 32 caratteri, da usare per la prima registrazione.
- Conserva temporaneamente `GAS_URL` e `API_SECRET` già configurati: servono solo alla copia iniziale dei dati.

Non usare mai la chiave `service_role` o una chiave `sb_secret_` nel Worker o nel frontend. Il Worker inoltra le richieste con la sessione dell’utente; i controlli RLS del database restano attivi.

Pubblica `worker/src/index.js` e verifica il binding delle variabili. Disattiva Cloudflare Access sul Worker: altrimenti intercetterebbe le richieste di accesso e il preflight CORS. Il Worker gestisce già `OPTIONS` e consente solo l’origine GitHub Pages.

## Primo accesso e migrazione

1. In Supabase → **Authentication → URL Configuration**, imposta il **Site URL** e aggiungi ai redirect consentiti l’URL esatto `https://riz237-byte.github.io/budget-app/`.
2. Apri l’app e crea l’account con l’email autorizzata, la password scelta (almeno 12 caratteri) e `INITIAL_SETUP_KEY`.
3. Conferma l’indirizzo email dal messaggio ricevuto. Poi rimuovi `INITIAL_SETUP_KEY` dalle variabili del Worker: da quel momento la registrazione iniziale è chiusa.
4. Accedi all’app. Nella schermata di trasferimento premi **Copia i miei dati**. Il Worker legge dal foglio movimenti, budget, saldi e budget per categoria e li copia nel progetto Supabase. Il foglio non viene modificato.
5. Controlla il numero di movimenti e saldi mostrato al termine e confronta la dashboard. Solo dopo la verifica elimina `GAS_URL` e `API_SECRET` dalle impostazioni del Worker.

Se non ricevi il messaggio di conferma, controlla la posta indesiderata e la configurazione email di Supabase. Non inviare password, chiavi o codici qui.

## Dati e sicurezza

La password è gestita da Supabase Auth; il Worker non la conserva. Le sessioni si rinnovano con il refresh token e restano nella sessione del browser. Ogni richiesta ai dati verifica l’utente e passa la sua sessione alle API Supabase, dove le policy RLS limitano lettura e modifiche alle sue righe. Il trasferimento si può riprovare se si interrompe: usa upsert e non cancella righe.

Il repository include solo codice e schema. Non aggiungere esportazioni dal foglio, password, chiavi, `GAS_URL` o `API_SECRET`.


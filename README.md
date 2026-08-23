# MarketReader 📈🤖

**MarketReader** è un'applicazione web moderna e reattiva costruita con **Next.js 15 (App Router)**, **TypeScript** e **Tailwind CSS**. Offre una visualizzazione interattiva dei prezzi tramite grafici candlestick di TradingView e un assistente di analisi tecnica automatizzato alimentato da **Google Gemini AI** con fallback dinamico multi-modello.

---

## ✨ Funzionalità Principali

- 🔒 **Protezione Globale con Password (Middleware)**: Accesso riservato protetto da `APP_PASSWORD` con middleware Edge, cookie `httpOnly` firmato e sessione di 30 giorni.
- 📊 **Grafico Candlestick Interattivo**: Alimentato da TradingView `lightweight-charts`, tema scuro, crosshair magnetico e pieno supporto responsive.
- ⚡ **Dati di Mercato in Tempo Reale**: Chiamate verso l'API Twelve Data per la coppia **XAU/USD** (Oro/Dollaro) su timeframe 15 minuti (ultime 100 candele).
- 🕒 **Controllo Orari di Mercato (New York Time)**: Rilevamento automatico delle sessioni aperte e chiuse (weekend/rollover) con banner di avviso a bassa liquidità.
- 🧮 **Motore Indicatori Tecnici**: Calcolo lato applicativo di:
  - Medie Mobili Esponenziali: **EMA 20** ed **EMA 50**
  - Indice di Forza Relativa: **RSI (14)**
  - Average True Range: **ATR (14)** per la misura della volatilità
  - Rilevamento automatico e clustering dei **2 supporti ($S_1, S_2$)** e **2 resistenze ($R_1, R_2$)** chiave più vicini al prezzo corrente.
- 🧠 **Analisi Tecnica con Google Gemini AI**:
  - Modello di lettura educativa del mercato (trend, forza del trend, volatilità, livelli chiave, scenario probabile e punti da monitorare).
  - **Cascata di Fallback con Retry**: Passaggio automatico tra `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-latest` con fino a 2 tentativi per modello.
- 🔄 **Auto-Polling Ottimizzato**:
  - Aggiornamento candele ogni 60 secondi.
  - Aggiornamento analisi AI ogni 90 secondi per non sprecare token e preservare i limiti di quota.
  - Pulsanti di refresh manuale istantaneo.
- 🛡️ **Sicurezza Chiavi API**: Le chiavi segrete (`TWELVE_DATA_API_KEY`, `GEMINI_API_KEY`, `APP_PASSWORD`) rimangono protette lato server e non vengono mai esposte al client bundle.

---

## 📁 Struttura del Progetto

```text
MarketReader/
├── app/
│   ├── api/
│   │   ├── analyze/
│   │   │   └── route.ts          # Route POST per l'analisi tecnica assistita con Gemini AI
│   │   └── market-data/
│   │       └── route.ts          # Route GET per il fetch sicuro delle candele da Twelve Data
│   ├── login/
│   │   ├── actions.ts            # Server Action per autenticazione e cookie httpOnly
│   │   └── page.tsx              # Pagina di login con form protetto
│   ├── globals.css               # Direttive Tailwind CSS e configurazione tema Dark
│   ├── layout.tsx                # Root layout con Header e impostazioni globali
│   └── page.tsx                  # Layout principale a 2 colonne responsive (Grafico + Analisi)
├── components/
│   ├── AnalysisPanel.tsx         # Pannello laterale AI (trend badge, volatilità, livelli, banner chiuso)
│   ├── CandleChart.tsx           # Componente grafico TradingView lightweight-charts (polling 60s)
│   ├── ChartSection.tsx          # Wrapper per l'area grafico a sinistra
│   └── Header.tsx                # Barra superiore con brand, stato mercati e logout
├── lib/
│   ├── auth.ts                   # Hashing SHA-256 e verifica token cookie
│   ├── indicators.ts             # Calcolo EMA, RSI, ATR, Supporti & Resistenze
│   ├── marketData.ts             # Funzioni di recupero e normalizzazione dati da Twelve Data
│   ├── marketHours.ts            # Calcolo orari di apertura mercato (New York Time)
│   ├── types.ts                  # Definizioni e interfacce TypeScript dell'intero sistema
│   └── utils.ts                  # Utility per la combinazione di classi CSS (clsx + tailwind-merge)
├── middleware.ts                 # Intercettazione globale e reindirizzamento a /login
├── .env.example                  # Template documentato delle variabili d'ambiente
├── next.config.mjs               # Configurazione Next.js
├── package.json                  # Dipendenze e script del progetto
├── postcss.config.mjs            # Configurazione PostCSS
├── tailwind.config.ts            # Configurazione Tailwind CSS
└── tsconfig.json                 # Configurazione TypeScript con alias '@/*'
```

---

## 🚀 Setup e Avvio in Locale

### 1. Prerequisiti

- **Node.js**: Versione 18.18+ (consigliata v20+ o v24+)
- **npm** (o `pnpm` / `yarn`)

### 2. Installazione Dipendenze

```bash
git clone <url-repository>
cd MarketReader
npm install
```

### 3. Configurazione Variabili d'Ambiente

Crea un file `.env.local` nella root del progetto partendo dal file di esempio `.env.example`:

```bash
cp .env.example .env.local
```

Modifica `.env.local` inserendo le tue variabili:

```env
# Password per accedere alla pagina /login
APP_PASSWORD=la_tua_password_sicura

# Twelve Data API Key (https://twelvedata.com)
TWELVE_DATA_API_KEY=la_tua_chiave_twelve_data

# Google Gemini API Key (https://aistudio.google.com)
GEMINI_API_KEY=la_tua_chiave_gemini
```

### 4. Avvio in Modalità Sviluppo

```bash
npm run dev
```

Apri il browser all'indirizzo [http://localhost:3000](http://localhost:3000). Verrai automaticamente reindirizzato a `/login` per inserire la password.

### 5. Build di Produzione Locale

```bash
npm run build
npm run start
```

---

## ☁️ Guida al Deploy su Vercel

MarketReader è ottimizzato al 100% per il deploy su **Vercel** grazie all'architettura standard Next.js App Router e Route Handlers Serverless.

### Metodo 1: Tramite la Dashboard Web di Vercel (Consigliato)

1. Effettua il push del codice su una repository **GitHub**, **GitLab** o **Bitbucket**.
2. Accedi alla [Dashboard di Vercel](https://vercel.com/dashboard) e clicca su **"Add New..."** > **"Project"**.
3. Importa il repository del progetto `MarketReader`.
4. Nel pannello di configurazione del progetto:
   - **Framework Preset**: Seleziona `Next.js` (rilevato automaticamente).
   - **Root Directory**: Lascia `./` (se la repo contiene direttamente il progetto).
5. Espandi la sezione **"Environment Variables"** e aggiungi le tre variabili:
   - `APP_PASSWORD` = *La password di accesso che desideri impostare*
   - `TWELVE_DATA_API_KEY` = *Il valore della tua chiave Twelve Data*
   - `GEMINI_API_KEY` = *Il valore della tua chiave Google Gemini*
6. Clicca su **"Deploy"**.
7. In pochi secondi il progetto sarà compilato e accessibile all'URL pubblico fornito da Vercel (es. `https://market-reader.vercel.app`).

---

### Metodo 2: Tramite Vercel CLI

1. Installa globalmente la CLI di Vercel:
   ```bash
   npm i -g vercel
   ```
2. Effettua il login:
   ```bash
   vercel login
   ```
3. Avvia il deploy:
   ```bash
   vercel
   ```
4. Aggiungi le variabili d'ambiente per l'ambiente di produzione:
   ```bash
   vercel env add APP_PASSWORD production
   vercel env add TWELVE_DATA_API_KEY production
   vercel env add GEMINI_API_KEY production
   ```
5. Distribuisci in produzione:
   ```bash
   vercel --prod
   ```

---

## 🛠️ Tecnologie Utilizzate

- **Next.js 15** (App Router, Server Actions & Middleware)
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **TradingView Lightweight Charts** (v5)
- **TechnicalIndicators** (EMA, RSI, ATR)
- **@google/genai SDK** (Google Gemini AI)
- **Lucide React Icons**

---

## ⚠️ Disclaimer

> **Analisi educativa generata da IA, non è un consiglio di investimento.**
> Tutte le informazioni fornite dall'applicazione e dai modelli di intelligenza artificiale sono a scopo puramente didattico e informativo. Non costituiscono in alcun modo raccomandazioni o sollecitazioni all'investimento o al trading. Fai sempre le tue verifiche prima di operare, specialmente su conto reale.

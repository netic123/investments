PABRAI DASHBOARD
================

Starta:   dubbelklicka start.bat  -> webbläsaren öppnar http://127.0.0.1:8765
Stoppa:   stäng det svarta fönstret (eller Ctrl+C i det)

Kräver Node.js 18+ (finns redan på datorn). Inga andra beroenden, ingen installation.

VAD DEN VISAR
- Dina egna aktier (från din positionsfil): vad Pabrai gjort i dem sedan förra filen, kurs nu
  (Yahoo) mot ditt inköpspris, i SEK, nästa rapportdatum
- Alla köp/sälj i ETF:n mellan de två senaste sparade filerna, plus hela loggen
- Hela ETF-portföljen sorterad på vikt, med Avanza-status (online / via telefon / ej möjligt)
- Fondens avkastning mot S&P 500 och NAV-kurva
- Privatfonden (13F) — statisk, uppdateras för hand efter varje kvartal
- Kommande datum

HUR DEN FUNKAR
- Fondens egen dagliga innehavsfil hämtas var 5:e minut (sidan laddar om var 10:e).
- Varje ny fil-dag sparas som en ögonblicksbild i data/snapshots.json. Ändringar =
  skillnad i ANTAL AKTIER mellan två bilder. Vikt i procent rör sig på kurs och betyder inget.
- Körs dashboarden inte varje vardag slås flera dagars affärer ihop i "Ändringar".
  Det står i rubriken när så är fallet.
- Fondens fil är daterad en handelsdag EFTER kurserna i den (T+1).
- Helger/kvällar: kortet visar "Senaste stängning" med tidsstämpel, inte "Kurs nu".

UPPDATERA FÖR HAND (data/config.json)
- myPositions: dina inköpskurser, Yahoo-ticker, nästa rapportdatum
- dalalStreet: privatfondens 13F (nästa väntas 13-16 nov 2026)
- dates: kommande händelser (listan töms av sig själv när datum passerat)
- names: namn, flagga, Avanza-status per ticker

OM NÅGOT GÅR FEL
- "innehavsfilen kunde inte hämtas" = fondens server svarade inte; sidan visar senast sparade fil.
- "kurs saknas: ..." = Yahoo svarade inte för den tickern; resten fungerar.
- Går snapshots.json sönder sparas en kopia (snapshots.json.broken-<tid>) och historiken börjar om.

Inte investeringsrådgivning.

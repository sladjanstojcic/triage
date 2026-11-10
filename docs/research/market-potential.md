# Tržišni potencijal za Triage i najbrži put do prve prodaje

Istraživanje urađeno 10. novembra 2026. Sve cijene su pročitane tog dana sa stranica proizvođača.

## Sažetak u pet redova

1. Tržište postoji, ali je usko: procjena je oko 5 miliona Mac programera koji koriste Docker, a realno dostižnih kupaca u prvoj godini ima stotine, ne hiljade.
2. Najbliži konkurent, Bosun, prodaje sličan alat za 12,99 do 21,99 dolara jednokratno, a besplatni alati pokrivaju dijelove posla.
3. Preporuka: jednokratna licenca od 24 dolara, uz uvodnu cijenu od 19 dolara prve dvije sedmice.
4. Prvi korak: upis u Apple Developer Program (99 dolara godišnje), potpisivanje i notarizacija `.app` paketa.
5. Drugi i treći korak: naplata i licence preko Polar-a, pa objava na Show HN, r/macapps i Product Hunt uz besplatno MIT jezgro koje se može probati bez prijave.

## Kako čitati ovaj dokument

- **Činjenica** ima izvor odmah pored sebe.
- **Procjena** je označena riječju „procjena“ i pokazuje računicu.
- **Preporuka** je moje mišljenje i tako je označena.
- **Sekundarni izvor** je označen kada primarni nije bio dostupan.

## 1. Ko bi platio i koliko ih ima

### Primarni podaci

| Podatak | Vrijednost | Izvor |
|---|---|---|
| Profesionalni programeri u svijetu (2026) | oko 22 miliona | [JetBrains Data Playground](https://www.jetbrains.com/lp/devecosystem-data-playground/) |
| macOS kao glavni OS za posao, svi ispitanici (2025) | 32,85 % (n = 31.569) | [Stack Overflow Survey 2025, Technology](https://survey.stackoverflow.co/2025/technology) |
| Docker, profesionalni programeri (2025) | 73,8 % (n = 20.070) | [Stack Overflow Survey 2025, Technology](https://survey.stackoverflow.co/2025/technology) |
| Docker, svi ispitanici (2025) | 71,1 % (n = 24.473) | isto |
| Docker, broj programera | „više od 20 miliona“ | [docker.com/company](https://www.docker.com/company/) |

Anketa Stack Overflow za 2026. ne pita za operativni sistem ni za Docker. Zato koristim podatke iz 2025. ([2026 Technology](https://survey.stackoverflow.co/2026/technology.md)).

JetBrains izvještaj za 2025. ne objavljuje udio macOS-a na javnim stranicama ([devecosystem-2025](https://devecosystem-2025.jetbrains.com/tools-and-trends)). Iz njega koristim samo procjenu ukupnog broja programera.

JetBrains u „programere“ ubraja i QA inženjere i analitičare podataka. Broj je zato širi od ciljne grupe.

Anketa Stack Overflow nije slučajan uzorak. Ona precjenjuje aktivne korisnike tog sajta.

### Procjena dostižnih kupaca

Ovo je **procjena**, ne mjerenje.

```
22.000.000  profesionalnih programera
× 0,33      macOS kao glavni OS za posao
= 7.260.000 Mac programera
× 0,74      koristi Docker
= 5.370.000 Mac programera s Dockerom
× 0,10–0,20 vodi više projekata, agente ili VPS istovremeno (moja pretpostavka)
= 540.000–1.070.000 ciljna grupa
```

Prva godina zavisi od dosega, ne od veličine tržišta. Pretpostavke ispod su moje i treba ih provjeriti mjerenjem.

| Korak | Pretpostavka | Rezultat |
|---|---|---|
| Posjetioci sa HN, Reddit-a i Product Hunt-a | 10.000–30.000 | — |
| Preuzimanje probne verzije | 10 % | 1.000–3.000 |
| Kupovina poslije probe | 5–15 % | 50–450 kupaca |
| Prihod po 24 USD, prije naknada | — | 1.200–10.800 USD |

Zaključak: Triage može donijeti prve prodaje brzo. Da bi bio glavni prihod, treba mu dugoročan kanal, ne samo jedno lansiranje.

## 2. Konkurenti i cijene

Sve cijene pročitane 10. 11. 2026.

| Proizvod | Šta se preklapa s Triage-om | Cijena i model | Šta Triage ima, a on nema | Izvor |
|---|---|---|---|---|
| **Bosun** | Portovi, ngrok i Cloudflare tuneli, VPN, Docker, SSH `-L`, kill jednim klikom | 12,99 USD (1 Mac) ili 21,99 USD (3 Mac-a), jednokratno, proba 14 dana | Grupisanje po projektu, ko je pokrenuo server, udaljeni VPS, Tailscale, „Needs attention“ | [bosun.dev](https://bosun.dev) |
| **Seeports** | Svi TCP portovi, grupisani po servisu, kill | 4,99 USD, Mac App Store | Docker akcije, SSH, VPS, projekti | [gingerbeardman.com](https://www.gingerbeardman.com/apps/seeports/), [App Store](https://apps.apple.com/us/app/id6759843352) |
| **PortKiller** | Portovi, kill, Kubernetes port-forward, Cloudflare tuneli | Besplatno, MIT, 5,2 hilj. zvjezdica | Docker, VPS, projekti, porijeklo procesa | [GitHub](https://github.com/productdevbook/port-killer) |
| **OrbStack** | Kontejneri, domeni za kontejnere, meni traka | Free za ličnu upotrebu; Pro 8 USD/korisnik/mj. ili 96 USD/god. | Procesi van Docker-a, SSH tuneli, VPS, bilo koji runtime | [orbstack.dev/pricing](https://orbstack.dev/pricing) |
| **Docker Desktop** | Lista kontejnera, start/stop | Personal 0; Pro 9–11 USD/mj.; Team 15–16; Business 24 | Dev serveri, portovi, SSH, VPS | [docker.com/pricing](https://www.docker.com/pricing/) |
| **iStat Menus** | CPU, memorija, disk, mreža | 11,99 USD u US App Store-u; i u Setapp-u | Sve razvojno: portovi, kontejneri, projekti | [App Store](https://apps.apple.com/app/id6499559693), [bjango.com](https://bjango.com/mac/istatmenus/) |
| **Stats** | CPU, memorija, disk, mreža u meni traci | Besplatno, MIT, 43,3 hilj. zvjezdica | Sve razvojno | [GitHub](https://github.com/exelban/stats) |
| **lazydocker** | Kontejneri, logovi, čišćenje prostora | Besplatno, MIT, 53,3 hilj. zvjezdica | Grafički UI, portovi, procesi, VPS | [GitHub](https://github.com/jesseduffield/lazydocker) |
| **Portainer** | Upravljanje kontejnerima, i udaljenim | Starter 1.045 USD/god.; Scale 2.095 USD/god. | Lokalni procesi, nula podešavanja na serveru | [portainer.io/pricing](https://www.portainer.io/pricing) |
| **Lens** | Kubernetes klasteri | Personal 0; Plus i Pro 25–30 USD/mj. | Docker bez Kubernetes-a, portovi, procesi | [lenshq.io/pricing](https://lenshq.io/pricing) |
| **Laravel Herd** | Lokalno PHP okruženje i servisi | Free; Pro 99 USD/god.; Teams 299 USD/god. za 10 | Bilo koji stek, Docker, VPS | [herd.laravel.com](https://herd.laravel.com/) |
| **ServBay** | Lokalno razvojno okruženje | Free; Pro 59 USD/god. ili 9,9 USD/mj.; Team 399 USD/god. | Bilo koji stek, Docker, VPS | [servbay.com/pricing](https://www.servbay.com/pricing) |

Napomena za iStat Menus: Bjango-ova stranica nije prikazala iznos. Cijena je s App Store stranice.

Portainer stranica pominje i besplatan start sa 3 čvora. Uslove nisam mogao pročitati.

Docker Desktop je besplatan samo za firme ispod 250 zaposlenih i ispod 10 miliona USD prihoda ([Docker FAQ](https://www.docker.com/pricing/faq/)). Tu ljudi i odlaze na OrbStack i Colima, a Triage radi sa svima njima.

**Šta se vidi iz tabele.** Alati za razvojna okruženja (Herd, ServBay, OrbStack) naplaćuju 59–99 USD godišnje. Mali alati za portove naplaćuju 5–22 USD jednokratno ili su besplatni. Triage je bliži drugoj grupi po obliku, a širi po sadržaju.

## 3. Ograničenja distribucije

### Mac App Store

- Aplikacija u Mac App Store-u mora imati uključen App Sandbox ([Apple, App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)).
- Smjernica 2.4.5 traži sandbox i zabranjuje traženje root privilegija ([App Review Guidelines 2.4.5](https://developer.apple.com/app-store/review/guidelines/)).
- Ista smjernica zabranjuje licencne ključeve i sopstvenu zaštitu od kopiranja (2.4.5 vi).
- Ažuriranja smiju ići samo preko App Store-a (2.4.5 vii).

**Procjena.** Pokretanje `docker`, `ssh` i čitanje `~/.ssh` iz sandbox-a vrlo vjerovatno ne prolazi pregled. Proces-dijete nasljeđuje sandbox roditelja. Ovo nisam provjerio slanjem na pregled.

Seeports tvrdi da radi potpuno u sandbox-u i da gasi procese ([gingerbeardman.com](https://www.gingerbeardman.com/apps/seeports/)). Dakle, samo prikaz portova je moguć u Store-u. Cijeli Triage nije.

**Preporuka:** prodaja van Store-a.

### Prodaja van Store-a

| Stavka | Detalj | Izvor |
|---|---|---|
| Apple Developer Program | 99 USD godišnje | [developer.apple.com/programs](https://developer.apple.com/programs/) |
| Developer ID sertifikat | Pravi ga samo Account Holder u Programu | [developer.apple.com/developer-id](https://developer.apple.com/developer-id/) |
| Notarizacija | Obavezna za sav softver s Developer ID-jem od macOS 10.15 | [Apple, Notarizing](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) |
| Hardened Runtime i vremenski pečat | Uslov za notarizaciju | isto |

Bez notarizacije Gatekeeper blokira prvo pokretanje. Za alat koji gasi procese to je loš prvi utisak.

### Setapp

| Model | Udio za developera | Izvor |
|---|---|---|
| Membership | 70 % prihoda korisnika dijeli se po korišćenju aplikacija; +20 % za korisnike koje dovedete | [Setapp docs](https://docs.setapp.com/docs/setapp-membership-revenue) |
| Single app, pretplata | 85 % | [setapp.com/developers](https://setapp.com/developers) |
| Single app, jednokratna kupovina | 75 % | isto |
| Cijena za korisnika (Mac) | 14,99 USD mjesečno | [setapp.com/pricing](https://setapp.com/pricing) |

Setapp traži zrelu aplikaciju, tehnički pregled i Setapp SDK ([setapp.com/developers](https://setapp.com/developers)). Setapp uzima cijenu u obzir tek kad važi van Setapp-a bar 3 mjeseca ([Setapp docs](https://docs.setapp.com/docs/setapp-membership-revenue)).

**Preporuka:** Setapp poslije prvih prodaja, ne za prve četiri sedmice.

## 4. Naplata i licence

| Servis | Naknada | Merchant of record (sam plaća PDV) | Isplata u Srbiju / BiH | Izvor |
|---|---|---|---|---|
| **Polar** | 5 % + 0,50 USD; +1,5 % za kartice van SAD-a | Da | Da, oba (Stripe Connect Express) | [fees](https://polar.sh/docs/merchant-of-record/fees), [zemlje](https://polar.sh/docs/merchant-of-record/supported-countries) |
| **Paddle** | 5 % + 0,50 USD | Da | Srbija i BiH nisu na listi zabranjenih; isplata wire ili Payoneer, minimum 100 USD | [pricing](https://www.paddle.com/pricing), [zemlje](https://www.paddle.com/help/start/account-verification/which-countries-are-supported-by-paddle) |
| **Lemon Squeezy** | 5 % + 0,50 USD, plus neodređene naknade van SAD-a | Da | Da, oba (banka); PayPal u 200+ zemalja | [pricing](https://www.lemonsqueezy.com/pricing), [zemlje](https://docs.lemonsqueezy.com/help/getting-started/supported-countries) |
| **Gumroad** | 10 % + 0,50 USD; 30 % preko Discover-a | Da, od 1. 1. 2025. | Nisam našao zvaničnu listu; BiH samo u sekundarnom izvoru | [pricing](https://gumroad.com/pricing) |
| **Stripe direktno** | 2,9 % + 0,30 USD; +1,5 % strane kartice; Managed Payments +3,5 % | Samo uz Managed Payments | Ne, Srbija i BiH nisu podržane | [pricing](https://stripe.com/pricing), [global](https://stripe.com/global) |

Lemon Squeezy tim sada radi na Stripe Managed Payments i priznaje sporiju podršku ([blog, 28. 1. 2026](https://www.lemonsqueezy.com/blog/2026-update)). Budućnost servisa je nejasna.

Polar ima ugrađene licencne ključeve s aktivacijama i isticanjem ([Polar, License Keys](https://polar.sh/docs/features/benefits/license-keys)). To štedi pravljenje sopstvenog servera za licence.

Polar isplata ima dodatne Stripe troškove: 2 USD mjesečno, 0,25 % + 0,25 USD po isplati i 0,25–1 % prekogranično ([Polar fees](https://polar.sh/docs/merchant-of-record/fees)).

**Preporuka:** Polar kao prvi izbor, Paddle kao rezerva. Paddle provjerava nalog duže, a Polar je jednostavniji za jednu osobu.

## 5. Najbrži put do prve prodaje

### Cijena (preporuka)

| Opcija | Cijena | Zašto |
|---|---|---|
| Lična licenca, jednokratno | **24 USD** | Malo iznad Bosun Pro (21,99) jer Triage pokriva i VPS i projekte |
| Uvodna cijena, prve 2 sedmice | 19 USD | Daje razlog za kupovinu na dan lansiranja |
| Ažuriranja | 12 mjeseci uključeno | Kasnije plaćena nova glavna verzija, kao kod iStat Menus |

Pretplata je teška prodaja za uslužni alat kad besplatni alati pokrivaju dio posla. OrbStack i Herd naplaćuju godišnje, ali oni pokreću cijelo okruženje.

### Besplatno i plaćeno (preporuka)

Repozitorij je već javan pod MIT licencom ([GitHub](https://github.com/sladjanstojcic/triage)). To ne treba mijenjati.

- **Besplatno:** MIT jezgro, pokretanje preko `pnpm dev` ili `pnpm start` u pregledaču.
- **Plaćeno:** potpisan i notarizovan `.app`, automatsko ažuriranje, meni traka i podrška e-poštom.

Ljudi plaćaju udobnost i povjerenje. Ko želi da sam gradi, svejedno ne bi kupio. Besplatno jezgro ujedno ispunjava pravilo Show HN da se stvar može probati bez prijave.

### Plan za 4 sedmice (preporuka)

**Sedmica 1: spremno za prodaju**
1. Upis u Apple Developer Program, Developer ID, notarizacija i DMG.
2. Smanjiti `.app`. Trenutni `release/mac-arm64/Triage.app` ima 260 MB (izmjereno `du -sh`).
3. Prvo pokretanje na čistom Mac-u: bez Docker-a, bez Tailscale-a, bez VPS-a, bez greške.
4. Polar proizvod, licencni ključ i proba od 14 dana u aplikaciji.

**Sedmica 2: zatvorena proba**
1. 10–20 programera iz sopstvene mreže, uz kratku anketu.
2. Popraviti ono što blokira prvo pokretanje.
3. Stranica s videom od 60 sekundi i dugmetom za kupovinu.
4. Odložiti nove funkcije do poslije lansiranja.

**Sedmica 3: lansiranje**
1. Show HN, s naslovom koji počinje sa „Show HN“ ([showhn.html](https://news.ycombinator.com/showhn.html)). Pravila: stvar mora moći da se proba, bez landing stranica, bez traženja glasova od prijatelja.
2. r/macapps, uz jasnu izjavu da ste autor. Sekundarni izvor kaže: samopromocija najviše jednom u 30 dana, a autori bez App Store ili GitHub istorije idu u mjesečni „App Pile“ megathread ([sažetak pravila, sekundarno](https://redlib.groet-infra.nl/r/macapps)). Zvanična stranica pravila traži prijavu, pa je nisam pročitao.
3. r/selfhosted, ugao „vidim svoje VPS servere“. Novi projekti idu u sedmični „New Project“ megathread, uz red o upotrebi AI-ja ([sekundarno](https://redlib.groet-infra.nl/r/selfhosted/comments/1rmt39o/rules_update_new_project_friday_here_to_stay/)).

**Sedmica 4: drugi talas**
1. Product Hunt. Nikad ne tražiti glasove, nema nagrada za glas ([PH pravila](https://help.producthunt.com/en/articles/17734384-5-how-to-promote-your-launch-and-what-to-avoid)). Proizvod mora moći da se proba ([PH featuring](https://help.producthunt.com/en/articles/17734341-2-what-kind-of-products-get-featured)).
2. Console.dev newsletter prima samo beta verzije za developere ([selection criteria](https://console.dev/selection-criteria)). Verzija 0.1.0 se kvalifikuje, pa prijavu poslati dok je oznaka „beta“.
3. Setapp prijava tek kad postoje prve recenzije.

### Šta mjeriti

| Mjera | Cilj za 4 sedmice (procjena) |
|---|---|
| Posjete stranici po kanalu | znati koji kanal radi |
| Preuzimanja probne verzije | 500+ |
| Aktivacija: prvi pregled s bar jednim projektom | 60 % preuzimanja |
| Proba → kupovina | 5 %+ |
| Povraćaj novca | ispod 5 % |
| Najčešći razlog odustajanja | iz ankete pri deinstalaciji ili e-pošte |

## 6. Rizici

| Rizik | Zašto je stvaran | Ublažavanje (preporuka) |
|---|---|---|
| Besplatne alternative | PortKiller, Stats i lazydocker su besplatni i imaju hiljade zvjezdica | Prodavati cijelu sliku na jednom mjestu: projekat, agent, VPS |
| Bosun kao direktan konkurent | Nativni Swift, jeftiniji, već lansiran 2026. ([Product Hunt](https://www.producthunt.com/products/bosun-3)) | Isticati VPS, grupisanje po projektu i porijeklo procesa, što Bosun ne navodi |
| OrbStack dodaje slične funkcije | Već ima meni traku i domene za kontejnere ([docs](https://docs.orbstack.dev/)) | Triage radi sa svim runtime-ovima i van Docker-a |
| Veličina Electron-a | 260 MB naspram nativnih konkurenata | Smanjiti paket; dugoročno razmotriti Tauri ili Swift omotač |
| Povjerenje | Alat gasi procese i ulazi na servere preko SSH | Otvoren kod, notarizacija, potvrda prije svake akcije, sve lokalno, bez telemetrije bez pristanka |
| Prodavac iz Srbije ili BiH | Stripe tu ne radi direktno | Merchant of record (Polar ili Paddle) rješava naplatu i PDV |
| Uzak tržišni prozor | Procjena: stotine kupaca godišnje bez stalnog kanala | Mjeriti sedmicu 3 i 4 prije većeg ulaganja |

## Ograničenja ovog istraživanja

- Pravila r/macapps i r/selfhosted su iz sekundarnih izvora. Reddit traži prijavu za stranicu pravila.
- Gumroad isplate u Srbiju i BiH nisu potvrđene iz zvaničnog izvora.
- Udio macOS-a je iz 2025, jer anketa 2026 to ne pita.
- Pretpostavke o konverziji su moje i nisu izmjerene.

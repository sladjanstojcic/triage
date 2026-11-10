# Konkurenti funkciju po funkciju i šta Triage treba da doda

Istraživanje urađeno 10. novembra 2026. Sve stranice su pročitane tog dana.
Tržište, cijene, distribucija i naplata su u [market-potential.md](market-potential.md). Ovdje ih ne ponavljam.

## Sažetak u pet redova

1. Najveća rupa: Triage nema ikonu u meni traci, globalnu prečicu ni obavještenja, a imaju ih skoro svi konkurenti.
2. Druga rupa: aplikacija nije potpisana, nema DMG ni automatsko ažuriranje, a Bosun, Berth i PortPirate to imaju.
3. Treća rupa: nema logova kontejnera ni CLI-ja i MCP servera, a nova grupa alata za AI agente (PortPirate, Wharfy) ide baš tamo.
4. Najveća prednost: Triage jedini prikazuje udaljene VPS servere, s portovima, kontejnerima i dugmadima za gašenje.
5. Druga prednost: projekat, git grana, porijeklo procesa, Docker, SSH, Tailscale i „Needs attention“ su na jednom mjestu, a niko drugi ne spaja sve to.

## Kako čitati ovaj dokument

- Odjeljci 1 do 3 su činjenice. Uz svaku tvrdnju stoji izvor.
- Odjeljci 4 i 5 su **preporuke**. Tako su i označeni.
- „Sekundarno“ znači da izvor nije stranica samog proizvođača.
- Kolona „Triage“ je provjerena u kodu, ne samo u README-u. Fajlovi su navedeni u odjeljku 3.

## Izvori i oznake

Tabele koriste kratke oznake. Ovo je njihova lista.

| Oznaka | Izvor |
|---|---|
| B1 | [bosun.dev/en](https://bosun.dev/en/), početna strana, cijene i FAQ |
| B2 | [Bosun vs the free port apps](https://bosun.dev/en/blog/bosun-vs-free-port-apps/), blog proizvođača |
| B3 | [Product Hunt, Bosun](https://www.producthunt.com/p/bosun-3/bosun-3), komentari korisnika i autora |
| B4 | [PeerPush, Bosun](https://peerpush.com/p/bosun), sekundarno |
| PK | [PortKiller README](https://github.com/productdevbook/port-killer) i [issues](https://github.com/productdevbook/port-killer/issues) |
| KL | [Port Kill README](https://github.com/kagehq/port-kill) |
| LO | [LeftOpen wiki](https://github.com/SonghaiFan/leftopen/wiki) |
| PP | [PortPirate 0.4.0 Beta 1, release notes](https://github.com/jx-grxf/PortPirate-Updates) |
| WF | [Wharfy README](https://github.com/egebilge/wharfy) |
| SP | [Seeports](https://www.gingerbeardman.com/apps/seeports/) i [App Store](https://apps.apple.com/us/app/id6759843352) |
| PM | [Port Menu README](https://github.com/wieandteduard/port-menu) |
| OS | [OrbStack menu bar](https://docs.orbstack.dev/menu-bar) i [domains](https://docs.orbstack.dev/docker/domains) |
| DD | [Docker Desktop, Containers](https://docs.docker.com/desktop/use-desktop/container/) |
| LD | [lazydocker README](https://github.com/jesseduffield/lazydocker) |

## 1. Bosun detaljno

### Šta je

Bosun je nativna Swift aplikacija u meni traci. Traži macOS 14 ili noviji ([B1](https://bosun.dev/en/)).
Cijena je 12,99 USD za jedan Mac ili 21,99 USD za tri, jednokratno. Proba traje 14 dana bez kartice ([B1](https://bosun.dev/en/)).
Postoji i Enterprise licenca: 6,99 USD po mjestu, najmanje 30 mjesta ([B1](https://bosun.dev/en/)).

### Funkcije

| Funkcija | Kako radi | Izvor |
|---|---|---|
| Lista portova | Svaki TCP port koji sluša, s procesom i PID-om, uživo | [B1](https://bosun.dev/en/), [B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/) |
| Grupisanje radnika | Servis s više radnika (gunicorn, Odoo) je jedan red s brojem radnika | [B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/) |
| Kill jednim klikom | Prvo SIGTERM, pa SIGKILL ako proces ostane; grupa se gasi zajedno | [B1](https://bosun.dev/en/), [B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/) |
| Docker | Ime image-a i Compose projekta; kill radi `docker stop` | [B1](https://bosun.dev/en/) |
| Tuneli | ngrok i Cloudflare, i „quick“ tuneli; javni URL se kopira jednim klikom | [B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/) |
| SSH `-L` | Čita komandu i pokazuje udaljeni host i port | [B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/) |
| VPN | Aktivna macOS VPN veza u zaglavlju panela | [B1](https://bosun.dev/en/) |
| Resursi | Prošireni red pokazuje CPU, memoriju, vrijeme rada i komandu | [B1](https://bosun.dev/en/) |
| Istorija portova | Pamti svaki viđeni port, s podesivim čuvanjem | [B1](https://bosun.dev/en/) |
| Globalna prečica | Korisnik bira prečicu koja otvara panel iz bilo koje aplikacije | [B1](https://bosun.dev/en/) |
| Ažuriranje | „Bosun updates itself“ | [B1, FAQ](https://bosun.dev/en/#faq) |
| Homebrew | Instalacija preko taba `iwunkhaus/tap` | [B1, FAQ](https://bosun.dev/en/#faq) |
| Privatnost | Bez telemetrije o portovima i procesima | [B3](https://www.producthunt.com/p/bosun-3/bosun-3), [B4](https://peerpush.com/p/bosun) |

Bosun sam kaže šta nema: CLI, Kubernetes port-forward, udaljeni ili SSH režim, i druge platforme osim macOS-a ([B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/)).
Na stranicama nema grupisanja po projektu, git grane ni porijekla procesa.

### Kako je UI organizovan

Sve je jedan panel iz meni trake. Zaglavlje pokazuje VPN i broj portova koji slušaju ([B1](https://bosun.dev/en/)).
Redovi se proširuju za detalje. Na dnu panela je „Preferences…“ ([B1](https://bosun.dev/en/)).
Nema posebnog prozora, nema tabova.

### Šta korisnici hvale i traže

Javnih komentara ima malo. Na Product Hunt-u Bosun ima 6 glasova i 2 recenzije ([Product Hunt](https://www.producthunt.com/products/bosun-3)).

- **Pohvala:** „super useful to work with multiple agents“ ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)).
- **Pohvala:** „The process ownership view is exactly what I've wanted for ages“ ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)).
- **Pohvala:** živi u meni traci, a ne „browser tab pretending to be one“ ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)). Ovo direktno pogađa Triage, jer je Triage web stranica u Electron prozoru.
- **Zahtjev:** upozorenje da će kill ugasiti i zavisne procese ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)). Autor kaže da je to tek na listi za istraživanje.
- **Zahtjev:** snimak stanja portova i poređenje prije i poslije promjene ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)). Autor obećava „future software update“, bez datuma.

Žalbe nisam našao. Na Reddit-u i HN-u nisam našao nijednu temu o Bosun-u (odjeljak 6).

## 2. Ostali igrači

### Direktni konkurenti: alati za portove i dev servere

Ovo je grupa koja je u 2026. naglo narasla. Većina je besplatna i otvorenog koda.

| Alat | Šta pokriva u Triage-ovoj oblasti | Cijena, licenca | Izvor |
|---|---|---|---|
| **PortKiller** | Portovi, kill, pretraga, favoriti, praćeni portovi s obavještenjima, Kubernetes port-forward s automatskim ponovnim spajanjem, Cloudflare tuneli; macOS 15+ i Windows | Besplatno, MIT, 5.166 zvjezdica | [PK](https://github.com/productdevbook/port-killer) |
| **Port Kill** | CLI i status bar; restart procesa, otkrivanje i pokretanje npm/Compose servisa, „guard“ režim, orkestracija iz `.port-kill.yaml`, rad preko SSH-a, čišćenje keša; macOS, Linux, Windows | Besplatno, 2.040 zvjezdica | [KL](https://github.com/kagehq/port-kill) |
| **LeftOpen** | Meni traka i CLI; grupe po tome ko je pokrenuo (Dev Servers, Background Services, Apps, System); projekat po `.git`; gašenje `brew services` servisa; stalna adresa `https://myapp.localhost`; pokretanje sačuvanih projekata; LAN upozorenje | Besplatno, MIT, 145 zvjezdica | [LO](https://github.com/SonghaiFan/leftopen/wiki) |
| **PortPirate** | Koji agent (Claude Code, Codex) je pokrenuo koji server, po projektu i grani; status agenta preko hook-ova; MCP server s 11 alata; CLI `pp` s logovima; URL baza za kopiranje | Plaćeno (Pro funkcije), cijenu nisam našao | [PP](https://github.com/jx-grxf/PortPirate-Updates) |
| **Wharfy** | Lanac roditelja procesa (`node ← claude ← zsh`); CLI i MCP server; LAN izloženost; kill cijelog stabla; meni traka s CPU/RAM | Besplatno u beti | [WF](https://github.com/egebilge/wharfy) |
| **Seeports** | Svi TCP portovi grupisani po servisu (Docker, OrbStack, Kubernetes, Cloudflare); kill; kopiranje URL-a; skrivanje portova; pokretanje pri prijavi | 4,99 USD, Mac App Store | [SP](https://www.gingerbeardman.com/apps/seeports/) |
| **Port Menu** | Dev serveri s git repozitorijem, granom, portom i vremenom rada; kill i otvaranje | Besplatno, MIT, 385 zvjezdica | [PM](https://github.com/wieandteduard/port-menu) |
| **Berth** | Portovi po projektu, potvrda prije gašenja, prikačeni portovi, potpisano automatsko ažuriranje (Sparkle) | Besplatno, Apache-2.0 | [hunted.space, sekundarno](https://hunted.space/product/berth-3) |
| **PortPeek** | MCP server za agente: lista, rezervacija i oslobađanje porta | Još nije izašao | [PortPeek](https://adamorad.github.io/portpeek/) |
| **pscan** | Portovi po folderu projekta, otvaranje u terminalu ili Finder-u, CLI | Besplatno | [HN Showcase, sekundarno](https://hnshowcase.com/post/47639853/pscan-a-macos-menu-bar-app-to-monitor-your-localhost-ports) |
| **Room Service** | Dev serveri u meni traci i obavještenjima; CLI `roomservice ports --json` | Nepoznato | [Product Hunt](https://www.producthunt.com/p/room-service-2/dev-ports-seeing-and-managing-local-dev-servers-across-your-mac) |

Ključni nalaz: PortPirate i Wharfy već rade „koji agent je pokrenuo server“. To je bila Triage-ova jedinstvena tvrdnja u [market-potential.md](market-potential.md). Više nije jedinstvena.

### Docker alati

| Alat | Šta pokriva | Izvor |
|---|---|---|
| **OrbStack** | Meni traka: start, stop, restart, brisanje kontejnera i Compose projekata, logovi, terminal, otvaranje u pregledaču, kopiranje ID-a i domena | [OS](https://docs.orbstack.dev/menu-bar) |
| | Domen po kontejneru `ime.orb.local`, automatski HTTPS, stranica `orb.local` s listom | [OS domains](https://docs.orbstack.dev/docker/domains) |
| **Docker Desktop** | Pretraga, start/stop/pauza/restart, grupne akcije, logovi s filterom, Exec terminal, Stats, fajlovi u kontejneru, otvaranje porta | [DD](https://docs.docker.com/desktop/use-desktop/container/) |
| **lazydocker** | Terminalski UI: logovi, grafikoni metrika, attach, restart i rebuild, brisanje neiskorištenog prostora | [LD](https://github.com/jesseduffield/lazydocker) |
| **Portainer** | Više okruženja iz jednog UI-ja; logovi, statistika, konzola po kontejneru | [features](https://www.portainer.io/features), [docs](https://docs.portainer.io/user/docker/containers) |

### Ostali

| Alat | Preklapanje s Triage-om | Izvor |
|---|---|---|
| **Lens** | Samo Kubernetes: port-forward, logovi poda, terminal, metrike | [docs.lenshq.io](https://docs.lenshq.io/) |
| **Laravel Herd** | Prozor Services: status, port, Stop, logovi, upozorenje da je port zauzet, `.env` vrijednosti za kopiranje | [herd.laravel.com](https://herd.laravel.com/) |
| **ServBay** | Kontrolni panel servisa, meni traka, monitor resursa; ngrok, cloudflared i frp tuneli samo u Pro | [servbay.com/features](https://www.servbay.com/features) |
| **iStat Menus** | CPU, memorija, disk, mreža po aplikaciji; pravila za obavještenja (npr. CPU iznad praga); bez gašenja procesa | [bjango.com](https://bjango.com/mac/istatmenus/) |
| **Stats** | CPU, GPU, memorija, disk, mreža, baterija u meni traci | [GitHub](https://github.com/exelban/stats) |

## 3. Matrica funkcija

Ćelije: **da**, **ne**, **djel.** (djelimično), **?** (nisam provjerio). Svako „da“ za konkurenta ima oznaku izvora u ćeliji.
„ne“ znači da funkciju nisam našao u izvorima, ili da proizvođač kaže da je nema. „?“ znači da izvori ne pokrivaju tu temu (npr. podešavanja ili ažuriranje).

Triage kolona je provjerena u kodu: `src/lib/collect/*`, `src/lib/attention.ts`, `src/components/dashboard/*`, `src/desktop/main.ts`, `package.json`.

### Portovi i procesi

| Funkcija | Triage | Bosun | PortKiller | Port Kill | LeftOpen | PortPirate | Wharfy | Seeports |
|---|---|---|---|---|---|---|---|---|
| Lista portova koji slušaju | da | da B1 | da PK | da KL | da LO | da PP | da WF | da SP |
| Kill, SIGTERM i SIGKILL | da, uz potvrdu | da B1 | da PK | da KL | da LO | da PP | da WF | da SP |
| Grupisanje po projektu | da, s granom, worktree-jem i monorepo aplikacijom | ne | ne (kategorije) | ne | da LO | da PP | djel. WF | ne (po servisu) |
| Ko je pokrenuo (agent, app, terminal) | da | ne | ne | ne | djel. LO | da PP | da WF | ne |
| Oznaka da je pokretač ugašen | da | ne | ne | ne | ne | djel. PP | ne | ne |
| Gasi roditeljski CLI ili cijelo stablo | da | djel. B2 | ne | ne | ne | ? | da WF | ne |
| CPU i memorija po procesu | djel. (memorija u Projects) | da B1 | ne | ne | ne | ? | da WF | ne |
| Upozorenje: port zauzet dvaput | da | ne | ne | ne | ne | ne | ne | ne |
| Upozorenje: otvoreno ka LAN-u | da | ne | ne | djel. KL (`--audit`) | da LO | ne | da WF | ne |
| Istorija portova | ne | da B1 | ne | djel. KL | ne | ne | ne | ne |
| Pokretanje i restart dev servera | ne | ne | ne | da KL | da LO | da PP | ne | ne |
| Logovi dev servera | ne | ne | ne | ne | ne | da PP | ne | ne |
| Favoriti, skrivanje, prikačeni portovi | djel. („Show system“) | ne | da PK | ne | da LO | ne | ne | da SP |
| Pretraga | da | ? | da PK | ne | ? | ? | ne | ne |

### Docker

| Funkcija | Triage | Bosun | OrbStack | Docker Desktop | lazydocker | Seeports |
|---|---|---|---|---|---|---|
| Kontejneri s Compose projektom | da, bilo koji runtime, i Supabase CLI | da B1 | da OS | da DD | da LD | djel. SP |
| Start, stop, restart | da, i cijeli stack | djel. (samo stop) B1 | da OS | da DD | da LD | ne |
| Logovi kontejnera | ne | ne | da OS | da DD | da LD | ne |
| Terminal u kontejneru | ne | ne | da OS | da DD | da LD | ne |
| Metrike po kontejneru | ne | ne | ? | da DD | da LD | ne |
| Zauzeće diska i čišćenje | djel. (prikaz, bez dugmeta) | ne | ? | ? | da LD | ne |
| Domen po kontejneru | ne | ne | da OS | ne | ne | ne |

### Tuneli i mreža

| Funkcija | Triage | Bosun | PortKiller | LeftOpen | OrbStack |
|---|---|---|---|---|---|
| SSH `-L` s udaljenim ciljem | da, i iz `~/.ssh/config`, i gasi `autossh` | da B2 | ne | ne | ne |
| ngrok i Cloudflare s javnim URL-om | da, plus localtunnel, bore, zrok, frp | da B2 | djel. (Cloudflare) PK | ne | ne |
| Tailscale serve, funnel, peer-ovi | da | ne | ne | ne | ne |
| Status VPN-a | djel. (samo Tailscale) | da B1 | ne | ne | ne |
| Kubernetes port-forward | ne | ne | da PK | ne | ne |
| Stalna lokalna adresa za dev server | ne | ne | ne | da LO | da OS (kontejneri) |

### Udaljeni serveri

| Funkcija | Triage | Bosun | Port Kill | Portainer |
|---|---|---|---|---|
| Portovi i procesi na VPS-u | da | ne B2 | djel. KL (CLI `--remote`) | ne |
| Kontejneri na VPS-u s akcijama | da | ne | ne | da, uz agent na serveru ([features](https://www.portainer.io/features)) |
| CPU, memorija, disk VPS-a | da | ne | ne | ? |
| Lokalni tunel do udaljenog servisa | da | ne | ne | ne |

### UX i platforma

| Funkcija | Triage | Bosun | PortKiller | LeftOpen | PortPirate | Wharfy | Seeports |
|---|---|---|---|---|---|---|---|
| Meni traka | ne | da B3 | da PK | da LO | djel. PP (panel, opcija „Show in Dock“) | da WF | da SP |
| Globalna prečica | ne | da B1 | da ([#38](https://github.com/productdevbook/port-killer/issues/38)) | ne | ? | ? | ne |
| Obavještenja | ne | ? | da PK | djel. (zvuk) LO | ? | ? | ne |
| Automatsko ažuriranje | ne | da B1 | djel. (appcast u repou) | ? | da PP (Sparkle) | ? | da (App Store) |
| Potpisan i notarizovan | ne (`electron-builder --dir`) | ? | ? | ? | da PP (stabilne verzije) | ? | da (App Store) |
| CLI | ne | ne B2 | ne | da LO | da PP | da WF | ne |
| MCP server za agente | ne | ne | ne | ne | da PP | da WF | ne |
| Pokretanje pri prijavi | djel. (LaunchAgent za server) | ? | ? | ? | ? | ? | da SP |
| Intel Mac | ne (paket je `mac-arm64`) | ? | ne ([#34](https://github.com/productdevbook/port-killer/issues/34)) | da LO | ? | ? | ? |
| Nativna aplikacija | ne (Electron) | da B4 | da PK | da LO | da PP | da WF | da SP |
| Radi i u pregledaču | da | ne | ne | ne | ne | ne | ne |

## 4. Šta Triage treba da doda (preporuka)

Napor je procijenjen prema stvarnom kodu: **S** je dan ili dva, **M** sedmica, **L** više sedmica.
Podjela besplatno ili plaćeno prati model iz [market-potential.md](market-potential.md): MIT jezgro u pregledaču, plaćena `.app`.

### Obavezno prije prodaje

| # | Šta | Ko ima (dokaz) | Zašto kupcu važi (dokaz) | Napor | Gdje |
|---|---|---|---|---|---|
| 1 | Potpisan, notarizovan DMG s automatskim ažuriranjem | Bosun B1, PortPirate PP, Berth | PortKiller korisnici prijavljuju upozorenje „Apple could not verify“ ([#3](https://github.com/productdevbook/port-killer/issues/3)); obećana „lifetime updates“ kod Bosun-a B1 | M: `electron-builder` sad pravi samo folder, treba DMG, notarizacija i `electron-updater` | plaćeno |
| 2 | Ikona u meni traci s kratkom listom: portovi po projektu, broj stavki iz „Needs attention“, kill | svi direktni konkurenti (tabela UX) | Pohvala Bosun-u baš za meni traku nasuprot „browser tab“ ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)) | M: Electron `Tray` postoji, a podaci već stoje u `/api/snapshot` | plaćeno |
| 3 | Globalna prečica koja otvara prozor ili panel, s izborom tastera | Bosun B1, PortKiller | Fiksna prečica smeta editorima ([#38](https://github.com/productdevbook/port-killer/issues/38)), pa mora biti podesiva | S: Electron `globalShortcut` | plaćeno |
| 4 | Obavještenja za nove stavke iz „Needs attention“: dvostruki port, ugašen pokretač, pun disk, nedostupan host | PortKiller PK, iStat Menus | Zahtjevi za obavještenja po tipu procesa i webhook-ove ([#83](https://github.com/productdevbook/port-killer/issues/83), [#29](https://github.com/productdevbook/port-killer/issues/29)) | S–M: `attention.ts` već računa listu; treba poređenje s prethodnim stanjem i podešavanje | plaćeno |
| 5 | Pokretanje pri prijavi iz same aplikacije | Seeports SP, Herd | Alat koji gleda stanje mora uvijek raditi | S: `app.setLoginItemSettings` | plaćeno |
| 6 | Logovi kontejnera u Docker i Remote tabu | OrbStack OS, Docker Desktop DD, lazydocker LD | Logovi su prvi sljedeći korak kad je kontejner „unhealthy“, a Triage ga već prikazuje | M: `docker logs --tail` lokalno i preko SSH-a, nova ruta ispod provjere `Origin` | besplatno |
| 7 | Univerzalni build, i za Intel Mac | LeftOpen LO | Zahtjev za Intel kod PortKiller-a ima 29 komentara ([#34](https://github.com/productdevbook/port-killer/issues/34)) | S: `--universal` u `electron-builder` | plaćeno |

Rizik bez rješenja: Electron je velik. Mjereni paket ima 260 MB ([market-potential.md](market-potential.md)). Konkurenti ističu da su nativni ([B4](https://peerpush.com/p/bosun)). Ovo se ne rješava funkcijom, nego porukom: Triage radi i u pregledaču, i vidi VPS.

### Jaki diferencijatori

| # | Šta | Ko ima (dokaz) | Zašto kupcu važi (dokaz) | Napor | Gdje |
|---|---|---|---|---|---|
| 8 | CLI i MCP server nad postojećim API-jem: lista, „ko je na portu“, siguran stop | PortPirate PP, Wharfy WF, LeftOpen LO | Korisnik zove JSON CLI „the sleeper feature“ ([Room Service PH](https://www.producthunt.com/p/room-service-2/dev-ports-seeing-and-managing-local-dev-servers-across-your-mac)); agenti mogu sami da počiste | M: pravila stopa i provjera svježeg skeniranja već postoje u `actions.ts` | besplatno |
| 9 | Prije gašenja prikazati šta će još pasti: djeca i radnici | Wharfy `--tree` WF | Tačan zahtjev Bosun korisnika, a Bosun ga još nema ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)) | S: `processChain` i `stopPidFor` već prave stablo | besplatno |
| 10 | Istorija i poređenje snimaka: šta je radilo jutros, šta se promijenilo | Bosun B1 (istorija) | Zahtjev za poređenje ([B3](https://www.producthunt.com/p/bosun-3/bosun-3)) | M: Triage nema bazu; treba mali fajl ili SQLite | plaćeno |
| 11 | Dugme za čišćenje Docker prostora, uz potvrdu | lazydocker LD | Triage već kaže koliko se može osloboditi (`attention.ts`) | S | besplatno |
| 12 | Kopiranje URL-a za bazu (Postgres, Redis, MySQL) iz reda | PortPirate PP, Herd | Najčešći razlog da se traži port baze | S | besplatno |
| 13 | Napomene, favoriti i skrivanje portova | PortKiller PK, Seeports SP | Zahtjev za napomene uz port ([#107](https://github.com/productdevbook/port-killer/issues/107)) | S–M: treba čuvanje podešavanja | plaćeno |

### Kasnije

| # | Šta | Ko ima | Napor | Zašto kasnije |
|---|---|---|---|---|
| 14 | Pokretanje dev servera iz Triage-a, s logovima | PortPirate PP, Port Kill KL, LeftOpen LO | L | Triage danas samo posmatra; da bi čitao logove, mora sam da pokrene proces. To mijenja prirodu alata. |
| 15 | Status agenta (radi, čeka, traži odobrenje) preko hook-ova | PortPirate PP | L | Veže Triage za formate Claude Code-a i Codex-a koji se mijenjaju. |
| 16 | Terminal i metrike po kontejneru | OrbStack OS, Docker Desktop DD | M–L | Korisnici ih već imaju u runtime-u koji koriste. |
| 17 | Stalne lokalne adrese (`app.localhost`) | LeftOpen LO, OrbStack OS | M | Treba proxy i certifikate; to je drugi proizvod. |
| 18 | Kubernetes port-forward | PortKiller PK, Lens | M | Uska publika među korisnicima Triage-a. |
| 19 | Status ostalih VPN-ova | Bosun B1 | S | Malo vrijedno uz Tailscale koji već postoji. |

### Šta Triage već radi bolje od svih (zadržati i reklamirati)

1. **Udaljeni VPS serveri.** Portovi, procesi, folderi, kontejneri, CPU, memorija i disk preko SSH-a, bez agenta na serveru. Bosun to izričito nema ([B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/)). Portainer traži agent. Port Kill radi samo port operacije iz CLI-ja ([KL](https://github.com/kagehq/port-kill)).
2. **Lokalni tunel do udaljenog servisa.** Kolona u Remote tabu pokazuje koji lokalni port vodi do kojeg servisa na VPS-u. Ovo nisam našao nigdje drugdje.
3. **Sve na jednom mjestu.** Projekat, git grana, worktree, porijeklo procesa, Docker, SSH, Tailscale i VPS su u istom pogledu. Konkurenti pokrivaju po dva ili tri od ovih dijelova.
4. **„Needs attention“.** Jedna lista za dvostruki port, ugašen pokretač, obrisan folder, „unhealthy“ kontejner, pun disk, nedostupan host i LAN izloženost. Nijedan konkurent nema zbirnu listu problema.
5. **Najšire otkrivanje tunela.** cloudflared, ngrok, localtunnel, bore, zrok, frp, Tailscale serve i funnel. Bosun pokriva ngrok i Cloudflare ([B2](https://bosun.dev/en/blog/bosun-vs-free-port-apps/)).
6. **Akcije nad cijelim stackom.** Compose i Supabase CLI stack se gasi ili pali odjednom, lokalno i na VPS-u.
7. **Sigurnost akcija.** Svaka akcija prvo ponovo skenira i gasi samo ono što skeniranje nudi. PortPirate je jedini koji piše nešto slično ([PP](https://github.com/jx-grxf/PortPirate-Updates)).
8. **Radi u pregledaču i otvoren je kod.** MIT jezgro se može probati bez instalacije `.app` paketa.

Porijeklo procesa („koji agent je pokrenuo“) više nije jedinstveno. Wharfy i PortPirate ga imaju ([WF](https://github.com/egebilge/wharfy), [PP](https://github.com/jx-grxf/PortPirate-Updates)). Triage ga i dalje radi šire: agent, aplikacija i terminal zajedno, plus oznaka da je pokretač ugašen.

## 5. Redoslijed rada (preporuka)

1. Stavke 1, 5 i 7: potpisan univerzalni DMG koji se sam ažurira i pali pri prijavi. Bez toga nema prodaje.
2. Stavke 2, 3 i 4: meni traka, prečica i obavještenja. To je ono što kupac očekuje od Mac alata ove vrste.
3. Stavka 6: logovi kontejnera. Zatvara najočitiju rupu u Docker tabu.
4. Stavke 8 i 9: CLI, MCP i prikaz stabla prije gašenja. Vraća Triage-u prednost u priči o agentima.

## 6. Šta nisam mogao provjeriti

- **Reddit.** Pretraga preko Reddit API-ja je odbijena bez prijave. Nisam našao nijednu Reddit ni HN temu o Bosun-u. Žalbe korisnika zato dolaze samo sa Product Hunt-a i GitHub issues.
- **Bosun obavještenja i opseg portova.** Sažetak pretrage spominje odgovor autora o „monitored range“ i upozorenjima. Na samoj Product Hunt stranici to nisam našao. U matrici stoji „?“.
- **Bosun dokumentacija i changelog.** Sajt ih nema; postoje samo početna strana, FAQ i blog ([B1](https://bosun.dev/en/), [blog](https://bosun.dev/en/blog/)). Javni repo ne postoji.
- **PortPirate cijena i sajt.** Našao sam samo repo s javnim izdanjima i release notes. Licenca i „Pro feature gates“ se spominju, cijena ne.
- **Berth repo.** Opis je sa sekundarnog sajta. Izvorni repo nisam našao.
- **Wharfy meni traka.** README je opisuje, ali nisam vidio izdanje aplikacije.
- **OrbStack i Docker Desktop:** metrike, čišćenje diska i ažuriranje nisam provjeravao, jer nisu u fokusu. U matrici stoji „?“.
- **Ćelije „?“** znače da izvor ne kaže ni da ni ne. Nisu provjerene instalacijom aplikacije.
- **Nijednu aplikaciju nisam instalirao.** Sve o konkurentima je iz njihovih stranica, README-a i release notes-a.

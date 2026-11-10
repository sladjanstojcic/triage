# Šta ostaje za kasnije

Spisak funkcija i popravki koje smo odložili. Brojevi u zagradi vode na stavke iz [research/competitor-features.md](research/competitor-features.md), gdje su dokazi i ko ih već ima.

Napor: **S** je dan ili dva, **M** sedmica, **L** više sedmica.

## Urađeno 10. 11. 2026.

- **Šta još pada pri gašenju** (#9): dijalog za potvrdu navodi ostale portove i procese servera, tunele i `ssh -R` forwarde koji vode do njega, i lokalne SSH tunele do udaljenog servisa.
- **Potrošnja po projektu**: memorija i CPU servera sa svim njegovim procesima, plus kontejneri iz `docker stats`.
- **Zaboravljeni serveri**: dev server koji radi duže od dana i ne troši CPU dolazi u „Needs attention“, s dugmetom za gašenje.

## Obavezno prije prodaje

| Šta | Napor | Napomena |
|---|---|---|
| Potpisan i notarizovan DMG s automatskim ažuriranjem (#1) | M | Traži Apple Developer nalog (99 USD godišnje). |
| Ikona u meni traci s kratkom listom i brojem stavki iz „Needs attention“ (#2) | M | Podaci već postoje u `/api/snapshot`. |
| Globalna prečica, s izborom tastera (#3) | S | Electron `globalShortcut`. |
| Obavještenja za nove stavke iz „Needs attention“ (#4) | S–M | Treba poređenje s prethodnim stanjem. |
| Pokretanje pri prijavi iz same aplikacije (#5) | S | `app.setLoginItemSettings`; zamjenjuje LaunchAgent. |
| Logovi kontejnera, lokalno i na VPS-u (#6) | M | Nova ruta ispod provjere `Origin`. |
| Build i za Intel Mac (#7) | S | `--universal` u `electron-builder`. |

## Prednosti koje nas izdvajaju

| Šta | Napor | Napomena |
|---|---|---|
| CLI i MCP server nad postojećim API-jem (#8) | M | Agenti bi sami pitali „ko je na portu“ i gasili sigurno. |
| Istorija stanja i poređenje: šta je radilo jutros (#10) | M | Triage danas ništa ne pamti; treba mali fajl ili SQLite. |
| Dugme za čišćenje Docker prostora, uz potvrdu (#11) | S | Triage već računa koliko se može osloboditi. |
| Kopiranje adrese baze iz reda (#12) | S | Postgres, Redis, MySQL. |
| Napomene, favoriti i skrivanje portova (#13) | S–M | Treba čuvanje podešavanja. |

## Kasnije

| Šta | Napor | Zašto čeka |
|---|---|---|
| Pokretanje dev servera iz Triage-a, s logovima (#14) | L | Triage bi od posmatrača postao pokretač. |
| Status agenta: radi, čeka, traži odobrenje (#15) | L | Veže se za formate agenata koji se mijenjaju. |
| Terminal i metrike po kontejneru (#16) | M–L | Korisnici ih imaju u svom Docker runtime-u. |
| Stalne lokalne adrese, npr. `app.localhost` (#17) | M | Treba proxy i certifikate. |
| Kubernetes port-forward (#18) | M | Uska publika. |
| Status ostalih VPN-ova (#19) | S | Malo vrijedi uz Tailscale. |
| Upravljanje Colima VM-om iz Triage-a | M | Ideja iz razgovora: „svoj OrbStack“ preko gotovog alata. |

## Dorade onoga što smo upravo napravili

- **Zaboravljeni serveri na VPS-u**: udaljena proba ne vraća trajanje ni CPU po procesu. Treba dodati `etime` i `pcpu` u `remote.ts`.
- **Potrošnja po projektu na VPS-u**: isti razlog, plus `docker stats` preko SSH-a.
- **Zavisnosti između kontejnera**: gašenje baze ruši servise koji je trebaju. Compose oznaka `com.docker.compose.depends_on` bi to pokazala u dijalogu.
- **Herdr**: server pokrenut iz Herdr terminala mogao bi pokazati space i tab, uz skok na njega preko `hc`.

## Tehnički dug

- **npm paketi u desktop paketu**: `.app` ne nosi `node_modules`. Ako server jednom uveze npm paket, aplikacija neće krenuti, pa ga tada treba ugraditi u bundle.
- **Isti folder s podacima**: dev verzija i zapakovana aplikacija dijele `~/Library/Application Support/triage-app`, pa ne mogu raditi istovremeno ni s različitim portom.
- **Veličina Electron paketa**: oko 260 MB naspram nativnih konkurenata.

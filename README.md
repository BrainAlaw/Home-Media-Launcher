# Home Media Launcher

Pełnoekranowy launcher dla Linux, sterowany klawiaturą lub kontrolerem. Projekt używa Electron tylko jako powłoki systemowej. Interfejs nie używa frameworka ani zewnętrznych usług.

## Funkcje

- pełny ekran bez ramki na Wayland i X11;
- D-Pad, lewa gałka, A/B oraz strzałki, Enter/Escape;
- ukrywanie kursora po bezczynności;
- statyczne i zapętlone tła wideo globalnie lub per kafel;
- skanowanie `/usr/share/applications` i `~/.local/share/applications`;
- własne kafelki, w tym Moonlight i skrypty VibePollo;
- panel systemowy z autostartem, zamknięciem launchera i potwierdzanym wyłączeniem komputera;
- edytor aplikacji, komend, tapety i elementów nagłówka;
- opcjonalna data, godzina, własny tekst oraz pogoda z Open-Meteo;
- automatyczne wykrywanie skrótów menu Start na Windows;
- dynamiczne kafelki VibePollo pobierane przez sparowanego klienta Moonlight;
- ukrycie launchera podczas działania procesu i automatyczny powrót po jego zakończeniu;
- izolowany renderer: `contextIsolation`, sandbox i ścisły CSP.

Repozytorium bazowe wskazane w założeniach było puste w dniu rozpoczęcia implementacji. Struktura została utworzona od podstaw zgodnie z wymaganym podziałem backend/renderer.

## Instalacja na CachyOS

Wymagane: Node.js 22+ i npm.

```bash
npm ci
npm start
```

Wayland:

```bash
npm run start:wayland
```

Jeśli natywna sesja Wayland sprawia problemy ze sterownikiem GPU, uruchom przez XWayland:

```bash
ELECTRON_OZONE_PLATFORM_HINT=x11 npm start
```

Nie używaj `--no-sandbox`. Obniża izolację procesu renderera.

## Konfiguracja

Przy pierwszym uruchomieniu `config.example.json` jest kopiowany do katalogu danych Electron jako `config.json`. W Linux domyślna lokalizacja to `~/.config/home-media-launcher/config.json`. Można ją nadpisać:

```bash
HOME_MEDIA_LAUNCHER_CONFIG=/etc/home-media-launcher/config.json npm start
```

Kafel używa bezpiecznego modelu `command` + `args` bez powłoki:

```json
{
  "id": "moonlight-game",
  "name": "Moonlight — Desktop",
  "icon": "/home/user/Pictures/moonlight.png",
  "command": "moonlight-qt",
  "args": ["stream", "gaming-pc", "Desktop"],
  "background": "/home/user/Videos/moonlight.webm"
}
```

Dla skryptu VibePollo ustaw jego plik wykonywalny w `command`. Pole `shell: true` włącza interpretację przez powłokę, ale należy go używać tylko dla zaufanej, kontrolowanej konfiguracji. Nie umieszczaj sekretów w JSON. Przekazuj je przez środowisko lub systemowy magazyn sekretów.

Obsługiwane tło globalne:

```json
"background": { "type": "video", "source": "/home/user/Videos/home.webm" }
```

## Sterowanie

- kierunki: D-Pad, lewa gałka lub strzałki (nawigacja przestrzenna po sekcji głównej i karuzelach, z auto-powtarzaniem);
- uruchomienie: A lub Enter;
- panel systemowy: B, Start lub Escape; w ustawieniach B zamyka okno;
- aplikacja webowa: ikona w prawym górnym rogu (pojawia się po najechaniu w róg lub dotknięciu), przytrzymanie B przez 0,7 s, Select + Start lub Escape zamyka ją i wraca do launchera.

Ekran główny składa się z kafla „Continue/Featured”, ostatnio uruchomionych pozycji oraz karuzel: Moonlight Games, Apps i Web Apps. Własne ikony (dowolny kafel) ustawia się w Ustawienia → Icons; kolor akcentu w Ustawienia → Appearance. Gdy host Moonlight jest niedostępny, u góry pojawia się dyskretny pasek „HOST offline”.

Launcher monitoruje bezpośredni proces potomny. Skrypt lub aplikacja nie może odłączać procesu w tło, jeśli launcher ma czekać na jej zamknięcie. Dla skryptów użyj końcowego `exec program ...`, aby PID pozostał śledzony.

Ustawienia są dostępne pod ikoną koła zębatego. Przycisk B lub Escape otwiera panel systemowy. Skróty Moonlight uruchamiają się bez terminala: `stdout` i `stderr` są odłączone, a launcher znika do zakończenia procesu.

Widget pogody wysyła wyłącznie wpisaną nazwę miejscowości do publicznych usług geokodowania i prognozy Open-Meteo. Pozostaw opcję wyłączoną w środowiskach bez dostępu do Internetu lub wymagających zatwierdzonego źródła danych pogodowych.

### VibePollo / Moonlight

W `Ustawienia → Aplikacje` włącz pobieranie aplikacji z serwera, wpisz adres hosta oraz wskaż program Moonlight. Na Linux launcher wykonuje w tle `moonlight list <host> --csv`. Na Windows lista jest pobierana z `https://<host>:47990/api/apps`, ponieważ stabilne wydanie Moonlight 6.1.0 nie obsługuje prawidłowo przekierowania wyniku CLI. Utwórz w panelu VibePollo token ograniczony do `GET /api/apps`. Token jest szyfrowany przez Electron `safeStorage` (DPAPI na Windows) i nie trafia do `config.json`. Dla domyślnego certyfikatu VibePollo może być konieczne jawne włączenie opcji self-signed. Nie używaj adresu HTTP, ponieważ ujawniłby token w sieci.

Oba systemy zapisują ostatnią poprawną listę w cache. Wybrany kafel uruchamia `moonlight stream <host> <app>` bez okna terminala. Aplikacja z serwera pojawia się na ekranie głównym dopiero po zaznaczeniu jej na liście w ustawieniach.

Windows skanuje skróty `.lnk` z menu Start użytkownika i całego komputera. Linux skanuje pliki `.desktop`. Aplikacje Microsoft Store bez klasycznego skrótu nie są obecnie automatycznie dodawane, ponieważ ich proces uruchamiający nie zapewnia wiarygodnego monitorowania cyklu życia.

## Test

```bash
npm test
npm run check
```

Test na docelowym hoście: uruchom kafel wskazujący `sh -c 'sleep 5'` przez zaufany skrypt, sprawdź ukrycie launchera, a potem automatyczny powrót do pełnego ekranu.

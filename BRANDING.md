# Universal Branding & UI Guidelines

Ten dokument definiuje nadrzędne zasady estetyczne i projektowe oparte na filozofii Apple Human Interface Guidelines (HIG). Celem jest zapewnienie absolutnej spójności wizualnej, przewidywalności i wysokiej czytelności we wszystkich projektach.

## 1. Core Design Principles

Każdy element interfejsu musi realizować trzy główne filary Apple HIG:
* **Clarity (Klarowność):** Tekst musi być czytelny na każdym ekranie, ikony muszą być precyzyjne, a negatywna przestrzeń (white space) powinna sterować uwagą użytkownika. Funkcjonalność zawsze ma priorytet nad ozdobnikami.
* **Deference (Szacunek dla treści):** Interfejs UI jest tylko ramą. Cienie, gradienty i ramki powinny być zredukowane do minimum, aby to główna treść (dane, tekst, obrazy) odgrywała pierwszoplanową rolę.
* **Depth (Głębia i warstwy):** Zastosowanie materiałów (translucency, blur) oraz subtelnych animacji buduje hierarchię i wskazuje kontekst. Elementy znajdujące się wyżej w hierarchii (np. modale, nawigacja) powinny wizualnie "unosić się" nad resztą za pomocą odpowiedniego cieniowania i rozmycia tła.

## 2. Typography

Typografia jest głównym narzędziem nawigacji i budowania struktury. Zawsze używamy systemowych krojów pisma, co gwarantuje optymalizację pod kątem czytelności i natywne wsparcie dla Accessibility.

* **Primary Font:** San Francisco (SF Pro) dla interfejsów i standardowego tekstu.
* **Serif Font (opcjonalnie):** New York (NY) wyłącznie dla długich bloków tekstu redakcyjnego lub nagłówków wymagających klasycznego charakteru.
* **Monospaced:** SF Mono dla fragmentów kodu, logów i danych numerycznych wymagających wyrównania tabelarycznego.
* **Dynamic Type:** Interfejs musi skalować się w oparciu o ustawienia systemowe. Unikamy hardkodowania rozmiarów czcionek w pikselach. Używamy ról semantycznych (np. `Title 1`, `Headline`, `Body`, `Footnote`).
* **Weights:** Stosujemy wyraźny kontrast grubości (np. Semibold dla nagłówków, Regular dla Body), unikając używania zbyt wielu różnych wag w jednym widoku.

## 3. Color Strategy

Kolor nie służy wyłącznie do ozdoby — przekazuje stan i hierarchię. Projektujemy z natywnym wsparciem dla systemów Light i Dark Mode od pierwszego dnia.

* **Semantic Colors:** Zamiast definiować kolory na sztywno (np. `#FF0000`), przypisujemy im role semantyczne (np. `SystemRed` dla destruktywnych akcji/błędów, `SystemBlue` dla głównych Call to Action).
* **Tint Color (Accent Color):** Każdy projekt posiada jeden, dominujący Tint Color, który wskazuje elementy interaktywne. Reszta interfejsu powinna pozostać neutralna (odcienie szarości, bieli i czerni).
* **Dark Mode:** Kolory w trybie ciemnym nie są prostą inwersją. Należy stosować systemowe zmienne tła (Background, Secondary Background, Tertiary Background), aby odpowiednio zarządzać kontrastem i głębią bez oślepiania użytkownika.
* **Contrast Requirements:** Tekst i kluczowe ikony muszą spełniać minimalny współczynnik kontrastu WCAG (minimum 4.5:1 dla tekstu standardowego).

## 4. Layout & Spacing

Przestrzeń definiuje relacje między elementami. Zbyt gęsty interfejs niszczy doświadczenie użytkownika (UX).

* **Safe Areas:** Zawartość nigdy nie może kolidować z systemowym UI (notches, paski nawigacyjne, wskaźniki Home). Zawsze respektujemy Safe Area Insets.
* **Margins & Padding:** Stosujemy spójny system wielokrotności (np. baza 8pt: 8, 16, 24, 32, 48), aby zachować rytm pionowy i poziomy. Standardowy margines boczny (Layout Margin) na urządzeniach mobilnych to zazwyczaj 16pt lub 20pt.
* **Alignment:** Tekst w większości przypadków powinien być wyrównany do lewej. Elementy logicznie powiązane muszą być grupowane blisko siebie, z wyraźnym buforem pustej przestrzeni oddzielającym je od innych sekcji.

## 5. Components & Feedback

Komponenty muszą być przewidywalne i odpowiadać na akcje użytkownika w sposób natychmiastowy.

* **Standard Controls:** Gdzie to możliwe, używamy natywnych komponentów (Pickers, Switches, Tab Bars, Navigation Bars). Unikamy wymyślania koła na nowo dla standardowych interakcji.
* **Hit Targets:** Każdy element interaktywny musi mieć minimalny obszar kliknięcia wynoszący 44x44 punkty.
* **Haptics & Animation:** Zmiany stanu (sukces, błąd, ostrzeżenie, przełączenie switcha) powinny być wzmocnione subtelnym sprzężeniem zwrotnym (haptic feedback) oraz płynną mikro-animacją (np. podświetlenie przycisku przy wciśnięciu). 
* **State Indication:** Każdy przycisk lub pole wejściowe musi wyraźnie komunikować swój stan: Default, Hover (desktop), Active/Pressed, Disabled, Error.
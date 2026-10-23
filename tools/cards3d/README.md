# 3D-иллюстрации карт настолок

Исходники рендеров карт «Котобомбы» и «Подземелья» (three.js). Каждая карта — своя сцена в `cards-bomb.js` / `cards-dungeon.js`, общий набор (коты, персонажи, предметы, постамент, свет) — в `kit3d.js`.

Перерисовать карты:
1. В этой папке: `npm i three@0.169 @fontsource-variable/manrope @fontsource/playfair-display` и положить рядом `lib.js` (загрузка шрифтов) — или заменить `loadFonts` в `cards.js` на свою.
2. `python3 -m http.server 8765`
3. `python3 shoot_cards.py bomb` и `python3 shoot_cards.py dungeon` (нужен Playwright). Можно перерисовать отдельные карты: `python3 shoot_cards.py dungeon m7,g-pan`.

Готовые картинки (480×400, webp) лежат в `public/art/cards/` с префиксами `b-` и `d-`.

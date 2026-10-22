'use strict';
/**
 * "Капитал": the board of an invented river city. 40 cells.
 * kinds: start, street, pier, util, tax, luck, fund, jail, rest, arrest
 */

const GROUPS = {
  brown: { name: 'Слобода', color: '#8B5A3C', house: 50 },
  sky: { name: 'Сады', color: '#7EC8E3', house: 50 },
  pink: { name: 'Театральный квартал', color: '#D46A9F', house: 100 },
  orange: { name: 'Ремесленный квартал', color: '#E8913A', house: 100 },
  red: { name: 'Центр', color: '#C8323C', house: 150 },
  yellow: { name: 'Купеческий квартал', color: '#E6C34A', house: 150 },
  green: { name: 'Деловой квартал', color: '#2E9E6A', house: 200 },
  navy: { name: 'Набережная', color: '#2F4FA8', house: 200 },
};

const S = (name, group, price) => ({ kind: 'street', name, group, price });
const CELLS = [
  { kind: 'start', name: 'Старт' },
  S('Рыбацкий переулок', 'brown', 60),
  { kind: 'fund', name: 'Фонд' },
  S('Сенная улица', 'brown', 60),
  { kind: 'tax', name: 'Подоходный налог', amount: 200 },
  { kind: 'pier', name: 'Северная пристань', price: 200 },
  S('Кленовая аллея', 'sky', 100),
  { kind: 'luck', name: 'Удача' },
  S('Садовая улица', 'sky', 100),
  S('Вишнёвый проезд', 'sky', 120),
  { kind: 'jail', name: 'Участок' },
  S('Театральная площадь', 'pink', 140),
  { kind: 'util', name: 'Электростанция', price: 150 },
  S('Бульвар Огней', 'pink', 140),
  S('Оперный проезд', 'pink', 160),
  { kind: 'pier', name: 'Восточная пристань', price: 200 },
  S('Мельничная улица', 'orange', 180),
  { kind: 'fund', name: 'Фонд' },
  S('Кузнечный мост', 'orange', 180),
  S('Часовая улица', 'orange', 200),
  { kind: 'rest', name: 'Набережная' },
  S('Улица Звёзд', 'red', 220),
  { kind: 'luck', name: 'Удача' },
  S('Соборная площадь', 'red', 220),
  S('Площадь Фонтанов', 'red', 240),
  { kind: 'pier', name: 'Южная пристань', price: 200 },
  S('Янтарная улица', 'yellow', 260),
  S('Солнечный бульвар', 'yellow', 260),
  { kind: 'util', name: 'Водоканал', price: 150 },
  S('Купеческая улица', 'yellow', 280),
  { kind: 'arrest', name: 'Арест' },
  S('Изумрудная аллея', 'green', 300),
  S('Банковская улица', 'green', 300),
  { kind: 'fund', name: 'Фонд' },
  S('Биржевая площадь', 'green', 320),
  { kind: 'pier', name: 'Западная пристань', price: 200 },
  { kind: 'luck', name: 'Удача' },
  S('Набережная Ривер', 'navy', 350),
  { kind: 'tax', name: 'Налог на роскошь', amount: 100 },
  S('Холм Нуар', 'navy', 400),
];

const round10 = (x) => Math.max(10, Math.round(x / 10) * 10);
/** Rent of a street by number of houses (5 = hotel). */
function streetRent(price, houses) {
  const base = Math.max(2, Math.round((price * 0.08) / 2) * 2);
  return [base, round10(base * 5), round10(base * 14), round10(base * 36), round10(base * 46), round10(base * 58)][houses];
}
const PIER_RENT = [0, 25, 50, 100, 200];

const LUCK = [
  { text: 'Прогулка на Старт', move: 0 },
  { text: 'Ужин на Набережной Ривер', move: 37 },
  { text: 'Катер до ближайшей пристани', nearest: 'pier' },
  { text: 'Вернитесь на 3 клетки назад', back: 3 },
  { text: 'Вас задержали — отправляйтесь в Участок', jail: true },
  { text: 'Выигрыш в клубной лотерее', money: 150 },
  { text: 'Штраф за парковку', money: -15 },
  { text: 'Ремонт фасадов: по 25 за дом и 100 за отель', repairs: [25, 100] },
  { text: 'Карточка «Выход из Участка» — сохраните её', jailCard: true },
  { text: 'Вас выбрали старостой: заплатите каждому по 50', each: -50 },
  { text: 'Прогулка до Театральной площади', move: 11 },
  { text: 'Премия за лучший стол вечера', money: 100 },
];
const FUND = [
  { text: 'Возврат переплаты по налогу', money: 20 },
  { text: 'Наследство от дальнего родственника', money: 100 },
  { text: 'День рождения: каждый игрок дарит вам по 10', each: 10 },
  { text: 'Визит к стоматологу', money: -50 },
  { text: 'Страховой взнос', money: -50 },
  { text: 'Дивиденды по акциям', money: 50 },
  { text: 'Премия от городского совета', money: 200 },
  { text: 'Отправляйтесь на Старт', move: 0 },
  { text: 'Вас задержали — отправляйтесь в Участок', jail: true },
  { text: 'Карточка «Выход из Участка» — сохраните её', jailCard: true },
  { text: 'Ремонт дорог: по 40 за дом и 115 за отель', repairs: [40, 115] },
  { text: 'Выигрыш в конкурсе красоты двора', money: 10 },
];

module.exports = { GROUPS, CELLS, streetRent, PIER_RENT, LUCK, FUND };

'use strict';
/**
 * "Капитал" — «Биржа брендов»: invented companies (none of them real). 40 cells.
 * kinds: start, street, pier, util, tax, luck, fund, jail, rest, arrest
 */

const GROUPS = {
  brown: { name: 'Уличная еда', color: '#8B5A3C', house: 50 },
  sky: { name: 'Кофейни', color: '#7EC8E3', house: 50 },
  pink: { name: 'Мода', color: '#D46A9F', house: 100 },
  orange: { name: 'Доставка', color: '#E8913A', house: 100 },
  red: { name: 'Кино и сериалы', color: '#C8323C', house: 150 },
  yellow: { name: 'Гаджеты', color: '#E6C34A', house: 150 },
  green: { name: 'Финтех и маркет', color: '#2E9E6A', house: 200 },
  navy: { name: 'Премиум', color: '#2F4FA8', house: 200 },
};

const S = (name, group, price) => ({ kind: 'street', name, group, price });
const CELLS = [
  { kind: 'start', name: 'Старт' },
  S('Шаурмастер', 'brown', 60),
  { kind: 'fund', name: 'Фонд' },
  S('Пончик-Ок', 'brown', 60),
  { kind: 'tax', name: 'Подоходный налог', amount: 200 },
  { kind: 'pier', name: 'Такси «Шашечка»', price: 200 },
  S('Бобы и Ко', 'sky', 100),
  { kind: 'luck', name: 'Удача' },
  S('Кофекот', 'sky', 100),
  S('Лунный латте', 'sky', 120),
  { kind: 'jail', name: 'Участок' },
  S('Нитка', 'pink', 140),
  { kind: 'util', name: 'Ток-Энерго', price: 150 },
  S('Кедики', 'pink', 140),
  S('Бархат', 'pink', 160),
  { kind: 'pier', name: 'Рельс-Экспресс', price: 200 },
  S('Корзинкин', 'orange', 180),
  { kind: 'fund', name: 'Фонд' },
  S('Грядкин', 'orange', 180),
  S('Ланчбокс', 'orange', 200),
  { kind: 'rest', name: 'Перерыв' },
  S('Попкорн+', 'red', 220),
  { kind: 'luck', name: 'Удача' },
  S('Киноволна', 'red', 220),
  S('Сериалити', 'red', 240),
  { kind: 'pier', name: 'Паром «Нуар»', price: 200 },
  S('Пиксельлаб', 'yellow', 260),
  S('Зарядкин', 'yellow', 260),
  { kind: 'util', name: 'Сигналыч', price: 150 },
  S('Квантум', 'yellow', 280),
  { kind: 'arrest', name: 'Арест' },
  S('Стеллажкин', 'green', 300),
  S('Оборот Банк', 'green', 300),
  { kind: 'fund', name: 'Фонд' },
  S('Базарчик', 'green', 320),
  { kind: 'pier', name: 'Велопрокат «Педаль»', price: 200 },
  { kind: 'luck', name: 'Удача' },
  S('Аэро Нуар', 'navy', 350),
  { kind: 'tax', name: 'Налог на роскошь', amount: 100 },
  S('Ривер Люкс', 'navy', 400),
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
  { text: 'Перелёт с «Аэро Нуар»', move: 37 },
  { text: 'Вызовите ближайший транспорт и поезжайте', nearest: 'pier' },
  { text: 'Вернитесь на 3 клетки назад', back: 3 },
  { text: 'Вас задержали — отправляйтесь в Участок', jail: true },
  { text: 'Ваш ролик про «Кофекот» залетел в тренды', money: 150 },
  { text: 'Штраф за парковку', money: -15 },
  { text: 'Ребрендинг: по 25 за филиал и 100 за флагман', repairs: [25, 100] },
  { text: 'Карточка «Выход из Участка» — сохраните её', jailCard: true },
  { text: 'Вы спонсор городского фестиваля: заплатите каждому по 50', each: -50 },
  { text: 'Примерка в «Нитке»', move: 11 },
  { text: 'Рекламный контракт с «Попкорн+»', money: 100 },
];
const FUND = [
  { text: 'Возврат переплаты по налогу', money: 20 },
  { text: 'Инвестор поверил в ваш стартап', money: 100 },
  { text: 'День рождения: каждый игрок дарит вам по 10', each: 10 },
  { text: 'Подписка на «Сериалити» продлилась сама', money: -50 },
  { text: 'Страховой взнос', money: -50 },
  { text: 'Кэшбэк от «Оборот Банка»', money: 50 },
  { text: 'Премия от городского совета', money: 200 },
  { text: 'Отправляйтесь на Старт', move: 0 },
  { text: 'Вас задержали — отправляйтесь в Участок', jail: true },
  { text: 'Карточка «Выход из Участка» — сохраните её', jailCard: true },
  { text: 'Проверка качества: по 40 за филиал и 115 за флагман', repairs: [40, 115] },
  { text: 'Отзыв на «Базарчике» принёс бонус', money: 10 },
];

module.exports = { GROUPS, CELLS, streetRent, PIER_RENT, LUCK, FUND };

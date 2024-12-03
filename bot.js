require("dotenv").config(); // Загружаем переменные окружения из .env файла

const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");

const firebaseConfig = require("../CanadaTobaccoBot/canadatobacco-e5f2a-firebase-adminsdk-dxq87-52a544f229.json");
// Инициализация Firebase с использованием конфигурации
admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});

const db = admin.firestore();
const itemsRef = db.collection("items");
const ordersRef = db.collection("orders");

const bot = new Telegraf("7823586098:AAF8IpSZLc8VZmw4UslcLoIveRMX2e9A44k");

let currentAction = {}; // { chatId: { type, data } }

bot.telegram.setMyCommands([
  { command: "start", description: "Начало работы с ботом" },
  { command: "add_item", description: "Добавить товар в коробку" },
  { command: "add_order", description: "Добавить заявку" },
  { command: "view_items", description: "Просмотреть товары в коробке" },
  { command: "view_orders", description: "Просмотреть заявки" },
]);

// Команда /start
bot.command("start", (ctx) => {
  ctx.reply(
    `Привет! Я бот для управления табаком.\n\nВот список доступных команд:\n` +
      `/add_item - Добавить табак в коробку\n` +
      `/add_order - Добавить табак в заявку\n` +
      `/view_items - Просмотреть табаки в коробке\n` +
      `/view_orders - Просмотреть заявки`
  );
});

// Добавление товара
bot.command("add_item", (ctx) => {
  ctx.reply(
    "Введите табак для добавления в коробку в формате: Бренд Вкус \nНапример, Troff Krick"
  );
  currentAction[ctx.chat.id] = { type: "item", data: {} };
});

// Добавление заявки
bot.command("add_order", (ctx) => {
  ctx.reply("Введите заявку в формате: Бренд Вкус \nНапример, Troff Krick");
  currentAction[ctx.chat.id] = { type: "order", data: {} };
});

// Просмотр товаров с кнопками удаления
bot.command("view_items", async (ctx) => {
  try {
    const snapshot = await itemsRef.get();
    if (snapshot.empty) {
      return ctx.reply("Коробка пуста.");
    }

    const items = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() })) // Собираем id и данные
      .sort((a, b) => a.brand.localeCompare(b.brand)); // Сортируем по алфавиту (по brand)

    // Выводим отсортированный список
    for (const item of items) {
      await ctx.reply(
        `${item.brand} – ${item.flavor}`,
        Markup.inlineKeyboard([
          Markup.button.callback("🗑️ Удалить", `delete_item_${item.id}`),
        ])
      );
    }
  } catch (error) {
    console.error("Ошибка при запросе Firestore:", error);
    ctx.reply("Ошибка при получении данных.");
  }
});

// Просмотр заявок с кнопками удаления
bot.command("view_orders", async (ctx) => {
  try {
    const snapshot = await ordersRef.get();
    if (snapshot.empty) {
      return ctx.reply("Нет заявок.");
    }

    // Преобразуем документы в массив и сортируем по бренду
    const orders = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => a.brand.localeCompare(b.brand));

    // Выводим отсортированный список
    for (const order of orders) {
      await ctx.reply(
        `${order.brand} – ${order.flavor}`,
        Markup.inlineKeyboard([
          Markup.button.callback("✅ Заказать", `delete_order_${order.id}`),
        ])
      );
    }
  } catch (error) {
    console.error("Ошибка при запросе Firestore:", error);
    ctx.reply("Ошибка при получении данных.");
  }
});

// Универсальный обработчик текста
bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userAction = currentAction[chatId];

  if (!userAction) {
    return ctx.reply("Выберите действие: /add_item или /add_order.");
  }

  const { type, data } = userAction;

  // Обработка ввода одной строки
  const input = ctx.message.text;
  const [brand, ...flavorParts] = input.split(" ");
  const flavor = flavorParts.join(" "); // объединяем остаток как вкус

  if (!brand || !flavor) {
    return ctx.reply("Неверный формат. Введите данные в формате: Бренд Вкус");
  }

  data.brand = brand;
  data.flavor = flavor;

  try {
    if (type === "item") {
      await itemsRef.add(data);

      ctx.reply(`Табак ${brand} ${flavor} добавлен в коробку`);
    } else if (type === "order") {
      await ordersRef.add({ ...data, status: "open" });
      ctx.reply(`Табак ${brand} ${flavor} добавлен в заявку`);
    }
  } catch (error) {
    console.error("Ошибка при сохранении:", error);
    ctx.reply("Ошибка при добавлении.");
  }
});

// Обработчик нажатия кнопок
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  console.log("Callback data:", data);

  const [action, type, docId] = data.split("_");

  if (action === "delete") {
    try {
      if (type === "item") {
        // Получаем данные о товаре
        const doc = await itemsRef.doc(docId).get();
        if (!doc.exists) {
          return ctx.reply("Товар не найден.");
        }

        const { brand, flavor } = doc.data();

        await itemsRef.doc(docId).delete();
        await ctx.deleteMessage();
        ctx.reply(`Товар ${brand} ${flavor} удален из коробки`);
      } else if (type === "order") {
        // Получаем данные о заявке
        const doc = await ordersRef.doc(docId).get();
        if (!doc.exists) {
          return ctx.reply("Заявка не найдена.");
        }

        const { brand, flavor } = doc.data();

        await ordersRef.doc(docId).delete();
        await ctx.deleteMessage();
        ctx.reply(
          `Товар ${brand} ${flavor} заказан и удален из списка заявок.`
        );
      }
    } catch (error) {
      console.error("Ошибка при удалении:", error);
      ctx.reply("Произошла ошибка при удалении.");
    }
  }

  ctx.answerCbQuery();
});

bot.launch().then(() => console.log("Бот запущен"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

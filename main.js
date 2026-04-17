const { Telegraf, Markup, session } = require("telegraf");
const { Pool } = require("pg");
const { getDbPoolConfig } = require("./db-config");

const API_TOKEN = process.env.API_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!API_TOKEN || Number.isNaN(ADMIN_ID) || !ADMIN_PASSWORD) {
  throw new Error("Missing required env vars: API_TOKEN, ADMIN_ID, ADMIN_PASSWORD");
}

const bot = new Telegraf(API_TOKEN);
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) {
    ctx.session = {};
  }
  return next();
});

// --- DB ---
const db = new Pool(getDbPoolConfig());

async function checkDbConnection() {
  await db.query("SELECT 1");
}

// --- MENU ---
function mainMenu(isAdmin) {
  let buttons = [["📋 Мои задачи"]];
  if (isAdmin) {
    buttons.push(["⚙️ Админ-панель"]);
    buttons.push(["📊 Все задачи"]);
  }
  return Markup.keyboard(buttons).resize();
}

function hasAdminAccess(ctx) {
  return ctx.from.id === ADMIN_ID || Boolean(ctx.session?.isAdmin);
}

function adminInline() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Добавить сотрудника", "add_user")],
    [Markup.button.callback("👤 Выдать задачу", "single_task")],
    [Markup.button.callback("👥 Общая задача", "common_task")]
  ]);
}

function taskButtons(id) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Закрыть", `done_${id}`)],
    [Markup.button.url("📎 Файлы", `tg://user?id=${ADMIN_ID}`)],
    [Markup.button.url("⏳ Перенос", `tg://user?id=${ADMIN_ID}`)]
  ]);
}

const RU_MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь"
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function buildCalendarKeyboard(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1; // Monday-first
  const total = daysInMonth(year, month);
  const rows = [[
    Markup.button.callback("Пн", "dl_ignore"),
    Markup.button.callback("Вт", "dl_ignore"),
    Markup.button.callback("Ср", "dl_ignore"),
    Markup.button.callback("Чт", "dl_ignore"),
    Markup.button.callback("Пт", "dl_ignore"),
    Markup.button.callback("Сб", "dl_ignore"),
    Markup.button.callback("Вс", "dl_ignore")
  ]];
  let row = [];

  for (let i = 0; i < offset; i += 1) {
    row.push(Markup.button.callback(" ", "dl_ignore"));
  }

  for (let day = 1; day <= total; day += 1) {
    row.push(
      Markup.button.callback(
        String(day),
        `dl_day_${year}_${month + 1}_${day}`
      )
    );
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }

  while (row.length > 0 && row.length < 7) {
    row.push(Markup.button.callback(" ", "dl_ignore"));
  }
  if (row.length) rows.push(row);

  let prevMonth = month;
  let prevYear = year;
  let nextMonth = month;
  let nextYear = year;

  if (month === 0) {
    prevMonth = 11;
    prevYear -= 1;
  } else {
    prevMonth -= 1;
  }

  if (month === 11) {
    nextMonth = 0;
    nextYear += 1;
  } else {
    nextMonth += 1;
  }

  rows.push([
    Markup.button.callback("◀️", `dl_nav_${prevYear}_${prevMonth + 1}`),
    Markup.button.callback(`${RU_MONTHS[month]} ${year}`, "dl_ignore"),
    Markup.button.callback("▶️", `dl_nav_${nextYear}_${nextMonth + 1}`)
  ]);

  return Markup.inlineKeyboard(rows);
}

function buildHourKeyboard() {
  const rows = [];
  let row = [];
  for (let hour = 0; hour < 24; hour += 1) {
    row.push(Markup.button.callback(pad2(hour), `dl_h_${hour}`));
    if (row.length === 6) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return Markup.inlineKeyboard(rows);
}

function buildMinuteKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("00", "dl_m_0"),
      Markup.button.callback("15", "dl_m_15"),
      Markup.button.callback("30", "dl_m_30"),
      Markup.button.callback("45", "dl_m_45")
    ]
  ]);
}

function formatDeadline(date, hour, minute) {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()} ${pad2(hour)}:${pad2(minute)}`;
}

// --- START ---
bot.start((ctx) => {
  ctx.reply("👋 Добро пожаловать!", mainMenu(hasAdminAccess(ctx)));
});

// --- ADMIN ---
async function requestAdminAccess(ctx) {
  if (hasAdminAccess(ctx)) {
    return ctx.reply("Админ-панель:", adminInline());
  }
  ctx.session.state = "password";
  return ctx.reply("Введите пароль:");
}

bot.command("admin", requestAdminAccess);
bot.hears("⚙️ Админ-панель", requestAdminAccess);

bot.on("text", async (ctx, next) => {
  if (ctx.session.state === "password") {
    if (ctx.message.text === ADMIN_PASSWORD) {
      ctx.session.isAdmin = true;
      await ctx.reply("Доступ открыт!", mainMenu(true));
      await ctx.reply("Админ-панель:", adminInline());
    } else {
      await ctx.reply("Неверно.");
    }
    delete ctx.session.state;
    return;
  }
  return await next();
});

// --- ADD USER ---
bot.action("add_user", (ctx) => {
  ctx.session.state = "add_id";
  ctx.reply("Введите ID:");
});

bot.on("text", async (ctx, next) => {
  if (ctx.session.state === "add_id") {
    ctx.session.newUser = { id: ctx.message.text };
    ctx.session.state = "add_name";
    return ctx.reply("Введите имя:");
  }

  if (ctx.session.state === "add_name") {
    const { id } = ctx.session.newUser;
    const name = ctx.message.text;

    await db.query(
      "INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
      [id, name]
    );

    ctx.reply("✅ Сотрудник добавлен!");
    ctx.session = {};
    return;
  }

  return await next();
});

// --- TASK FLOW ---
bot.action(["single_task", "common_task"], async (ctx) => {
  ctx.session.task = {
    users: [],
    isCommon: ctx.callbackQuery.data === "common_task"
  };

  const { rows } = await db.query("SELECT id, name FROM users ORDER BY name");
  if (!rows.length) return ctx.reply("Нет сотрудников");

  let buttons = rows.map((u) => [Markup.button.callback(u.name, `sel_${u.id}`)]);

  if (ctx.session.task.isCommon) {
    buttons.push([Markup.button.callback("👉 Далее", "finish_sel")]);
  }

  return ctx.reply("Выберите сотрудника:", Markup.inlineKeyboard(buttons));
});

// SELECT USER
bot.action(/sel_(.+)/, (ctx) => {
  const uid = ctx.match[1];

  if (ctx.session.task.isCommon) {
    let arr = ctx.session.task.users;
    if (arr.includes(uid)) {
      arr = arr.filter(x => x !== uid);
    } else {
      arr.push(uid);
    }
    ctx.session.task.users = arr;
    ctx.answerCbQuery(`Выбрано: ${arr.length}`);
  } else {
    ctx.session.task.users = [uid];
    askPriority(ctx);
  }
});

bot.action("finish_sel", (ctx) => askPriority(ctx));

function askPriority(ctx) {
  ctx.reply("Приоритет:", Markup.inlineKeyboard([
    [Markup.button.callback("🔴 Срочно", "prio_🔴 Срочно")],
    [Markup.button.callback("🟡 Средний", "prio_🟡 Средний")],
    [Markup.button.callback("🟢 Обычный", "prio_🟢 Обычный")]
  ]));
}

// PRIORITY
bot.action(/prio_(.+)/, (ctx) => {
  ctx.session.task.priority = ctx.match[1];
  ctx.session.state = "deadline_date";
  const now = new Date();
  ctx.session.deadlinePicker = { year: now.getFullYear(), month: now.getMonth() };
  ctx.reply("Выберите дату дедлайна:", buildCalendarKeyboard(now.getFullYear(), now.getMonth()));
});

bot.action(/dl_nav_(\d+)_(\d+)/, async (ctx) => {
  if (ctx.session.state !== "deadline_date") {
    return ctx.answerCbQuery("Выбор дедлайна уже завершен");
  }
  const year = Number(ctx.match[1]);
  const month = Number(ctx.match[2]) - 1;
  ctx.session.deadlinePicker = { year, month };
  await ctx.answerCbQuery();
  return ctx.editMessageReplyMarkup(buildCalendarKeyboard(year, month).reply_markup);
});

bot.action(/dl_day_(\d+)_(\d+)_(\d+)/, async (ctx) => {
  if (ctx.session.state !== "deadline_date") {
    return ctx.answerCbQuery("Выбор дедлайна уже завершен");
  }
  const year = Number(ctx.match[1]);
  const month = Number(ctx.match[2]) - 1;
  const day = Number(ctx.match[3]);
  ctx.session.deadlinePicker = { year, month, day };
  ctx.session.state = "deadline_time_hour";
  await ctx.answerCbQuery();
  return ctx.reply("Выберите час:", buildHourKeyboard());
});

bot.action(/dl_h_(\d{1,2})/, async (ctx) => {
  if (ctx.session.state !== "deadline_time_hour") {
    return ctx.answerCbQuery("Сначала выберите дату");
  }
  ctx.session.deadlinePicker.hour = Number(ctx.match[1]);
  ctx.session.state = "deadline_time_minute";
  await ctx.answerCbQuery();
  return ctx.reply("Выберите минуты:", buildMinuteKeyboard());
});

bot.action(/dl_m_(\d{1,2})/, async (ctx) => {
  if (ctx.session.state !== "deadline_time_minute") {
    return ctx.answerCbQuery("Сначала выберите час");
  }
  const minute = Number(ctx.match[1]);
  const { year, month, day, hour } = ctx.session.deadlinePicker || {};
  if ([year, month, day, hour].some((value) => typeof value !== "number")) {
    return ctx.answerCbQuery("Ошибка выбора дедлайна, начните заново");
  }

  const deadlineDate = new Date(year, month, day);
  ctx.session.task.deadline = formatDeadline(deadlineDate, hour, minute);
  ctx.session.state = "text";
  delete ctx.session.deadlinePicker;
  await ctx.answerCbQuery();
  return ctx.reply(`Дедлайн: ${ctx.session.task.deadline}\n\nВведите текст задачи:`);
});

bot.action("dl_ignore", (ctx) => ctx.answerCbQuery());

// DEADLINE
bot.on("text", async (ctx, next) => {
  if (
    ctx.session.state === "deadline_date" ||
    ctx.session.state === "deadline_time_hour" ||
    ctx.session.state === "deadline_time_minute"
  ) {
    return ctx.reply("Выберите дедлайн кнопками: сначала дату, затем время.");
  }

  if (ctx.session.state === "text") {
    ctx.session.task.text = ctx.message.text;
    ctx.session.state = "file";
    return ctx.reply(
      "Отправьте файл или нажмите «Пропустить»:",
      Markup.inlineKeyboard([[Markup.button.callback("⏭ Пропустить", "skip_file")]])
    );
  }

  return await next();
});

// SKIP FILE
bot.command("skip", (ctx) => finalize(ctx, null));
bot.action("skip_file", async (ctx) => {
  if (ctx.session.state !== "file" || !ctx.session.task) {
    return ctx.answerCbQuery("Сейчас нечего пропускать");
  }
  await ctx.answerCbQuery();
  return finalize(ctx, null);
});

// FILE
bot.on(["document", "photo"], (ctx) => {
  const fileId = ctx.message.document
    ? ctx.message.document.file_id
    : ctx.message.photo.pop().file_id;

  finalize(ctx, fileId);
});

// FINALIZE
async function finalize(ctx, fileId) {
  const data = ctx.session.task;
  const userIds = data.users.map((id) => Number(id));
  const usersById = new Map();

  if (data.isCommon && userIds.length) {
    const { rows: userRows } = await db.query(
      "SELECT id, name FROM users WHERE id = ANY($1::bigint[])",
      [userIds]
    );
    userRows.forEach((u) => usersById.set(Number(u.id), u.name));
  }

  for (const uid of data.users) {
    const numericUid = Number(uid);
    const result = await db.query(
      "INSERT INTO tasks (user_id, task_text, priority, deadline) VALUES ($1, $2, $3, $4) RETURNING id",
      [numericUid, data.text, data.priority, data.deadline]
    );
    const taskId = result.rows[0].id;
    let text = `🔔 Новая задача\n\n📝 ${data.text}\nПриоритет: ${data.priority}\n📅 ${data.deadline}`;

    if (data.isCommon) {
      const teammateNames = userIds
        .filter((id) => id !== numericUid)
        .map((id) => usersById.get(id) || `ID ${id}`);

      text += teammateNames.length
        ? `\n\n👥 Выполняете вместе с: ${teammateNames.join(", ")}`
        : "\n\n👥 Общая задача";
    }

    if (fileId) {
      await bot.telegram.sendDocument(numericUid, fileId, {
        caption: text,
        ...taskButtons(taskId)
      });
    } else {
      await bot.telegram.sendMessage(numericUid, text, taskButtons(taskId));
    }
  }

  await ctx.reply("✅ Задача выдана!");
  ctx.session = {};
}

// DONE
bot.action(/done_(\d+)/, async (ctx) => {
  const id = ctx.match[1];
  const userId = ctx.from.id;
  try {
    // Только своя задача; RETURNING — защита от повторного нажатия.
    const { rows } = await db.query(
      `DELETE FROM tasks
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, task_text, priority, deadline`,
      [id, userId]
    );

    if (!rows[0]) {
      await ctx.answerCbQuery("Задача недоступна или уже закрыта");
      return;
    }

    const task = rows[0];

    const { rows: nameRows } = await db.query("SELECT name FROM users WHERE id = $1", [
      userId
    ]);
    const from = ctx.from;
    const displayName =
      nameRows[0]?.name ||
      [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
      `ID ${userId}`;

    const { rows: countRows } = await db.query(
      "SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1",
      [userId]
    );
    const remaining = countRows[0].n;

    await bot.telegram.sendMessage(
      ADMIN_ID,
      [
        "✅ Сотрудник закрыл задачу",
        "",
        `👤 Кто закрыл: ${displayName}`,
        `🪪 Telegram ID: ${userId}`,
        `🆔 Задача #${task.id}`,
        `📝 Текст: ${task.task_text}`,
        `🔖 Приоритет: ${task.priority}`,
        `📅 Дедлайн: ${task.deadline}`,
        "",
        `📋 Осталось активных задач у сотрудника: ${remaining}`
      ].join("\n")
    );

    const hasTextMessage = Boolean(ctx.callbackQuery?.message?.text);
    if (hasTextMessage) {
      await ctx.editMessageText("✅ Выполнено");
    } else {
      await ctx.editMessageCaption("✅ Выполнено");
    }
    await ctx.answerCbQuery("Отмечено");
  } catch (err) {
    await ctx.answerCbQuery("Отмечено");
    await ctx.reply("✅ Выполнено");
    console.error("Failed to finish task:", err);
  }
});

// --- MY TASKS ---
bot.hears("📋 Мои задачи", async (ctx) => {
  const { rows } = await db.query("SELECT * FROM tasks WHERE user_id = $1 ORDER BY id DESC", [
    ctx.from.id
  ]);
  if (!rows.length) return ctx.reply("Нет задач");

  for (const t of rows) {
    await ctx.reply(`📝 ${t.task_text}\n${t.priority}\n📅 ${t.deadline}`, taskButtons(t.id));
  }
});

// --- ALL TASKS ---
bot.hears("📊 Все задачи", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const { rows } = await db.query(
    `SELECT t.*, u.name
     FROM tasks t
     LEFT JOIN users u ON t.user_id = u.id
     ORDER BY t.id DESC`
  );

  if (!rows.length) return ctx.reply("Нет задач");

  let text = "📊 Все задачи:\n\n";
  rows.forEach((t) => {
    text += `👤 ${t.name || "Неизвестно"}\n📝 ${t.task_text}\n${t.priority}\n📅 ${t.deadline}\n\n`;
  });

  return ctx.reply(text);
});

checkDbConnection()
  .then(() => bot.launch())
  .catch((err) => {
    console.error("Failed to init PostgreSQL:", err);
    process.exit(1);
  });
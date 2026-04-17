import asyncio
import aiosqlite
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardMarkup, KeyboardButton

API_TOKEN = '8739094551:AAEGiMQBZpT7HxfZ8FBtTvrhSK8c2asisp4'
ADMIN_PASSWORD = "LumenFab123"
ADMIN_ID = 779881308

bot = Bot(token=API_TOKEN) 
dp = Dispatcher(storage=MemoryStorage())

class States(StatesGroup):
    waiting_for_password = State()
    adding_user_id = State()
    adding_user_name = State()
    selecting_employees = State()
    task_priority = State()
    task_deadline = State()
    task_text = State()
    waiting_for_file = State()

async def init_db():
    async with aiosqlite.connect("tasks.db") as db:
        await db.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)''')
        await db.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            task_text TEXT,
            priority TEXT,
            deadline TEXT
        )''')
        await db.commit()

# --- КЛАВИАТУРЫ ---
def get_main_menu(is_admin=False):
    kb = [[KeyboardButton(text="📋 Мои задачи")]]
    if is_admin:
        kb.extend([
            [KeyboardButton(text="⚙️ Админ-панель")],
            [KeyboardButton(text="📊 Все задачи")]
        ])
    return ReplyKeyboardMarkup(keyboard=kb, resize_keyboard=True)

def get_admin_inline():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Добавить сотрудника", callback_data="add_user")],
        [InlineKeyboardButton(text="👤 Выдать задачу", callback_data="single_task")],
        [InlineKeyboardButton(text="👥 Выдать общую задачу", callback_data="common_task")]
    ])

def get_task_manage_kb(tid):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Закрыть", callback_data=f"done_{tid}")],
        [InlineKeyboardButton(text="📎 Файлы", url=f"tg://user?id={ADMIN_ID}")],
        [InlineKeyboardButton(text="⏳ Перенос", url=f"tg://user?id={ADMIN_ID}")]
    ])

# ИСПРАВЛЕНИЕ 1: три уровня приоритета с эмодзи-цветами
async def ask_prio(msg):
    await msg.answer(
        "Выберите приоритет задачи:",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔴 Срочно",   callback_data="prio_🔴 Срочно")],
            [InlineKeyboardButton(text="🟡 Средний",  callback_data="prio_🟡 Средний")],
            [InlineKeyboardButton(text="🟢 Обычный",  callback_data="prio_🟢 Обычный")],
        ])
    )

# --- АДМИНКА ---
@dp.message(Command("admin"))
@dp.message(F.text == "⚙️ Админ-панель")
async def admin_panel(m: types.Message, state: FSMContext):
    if m.from_user.id == ADMIN_ID:
        await m.answer("Админ-панель:", reply_markup=get_admin_inline())
    else:
        await m.answer("Введите пароль:")
        await state.set_state(States.waiting_for_password)

@dp.message(States.waiting_for_password)
async def check_pass(m: types.Message, state: FSMContext):
    if m.text == ADMIN_PASSWORD and m.from_user.id == ADMIN_ID:
        await m.answer("Доступ открыт!", reply_markup=get_main_menu(True))
    else:
        await m.answer("Неверно.")
    await state.clear()

@dp.callback_query(F.data == "add_user")
async def add_u(c: types.CallbackQuery, state: FSMContext):
    await c.message.answer("Введите Telegram ID сотрудника:")
    await state.set_state(States.adding_user_id)

@dp.message(States.adding_user_id)
async def p_id(m: types.Message, state: FSMContext):
    await state.update_data(u_id=m.text)
    await m.answer("Введите имя сотрудника:")
    await state.set_state(States.adding_user_name)

@dp.message(States.adding_user_name)
async def p_name(m: types.Message, state: FSMContext):
    data = await state.get_data()
    async with aiosqlite.connect("tasks.db") as db:
        await db.execute("INSERT OR REPLACE INTO users VALUES (?, ?)", (data['u_id'], m.text))
        await db.commit()
    await m.answer("✅ Сотрудник добавлен!")
    await state.clear()

# --- ЛОГИКА ЗАДАЧ ---
@dp.callback_query(F.data.in_({"single_task", "common_task"}))
async def prepare_task(c: types.CallbackQuery, state: FSMContext):
    is_common = (c.data == "common_task")
    await state.update_data(is_common=is_common, users=[])
    async with aiosqlite.connect("tasks.db") as db:
        rows = await (await db.execute("SELECT id, name FROM users")).fetchall()
    if not rows:
        await c.message.answer("Нет сотрудников в базе.")
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=r[1], callback_data=f"sel_{r[0]}")] for r in rows
    ])
    if is_common:
        kb.inline_keyboard.append([InlineKeyboardButton(text="👉 Далее", callback_data="finish_sel")])
    await c.message.answer("Выберите исполнителя:", reply_markup=kb)
    await state.set_state(States.selecting_employees)

@dp.callback_query(F.data.startswith("sel_"))
async def sel_emp(c: types.CallbackQuery, state: FSMContext):
    uid = c.data.split("_")[1]
    data = await state.get_data()
    if data['is_common']:
        sel = data.get('users', [])
        if uid not in sel:
            sel.append(uid)
        else:
            sel.remove(uid)
        await state.update_data(users=sel)
        await c.answer(f"Выбрано: {len(sel)}")
    else:
        await state.update_data(users=[uid])
        await ask_prio(c.message)

@dp.callback_query(F.data == "finish_sel")
async def finish(c: types.CallbackQuery, state: FSMContext):
    await ask_prio(c.message)

@dp.callback_query(F.data.startswith("prio_"))
async def set_prio(c: types.CallbackQuery, state: FSMContext):
    prio = c.data[len("prio_"):]          # всё после "prio_", включая эмодзи
    await state.update_data(prio=prio)
    await c.message.answer("Введите дедлайн (например, 25.07.2025):")
    await state.set_state(States.task_deadline)

@dp.message(States.task_deadline)
async def set_dead(m: types.Message, state: FSMContext):
    await state.update_data(dead=m.text)
    await m.answer("Введите текст задачи:")
    await state.set_state(States.task_text)

@dp.message(States.task_text)
async def ask_file(m: types.Message, state: FSMContext):
    await state.update_data(text=m.text)
    await m.answer(
        "Прикрепите файл или нажмите «Пропустить»:",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⏭ Пропустить", callback_data="no_file")]
        ])
    )
    await state.set_state(States.waiting_for_file)

@dp.message(States.waiting_for_file, F.document | F.photo)
async def get_f(m: types.Message, state: FSMContext):
    fid = m.document.file_id if m.document else m.photo[-1].file_id
    await finalize(m, state, fid)

@dp.callback_query(F.data == "no_file")
async def no_f(c: types.CallbackQuery, state: FSMContext):
    await finalize(c.message, state, None)

async def finalize(msg, state, fid):
    data = await state.get_data()
    async with aiosqlite.connect("tasks.db") as db:
        ids_placeholder = ",".join(data['users'])
        names_rows = await (await db.execute(
            f"SELECT name FROM users WHERE id IN ({ids_placeholder})"
        )).fetchall()
        names = [n[0] for n in names_rows]

        for uid in data['users']:
            cur = await db.execute(
                "INSERT INTO tasks (user_id, task_text, priority, deadline) VALUES (?,?,?,?)",
                (uid, data['text'], data['prio'], data['dead'])
            )
            tid = cur.lastrowid
            await db.commit()

            txt = (
                f"🔔 Новая задача\n\n"
                f"📝 {data['text']}\n"
                f"Приоритет: {data['prio']}\n"
                f"📅 Дедлайн: {data['dead']}"
            )
            if data['is_common']:
                txt += f"\n\n👥 Вместе с: {', '.join(names)}"

            if fid:
                await bot.send_document(int(uid), fid, caption=txt, reply_markup=get_task_manage_kb(tid))
            else:
                await bot.send_message(int(uid), txt, reply_markup=get_task_manage_kb(tid))

    await msg.answer("✅ Задача выдана!")
    await state.clear()

@dp.callback_query(F.data.startswith("done_"))
async def done(c: types.CallbackQuery):
    tid = c.data.split("_")[1]
    uid = c.from_user.id
    async with aiosqlite.connect("tasks.db") as db:
        res = await (await db.execute("SELECT task_text FROM tasks WHERE id = ?", (tid,))).fetchone()
        name_row = await (await db.execute("SELECT name FROM users WHERE id = ?", (uid,))).fetchone()
        if res:
            employee_name = name_row[0] if name_row else c.from_user.full_name
            await bot.send_message(
                ADMIN_ID,
                f"✅ Задача закрыта\n\n"
                f"👤 Сотрудник: {employee_name}\n"
                f"📝 Задача: {res[0]}"
            )
        await db.execute("DELETE FROM tasks WHERE id = ?", (tid,))
        await db.commit()
    await c.message.edit_text("✅ Задача выполнена.")

# ИСПРАВЛЕНИЕ 2: обработчик "Все задачи" — для админа и для сотрудника
@dp.message(F.text == "📊 Все задачи")
async def all_tasks(m: types.Message):
    async with aiosqlite.connect("tasks.db") as db:

        # Администратор видит все задачи по всем сотрудникам
        if m.from_user.id == ADMIN_ID:
            rows = await (await db.execute("""
                SELECT t.id, u.name, t.task_text, t.priority, t.deadline
                FROM tasks t
                LEFT JOIN users u ON t.user_id = u.id
                ORDER BY u.name
            """)).fetchall()

            if not rows:
                await m.answer("📭 Активных задач нет.")
                return

            text = "📊 <b>Все активные задачи:</b>\n\n"
            for tid, name, task_text, priority, deadline in rows:
                text += (
                    f"👤 <b>{name or 'Неизвестно'}</b>\n"
                    f"📝 {task_text}\n"
                    f"Приоритет: {priority}\n"
                    f"📅 Дедлайн: {deadline}\n"
                    f"🆔 Задача #{tid}\n"
                    f"{'─' * 28}\n"
                )
            await m.answer(text, parse_mode="HTML")

        # Сотрудник видит только свои задачи с кнопками управления
        else:
            rows = await (await db.execute("""
                SELECT id, task_text, priority, deadline
                FROM tasks
                WHERE user_id = ?
                ORDER BY id DESC
            """, (m.from_user.id,))).fetchall()

            if not rows:
                await m.answer("📭 У вас нет активных задач.")
                return

            await m.answer(f"📋 <b>Ваши активные задачи ({len(rows)}):</b>", parse_mode="HTML")
            for tid, task_text, priority, deadline in rows:
                text = (
                    f"📝 {task_text}\n"
                    f"Приоритет: {priority}\n"
                    f"📅 Дедлайн: {deadline}"
                )
                await m.answer(text, reply_markup=get_task_manage_kb(tid))

# Кнопка "Мои задачи" — алиас для сотрудника
@dp.message(F.text == "📋 Мои задачи")
async def my_tasks(m: types.Message):
    async with aiosqlite.connect("tasks.db") as db:
        rows = await (await db.execute("""
            SELECT id, task_text, priority, deadline
            FROM tasks
            WHERE user_id = ?
            ORDER BY id DESC
        """, (m.from_user.id,))).fetchall()

    if not rows:
        await m.answer("📭 У вас нет активных задач.")
        return

    await m.answer(f"📋 <b>Ваши задачи ({len(rows)}):</b>", parse_mode="HTML")
    for tid, task_text, priority, deadline in rows:
        text = (
            f"📝 {task_text}\n"
            f"Приоритет: {priority}\n"
            f"📅 Дедлайн: {deadline}"
        )
        await m.answer(text, reply_markup=get_task_manage_kb(tid))

@dp.message(Command("start"))
async def start(m: types.Message):
    await m.answer(
        "👋 Добро пожаловать!",
        reply_markup=get_main_menu(m.from_user.id == ADMIN_ID)
    )

async def main():
    await init_db()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())